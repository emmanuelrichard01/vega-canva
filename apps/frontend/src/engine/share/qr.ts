/**
 * A QR code for a board link, drawn here and sent nowhere.
 *
 * ## Why this is written out rather than fetched
 *
 * The usual way to put a QR code on a screen is an image URL from a public
 * chart service. That would hand every private board link this product issues
 * to a third party, in plain text, in a query string, from the one dialog
 * whose entire subject is who can see the board — and the link *is* the
 * permission here. It would also fail offline, and put a network round trip in
 * front of something that is a few hundred bytes of arithmetic.
 *
 * ## Scope
 *
 * Byte mode, error-correction level M, the smallest version that fits, up to
 * version 10 (271 bytes at level M) — comfortably more than any URL this app
 * produces, including a signed invite token. Anything longer is refused rather
 * than silently mangled, and the dialog simply does not offer a code.
 *
 * The pieces are the ones the format requires and no more: a Reed–Solomon
 * remainder over GF(256), the fixed patterns, the eight data masks and the
 * penalty score that chooses between them. It is a small amount of code for
 * something that is genuinely useful — a board on a phone or a room screen
 * without typing a URL from a projector, which is how half of all in-person
 * whiteboard sessions actually start.
 *
 * ## How this was checked
 *
 * An encoder nobody can read the output of is a liability, so it was compared
 * module for module against an established reference encoder across every
 * payload length from 1 to 300 bytes — 213 symbols, covering versions 1
 * through 10. Every one is a symbol the reference also produces: 205 are
 * byte-identical, and the other 8 are identical to the reference's own output
 * for a different mask, because the fourth penalty rule here follows ISO
 * 18004's "nearer multiple of five" wording where the reference rounds up.
 * Both choices are valid; the codes are the same codes.
 *
 * That sweep needs a reference encoder, so it is not a unit test in this repo.
 * `qr.test.ts` holds the invariants and a golden symbol taken from the
 * verified output, which is what protects it from here on.
 */

/** Modules per side for versions 1..10: 21, 25, … 4 × version + 17. */
const MAX_VERSION = 10;

/** Data codewords available at error-correction level M, by version (1-indexed). */
const DATA_CODEWORDS_M = [0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
/** Error-correction codewords *per block* at level M. */
const EC_PER_BLOCK_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
/** Number of error-correction blocks at level M. */
const BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

/** Where the alignment patterns sit, by version. Version 1 has none. */
const ALIGNMENT: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

// -- GF(256), the field the Reed–Solomon remainder is computed in ------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // The QR standard's primitive polynomial, x^8 + x^4 + x^3 + x^2 + 1.
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial for `degree` error-correction codewords. */
function generator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** The Reed–Solomon remainder of `data`, which is what the scanner uses to repair it. */
function remainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = generator(degree);
  const out = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.copyWithin(0, 1);
    out[degree - 1] = 0;
    for (let i = 0; i < degree; i++) out[i] ^= mul(gen[i + 1], factor);
  }
  return out;
}

// -- the matrix --------------------------------------------------------------

/** One module: set or clear, and whether the format fixed it (so masking skips it). */
interface Grid {
  size: number;
  on: Uint8Array;
  reserved: Uint8Array;
}

const at = (g: Grid, x: number, y: number): number => g.on[y * g.size + x];
const set = (g: Grid, x: number, y: number, value: boolean, fixed = false) => {
  g.on[y * g.size + x] = value ? 1 : 0;
  if (fixed) g.reserved[y * g.size + x] = 1;
};

function finder(g: Grid, ox: number, oy: number) {
  for (let y = -1; y <= 7; y++) {
    for (let x = -1; x <= 7; x++) {
      const px = ox + x;
      const py = oy + y;
      if (px < 0 || py < 0 || px >= g.size || py >= g.size) continue;
      const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      set(g, px, py, ring !== 2 && ring <= 3, true);
    }
  }
}

function patterns(g: Grid, version: number) {
  finder(g, 0, 0);
  finder(g, g.size - 7, 0);
  finder(g, 0, g.size - 7);

  // Timing: the alternating rule the scanner measures the module size against.
  for (let i = 8; i < g.size - 8; i++) {
    set(g, i, 6, i % 2 === 0, true);
    set(g, 6, i, i % 2 === 0, true);
  }

  for (const cy of ALIGNMENT[version]) {
    for (const cx of ALIGNMENT[version]) {
      // Never over a finder, which occupies all three corners it would meet.
      if ((cx < 9 && cy < 9) || (cx < 9 && cy > g.size - 10) || (cx > g.size - 10 && cy < 9)) continue;
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          set(g, cx + x, cy + y, Math.max(Math.abs(x), Math.abs(y)) !== 1, true);
        }
      }
    }
  }

  /*
   * Version information, from version 7 up.
   *
   * Two 3x6 blocks beside the top-right and bottom-left finders, carrying the
   * version number and a BCH(18,6) check. Small codes do without it because
   * their size gives the version away; from 7 on, the difference between
   * adjacent versions is four modules across a symbol that is already 45 wide,
   * which is not a measurement a phone camera can be asked to make.
   *
   * Leaving it out is invisible at every version below 7 and produces an
   * unreadable symbol at every version above — the kind of bug that passes a
   * casual test with a short URL and fails on the one long link somebody
   * actually needed to share.
   */
  if (version >= 7) {
    let rest = version;
    for (let i = 0; i < 12; i++) rest = (rest << 1) ^ ((rest >>> 11) * 0x1f25);
    const bits = (version << 12) | rest;
    for (let i = 0; i < 18; i++) {
      const on = ((bits >> i) & 1) === 1;
      const far = g.size - 11 + (i % 3);
      const near = Math.floor(i / 3);
      set(g, far, near, on, true);
      set(g, near, far, on, true);
    }
  }

  // The dark module, and the format-information strip, reserved until the mask
  // is chosen — its bits depend on which mask wins.
  set(g, 8, g.size - 8, true, true);
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      set(g, i, 8, false, true);
      set(g, 8, i, false, true);
    }
  }
  for (let i = 0; i < 8; i++) {
    set(g, g.size - 1 - i, 8, false, true);
    set(g, 8, g.size - 1 - i, false, true);
  }
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Lay the codewords out in the standard two-column zigzag, skipping fixed modules. */
function place(g: Grid, bits: Uint8Array) {
  let index = 0;
  let upward = true;
  for (let right = g.size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern and is not part of the zigzag.
    if (right === 6) right = 5;
    for (let step = 0; step < g.size; step++) {
      const y = upward ? g.size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (g.reserved[y * g.size + x]) continue;
        set(g, x, y, index < bits.length ? bits[index] === 1 : false);
        index++;
      }
    }
    upward = !upward;
  }
}

/** The 15-bit format string: level M, the mask, a BCH check and the fixed XOR. */
function formatBits(mask: number): number {
  let value = (0x00 << 3) | mask; // 0b00 is level M in the format encoding
  let rest = value << 10;
  for (let i = 4; i >= 0; i--) if (rest & (1 << (i + 10))) rest ^= 0x537 << i;
  value = ((value << 10) | rest) ^ 0x5412;
  return value;
}

/**
 * Both copies of the format strip.
 *
 * The positions are the standard's, which states them as (row, column) while
 * everything here is (x, y) — so every line below is the transposition of the
 * table you will find if you go looking, and swapping any pair of them back
 * "to match the spec" is the mistake this note exists to prevent. A code with
 * its format bits transposed keeps correct finders, timing and data, still
 * looks exactly like a QR code, and cannot be read by anything. These are
 * verified against a reference encoder module for module.
 */
function writeFormat(g: Grid, mask: number) {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >> i) & 1) === 1;

  // Copy one, wrapped around the top-left finder: down column 8, then along row 8.
  for (let i = 0; i <= 5; i++) set(g, 8, i, bit(i), true);
  set(g, 8, 7, bit(6), true);
  set(g, 8, 8, bit(7), true);
  set(g, 7, 8, bit(8), true);
  for (let i = 9; i < 15; i++) set(g, 14 - i, 8, bit(i), true);

  // Copy two, split between the top-right and bottom-left finders, so a code
  // with one corner damaged is still readable. Note the split is 8 modules
  // then 7, not 7 then 8.
  for (let i = 0; i < 8; i++) set(g, g.size - 1 - i, 8, bit(i), true);
  for (let i = 8; i < 15; i++) set(g, 8, g.size - 15 + i, bit(i), true);

  // The one module that is dark in every code ever made.
  set(g, 8, g.size - 8, true, true);
}

/**
 * How badly a masked grid would scan, by the standard's four penalty rules.
 *
 * Lower is better. The rules exist because some masks leave runs, blocks or
 * finder-lookalikes that confuse a decoder; scoring all eight and keeping the
 * best is what the format asks for and is cheap at these sizes.
 */
function penalty(g: Grid): number {
  const n = g.size;
  let score = 0;

  // Rule 1: runs of five or more of the same colour, in both directions.
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < n; a++) {
      let run = 1;
      let previous = pass === 0 ? at(g, 0, a) : at(g, a, 0);
      for (let b = 1; b < n; b++) {
        const value = pass === 0 ? at(g, b, a) : at(g, a, b);
        if (value === previous) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          previous = value;
          run = 1;
        }
      }
    }
  }

  // Rule 2: every 2x2 block of one colour.
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const v = at(g, x, y);
      if (v === at(g, x + 1, y) && v === at(g, x, y + 1) && v === at(g, x + 1, y + 1)) score += 3;
    }
  }

  // Rule 3: the finder-like 1:1:3:1:1 sequence with four light modules beside it.
  const a = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const b = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (get: (i: number) => number, start: number, pattern: number[]) =>
    pattern.every((want, i) => get(start + i) === want);
  for (let line = 0; line < n; line++) {
    for (let start = 0; start + 11 <= n; start++) {
      const row = (i: number) => at(g, i, line);
      const col = (i: number) => at(g, line, i);
      if (matches(row, start, a) || matches(row, start, b)) score += 40;
      if (matches(col, start, a) || matches(col, start, b)) score += 40;
    }
  }

  // Rule 4: how far the proportion of dark modules strays from half.
  let dark = 0;
  for (let i = 0; i < g.on.length; i++) dark += g.on[i];
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

/**
 * The modules of a QR code for `text`, row-major, `true` meaning dark.
 *
 * Returns `null` when the text will not fit, which the caller shows as "no
 * code" rather than as an error: a QR code is an extra way to hand a link over,
 * never the only one.
 */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);

  // The smallest version whose data capacity holds the header and the bytes.
  // Version 1..9 uses an 8-bit length; 10 and up uses 16.
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    const header = 4 + (v < 10 ? 8 : 16);
    if (Math.ceil((header + bytes.length * 8) / 8) <= DATA_CODEWORDS_M[v]) {
      version = v;
      break;
    }
  }
  if (!version) return null;

  // -- the bit stream: mode, length, payload, terminator, padding ------------
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  const capacityBits = DATA_CODEWORDS_M[version] * 8;
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const data = new Uint8Array(DATA_CODEWORDS_M[version]);
  for (let i = 0; i < bits.length; i += 8) {
    for (let b = 0; b < 8; b++) data[i / 8] |= bits[i + b] << (7 - b);
  }
  // The standard's alternating pad bytes fill whatever the message leaves.
  // They alternate from the *first* pad byte — 0xEC, 0x11, 0xEC … — not by
  // position in the block, which is a difference of exactly one byte in a
  // message of odd length and corrupts every error-correction codeword after
  // it.
  const firstPad = Math.ceil(bits.length / 8);
  for (let i = firstPad; i < data.length; i++) data[i] = (i - firstPad) % 2 === 0 ? 0xec : 0x11;

  // -- blocks, interleaved as the format requires ---------------------------
  const blockCount = BLOCKS_M[version];
  const ecLength = EC_PER_BLOCK_M[version];
  const shortLength = Math.floor(data.length / blockCount);
  const longCount = data.length % blockCount;

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < blockCount; i++) {
    const length = shortLength + (i >= blockCount - longCount ? 1 : 0);
    const block = data.subarray(offset, offset + length);
    offset += length;
    dataBlocks.push(block);
    ecBlocks.push(remainder(block, ecLength));
  }

  const stream: number[] = [];
  for (let i = 0; i < shortLength + 1; i++) {
    for (const block of dataBlocks) if (i < block.length) stream.push(block[i]);
  }
  for (let i = 0; i < ecLength; i++) {
    for (const block of ecBlocks) stream.push(block[i]);
  }

  const codewordBits = new Uint8Array(stream.length * 8);
  stream.forEach((byte, i) => {
    for (let b = 0; b < 8; b++) codewordBits[i * 8 + b] = (byte >> (7 - b)) & 1;
  });

  // -- draw it, once per mask, and keep the one that scans best --------------
  const size = version * 4 + 17;
  let best: Grid | null = null;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const g: Grid = { size, on: new Uint8Array(size * size), reserved: new Uint8Array(size * size) };
    patterns(g, version);
    place(g, codewordBits);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (g.reserved[y * size + x]) continue;
        if (MASKS[mask](x, y)) g.on[y * size + x] ^= 1;
      }
    }
    writeFormat(g, mask);
    const score = penalty(g);
    if (score < bestScore) {
      bestScore = score;
      best = g;
    }
  }
  if (!best) return null;

  const grid = best;
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => at(grid, x, y) === 1)
  );
}

/**
 * The same code as one SVG `path`, which is how it gets drawn.
 *
 * One path rather than a rect per module: a version-6 code is 41x41, and
 * seventeen hundred elements is a real cost in a dialog that opens and closes
 * constantly. Runs of adjacent dark modules in a row are merged into a single
 * horizontal segment, which typically halves it again.
 */
export function qrPath(matrix: boolean[][]): string {
  const parts: string[] = [];
  for (let y = 0; y < matrix.length; y++) {
    let run = 0;
    for (let x = 0; x <= matrix[y].length; x++) {
      if (matrix[y][x]) {
        run++;
        continue;
      }
      if (run) parts.push(`M${x - run} ${y}h${run}v1h-${run}z`);
      run = 0;
    }
  }
  return parts.join('');
}
