import { describe, expect, it } from 'vitest';
import { qrMatrix, qrPath } from './qr';

/**
 * A QR encoder can only be wrong in ways that look right.
 *
 * Every bug found while writing this one — a transposed format strip, pad
 * bytes alternating from the wrong parity, the version block missing above
 * version 6 — produced something that still had three finders, still had
 * timing patterns, still looked in every way like a QR code on screen, and was
 * unreadable by any scanner. So "it renders" proves nothing, and these tests
 * are built around the things that would actually have caught them.
 *
 * The golden symbol is the real guard. It was taken from output verified module
 * for module against an established reference encoder over 213 payloads
 * spanning versions 1 to 10 (see the note at the top of `qr.ts`); if anything
 * in the pipeline shifts by one bit, this stops matching.
 */

const render = (matrix: boolean[][]) => matrix.map((row) => row.map((on) => (on ? '#' : '.')).join(''));

/** `https://vega.studio/room/abc123` — a version 3 symbol at error level M. */
const GOLDEN = [
  '#######........######.#######',
  '#.....#..#..#....#..#.#.....#',
  '#.###.#.#####.#.#..##.#.###.#',
  '#.###.#.#..##...##.#..#.###.#',
  '#.###.#.#.#.####.####.#.###.#',
  '#.....#.#..######.....#.....#',
  '#######.#.#.#.#.#.#.#.#######',
  '........###..#.#...#.........',
  '#.#####...###.##.##.#.#####..',
  '#..##..###.##..########.#...#',
  '..#.###.##.##....#..#.###....',
  '..#..#.#..#...#.#..####.##.#.',
  '.##.###.##.##...##.#.....##..',
  '##.#....#....###..##..###...#',
  '#.#####..#...####.#.##.#.##..',
  '.##....#....##.#...##.###..#.',
  '.#...##..#..#.##.#.#.....##..',
  '#.#......#.##..##.###.###.#.#',
  '#.###########....##.#..##.#..',
  '#..###.#...##.#.#.#..#.##..#.',
  '#.#..##.#.###....#.######.###',
  '........#..#.###..#.#...#####',
  '#######..#..#########.#.###..',
  '#.....#.#.#..#.....##...#...#',
  '#.###.#.#.#...#####.#####.#.#',
  '#.###.#.#................##..',
  '#.###.#.#...####..##..######.',
  '#.....#..#.#........#....#.#.',
  '#######.##.#.#######...####..',
];

describe('qrMatrix', () => {
  it('encodes a board link exactly, module for module', () => {
    expect(render(qrMatrix('https://vega.studio/room/abc123')!)).toEqual(GOLDEN);
  });

  it('picks the smallest version the payload fits in', () => {
    // 4 x version + 17 modules a side.
    expect(qrMatrix('https://example.com/')!.length).toBe(25); // version 2
    expect(qrMatrix('a'.repeat(120))!.length).toBe(45); // version 7
    expect(qrMatrix('a'.repeat(200))!.length).toBe(57); // version 10
  });

  it('refuses a payload past version 10 rather than truncating it', () => {
    // 216 data codewords at level M, less the mode and 16-bit length header.
    expect(qrMatrix('a'.repeat(213))).not.toBeNull();
    expect(qrMatrix('a'.repeat(300))).toBeNull();
  });

  it('places three finders and no fourth', () => {
    const m = qrMatrix('https://vega.studio/room/abc123')!;
    const n = m.length;
    const finder = (ox: number, oy: number) =>
      [0, 1, 2, 3, 4, 5, 6].every((y) =>
        [0, 1, 2, 3, 4, 5, 6].every((x) => {
          const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
          return m[oy + y][ox + x] === (ring !== 2);
        })
      );
    expect(finder(0, 0)).toBe(true);
    expect(finder(n - 7, 0)).toBe(true);
    expect(finder(0, n - 7)).toBe(true);
    // The bottom-right corner is data, and a finder there would be a bug that
    // still looked plausible.
    expect(finder(n - 7, n - 7)).toBe(false);
  });

  it('alternates the timing patterns, which is how a scanner finds the module size', () => {
    const m = qrMatrix('https://vega.studio/room/abc123')!;
    for (let i = 8; i < m.length - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
  });

  it('always sets the module that is dark in every code ever made', () => {
    const m = qrMatrix('https://example.com/')!;
    expect(m[m.length - 8][8]).toBe(true);
  });

  it('is deterministic — the same link is always the same picture', () => {
    expect(render(qrMatrix('https://vega.studio/i/token')!)).toEqual(render(qrMatrix('https://vega.studio/i/token')!));
  });

  it('encodes non-ASCII as UTF-8 rather than dropping it', () => {
    const plain = qrMatrix('https://vega.studio/a')!;
    const accented = qrMatrix('https://vega.studio/ü')!;
    // Two bytes where the other has one, so the symbols cannot be identical.
    expect(render(accented)).not.toEqual(render(plain));
  });
});

describe('qrPath', () => {
  it('draws every dark module and nothing else', () => {
    const matrix = qrMatrix('https://vega.studio/room/abc123')!;
    const rebuilt = matrix.map((row) => row.map(() => false));
    for (const [, x, y, run] of qrPath(matrix).matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(run); i++) rebuilt[Number(y)][Number(x) + i] = true;
    }
    expect(render(rebuilt)).toEqual(render(matrix));
  });

  it('merges a run of modules into one segment rather than one each', () => {
    // The top-left finder alone has seven-module runs; a per-module path would
    // be thousands of commands in a dialog that opens and closes constantly.
    const segments = qrPath(qrMatrix('https://vega.studio/room/abc123')!).match(/M/g)?.length ?? 0;
    const dark = qrMatrix('https://vega.studio/room/abc123')!.flat().filter(Boolean).length;
    expect(segments).toBeLessThan(dark / 1.5);
  });
});
