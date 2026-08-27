import React from 'react';
import { Pencil } from 'lucide-react';
import { Accordion, Row } from '../panelPrimitives';
import { NumberStepper } from '../../ui/NumberStepper';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { FillStyleIcon, ShadingDensityIcon, SketchLevelIcon } from '../sketchIcons';
import { HACHURE_ANGLE, SHADING_DENSITIES } from '../../../engine/model/rough';
import {
  SHADING_DENSITY_HINTS,
  SHADING_DENSITY_LABELS,
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
                mixed={sketch.mixed}
                value={String(sketch.value ?? 'off')}
                onChange={(v) =>
                  setAppearance({ sketch: v === 'off' ? undefined : (v as SketchLevel) })
                }
                segments={[
                  { value: 'off', label: 'Off — a ruled shape', icon: <SketchLevelIcon level="off" /> },
                  { value: 'light', label: 'Light — one confident pass', icon: <SketchLevelIcon level="light" /> },
                  { value: 'medium', label: 'Medium — drawn twice', icon: <SketchLevelIcon level="medium" /> },
                  { value: 'heavy', label: 'Heavy — twice, and past every corner', icon: <SketchLevelIcon level="heavy" /> },
                ]}
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
                mixed={picked.mixed}
                value={String(picked.value ?? 'solid')}
                onChange={(v) =>
                  setAppearance({ fillStyle: v === 'solid' ? undefined : (v as FillStyle) })
                }
                segments={[
                  { value: 'solid', label: 'Solid — a flat fill', icon: <FillStyleIcon style="solid" /> },
                  { value: 'hachure', label: 'Hachure — parallel pen strokes', icon: <FillStyleIcon style="hachure" /> },
                  { value: 'crosshatch', label: 'Cross-hatch — two sets, crossed', icon: <FillStyleIcon style="crosshatch" /> },
                  { value: 'zigzag', label: 'Scribble — continuous back-and-forth pen marks', icon: <FillStyleIcon style="zigzag" /> },
                  { value: 'dots', label: 'Stipple — hand-drawn dots', icon: <FillStyleIcon style="dots" /> },
                ]}
              />
            );
          })()}
        </Row>
      )}

      {/*
        How the shading is laid — the two things a hand varies and this could
        not.

        The gap and the angle were both single constants, so every hachured
        shape on a board carried the same weight of grey and ran in the same
        direction. Density is what pen shading is *for*: a drawing tells a light
        surface from a dark one by how densely it is hatched. And a shared angle
        means two hatched shapes laid over each other shade in lockstep, so the
        pair reads as one continuous field rather than two objects — turning one
        of them is how a drawing separates them.

        Only where there are strokes to lay. A solid fill has no shading, and a
        density on one is a number nothing reads.
      */}
      {capabilities.supportsFill && level && allClosed && style !== 'solid' && (
        <>
          <Row label="Density" hint="How closely the strokes are laid. This is what makes one shape read as darker than another.">
            {(() => {
              const density = sharedPaint((a) => a.shadingDensity ?? 'medium');
              return (
                <SegmentedControl
                  ariaLabel="Shading density"
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
          </Row>
          <Row label="Angle" hint="Which way the strokes run. Turn one of two overlapping shapes and they stop reading as one field.">
            {(() => {
              const angle = sharedPaint((a) => a.shadingAngle ?? HACHURE_ANGLE);
              return (
                <NumberStepper
                  value={Math.round(angle.value ?? HACHURE_ANGLE)}
                  mixed={angle.mixed}
                  onChange={(v) => setAppearance({ shadingAngle: v })}
                  min={-90}
                  max={90}
                  step={5}
                  suffix="°"
                />
              );
            })()}
          </Row>
        </>
      )}
    </Accordion>
  );
};
