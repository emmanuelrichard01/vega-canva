import { describe, expect, it } from 'vitest';
import { caretAt, layoutText } from './layout';

describe('layoutText', () => {
  const dummyMeasure = (text: string) => text.length * 10;

  it('lays out left-aligned text', () => {
    const layout = layoutText({
      text: 'Hello world',
      wrap: 'word',
      width: 200,
      fontSize: 16,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: 'left',
      measure: dummyMeasure,
    });

    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0].x).toBe(0);
    expect(layout.lines[0].text).toBe('Hello world');
    expect(layout.lines[0].words).toBeUndefined();
  });

  it('computes justified word spacing on non-terminal lines of a paragraph', () => {
    // 2 lines: "The quick brown" and "fox jumps"
    const layout = layoutText({
      text: 'The quick brown fox jumps',
      wrap: 'word',
      width: 170,
      fontSize: 16,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: 'justify',
      measure: dummyMeasure,
    });

    expect(layout.lines.length).toBeGreaterThan(1);
    const firstLine = layout.lines[0];
    expect(firstLine.endsParagraph).toBe(false);
    expect(firstLine.words).toBeDefined();
    expect(firstLine.words!.length).toBeGreaterThan(1);

    // The first word starts at 0
    expect(firstLine.words![0].x).toBe(0);
    // The last word ends at boxWidth (170)
    const lastWord = firstLine.words![firstLine.words!.length - 1];
    expect(lastWord.x + lastWord.width).toBeCloseTo(170, 1);

    // The last line of the paragraph is not justified across the full box
    const lastLine = layout.lines[layout.lines.length - 1];
    expect(lastLine.endsParagraph).toBe(true);
    expect(lastLine.words).toBeUndefined();
  });

  it('maps carets accurately on justified lines with caretAt', () => {
    const layout = layoutText({
      text: 'The quick brown fox jumps',
      wrap: 'word',
      width: 170,
      fontSize: 16,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: 'justify',
      measure: dummyMeasure,
    });

    const firstLine = layout.lines[0];
    // Point at the start of the first word
    const caretStart = caretAt(layout, { x: 0, y: 5 }, dummyMeasure, 0);
    expect(caretStart).toBe(0);

    // Point on the last word of the justified line
    const lastWord = firstLine.words![firstLine.words!.length - 1];
    const caretLastWord = caretAt(layout, { x: lastWord.x + 5, y: 5 }, dummyMeasure, 0);
    expect(caretLastWord).toBeGreaterThanOrEqual(lastWord.charStart);
  });
});
