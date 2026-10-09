import { describe, it, expect } from 'vitest';
import { contentsLine, MAX_DESCRIPTION, MAX_TITLE, truncate, unfurlCopy } from './unfurl';
import { cardFrames, cardPayload } from './shareCard';

describe('unfurlCopy', () => {
  it('describes a board by name, contents and what the link allows', () => {
    const copy = unfurlCopy({ facts: { name: 'Q3 retro', total: 128 }, access: 'editor' });
    expect(copy.title).toBe('Q3 retro | Vega Studio');
    expect(copy.description).toBe('128 objects on the board. Open it to draw, write and comment together, live, on Vega Studio.');
    expect(copy.facts).toEqual([
      { label: 'On the board', value: '128 objects on the board' },
      { label: 'This link', value: 'Can edit' },
    ]);
  });

  it('invites a viewer to look around rather than to edit', () => {
    expect(unfurlCopy({ facts: { name: 'Plan', total: 1 }, access: 'viewer' }).description).toContain('look around');
  });

  it('leaks nothing when the board cannot be described', () => {
    const copy = unfurlCopy({ facts: null, access: 'editor', framed: true });
    expect(copy.title).toBe('A frame on a Vega Studio board');
    expect(JSON.stringify(copy)).not.toMatch(/object|Sprint|Q3/);
    expect(copy.facts).toEqual([{ label: 'This link', value: 'Can edit' }]);
    expect(unfurlCopy({ facts: null, access: null }).facts).toEqual([]);
  });

  it('names a frame ahead of its board', () => {
    const copy = unfurlCopy({ facts: { name: 'Q3 retro', total: 2, frame: { name: 'Goals', icon: '🎯' } }, access: 'commenter' });
    expect(copy.title).toBe('🎯 Goals · Q3 retro | Vega Studio');
    expect(copy.facts[0]).toEqual({ label: 'Frame', value: 'Goals' });
    expect(copy.facts[1].value).toBe('Can comment');
  });

  it('keeps titles and descriptions inside what unfurlers show', () => {
    const name = 'Quarterly planning for the platform, data, design and growth teams across every region';
    const copy = unfurlCopy({ facts: { name, total: 5, frame: { name: name } }, access: 'editor' });
    expect(Array.from(copy.title).length).toBeLessThanOrEqual(MAX_TITLE);
    expect(copy.title.endsWith('… | Vega Studio')).toBe(true);
    expect(Array.from(copy.description).length).toBeLessThanOrEqual(MAX_DESCRIPTION);
  });
});

describe('truncate', () => {
  it('cuts at a word and never splits an emoji', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('one two three four', 12)).toBe('one two…');
    expect(Array.from(truncate('🎯'.repeat(20), 5))).toHaveLength(5);
  });

  it('counts the board in words', () => {
    expect(contentsLine(0)).toBe('An empty board');
    expect(contentsLine(1)).toBe('1 object on the board');
    expect(contentsLine(12345)).toBe('12,345 objects on the board');
  });
});

describe('card frames', () => {
  it('sends titled, visible frames in reading order, and none for a hidden board', () => {
    const nodes = [
      { id: 'b', type: 'frame', title: 'Second', x: 0, y: 500 },
      { id: 'a', type: 'frame', title: '  First  ', icon: '🎯', x: 0, y: 0 },
      { id: 'c', type: 'frame', title: '', x: 0, y: 900 },
      { id: 'd', type: 'frame', title: 'Hidden', hidden: true, x: 0, y: 0 },
      { id: 'e', type: 'sticky', title: 'Not a frame', x: 0, y: 0 },
    ];
    const frames = cardFrames(nodes);
    expect(frames).toEqual([{ id: 'a', name: 'First', icon: '🎯' }, { id: 'b', name: 'Second' }]);
    const preview = { ratio: 1, total: 2, items: [] };
    expect(cardPayload('Board', preview, false, frames).preview?.frames).toEqual(frames);
    expect(cardPayload('Board', preview, true, frames).preview).toBeNull();
    expect(cardPayload('Board', preview, false).preview).not.toHaveProperty('frames');
  });
});
