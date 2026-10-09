import { describe, expect, it } from 'vitest';
import { MAX_NOTES, MAX_SECTION, normalizeNotes, normalizeSection, normalizeSlideFields, transitionOf } from './slideMeta';
import type { FrameNode } from '../model/schema';

describe('speaker notes', () => {
  it('keeps line breaks and tabs, folds Windows endings and drops other control characters', () => {
    expect(normalizeNotes('Open with the number.\r\n\tThen pause.\u0007\u0000')).toBe('Open with the number.\n\tThen pause.');
  });

  it('caps the length and trims trailing space', () => {
    const long = 'a'.repeat(MAX_NOTES + 50);
    expect(normalizeNotes(long)!.length).toBe(MAX_NOTES);
    expect(normalizeNotes('Say this.   \n\n')).toBe('Say this.');
  });

  it('stores nothing for empty, blank or non-text notes', () => {
    expect(normalizeNotes('')).toBeUndefined();
    expect(normalizeNotes(' \n\t ')).toBeUndefined();
    expect(normalizeNotes(42)).toBeUndefined();
    expect(normalizeNotes({ text: 'x' })).toBeUndefined();
  });

  it('leaves markup as plain text: it is never interpreted', () => {
    expect(normalizeNotes('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('sections', () => {
  it('are one line, collapsed and capped', () => {
    expect(normalizeSection('  The\nproblem  ')).toBe('The problem');
    expect(normalizeSection('x'.repeat(MAX_SECTION + 9))!.length).toBe(MAX_SECTION);
    expect(normalizeSection('   ')).toBeUndefined();
  });
});

describe('a frame as a slide', () => {
  it('reads only the fields it knows, in their known shapes', () => {
    expect(
      normalizeSlideFields({ notes: 'Hi', slideHidden: true, slideSection: 'Intro', transition: 'smart', other: 1 })
    ).toEqual({ notes: 'Hi', slideHidden: true, slideSection: 'Intro', transition: 'smart' });
  });

  it('drops a hostile or stale shape rather than passing it on', () => {
    expect(normalizeSlideFields({ slideHidden: 'yes', transition: 'spin', notes: ['a'], slideSection: 3 })).toEqual({});
    expect(normalizeSlideFields(null)).toEqual({});
  });

  it('arrives by gliding unless it says otherwise', () => {
    expect(transitionOf({ type: 'frame' } as FrameNode)).toBe('glide');
    expect(transitionOf({ type: 'frame', transition: 'dissolve' } as unknown as FrameNode)).toBe('dissolve');
  });
});
