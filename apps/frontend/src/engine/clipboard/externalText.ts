/**
 * External text clipboard ingestion.
 *
 * ## The problem this solves
 *
 * Pasting internal objects (diagrams, shapes, stickies) uses our JSON magic
 * envelope, and pasting vector artwork uses SVG. But pasting text from
 * external sources — Microsoft Word, Google Docs, VS Code, Slack, web browsers,
 * PDFs, or text files — had no canvas-level ingestion pathway: hitting Cmd+V / Ctrl+V
 * on an empty canvas silently dropped the text because `parseClipboard` returned null.
 *
 * This module sanitizes raw clipboard text, determines optimal point-text vs.
 * paragraph-wrapped dimensions, and constructs ready-to-mount TextNode records.
 */

import { nanoid } from 'nanoid';
import {
  DEFAULT_TYPOGRAPHY,
  type TextResize,
  type Typography,
} from '../model/schema';
import { layoutText } from '../text/layout';
import { measurerFor } from '../text/measure';
import { ThemeService } from '../ThemeService';

/** Default width for wrapped paragraph blocks pasted from external prose. */
export const DEFAULT_PARAGRAPH_PASTE_WIDTH = 460;

/** Character threshold below which single-line text defaults to auto-width (point text). */
export const POINT_TEXT_MAX_CHARS = 80;

/**
 * Sanitize text copied from external software (Word, Google Docs, VS Code, PDFs, browsers).
 *
 * - Normalizes Windows CRLF (`\r\n`) and legacy Mac CR (`\r`) to standard LF (`\n`).
 * - Converts non-breaking spaces (`\u00A0`) to standard spaces to prevent Canvas2D wrapping anomalies.
 * - Strips invisible zero-width spaces (`\u200B`, `\u200C`, `\u200D`, `\uFEFF`).
 * - Trims excessive leading/trailing blank lines while preserving indentation and inner structure.
 */
export function sanitizeExternalText(raw: string): string {
  if (!raw) return '';

  return raw
    // Normalize newlines
    .replace(/\r\n|\r/g, '\n')
    // Replace non-breaking spaces with standard ASCII space
    .replace(/\u00A0/g, ' ')
    // Strip zero-width spaces, BOM, and direction marks
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Normalize tabs to 2 spaces for consistent rendering across platforms
    .replace(/\t/g, '  ')
    // Trim leading/trailing blank lines while preserving intentional internal layout
    .replace(/^\n+|\n+$/g, '');
}

export interface PastedTextGeometry {
  resize: TextResize;
  width: number;
  height: number;
}

/**
 * Calculate the optimal geometry and resize mode for external text.
 *
 * Short single-line snippets (e.g. titles, short labels) become auto-width
 * point text (`resize: 'width'`), while multi-line prose, articles, and long paragraphs
 * wrap into a readable paragraph container (`resize: 'height'`).
 */
export function calculatePastedTextGeometry(
  text: string,
  typography: Typography = DEFAULT_TYPOGRAPHY
): PastedTextGeometry {
  const isMultiLine = text.includes('\n');
  const measure = measurerFor(typography);

  // Single-line short snippet: measure natural width and keep as auto-width point text
  if (!isMultiLine && text.length <= POINT_TEXT_MAX_CHARS) {
    const singleLayout = layoutText({
      text,
      wrap: 'none',
      fontSize: typography.fontSize,
      lineHeight: typography.lineHeight,
      letterSpacing: typography.letterSpacing,
      paragraphSpacing: typography.paragraphSpacing,
      align: typography.align,
      measure,
    });

    const naturalWidth = Math.ceil(singleLayout.width);
    if (naturalWidth <= DEFAULT_PARAGRAPH_PASTE_WIDTH) {
      return {
        resize: 'width',
        width: Math.max(40, naturalWidth),
        height: Math.max(24, Math.ceil(singleLayout.height)),
      };
    }
  }

  // Multi-line prose or long text: wrap within a standard reading width
  const targetWidth = DEFAULT_PARAGRAPH_PASTE_WIDTH;
  const wrappedLayout = layoutText({
    text,
    wrap: 'word',
    width: targetWidth,
    fontSize: typography.fontSize,
    lineHeight: typography.lineHeight,
    letterSpacing: typography.letterSpacing,
    paragraphSpacing: typography.paragraphSpacing,
    align: typography.align,
    measure,
  });

  return {
    resize: 'height',
    width: targetWidth,
    height: Math.max(24, Math.ceil(wrappedLayout.height)),
  };
}

export type PastedTextNode = {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  resize: TextResize;
  typography: Typography;
};

/**
 * Construct a ready-to-mount TextNode from external clipboard text.
 */
export function createPastedTextNode(
  rawText: string,
  position: { x: number; y: number },
  typographyOverride?: Partial<Typography>
): PastedTextNode | null {
  const text = sanitizeExternalText(rawText);
  if (!text.trim()) return null;

  const typography: Typography = {
    ...DEFAULT_TYPOGRAPHY,
    color: ThemeService.getDefaultTextColor(),
    ...typographyOverride,
  };

  const { resize, width, height } = calculatePastedTextGeometry(text, typography);

  return {
    id: nanoid(),
    type: 'text',
    x: position.x - (resize === 'height' ? width / 2 : 0),
    y: position.y - height / 2,
    width,
    height,
    text,
    resize,
    typography,
  };
}
