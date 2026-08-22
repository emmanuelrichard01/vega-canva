import React from 'react';
import { Droplets, Moon, Sun } from 'lucide-react';
import { Accordion, Row } from '../panelPrimitives';
import { ColorPickerPopover } from '../../ui/ColorPickerPopover';
import { NumberStepper } from '../../ui/NumberStepper';
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

  return (
    <>
      {capabilities.supportsShadow && (
        <Accordion
          title="Drop shadow"
          icon={<Sun size={13} />}
          defaultOpen={Boolean(appearance.shadow)}
          badge={appearance.shadow ? 'On' : undefined}
        >
          <Row label="Enabled" hint="A shadow cast outward, behind the object.">
            <input
              type="checkbox"
              checked={Boolean(appearance.shadow)}
              onChange={(e) =>
                setAppearance({ shadow: e.target.checked ? { ...DEFAULT_SHADOW } : undefined })
              }
              aria-label="Drop shadow"
            />
          </Row>
          {appearance.shadow && (
            <>
              <Row label="Color">
                <ColorPickerPopover
                  color={appearance.shadow.color}
                  mixed={sharedPaint((a) => a.shadow?.color).mixed}
                  onChange={(color) => setShadow({ color })}
                />
              </Row>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
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

      {capabilities.supportsEdgeEffects && !openShape && (
        <Accordion
          title="Inner shadow"
          icon={<Moon size={13} />}
          defaultOpen={Boolean(appearance.innerShadow)}
          badge={appearance.innerShadow ? 'On' : undefined}
        >
          <Row label="Enabled">
            <input
              type="checkbox"
              checked={Boolean(appearance.innerShadow)}
              onChange={(e) =>
                setAppearance({ innerShadow: e.target.checked ? { ...DEFAULT_INNER_SHADOW } : undefined })
              }
              aria-label="Inner shadow"
            />
          </Row>
          {appearance.innerShadow && (
            <>
              <Row label="Color">
                <ColorPickerPopover
                  color={appearance.innerShadow.color}
                  mixed={sharedPaint((a) => a.innerShadow?.color).mixed}
                  onChange={(color) => setInnerShadow({ color })}
                />
              </Row>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
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
