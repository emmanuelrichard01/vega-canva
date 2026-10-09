// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Template } from '../../engine/templates/templates';

vi.mock('./boardSvg', () => ({
  renderBoardSvg: async () => ({ svg: '<svg/>', bounds: { x: 0, y: 0, width: 1, height: 1 }, objectCount: 0 }),
}));

const { coverUrl, cachedCover, drawnCover } = await import('./templatePicture');

describe('cover cache', () => {
  it('draws a template once and then answers from memory', async () => {
    let n = 0;
    URL.createObjectURL = () => `blob:cover-${++n}`;
    const build = vi.fn(() => []);
    const template = { id: 'cache-a', category: 'systems', name: 'A', blurb: '', teaches: [], build } as Template;

    expect(drawnCover(template)).toBeUndefined();
    const [first, again] = [coverUrl(template), coverUrl(template)];
    expect(cachedCover(template)).toBe(first);
    expect(again).toBe(first);
    const url = await first;
    expect(build).toHaveBeenCalledTimes(1);
    expect(await coverUrl(template)).toBe(url);
    expect(drawnCover(template)).toBe(url);
    expect(build).toHaveBeenCalledTimes(1);
  });
});
