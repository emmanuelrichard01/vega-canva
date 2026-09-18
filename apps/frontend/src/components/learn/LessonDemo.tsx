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

/**
 * Two discs, and the four things the boolean operations do to them.
 *
 * This is the scene with the strongest claim on existing: `boolean-shapes` says
 * in its own gist that these are "four words for four results nobody can tell
 * apart from the words", and a lesson that admits its words do not work is a
 * lesson asking for a picture.
 *
 * ## Why the ghosts stay
 *
 * Each result is shown against a faint outline of *both* original discs, so
 * what was removed is as visible as what was kept. Without them, Subtract and
 * Intersect are both "a crescent-ish shape" and Exclude is an unreadable pair
 * of blobs; with them, every frame reads as the same two circles with a
 * different part of them filled, which is exactly what the operations are.
 *
 * ## Why masks rather than four drawn paths
 *
 * The lens where two circles meet is a pair of elliptical arcs whose geometry
 * depends on the radii and the overlap. Written as path data it is four
 * hand-solved `A` commands that are wrong the moment anybody nudges a circle.
 * A mask lets the browser do the arithmetic from the same two circles the
 * ghosts are drawn from, so the result cannot disagree with the outlines it is
 * shown against.
 */
const A = { cx: 68, cy: 48, r: 26 };
const B = { cx: 100, cy: 48, r: 26 };

const BooleanDemo: React.FC = () => (
  <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="demo" aria-hidden="true">
    <defs>
      {/* White keeps, black cuts. Each mask is the same two circles, combined
          the way the operation it is named for combines them. */}
      <mask id="demoBoolSubtract">
        <circle cx={A.cx} cy={A.cy} r={A.r} fill="#fff" />
        <circle cx={B.cx} cy={B.cy} r={B.r} fill="#000" />
      </mask>
      <mask id="demoBoolExclude">
        <circle cx={A.cx} cy={A.cy} r={A.r} fill="#fff" />
        <circle cx={B.cx} cy={B.cy} r={B.r} fill="#fff" />
        {/* The lens, knocked back out of the union. */}
        <g mask="url(#demoBoolLens)">
          <rect x="0" y="0" width={VIEW.w} height={VIEW.h} fill="#000" />
        </g>
      </mask>
      <mask id="demoBoolLens">
        <circle cx={A.cx} cy={A.cy} r={A.r} fill="#fff" />
      </mask>
      <clipPath id="demoBoolIntersect">
        <circle cx={A.cx} cy={A.cy} r={A.r} />
      </clipPath>
    </defs>

    {/* What the operands were, under every result. */}
    {[A, B].map((c, i) => (
      <circle
        key={i}
        cx={c.cx}
        cy={c.cy}
        r={c.r}
        fill="none"
        stroke="var(--text-primary)"
        strokeWidth="1.25"
        strokeDasharray="3 3"
        opacity="0.3"
      />
    ))}

    {/* Union: both, as one body. */}
    <g className="demo__bool demo__bool--0" fill="var(--accent)">
      <circle cx={A.cx} cy={A.cy} r={A.r} />
      <circle cx={B.cx} cy={B.cy} r={B.r} />
    </g>
    {/* Subtract: the first, less the second. */}
    <g className="demo__bool demo__bool--1">
      <circle cx={A.cx} cy={A.cy} r={A.r} fill="var(--accent)" mask="url(#demoBoolSubtract)" />
    </g>
    {/* Intersect: only where they agree. */}
    <g className="demo__bool demo__bool--2" clipPath="url(#demoBoolIntersect)">
      <circle cx={B.cx} cy={B.cy} r={B.r} fill="var(--accent)" />
    </g>
    {/* Exclude: everything except where they agree. */}
    <g className="demo__bool demo__bool--3">
      <rect x="0" y="0" width={VIEW.w} height={VIEW.h} fill="var(--accent)" mask="url(#demoBoolExclude)" />
    </g>
  </svg>
);

/**
 * The same three points, as corners and then as a curve.
 *
 * The pen's undiscoverable half is that *click* and *drag* place the same
 * anchor and mean different things, and neither word carries the difference:
 * "smooth" and "corner" are descriptions of a picture.
 *
 * So both runs are drawn through identical anchors and cross-faded, with the
 * handle growing out of the middle anchor as the corner rounds. The handle is
 * the causal part — the curve is what a handle *is* — so it appears on the same
 * beat rather than as decoration afterwards.
 */
const PenDemo: React.FC = () => (
  <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="demo" aria-hidden="true">
    {/* Clicked: straight runs into a hard corner. */}
    <path
      className="demo__pen demo__pen--corner"
      d="M30 68 L84 28 L138 68"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Dragged: the same anchors, with a tangent through the middle one. */}
    <path
      className="demo__pen demo__pen--smooth"
      d="M30 68 C 52 28, 116 28, 138 68"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="3"
      strokeLinecap="round"
    />
    {/* The handle that made the difference. */}
    <g className="demo__handle">
      <line x1="54" y1="33" x2="114" y2="33" stroke="var(--text-primary)" strokeWidth="1.25" opacity="0.5" />
      {[54, 114].map((x) => (
        <circle key={x} cx={x} cy="33" r="3" fill="var(--surface-primary)" stroke="var(--text-primary)" strokeWidth="1.5" />
      ))}
    </g>
    {/* The anchors, which never move. That is the point being made. */}
    {[
      [30, 68],
      [84, 28],
      [138, 68],
    ].map(([x, y], i) => (
      <rect key={i} x={x - 3.5} y={y - 3.5} width="7" height="7" fill="var(--surface-primary)" stroke="var(--accent)" strokeWidth="2" />
    ))}
  </svg>
);

/**
 * A box that follows the words, and words that follow the box.
 *
 * Three modes, three beats, and the third is the one worth the animation:
 * dragging a corner on a fixed box **scales the type** instead of reflowing it,
 * which is a sentence people read twice and a picture they read once.
 *
 * The lines stand in for text rather than spelling any, so nothing here needs
 * translating and the shapes stay legible at 168px wide.
 */
const SizingDemo: React.FC = () => (
  <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="demo" aria-hidden="true">
    <g className="demo__size demo__size--auto-w">
      <rect x="20" y="36" width="52" height="24" rx="3" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <rect x="27" y="45" width="38" height="6" rx="3" fill="var(--accent)" opacity="0.75" />
    </g>
    <g className="demo__size demo__size--auto-h">
      <rect x="44" y="24" width="80" height="48" rx="3" fill="none" stroke="var(--accent)" strokeWidth="2" />
      {[32, 44, 56].map((y, i) => (
        <rect key={y} x="52" y={y} width={i === 2 ? 40 : 64} height="6" rx="3" fill="var(--accent)" opacity="0.75" />
      ))}
    </g>
    <g className="demo__size demo__size--fixed">
      <rect x="44" y="24" width="80" height="48" rx="3" fill="none" stroke="var(--accent)" strokeWidth="2" />
      {/* Scaled about the box's own middle, so the type grows where the text
          sits rather than drifting out of the frame it is fixed inside. */}
      <g className="demo__size-type">
        {[38, 52].map((y, i) => (
          <rect key={y} x="54" y={y} width={i === 1 ? 38 : 60} height="6" rx="3" fill="var(--accent)" opacity="0.75" />
        ))}
      </g>
    </g>
  </svg>
);

/**
 * An address becoming a card.
 *
 * The claim in `link-card` is that a pasted URL stops being text, and the whole
 * of it happens in the second after the paste — which is precisely the second
 * nobody is looking, because they are still moving the pointer away.
 *
 * The bar is the address; the picture block and the two lines are what arrives
 * in its place. The card is drawn at the proportions the real horizontal card
 * uses, so the demo is a small true picture of the result rather than a
 * suggestion of one.
 */
const UnfurlDemo: React.FC = () => (
  <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="demo" aria-hidden="true">
    {/* The pasted address, before. */}
    <g className="demo__url">
      <rect x="30" y="43" width="108" height="10" rx="5" fill="var(--text-primary)" opacity="0.25" />
    </g>
    {/* The card, after. */}
    <g className="demo__card">
      <rect x="26" y="26" width="116" height="44" rx="6" fill="var(--surface-primary)" stroke="var(--border-strong)" strokeWidth="1.5" />
      <rect x="26" y="26" width="40" height="44" fill="var(--accent)" opacity="0.85" />
      {/* The picture's own corner, so the block reads as an image and not as a
          coloured panel. */}
      <path d="M26 62 L40 50 L52 62 Z" fill="var(--surface-primary)" opacity="0.5" />
      <circle cx="56" cy="38" r="4" fill="var(--surface-primary)" opacity="0.6" />
      <rect x="74" y="36" width="54" height="6" rx="3" fill="var(--text-primary)" opacity="0.65" />
      <rect x="74" y="48" width="38" height="5" rx="2.5" fill="var(--text-primary)" opacity="0.3" />
    </g>
  </svg>
);

/**
 * Lines of code standing up as boxes and an arrow.
 *
 * `diagram-code` claims the result is "real objects on the board, not a picture
 * of them", and the only way to show *real* is to show them arriving as
 * separate things: the two boxes land on their own beats and the arrow is drawn
 * between them afterwards, because that is the order the builder works in and
 * the order that reads as construction rather than as a slide transition.
 */
const CodeShapesDemo: React.FC = () => (
  <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="demo" aria-hidden="true">
    {/* The source, which stays put: the code does not go anywhere. */}
    <g opacity="0.45">
      {[
        [22, 30, 40],
        [22, 44, 28],
        [22, 58, 34],
      ].map(([x, y, w], i) => (
        <rect key={i} x={x} y={y} width={w} height="6" rx="3" fill="var(--text-primary)" opacity="0.5" />
      ))}
    </g>

    <g className="demo__built">
      <rect className="demo__built-a" x="84" y="24" width="46" height="22" rx="4" fill="var(--accent)" opacity="0.9" />
      <rect className="demo__built-b" x="84" y="58" width="46" height="22" rx="4" fill="var(--accent)" opacity="0.7" />
      <g className="demo__built-link">
        <line x1="107" y1="46" x2="107" y2="54" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" />
        <path d="M107 58 L103.5 51 L110.5 51 Z" fill="var(--text-primary)" />
      </g>
    </g>
  </svg>
);

const SCENES: Record<DemoId, React.FC> = {
  route: RouteDemo,
  'fill-grid': FillGridDemo,
  reframe: ReframeDemo,
  bind: BindDemo,
  field: FieldDemo,
  chain: ChainDemo,
  boolean: BooleanDemo,
  pen: PenDemo,
  sizing: SizingDemo,
  unfurl: UnfurlDemo,
  'code-shapes': CodeShapesDemo,
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
