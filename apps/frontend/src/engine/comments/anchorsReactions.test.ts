import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { anchorFor, anchorPoint, messageReactions, objectLabel, reactionKey, snippetOf, threadPinLabel } from './threads';

describe('fractional anchors', () => {
  const target = { x: 100, y: 100, width: 200, height: 100, rotation: 30 };

  it('round-trips a point on a rotated object', () => {
    const point = { x: 180, y: 140 };
    const anchor = anchorFor(point, target);
    const back = anchorPoint({ x: 0, y: 0, anchor }, target);
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
  });

  it('follows the object when it moves and resizes', () => {
    const anchor = { u: 0.25, v: 0.5 };
    expect(anchorPoint({ x: 0, y: 0, anchor }, { x: 500, y: 0, width: 400, height: 100 })).toEqual({ x: 600, y: 50 });
  });

  it('keeps the top-right corner for threads without an anchor', () => {
    expect(anchorPoint({ x: 0, y: 0 }, { x: 0, y: 0, width: 50, height: 20 })).toEqual({ x: 50, y: 0 });
  });
});

describe('message reactions', () => {
  it('keeps every concurrent reaction', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getMap<Y.Map<boolean>>('t').set('reactions', new Y.Map<boolean>());
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const reactionsOf = (d: Y.Doc) => d.getMap<Y.Map<boolean>>('t').get('reactions')!;
    reactionsOf(a).set(reactionKey('m1', 'thumbs', 'ana'), true);
    reactionsOf(b).set(reactionKey('m1', 'thumbs', 'ben'), true);
    reactionsOf(b).set(reactionKey('m2', 'party', 'ben'), true);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const raw = reactionsOf(a).toJSON();
    expect(messageReactions(raw, 'm1')).toEqual([{ emoji: 'thumbs', authorIds: ['ana', 'ben'] }]);
    expect(messageReactions(raw, 'm2')).toEqual([{ emoji: 'party', authorIds: ['ben'] }]);
    expect(messageReactions(reactionsOf(b).toJSON(), 'm1')).toEqual(messageReactions(raw, 'm1'));
  });

  it('takes a reaction back by deleting only that key', () => {
    const d = new Y.Doc();
    const map = d.getMap<boolean>('r');
    map.set(reactionKey('m1', 'x', 'ana'), true);
    map.set(reactionKey('m1', 'x', 'ben'), true);
    map.delete(reactionKey('m1', 'x', 'ana'));
    expect(messageReactions(map.toJSON(), 'm1')).toEqual([{ emoji: 'x', authorIds: ['ben'] }]);
  });

  it('reads nothing from an absent map', () => {
    expect(messageReactions(undefined, 'm1')).toEqual([]);
  });
});

describe('pin names', () => {
  it('names the author, the snippet and the object', () => {
    expect(
      threadPinLabel({ author: 'Ana', snippet: 'Make it bigger', onObject: 'Hero', count: 2, resolved: false, unread: true, forMe: false })
    ).toBe('Unread thread by Ana on Hero: Make it bigger, 2 messages');
    expect(
      threadPinLabel({ author: 'Ana', snippet: '', onObject: null, count: 1, resolved: true, unread: false, forMe: true })
    ).toBe('You were mentioned. Thread by Ana, 1 message, resolved');
  });

  it('shortens long text and falls back to the object kind', () => {
    expect(snippetOf('@[Dana](d1) ' + 'x'.repeat(80)).length).toBeLessThanOrEqual(40);
    expect(snippetOf('@[Dana](d1) hi')).toBe('@Dana hi');
    expect(objectLabel({ type: 'image' })).toBe('Image');
    expect(objectLabel({ type: 'frame', title: 'Cover' })).toBe('Cover');
    expect(objectLabel(null)).toBeNull();
  });
});
