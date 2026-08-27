import { describe, expect, it } from 'vitest';
import { splitShortcut } from './tooltipShortcut';

/**
 * The tip's label/accelerator split.
 *
 * Roughly half the `data-tooltip` strings in this app end in a parenthesised
 * shortcut, because the attribute is one string and there was nowhere else to
 * put it. Lifting it out lets it be set as a key rather than as prose — but
 * only when it really is one, and "is this a shortcut or a parenthetical" is
 * exactly the kind of judgement that is cheap to assert and expensive to eyeball
 * across a hundred call sites.
 */
describe('splitShortcut', () => {
  it('lifts a modifier accelerator out of the label', () => {
    expect(splitShortcut('Undo (Ctrl+Z)')).toEqual({ text: 'Undo', shortcut: 'Ctrl+Z' });
  });

  it('handles a two-modifier accelerator', () => {
    expect(splitShortcut('Redo (Ctrl+Shift+Z)')).toEqual({
      text: 'Redo',
      shortcut: 'Ctrl+Shift+Z',
    });
  });

  it('lifts a bare single key', () => {
    expect(splitShortcut('Shortcuts and help (?)')).toEqual({
      text: 'Shortcuts and help',
      shortcut: '?',
    });
  });

  it('lifts a named key', () => {
    expect(splitShortcut('Dismiss (Esc)')).toEqual({ text: 'Dismiss', shortcut: 'Esc' });
  });

  /**
   * The case the whole regex exists to get right. A trailing parenthesis is
   * not automatically an accelerator, and treating one as a key would put a
   * sentence fragment in a keycap.
   */
  it('leaves a prose parenthetical alone', () => {
    const prose = 'Radar (the whole board)';
    expect(splitShortcut(prose)).toEqual({ text: prose });
  });

  it('leaves a label with no parenthesis alone', () => {
    expect(splitShortcut('Comments')).toEqual({ text: 'Comments' });
  });

  /**
   * A tip that is *only* an accelerator has no label to keep. Splitting it
   * would leave an empty span beside the key, so the whole string stays put.
   */
  it('keeps a parenthesis that is not at the end', () => {
    const s = 'Copy (PNG) to clipboard';
    expect(splitShortcut(s)).toEqual({ text: s });
  });

  it('does not treat a long parenthetical as a key', () => {
    const s = 'Export (everything on the board)';
    expect(splitShortcut(s)).toEqual({ text: s });
  });

  it('tolerates spacing around the modifier joiner', () => {
    expect(splitShortcut('Duplicate (Cmd + D)')).toEqual({
      text: 'Duplicate',
      shortcut: 'Cmd + D',
    });
  });
});
