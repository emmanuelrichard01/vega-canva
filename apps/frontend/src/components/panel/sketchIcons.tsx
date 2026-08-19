import React from 'react';
import { rectRing, roughPolyline, shapeFill, type FillStyle, type SketchLevel } from '../../engine/model/rough';

/**
 * Specimens for the sketch controls, drawn by the sketch code itself.
 *
 * ## Why these are generated rather than authored
 *
 * A hand-authored glyph for "Heavy" is a designer's *guess* at what heavy
 * looks like, and the moment the profile is retuned the guess is wrong with
 * nothing to catch it. These call `roughPolyline` and `shapeFill` — the same
 * functions the canvas calls — so the icon on the button is a small version of
 * the thing the button produces, and it cannot drift from it.
 *
 * The seed is fixed rather than random. Two buttons rendering the same level
 * must show the same specimen, and the specimen must not change on every
 * re-render of the panel — the same crawling problem the canvas has, and worse
 * here because a toolbar redraws constantly.
 *
 * `currentColor` throughout, so a specimen dims with its own segment rather
 * than sitting at full strength on an inactive one — the rule
 * `StrokeStyleIcon` already established.
 */

/** One seed for every specimen, so the set looks like one hand drew it. */
const SPECIMEN_SEED = 20260819;

const BOX = 20;
const PAD = 3;

/** The rectangle the shading specimens are drawn from. */
const ring = rectRing(BOX - PAD * 2, BOX - PAD * 2);

/**
 * A sketch level, as a pair of short scribbled marks.
 *
 * `off` is the one specimen not generated: two ruled strokes are exactly what
 * the setting produces, and running them through the sketcher at zero would be
 * a more elaborate way of drawing the same two lines.
 */
export const SketchLevelIcon: React.FC<{ level: SketchLevel | 'off' }> = ({ level }) => {
  const span = BOX - PAD * 2;
  /**
   * Two short strokes, stacked and slightly tilted.
   *
   * ## Why not one line
   *
   * It was one, and at `off` that is a plain straight dash — the same mark the
   * stroke control wears and, on a line object, the same mark the shape
   * swapper wears. Three identical buttons in a row, which does not merely
   * fail to say what each does: it says they do the same thing.
   *
   * A *pair* of short marks is not a line at all. It reads as scribble — the
   * gesture of shading something in by hand — and it cannot be mistaken for a
   * stroke weight or for a shape however straight the strokes are.
   *
   * ## Why tilted, and why two rather than three
   *
   * Horizontal and evenly stacked, three of them are a hamburger menu. The
   * tilt and the count take that reading away while keeping the marks big
   * enough to show a wobble at 20px, which is the whole job: `off` is two
   * ruled strokes, and each level bends them further.
   */
  const strokes: Array<Array<{ x: number; y: number }>> = [
    [{ x: 0.5, y: span * 0.68 }, { x: span - 0.5, y: span * 0.3 }],
    [{ x: 0.5, y: span * 0.95 }, { x: span - 0.5, y: span * 0.57 }],
  ];

  return (
    <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true" focusable="false">
      <g transform={`translate(${PAD} ${PAD - 1})`}>
        {strokes.map((stroke, i) =>
          level === 'off' ? (
            <line
              key={i}
              x1={stroke[0].x} y1={stroke[0].y}
              x2={stroke[1].x} y2={stroke[1].y}
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            />
          ) : (
            <path
              key={i}
              // A different seed per stroke, or the two wobble identically and
              // read as one mark drawn twice by a machine rather than by a
              // hand — which is the distinction the whole control is about.
              d={roughPolyline(stroke, { seed: SPECIMEN_SEED + i * 97, level, closed: false })}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )
        )}
      </g>
    </svg>
  );
};

/**
 * A fill style, as a box with that shading inside it.
 *
 * The outline is drawn at `light` for all three so the *fill* is the only thing
 * that differs between them — a specimen that varied two things at once would
 * not say which one the control changes.
 *
 * The gap is tightened for the specimen. At the canvas's 9-unit spacing a 14px
 * box holds one or two strokes, which reads as a scratch rather than as
 * shading; the pattern has to repeat at least three times before the eye sees
 * it as a texture.
 */
export const FillStyleIcon: React.FC<{ style: FillStyle }> = ({ style }) => {
  const inner = BOX - PAD * 2;
  // Unique per instance. These specimens render several times on one screen —
  // once per segment in the panel, again in the toolbar popover — and a fixed
  // `clipPath` id would put duplicate ids in the document, where every
  // reference silently resolves to whichever one mounted first.
  const clipId = `fill-specimen-${React.useId()}`;
  const shading = React.useMemo(
    () =>
      style === 'solid'
        ? ''
        : shapeFill(ring, { seed: SPECIMEN_SEED, style, level: 'light' }),
    [style]
  );

  return (
    <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true" focusable="false">
      <g transform={`translate(${PAD} ${PAD})`}>
        {style === 'solid' && (
          <rect x="0" y="0" width={inner} height={inner} fill="currentColor" opacity="0.85" rx="1" />
        )}
        {shading && (
          <path
            d={shading}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.9"
            strokeLinecap="round"
            opacity="0.95"
            // Clipped to the box, because the shading strokes deliberately
            // overshoot the shape they fill and a specimen has no room for it.
            clipPath={`url(#${clipId})`}
          />
        )}
        <path
          d={roughPolyline(ring, { seed: SPECIMEN_SEED, level: 'light' })}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </g>
      <defs>
        <clipPath id={clipId}>
          <rect x="-1" y="-1" width={inner + 2} height={inner + 2} />
        </clipPath>
      </defs>
    </svg>
  );
};
