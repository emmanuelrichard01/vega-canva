import React from 'react';
import { Blend, Minus } from 'lucide-react';
import { ColorChip, NumberField, Row, Section, Select } from '../grammar';
import { EyedropperButton } from '../../ui/EyedropperButton';
import { FillEditor } from '../../ui/FillEditor';
import {
  BLEND_MODES,
  type AnyNode,
  type Appearance,
  type BlendMode,
  type Paint,
} from '../../../engine/model/schema';
import type { Shared } from '../../../engine/model/selection';
import { CornerRadiusRow } from '../CornerRadiusRow';

const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'Colour dodge',
  'color-burn': 'Colour burn',
  'hard-light': 'Hard light',
  'soft-light': 'Soft light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Colour',
  luminosity: 'Luminosity',
};

const BLEND_GROUP: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Darken',
  darken: 'Darken',
  'color-burn': 'Darken',
  screen: 'Lighten',
  lighten: 'Lighten',
  'color-dodge': 'Lighten',
  overlay: 'Contrast',
  'soft-light': 'Contrast',
  'hard-light': 'Contrast',
  difference: 'Compare',
  exclusion: 'Compare',
  hue: 'Component',
  saturation: 'Component',
  color: 'Component',
  luminosity: 'Component',
};

const NO_FILL: Paint = { type: 'solid', color: 'transparent', opacity: 0 };
const DEFAULT_FILL: Paint = { type: 'solid', color: '#D9D9D9' };

/** A paint that draws nothing: no fill at all, or a transparent solid. */
export function isEmptyPaint(paint: Paint | undefined): boolean {
  if (!paint) return true;
  return paint.type === 'solid' && (paint.color === 'transparent' || paint.opacity === 0);
}

interface Capabilities {
  supportsFill?: boolean;
  supportsOpacity?: boolean;
  supportsRadius?: boolean;
  supportsStroke?: boolean;
}

interface AppearanceSectionProps {
  capabilities: Capabilities;
  appearance: Appearance | undefined;
  openShape: boolean;
  hasConnector: boolean;
  sharedPaint: <T>(read: (a: Appearance) => T) => Shared<T>;
  opacityShared: Shared<number | undefined>;
  setAppearance: (patch: Partial<Appearance>) => void;
  set: (updates: Partial<AnyNode>) => void;
  /** Moves each object's opacity by a delta, for a mixed selection. */
  nudgeOpacity: (delta: number) => void;
}

/** Appearance: opacity, corner radius and blend, the layer-level look. */
export const AppearanceSection: React.FC<AppearanceSectionProps> = ({
  capabilities,
  appearance,
  openShape,
  hasConnector,
  sharedPaint,
  opacityShared,
  setAppearance,
  set,
  nudgeOpacity,
}) => {
  const showRadius = capabilities.supportsRadius && !openShape;
  const showBlend = Boolean(appearance) && !hasConnector;
  if (!capabilities.supportsOpacity && !showRadius && !showBlend) return null;
  const blend = sharedPaint((a) => a.blendMode ?? 'normal');

  return (
    <Section id="appearance" title="Appearance">
      {capabilities.supportsOpacity && (
        <Row label="Opacity">
          <NumberField
            label="Opacity"
            glyph={<Blend size={12} />}
            unit="%"
            min={0}
            max={100}
            value={opacityShared.mixed ? 'mixed' : Math.round((opacityShared.value ?? 1) * 100)}
            onChange={(v) => set({ opacity: v / 100 })}
            onNudge={(d) => nudgeOpacity(d / 100)}
          />
        </Row>
      )}
      {showRadius && (
        <CornerRadiusRow
          value={sharedPaint((a) => a.cornerRadius)}
          onChange={(cornerRadius) => setAppearance({ cornerRadius })}
        />
      )}
      {showBlend && (
        <Row label="Blend" hint="How this object's pixels combine with whatever is beneath it.">
          <Select<BlendMode>
            label="Blend mode"
            value={blend.mixed ? 'mixed' : (blend.value as BlendMode)}
            options={BLEND_MODES.map((mode) => ({ value: mode, label: BLEND_LABELS[mode], group: BLEND_GROUP[mode] }))}
            onChange={(mode) => setAppearance({ blendMode: mode === 'normal' ? undefined : mode })}
          />
        </Row>
      )}
    </Section>
  );
};

interface FillSectionProps {
  capabilities: Capabilities;
  appearance: Appearance | undefined;
  openShape: boolean;
  sharedPaint: <T>(read: (a: Appearance) => T) => Shared<T>;
  setAppearance: (patch: Partial<Appearance>) => void;
  /** For line-like objects with no fill, whose one colour is their stroke. */
  setConnectorLikeColor: (color: string) => void;
}

function paintLabel(paint: Paint): string {
  switch (paint.type) {
    case 'linear':
      return 'Linear';
    case 'radial':
      return 'Radial';
    case 'conic':
      return 'Angular';
    case 'diamond':
      return 'Diamond';
    default:
      return 'Solid';
  }
}

/**
 * Fill: the object's paint, as a list of one.
 *
 * The renderers draw a single paint, so the list never offers a second. An
 * empty fill shrinks the section to its header and `+`; `−` removes it.
 */
export const FillSection: React.FC<FillSectionProps> = ({
  capabilities,
  appearance,
  openShape,
  sharedPaint,
  setAppearance,
  setConnectorLikeColor,
}) => {
  if (!appearance) return null;

  if (!capabilities.supportsFill && capabilities.supportsStroke) {
    const color = sharedPaint((a) => a.stroke?.color ?? 'transparent');
    return (
      <Section id="fill" title="Colour">
        <div className="pg-list-item">
          <ColorChip
            label="Colour"
            value={color.mixed ? 'mixed' : appearance.stroke?.color ?? 'transparent'}
            onChange={setConnectorLikeColor}
          />
          <EyedropperButton label="Pick a colour from the screen" onPick={setConnectorLikeColor} />
        </div>
      </Section>
    );
  }

  if (!capabilities.supportsFill || openShape) return null;

  const paint = appearance.fill?.[0];
  const mixed = sharedPaint((a) => JSON.stringify(a.fill?.[0] ?? null)).mixed;
  const empty = !mixed && isEmptyPaint(paint);

  const setPaint = (next: Paint) => setAppearance({ fill: [next] });

  return (
    <Section
      id="fill"
      title="Fill"
      empty={empty}
      onAdd={empty ? () => setPaint(DEFAULT_FILL) : undefined}
      addLabel="Add fill"
    >
      <div className="pg-list-item">
        {paint && paint.type === 'solid' && !mixed ? (
          <ColorChip
            label="Fill"
            value={paint.color}
            opacity={paint.opacity ?? 1}
            allowNone={false}
            swatch={<FillEditor paint={paint} mixed={mixed} onChange={setPaint} />}
            onChange={(color) => setPaint({ ...paint, color })}
            onOpacityChange={(o) => setPaint({ ...paint, opacity: o >= 1 ? undefined : o })}
          />
        ) : (
          <div className="pg-paint">
            <FillEditor paint={paint} mixed={mixed} onChange={setPaint} />
            <span className="pg-paint__name">{mixed ? 'Mixed' : paint ? paintLabel(paint) : 'None'}</span>
          </div>
        )}
        <button
          type="button"
          className="pg-icon-btn"
          aria-label="Remove fill"
          data-tooltip="Remove fill"
          onClick={() => setPaint(NO_FILL)}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
      </div>
    </Section>
  );
};
