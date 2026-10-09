import React from 'react';
import { Droplets, Eye, EyeOff, Minus, MoveHorizontal, MoveVertical, Scan, Sun, SunDim } from 'lucide-react';
import { ColorChip, NumberField, Note, PairRow, Row, Section, SegmentedControl } from '../grammar';
import type { MenuEntry } from '../../menu/menuModel';
import type { Appearance, Shadow } from '../../../engine/model/schema';
import { fillsInterior } from '../../../engine/model/rough';
import type { Shared } from '../../../engine/model/selection';
import {
  DEFAULT_DROP_SHADOW,
  DEFAULT_INNER_SHADOW,
  INNER_SHADOW_PRESETS,
  MAX_SHADOW_BLUR,
  MAX_SHADOW_OFFSET,
  MAX_SHADOW_SPREAD,
  MIN_SHADOW_SPREAD,
  SHADOW_PRESETS,
  SHADOW_STEP,
  presetOf,
  type ShadowPreset,
} from '../../../engine/model/dropShadow';

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
    supportsInteriorEffects?: boolean;
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

/** Whether a shadow is shown, across the selection. */
type Visibility = { hidden: boolean; mixed: boolean };

/**
 * One effect's line in the list: what it is, a summary while it is hidden,
 * and its show/hide and remove controls, as a Figma effect row reads.
 */
const EffectHead: React.FC<{
  id: EffectId;
  summary?: string;
  visibility?: Visibility;
  onToggle?: () => void;
  onRemove: () => void;
}> = ({ id, summary, visibility, onToggle, onRemove }) => {
  const name = EFFECT_LABELS[id].toLowerCase();
  const hidden = Boolean(visibility?.hidden) && !visibility?.mixed;
  return (
    <div className="pg-effect__head">
      <span className="pg-effect__icon" aria-hidden="true">{EFFECT_ICONS[id]}</span>
      <span className="pg-effect__name">{EFFECT_LABELS[id]}</span>
      {hidden && summary && <span className="pg-effect__summary">{summary}</span>}
      {visibility && onToggle && (
        <button
          type="button"
          className="pg-icon-btn"
          aria-label={hidden ? `Show ${name}` : `Hide ${name}`}
          aria-pressed={visibility.mixed ? 'mixed' : hidden}
          data-tooltip={hidden ? 'Show' : 'Hide'}
          onClick={onToggle}
        >
          {hidden ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
        </button>
      )}
      <button
        type="button"
        className="pg-icon-btn"
        aria-label={`Remove ${name}`}
        data-tooltip="Remove"
        onClick={onRemove}
      >
        <Minus size={14} aria-hidden="true" />
      </button>
    </div>
  );
};

/** One value of a shadow across the selection: agreed, or mixed. */
type ShadowRead = (pick: (s: Shadow) => number | string | boolean | undefined) => Shared<number | string | boolean | undefined>;

/** `y 4 · blur 12`: enough to recognise a hidden shadow without opening it. */
function shadowSummary(s: Shadow): string {
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  const offset = s.offsetX ? `${fmt(s.offsetX)}, ${fmt(s.offsetY)}` : `y ${fmt(s.offsetY)}`;
  return `${offset} \u00b7 blur ${fmt(s.blur)}`;
}

/**
 * The fields of one shadow, read across the whole selection.
 *
 * Every field asks the selection rather than the primary object, so two
 * shadows that differ in blur say *Mixed* in Blur and nowhere else, and typing
 * a number there sets that one property on every object while leaving each
 * one's offset and colour alone.
 *
 * Ordered as the shadow is built: a ready-made size, then where it falls,
 * how soft and how large it is, then its colour. Offset, blur and spread move
 * in half-units and take any typed decimal, so a 0.5px contact shadow is as
 * reachable as a 24px lift. Spread runs negative as well, which tucks a long
 * blur in under the object. A scrub previews on the board and lands as one
 * undo step (see `NumberField`).
 */
const ShadowFields: React.FC<{
  name: string;
  shadow: Shadow;
  read: ShadowRead;
  allowSpread: boolean;
  presets: readonly ShadowPreset[];
  presetHint: string;
  onChange: (patch: Partial<Shadow>) => void;
}> = ({ name, shadow, read, allowSpread, presets, presetHint, onChange }) => {
  const value = (pick: (s: Shadow) => number | undefined): number | 'mixed' => {
    const shared = read(pick);
    return shared.mixed ? 'mixed' : ((shared.value as number | undefined) ?? 0);
  };
  const colour = read((s) => s.color);
  const opacity = read((s) => s.opacity ?? 1);
  const preset = read((s) => presetOf(s, presets) ?? 'custom');
  return (
    <>
      <Row label="Size" hint={presetHint}>
        <SegmentedControl
          ariaLabel={`${name} size`}
          fill
          mixed={preset.mixed}
          value={preset.mixed ? '' : String(preset.value ?? '')}
          onChange={(id) => {
            const hit = presets.find((p) => p.id === id);
            if (!hit) return;
            const { offsetX, offsetY, blur, spread, opacity: o } = hit.shadow;
            onChange({ offsetX, offsetY, blur, spread: allowSpread ? spread : 0, opacity: o });
          }}
          segments={presets.map((p) => ({
            value: p.id,
            label: p.label,
            hint: `${shadowSummary(p.shadow)}, ${Math.round((p.shadow.opacity ?? 1) * 100)}%`,
          }))}
        />
      </Row>
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
            min={MIN_SHADOW_SPREAD}
            max={MAX_SHADOW_SPREAD}
            value={value((s) => s.spread)}
            onChange={(v) => onChange({ spread: v })}
          />
        ) : (
          <span aria-hidden />
        )}
      </PairRow>
      <ColorChip
        label={`${name} colour`}
        value={colour.mixed ? 'mixed' : shadow.color}
        opacity={opacity.mixed ? 1 : (shadow.opacity ?? 1)}
        allowNone={false}
        onChange={(color) => onChange({ color })}
        onOpacityChange={(o) => onChange({ opacity: o })}
      />
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
  const interior = Boolean(capabilities.supportsInteriorEffects) && !openShape;

  const available: Record<EffectId, boolean> = {
    shadow: Boolean(capabilities.supportsShadow),
    // Only a type whose renderer draws them: a chart or a table takes the
    // sketch block through `supportsEdgeEffects` and draws neither of these.
    innerShadow: interior && !penShaded,
    blur: !hasConnector && !hasImage,
    backdropBlur: !hasConnector && interior,
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

  /** Shown, hidden, or both across the selection, for a shadow field. */
  const visibilityOf = (pick: (a: Appearance) => Shadow | undefined): Visibility => {
    const shared = sharedPaint((a) => {
      const s = pick(a);
      return s ? s.visible === false : undefined;
    });
    return { hidden: Boolean(shared.value), mixed: shared.mixed };
  };
  const dropVisibility = visibilityOf((a) => a.shadow);
  const innerVisibility = visibilityOf((a) => a.innerShadow);
  // A mixed selection is shown by one click, so nothing stays hidden by surprise.
  const toggle = (v: Visibility, set: (patch: Partial<Shadow>) => void) => () =>
    set({ visible: v.hidden || v.mixed ? true : false });

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
      {applied.map((id) => {
        const shadowLike = id === 'shadow' || id === 'innerShadow';
        const visibility = id === 'shadow' ? dropVisibility : id === 'innerShadow' ? innerVisibility : undefined;
        const hidden = Boolean(visibility?.hidden) && !visibility?.mixed;
        const own = id === 'shadow' ? appearance.shadow : id === 'innerShadow' ? appearance.innerShadow : undefined;
        return (
        <div key={id} className={`pg-effect${hidden ? ' pg-effect--hidden' : ''}`}>
          <EffectHead
            id={id}
            summary={own ? shadowSummary(own) : undefined}
            visibility={shadowLike ? visibility : undefined}
            onToggle={
              id === 'shadow'
                ? toggle(dropVisibility, setShadow)
                : id === 'innerShadow'
                  ? toggle(innerVisibility, setInnerShadow)
                  : undefined
            }
            onRemove={() => remove(id)}
          />
          {id === 'shadow' && !hidden && (
            <ShadowFields
              name="Drop shadow"
              shadow={appearance.shadow ?? DEFAULT_DROP_SHADOW}
              read={(pick) => sharedPaint((a) => (a.shadow ? pick(a.shadow) : undefined))}
              // Spread grows the whole silhouette, so a line takes it as well
              // as a closed shape does.
              allowSpread={Boolean(capabilities.supportsShadowSpread)}
              presets={SHADOW_PRESETS}
              presetHint="A ready-made elevation. The shadow keeps its colour."
              onChange={setShadow}
            />
          )}
          {id === 'innerShadow' && !hidden && (
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
                presets={INNER_SHADOW_PRESETS}
                presetHint="A ready-made inset. The shadow keeps its colour."
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
        );
      })}
    </Section>
  );
};
