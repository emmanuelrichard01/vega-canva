import React from 'react';
import { Droplets, MoveHorizontal, MoveVertical, Sun } from 'lucide-react';
import { Accordion, Row, SubGroup } from '../panelPrimitives';
import { ColorPickerPopover } from '../../ui/ColorPickerPopover';
import { EyedropperButton } from '../../ui/EyedropperButton';
import { NumberStepper } from '../../ui/NumberStepper';
import { Slider } from '../../ui/Slider';
import {
  DEFAULT_SHADOW_COLOR,
  type Appearance,
  type Shadow,
} from '../../../engine/model/schema';
import { fillsInterior } from '../../../engine/model/rough';
import type { Shared } from '../../../engine/model/selection';

const DEFAULT_SHADOW: Shadow = {
  color: DEFAULT_SHADOW_COLOR,
  blur: 12,
  offsetX: 0,
  offsetY: 4,
  spread: 0,
  opacity: 0.25,
};

const DEFAULT_INNER_SHADOW: Shadow = {
  color: DEFAULT_SHADOW_COLOR,
  blur: 8,
  offsetX: 0,
  offsetY: 2,
  spread: 0,
  opacity: 0.35,
};

interface EffectsSectionProps {
  capabilities: {
    supportsShadow?: boolean;
    supportsShadowSpread?: boolean;
    supportsEdgeEffects?: boolean;
  };
  appearance: Appearance | undefined;
  openShape: boolean;
  hasConnector: boolean;
  hasImage: boolean;
  sharedPaint: <T>(read: (a: Appearance) => T) => Shared<T>;
  setAppearance: (patch: Partial<Appearance>) => void;
  setShadow: (patch: Partial<Shadow>) => void;
  setInnerShadow: (patch: Partial<Shadow>) => void;
}

export const EffectsSection: React.FC<EffectsSectionProps> = ({
  capabilities,
  appearance,
  openShape,
  hasConnector,
  hasImage,
  sharedPaint,
  setAppearance,
  setShadow,
  setInnerShadow,
}) => {
  if (!appearance) return null;

  /**
   * Whether this shape's interior is drawn with pen marks rather than filled.
   *
   * Hachure, cross-hatch, zigzag and dots leave the shape *open*: the marks are
   * the fill, and there is no enclosed region for an edge effect to sit inside.
   * A solid fill does have one — including a sketched solid fill, which clips
   * against the drawn silhouette rather than the ruled outline beneath it.
   */
  const penShaded = Boolean(appearance.sketch) && !fillsInterior(appearance.fillStyle);

  const canInnerShadow = Boolean(capabilities.supportsEdgeEffects) && !openShape;

  /** Which sides are lit, without either sub-section being opened. */
  const shadowBadge =
    appearance.shadow && appearance.innerShadow
      ? 'Drop + Inner'
      : appearance.shadow
        ? 'Drop'
        : appearance.innerShadow
          ? 'Inner'
          : undefined;

  return (
    <>
      {/*
        One question, asked once.

        Drop shadow and inner shadow were two top-level accordions sitting
        beside Blur and Typography, so the panel offered "shadow" twice at the
        same rank and never said the two were related — while a shape carrying
        both showed two badges four rows apart with nothing to say they were the
        same light. They are one decision seen from either side of an edge, and
        the badge now reports which sides are lit without either being opened.

        ## Why the two are no longer accordions of their own

        Each was a *nested accordion* containing a row labelled "Enabled" with
        a switch in it — so turning on a drop shadow meant opening a section to
        find a control whose only job was to reveal the rest of that section.
        Three affordances for one fact, and two of them redundant: the switch
        already knows whether the shadow exists, and "open but off" and "closed
        but on" are both states the panel could get into and neither means
        anything.

        A `SubGroup` is the switch *as* the disclosure, which is what the text
        effects below already use for exactly this shape. Turning it on reveals
        its controls; turning it off puts them away. One control, one fact, and
        no state that can disagree with itself.
      */}
      {(capabilities.supportsShadow || canInnerShadow) && (
        <Accordion
          title="Shadow"
          icon={<Sun size={13} />}
          defaultOpen={Boolean(appearance.shadow || appearance.innerShadow)}
          badge={shadowBadge}
        >
          {capabilities.supportsShadow && (
            <SubGroup
              label="Drop"
              hint="A shadow cast outward, behind the object."
              on={Boolean(appearance.shadow)}
              onToggle={(on) => setAppearance({ shadow: on ? { ...DEFAULT_SHADOW } : undefined })}
            >
              {appearance.shadow && (
                <>
                  <Row label="Colour">
                    {/*
                      A pipette, like every other colour in the panel.

                      A shadow's colour is the one most often sampled *from the
                      scene* — it is usually a darker relative of the surface
                      it falls on, not a neutral grey — and it was the last
                      colour here still offered without one.
                    */}
                    <div className="prop-inline">
                      <ColorPickerPopover
                        color={appearance.shadow.color}
                        mixed={sharedPaint((a) => a.shadow?.color).mixed}
                        onChange={(color) => setShadow({ color })}
                      />
                      <EyedropperButton
                        label="Pick a shadow colour from the screen"
                        onPick={(color) => setShadow({ color })}
                      />
                    </div>
                  </Row>
                  {/*
                    Where the light is, as two offsets rather than an angle and
                    a distance.

                    Illustrator's effect dialog offers the polar pair and Figma
                    offers this one; the reason to follow Figma here is that
                    everything else on a canvas is already Cartesian — the
                    Transform block above is X and Y, nudging is X and Y, and
                    an offset that reads "8 down" composes with those. An angle
                    would be the better control for matching several objects to
                    one light source, which is a feature this does not have yet
                    and which wants a document-level setting rather than a
                    second spelling of the same field.

                    Two numbers that mean one thing, so they share a row.
                  */}
                  <div className="prop-grid">
                    <NumberStepper
                      aria-label="Shadow offset X"
                      glyph={<MoveHorizontal size={13} />}
                      suffix="px"
                      value={Math.round(appearance.shadow.offsetX)}
                      onChange={(v) => setShadow({ offsetX: v })}
                    />
                    <NumberStepper
                      aria-label="Shadow offset Y"
                      glyph={<MoveVertical size={13} />}
                      suffix="px"
                      value={Math.round(appearance.shadow.offsetY)}
                      onChange={(v) => setShadow({ offsetY: v })}
                    />
                  </div>
                  {/*
                    Blur, spread and opacity are tracks; the offsets are not.

                    The distinction is what you know when you arrive. An offset
                    is a *position* — "eight down and four across" is a thing
                    you can mean exactly. Softness and strength are the other
                    kind: nobody wants 37% opacity, they want "a little
                    lighter", and finding that by pressing an arrow while
                    looking at the canvas is the worst version of this control.

                    No tick marks on any of the three. Blur carried two, at 8
                    and 24 — the contact shadow and the lifted one — and they
                    sat crowded against the left end of a track that runs to
                    200, annotating a tenth of it and saying nothing about the
                    rest.
                  */}
                  <Slider
                    label="Blur"
                    unit="px"
                    value={Math.round(appearance.shadow.blur)}
                    min={0}
                    max={200}
                    onChange={(v) => setShadow({ blur: v })}
                    hint="How soft the edge is. Zero is a hard-edged copy of the shape."
                  />
                  {capabilities.supportsShadowSpread && !openShape && (
                    <Slider
                      label="Spread"
                      unit="px"
                      value={Math.round(appearance.shadow.spread ?? 0)}
                      min={0}
                      max={100}
                      onChange={(v) => setShadow({ spread: v })}
                      hint="Grows the shadow's own silhouette before it is blurred."
                    />
                  )}
                  <Slider
                    label="Opacity"
                    unit="%"
                    value={Math.round((appearance.shadow.opacity ?? 1) * 100)}
                    min={0}
                    max={100}
                    onChange={(v) => setShadow({ opacity: v / 100 })}
                  />
                </>
              )}
            </SubGroup>
          )}

          {canInnerShadow &&
            (penShaded ? (
              /*
                Withdrawn on a pen-shaded sketch, rather than left to do nothing.

                An inner shadow falls across the inside of an edge, and a
                hachured, cross-hatched, zigzagged or stippled shape has no
                inside — the marks *are* the fill. A solid fill does have one,
                and a sketch with a solid fill now casts against its drawn
                silhouette rather than the ruled outline beneath it.

                Saying why matters here more than usual: this control used to be
                offered on every sketched shape and honoured on none of them,
                because the renderer's sketch branch returns before its effects.
              */
              <p className="prop-note">
                Inner shadow needs an inside. Pen shading leaves the shape open —
                the marks are the fill — so set the fill to Solid to use one.
              </p>
            ) : (
              <SubGroup
                label="Inner"
                hint="A shadow cast inward, as though the shape were a hole."
                on={Boolean(appearance.innerShadow)}
                onToggle={(on) =>
                  setAppearance({ innerShadow: on ? { ...DEFAULT_INNER_SHADOW } : undefined })
                }
              >
                {appearance.innerShadow && (
                  <>
                    <Row label="Colour">
                      <div className="prop-inline">
                        <ColorPickerPopover
                          color={appearance.innerShadow.color}
                          mixed={sharedPaint((a) => a.innerShadow?.color).mixed}
                          onChange={(color) => setInnerShadow({ color })}
                        />
                        <EyedropperButton
                          label="Pick an inner shadow colour from the screen"
                          onPick={(color) => setInnerShadow({ color })}
                        />
                      </div>
                    </Row>
                    <div className="prop-grid">
                      <NumberStepper
                        aria-label="Inner shadow offset X"
                        glyph={<MoveHorizontal size={13} />}
                        suffix="px"
                        value={Math.round(appearance.innerShadow.offsetX)}
                        onChange={(v) => setInnerShadow({ offsetX: v })}
                      />
                      <NumberStepper
                        aria-label="Inner shadow offset Y"
                        glyph={<MoveVertical size={13} />}
                        suffix="px"
                        value={Math.round(appearance.innerShadow.offsetY)}
                        onChange={(v) => setInnerShadow({ offsetY: v })}
                      />
                    </div>
                    {/* The same three as the drop shadow, and the same
                        reasoning — see the note there. Two shadow panels whose
                        identical controls behaved differently would be a worse
                        inconsistency than either choice. */}
                    <Slider
                      label="Blur"
                      unit="px"
                      value={Math.round(appearance.innerShadow.blur)}
                      min={0}
                      max={200}
                        onChange={(v) => setInnerShadow({ blur: v })}
                      hint="How soft the inner edge is."
                    />
                    <Slider
                      label="Spread"
                      unit="px"
                      value={Math.round(appearance.innerShadow.spread ?? 0)}
                      min={0}
                      max={100}
                      onChange={(v) => setInnerShadow({ spread: v })}
                      hint="How far into the shape the shadow reaches before it is blurred."
                    />
                    <Slider
                      label="Opacity"
                      unit="%"
                      value={Math.round((appearance.innerShadow.opacity ?? 1) * 100)}
                      min={0}
                      max={100}
                        onChange={(v) => setInnerShadow({ opacity: v / 100 })}
                    />
                  </>
                )}
              </SubGroup>
            ))}
        </Accordion>
      )}

      {!hasConnector && (!hasImage || (capabilities.supportsEdgeEffects && !openShape)) && (
        <Accordion
          title="Blur"
          icon={<Droplets size={13} />}
          defaultOpen={Boolean(appearance.blur || appearance.backdropBlur)}
        >
          {!hasImage && (
            <Row label="Layer" hint="Blurs this object itself.">
              {(() => {
                const blur = sharedPaint((a) => a.blur ?? 0);
                return (
                  <NumberStepper
                    value={Math.round(blur.value ?? 0)}
                    mixed={blur.mixed}
                    onChange={(v) => setAppearance({ blur: v > 0 ? v : undefined })}
                    min={0}
                    max={100}
                    step={2}
                    suffix="px"
                  />
                );
              })()}
            </Row>
          )}
          {capabilities.supportsEdgeEffects && !openShape && (
            <Row label="Backdrop" hint="Blurs the board behind this object. Only visible through a fill that is not fully opaque.">
              {(() => {
                const backdrop = sharedPaint((a) => a.backdropBlur ?? 0);
                return (
                  <NumberStepper
                    value={Math.round(backdrop.value ?? 0)}
                    mixed={backdrop.mixed}
                    onChange={(v) => setAppearance({ backdropBlur: v > 0 ? v : undefined })}
                    min={0}
                    max={100}
                    step={2}
                    suffix="px"
                  />
                );
              })()}
            </Row>
          )}
        </Accordion>
      )}
    </>
  );
};
