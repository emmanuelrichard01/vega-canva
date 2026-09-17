import net from 'net';

/**
 * Which addresses the server may open a connection to on a user's behalf.
 *
 * The link preview fetches a URL somebody typed. Without this, typing
 * `http://169.254.169.254/latest/meta-data/` would have the server read its own
 * cloud credentials and hand them back as a card's description, and
 * `http://10.0.0.5:5432` would turn the preview into a scanner of the private
 * network it runs in. That is server-side request forgery, and it is the one
 * thing an unfurl endpoint must be built around rather than patched for.
 *
 * ## Checked on the address, not the name
 *
 * A hostname proves nothing: `internal.example.com` can resolve to `10.0.0.5`,
 * and a name can resolve to a public address when checked and a private one a
 * second later when connected to (DNS rebinding). So the check runs inside the
 * socket's own `lookup`, on the exact addresses the connection will use — see
 * `guardedLookup` — and a literal IP in the URL is checked before anything
 * else, because Node skips `lookup` for those.
 *
 * ## Written out, not delegated
 *
 * `net.BlockList` could hold these ranges, but whether it treats an
 * IPv4-mapped IPv6 address (`::ffff:127.0.0.1`) by its IPv4 rules is exactly
 * the kind of detail an SSRF guard cannot leave to a reading of the docs. The
 * parsing below is small, and the tests pin every embedding that hides an IPv4
 * address inside an IPv6 one.
 */

type Range = [base: number, bits: number];

const ip4 = (a: number, b: number, c: number, d: number) => ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;

/** IPv4 ranges that are not the public internet. */
const BLOCKED_V4: Range[] = [
  [ip4(0, 0, 0, 0), 8], // "this network"
  [ip4(10, 0, 0, 0), 8], // private
  [ip4(100, 64, 0, 0), 10], // carrier-grade NAT
  [ip4(127, 0, 0, 0), 8], // loopback
  [ip4(169, 254, 0, 0), 16], // link-local, and cloud metadata
  [ip4(172, 16, 0, 0), 12], // private
  [ip4(192, 0, 0, 0), 24], // IETF protocol assignments
  [ip4(192, 0, 2, 0), 24], // documentation
  [ip4(192, 88, 99, 0), 24], // 6to4 relay anycast
  [ip4(192, 168, 0, 0), 16], // private
  [ip4(198, 18, 0, 0), 15], // benchmarking
  [ip4(198, 51, 100, 0), 24], // documentation
  [ip4(203, 0, 113, 0), 24], // documentation
  [ip4(224, 0, 0, 0), 4], // multicast
  [ip4(240, 0, 0, 0), 4], // reserved, and broadcast
];

function parseV4(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function inV4(value: number, [base, bits]: Range): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return ((value & mask) >>> 0) === ((base & mask) >>> 0);
}

function isPublicV4(value: number): boolean {
  return !BLOCKED_V4.some((range) => inV4(value, range));
}

/** An IPv6 address as its sixteen bytes, or null when it is not one. */
export function parseV6(address: string): number[] | null {
  let text = address.trim();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(':')) return null;

  // A trailing dotted quad (`::ffff:1.2.3.4`) is the last two groups, written
  // differently; rewrite it as those groups and parse one notation.
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = parseV4(last);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groups = (s: string) => (s === '' ? [] : s.split(':'));
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const bytes: number[] = [];
  for (const group of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    const n = parseInt(group, 16);
    bytes.push((n >> 8) & 255, n & 255);
  }
  return bytes.length === 16 ? bytes : null;
}

const v4From = (b: number[], at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const startsWith = (b: number[], prefix: number[], bits: number) => {
  for (let i = 0; i < bits; i++) {
    const byte = Math.floor(i / 8);
    const bit = 7 - (i % 8);
    if (((b[byte] >> bit) & 1) !== ((prefix[byte] >> bit) & 1)) return false;
  }
  return true;
};

function isPublicV6(b: number[]): boolean {
  const zeroes = (n: number) => b.slice(0, n).every((x) => x === 0);
  // :: and ::1
  if (zeroes(15) && (b[15] === 0 || b[15] === 1)) return false;
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible): the IPv4 rules.
  if (zeroes(10) && b[10] === 0xff && b[11] === 0xff) return isPublicV4(v4From(b, 12));
  if (zeroes(12)) return isPublicV4(v4From(b, 12));
  // 64:ff9b::/96 — NAT64 carries an IPv4 address that a gateway will dial.
  if (startsWith(b, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0], 96)) return isPublicV4(v4From(b, 12));
  // 2002::/16 — 6to4 carries one in bytes 2–5.
  if (b[0] === 0x20 && b[1] === 0x02) return isPublicV4(v4From(b, 2));
  if (startsWith(b, [0xfc], 7)) return false; // unique local
  if (startsWith(b, [0xfe, 0x80], 10)) return false; // link-local
  if (startsWith(b, [0xfe, 0xc0], 10)) return false; // site-local, deprecated but routable inside
  if (b[0] === 0xff) return false; // multicast
  if (startsWith(b, [0x20, 0x01, 0x0d, 0xb8], 32)) return false; // documentation
  if (startsWith(b, [0x01, 0x00, 0, 0, 0, 0, 0, 0], 64)) return false; // discard
  return true;
}

/** Whether a literal IP address is somewhere on the public internet. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '');
  const kind = net.isIP(bare.split('%')[0]);
  if (kind === 4) {
    const v4 = parseV4(bare);
    return v4 !== null && isPublicV4(v4);
  }
  if (kind === 6) {
    const bytes = parseV6(bare);
    return bytes !== null && isPublicV6(bytes);
  }
  return false;
}

/**
 * Names that are never public, refused before a lookup is spent on them.
 *
 * Defence in depth only — the address check is what actually holds — but it
 * makes the refusal immediate and its message specific.
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa') ||
    host === 'metadata.google.internal' ||
    !host.includes('.') // a bare intranet name
  );
}

export class BlockedAddressError extends Error {
  address: string;
  constructor(address: string) {
    super('That address is not on the public internet');
    this.address = address;
    this.name = 'BlockedAddressError';
  }
}

type LookupAddress = { address: string; family: number };
type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
type Resolver = (hostname: string, options: { all: true }, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

/**
 * A drop-in `lookup` for `http.request` that refuses non-public answers.
 *
 * Every address a name resolves to must be public, not just the first: a
 * resolver that answers `[public, 127.0.0.1]` would otherwise let the socket's
 * happy-eyeballs fallback reach the second one.
 */
export function guardedLookup(resolve: Resolver) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback) => {
    const wantsAll = typeof options === 'object' && options !== null && options.all === true;
    resolve(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err, wantsAll ? [] : '', undefined);
      if (!addresses.length) {
        const empty = Object.assign(new Error(`No addresses for ${hostname}`), { code: 'ENOTFOUND' });
        return callback(empty, wantsAll ? [] : '', undefined);
      }
      const bad = addresses.find((a) => !isPublicAddress(a.address));
      if (bad) return callback(new BlockedAddressError(bad.address) as NodeJS.ErrnoException, wantsAll ? [] : '', undefined);
      if (wantsAll) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}
