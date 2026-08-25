import React, { useRef } from 'react';

/**
 * An angle, set by pointing at it.
 *
 * ## Why an angle is not a slider
 *
 * It was a bare `input type="range"` from 0 to 359, and a range is the wrong
 * shape for this quantity in two ways that both bite.
 *
 * It is **not linear** — it wraps. A slider has a left end and a right end, so
 * going from 350° to 10° means dragging the whole width of the control backwards
 * through every angle you did not want, and the two values that are two degrees
 * apart are the two furthest apart on screen.
 *
 * And it is **not abstract**. An angle has a picture, and the picture is the
 * answer: you do not want "217", you want *that way*. A dial you point costs one
 * gesture and no arithmetic, which is why every tool that asks for a rotation
 * draws one.
 *
 * ## Screen angles, not maths angles
 *
 * Zero is up and the value grows clockwise, matching the gradient angle the CSS
 * and the canvas both use, and matching what everyone means by "45 degrees" when
 * looking at a rectangle. `Math.atan2` measures from the positive x axis
 * anticlockwise, so the conversion happens here, once, rather than in each
 * caller.
 */

interface Props {
  /** Degrees, 0 at twelve o'clock, growing clockwise. */
  value: number;
  onChange: (degrees: number) => void;
  label: string;
  /**
   * Angles the dial sticks to while dragging without a modifier.
   *
   * The eight principal directions, because a gradient is almost always meant
   * to run straight down, across, or corner to corner, and landing on 89° when
   * you meant 90° is a mistake nobody notices until the artwork is placed.
   * Holding a modifier passes through them — see `onPointerMove`.
   */
  snap?: number;
}

const SNAP_TOLERANCE = 6;

export const AngleDial: React.FC<Props> = ({ value, onChange, label, snap = 45 }) => {
  const ref = useRef<HTMLDivElement>(null);

  const angleFrom = (clientX: number, clientY: number, free: boolean): number => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return value;
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    // +90 turns the maths convention (0 = east, anticlockwise) into the screen
    // one (0 = north, clockwise). The modulo keeps it in [0, 360).
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    const wrapped = ((deg % 360) + 360) % 360;

    if (free || snap <= 0) return Math.round(wrapped);

    const nearest = Math.round(wrapped / snap) * snap;
    // The short way round, so 359° reads as one degree from zero rather than as
    // three hundred and fifty-nine.
    const gap = Math.abs(wrapped - nearest);
    const distance = Math.min(gap, 360 - gap);

    // Only *near* a principal angle. A snap that captured the whole arc would
    // make every other angle unreachable by pointer.
    return distance < SNAP_TOLERANCE ? ((nearest % 360) + 360) % 360 : Math.round(wrapped);
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      onChange(angleFrom(e.clientX, e.clientY, e.altKey));
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      // Alt passes through the snaps, the same escape hatch object snapping
      // uses on the canvas — a modifier you hold rather than a setting you go
      // and find.
      onChange(angleFrom(e.clientX, e.clientY, e.altKey));
    },
  };

  return (
    <div
      ref={ref}
      {...handlers}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} degrees`}
      className="angle-dial"
      onKeyDown={(e) => {
        // Shift jumps by the snap increment, so the eight principal angles are
        // one keypress apart. A dial that can only be operated by pointer is a
        // dial somebody cannot operate.
        const step = e.shiftKey ? snap : 1;
        const at = (next: number) => {
          e.preventDefault();
          onChange(((next % 360) + 360) % 360);
        };
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') at(value - step);
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') at(value + step);
        if (e.key === 'Home') at(0);
      }}
    >
      {/* The needle is drawn by rotating a wrapper rather than by trigonometry
          on a dot, so the line from centre to rim stays a line at every angle
          and there is nothing to keep in step with the handle. */}
      <div className="angle-dial__needle" style={{ rotate: `${value}deg` }}>
        <span className="angle-dial__grip" />
      </div>
    </div>
  );
};
