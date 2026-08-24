import React from 'react';
import type { CursorMode } from './toolCursor';
import { glyphForTool } from './cursorArtData';

/**
 * The badge in the arrow's tail, in whatever colours the caller needs.
 *
 * Small and set back on purpose. The first attempt made it two thirds the size
 * of the arrow, which read as two icons colliding rather than as one pointer
 * that knows what it is holding. The arrow never changes shape, so the hotspot
 * never appears to move when a tool changes.
 */
export const ToolBadge = ({
  mode,
  tool,
  fill,
  ink,
  ring,
}: {
  mode: CursorMode;
  /** Optional: lets a tool override its mode's glyph. */
  tool?: string;
  fill: string;
  ink: string;
  ring: string;
}) => {
  const glyph = glyphForTool(tool, mode);
  if (!glyph) return null;
  return (
    <g transform="translate(20 20)">
      <circle cx="0" cy="0" r="7.4" fill={fill} />
      <circle cx="0" cy="0" r="7.4" fill="none" stroke={ring} strokeWidth={1.6} />
      <g
        transform="translate(-4.6 -4.6) scale(0.383)"
        stroke={ink}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {glyph}
      </g>
    </g>
  );
};
