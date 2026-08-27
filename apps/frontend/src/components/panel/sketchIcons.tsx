import React from 'react';
import type { ShadingDensity } from '../../engine/model/rough';
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
 * The stroke every sketch specimen is drawn from: a compressed vertical
 * squiggle.
 *
 * ## Why vertical, and why tight
 *
 * A horizontal mark in a square icon reads as a *line* — which is what the
 * stroke-weight control next to it is. Turned upright it stops competing with
 * anything else on the rail, and it fills the glyph box in both directions
 * instead of leaving air above and below.
 *
 * Compressed, because a squiggle is defined by its *frequency* as much as its
 * amplitude: two lazy bends read as a curve, and it takes three tight ones
 * before the eye calls it a scribble. That is the mark a person actually makes
 * when they hatch something in.
 *
 * ## Why the levels look genuinely different
 *
 * The sketcher's wobble is in **absolute units**, so on a small mark every
 * level lands within a pixel of every other — which is why the first two
 * attempts at this icon failed. Each level is therefore generated at its *own*
 * scale and shrunk to fit: heavy is drawn seven times life size and reduced,
 * so its deviation is seven times larger relative to the mark, while light is
 * barely magnified at all.
 *
 * That is exaggeration, and it is legitimate for the same reason a typeface
 * has optical sizes: the *ordering* is the real one — same profiles, same
 * seeds, same passes — and the specimen's job at 20px is to make the ordering
 * legible, not to be a scale model.
 *
 * Three things then separate them, and none is drawn on top:
 *
 *  - **Wander**, magnified per level as above.
 *  - **Density** — medium and heavy draw two passes, so the mark doubles and
 *    the strokes cross. A hand going over a line twice never lands twice in
 *    the same place.
 *  - **Weight** — each level a little heavier, so the set reads as a
 *    progression from a light touch to a hard scribble before any of the
 *    detail resolves.
 */
const SQUIGGLE_STEPS = 20;

/** Bends per specimen. Three is where a curve stops reading as a curve. */
const SQUIGGLE_BENDS = 3;

function squiggle(span: number, scale: number): Array<{ x: number; y: number }> {
  return Array.from({ length: SQUIGGLE_STEPS + 1 }, (_, i) => {
    const t = i / SQUIGGLE_STEPS;
    return {
      // Across the glyph, narrow — the swing is what makes it a squiggle, and
      // a wide one at this size is just a wave.
      x: (span * 0.5 + Math.sin(t * Math.PI * SQUIGGLE_BENDS) * span * 0.26) * scale,
      // Down it, end to end.
      y: (0.6 + t * (span - 1.2)) * scale,
    };
  });
}

/**
 * How far each level is magnified before being shrunk into the glyph.
 *
 * The whole reason the levels are distinguishable at all — see above.
 */
const LEVEL_SCALE: Record<SketchLevel | 'off', number> = {
  off: 3,
  light: 3.4,
  medium: 5.2,
  heavy: 7.4,
};

/** How heavy each level draws, so the set reads as a progression at a glance. */
const LEVEL_WEIGHT: Record<SketchLevel | 'off', number> = {
  off: 1.25,
  light: 1.35,
  medium: 1.6,
  heavy: 2,
};

export const SketchLevelIcon: React.FC<{ level: SketchLevel | 'off' }> = ({ level }) => {
  const span = BOX - PAD * 2;
  const S = LEVEL_SCALE[level];
  const stroke = squiggle(span, S);
  const d = stroke
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');

  return (
    <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true" focusable="false">
      <g transform={`translate(${PAD} ${PAD - 1}) scale(${1 / S})`}>
        <path
          // `off` is the one specimen not generated: a clean squiggle is
          // exactly what the setting produces, and running it through the
          // sketcher at zero would be a more elaborate way of drawing the same
          // curve.
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
            fill={style === 'dots' ? 'currentColor' : 'none'}
            stroke={style === 'dots' ? 'none' : 'currentColor'}
            strokeWidth={style === 'dots' ? undefined : '0.9'}
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

/**
 * How closely the strokes are laid, drawn as itself.
 *
 * Through the same `shapeFill` the canvas uses, at the same three densities, so
 * a tile cannot promise a tone the shape will not produce. The alternative — a
 * hand-drawn glyph of "sparse", "medium", "dense" — is three pictures somebody
 * has to keep in step with three numbers, and the numbers are the thing that
 * changed the last time this was wrong.
 */
export const ShadingDensityIcon: React.FC<{ density: ShadingDensity }> = ({ density }) => {
  const inner = BOX - PAD * 2;
  const clipId = `density-specimen-${React.useId()}`;
  const shading = React.useMemo(
    () => shapeFill(ring, { seed: SPECIMEN_SEED, style: 'hachure', level: 'light', density }),
    [density]
  );

  return (
    <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true" focusable="false">
      <g transform={`translate(${PAD} ${PAD})`}>
        <path
          d={shading}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeLinecap="round"
          opacity="0.95"
          clipPath={`url(#${clipId})`}
        />
        <path
          d={roughPolyline(ring, { seed: SPECIMEN_SEED, level: 'light' })}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.5"
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
