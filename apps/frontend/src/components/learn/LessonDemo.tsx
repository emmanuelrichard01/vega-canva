import React from 'react';
import type { DemoId } from '../../engine/learn/lessons';

/**
 * The gesture, drawn and looping.
 *
 * ## Why a drawing rather than a recording
 *
 * A screen recording of this app inside this app is redundant on the day it is
 * made and wrong a month later, which is the argument the welcome art already
 * made about screenshots. It is also heavy: a clip good enough to read is
 * hundreds of kilobytes on a surface whose whole job is to get out of the way.
 *
 * These are vector, a few hundred bytes each, theme-aware because they paint
 * from tokens, and crisp at any size. More to the point they draw the *idea* of
 * the gesture rather than the pixels of one particular board, so nothing here
 * goes stale when a panel moves.
 *
 * ## Why six scenes and not seventeen
 *
 * Several lessons are the same gesture underneath: clicking a run of points
 * builds a line and builds a path. One drawing per lesson would be seventeen
 * things to keep true, most of them near-duplicates, and the near-duplicates
 * are what drift. So there are six, for the six gestures nobody can guess, and
 * a lesson with no demo is one whose steps carry it alone.
 *
 * An animation that adds nothing is worse than none. It takes the eye first,
 * and then does not repay it.
 *
 * ## Why the motion is CSS
 *
 * No timer, no animation frame, no state. A coach mark can be on screen for
 * several minutes while somebody works, and a React loop ticking behind it
 * would be re-rendering a decoration over a canvas that needs the frame. CSS
 * keyframes run off the main thread and stop dead under
 * `prefers-reduced-motion`, which is handled once in the stylesheet rather than
 * in every scene here.
 */

const VIEW = { w: 168, h: 96 };

/** The little hand. One shape, reused by every scene that has a pointer. */
const Cursor: React.FC<{ className: string }> = ({ className }) => (
  <g className={className}>
    <path
      d="M0 0 L0 13 L3.4 9.6 L6 15 L8.6 13.6 L6.1 8.4 L10.4 8.4 Z"
      fill="var(--text-primary)"
      stroke="var(--surface-primary)"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
  </g>
);

/**
 * A route being built by clicking, one corner at a time.
 *
 * Serves the line tool, whose whole undiscoverable half is that a click does
 * something different from a drag. The pointer stops at each corner and a ring
 * pulses out of it, so the *clicks* are what the eye counts rather than the
 * path, which is the thing being taught.
 */
const RouteDemo: React.FC = () => (
  <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="demo" aria-hidden="true">
    <polyline
      className="demo__route"
      points="26,70 62,32 106,58 144,26"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {[
      [26, 70],
      [62, 32],
      [106, 58],
      [144, 26],
    ].map(([x, y], i) => (
      <circle
        key={i}
        className={`demo__tap demo__tap--${i}`}
        cx={x}
        cy={y}
        r="4"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
      />
    ))}
    <Cursor className="demo__cursor demo__cursor--route" />
  </svg>
);

/**
 * Pictures landing in the modules of a grid.
 *
 * The point being made is *cover*: each tile arrives at a different shape and
 * leaves filling its module edge to edge, because "cropped to fit rather than
 * squashed to fit" is a sentence that only lands once you have seen it happen.
 */
const FillGridDemo: React.FC = () => (
  <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="demo" aria-hidden="true">
    {/* The empty modules, which stay put. A grid's frame never moves; only
        what is in it does. */}
    {[
      [30, 20, 48, 30],
      [86, 20, 52, 30],
      [30, 58, 52, 22],
      [90, 58, 48, 22],
    ].map(([x, y, w, h], i) => (
      <rect
        key={i}
        x={x}
        y={y}
        width={w}
        height={h}
        rx="4"
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
    ))}
    {[
      [30, 20, 48, 30],
      [86, 20, 52, 30],
      [30, 58, 52, 22],
      [90, 58, 48, 22],
    ].map(([x, y, w, h], i) => (
      <rect
        key={`f${i}`}
        className={`demo__tile demo__tile--${i}`}
        x={x}
        y={y}
        width={w}
        height={h}
        rx="4"
        fill="var(--accent)"
        opacity={0.85 - i * 0.14}
      />
    ))}
  </svg>
);

/**
 * A picture moving inside a frame that does not move.
 *
 * The whole idea of reframing in a module, in one loop: the outer rectangle is
 * fixed and the photograph slides under it. Drawn as a wide band behind a
 * narrow window, because the reason you would ever do this is that the picture
 * is bigger than the hole it is showing through.
 */
const ReframeDemo: React.FC = () => (
  <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="demo" aria-hidden="true">
    <defs>
      <clipPath id="demoWindow">
        <rect x="52" y="24" width="64" height="48" rx="5" />
      </clipPath>
    </defs>
    {/* The part outside the module, faint. Seeing what is being cut away is
        the entire reason the real overlay draws it too. */}
    <g className="demo__pan" opacity="0.22">
      <rect x="18" y="24" width="132" height="48" rx="5" fill="var(--accent)" />
      <circle cx="66" cy="48" r="11" fill="var(--surface-primary)" opacity="0.65" />
    </g>
    <g clipPath="url(#demoWindow)">
      <g className="demo__pan">
        <rect x="18" y="24" width="132" height="48" rx="5" fill="var(--accent)" />
        <circle cx="66" cy="48" r="11" fill="var(--surface-primary)" opacity="0.8" />
      </g>
    </g>
    <rect
      x="52"
      y="24"
      width="64"
      height="48"
      rx="5"
      fill="none"
      stroke="var(--text-primary)"
      strokeWidth="2"
    />
  </svg>
);

/**
 * A box being moved, and the arrow keeping hold of it.
 *
 * A connector's claim is entirely about what happens *later*, so the demo has
 * to show the later: one box walks away and the arrow re-aims rather than
 * stretching off into nothing.
 *
 * ## Why the target swings on an arc
 *
 * The first version translated the box, the line and the head as one group,
 * which moved all three together and therefore demonstrated nothing at all:
 * the arrow did not follow the box, it *was* the box. Redrawing a line between
 * a fixed point and a moving one needs the endpoint recomputed, and SVG
 * geometry attributes are not reliably animatable from CSS.
 *
 * Swinging the whole assembly about the source's edge is the same picture with
 * arithmetic that CSS can do. The link is a fixed length because the target
 * stays a fixed distance away, so a rotation is exact rather than an
 * approximation, and what you see is an arrow re-aiming at a box that has
 * moved. The slight tilt the box picks up reads as being dragged, which is
 * what is happening.
 */
const BindDemo: React.FC = () => (
  <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="demo" aria-hidden="true">
    {/* The end that does not move, so there is something to move relative to. */}
    <rect x="14" y="34" width="42" height="28" rx="5" fill="var(--text-primary)" opacity="0.18" />

    <g className="demo__swing">
      <path
        className="demo__link"
        d="M56 48 L100 48"
        stroke="var(--text-primary)"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M100 48 L92 44.4 L92 51.6 Z" fill="var(--text-primary)" />
      <rect x="100" y="34" width="44" height="28" rx="5" fill="var(--accent)" opacity="0.9" />
    </g>
  </svg>
);

/**
 * A field passing over a scatter of objects.
 *
 * The ring is the subject, not the dots. "That circle is exactly how far the
 * field reaches" is the one fact about the force tools that stops them feeling
 * arbitrary, and it is invisible in a still picture.
 */
const FieldDemo: React.FC = () => (
  <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="demo" aria-hidden="true">
    {[
      [42, 32],
      [66, 62],
      [96, 30],
      [118, 58],
      [80, 44],
      [140, 40],
    ].map(([x, y], i) => (
      <circle key={i} className={`demo__mote demo__mote--${i % 3}`} cx={x} cy={y} r="5" fill="var(--accent)" opacity={0.55 + (i % 3) * 0.15} />
    ))}
    <circle
      className="demo__field"
      cx="0"
      cy="0"
      r="30"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="2"
      strokeDasharray="4 4"
    />
    <Cursor className="demo__cursor demo__cursor--field" />
  </svg>
);

/**
 * Notes appearing one after another, in a row.
 *
 * The gesture is a keystroke, which cannot be drawn, so what is drawn is the
 * *rate*: four notes arriving faster than anyone could place them by hand,
 * which is the actual claim being made about Tab.
 */
const ChainDemo: React.FC = () => (
  <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="demo" aria-hidden="true">
    {[0, 1, 2, 3].map((i) => (
      <rect
        key={i}
        className={`demo__note demo__note--${i}`}
        x={20 + i * 34}
        y={34}
        width="28"
        height="28"
        rx="3"
        fill="var(--accent)"
        opacity={0.9 - i * 0.12}
      />
    ))}
  </svg>
);

const SCENES: Record<DemoId, React.FC> = {
  route: RouteDemo,
  'fill-grid': FillGridDemo,
  reframe: ReframeDemo,
  bind: BindDemo,
  field: FieldDemo,
  chain: ChainDemo,
};

export const LessonDemo: React.FC<{ demo: DemoId }> = ({ demo }) => {
  const Scene = SCENES[demo];
  if (!Scene) return null;
  return (
    <div className="demo-stage">
      <Scene />
    </div>
  );
};
