import { describe, expect, it } from 'vitest';
import { buildPieDiagram } from './buildPie';
import { layoutPie, looksLikePie, parsePie, wedgePath } from './pie';

const parse = (src: string) => parsePie(src.trim());

/** The user's own example, verbatim. */
const NETFLIX = `
pie title NETFLIX
         "Time spent looking for movie" : 90
         "Time spent watching it" : 10
`;

const VOLDEMORT = `
pie title What Voldemort doesn't have?
         "FRIENDS" : 2
         "FAMILY" : 3
         "NOSE" : 45
`;

describe('recognising a pie chart', () => {
  it('reads the header', () => {
    expect(looksLikePie(NETFLIX.trim())).toBe(true);
  });

  it('does not claim a flowchart', () => {
    expect(looksLikePie('flowchart TD\n  A-->B')).toBe(false);
  });

  it('is not fooled by the word inside a label', () => {
    // `looksLikePie` decides which parser runs, so a false positive sends a
    // perfectly good flowchart to the wrong one.
    expect(looksLikePie('flowchart TD\n  A[pie chart]')).toBe(false);
  });
});

describe('parsing', () => {
  it('reads the title and every slice', () => {
    const { chart, error } = parse(NETFLIX);
    expect(error).toBeNull();
    expect(chart!.title).toBe('NETFLIX');
    expect(chart!.slices).toEqual([
      { label: 'Time spent looking for movie', value: 90 },
      { label: 'Time spent watching it', value: 10 },
    ]);
  });

  it('keeps punctuation in a title', () => {
    // "What Voldemort doesn't have?" — an apostrophe and a question mark, and
    // neither is a delimiter here.
    expect(parse(VOLDEMORT).chart!.title).toBe("What Voldemort doesn't have?");
  });

  it('takes a title on its own line', () => {
    const { chart } = parse('pie\n  title Later\n  "a" : 1');
    expect(chart!.title).toBe('Later');
  });

  it('takes a chart with no title at all', () => {
    const { chart } = parse('pie\n  "a" : 1\n  "b" : 2');
    expect(chart!.title).toBe('');
    expect(chart!.slices).toHaveLength(2);
  });

  it('reads showData', () => {
    const { chart } = parse('pie showData title Shares\n  "a" : 1');
    expect(chart!.showData).toBe(true);
    expect(chart!.title).toBe('Shares');
  });

  it('accepts a decimal share', () => {
    expect(parse('pie\n  "a" : 12.5').chart!.slices[0].value).toBe(12.5);
  });

  it('keeps an empty label rather than dropping the slice', () => {
    // The share is still real, so the wedge still has to be drawn.
    expect(parse('pie\n  "" : 3').chart!.slices).toEqual([{ label: '', value: 3 }]);
  });
});

describe('what it refuses', () => {
  it('wants the header', () => {
    const { chart, error } = parse('"a" : 1');
    expect(chart).toBeNull();
    expect(error).toMatch(/pie/);
  });

  it('says so when there are no slices', () => {
    const { chart, error } = parse('pie title Empty');
    expect(chart).toBeNull();
    expect(error).toMatch(/No slices/);
  });

  it('refuses a negative share', () => {
    // There is no wedge with negative area, and silently taking the absolute
    // value would draw a chart that disagrees with its own source.
    const { chart, error, errorLine } = parse('pie\n  "a" : 1\n  "b" : -4');
    expect(chart).toBeNull();
    expect(error).toMatch(/share/);
    expect(errorLine).toBe(3);
  });

  it('refuses a chart that is all zeroes', () => {
    const { chart, error } = parse('pie\n  "a" : 0\n  "b" : 0');
    expect(chart).toBeNull();
    expect(error).toMatch(/zero/);
  });

  it('skips a line it cannot read rather than failing the chart', () => {
    const { chart, skippedLines } = parse('pie\n  "a" : 1\n  nonsense here\n  "b" : 2');
    expect(chart!.slices).toHaveLength(2);
    expect(skippedLines).toEqual([3]);
  });
});

describe('geometry', () => {
  const laid = (src: string) => layoutPie(parse(src).chart!, { originX: 0, originY: 0 });

  it('gives each slice its share of the circle', () => {
    const layout = laid(NETFLIX);
    expect(layout.wedges[0].share).toBeCloseTo(0.9, 6);
    expect(layout.wedges[1].share).toBeCloseTo(0.1, 6);
  });

  it('divides the whole circle and no more', () => {
    const layout = laid(VOLDEMORT);
    const total = layout.wedges.reduce((sum, w) => sum + (w.endAngle - w.startAngle), 0);
    expect(total).toBeCloseTo(Math.PI * 2, 6);
  });

  it('starts at twelve o clock and runs clockwise', () => {
    // What mermaid draws, and what makes the first slice in the source the one
    // at the top — so the order in the code is the order round the rim.
    const layout = laid(NETFLIX);
    expect(layout.wedges[0].startAngle).toBeCloseTo(-Math.PI / 2, 6);
    expect(layout.wedges[0].endAngle).toBeGreaterThan(layout.wedges[0].startAngle);
  });

  it('leaves no gap between one slice and the next', () => {
    const layout = laid(VOLDEMORT);
    for (let i = 1; i < layout.wedges.length; i += 1) {
      expect(layout.wedges[i].startAngle).toBeCloseTo(layout.wedges[i - 1].endAngle, 9);
    }
  });

  it('splits a big slice into quarter-turn spans', () => {
    /**
     * A single cubic cannot describe an arc longer than about a quarter turn
     * without visible error, and a 90% slice is most of the circle. Centre,
     * plus one anchor per span boundary.
     */
    const layout = laid(NETFLIX);
    const big = layout.wedges[0];
    // 0.9 of a turn is 324°, which needs four spans: five rim anchors.
    expect(big.anchors).toHaveLength(1 + 5);
    expect(big.handles).toHaveLength(5);
  });

  it('keeps every rim anchor exactly on the circle', () => {
    // The assertion that the handle maths is right: a wedge whose anchors
    // drifted off the radius would draw a pie with a lumpy edge.
    const layout = laid(VOLDEMORT);
    for (const wedge of layout.wedges) {
      for (const anchor of wedge.anchors.slice(1)) {
        const r = Math.hypot(anchor.x - layout.centre.x, anchor.y - layout.centre.y);
        expect(r).toBeCloseTo(layout.radius, 6);
      }
    }
  });

  it('draws a closed path with no NaN in it', () => {
    const d = wedgePath(laid(NETFLIX).wedges[0]);
    expect(d).not.toContain('NaN');
    expect(d.endsWith('Z')).toBe(true);
    expect(d.startsWith('M')).toBe(true);
  });

  it('handles a slice that is the whole circle', () => {
    const layout = laid('pie\n  "everything" : 1');
    expect(layout.wedges[0].share).toBe(1);
    expect(wedgePath(layout.wedges[0])).not.toContain('NaN');
  });

  it('handles a zero slice beside real ones', () => {
    // Legal in mermaid and it draws nothing, but it must not divide by zero
    // or throw the ones after it out of position.
    const layout = laid('pie\n  "a" : 0\n  "b" : 5');
    expect(layout.wedges[0].share).toBe(0);
    expect(layout.wedges[1].share).toBe(1);
    expect(wedgePath(layout.wedges[0])).not.toContain('NaN');
  });

  it('gives every slice its own legend row, stacked', () => {
    const layout = laid(VOLDEMORT);
    const ys = layout.wedges.map((w) => w.legend.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(ys).size).toBe(3);
  });

  it('reports bounds that contain the pie and the legend', () => {
    const layout = laid(VOLDEMORT);
    expect(layout.centre.x + layout.radius).toBeLessThanOrEqual(layout.width);
    for (const wedge of layout.wedges) {
      expect(wedge.legend.x + wedge.legend.width).toBeLessThanOrEqual(layout.width + 0.001);
    }
  });
});

describe('building the objects', () => {
  /**
   * A fixed diagram id, so node kinds can be matched by prefix.
   *
   * With a generated one the ids end in `nanoid(6)`, whose alphabet contains
   * `-` — so a random tail beginning `ls-` turns a *share* id into `…-p-ls-…`
   * and a substring match counts it as a legend swatch. Rare, and a failure
   * that will not reproduce on its own when it happens.
   */
  const build = (src: string) =>
    buildPieDiagram(parse(src).chart!, { x: 0, y: 0 }, 'fixed').nodes;

  it('makes one closed path per slice', () => {
    const wedges = build(VOLDEMORT).filter((n: any) => n.type === 'path');
    expect(wedges).toHaveLength(3);
    for (const wedge of wedges as any[]) {
      expect(wedge.geometry.kind).toBe('bezier');
      expect(wedge.geometry.closed).toBe(true);
    }
  });

  it('closes each wedge with a straight edge back to the centre', () => {
    /**
     * `segments[0]` is the curve *arriving at* anchor 0, which on a closed
     * path is the run home from the last anchor — for a wedge, the straight
     * edge back to the centre. Getting that wrong draws a slice with one
     * curved side, which looks like a rendering fault rather than a modelling
     * one.
     */
    const wedge = build(NETFLIX).find((n: any) => n.type === 'path') as any;
    const first = wedge.geometry.segments[0];
    const last = wedge.geometry.segments[wedge.geometry.segments.length - 1];
    // The closing controls sit on the line: one at the last anchor, one at the
    // centre anchor itself.
    expect(first.cp1x).toBeCloseTo(last.x, 6);
    expect(first.cp1y).toBeCloseTo(last.y, 6);
    expect(first.cp2x).toBeCloseTo(first.x, 6);
    expect(first.cp2y).toBeCloseTo(first.y, 6);
  });

  it('boxes each wedge to itself, not to the whole circle', () => {
    // A slice whose box was the pie would sit on top of every other one for
    // selection and for the marquee.
    const nodes = build(VOLDEMORT).filter((n: any) => n.type === 'path') as any[];
    const sliver = nodes[0];
    const big = nodes[2];
    expect(sliver.width * sliver.height).toBeLessThan(big.width * big.height);
  });

  it('writes the title once', () => {
    const titles = build(NETFLIX).filter((n: any) => n.id.endsWith('-title'));
    expect(titles).toHaveLength(1);
    expect((titles[0] as any).text).toBe('NETFLIX');
  });

  it('gives every slice a legend swatch and a row of text', () => {
    const nodes = build(VOLDEMORT);
    expect(nodes.filter((n: any) => n.id.startsWith('fixed-ls-'))).toHaveLength(3);
    expect(nodes.filter((n: any) => n.id.startsWith('fixed-lt-'))).toHaveLength(3);
  });

  it('prints the share, and the raw value only when asked', () => {
    const plain = build('pie\n  "a" : 1\n  "b" : 3').find((n: any) => n.id.includes('-lt-')) as any;
    expect(plain.text).toBe('a — 25%');
    const shown = build('pie showData\n  "a" : 1\n  "b" : 3').find((n: any) =>
      n.id.includes('-lt-')
    ) as any;
    expect(shown.text).toBe('a — 1 (25%)');
  });

  it('tags every object with the diagram id, so a regenerate finds them', () => {
    const { nodes, diagramId } = buildPieDiagram(parse(NETFLIX).chart!, { x: 0, y: 0 });
    for (const node of nodes as any[]) expect(node.diagramId).toBe(diagramId);
  });
});

describe('the legend card holds its own text', () => {
  const laid = (src: string) => layoutPie(parse(src).chart!, { originX: 0, originY: 0 });

  it('widens for a long label instead of letting it spill', () => {
    /**
     * The card was a fixed 220 units wide and the rows were composed
     * separately by each renderer, so a label like "Reviewing each other's
     * code — 18%" simply ran off the end of it. The rows are measured now and
     * the card takes the widest.
     */
    const narrow = laid('pie title T\n  "a" : 1\n  "b" : 1');
    const wide = laid(
      'pie title T\n  "Reviewing each other\'s code at great length" : 1\n  "b" : 1'
    );
    expect(wide.legendCard.width).toBeGreaterThan(narrow.legendCard.width);
  });

  it('fits every row inside the card', () => {
    const layout = laid(
      'pie title T\n  "Meetings that should have been emails" : 21\n  "Shipping" : 34\n  "x" : 2'
    );
    for (const wedge of layout.wedges) {
      const right = wedge.legend.x + wedge.legend.width;
      expect(right).toBeLessThanOrEqual(layout.legendCard.x + layout.legendCard.width);
      expect(wedge.legend.x).toBeGreaterThanOrEqual(layout.legendCard.x);
      expect(wedge.legend.y).toBeGreaterThanOrEqual(layout.legendCard.y);
      expect(wedge.legend.y + wedge.legend.height).toBeLessThanOrEqual(
        layout.legendCard.y + layout.legendCard.height
      );
    }
  });

  it('wraps rather than growing without limit', () => {
    const layout = laid(`pie title T\n  "${'a very long category name '.repeat(8)}" : 1\n  "b" : 1`);
    expect(layout.legendCard.width).toBeLessThanOrEqual(420 + 24);
    expect(layout.wedges[0].legendLines.length).toBeGreaterThan(1);
  });

  it('gives a wrapped row the extra height it needs', () => {
    // Otherwise the row below is written over it.
    const layout = laid(`pie title T\n  "${'long '.repeat(30)}" : 1\n  "b" : 1`);
    expect(layout.wedges[0].legend.height).toBeGreaterThan(layout.wedges[1].legend.height);
    expect(layout.wedges[1].legend.y).toBeGreaterThanOrEqual(
      layout.wedges[0].legend.y + layout.wedges[0].legend.height
    );
  });

  it('formats the row once, where the measuring happens', () => {
    // Both renderers read this. Composing the string separately is how the
    // text came to be wider than the box that was measured for it.
    const plain = laid('pie title T\n  "a" : 1\n  "b" : 3');
    expect(plain.wedges[0].legendLines.join(' ')).toBe('a — 25%');
    const shown = laid('pie showData title T\n  "a" : 1\n  "b" : 3');
    expect(shown.wedges[0].legendLines.join(' ')).toBe('a — 1 (25%)');
  });
});

describe('the share on the slice', () => {
  const laid = (src: string) => layoutPie(parse(src).chart!, { originX: 0, originY: 0 });

  it('writes the percentage on a slice with room for it', () => {
    const layout = laid(NETFLIX);
    expect(layout.wedges[0].sliceLabel).toBe('90%');
  });

  it('leaves a sliver clean rather than writing across its neighbours', () => {
    /**
     * Mermaid writes the number on every slice regardless, which is why a
     * mermaid pie with a 1% category has a figure lying across two other
     * wedges. The legend still carries it, so nothing is lost.
     */
    const layout = laid('pie title T\n  "big" : 99\n  "sliver" : 1');
    expect(layout.wedges[0].sliceLabel).toBe('99%');
    expect(layout.wedges[1].sliceLabel).toBe('');
    expect(layout.wedges[1].legendLines.join(' ')).toContain('1%');
  });

  it('puts the label inside the wedge, not outside the pie', () => {
    const layout = laid(VOLDEMORT);
    for (const wedge of layout.wedges) {
      const r = Math.hypot(
        wedge.centroid.x - layout.centre.x,
        wedge.centroid.y - layout.centre.y
      );
      expect(r).toBeLessThan(layout.radius);
    }
  });

  it('builds a text object only for the slices that get one', () => {
    /**
     * The diagram id is fixed rather than generated, so the ids can be matched
     * by prefix instead of by `includes('-p-')`.
     *
     * That substring was flaky about once in a few thousand runs, and it took
     * a full-suite failure that would not reproduce alone to show why:
     * `nanoid`'s alphabet contains `-`, so a *wedge* id `<id>-w-<rand>` whose
     * random tail happens to begin `p-` reads as `…-w-p-…`, which contains
     * `-p-`. The share count then came back 2 instead of 1 and the diagram was
     * entirely correct. Matching the segment we actually mean cannot collide.
     */
    const nodes = buildPieDiagram(
      parse('pie title T\n  "big" : 99\n  "sliver" : 1').chart!,
      { x: 0, y: 0 },
      'fixed'
    ).nodes;
    const shares = nodes.filter((n: any) => n.id.startsWith('fixed-p-'));
    expect(shares).toHaveLength(1);
    expect((shares[0] as any).text).toBe('99%');
  });
});
