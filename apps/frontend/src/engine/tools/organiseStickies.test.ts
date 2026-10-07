import { describe, expect, it } from 'vitest';
import type { StickyNode, StickyTheme } from '../model/schema';
import { GROUP_GAP, NOTE_GAP, groupStickies, organiseStickies } from './organiseStickies';

function sticky(id: string, x: number, y: number, theme: StickyTheme, author = 'a'): StickyNode {
  return {
    id,
    type: 'sticky',
    x,
    y,
    width: 200,
    height: 200,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: 0,
    text: id,
    theme,
    fontSize: 16,
    author: { id: author, name: author.toUpperCase(), color: '#000' },
    reactions: {},
    tags: [],
    pinned: false,
  } as unknown as StickyNode;
}

describe('organiseStickies', () => {
  const notes = [
    sticky('p1', 900, 40, 'pink', 'b'),
    sticky('y1', 0, 0, 'yellow'),
    sticky('y2', 500, 600, 'yellow', 'b'),
    sticky('m1', 300, 300, 'mint'),
  ];

  it('groups by colour in palette order, reading order inside a group', () => {
    const groups = groupStickies(notes, 'theme');
    expect(groups.map((g) => g.key)).toEqual(['yellow', 'mint', 'pink']);
    expect(groups[0].ids).toEqual(['y1', 'y2']);
  });

  it('groups by author, largest group first', () => {
    const groups = groupStickies(notes, 'author');
    expect(groups.map((g) => g.ids.length)).toEqual([2, 2]);
    expect(groups[0].label).toBe('A');
  });

  it('lays groups side by side from the selection origin, with no overlaps', () => {
    const patches = organiseStickies(notes, 'theme');
    const pos = Object.fromEntries(patches.map((p) => [p.id, p.changes]));
    expect(pos.y1).toEqual({ x: 0, y: 0 });
    expect(pos.y2).toEqual({ x: 200 + NOTE_GAP, y: 0 });
    // Yellow is two columns wide; mint starts one group gap after it.
    expect(pos.m1.x).toBe(2 * 200 + NOTE_GAP + GROUP_GAP);
    const boxes = patches.map((p) => ({ ...p.changes, w: 200, h: 200 }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
      }
    }
  });

  it('does nothing for fewer than two notes', () => {
    expect(organiseStickies([notes[0]], 'theme')).toEqual([]);
  });
});
