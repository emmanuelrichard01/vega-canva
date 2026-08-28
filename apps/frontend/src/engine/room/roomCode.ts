/**
 * A room id, said out loud.
 *
 * ## The problem
 *
 * A board is shared by sending its link, and that works until somebody is not
 * in a position to click one -- reading it to a room, typing it off a screen
 * on a call, writing it on a whiteboard. The id is a `nanoid(10)`, drawn from
 * an alphabet that contains `l` and `I` and `1`, `O` and `0`, and both cases
 * of everything. It is a fine identifier and an unusable thing to dictate.
 *
 * ## Why this is not a shortened alias
 *
 * The obvious move is a short friendly code that maps to the real id. That
 * needs somewhere to keep the mapping, which this app does not have, and it
 * makes the code weaker than the link it stands for -- and since the id *is*
 * the capability to open the board, the weakest way in sets the security of
 * the whole thing. A six-character alias would be a six-character password on
 * a board somebody thinks is protected by a sixty-bit one.
 *
 * So there is no alias and no mapping. The code is the id, written in a
 * different alphabet. Every bit is carried across, nothing is stored, and the
 * two forms are exactly as guessable as each other.
 *
 * ## How it is lossless
 *
 * nanoid's URL alphabet is exactly 64 symbols, so each character of an id is
 * exactly six bits. Ten characters is sixty bits, and sixty divides by five,
 * so an id is exactly twelve symbols of a 32-symbol alphabet with nothing left
 * over and no padding. That is a coincidence worth building on: it means every
 * board that already exists has a code, rather than only boards made after
 * this was written.
 *
 * ## Why Crockford's Base32
 *
 * It is the alphabet designed for this exact job. `I`, `L`, `O` and `U` are
 * absent: the first three because they are misread as `1`, `1` and `0`, and
 * `U` so that a random code cannot spell an obscenity at somebody. Decoding is
 * case-insensitive and forgiving -- `I` and `L` are read as `1`, `O` as `0` --
 * so the transcription mistakes people actually make resolve to the right
 * board instead of failing.
 *
 * ## The check symbol
 *
 * A thirteenth symbol carries the whole value modulo 37, which is Crockford's
 * own scheme and is why the alphabet has five extra symbols defined for it.
 *
 * This is the part that earns its place. Without it, a mistyped code is still
 * a *valid* room id, so the app cheerfully opens a different board -- one that
 * does not exist yet, which means an empty canvas and somebody convinced their
 * colleague's work has been lost. A checksum turns that silent wrong answer
 * into "that code is not right, check it", which is the difference between a
 * bug report and a shrug.
 */

/** nanoid's URL alphabet. Exactly 64 symbols, hence exactly six bits each. */
const ID_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

/** The length `Home` generates, and the only length that maps cleanly. */
export const ID_LENGTH = 10;

/** Crockford's Base32. No I, L, O or U. */
const SYMBOLS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Crockford's five extra symbols, for check values 32 to 36. */
const CHECK_SYMBOLS = `${SYMBOLS}*~$=U`;

/** Twelve symbols of payload, one of checksum. */
const CODE_LENGTH = 13;

/** How the code is broken up for reading. Four, four, then the rest. */
const GROUPS = [4, 4, 5];

/**
 * What a person might type where a symbol was meant.
 *
 * Crockford's rule, and the reason the alphabet omits these in the first
 * place. Applied on the way in only: nothing ever *writes* an `I`.
 */
const CONFUSABLE: Record<string, string> = { I: '1', L: '1', O: '0' };

/** The whole value modulo 37, accumulated a symbol at a time. */
function checkValue(values: number[]): number {
  // Horner's method rather than building the number and taking a remainder.
  // Sixty bits does not fit in a JavaScript number, and this needs neither
  // BigInt nor an apology.
  return values.reduce((acc, v) => (acc * 32 + v) % 37, 0);
}

/**
 * Re-pack a stream of values from one bit width to another.
 *
 * The accumulator is drained before each new value is pushed in, so it never
 * holds more than `outBits - 1 + inBits` bits: comfortably inside the 32 that
 * JavaScript's bitwise operators work in.
 */
function repack(values: number[], inBits: number, outBits: number): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;

  for (const value of values) {
    acc = (acc << inBits) | value;
    bits += inBits;
    while (bits >= outBits) {
      bits -= outBits;
      out.push((acc >>> bits) & ((1 << outBits) - 1));
    }
    acc &= (1 << bits) - 1;
  }

  return out;
}

/**
 * The code for a room id, or `null` if the id is not one we can encode.
 *
 * Boards opened from a link somebody hand-edited, or from a much older build,
 * may carry an id that is not a canonical `nanoid(10)`. Those are still
 * perfectly good boards and the link still works; they simply have no code,
 * and the interface should offer the link alone rather than invent something.
 */
export function roomCodeFor(id: string): string | null {
  if (id.length !== ID_LENGTH) return null;

  const values: number[] = [];
  for (const ch of id) {
    const v = ID_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    values.push(v);
  }

  const symbols = repack(values, 6, 5);
  return (
    symbols.map((v) => SYMBOLS[v]).join('') + CHECK_SYMBOLS[checkValue(symbols)]
  );
}

/** `ABCDEFGHJKMNP` as `ABCD-EFGH-JKMNP`. */
export function formatRoomCode(code: string): string {
  const out: string[] = [];
  let at = 0;
  for (const size of GROUPS) {
    if (at >= code.length) break;
    out.push(code.slice(at, at + size));
    at += size;
  }
  if (at < code.length) out.push(code.slice(at));
  return out.join('-');
}

/**
 * The room id a typed code refers to, or `null` if it is not a valid code.
 *
 * Deliberately generous about presentation and strict about content. Spaces,
 * hyphens, case and the three confusable letters are all somebody transcribing
 * rather than somebody getting it wrong, and none of them changes what was
 * meant. A failed checksum is a different thing entirely and is refused.
 */
export function roomIdFromCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .split('')
    .map((ch) => CONFUSABLE[ch] ?? ch)
    .join('');

  if (cleaned.length !== CODE_LENGTH) return null;

  const body = cleaned.slice(0, CODE_LENGTH - 1);
  const check = cleaned[CODE_LENGTH - 1];

  const values: number[] = [];
  for (const ch of body) {
    const v = SYMBOLS.indexOf(ch);
    if (v < 0) return null;
    values.push(v);
  }

  const expected = CHECK_SYMBOLS.indexOf(check);
  if (expected < 0 || expected !== checkValue(values)) return null;

  return repack(values, 5, 6)
    .map((v) => ID_ALPHABET[v])
    .join('');
}

/** Whether a string could be a code at all, ignoring how it was spaced. */
export function looksLikeRoomCode(input: string): boolean {
  return input.toUpperCase().replace(/[\s-]+/g, '').length === CODE_LENGTH;
}

/**
 * A short, one-way fingerprint of a room id.
 *
 * ## Why a backup must not contain the room id
 *
 * A JSON export is a file people move around: attached to a ticket, dropped in
 * a shared drive, committed to a repository. The room id is not a name, it is
 * the *capability* -- anyone holding it can open the live board and edit it.
 * Writing it into the export would mean that committing a backup to a public
 * repository silently hands the world edit access to the board it came from,
 * and nothing about saving a backup suggests you are publishing a key.
 *
 * ## Why a fingerprint is enough, and why short is safer
 *
 * The only question the file has to answer is "is this a backup of the board I
 * am standing in?", and that needs comparison, not recovery. Thirty-two bits
 * of fingerprint over a sixty-bit id means roughly 2^28 different boards share
 * any given value, so the fingerprint identifies no board in particular even
 * to somebody willing to enumerate all of them. Truncation is doing real work
 * here: a *longer* digest would be closer to the id it stands for.
 *
 * The collision rate is the other side of that trade and it does not matter.
 * Being wrong means one sentence in a confirmation dialog reads "a backup of
 * this board" when it is not, next to a full description of what the file
 * holds, at odds of about four billion to one.
 *
 * FNV-1a rather than something from WebCrypto because this has to run
 * synchronously while a dialog is being assembled, and because resistance to a
 * determined preimage attack is not what is being asked of it -- there is no
 * preimage worth having once the output is this short.
 */
export function roomFingerprint(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    // The FNV prime, as shifts, because `hash * 16777619` loses the low bits
    // to floating point before the truncation below can keep them.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
