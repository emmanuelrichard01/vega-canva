import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';

// `doc.ts` opens a socket at import time; only that module is replaced.
vi.mock('./doc', async () => {
  const Yjs = await import('yjs');
  const doc = new Yjs.Doc();
  return { doc, fontsMap: doc.getMap('fonts') };
});

const { groupBoardFonts, listBoardFonts, normalizeBoardFont, putBoardFont, registerBoardFont, readBoardFonts } = await import('./fonts');
const { setRoomRole } = await import('../model/permissions');

const face = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  family: 'Brand Sans',
  style: 'Regular',
  weight: 400,
  italic: false,
  url: `https://api.test/rooms/r/media/${id}.woff2`,
  format: 'woff2' as const,
  sizeBytes: 100,
  uploadedAt: 1,
  ...extra,
});

describe('board font registry', () => {
  it('converges when two people upload at the same moment', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    putBoardFont(a.getMap('fonts'), face('one'));
    putBoardFont(b.getMap('fonts'), face('two', { style: 'Bold', weight: 700 }));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const listA = listBoardFonts(a.getMap('fonts'));
    const listB = listBoardFonts(b.getMap('fonts'));
    expect(listA).toEqual(listB);
    expect(listA.map((f) => f.style)).toEqual(['Regular', 'Bold']);
  });

  it('keeps one file per face, the same one on every client', () => {
    const fams = groupBoardFonts(
      [face('b', { uploadedAt: 2 }), face('a', { uploadedAt: 1 })].map((f) => normalizeBoardFont(f)!).sort((x, y) => x.id.localeCompare(y.id))
    );
    expect(fams).toHaveLength(1);
    expect(fams[0].faces).toHaveLength(1);
    expect(fams[0].faces[0].source).toEqual({ kind: 'url', url: 'https://api.test/rooms/r/media/a.woff2', format: 'woff2' });
  });

  it('refuses entries that could inject into CSS', () => {
    expect(normalizeBoardFont(face('x', { url: 'javascript:alert(1)' }))).toBeNull();
    expect(normalizeBoardFont(face('x', { format: 'svg' }))).toBeNull();
    expect(normalizeBoardFont(face('x', { family: `A'};x{` }))?.family).toBe('Ax');
  });

  it('lets only editors add fonts', () => {
    setRoomRole('viewer');
    expect(registerBoardFont(face('v'))).toBe(false);
    expect(readBoardFonts()).toHaveLength(0);
    setRoomRole('editor');
    expect(registerBoardFont(face('e'))).toBe(true);
    expect(readBoardFonts().map((f) => f.id)).toEqual(['e']);
  });
});
