import { beforeEach, describe, expect, it, vi } from 'vitest';

const nodes = new Map<string, Record<string, unknown>>();
let editor = true;
const answers: Array<Record<string, unknown>> = [];

vi.mock('../document', () => ({
  createNode: (input: Record<string, unknown>) => {
    if (!editor) return '';
    nodes.set(input.id as string, input);
    return input.id as string;
  },
  deleteNode: (id: string) => void nodes.delete(id),
  readNode: (id: string) => nodes.get(id) ?? null,
  doc: { transact: (fn: () => void) => fn() },
}));
vi.mock('../model/permissions', () => ({ canEditObjects: () => editor }));
vi.mock('../CameraSystem', () => ({ cameraSystem: { screenToWorld: () => ({ x: 0, y: 0 }) } }));
vi.mock('../link/linkFetch', () => ({ fetchLinkPreview: async () => answers.shift() ?? { error: 'nope' } }));

import { insertImageFromUrl, replaceLinkWithImage, storedPicture } from './imageFromUrl';

const picture = { type: 'image', image: 'https://api.test/rooms/r/media/a.png', imageWidth: 1600, imageHeight: 900 };

beforeEach(() => {
  nodes.clear();
  answers.length = 0;
  editor = true;
  (globalThis as { window?: unknown }).window = { innerWidth: 1000, innerHeight: 800 };
});

describe('storedPicture', () => {
  it('accepts only a picture the server stored over http(s)', () => {
    expect(storedPicture(picture)).toBe(picture.image);
    expect(storedPicture({ type: 'article', image: picture.image })).toBeNull();
    expect(storedPicture({ type: 'image', image: 'javascript:alert(1)' })).toBeNull();
    expect(storedPicture(undefined)).toBeNull();
  });
});

describe('insertImageFromUrl', () => {
  it('places the stored copy at its own proportions within the cap', async () => {
    answers.push({ meta: picture });
    const out = await insertImageFromUrl('https://example.com/a.png');
    expect(out.ok).toBe(true);
    const node = [...nodes.values()][0];
    expect(node).toMatchObject({ type: 'image', src: picture.image, width: 800, height: 450, naturalWidth: 1600 });
  });

  it('collects the second half of a two-part answer', async () => {
    answers.push({ meta: { type: 'image', imagePending: true }, pending: true }, { meta: picture });
    expect((await insertImageFromUrl('https://example.com/a.png')).ok).toBe(true);
  });

  it('says a page is not a picture, and places nothing', async () => {
    answers.push({ meta: { type: 'article', title: 'A page' } });
    const out = await insertImageFromUrl('https://example.com/page');
    expect(out).toMatchObject({ ok: false, kind: 'not-image' });
    expect(nodes.size).toBe(0);
  });

  it('refuses for non-editors without asking the server', async () => {
    editor = false;
    answers.push({ meta: picture });
    expect(await insertImageFromUrl('https://example.com/a.png')).toMatchObject({ ok: false, kind: 'read-only' });
    expect(answers).toHaveLength(1);
  });

  it('rejects something that is not an address', async () => {
    expect(await insertImageFromUrl('not a url')).toMatchObject({ ok: false, kind: 'invalid' });
  });
});

describe('replaceLinkWithImage', () => {
  it('swaps the card for the picture under the same id and centre', async () => {
    nodes.set('n1', { id: 'n1', type: 'link', x: 0, y: 0, width: 520, height: 144, link: { url: 'https://e.com/a.png' } });
    expect(await replaceLinkWithImage('n1', 'https://e.com/a.png', picture)).toBe(true);
    const node = nodes.get('n1')!;
    expect(node.type).toBe('image');
    expect((node.x as number) + (node.width as number) / 2).toBeCloseTo(260, 0);
  });

  it('leaves a card that was pointed elsewhere meanwhile', async () => {
    nodes.set('n1', { id: 'n1', type: 'link', x: 0, y: 0, width: 520, height: 144, link: { url: 'https://e.com/other' } });
    expect(await replaceLinkWithImage('n1', 'https://e.com/a.png', picture)).toBe(false);
    expect(nodes.get('n1')!.type).toBe('link');
  });
});
