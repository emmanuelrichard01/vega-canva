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

/** The rectangle every specimen is drawn from, inset so strokes cannot clip. */
const ring = rectRing(BOX - PAD * 2, BOX - PAD * 2);

/**
 * A sketch level, as a small drawn box.
 *
 * `off` is the one specimen not generated: a crisp rectangle is exactly what
 * the setting produces, and running it through the sketcher at zero would be a
 * more elaborate way of drawing the same four straight lines.
 */
export const SketchLevelIcon: React.FC<{ level: SketchLevel | 'off' }> = ({ level }) => (
  <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true" focusable="false">
    <g transform={`translate(${PAD} ${PAD})`}>
      {level === 'off' ? (
        <rect
          x="0.75"
          y="0.75"
          width={BOX - PAD * 2 - 1.5}
          height={BOX - PAD * 2 - 1.5}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          rx="1.5"
        />
      ) : (
        <path
          d={roughPolyline(ring, { seed: SPECIMEN_SEED, level })}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  </svg>
);

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
