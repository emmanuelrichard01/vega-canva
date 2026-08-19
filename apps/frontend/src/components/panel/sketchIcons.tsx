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
/**
 * The stroke every sketch specimen is drawn from: a shallow open arc.
 *
 * ## Why an arc, and why one of them
 *
 * The previous version used two straight marks, and it failed for a reason
 * worth writing down: at `light` and `medium` the sketcher's deviation on a
 * short straight run is small enough that both looked like *parallel lines*,
 * and `heavy` only looked different because a third crossing stroke had been
 * bolted on to force a difference. Three icons that differ by an added
 * decoration rather than by the thing they measure is not a set — it is one
 * icon and two exceptions.
 *
 * A curve fixes it because deviation is *visible against a curve* in a way it
 * is not against a straight line: the eye has a smooth reference to compare
 * against, so a wobble reads as a wobble instead of as a slightly crooked
 * line. And an arc cannot be confused with anything else on the rail — not the
 * stroke-weight bar, which is a solid rectangle, and not the shape swapper,
 * which now wears the object's own silhouette.
 *
 * The levels then differ by the two things that actually define them, both
 * emerging from the sketcher rather than being drawn on top:
 *
 *  - **Wander**, which grows with the level.
 *  - **Passes**, which is why `medium` and `heavy` show a doubled line — the
 *    profiles genuinely draw twice, and a hand going over a line twice never
 *    lands in the same place. That doubling *is* the difference between light
 *    and medium, and it is legible at 20px.
 */
const ARC_STEPS = 10;

function arc(span: number, scale: number): Array<{ x: number; y: number }> {
  return Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
    const t = i / ARC_STEPS;
    return {
      x: (0.5 + t * (span - 1)) * scale,
      // A shallow rise and fall — deep enough to read as a curve at 20px,
      // shallow enough that the wobble is what changes between levels rather
      // than the arc swamping it.
      y: (span * 0.78 - Math.sin(t * Math.PI) * span * 0.42) * scale,
    };
  });
}

export const SketchLevelIcon: React.FC<{ level: SketchLevel | 'off' }> = ({ level }) => {
  const span = BOX - PAD * 2;
  /**
   * Drawn large and scaled down, so the levels are distinguishable at all.
   *
   * The sketcher's wobble is in **absolute units** — it has to be, because a
   * hand's deviation does not scale with the thing it is drawing. On a
   * 14-unit mark that puts light, medium and heavy within about a pixel of
   * each other. Generating at four times the size and scaling the result down
   * multiplies the deviation relative to the mark, which is what makes "one
   * confident pass" and "twice, past every corner" different pictures.
   *
   * A specimen is allowed to exaggerate — that is what optical sizing is — so
   * long as the *ordering* it shows is the real one, and it is: the same
   * profiles, the same seeds, just further from the ruler.
   */
  const S = 4;
  const stroke = arc(span, S);
  const d = stroke
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');

  return (
    <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true" focusable="false">
      <g transform={`translate(${PAD} ${PAD - 1}) scale(${1 / S})`}>
        <path
          // `off` is the one specimen not generated: a clean arc is exactly
          // what the setting produces, and running it through the sketcher at
          // zero would be a more elaborate way of drawing the same curve.
          d={level === 'off' ? d : roughPolyline(stroke, { seed: SPECIMEN_SEED, level, closed: false })}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5 * S}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
