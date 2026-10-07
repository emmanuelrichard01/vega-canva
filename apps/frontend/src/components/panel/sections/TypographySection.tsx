import React from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignVerticalSpaceBetween,
  ALargeSmall,
  Bold,
  CaseSensitive,
  Italic,
  List,
  ListOrdered,
  Minus,
  MoveHorizontal,
  MoveVertical,
  PenLine,
  Square,
  Squircle,
  Strikethrough,
  Sun,
  Type,
  Underline,
  UnfoldHorizontal,
  UnfoldVertical,
} from 'lucide-react';
import { SubGroup } from '../panelPrimitives';
import { ColorChip, IconToggle, NumberField, PairRow, Row, Section, SegmentedControl, SpecimenPicker, Switch } from '../grammar';
import { shortFont } from '../panelHelpers';
import { EffectSpecimen, VerticalAlignGlyph } from '../typeGlyphs';
import { boardSurface, textSurface } from '../../../engine/model/textSurface';
import { EyedropperButton } from '../../ui/EyedropperButton';
import { FontSelector } from '../../ui/FontSelector';
import { FontWeightSelect } from '../../ui/FontWeightSelect';
import { boldWeightFor, canBold, hasTrueItalic, nearestWeight } from '../../../engine/text/fontCatalogue';
import {
  DEFAULT_TEXT_GLOW,
  DEFAULT_TEXT_HIGHLIGHT,
  DEFAULT_TEXT_OUTLINE,
  TEXT_PRESETS,
  activeTextEffects,
  isTextPresetActive,
} from '../textEffectPresets';
import { CYCLE_PRESETS } from '../../../engine/text/colorCycle';
import type {
  AnyNode,
  CycleUnit,
  ListStyle,
  TextAlign,
  TextCase,
  TextResize,
  Typography,
  VerticalAlign,
} from '../../../engine/model/schema';
import type { Shared } from '../../../engine/model/selection';

interface TypographySectionProps {
  node: AnyNode;
  typography: Typography | null;
  uniformType: boolean;
  openShape: boolean;
  cycleKey: string;
  isBold: boolean;
  /** The selected shapes carry no words yet; the section offers to start typing. */
  noText?: boolean;
  onStartTyping?: () => void;
  sharedType: <T>(read: (t: Typography) => T) => Shared<T>;
  shared: <T>(read: (n: AnyNode) => T) => Shared<T>;
  setTypography: (patch: Partial<Typography>) => void;
  set: (updates: Partial<AnyNode>) => void;
  patchEach: (build: (n: AnyNode) => Record<string, unknown> | null) => void;
  typographyOf: (node: AnyNode) => Typography | null;
}

const glyph = (text: string) => <span className="pg-glyph-text">{text}</span>;

/**
 * Text: the face, the size and the block.
 *
 * Paired rows wherever two values are read against each other: weight beside
 * size, leading beside tracking, horizontal beside vertical alignment.
 */
export const TypographySection: React.FC<TypographySectionProps> = ({
  node,
  typography,
  uniformType,
  openShape,
  cycleKey,
  isBold,
  noText = false,
  onStartTyping,
  sharedType,
  shared,
  setTypography,
  set,
  patchEach,
  typographyOf,
}) => {
  if (!typography || openShape) return null;

  if (noText) {
    return (
      <Section
        id="text"
        title="Text"
        empty
        onAdd={onStartTyping}
        addLabel="Add a label"
      />
    );
  }

  const weight = sharedType((t) => t.fontWeight ?? 400);
  const size = sharedType((t) => t.fontSize);
  const lh = sharedType((t) => t.lineHeight);
  const ls = sharedType((t) => t.letterSpacing);
  const ps = sharedType((t) => t.paragraphSpacing ?? 0);
  const colour = sharedType((t) => t.color);
  const family = sharedType((t) => t.fontFamily);
  const ratio = lh.value ?? 1.2;
  const surface = textSurface(node, boardSurface());

  return (
    <>
      <Section id="text" title="Text" meta={family.mixed ? 'Mixed' : shortFont(typography.fontFamily)}>
        <Row label="Font">
          <FontSelector
            value={typography.fontFamily}
            onChange={(fontFamily) => {
              const fontWeight = nearestWeight(fontFamily, typography.fontWeight ?? 400);
              setTypography(fontWeight === typography.fontWeight ? { fontFamily } : { fontFamily, fontWeight });
            }}
          />
        </Row>
        <PairRow>
          <FontWeightSelect
            family={typography.fontFamily}
            value={weight.value ?? 400}
            mixed={weight.mixed}
            onChange={(fontWeight) => setTypography({ fontWeight })}
          />
          <NumberField
            label="Font size"
            glyph={<ALargeSmall size={13} />}
            unit="px"
            min={8}
            max={500}
            value={size.mixed ? 'mixed' : Math.round(size.value ?? 16)}
            onChange={(fontSize) => setTypography({ fontSize: Math.round(fontSize) })}
            onNudge={(d) =>
              patchEach((n) => {
                const t = typographyOf(n);
                if (!t) return null;
                return { typography: { ...t, fontSize: Math.max(8, Math.min(500, t.fontSize + d)) } };
              })
            }
          />
        </PairRow>
        <PairRow>
          <NumberField
            label="Leading, the distance between baselines"
            glyph={<UnfoldVertical size={13} />}
            unit="px"
            min={Math.round(typography.fontSize * 0.5)}
            max={Math.round(typography.fontSize * 3)}
            value={lh.mixed ? 'mixed' : Math.round(typography.fontSize * ratio)}
            onChange={(next) => setTypography({ lineHeight: next / typography.fontSize })}
          />
          <NumberField
            label="Tracking, the space added between characters"
            glyph={<UnfoldHorizontal size={13} />}
            unit="px"
            min={-10}
            max={50}
            precision={1}
            value={ls.mixed ? 'mixed' : ls.value ?? 0}
            onChange={(letterSpacing) => setTypography({ letterSpacing })}
          />
        </PairRow>
        <div className="pg-list-item">
          <ColorChip
            label="Text colour"
            value={colour.mixed ? 'mixed' : typography.color}
            allowNone={false}
            contrastAgainst={surface}
            onChange={(color) => setTypography({ color })}
          />
          <EyedropperButton label="Pick a text colour from the screen" onPick={(color) => setTypography({ color })} />
        </div>
        <div className="pg-toggles" role="group" aria-label="Text style">
          <IconToggle
            pressed={isBold}
            mixed={sharedType((t) => (t.fontWeight ?? 400) >= 600).mixed}
            onClick={() => setTypography({ fontWeight: isBold ? 400 : boldWeightFor(typography.fontFamily) })}
            label={canBold(typography.fontFamily) ? 'Bold' : `${typography.fontFamily} has no bold`}
          >
            <Bold size={14} />
          </IconToggle>
          <IconToggle
            pressed={Boolean(typography.italic)}
            mixed={sharedType((t) => Boolean(t.italic)).mixed}
            onClick={() => setTypography({ italic: !typography.italic })}
            label={
              hasTrueItalic(typography.fontFamily)
                ? 'Italic'
                : `Italic: ${typography.fontFamily} has no true italic, so this slants it`
            }
          >
            <Italic size={14} />
          </IconToggle>
          <IconToggle
            pressed={Boolean(typography.underline)}
            mixed={sharedType((t) => Boolean(t.underline)).mixed}
            onClick={() => setTypography({ underline: !typography.underline })}
            label="Underline"
          >
            <Underline size={14} />
          </IconToggle>
          <IconToggle
            pressed={Boolean(typography.strikethrough)}
            mixed={sharedType((t) => Boolean(t.strikethrough)).mixed}
            onClick={() => setTypography({ strikethrough: !typography.strikethrough })}
            label="Strikethrough"
          >
            <Strikethrough size={14} />
          </IconToggle>
        </div>
        <Row label="Case" hint="Changes how the text is shown, never what is stored.">
          <SegmentedControl
            ariaLabel="Text case"
            fill
            mixed={sharedType((t) => t.textCase ?? 'none').mixed}
            value={typography.textCase ?? 'none'}
            onChange={(v) => setTypography({ textCase: v === 'none' ? undefined : (v as TextCase) })}
            segments={[
              { value: 'none', label: 'As typed', hint: 'As typed', icon: glyph('Ag') },
              { value: 'upper', label: 'Upper case', hint: 'Shown in capitals; what you typed is kept', icon: glyph('AG') },
              { value: 'lower', label: 'Lower case', hint: 'Shown in lower case; what you typed is kept', icon: glyph('ag') },
              { value: 'title', label: 'Title Case', hint: 'Each word capitalised', icon: <CaseSensitive size={14} /> },
            ]}
          />
        </Row>
        <div className="pg-pair pg-pair--align">
          <SegmentedControl
            ariaLabel="Text alignment"
            fill
            mixed={sharedType((t) => t.align).mixed}
            value={typography.align}
            onChange={(v) => setTypography({ align: v as TextAlign })}
            segments={[
              { value: 'left', label: 'Left', icon: <AlignLeft size={14} /> },
              { value: 'center', label: 'Centre', icon: <AlignCenter size={14} /> },
              { value: 'right', label: 'Right', icon: <AlignRight size={14} /> },
              { value: 'justify', label: 'Justify', hint: 'Both edges flush, by stretching the spaces', icon: <AlignJustify size={14} /> },
            ]}
          />
          <SegmentedControl
            ariaLabel="Vertical alignment"
            fill
            mixed={sharedType((t) => t.verticalAlign).mixed}
            value={typography.verticalAlign ?? 'top'}
            onChange={(v) => setTypography({ verticalAlign: v as VerticalAlign })}
            segments={[
              { value: 'top', label: 'Top', icon: <VerticalAlignGlyph where="top" /> },
              { value: 'middle', label: 'Middle', icon: <VerticalAlignGlyph where="middle" /> },
              { value: 'bottom', label: 'Bottom', icon: <VerticalAlignGlyph where="bottom" /> },
            ]}
          />
        </div>
        <Row label="Space after" hint="Extra room between paragraphs, on top of the leading.">
          <NumberField
            label="Space after a paragraph"
            glyph={<AlignVerticalSpaceBetween size={13} />}
            unit="px"
            min={0}
            max={200}
            step={2}
            value={ps.mixed ? 'mixed' : ps.value ?? 0}
            onChange={(v) => setTypography({ paragraphSpacing: v > 0 ? v : undefined })}
          />
        </Row>
        <Row stack label="List" hint="Marks every paragraph in this block. An empty line is a spacer and takes no marker.">
          <SegmentedControl
            ariaLabel="List style"
            fill
            mixed={sharedType((t) => t.list ?? 'none').mixed}
            value={typography.list ?? 'none'}
            onChange={(v) => setTypography({ list: v === 'none' ? undefined : (v as ListStyle) })}
            segments={[
              { value: 'none', label: 'None', hint: 'No list', icon: <Minus size={14} /> },
              { value: 'bullet', label: 'Bullet', hint: 'A round dot', icon: <List size={14} /> },
              { value: 'dash', label: 'Dash', hint: 'An en dash', icon: glyph('–') },
              { value: 'circle', label: 'Hollow', hint: 'An open circle', icon: glyph('◦') },
              { value: 'number', label: 'Numbered', hint: '1. 2. 3.', icon: <ListOrdered size={14} /> },
              { value: 'letter', label: 'Lettered', hint: 'a. b. c.', icon: glyph('a.') },
            ]}
          />
        </Row>
        {uniformType && node.type === 'text' && (
          <Row label="Resize" hint="Auto width grows sideways. Auto height wraps and grows down. Fixed imposes both, so dragging an edge stretches the letters.">
            <SegmentedControl
              ariaLabel="Text box resizing"
              fill
              mixed={shared((n) => (n.type === 'text' ? n.resize : null)).mixed}
              value={node.resize}
              onChange={(v) => set({ resize: v as TextResize } as Partial<AnyNode>)}
              segments={[
                { value: 'width', label: 'Auto width', hint: 'As wide as the longest line', icon: <MoveHorizontal size={14} /> },
                { value: 'height', label: 'Auto height', hint: 'Wraps at this width and grows down', icon: <MoveVertical size={14} /> },
                { value: 'fixed', label: 'Fixed', hint: 'Both dimensions imposed; dragging an edge stretches the type', icon: <Square size={14} /> },
              ]}
            />
          </Row>
        )}
      </Section>

      <Section
        id="text-effects"
        title="Text effects"
        meta={activeTextEffects(typography)}
        collapsible
        defaultOpen={Boolean(typography.highlight || typography.outline || typography.glow || typography.colorCycle)}
      >
        <SpecimenPicker
          label="Text effect presets"
          size={48}
          value={TEXT_PRESETS.find((p) => isTextPresetActive(p, typography))?.id ?? ''}
          onChange={(id) => {
            const preset = TEXT_PRESETS.find((p) => p.id === id);
            if (preset) setTypography(preset.patch(typography));
          }}
          options={TEXT_PRESETS.map((preset) => {
            const t = preset.patch(typography) as Partial<Typography>;
            return {
              value: preset.id,
              label: preset.hint ? `${preset.label}: ${preset.hint}` : preset.label,
              render: () => (
                <EffectSpecimen
                  color={t.color ?? typography.color}
                  highlight={t.highlight ?? null}
                  outline={t.outline ?? null}
                  glow={t.glow ?? null}
                />
              ),
            };
          })}
        />

        <SubGroup
          label="Highlight"
          hint="A rounded plate behind each line, sized to that line's own words."
          on={Boolean(typography.highlight)}
          onToggle={(on) => setTypography({ highlight: on ? DEFAULT_TEXT_HIGHLIGHT : undefined })}
        >
          {typography.highlight && (
            <>
              <ColorChip
                label="Highlight"
                value={typography.highlight.color}
                allowNone={false}
                onChange={(color) => setTypography({ highlight: { ...typography.highlight!, color } })}
              />
              <Row label="Shape" hint="Ribbon welds the lines into one shape with tucked corners. Plates keeps each line separate.">
                <SegmentedControl
                  ariaLabel="Highlight shape"
                  fill
                  value={typography.highlight.join}
                  onChange={(v) => setTypography({ highlight: { ...typography.highlight!, join: v as 'ribbon' | 'plates' } })}
                  segments={[
                    { value: 'ribbon', label: 'Ribbon' },
                    { value: 'plates', label: 'Plates' },
                  ]}
                />
              </Row>
              <PairRow>
                <NumberField
                  label="Corner radius of the highlight plate"
                  glyph={<Squircle size={13} />}
                  unit="px"
                  min={0}
                  max={60}
                  value={typography.highlight.radius}
                  onChange={(radius) => setTypography({ highlight: { ...typography.highlight!, radius } })}
                />
                <NumberField
                  label="Padding either side of each line"
                  glyph={<UnfoldHorizontal size={13} />}
                  unit="px"
                  min={0}
                  max={80}
                  value={typography.highlight.paddingX}
                  onChange={(paddingX) => setTypography({ highlight: { ...typography.highlight!, paddingX } })}
                />
              </PairRow>
              <Row label="Auto ink" hint="Choose the text colour automatically, by contrast against the highlight.">
                <Switch
                  ariaLabel="Auto ink"
                  checked={Boolean(typography.highlight.autoContrast)}
                  onChange={(autoContrast) =>
                    setTypography({ highlight: { ...typography.highlight!, autoContrast: autoContrast || undefined } })
                  }
                />
              </Row>
            </>
          )}
        </SubGroup>

        <SubGroup
          label="Outline"
          hint="A stroke around the letterforms, drawn wholly outside them."
          on={Boolean(typography.outline)}
          onToggle={(on) => setTypography({ outline: on ? DEFAULT_TEXT_OUTLINE : undefined })}
        >
          {typography.outline && (
            <PairRow>
              <ColorChip
                label="Outline"
                value={typography.outline.color}
                allowNone={false}
                onChange={(color) => setTypography({ outline: { ...typography.outline!, color } })}
              />
              <NumberField
                label="Outline weight"
                glyph={<PenLine size={13} />}
                unit="px"
                min={0.5}
                max={20}
                step={0.5}
                value={typography.outline.width}
                onChange={(width) => setTypography({ outline: { ...typography.outline!, width } })}
              />
            </PairRow>
          )}
        </SubGroup>

        <SubGroup
          label="Glow"
          hint="A soft halo behind the words. Takes the place of the layer shadow."
          on={Boolean(typography.glow)}
          onToggle={(on) => setTypography({ glow: on ? DEFAULT_TEXT_GLOW : undefined })}
        >
          {typography.glow && (
            <PairRow>
              <ColorChip
                label="Glow"
                value={typography.glow.color}
                allowNone={false}
                onChange={(color) => setTypography({ glow: { ...typography.glow!, color } })}
              />
              <NumberField
                label="Glow spread"
                glyph={<Sun size={13} />}
                unit="px"
                min={1}
                max={100}
                value={typography.glow.blur}
                onChange={(blur) => setTypography({ glow: { ...typography.glow!, blur } })}
              />
            </PairRow>
          )}
        </SubGroup>

        <Row stack label="Colour cycle" hint="Spreads a ramp of colours across the whole block. Editing the text re-spaces it.">
          <SegmentedControl
            ariaLabel="Colour ramp"
            fill
            mixed={sharedType((t) => t.colorCycle?.colors.join(',') ?? 'none').mixed}
            value={cycleKey}
            onChange={(key) =>
              setTypography({
                colorCycle:
                  key === 'none'
                    ? undefined
                    : { unit: typography.colorCycle?.unit ?? 'character', colors: CYCLE_PRESETS[key].colors },
              })
            }
            segments={[
              { value: 'none', label: 'None', hint: 'One flat colour', icon: <Minus size={14} /> },
              ...Object.entries(CYCLE_PRESETS).map(([key, preset]) => ({
                value: key,
                label: preset.label,
                hint: preset.label,
                icon: (
                  <span
                    aria-hidden
                    className="pg-ramp"
                    style={{ '--ramp': `linear-gradient(90deg, ${preset.colors.join(', ')})` } as React.CSSProperties}
                  />
                ),
              })),
            ]}
          />
        </Row>
        {typography.colorCycle && (
          <Row label="Cycle by" hint="A colour per letter reads as a gradient; a colour per word stays legible at small sizes.">
            <SegmentedControl
              ariaLabel="Colour cycle unit"
              fill
              value={typography.colorCycle.unit}
              onChange={(unit) => setTypography({ colorCycle: { ...typography.colorCycle!, unit: unit as CycleUnit } })}
              segments={[
                { value: 'character', label: 'Letter', hint: 'Every character', icon: glyph('A') },
                { value: 'word', label: 'Word', hint: 'Every word', icon: <Type size={13} /> },
              ]}
            />
          </Row>
        )}
      </Section>
    </>
  );
};
