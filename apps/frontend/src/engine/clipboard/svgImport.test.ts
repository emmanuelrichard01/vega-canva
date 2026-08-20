import { describe, expect, it } from 'vitest';
import { convertSvgTree, looksLikeSvg, parsePathData, type SvgLike } from './svgImport';

/**
 * A tiny element tree, so the conversion is asserted without a DOM.
 * `DOMParser` does not exist in Node, and `convertSvgTree` takes the minimal
 * shape a real `Element` already satisfies.
 */
function el(tagName: string, attrs: Record<string, string> = {}, children: SvgLike[] = []): SvgLike {
  return {
    tagName,
    getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
    children,
  };
}

/** Stands in for `importSvg`, minus the parsing step it cannot run here. */
const importSvg = (children: SvgLike[]) => convertSvgTree(el('svg', {}, children));

/**
 * Pasted SVG becomes objects you can edit, or says what it could not convert.
 *
 * The failure this guards is the quiet one: a converter that drops what it does
 * not understand produces a picture missing pieces with nothing to say which,
 * and the person is left comparing two images by eye.
 */

describe('looksLikeSvg', () => {
  it('recognises markup with and without a prolog', () => {
    expect(looksLikeSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(true);
    expect(looksLikeSvg('  \n <SVG></SVG>')).toBe(true);
    expect(looksLikeSvg('<?xml version="1.0"?><svg></svg>')).toBe(true);
  });

  it('does not mistake ordinary text or other markup for it', () => {
    // The clipboard usually holds prose. Treating any angle bracket as SVG is
    // how pasting an HTML snippet scatters shapes across a board.
    expect(looksLikeSvg('some notes about the svg export')).toBe(false);
    expect(looksLikeSvg('<div><svg /></div>')).toBe(false);
    expect(looksLikeSvg('')).toBe(false);
  });
});

describe('parsePathData', () => {
  it('reads an absolute line run', () => {
    const { subpaths } = parsePathData('M 0 0 L 10 0 L 10 10');
    expect(subpaths).toHaveLength(1);
    expect(subpaths[0]).toHaveLength(3);
    expect(subpaths[0][2]).toEqual({ x: 10, y: 10 });
  });

  it('reads relative commands against the current point', () => {
    const { subpaths } = parsePathData('M 10 10 l 5 0 l 0 5');
    expect(subpaths[0][2]).toEqual({ x: 15, y: 15 });
  });

  it('treats a second pair after a moveto as an implicit lineto', () => {
    // Exporters emit this constantly and a parser that ignores it drops points.
    const { subpaths } = parsePathData('M 0 0 10 0 20 0');
    expect(subpaths[0]).toHaveLength(3);
  });

  it('closes a subpath back to its start', () => {
    const { subpaths } = parsePathData('M 0 0 L 10 0 L 10 10 Z');
    const run = subpaths[0];
    expect(run[run.length - 1]).toEqual({ x: 0, y: 0 });
  });

  it('splits multiple subpaths', () => {
    const { subpaths } = parsePathData('M 0 0 L 5 5 M 20 20 L 30 30');
    expect(subpaths).toHaveLength(2);
  });

  it('flattens a cubic into a curve rather than a chord', () => {
    const { subpaths } = parsePathData('M 0 0 C 0 10 10 10 10 0');
    const run = subpaths[0];
    expect(run.length).toBeGreaterThan(8);
    // The middle of the curve bows away from the straight line between its ends.
    const mid = run[Math.floor(run.length / 2)];
    expect(mid.y).toBeGreaterThan(1);
  });

  it('raises a quadratic to a cubic rather than ignoring it', () => {
    const { subpaths } = parsePathData('M 0 0 Q 5 10 10 0');
    expect(subpaths[0].length).toBeGreaterThan(8);
  });

  it('handles horizontal and vertical shorthands', () => {
    const { subpaths } = parsePathData('M 0 0 H 10 V 10');
    expect(subpaths[0][2]).toEqual({ x: 10, y: 10 });
  });

  /**
   * Arcs are consumed so parsing stays in step, and reported rather than
   * approximated — a straight line through an arc silently turns a rounded
   * corner into a chamfer.
   */
  it('reports an arc instead of quietly straightening it', () => {
    const { usedArc, subpaths } = parsePathData('M 0 0 A 5 5 0 0 1 10 10');
    expect(usedArc).toBe(true);
    // And it did not lose its place: the endpoint is still right.
    expect(subpaths[0][subpaths[0].length - 1]).toEqual({ x: 10, y: 10 });
  });

  it('terminates on malformed data rather than looping', () => {
    expect(() => parsePathData('M 0 0 ? 5 5 L 10 10')).not.toThrow();
    expect(() => parsePathData('')).not.toThrow();
  });

  it('parses numbers written without separators', () => {
    // `10-5` is two numbers; the minus does the separating.
    const { subpaths } = parsePathData('M0 0L10-5');
    expect(subpaths[0][1]).toEqual({ x: 10, y: -5 });
  });
});

describe('convertSvgTree', () => {
  it('converts a rectangle, keeping its box', () => {
    const art = importSvg([el('rect', { x: '10', y: '20', width: '30', height: '40', fill: '#F3A024' })])!;
    expect(art.nodes).toHaveLength(1);
    expect(art.nodes[0].width).toBe(30);
    expect(art.nodes[0].height).toBe(40);
    expect((art.nodes[0].geometry as { kind: string }).kind).toBe('rect');
  });

  it('converts a circle into an ellipse on its own box', () => {
    const art = importSvg([el('circle', { cx: '50', cy: '50', r: '20' })])!;
    expect(art.nodes[0].width).toBe(40);
    expect((art.nodes[0].geometry as { kind: string }).kind).toBe('ellipse');
  });

  it('normalises the artwork to its own origin', () => {
    // Otherwise a paste lands at whatever coordinates the exporting tool used,
    // which for a Figma frame is routinely thousands of units from anything.
    const art = importSvg([el('rect', { x: '900', y: '700', width: '10', height: '10' })])!;
    expect(art.nodes[0].x).toBe(0);
    expect(art.nodes[0].y).toBe(0);
  });

  it('measures the artwork from its contents', () => {
    const art = importSvg([
      el('rect', { x: '0', y: '0', width: '10', height: '10' }),
      el('rect', { x: '40', y: '30', width: '10', height: '10' }),
    ])!;
    expect(art.width).toBe(50);
    expect(art.height).toBe(40);
  });

  /**
   * `fill="none"` is a real value meaning "do not paint", and it is not the
   * same as an absent fill, which means black. Treating them alike is how an
   * outlined rectangle arrives filled solid.
   */
  it('tells an unfilled shape from one with no fill attribute', () => {
    const none = importSvg([el('rect', { width: '10', height: '10', fill: 'none', stroke: '#161616' })])!;
    expect((none.nodes[0].appearance as { fill: unknown[] }).fill).toHaveLength(0);

    const absent = importSvg([el('rect', { width: '10', height: '10' })])!;
    expect((absent.nodes[0].appearance as { fill: unknown[] }).fill).toHaveLength(1);
  });

  it('carries a stroke with its width', () => {
    const art = importSvg([el('rect', { width: '10', height: '10', stroke: '#B45309', 'stroke-width': '3' })])!;
    const stroke = (art.nodes[0].appearance as { stroke?: { color: string; width: number } }).stroke;
    expect(stroke?.color).toBe('#B45309');
    expect(stroke?.width).toBe(3);
  });

  it('falls back to a flat colour for a gradient it cannot honour', () => {
    // A shape with no paint at all is invisible, which looks like the paste
    // having failed rather than having simplified something.
    const art = importSvg([el('rect', { width: '10', height: '10', fill: 'url(#grad)' })])!;
    expect((art.nodes[0].appearance as { fill: unknown[] }).fill).toHaveLength(1);
  });

  it('closes a polygon and leaves a polyline open', () => {
    const poly = importSvg([el('polygon', { points: '0,0 10,0 10,10' })])!;
    const line = importSvg([el('polyline', { points: '0,0 10,0 10,10' })])!;
    const segments = (n: Record<string, unknown>) =>
      ((n.geometry as { svgPath: string }).svgPath.match(/L/g) ?? []).length;
    expect(segments(poly.nodes[0])).toBe(segments(line.nodes[0]) + 1);
  });

  it('walks into groups rather than ignoring their contents', () => {
    const art = importSvg([
      el('g', {}, [el('rect', { width: '10', height: '10' }), el('circle', { r: '5' })]),
    ])!;
    expect(art.nodes).toHaveLength(2);
  });

  it('makes one node per subpath of a compound path', () => {
    const art = importSvg([el('path', { d: 'M 0 0 L 10 0 M 20 0 L 30 0' })])!;
    expect(art.nodes).toHaveLength(2);
  });

  it('names what it could not convert', () => {
    // Text and embedded images are the two people notice missing, and being
    // told beats comparing two pictures by eye.
    const art = importSvg([
      el('rect', { width: '10', height: '10' }),
      el('text', {}),
    ])!;
    expect(art.skipped).toContain('text');
    expect(art.nodes).toHaveLength(1);
  });

  it('reports an arc it could not convert faithfully', () => {
    const art = importSvg([el('path', { d: 'M 0 0 A 5 5 0 0 1 10 10' })])!;
    expect(art.skipped).toContain('arc segments');
  });

  it('reports a group transform it cannot honour', () => {
    const art = importSvg([
      el('g', { transform: 'rotate(45)' }, [el('rect', { width: '10', height: '10' })]),
    ])!;
    expect(art.skipped).toContain('transform');
  });

  it('does not report defs and titles as missing content', () => {
    const art = importSvg([
      el('title', {}),
      el('defs', {}),
      el('rect', { width: '10', height: '10' }),
    ])!;
    expect(art.skipped).toEqual([]);
  });

  it('returns null for markup with nothing convertible in it', () => {
    expect(importSvg([el('text', {})])).toBeNull();
    expect(importSvg([])).toBeNull();
  });
});
