import { describe, expect, it } from 'vitest';
import { DEFAULT_TYPOGRAPHY } from '../model/schema';
import { applyFormat, detectListShortcut, formatCommandFor, stepFontSize } from './textShortcuts';

const chord = (
  key: string,
  mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean; code: string }> = {}
) => ({
  key,
  code: mods.code,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe('detectListShortcut', () => {
  it('turns a leading "- " or "1. " into a list and strips it', () => {
    expect(detectListShortcut('- ', 2, undefined)).toEqual({ list: 'bullet', value: '', caret: 0 });
    expect(detectListShortcut('1. buy milk', 3, undefined)).toEqual({ list: 'number', value: 'buy milk', caret: 0 });
  });

  it('leaves mid-sentence dashes and existing lists alone', () => {
    expect(detectListShortcut('a - ', 4, undefined)).toBeNull();
    expect(detectListShortcut('x\n- ', 4, undefined)).toBeNull();
    expect(detectListShortcut('- ', 2, 'bullet')).toBeNull();
  });
});

describe('formatCommandFor', () => {
  it('maps the familiar chords', () => {
    expect(formatCommandFor(chord('b', { meta: true }))).toBe('bold');
    expect(formatCommandFor(chord('i', { ctrl: true }))).toBe('italic');
    expect(formatCommandFor(chord('X', { meta: true, shift: true }))).toBe('strikethrough');
    expect(formatCommandFor(chord('*', { meta: true, shift: true, code: 'Digit8' }))).toBe('bullets');
    expect(formatCommandFor(chord('>', { meta: true, shift: true, code: 'Period' }))).toBe('grow');
  });

  it('ignores unmodified keys and Alt chords', () => {
    expect(formatCommandFor(chord('b'))).toBeNull();
    expect(formatCommandFor(chord('b', { meta: true, alt: true }))).toBeNull();
  });
});

describe('applyFormat', () => {
  it('toggles weight and lists, and steps size along the ramp', () => {
    const bold = applyFormat({ ...DEFAULT_TYPOGRAPHY, fontWeight: 400 }, 'bold');
    expect(bold.fontWeight).toBe(700);
    expect(applyFormat(bold, 'bold').fontWeight).toBe(400);
    const listed = applyFormat(DEFAULT_TYPOGRAPHY, 'bullets');
    expect(listed.list).toBe('bullet');
    expect(applyFormat(listed, 'bullets').list).toBeUndefined();
    expect(stepFontSize(15, 1)).toBe(16);
    expect(stepFontSize(15, -1)).toBe(14);
    expect(stepFontSize(8, -1)).toBe(8);
  });
});
