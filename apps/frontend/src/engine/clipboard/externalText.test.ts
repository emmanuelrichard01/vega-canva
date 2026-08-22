import { describe, it, expect } from 'vitest';
import {
  sanitizeExternalText,
  calculatePastedTextGeometry,
  createPastedTextNode,
  DEFAULT_PARAGRAPH_PASTE_WIDTH,
} from './externalText';

describe('sanitizeExternalText', () => {
  it('normalizes Windows and Mac newlines to unix LF', () => {
    const input = 'First line\r\nSecond line\rThird line\nFourth line';
    expect(sanitizeExternalText(input)).toBe('First line\nSecond line\nThird line\nFourth line');
  });

  it('converts non-breaking spaces to standard spaces', () => {
    const input = 'Hello\u00A0World\u00A0from\u00A0Word';
    expect(sanitizeExternalText(input)).toBe('Hello World from Word');
  });

  it('strips zero-width characters and BOM', () => {
    const input = '\uFEFFHello\u200B\u200C\u200DWorld';
    expect(sanitizeExternalText(input)).toBe('HelloWorld');
  });

  it('replaces tabs with double spaces for layout consistency', () => {
    const input = '\tconst a = 1;';
    expect(sanitizeExternalText(input)).toBe('  const a = 1;');
  });

  it('trims leading and trailing blank lines while preserving inner structure', () => {
    const input = '\n\nHeader\n\nParagraph with\nmultiple lines.\n\n';
    expect(sanitizeExternalText(input)).toBe('Header\n\nParagraph with\nmultiple lines.');
  });
});

describe('calculatePastedTextGeometry', () => {
  it('assigns auto-width (resize: width) to short single-line labels', () => {
    const geometry = calculatePastedTextGeometry('Short title');
    expect(geometry.resize).toBe('width');
    expect(geometry.width).toBeGreaterThan(0);
    expect(geometry.height).toBeGreaterThan(0);
  });

  it('assigns auto-height (resize: height) with standard paragraph width to multi-line text', () => {
    const text = 'First line of documentation.\nSecond line of documentation.\nThird line of prose.';
    const geometry = calculatePastedTextGeometry(text);
    expect(geometry.resize).toBe('height');
    expect(geometry.width).toBe(DEFAULT_PARAGRAPH_PASTE_WIDTH);
    expect(geometry.height).toBeGreaterThan(24);
  });

  it('assigns auto-height to very long single-line prose that exceeds reading width', () => {
    const longProse =
      'This is an exceptionally long paragraph copied from an external article that should wrap cleanly rather than extending indefinitely across the canvas as a giant single line.';
    const geometry = calculatePastedTextGeometry(longProse);
    expect(geometry.resize).toBe('height');
    expect(geometry.width).toBe(DEFAULT_PARAGRAPH_PASTE_WIDTH);
  });
});

describe('createPastedTextNode', () => {
  it('returns null for empty or whitespace-only strings', () => {
    expect(createPastedTextNode('', { x: 100, y: 100 })).toBeNull();
    expect(createPastedTextNode('   \n\t  ', { x: 100, y: 100 })).toBeNull();
  });

  it('creates a complete TextNode with proper positioning', () => {
    const node = createPastedTextNode('Hello World', { x: 200, y: 300 });
    expect(node).not.toBeNull();
    if (!node) throw new Error('Expected node to be created');

    expect(node.type).toBe('text');
    expect(node.text).toBe('Hello World');
    expect(node.typography).toBeDefined();
    expect(node.width).toBeGreaterThan(0);
    expect(node.height).toBeGreaterThan(0);
    expect(node.id).toBeDefined();
  });
});
