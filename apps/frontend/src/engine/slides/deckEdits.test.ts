import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNode, objectsMap, readAllNodes, readNode } from '../document';
import { setRoomRole } from '../model/permissions';
import { useStore } from '../../hooks/useStore';
import type { AnyNode } from '../model/schema';
import { deckOf } from './deck';
import { duplicateSlides, moveSlides, setSlidesHidden } from './deckEdits';
import { insertLayoutSlide } from './insertSlide';
import { layoutNodes } from './layouts';
import { DEFAULT_THEME } from './themes';

/**
 * The deck's writes, against the real document. Nothing is mocked: the
 * frames are created in the CRDT and the store is pointed at what it holds.
 */

const sync = () => useStore.setState({ objects: readAllNodes() as unknown as Record<string, AnyNode> });

const slide = (title: string, x: number) =>
  createNode({ type: 'frame', x, y: 0, width: 1920, height: 1080, title, appearance: { fill: [{ type: 'solid', color: '#FFFFFF', opacity: 1 }] } });

beforeEach(() => {
  setRoomRole('editor');
  Array.from(objectsMap.keys()).forEach((k) => objectsMap.delete(k));
  sync();
});
afterEach(() => setRoomRole('editor'));

describe('inserting a slide from a layout', () => {
  it('creates the frame and its contents, beside its neighbour and next in the deck', () => {
    const a = slide('A', 0);
    const b = slide('B', 2080);
    sync();

    const id = insertLayoutSlide('content', DEFAULT_THEME, a, 'Agenda');
    expect(id).toBeTruthy();
    const made = readNode(id!)!;
    expect(made.type).toBe('frame');
    // Its own spot is taken by B, so it goes past it.
    expect(made.x).toBe(4160);
    expect([readNode(a)!.slideOrder, made.slideOrder, readNode(b)!.slideOrder]).toEqual([0, 1, 2]);

    const children = Object.values(readAllNodes()).filter((n) => n.frameId === id);
    expect(children).toHaveLength(layoutNodes('content', { x: 0, y: 0, width: 1920, height: 1080 }, DEFAULT_THEME).length);

    sync();
    expect(deckOf(useStore.getState().objects).map((s) => s.frame.title)).toEqual(['A', 'Agenda', 'B']);
  });

  it('is refused for a viewer, who can present but not edit', () => {
    slide('A', 0);
    sync();
    setRoomRole('viewer');
    const before = objectsMap.size;
    expect(insertLayoutSlide('title', DEFAULT_THEME, null, 'Nope')).toBeNull();
    expect(objectsMap.size).toBe(before);
  });
});

describe('editing the deck', () => {
  it('duplicates a slide and its contents, straight after the original', () => {
    const a = slide('A', 0);
    createNode({ type: 'text', x: 100, y: 100, width: 400, height: 60, text: 'Hello', typography: { fontSize: 40 } });
    const b = slide('B', 2080);
    sync();

    const [copy] = duplicateSlides([a]);
    expect(copy).toBeTruthy();
    expect(Object.values(readAllNodes()).filter((n) => n.frameId === copy).map((n) => n.text)).toEqual(['Hello']);
    sync();
    expect(deckOf(useStore.getState().objects).map((s) => s.frame.id)).toEqual([a, copy, b]);
  });

  it('moves a selection of slides as one block, and skips slides without removing them', () => {
    const ids = ['A', 'B', 'C', 'D'].map((t, i) => slide(t, i * 2080));
    sync();
    moveSlides(new Set([ids[0], ids[2]]), 4);
    sync();
    expect(deckOf(useStore.getState().objects).map((s) => s.frame.title)).toEqual(['B', 'D', 'A', 'C']);

    setSlidesHidden([ids[1]], true);
    sync();
    const deck = deckOf(useStore.getState().objects);
    expect(deck).toHaveLength(4);
    expect(deck.find((s) => s.frame.id === ids[1])?.number).toBeNull();
    setSlidesHidden([ids[1]], false);
    expect(readNode(ids[1])!.slideHidden).toBeUndefined();
  });
});
