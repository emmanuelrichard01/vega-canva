import React from 'react';
import { Droplets, Minus, MoveHorizontal, MoveVertical, Scan, Sun, SunDim } from 'lucide-react';
import { ColorChip, NumberField, Note, PairRow, Section } from '../grammar';
import type { MenuEntry } from '../../menu/menuModel';
import { DEFAULT_SHADOW_COLOR, type Appearance, type Shadow } from '../../../engine/model/schema';
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

type EffectId = 'shadow' | 'innerShadow' | 'blur' | 'backdropBlur';

const EFFECT_LABELS: Record<EffectId, string> = {
  shadow: 'Drop shadow',
  innerShadow: 'Inner shadow',
  blur: 'Layer blur',
  backdropBlur: 'Background blur',
};

const EFFECT_ICONS: Record<EffectId, React.ReactNode> = {
  shadow: <Sun size={14} />,
  innerShadow: <SunDim size={14} />,
  blur: <Droplets size={14} />,
  backdropBlur: <Scan size={14} />,
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

/** The heading of one effect in the list, with its remove control. */
const EffectHead: React.FC<{ id: EffectId; onRemove: () => void }> = ({ id, onRemove }) => (
  <div className="pg-effect__head">
    <span className="pg-effect__icon" aria-hidden="true">{EFFECT_ICONS[id]}</span>
    <span className="pg-effect__name">{EFFECT_LABELS[id]}</span>
    <button
      type="button"
      className="pg-icon-btn"
      aria-label={`Remove ${EFFECT_LABELS[id].toLowerCase()}`}
      data-tooltip="Remove"
      onClick={onRemove}
    >
      <Minus size={14} aria-hidden="true" />
    </button>
  </div>
);

const ShadowFields: React.FC<{
  name: string;
  shadow: Shadow;
  colorMixed: boolean;
  allowSpread: boolean;
  onChange: (patch: Partial<Shadow>) => void;
}> = ({ name, shadow, colorMixed, allowSpread, onChange }) => (
  <>
    <ColorChip
      label={name}
      value={colorMixed ? 'mixed' : shadow.color}
      opacity={shadow.opacity ?? 1}
      allowNone={false}
      onChange={(color) => onChange({ color })}
      onOpacityChange={(opacity) => onChange({ opacity })}
    />
    <PairRow>
      <NumberField
        label={`${name} offset X`}
        glyph={<MoveHorizontal size={13} />}
        unit="px"
        value={Math.round(shadow.offsetX)}
        onChange={(v) => onChange({ offsetX: v })}
      />
      <NumberField
        label={`${name} offset Y`}
        glyph={<MoveVertical size={13} />}
        unit="px"
        value={Math.round(shadow.offsetY)}
        onChange={(v) => onChange({ offsetY: v })}
      />
    </PairRow>
    <PairRow>
      <NumberField
        label={`${name} blur`}
        glyph="B"
        unit="px"
        min={0}
        max={200}
        value={Math.round(shadow.blur)}
        onChange={(v) => onChange({ blur: v })}
      />
      {allowSpread ? (
        <NumberField
          label={`${name} spread`}
          glyph="S"
          unit="px"
          min={0}
          max={100}
          value={Math.round(shadow.spread ?? 0)}
          onChange={(v) => onChange({ spread: v })}
        />
      ) : (
        <span aria-hidden />
      )}
    </PairRow>
  </>
);

/**
 * Effects: shadows and blurs, as a list.
 *
 * Only what is applied is shown; `+` offers what can still be added. A plain
 * shape with no effects is one header line.
 */
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

  const penShaded = Boolean(appearance.sketch) && !fillsInterior(appearance.fillStyle);
  const edge = Boolean(capabilities.supportsEdgeEffects) && !openShape;

  const available: Record<EffectId, boolean> = {
    shadow: Boolean(capabilities.supportsShadow),
    innerShadow: edge && !penShaded,
    blur: !hasConnector && !hasImage,
    backdropBlur: !hasConnector && edge,
  };
  const present: Record<EffectId, boolean> = {
    shadow: Boolean(appearance.shadow),
    innerShadow: Boolean(appearance.innerShadow),
    blur: Boolean(appearance.blur),
    backdropBlur: Boolean(appearance.backdropBlur),
  };

  const ids = (Object.keys(EFFECT_LABELS) as EffectId[]).filter((id) => available[id] || present[id]);
  if (ids.length === 0) return null;

  const addable = ids.filter((id) => available[id] && !present[id]);
  const applied = ids.filter((id) => present[id]);

  const add = (id: EffectId) => {
    if (id === 'shadow') setAppearance({ shadow: { ...DEFAULT_SHADOW } });
    if (id === 'innerShadow') setAppearance({ innerShadow: { ...DEFAULT_INNER_SHADOW } });
    if (id === 'blur') setAppearance({ blur: 4 });
    if (id === 'backdropBlur') setAppearance({ backdropBlur: 12 });
  };
  const remove = (id: EffectId) => setAppearance({ [id]: undefined } as Partial<Appearance>);

  const entries: MenuEntry[] = addable.map((id) => ({
    kind: 'item',
    id,
    label: EFFECT_LABELS[id],
    icon: EFFECT_ICONS[id],
    onSelect: () => add(id),
  }));

  const blur = sharedPaint((a) => a.blur ?? 0);
  const backdrop = sharedPaint((a) => a.backdropBlur ?? 0);

  return (
    <Section
      id="effects"
      title="Effects"
      empty={applied.length === 0}
      addMenu={addable.length > 1 ? entries : undefined}
      onAdd={addable.length === 1 ? () => add(addable[0]) : undefined}
      addLabel={addable.length === 1 ? `Add ${EFFECT_LABELS[addable[0]].toLowerCase()}` : 'Add an effect'}
    >
      {applied.map((id) => (
        <div key={id} className="pg-effect">
          <EffectHead id={id} onRemove={() => remove(id)} />
          {id === 'shadow' && appearance.shadow && (
            <ShadowFields
              name="Drop shadow"
              shadow={appearance.shadow}
              colorMixed={sharedPaint((a) => a.shadow?.color).mixed}
              allowSpread={Boolean(capabilities.supportsShadowSpread) && !openShape}
              onChange={setShadow}
            />
          )}
          {id === 'innerShadow' && appearance.innerShadow && (
            penShaded ? (
              <Note>
                Inner shadow needs an inside. Pen shading leaves the shape open, so set the fill to Solid to see it.
              </Note>
            ) : (
              <ShadowFields
                name="Inner shadow"
                shadow={appearance.innerShadow}
                colorMixed={sharedPaint((a) => a.innerShadow?.color).mixed}
                allowSpread
                onChange={setInnerShadow}
              />
            )
          )}
          {id === 'blur' && (
            <NumberField
              label="Layer blur"
              glyph={<Droplets size={13} />}
              unit="px"
              min={0}
              max={100}
              step={2}
              value={blur.mixed ? 'mixed' : Math.round(blur.value ?? 0)}
              onChange={(v) => setAppearance({ blur: v > 0 ? v : undefined })}
            />
          )}
          {id === 'backdropBlur' && (
            <>
              <NumberField
                label="Background blur"
                glyph={<Scan size={13} />}
                unit="px"
                min={0}
                max={100}
                step={2}
                value={backdrop.mixed ? 'mixed' : Math.round(backdrop.value ?? 0)}
                onChange={(v) => setAppearance({ backdropBlur: v > 0 ? v : undefined })}
              />
              <Note>Shows through a fill that is not fully opaque.</Note>
            </>
          )}
        </div>
      ))}
    </Section>
  );
};
