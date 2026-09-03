import React from 'react';
import { cursorModeForTool } from './toolCursor';
import { glyphFor } from './cursorVisual';

/**
 * The badge in a pointer's tail, for the one surface that draws with React.
 *
 * ## Why this exists alongside `cursorVisual`
 *
 * The local pointer is built as a **string** and written once, because it must
 * never re-render — see `LocalCursor`. Remote pointers are the opposite case:
 * there is one per collaborator, they mount and unmount as people come and go,
 * and React is the right tool for that. Only their *positions* are written
 * outside React, through the shared presence frame loop.
 *
 * So the two surfaces legitimately draw differently. What they must not do is
 * disagree about *what a tool looks like*, and until now they did: there were
 * two glyph tables, and the local pointer read neither. `glyphFor` is the one
 * table; this component is only the React shape of it.
 *
 * ## The drawing rule
 *
 * The glyph is rendered into a 9px disc at a heavy stroke weight, so every one
 * must be two or three strokes with no small features. A lucide-weight pencil
 * became a diagonal slash in a circle — which reads as a prohibition sign — and
 * an outlined hand became a blob. Both were caught by rendering the whole set
 * at 4× and looking at it.
 */
export const ToolBadge = ({
  tool,
  fill,
  ink,
  ring = '#FFFFFF',
}: {
  /** The tool this pointer is holding. Its mode is the fallback. */
  tool?: string;
  fill: string;
  ink: string;
  ring?: string;
}) => {
  const glyph = glyphFor(tool, cursorModeForTool(tool));
  if (!glyph) return null;
  return (
    <g transform="translate(19.6 19.6)">
      <circle r="7.6" fill={fill} stroke={ring} strokeWidth={1.7} />
      <g
        transform="translate(-4.55 -4.55) scale(0.379)"
        fill="none"
        stroke={ink}
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
        // The one table, shared with the local pointer. Markup rather than
        // elements because that is what `cursorVisual` needs to build a string,
        // and two representations of one drawing is how they drifted before.
        dangerouslySetInnerHTML={{ __html: glyph }}
      />
    </g>
  );
};
