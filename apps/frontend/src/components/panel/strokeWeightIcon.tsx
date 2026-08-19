import React from 'react';

/**
 * A line drawn at the weight it represents.
 *
 * ## Why not a dash
 *
 * It was `Minus` — a hairline dash — sitting on the same rail as the sketch
 * control, whose "off" specimen is also a straight line, and, on a line
 * object, next to the shape swapper whose glyph for `line` is a third straight
 * line. Three buttons wearing the same mark is worse than three unclear ones:
 * it does not merely fail to say what each does, it actively says they do the
 * same thing, and the only way to find out is to press all three.
 *
 * Drawing the actual weight fixes it twice over. It is instantly distinct — a
 * 12px stroke is a fat bar where the others are hairlines — and it is
 * *self-describing*, which no fixed glyph can be: the button shows the answer
 * it currently holds, the way the shape swapper shows the current shape and
 * the end picker shows the current caps.
 */
const W = 18;
const H = 16;

export const StrokeWeightIcon: React.FC<{ width: number }> = ({ width }) => {
  // Clamped so a hairline is still visible and a heavy stroke still fits the
  // glyph box. The number beside it carries the exact value; this carries the
  // *impression*, which is what a glance is for.
  const drawn = Math.max(1, Math.min(H - 4, width));
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <rect
        x="1"
        y={(H - drawn) / 2}
        width={W - 2}
        height={drawn}
        rx={Math.min(drawn / 2, 2)}
        fill="currentColor"
      />
    </svg>
  );
};
