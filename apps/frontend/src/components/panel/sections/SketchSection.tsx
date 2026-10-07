import React from 'react';
import { RefreshCw } from 'lucide-react';
import { NumberField, Note, PairRow, PanelSubjectContext, Row, Section, SegmentedControl } from '../grammar';
import {
  CleanLookGlyph,
  FillStyleIcon,
  HatchAngleGlyph,
  ShadingDensityIcon,
  SketchLevelIcon,
  SketchLookGlyph,
} from '../sketchIcons';
import { HACHURE_ANGLE, SHADING_DENSITIES, SKETCH_LEVELS } from '../../../engine/model/rough';
import { DEFAULT_BOARD_SKETCH, resolveSketch, sketchPatch, sketchSource } from '../../../engine/model/roughMode';
import { useBoardSketch } from '../../../engine/model/roughBoard';
import {
  FILL_STYLE_LABELS,
  FILL_STYLE_NAMES,
  FILL_STYLE_ORDER,
  SHADING_DENSITY_HINTS,
  SHADING_DENSITY_LABELS,
  SKETCH_LEVEL_LABELS,
  SKETCH_LEVEL_NAMES,
  SKETCH_LOOK_LABELS,
} from '../../../engine/model/shadingLabels';
import type { Appearance, FillStyle, ShadingDensity, SketchLevel } from '../../../engine/model/schema';
import type { Shared } from '../../../engine/model/selection';
import './sketch.css';

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

/**
 * How the marks are made: crisp or by hand, how rough, and how the inside is
 * shaded.
 *
 * Its own section rather than part of Stroke, because a sketch decides how the
 * outline *and* the fill are drawn, and the shading acts on the interior.
 *
 * The look is the object's own answer to the board's sketch mode. With the
 * board crisp, Sketch pins a level on this object. With the board sketched,
 * the object follows it until it is pinned to another level or set to Clean,
 * and the section says which of those it is doing, with a way back.
 */
export const SketchSection: React.FC<SketchSectionProps> = ({
  capabilities,
  appearance,
  sketchable,
  allClosed,
  sharedPaint,
  setAppearance,
}) => {
  const boardLevel = useBoardSketch();
  // A pencil stroke follows only its own choice (see `BOARD_SKETCH_TYPES`).
  const subject = React.useContext(PanelSubjectContext);
  const board = subject === 'path' ? null : boardLevel;
  if (!sketchable || !appearance) return null;

  const level = resolveSketch(appearance, board);
  const style: FillStyle = appearance.fillStyle ?? 'solid';
  const shades = Boolean(capabilities.supportsFill) && allClosed;

  const look = sharedPaint((a) => (resolveSketch(a, board) ? 'sketch' : 'clean'));
  const roughness = sharedPaint((a) => resolveSketch(a, board) ?? 'off');
  const overridden = board ? sharedPaint((a) => sketchSource(a, board) !== 'board') : null;
  const anyOverridden = Boolean(overridden && (overridden.mixed || overridden.value));

  const badge = !level
    ? undefined
    : style === 'solid' || !shades
      ? SKETCH_LEVEL_NAMES[level]
      : `${SKETCH_LEVEL_NAMES[level]} · ${FILL_STYLE_NAMES[style]}`;

  return (
    <Section id="style" title="Sketch" meta={badge}>
      <Row label="Look" hint="Draw this by hand. The drawing is seeded, so it never re-randomises.">
        <SegmentedControl
          ariaLabel="Look"
          fill
          mixed={look.mixed}
          value={String(look.value ?? 'clean')}
          onChange={(v) => {
            // Choosing the look it already has changes nothing: a pinned
            // level stays pinned.
            if (!look.mixed && v === look.value) return;
            setAppearance(
              v === 'clean'
                ? sketchPatch('clean', board)
                : sketchPatch(board ? 'follow' : DEFAULT_BOARD_SKETCH, board)
            );
          }}
          segments={[
            { value: 'clean', label: SKETCH_LOOK_LABELS.clean, icon: <CleanLookGlyph /> },
            { value: 'sketch', label: SKETCH_LOOK_LABELS.sketch, icon: <SketchLookGlyph /> },
          ]}
        />
      </Row>

      {board && (
        <Note>
          {anyOverridden ? (
            <>
              Set apart from the board&rsquo;s sketch mode.{' '}
              <button type="button" className="sketch-follow" onClick={() => setAppearance(sketchPatch('follow', board))}>
                Follow the board
              </button>
            </>
          ) : (
            <>Following the board&rsquo;s sketch mode ({SKETCH_LEVEL_NAMES[board]}).</>
          )}
        </Note>
      )}

      {level && (
        <Row label="Roughness" hint="How loose the hand is. Pins this object to the level you pick.">
          <SegmentedControl
            ariaLabel="Roughness"
            fill
            mixed={roughness.mixed}
            value={String(roughness.value ?? level)}
            onChange={(v) => setAppearance(sketchPatch(v as SketchLevel, board))}
            segments={SKETCH_LEVELS.map((id) => ({
              value: id,
              label: SKETCH_LEVEL_LABELS[id],
              icon: <SketchLevelIcon level={id} />,
            }))}
          />
        </Row>
      )}

      {level && shades && (
        <Row stack label="Fill" hint="How the inside is filled: flat colour, or pen marks laid across it.">
          {(() => {
            const picked = sharedPaint((a) => a.fillStyle ?? 'solid');
            return (
              <SegmentedControl
                ariaLabel="Sketch fill style"
                fill
                mixed={picked.mixed}
                value={String(picked.value ?? 'solid')}
                onChange={(v) => setAppearance({ fillStyle: v === 'solid' ? undefined : (v as FillStyle) })}
                segments={FILL_STYLE_ORDER.map((id) => ({
                  value: id,
                  label: FILL_STYLE_LABELS[id],
                  icon: <FillStyleIcon style={id} />,
                }))}
              />
            );
          })()}
        </Row>
      )}

      {/* Density and angle together: the two dimensions of how shading reads as tone. */}
      {level && shades && style !== 'solid' && (
        <PairRow>
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
              <NumberField
                label="Shading angle"
                glyph={<HatchAngleGlyph degrees={angle.mixed ? 0 : value} />}
                unit="deg"
                value={angle.mixed ? 'mixed' : value}
                onChange={(v) => setAppearance({ shadingAngle: v })}
                min={-90}
                max={90}
                step={5}
              />
            );
          })()}
        </PairRow>
      )}

      {/*
        Draw it again: a variant number mixed into the seed gives a different
        drawing at the same settings, every one as stable as the first. A verb,
        so it sits below the settings; offered whenever the object is sketched.
      */}
      {level && (
        <button
          type="button"
          className="sketch-redraw"
          onClick={() => {
            const current = sharedPaint((a) => a.sketchSeed ?? 0);
            // A counter rather than a random number: it lands in the document,
            // and walking forward keeps every earlier drawing reachable.
            const next = (typeof current.value === 'number' ? current.value : 0) + 1;
            setAppearance({ sketchSeed: next });
          }}
          data-tooltip="A different hand, same settings"
          data-tooltip-pos="left"
        >
          <RefreshCw size={13} aria-hidden="true" />
          Redraw
        </button>
      )}
    </Section>
  );
};
