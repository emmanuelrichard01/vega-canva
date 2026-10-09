import React from 'react';
import { Droplets, Minus, MoveHorizontal, MoveVertical, Scan, Sun, SunDim } from 'lucide-react';
import { ColorChip, NumberField, Note, PairRow, Row, Section, SegmentedControl } from '../grammar';
import type { MenuEntry } from '../../menu/menuModel';
import { DEFAULT_SHADOW_COLOR, type Appearance, type Shadow } from '../../../engine/model/schema';
import { fillsInterior } from '../../../engine/model/rough';
import type { Shared } from '../../../engine/model/selection';
import {
  DEFAULT_DROP_SHADOW,
  MAX_SHADOW_BLUR,
  MAX_SHADOW_OFFSET,
  MAX_SHADOW_SPREAD,
  SHADOW_PRESETS,
  SHADOW_STEP,
  presetOf,
} from '../../../engine/model/dropShadow';

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

/** One value of a shadow across the selection: agreed, or mixed. */
type ShadowRead = (pick: (s: Shadow) => number | string | undefined) => Shared<number | string | undefined>;

/**
 * The fields of one shadow, read across the whole selection.
 *
 * Every field asks the selection rather than the primary object, so two
 * shadows that differ in blur say *Mixed* in Blur and nowhere else, and typing
 * a number there sets that one property on every object while leaving each
 * one's offset and colour alone.
 *
 * Offset, blur and spread move in half-units and take any typed decimal, so a
 * 0.5px contact shadow is as reachable as a 24px lift. A scrub writes previews
 * and lands as one undo step (see `NumberField`).
 */
const ShadowFields: React.FC<{
  name: string;
  shadow: Shadow;
  read: ShadowRead;
  allowSpread: boolean;
  presets?: boolean;
  onChange: (patch: Partial<Shadow>) => void;
}> = ({ name, shadow, read, allowSpread, presets = false, onChange }) => {
  const value = (pick: (s: Shadow) => number | undefined): number | 'mixed' => {
    const shared = read(pick);
    return shared.mixed ? 'mixed' : ((shared.value as number | undefined) ?? 0);
  };
  const colour = read((s) => s.color);
  const opacity = read((s) => s.opacity ?? 1);
  const depth = read((s) => presetOf(s) ?? 'custom');
  return (
    <>
      <ColorChip
        label={name}
        value={colour.mixed ? 'mixed' : shadow.color}
        opacity={opacity.mixed ? 1 : (shadow.opacity ?? 1)}
        allowNone={false}
        onChange={(color) => onChange({ color })}
        onOpacityChange={(o) => onChange({ opacity: o })}
      />
      {presets && (
        <Row label="Depth" hint="A ready-made elevation. The shadow keeps its colour.">
          <SegmentedControl
            ariaLabel={`${name} depth`}
            fill
            mixed={depth.mixed}
            value={depth.mixed ? '' : String(depth.value ?? '')}
            onChange={(id) => {
              const hit = SHADOW_PRESETS.find((p) => p.id === id);
              if (!hit) return;
              const { offsetX, offsetY, blur, spread, opacity: o } = hit.shadow;
              onChange({ offsetX, offsetY, blur, spread, opacity: o });
            }}
            segments={SHADOW_PRESETS.map((p) => ({
              value: p.id,
              label: p.label,
              hint: `Offset ${p.shadow.offsetY}, blur ${p.shadow.blur}, ${Math.round((p.shadow.opacity ?? 1) * 100)}%`,
            }))}
          />
        </Row>
      )}
      <PairRow>
        <NumberField
          label={`${name} offset X`}
          glyph={<MoveHorizontal size={13} />}
          unit="px"
          step={SHADOW_STEP}
          min={-MAX_SHADOW_OFFSET}
          max={MAX_SHADOW_OFFSET}
          value={value((s) => s.offsetX)}
          onChange={(v) => onChange({ offsetX: v })}
        />
        <NumberField
          label={`${name} offset Y`}
          glyph={<MoveVertical size={13} />}
          unit="px"
          step={SHADOW_STEP}
          min={-MAX_SHADOW_OFFSET}
          max={MAX_SHADOW_OFFSET}
          value={value((s) => s.offsetY)}
          onChange={(v) => onChange({ offsetY: v })}
        />
      </PairRow>
      <PairRow>
        <NumberField
          label={`${name} blur`}
          glyph="B"
          unit="px"
          step={SHADOW_STEP}
          min={0}
          max={MAX_SHADOW_BLUR}
          value={value((s) => s.blur)}
          onChange={(v) => onChange({ blur: v })}
        />
        {allowSpread ? (
          <NumberField
            label={`${name} spread`}
            glyph="S"
            unit="px"
            step={SHADOW_STEP}
            min={0}
            max={MAX_SHADOW_SPREAD}
            value={value((s) => s.spread)}
            onChange={(v) => onChange({ spread: v })}
          />
        ) : (
          <span aria-hidden />
        )}
      </PairRow>
    </>
  );
};

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
  // Present when *any* selected object has it, so a selection where only some
  // objects carry a shadow shows it, with Mixed where they differ, rather than
  // offering to add one that would overwrite the shadows already there.
  const anyHas = (pick: (a: Appearance) => unknown) => {
    const shared = sharedPaint((a) => Boolean(pick(a)));
    return shared.mixed || Boolean(shared.value);
  };
  const present: Record<EffectId, boolean> = {
    shadow: anyHas((a) => a.shadow),
    innerShadow: anyHas((a) => a.innerShadow),
    blur: Boolean(appearance.blur),
    backdropBlur: Boolean(appearance.backdropBlur),
  };

  const ids = (Object.keys(EFFECT_LABELS) as EffectId[]).filter((id) => available[id] || present[id]);
  if (ids.length === 0) return null;

  const addable = ids.filter((id) => available[id] && !present[id]);
  const applied = ids.filter((id) => present[id]);

  const add = (id: EffectId) => {
    // Through the merging setters, so an object that already has one keeps it.
    if (id === 'shadow') setShadow({});
    if (id === 'innerShadow') setInnerShadow({});
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
          {id === 'shadow' && (
            <ShadowFields
              name="Drop shadow"
              shadow={appearance.shadow ?? DEFAULT_DROP_SHADOW}
              read={(pick) => sharedPaint((a) => (a.shadow ? pick(a.shadow) : undefined))}
              // Spread grows the whole silhouette, so a line takes it as well
              // as a closed shape does.
              allowSpread={Boolean(capabilities.supportsShadowSpread)}
              presets
              onChange={setShadow}
            />
          )}
          {id === 'innerShadow' && (
            penShaded ? (
              <Note>
                Inner shadow needs an inside. Pen shading leaves the shape open, so set the fill to Solid to see it.
              </Note>
            ) : (
              <ShadowFields
                name="Inner shadow"
                shadow={appearance.innerShadow ?? DEFAULT_INNER_SHADOW}
                read={(pick) => sharedPaint((a) => (a.innerShadow ? pick(a.innerShadow) : undefined))}
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
