import { describe, expect, it } from 'vitest';
import {
  flapPath,
  flapPlacement,
  flapRing,
  flapToNote,
  foldedPaperPath,
  foldedRing,
  foldSize,
  FOLD_MAX,
  FOLD_MIN,
  FOLD_NOTE_FLOOR,
} from './stickyFold';
import { contrastRatio, paperOf, paperShadows, PALETTE_ORDER, STICKY_RADIUS } from './stickyThemes';
import { roughStickyPaper } from './roughNodes';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

/** Every coordinate pair a path visits, in order. Absolute commands only, as the builders emit. */
function pathPairs(d: string): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, body] of d.matchAll(/([MLHVAQZ])([^MLHVAQZ]*)/g)) {
    const n = (body.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (cmd === 'H') x = n[0];
    else if (cmd === 'V') y = n[0];
    else if (cmd === 'A') [x, y] = [n[5], n[6]];
    else if (cmd === 'Z') continue;
    else for (let i = 0; i + 1 < n.length; i += 2) [x, y] = [n[i], n[i + 1]];
    out.push({ x, y });
  }
  return out;
}

describe('fold size', () => {
  it('scales with the note and stays within its bounds', () => {
    expect(foldSize(200, 200)).toBe(24);
    expect(foldSize(400, 200)).toBe(24);
    expect(foldSize(160, 160)).toBeCloseTo(19.2);
    expect(foldSize(1000, 1000)).toBe(FOLD_MAX);
    expect(foldSize(FOLD_NOTE_FLOOR, 300)).toBe(FOLD_MIN);
  });

  it('does not fold a note too small to carry one, or a degenerate one', () => {
    expect(foldSize(FOLD_NOTE_FLOOR - 1, 300)).toBe(0);
    expect(foldSize(0, 0)).toBe(0);
    expect(foldSize(Number.NaN, 200)).toBe(0);
    expect(foldedPaperPath(40, 40, STICKY_RADIUS, foldSize(40, 40))).not.toContain('L');
  });

  it('never takes more than a quarter of the short side', () => {
    for (let s = FOLD_NOTE_FLOOR; s <= 600; s += 7) expect(foldSize(s, s)).toBeLessThanOrEqual(s / 4);
  });
});

describe('the cut sheet', () => {
  it('cuts the bottom-right corner along the crease', () => {
    const ring = foldedRing(200, 200, 24);
    expect(ring).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 176 },
      { x: 176, y: 200 },
      { x: 0, y: 200 },
    ]);
    const visited = pathPairs(foldedPaperPath(200, 200, STICKY_RADIUS, 24));
    expect(visited).toContainEqual({ x: 200, y: 176 });
    expect(visited).toContainEqual({ x: 176, y: 200 });
    // The corner itself is gone.
    expect(visited).not.toContainEqual({ x: 200, y: 200 });
  });

  it('stays inside the note at every size', () => {
    for (const [w, h] of [[200, 200], [400, 200], [60, 300], [57, 57]]) {
      for (const p of pathPairs(foldedPaperPath(w, h, STICKY_RADIUS, foldSize(w, h)))) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(w);
        expect(p.y).toBeLessThanOrEqual(h);
      }
    }
  });
});

describe('the flap', () => {
  it('is the cut-off corner reflected across the crease', () => {
    const place = flapPlacement(200, 160, 24);
    // Crease ends where the cut is, the tip where the corner lands when turned over.
    close(flapToNote({ x: -place.half, y: 0 }, place), { x: 200, y: 136 });
    close(flapToNote({ x: place.half, y: 0 }, place), { x: 176, y: 160 });
    close(flapToNote({ x: 0, y: place.half }, place), { x: 176, y: 136 });
  });

  it('lifts by pulling the tip back towards the crease, never past the sheet', () => {
    const place = flapPlacement(200, 200, 24);
    const rest = flapToNote({ x: 0, y: place.half }, place, 1);
    const lifted = flapToNote({ x: 0, y: place.half }, place, 0.86);
    expect(lifted.x).toBeGreaterThan(rest.x);
    expect(lifted.y).toBeGreaterThan(rest.y);
    // The crease does not move.
    close(flapToNote({ x: -place.half, y: 0 }, place, 0.86), { x: 200, y: 176 });
  });

  it('draws in its own frame with the crease on y = 0', () => {
    const d = flapPath(16);
    const pts = pathPairs(d);
    expect(pts[0]).toEqual({ x: -16, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 16, y: 0 });
    for (const p of pts) expect(p.y).toBeGreaterThanOrEqual(0);
    expect(flapPath(0)).toBe('');
  });

  it('is drawn by hand in sketch mode, on the same cut', () => {
    const paper = roughStickyPaper({ id: 'n1', width: 200, height: 200 }, 'medium');
    expect(paper.flap.silhouette).toMatch(/Z$/);
    expect(paper.flap.outline.length).toBeGreaterThan(0);
    expect(flapRing(200, 200, 24)).toHaveLength(3);
    // Too small to fold: no flap, and the sheet is still drawn.
    const tiny = roughStickyPaper({ id: 'n2', width: 40, height: 40 }, 'medium');
    expect(tiny.flap.silhouette).toBe('');
    expect(tiny.silhouette.length).toBeGreaterThan(0);
  });
});

describe('paper colours', () => {
  it('keeps the writing and the footer at AA on every paper, on both boards', () => {
    for (const dark of [false, true]) {
      for (const theme of PALETTE_ORDER) {
        const p = paperOf(theme, dark);
        expect(contrastRatio(p.bg, p.ink), `${theme} ink, dark=${dark}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.bg, p.secondaryInk), `${theme} footer, dark=${dark}`).toBeGreaterThanOrEqual(4.5);
        // The sheen and the foot are the same paper; the ink must hold across the gradient.
        expect(contrastRatio(p.sheen, p.ink)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.foot, p.ink)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('gives the turned corner an underside that reads against the face', () => {
    for (const dark of [false, true]) {
      for (const theme of PALETTE_ORDER) {
        const p = paperOf(theme, dark);
        // Distinct from the face at the tip and at the crease, but still the same paper,
        // not a hole: neither end is anywhere near the ink.
        expect(contrastRatio(p.back, p.bg), `${theme} back, dark=${dark}`).toBeGreaterThan(1.04);
        expect(contrastRatio(p.crease, p.back), `${theme} crease, dark=${dark}`).toBeGreaterThan(1.15);
        expect(contrastRatio(p.crease, p.bg)).toBeLessThan(contrastRatio(p.ink, p.bg));
      }
    }
  });

  it('draws the shadows stronger on a dark board, except the one that falls on the paper', () => {
    const light = paperShadows(false, false, 24);
    const dark = paperShadows(true, false, 24);
    expect(dark.contact.opacity).toBeGreaterThan(light.contact.opacity);
    expect(dark.ambient.opacity).toBeGreaterThan(light.ambient.opacity);
    expect(dark.flap.opacity).toBe(light.flap.opacity);
    for (const s of [dark.contact, dark.ambient]) expect(s.opacity).toBeLessThanOrEqual(0.85);
  });

  it('lifts: the contact softens, the ambient widens and falls further', () => {
    const rest = paperShadows(false, false, 24);
    const up = paperShadows(false, true, 24);
    expect(up.contact.opacity).toBeLessThan(rest.contact.opacity);
    expect(up.ambient.offsetY).toBeGreaterThan(rest.ambient.offsetY);
    expect(up.ambient.blur).toBeGreaterThan(rest.ambient.blur);
  });
});
