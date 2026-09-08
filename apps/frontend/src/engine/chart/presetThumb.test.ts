import { describe, expect, it } from 'vitest';
import { allExamples } from './chartExamples';
import { layoutChart } from './chartLayout';
import { presetThumbSvg, silhouette, thumbLayoutBox, thumbSpec } from './presetThumb';

/**
 * Every example card draws, and none of them draws a word.
 *
 * These are the two properties the old thumbnail failed on, and both failed
 * *silently* — a card that renders nothing looks like a slow card, and text
 * lying three deep across itself looks like a rendering bug somewhere else.
 * Neither would have failed a test that only asked whether the function
 * returned a string.
 */

const CARD_W = 124;
const CARD_H = 70;

const examples = allExamples();

describe('presetThumbSvg', () => {
  it('draws something for every example', () => {
    // The bug this replaces: `tickets-channel` needed 117px of its 124 for the
    // category names down the left, the plot collapsed to a zero-size rect and
    // the card came back with no marks in it at all.
    for (const ex of examples) {
      const svg = presetThumbSvg(ex.spec, CARD_W, CARD_H, false);
      const marks = svg.match(/<(rect|path|circle|polyline|line|polygon|ellipse)\b/g) ?? [];
      expect(marks.length, `${ex.id} (${ex.spec.kind}) drew nothing`).toBeGreaterThan(0);
    }
  });

  it('never draws text at thumbnail size', () => {
    /**
     * The guard for the whole design. Typography is absolute — an axis tick is
     * 11px because 11px is legible — so five ticks in a 70px box lie across
     * one another three deep. A thumbnail carries no text at all, and this
     * fails the moment a text-bearing field is added to `ChartLayout` without
     * being listed in `silhouette`.
     */
    for (const ex of examples) {
      const svg = presetThumbSvg(ex.spec, CARD_W, CARD_H, false);
      expect(svg, `${ex.id} (${ex.spec.kind})`).not.toContain('<text');
    }
  });

  it('fills the card rather than hiding in the corner the gutters left', () => {
    for (const ex of examples) {
      const [lw, lh] = thumbLayoutBox(CARD_W, CARD_H);
      const layout = layoutChart(thumbSpec(ex.spec, CARD_W, CARD_H), lw, lh);
      const p = layout.plot;
      expect(p.width, `${ex.id} plot width`).toBeGreaterThan(0);
      expect(p.height, `${ex.id} plot height`).toBeGreaterThan(0);

      // The fit scales the plot rect up to the card, so at least one axis of
      // the marks reaches the frame. Before, a bar chart's marks occupied 40%
      // of the width and half the height, and the rest was empty gutter.
      const scale = Math.min((CARD_W - 4) / p.width, (CARD_H - 4) / p.height);
      const shownW = p.width * scale;
      const shownH = p.height * scale;
      expect(
        Math.max(shownW / CARD_W, shownH / CARD_H),
        `${ex.id} fills neither axis`
      ).toBeGreaterThan(0.9);
    }
  });

  it('scales uniformly, so a pie is not an oval', () => {
    const pie = examples.find((e) => e.spec.kind === 'pie')!;
    const svg = presetThumbSvg(pie.spec, CARD_W, CARD_H, false);
    const m = svg.match(/scale\((-?[\d.]+)\)/);
    // One number, not two: `scale(s)` and never `scale(sx sy)`.
    expect(m, 'no uniform scale found').toBeTruthy();
    expect(Number(m![1])).toBeGreaterThan(0);
  });

  it('clamps the expensive kinds against the size they are shown at', () => {
    const contour = examples.find((e) => e.spec.kind === 'contour')!;
    const small = thumbSpec(contour.spec, CARD_W, CARD_H);
    // A contour is marching squares *per level*, and its authored resolution
    // is for a full-size chart. Both dimensions of the cost come down.
    expect(small.resolution!).toBeLessThan(contour.spec.resolution ?? 60);
    expect(small.levels!).toBeLessThanOrEqual(5);

    const curve = examples.find((e) => e.spec.kind === 'parametric')!;
    expect(thumbSpec(curve.spec, CARD_W, CARD_H).samples!).toBeLessThan(
      curve.spec.samples ?? 160
    );
  });

  it('lays out in the card"s aspect, so the fit wastes little', () => {
    const [w, h] = thumbLayoutBox(CARD_W, CARD_H);
    expect(w / h).toBeCloseTo(CARD_W / CARD_H, 1);
    // And stays in a range the engine lays out sensibly in, whatever aspect
    // a caller asks for.
    const [, tall] = thumbLayoutBox(60, 400);
    expect(tall).toBeLessThanOrEqual(330);
  });

  it('keeps the axis rules, which are not furniture', () => {
    // A bar chart without its baseline is bars floating in a box.
    const bar = examples.find((e) => e.spec.kind === 'bar')!;
    const [lw, lh] = thumbLayoutBox(CARD_W, CARD_H);
    const bare = silhouette(layoutChart(thumbSpec(bar.spec, CARD_W, CARD_H), lw, lh));
    expect(bare.baseline).toBeTruthy();
    expect(bare.categoryLabels).toHaveLength(0);
    expect(bare.valueLabels).toHaveLength(0);
    expect(bare.legend).toHaveLength(0);
    expect(bare.title).toBeNull();
  });
});
