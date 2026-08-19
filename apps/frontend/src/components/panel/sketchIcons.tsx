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
 * The stroke every sketch specimen is drawn from: a swooshing S.
 *
 * ## Why a swoosh rather than a line or an arc
 *
 * Two earlier attempts failed for the same underlying reason. Straight marks
 * made `light` and `medium` look identical, because the sketcher's deviation
 * on a short *straight* run is a fraction of a pixel. A single shallow arc was
 * better — a curve gives the eye a smooth reference to judge the wobble
 * against — but one bend still left the three levels close.
 *
 * A swoosh has two bends and a change of direction, which is three chances for
 * the deviation to show rather than one, and it is also simply what the mark a
 * person makes when they scribble looks like. The gesture and the specimen are
 * the same shape.
 *
 * ## The three things that separate the levels
 *
 * All of them come out of the profiles rather than being drawn on top, which
 * is the difference between a set of icons and one icon with decorations:
 *
 *  - **Wander** — how far the line strays, which is `offset` and grows.
 *  - **Density** — `medium` and `heavy` draw *two passes*, so the mark doubles
 *    and the strokes cross. A hand going over a line twice never lands in the
 *    same place, and that doubling is the most legible difference of the three
 *    at 20px.
 *  - **Weight** — each level is drawn a little heavier, so the set also reads
 *    as a progression from a light touch to a hard scribble at a glance,
 *    before any of the detail is resolved.
 */
const SWOOSH_STEPS = 14;

function swoosh(span: number, scale: number): Array<{ x: number; y: number }> {
  return Array.from({ length: SWOOSH_STEPS + 1 }, (_, i) => {
    const t = i / SWOOSH_STEPS;
    return {
      x: (0.6 + t * (span - 1.2)) * scale,
      // One full sine period: down, up, down. Two bends and a reversal, drawn
      // shallow enough that the wobble is the thing that changes between
      // levels rather than the curve swamping it.
      y: (span * 0.5 - Math.sin(t * Math.PI * 2) * span * 0.3) * scale,
    };
  });
}

/** How heavy each level draws, so the set reads as a progression at a glance. */
const LEVEL_WEIGHT: Record<SketchLevel | 'off', number> = {
  off: 1.3,
  light: 1.4,
  medium: 1.6,
  heavy: 1.9,
};

export const SketchLevelIcon: React.FC<{ level: SketchLevel | 'off' }> = ({ level }) => {
  const span = BOX - PAD * 2;
  /**
   * Drawn large and scaled down, so the levels are distinguishable at all.
   *
   * The sketcher's wobble is in **absolute units** — it has to be, because a
   * hand's deviation does not scale with the thing it is drawing. On a
   * 14-unit mark that puts light, medium and heavy within about a pixel of
   * each other. Generating at four times the size and scaling down multiplies
   * the deviation relative to the mark.
   *
   * A specimen is allowed to exaggerate — that is what optical sizing is — so
   * long as the *ordering* it shows is the real one, and it is: the same
   * profiles, the same seeds, just further from the ruler.
   */
  const S = 4;
  const stroke = swoosh(span, S);
  const d = stroke
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');

  return (
    <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true" focusable="false">
      <g transform={`translate(${PAD} ${PAD - 1}) scale(${1 / S})`}>
        <path
          // `off` is the one specimen not generated: a clean swoosh is exactly
          // what the setting produces, and running it through the sketcher at
          // zero would be a more elaborate way of drawing the same curve.
          d={level === 'off' ? d : roughPolyline(stroke, { seed: SPECIMEN_SEED, level, closed: false })}
          fill="none"
          stroke="currentColor"
          strokeWidth={LEVEL_WEIGHT[level] * S}
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
