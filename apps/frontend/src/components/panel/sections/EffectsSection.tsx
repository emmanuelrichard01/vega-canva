import React from 'react';
import { Droplets, Sun } from 'lucide-react';
import { Accordion, Row } from '../panelPrimitives';
import { ColorPickerPopover } from '../../ui/ColorPickerPopover';
import { NumberStepper } from '../../ui/NumberStepper';
import { Switch } from '../../ui/Switch';
import {
  DEFAULT_SHADOW_COLOR,
  type Appearance,
  type Shadow,
} from '../../../engine/model/schema';
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
  const penShaded =
    Boolean(appearance.sketch) &&
    Boolean(appearance.fillStyle) &&
    appearance.fillStyle !== 'solid';

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
      */}
      {(capabilities.supportsShadow || canInnerShadow) && (
        <Accordion
          title="Shadow"
          icon={<Sun size={13} />}
          defaultOpen={Boolean(appearance.shadow || appearance.innerShadow)}
          badge={shadowBadge}
        >
          {capabilities.supportsShadow && (
            <Accordion
              nested
              title="Drop"
              defaultOpen={Boolean(appearance.shadow)}
              badge={appearance.shadow ? 'On' : undefined}
            >
              {/*
                A real switch, not a bare `<input type="checkbox">`.

                This panel had two of them, and they were the only two controls
                in the whole inspector that rendered as the browser's own
                checkbox — a different size, colour and focus ring from every
                other toggle in the app, on the two rows that turn a feature on.
              */}
              <Row label="Enabled" hint="A shadow cast outward, behind the object.">
                <Switch
                  checked={Boolean(appearance.shadow)}
                  onChange={(on) => setAppearance({ shadow: on ? { ...DEFAULT_SHADOW } : undefined })}
                  tooltip="Drop shadow"
                />
              </Row>
              {appearance.shadow && (
                <>
                  <Row label="Colour">
                    <ColorPickerPopover
                      color={appearance.shadow.color}
                      mixed={sharedPaint((a) => a.shadow?.color).mixed}
                      onChange={(color) => setShadow({ color })}
                    />
                  </Row>
                  {/* Two numbers that mean one thing — where the light is —
                      so they share a row rather than stacking. */}
                  <div className="prop-pair">
                    <NumberStepper
                      value={Math.round(appearance.shadow.offsetX)}
                      onChange={(v) => setShadow({ offsetX: v })}
                      label="X"
                    />
                    <NumberStepper
                      value={Math.round(appearance.shadow.offsetY)}
                      onChange={(v) => setShadow({ offsetY: v })}
                      label="Y"
                    />
                  </div>
                  <Row label="Blur">
                    <NumberStepper
                      value={Math.round(appearance.shadow.blur)}
                      onChange={(v) => setShadow({ blur: v })}
                      min={0}
                      max={200}
                    />
                  </Row>
                  {capabilities.supportsShadowSpread && !openShape && (
                    <Row label="Spread" hint="Grows the shadow's own silhouette before it is blurred.">
                      <NumberStepper
                        value={Math.round(appearance.shadow.spread ?? 0)}
                        onChange={(v) => setShadow({ spread: v })}
                        min={0}
                        max={100}
                      />
                    </Row>
                  )}
                  <Row label="Opacity">
                    <NumberStepper
                      value={Math.round((appearance.shadow.opacity ?? 1) * 100)}
                      onChange={(v) => setShadow({ opacity: v / 100 })}
                      min={0}
                      max={100}
                      step={10}
                    />
                  </Row>
                </>
              )}
            </Accordion>
          )}

          {canInnerShadow && (
            <Accordion
              nested
              title="Inner"
              defaultOpen={Boolean(appearance.innerShadow)}
              badge={appearance.innerShadow ? 'On' : undefined}
            >
              {/*
                Withdrawn on a pen-shaded sketch, rather than left to do nothing.

                An inner shadow falls across the inside of an edge, and a
                hachured, cross-hatched, zigzagged or stippled shape has no
                inside — the marks *are* the fill. A solid fill does have one,
                and a sketch with a solid fill now casts against its drawn
                silhouette rather than the ruled outline beneath it.

                Saying why matters here more than usual: this control used to be
                offered on every sketched shape and honoured on none of them,
                because the renderer's sketch branch returns before its effects.
              */}
              {penShaded ? (
                <p className="prop-note">
                  Pen shading leaves the shape open, so there is no inside for a
                  shadow to fall across. Set the fill to Solid to use one.
                </p>
              ) : (
                <>
                  <Row label="Enabled" hint="A shadow cast inward, as though the shape were a hole.">
                    <Switch
                      checked={Boolean(appearance.innerShadow)}
                      onChange={(on) =>
                        setAppearance({ innerShadow: on ? { ...DEFAULT_INNER_SHADOW } : undefined })
                      }
                      tooltip="Inner shadow"
                    />
                  </Row>
                  {appearance.innerShadow && (
                    <>
                      <Row label="Colour">
                        <ColorPickerPopover
                          color={appearance.innerShadow.color}
                          mixed={sharedPaint((a) => a.innerShadow?.color).mixed}
                          onChange={(color) => setInnerShadow({ color })}
                        />
                      </Row>
                      <div className="prop-pair">
                        <NumberStepper
                          value={Math.round(appearance.innerShadow.offsetX)}
                          onChange={(v) => setInnerShadow({ offsetX: v })}
                          label="X"
                        />
                        <NumberStepper
                          value={Math.round(appearance.innerShadow.offsetY)}
                          onChange={(v) => setInnerShadow({ offsetY: v })}
                          label="Y"
                        />
                      </div>
                      <Row label="Blur">
                        <NumberStepper
                          value={Math.round(appearance.innerShadow.blur)}
                          onChange={(v) => setInnerShadow({ blur: v })}
                          min={0}
                          max={200}
                        />
                      </Row>
                      <Row label="Spread">
                        <NumberStepper
                          value={Math.round(appearance.innerShadow.spread ?? 0)}
                          onChange={(v) => setInnerShadow({ spread: v })}
                          min={0}
                          max={100}
                        />
                      </Row>
                      <Row label="Opacity">
                        <NumberStepper
                          value={Math.round((appearance.innerShadow.opacity ?? 1) * 100)}
                          onChange={(v) => setInnerShadow({ opacity: v / 100 })}
                          min={0}
                          max={100}
                          step={10}
                        />
                      </Row>
                    </>
                  )}
                </>
              )}
            </Accordion>
          )}
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
