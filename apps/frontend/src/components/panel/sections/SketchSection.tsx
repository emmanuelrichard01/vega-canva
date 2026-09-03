import React from 'react';
import { Pencil, RefreshCw } from 'lucide-react';
import { Accordion, Row } from '../panelPrimitives';
import { NumberStepper } from '../../ui/NumberStepper';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { FillStyleIcon, HatchAngleGlyph, ShadingDensityIcon, SketchLevelIcon } from '../sketchIcons';
import { HACHURE_ANGLE, SHADING_DENSITIES } from '../../../engine/model/rough';
import {
  SHADING_DENSITY_HINTS,
  SHADING_DENSITY_LABELS,
  FILL_STYLE_LABELS,
  SKETCH_LEVEL_LABELS,
} from '../../../engine/model/shadingLabels';
import type {
  Appearance,
  FillStyle,
  ShadingDensity,
  SketchLevel,
} from '../../../engine/model/schema';
import type { Shared } from '../../../engine/model/selection';

interface SketchSectionProps {
  capabilities: { supportsFill?: boolean };
  appearance: Appearance | undefined;
  /** Whether every selected object is a kind this can be applied to. */
  sketchable: boolean;
  /** Whether every selected shape has an interior, which shading needs. */
  allClosed: boolean;
  sharedPaint: <T>(read: (a: Appearance) => T) => Shared<T>;
  setAppearance: (patch: Partial<Appearance>) => void;
}

const SKETCH_LABELS: Record<SketchLevel, string> = {
  light: 'Light',
  medium: 'Medium',
  heavy: 'Heavy',
};

/**
 * Short forms, for the header.
 *
 * "Heavy · Cross-hatch" is wider than the badge, so it truncated to
 * "Heavy · Cross-..." — a label that gives up halfway is worse than a shorter
 * one that finishes. These are the names as a person would say them in passing;
 * the full ones are on the tiles, where there is room.
 */
const FILL_LABELS: Record<Exclude<FillStyle, 'solid'>, string> = {
  hachure: 'Hatch',
  crosshatch: 'Cross',
  zigzag: 'Scribble',
  dots: 'Stipple',
};

/**
 * How the marks are made, as its own section.
 *
 * ## Why it left Stroke
 *
 * These controls lived inside the Stroke accordion, on the reasoning that a
 * sketch is drawn with a pen. But `sketch` is not a property of the stroke: it
 * decides how the **outline and the fill both** are drawn, and the shading
 * controls act on the *interior* — the one part of a shape the Stroke section
 * has nothing else to say about. So that accordion held two subjects, and the
 * one whose name was on the header was the smaller of them.
 *
 * The split is also what let the shading grow. Density and angle inside Stroke
 * would have made it a four-topic section; here they sit under the thing they
 * qualify, and the badge reports the whole look without the section being
 * opened — which for something you set once and then live with is most of what
 * you want from it.
 */
export const SketchSection: React.FC<SketchSectionProps> = ({
  capabilities,
  appearance,
  sketchable,
  allClosed,
  sharedPaint,
  setAppearance,
}) => {
  if (!sketchable || !appearance) return null;

  const level = appearance.sketch;
  const style: FillStyle = appearance.fillStyle ?? 'solid';

  /** The current look, in the header: "Medium · Hachure". */
  const badge = !level
    ? undefined
    : style === 'solid'
      ? SKETCH_LABELS[level]
      : `${SKETCH_LABELS[level]} · ${FILL_LABELS[style]}`;

  return (
    <Accordion
      title="Hand-drawn"
      icon={<Pencil size={13} />}
      defaultOpen={Boolean(level)}
      badge={badge}
    >
      <Row stack label="Sketch" hint="Draw this by hand. The result is stable and never re-randomises.">
          {(() => {
            const sketch = sharedPaint((a) => a.sketch ?? 'off');
            return (
              <SegmentedControl
                ariaLabel="Hand-drawn sketch"
                fill
                mixed={sketch.mixed}
                value={String(sketch.value ?? 'off')}
                onChange={(v) =>
                  setAppearance({ sketch: v === 'off' ? undefined : (v as SketchLevel) })
                }
                // Named from `shadingLabels`, which the rail's popover also
                // reads. The two used to hold a hand copy each.
                segments={(['off', 'light', 'medium', 'heavy'] as const).map((level) => ({
                  value: level,
                  label: SKETCH_LEVEL_LABELS[level],
                  icon: <SketchLevelIcon level={level} />,
                }))}
              />
            );
          })()}
      </Row>

      {/*
        The section is two decisions, and the rule says so.

        Above it: how the marks are made — the one choice that changes whether
        this is a drawing at all. Below it: what happens to the interior, which
        is a different question and only exists once the first has an answer.
        Four flat rows read as four unrelated settings; a rule costs a pixel and
        makes the dependency legible.
      */}
      {capabilities.supportsFill && level && allClosed && <div className="prop-rule" role="presentation" />}

      {capabilities.supportsFill && level && allClosed && (
        /* Stacked, because five tiles do not fit the 84px control column — they
           wrapped three-and-two, which reads as a mistake next to the four
           above them that happen to fit. */
        <Row stack label="Shading" hint="How the inside is filled: flat colour, or pen strokes laid across it.">
          {(() => {
            const picked = sharedPaint((a) => a.fillStyle ?? 'solid');
            return (
              <SegmentedControl
                ariaLabel="Sketch fill style"
                fill
                mixed={picked.mixed}
                value={String(picked.value ?? 'solid')}
                onChange={(v) =>
                  setAppearance({ fillStyle: v === 'solid' ? undefined : (v as FillStyle) })
                }
                segments={(['solid', 'hachure', 'crosshatch', 'zigzag', 'dots'] as const).map((style) => ({
                  value: style,
                  label: FILL_STYLE_LABELS[style],
                  icon: <FillStyleIcon style={style} />,
                }))}
              />
            );
          })()}
        </Row>
      )}

      {/*
        Density and angle, on one line.

        They are the two dimensions of one thing — how the shading reads as
        tone — and they were two labelled rows, so the panel spent 168px of
        label column saying "Density" and "Angle" beside controls that show
        what they are. Read together they are also more useful: a dense field
        at 41° and a light one at 90° are the two decisions you make about a
        hatch, and you make them against each other.
      */}
      {capabilities.supportsFill && level && allClosed && style !== 'solid' && (
        <div className="prop-grid">
          {(() => {
            const density = sharedPaint((a) => a.shadingDensity ?? 'medium');
            return (
              <SegmentedControl
                ariaLabel="Shading density"
                fill
                mixed={density.mixed}
                value={String(density.value ?? 'medium')}
                onChange={(v) =>
                  setAppearance({ shadingDensity: v === 'medium' ? undefined : (v as ShadingDensity) })
                }
                segments={SHADING_DENSITIES.map((id) => ({
                  value: id,
                  label: SHADING_DENSITY_LABELS[id],
                  hint: SHADING_DENSITY_HINTS[id],
                  icon: <ShadingDensityIcon density={id} />,
                }))}
              />
            );
          })()}
          {(() => {
            const angle = sharedPaint((a) => a.shadingAngle ?? HACHURE_ANGLE);
            const value = Math.round(angle.value ?? HACHURE_ANGLE);
            return (
              <NumberStepper
                aria-label="Shading angle"
                /*
                  The glyph *is* the value.

                  An angle is the one number in this panel you cannot picture
                  from the digits — 41° against 90° is a real difference in how
                  a shape reads, and neither number says which way the strokes
                  run. Turning the mark to match means the field answers its own
                  question, and it costs one `rotate`.
                */
                glyph={<HatchAngleGlyph degrees={angle.mixed ? 0 : value} />}
                suffix="°"
                value={value}
                mixed={angle.mixed}
                onChange={(v) => setAppearance({ shadingAngle: v })}
                min={-90}
                max={90}
                step={5}
              />
            );
          })()}
        </div>
      )}

      {/*
        Draw it again.

        The sketch is seeded from the node id, which is what stops the outline
        crawling on every re-render — and it also means one shape has exactly
        one drawing for its whole life. That is right until the drawing is bad:
        a wobble that clips a corner, an overshoot that reads as a mistake
        rather than as a hand. The remedy used to be deleting the object and
        making a new one, because a new id is the only new seed.

        A variant number mixed into the seed gives a different drawing without
        giving up any of the stability — see `Appearance.sketchSeed`. Every
        value is as fixed as the original was; there is simply more than one.

        It sits under the rule with the shading rather than up with the level,
        because it is a *verb* and everything above it is a setting. And it is
        offered whenever there is a sketch, shaded or not: the outline is drawn
        by hand either way, and the outline is usually what you want redrawn.
      */}
      {level && (
        <div className="prop-grid prop-grid--single">
          <button
            type="button"
            className="sketch-redraw"
            onClick={() => {
              const current = sharedPaint((a) => a.sketchSeed ?? 0);
              // Incremented rather than randomised: the number lands in the
              // document, and a small counter is a thing somebody reading the
              // JSON can understand. Pressing again keeps walking forward, so
              // "the one before last" is reachable by going round.
              const next = (typeof current.value === 'number' ? current.value : 0) + 1;
              setAppearance({ sketchSeed: next });
            }}
            data-tooltip="A different hand, same settings"
            data-tooltip-pos="left"
          >
            <RefreshCw size={13} aria-hidden="true" />
            Redraw
          </button>
        </div>
      )}
    </Accordion>
  );
};
