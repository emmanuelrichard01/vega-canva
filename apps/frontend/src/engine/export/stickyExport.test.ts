import { describe, expect, it } from 'vitest';
import { isDarkExportBackground, stickyToSvg } from './stickyExport';
import { foldedPaperPath, foldSize, flapPath, flapPlacement } from '../model/stickyFold';
import { paperOf, STICKY_RADIUS } from '../model/stickyThemes';
import { roughStickyPaper } from '../model/roughNodes';
import type { StickyNode } from '../model/schema';

function note(extra: Partial<StickyNode> = {}): StickyNode {
  return {
    id: 'note-1',
    type: 'sticky',
    x: 40,
    y: 60,
    width: 200,
    height: 200,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: 1,
    text: 'Ship it',
    theme: 'yellow',
    fontSize: 16,
    author: { id: 'a', name: 'Ada Lovelace', color: '#7C3AED' },
    reactions: {},
    tags: [],
    pinned: false,
    createdAt: 0,
    ...extra,
  } as StickyNode;
}

describe('a sticky in an SVG file', () => {
  it('is the folded sheet the canvas draws, with its flap and both shadows', () => {
    const svg = stickyToSvg(note(), { transform: '' });
    const fold = foldSize(200, 200);
    expect(svg).toContain(`d="${foldedPaperPath(200, 200, STICKY_RADIUS, fold)}"`);
    expect(svg).toContain(`d="${flapPath(flapPlacement(200, 200, fold).half)}"`);
    // Contact and ambient, merged, under the sheet; one more under the flap.
    expect(svg.match(/<feGaussianBlur/g)).toHaveLength(3);
    expect(svg).toContain(`fill="${paperOf('yellow', false).bg}"`);
    expect(svg).toContain('Ship it');
  });

  it('keeps one shadow for a translucent note, as the canvas does', () => {
    const svg = stickyToSvg(note({ opacity: 0.5 }), { transform: '' });
    expect(svg.match(/<feGaussianBlur/g)).toHaveLength(2);
  });

  it('draws the hand-cut paper and flap in sketch mode', () => {
    const n = note();
    const svg = stickyToSvg(n, { sketch: 'heavy', transform: '' });
    const rough = roughStickyPaper(n, 'heavy');
    expect(svg).toContain(`d="${rough.silhouette}"`);
    expect(svg).toContain(`d="${rough.flap.silhouette}"`);
    expect(svg).toContain(`d="${rough.flap.outline}"`);
  });

  it('casts the sheet shadow outside the rotation, so it falls down the page', () => {
    const svg = stickyToSvg(note(), { transform: ' transform="rotate(10 140 160)"' });
    expect(svg).toMatch(/<g filter="url\(#st-note-1-shadow\)"><g transform="rotate\(10 140 160\)">/);
  });

  it('escapes what people write, and the ids built from a node id', () => {
    const svg = stickyToSvg(note({ id: 'x"><script>', text: '<script>alert(1)</script> & "quotes"', tags: ['<b>'] }), {
      transform: '',
    });
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toMatch(/id="[^"]*[<>][^"]*"/);
  });

  it('draws the dark-board paper on a dark background only', () => {
    expect(isDarkExportBackground('ink')).toBe(true);
    expect(isDarkExportBackground('#101014')).toBe(true);
    expect(isDarkExportBackground('paper')).toBe(false);
    expect(isDarkExportBackground('transparent')).toBe(false);
    expect(isDarkExportBackground(undefined)).toBe(false);
    expect(isDarkExportBackground('#FAFAF7')).toBe(false);
    const svg = stickyToSvg(note(), { transform: '', darkBoard: true });
    expect(svg).toContain(`fill="${paperOf('yellow', true).bg}"`);
  });

  it('leaves a note too small to fold uncut', () => {
    const svg = stickyToSvg(note({ width: 40, height: 40, text: '' }), { transform: '' });
    expect(svg).toContain(`d="${foldedPaperPath(40, 40, STICKY_RADIUS, 0)}"`);
    expect(svg).not.toContain('flapshadow');
  });
});
