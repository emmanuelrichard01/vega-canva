import { describe, expect, it } from 'vitest';
import { ART } from './art';
import { vegaWordmark, wordmarkWidth, studioLine } from './artKit';

type Node = { id: string; type: string; x: number; y: number; width: number; height: number; [k: string]: unknown };
const build = (id: string, limit?: number) => ART.find((t) => t.id === id)!.build(limit) as unknown as Node[];
/** Everything about a node except its id, which is fresh on every build. */
const shape = (nodes: Node[]) => nodes.map(({ id: _id, ...rest }) => JSON.stringify(rest).replace(/"(nodeId|tableId)":"[^"]+"/g, ''));

describe('the illustration boards', () => {
  it('draw the same picture on every build, so the card is the board', () => {
    for (const t of ART) expect(shape(t.build() as unknown as Node[]), t.id).toEqual(shape(t.build() as unknown as Node[]));
  });

  it('give the hero one 1200×630 link-preview frame that holds everything', () => {
    const nodes = build('art-vega-hero');
    const frames = nodes.filter((n) => n.type === 'frame');
    expect(frames).toHaveLength(1);
    const f = frames[0];
    expect([f.width, f.height, f.preset]).toEqual([1200, 630, 'og']);
    const outside = nodes.filter(
      (n) => n.type !== 'connector' && n !== f && (n.x < f.x || n.y < f.y || n.x + n.width > f.x + f.width || n.y + n.height > f.y + f.height)
    );
    expect(outside.map((n) => n.type)).toEqual([]);
  });

  it('keep the flow field under the cover budget when asked to', () => {
    expect(build('art-flow-field', 150).length).toBeLessThanOrEqual(150);
    expect(build('art-flow-field').length).toBeGreaterThan(100);
  });
});

describe('the drawn brand', () => {
  it('sets VEGA to the width the wordmark measures at its cap height', () => {
    const nodes = vegaWordmark(0, 0, 91) as unknown as Node[];
    const right = Math.max(...nodes.map((n) => n.x + n.width));
    const bottom = Math.max(...nodes.map((n) => n.y + n.height));
    expect(right).toBeCloseTo(wordmarkWidth(91), 0);
    expect(bottom).toBeCloseTo(91, 0);
  });

  it('spreads STUDIO across exactly the width it is given', () => {
    const nodes = studioLine(10, 0, 20, 200) as unknown as Node[];
    expect(Math.min(...nodes.map((n) => n.x))).toBeCloseTo(10, 0);
    expect(Math.max(...nodes.map((n) => n.x + n.width))).toBeCloseTo(210, 0);
  });
});
