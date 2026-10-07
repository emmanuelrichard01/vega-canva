import React from 'react';
import { HAND_OPEN } from '../../engine/cursor/cursorVisual';

/**
 * The Hand tool's glyph.
 *
 * The pointer's own open hand, stroked rather than filled, so the seat and the
 * cursor it gives you are one drawing (see `HAND_OPEN`). Drawn on lucide's
 * grid (24 units, 2-unit stroke, round joins), so it sits in the dock's row at
 * the same weight as the glyphs beside it. The thumb and the little finger
 * balance each other, so the hand is centred as drawn.
 */
export const HandIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ display: 'block', flexShrink: 0 }}
  >
    <path d={HAND_OPEN} />
  </svg>
);
