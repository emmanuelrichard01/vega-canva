import React from 'react';
import {
  AlignCenter,
  AlignCenterVertical,
  AlignEndVertical,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  Bold,
  CaseSensitive,
  Italic,
  List,
  ListOrdered,
  Minus,
  MoveHorizontal,
  MoveVertical,
  WandSparkles,
  Square,
  Strikethrough,
  Type,
  Underline,
} from 'lucide-react';
import { Accordion, Row, SubGroup, ToggleButton } from '../panelPrimitives';
import { shortFont } from '../panelHelpers';
import { ColorPickerPopover } from '../../ui/ColorPickerPopover';
import { EyedropperButton } from '../../ui/EyedropperButton';
import { FontSelector } from '../../ui/FontSelector';
import { FontWeightSelect } from '../../ui/FontWeightSelect';
import { boldWeightFor, canBold, hasTrueItalic, nearestWeight } from '../../../engine/text/fontCatalogue';
import { NumberStepper } from '../../ui/NumberStepper';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Switch } from '../../ui/Switch';
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
  sharedType: <T>(read: (t: Typography) => T) => Shared<T>;
  shared: <T>(read: (n: AnyNode) => T) => Shared<T>;
  setTypography: (patch: Partial<Typography>) => void;
  set: (updates: Partial<AnyNode>) => void;
  patchEach: (build: (n: AnyNode) => Record<string, unknown> | null) => void;
  typographyOf: (node: AnyNode) => Typography | null;
}

export const TypographySection: React.FC<TypographySectionProps> = ({
  node,
  typography,
  uniformType,
  openShape,
  cycleKey,
  isBold,
  sharedType,
  shared,
  setTypography,
  set,
  patchEach,
  typographyOf,
}) => {
  if (!typography || openShape) return null;

  return (
    <>
      <Accordion
        title="Typography"
        icon={<Type size={13} />}
        defaultOpen={node.type === 'text'}
        badge={typography ? shortFont(typography.fontFamily) : undefined}
      >
        <Row label="Font">
          <FontSelector
            value={typography.fontFamily}
            onChange={(fontFamily) => {
              /**
               * The weight travels with the face, snapped to something the new
               * one has.
               *
               * Text set in Inter Thin and changed to Libre Baskerville — which
               * has Regular and Bold and nothing else — would otherwise keep
               * `fontWeight: 100` and render a *synthesised* thin: the same
               * board, quietly in a face nobody chose, with nothing to say so.
               * `nearestWeight` keeps the intention (as light as this face
               * goes) and drops the fiction.
               */
              const fontWeight = nearestWeight(fontFamily, typography.fontWeight ?? 400);
              setTypography(
                fontWeight === typography.fontWeight ? { fontFamily } : { fontFamily, fontWeight },
              );
            }}
          />
        </Row>
        <Row label="Weight" hint="Only the weights this face actually has. Anything else would be a weight the browser invents.">
          {(() => {
            const w = sharedType((t) => t.fontWeight ?? 400);
            return (
              <FontWeightSelect
                family={typography.fontFamily}
                value={w.value ?? 400}
                mixed={w.mixed}
                onChange={(fontWeight) => setTypography({ fontWeight })}
              />
            );
          })()}
        </Row>
        <Row label="Size">
          {(() => {
            const size = sharedType((t) => t.fontSize);
            return (
              <NumberStepper
                suffix="px"
                value={Math.round(size.value ?? 16)}
                mixed={size.mixed}
                onChange={(fontSize) => setTypography({ fontSize: Math.round(fontSize) })}
                onNudge={(d) =>
                  patchEach((n) => {
                    const t = typographyOf(n);
                    if (!t) return null;
                    return { typography: { ...t, fontSize: Math.max(8, Math.min(500, t.fontSize + d)) } };
                  })
                }
                min={8}
                max={500}
              />
            );
          })()}
        </Row>
        {/* "Colour" — the rest of this panel, and the effects below it, all
            spell it that way; this row was the only "Color" in the inspector. */}
        <Row label="Colour">
          <div className="prop-inline">
            <ColorPickerPopover
              color={typography.color}
              mixed={sharedType((t) => t.color).mixed}
              onChange={(color) => setTypography({ color })}
            />
            <EyedropperButton
              label="Pick a text colour from the screen"
              onPick={(color) => setTypography({ color })}
            />
          </div>
        </Row>
        <Row label="Style">
          {/* Was four inline style properties describing a segmented group that
              the app already has a look for. A class means the four toggles sit
              in the same well as every other grouped control. */}
          <div className="prop-toggle-group">
            {/*
              Bold, sent somewhere the family can actually go.

              This wrote a hard 700. On a face whose range stops at 600 that
              asked for a weight it did not have and got a synthesised one; on
              a single-weight display face it lit the button up and changed
              nothing at all. It goes to 700 where that exists and to the
              family's heaviest otherwise, and says so on a face with nothing
              above Regular.
            */}
            <ToggleButton
              active={isBold}
              mixed={sharedType((t) => (t.fontWeight ?? 400) >= 600).mixed}
              onClick={() =>
                setTypography({ fontWeight: isBold ? 400 : boldWeightFor(typography.fontFamily) })
              }
              label={canBold(typography.fontFamily) ? 'Bold' : `${typography.fontFamily} has no bold`}
            >
              <Bold size={14} />
            </ToggleButton>
            {/*
              Italic, saying when it is a shear rather than a face.

              A family without a drawn italic gets one from the browser by
              slanting the upright, and the two are not the same thing: a real
              italic's letterforms are drawn, with different shapes for a, e
              and g. The control still works — a slant is often what somebody
              wants — but it stops implying the face has an italic when it does
              not.
            */}
            <ToggleButton
              active={typography.italic}
              mixed={sharedType((t) => Boolean(t.italic)).mixed}
              onClick={() => setTypography({ italic: !typography.italic })}
              label={
                hasTrueItalic(typography.fontFamily)
                  ? 'Italic'
                  : `Italic — ${typography.fontFamily} has no true italic, so this slants it`
              }
            >
              <Italic size={14} />
            </ToggleButton>
            <ToggleButton
              active={typography.underline}
              mixed={sharedType((t) => Boolean(t.underline)).mixed}
              onClick={() => setTypography({ underline: !typography.underline })}
              label="Underline"
            >
              <Underline size={14} />
            </ToggleButton>
            <ToggleButton
              active={typography.strikethrough}
              mixed={sharedType((t) => Boolean(t.strikethrough)).mixed}
              onClick={() => setTypography({ strikethrough: !typography.strikethrough })}
              label="Strikethrough"
            >
              <Strikethrough size={14} />
            </ToggleButton>
          </div>
        </Row>
        <Row stack label="Case" hint="Changes how the text is shown, never what is stored. Switching back returns what you typed.">
          <SegmentedControl
            ariaLabel="Text case"
            mixed={sharedType((t) => t.textCase ?? 'none').mixed}
            value={typography.textCase ?? 'none'}
            onChange={(v) => setTypography({ textCase: v === 'none' ? undefined : (v as TextCase) })}
            segments={[
              { value: 'none', label: 'As typed', icon: <span className="prop-case-glyph">Ag</span> },
              { value: 'upper', label: 'Upper case', icon: <span className="prop-case-glyph">AG</span> },
              { value: 'lower', label: 'Lower case', icon: <span className="prop-case-glyph">ag</span> },
              { value: 'title', label: 'Title Case', icon: <CaseSensitive size={14} /> },
            ]}
          />
        </Row>
      </Accordion>

      {/*
        Two accordions, because they answer two questions.

        This was one "Typography" section of thirteen rows: the face, the size,
        the colour and the weight sat in the same undifferentiated stack as the
        leading, the alignment and the paragraph spacing — so finding the one
        you wanted meant reading all of them. The split is the one every type
        tool makes and it is not arbitrary: the first group is *what the letters
        are*, the second is *what the block does with them*, and almost nobody
        reaches into both in the same breath.
      */}
      <Accordion
        title="Paragraph"
        icon={<AlignLeft size={13} />}
        defaultOpen={node.type === 'text'}
      >
        <Row label="Align">
          <SegmentedControl
            ariaLabel="Text alignment"
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
        </Row>
        {/*
          Vertical alignment, which was stored, rendered, and unreachable.

          `Typography.verticalAlign` has been in the schema since the beginning
          and every renderer forwards it — `TextRenderer`, `ShapeRenderer`, the
          editing overlay. There has never been a control for it, so the only
          way a board ever got anything but `top` was a shape whose renderer
          hard-codes `middle`. A field that exists, works, and cannot be
          reached is a feature nobody knows was built.

          It matters most where this app is used most: text inside a shape. A
          label sitting against the top edge of a box it is centred in
          horizontally is the single most common thing to want to fix, and
          until now the answer was to nudge the text node by hand.
        */}
        <Row label="Vertical" hint="Where the block sits in its box when there is room to spare.">
          <SegmentedControl
            ariaLabel="Vertical alignment"
            mixed={sharedType((t) => t.verticalAlign).mixed}
            value={typography.verticalAlign ?? 'top'}
            onChange={(v) => setTypography({ verticalAlign: v as VerticalAlign })}
            segments={[
              { value: 'top', label: 'Top', icon: <AlignStartVertical size={14} /> },
              { value: 'middle', label: 'Middle', icon: <AlignCenterVertical size={14} /> },
              { value: 'bottom', label: 'Bottom', icon: <AlignEndVertical size={14} /> },
            ]}
          />
        </Row>
        {/*
          Leading, with the number it actually comes to.

          A multiplier is the right thing to *store* — it survives a size change,
          which an absolute value does not — and the wrong thing to read. `1.2`
          is a ratio to something you have to remember; `1.2 · 19px` is a
          distance. Illustrator shows points and Figma shows pixels, and both
          are answering the question this hint answers, which is "how far
          apart".
        */}
        <Row
          label="Leading"
          hint={`Distance between baselines, as a multiple of the font size. At ${Math.round(typography.fontSize)}px that is ${Math.round(typography.fontSize * (typography.lineHeight ?? 1.2))}px.`}
        >
          {(() => {
            const lh = sharedType((t) => t.lineHeight);
            return (
              <div className="prop-pair">
                <NumberStepper
                  value={lh.value ?? 1.2}
                  mixed={lh.mixed}
                  onChange={(lineHeight) => setTypography({ lineHeight })}
                  min={0.5}
                  max={3}
                  step={0.1}
                />
                <span className="prop-derived" aria-hidden="true">
                  {lh.mixed ? '—' : `${Math.round(typography.fontSize * (lh.value ?? 1.2))}px`}
                </span>
              </div>
            );
          })()}
        </Row>
        <Row label="Tracking" hint="Space added between every character.">
          {(() => {
            const ls = sharedType((t) => t.letterSpacing);
            return (
              <NumberStepper
                suffix="px"
                value={ls.value ?? 0}
                mixed={ls.mixed}
                onChange={(letterSpacing) => setTypography({ letterSpacing })}
                min={-10}
                max={50}
                step={1}
              />
            );
          })()}
        </Row>
        <Row label="Paragraph" hint="Extra space between paragraphs, on top of the leading.">
          {(() => {
            const ps = sharedType((t) => t.paragraphSpacing ?? 0);
            return (
              <NumberStepper
                suffix="px"
                value={ps.value ?? 0}
                mixed={ps.mixed}
                onChange={(v) => setTypography({ paragraphSpacing: v > 0 ? v : undefined })}
                min={0}
                max={200}
                step={2}
              />
            );
          })()}
        </Row>
        <Row stack label="List" hint="Marks every paragraph in this block. An empty line is a spacer and takes no marker.">
          <SegmentedControl
            ariaLabel="List style"
            mixed={sharedType((t) => t.list ?? 'none').mixed}
            value={typography.list ?? 'none'}
            onChange={(v) => setTypography({ list: v === 'none' ? undefined : (v as ListStyle) })}
            segments={[
              { value: 'none', label: 'None', hint: 'No list', icon: <Minus size={14} /> },
              { value: 'bullet', label: 'Bullet', hint: 'A round dot', icon: <List size={14} /> },
              { value: 'dash', label: 'Dash', hint: 'An en dash', icon: <span style={{ fontSize: 12, fontWeight: 700 }}>&#8211;</span> },
              { value: 'circle', label: 'Hollow', hint: 'An open circle', icon: <span style={{ fontSize: 12 }}>&#9702;</span> },
              { value: 'number', label: 'Numbered', hint: '1. 2. 3.', icon: <ListOrdered size={14} /> },
              { value: 'letter', label: 'Lettered', hint: 'a. b. c.', icon: <span style={{ fontSize: 11, fontWeight: 600 }}>a.</span> },
            ]}
          />
        </Row>
        {uniformType && node.type === 'text' && (
          <Row stack label="Resize" hint="Auto width grows sideways. Auto height wraps and grows down. Fixed imposes both, so dragging an edge stretches the letters.">
            <SegmentedControl
              ariaLabel="Text box resizing"
              mixed={shared((n) => (n.type === 'text' ? n.resize : null)).mixed}
              value={node.resize}
              onChange={(v) => set({ resize: v as TextResize } as Partial<AnyNode>)}
              segments={[
                { value: 'width', label: 'Auto width: the box is as wide as the longest line', icon: <MoveHorizontal size={14} /> },
                { value: 'height', label: 'Auto height: wraps at this width and grows down', icon: <MoveVertical size={14} /> },
                { value: 'fixed', label: 'Fixed: both dimensions imposed, and dragging an edge stretches the type', icon: <Square size={14} /> },
              ]}
            />
          </Row>
        )}
      </Accordion>

      <Accordion
        title="Text effects"
        /**
         * `WandSparkles`, not `Sparkles`.
         *
         * The dock's Forces tool is a bare `Sparkles`, so a text-effects
         * section and a physics tool were the same mark on the same screen.
         * Neither is wrong alone; sharing is what makes them wrong.
         *
         * The same glyph the contextual rail uses for this — which is the
         * other half of the rule: one concept, one mark. The rail's "Effects"
         * popover and this section are the same feature reached two ways, so
         * they must look like it.
         */
        icon={<WandSparkles size={13} />}
        badge={activeTextEffects(typography)}
        defaultOpen={Boolean(typography.highlight || typography.outline || typography.glow)}
      >
        {/*
          The colour cycle sat between Case and List, in the middle of the type
          section — a ramp across a whole block is an *effect* on the type, in
          the same family as a highlight or a glow, and nothing about it belongs
          beside a font size.
        */}
        <Row stack label="Colour cycle" hint="Spreads a ramp of colours across the whole block. Editing the text re-spaces it.">
          <SegmentedControl
            ariaLabel="Colour ramp"
            mixed={sharedType((t) => t.colorCycle?.colors.join(',') ?? 'none').mixed}
            value={cycleKey}
            onChange={(key) => setTypography({
              colorCycle: key === 'none'
                ? undefined
                : {
                    unit: typography.colorCycle?.unit ?? 'character',
                    colors: CYCLE_PRESETS[key].colors,
                  },
            })}
            segments={[
              { value: 'none', label: 'None', hint: 'One flat colour', icon: <Minus size={14} /> },
              ...Object.entries(CYCLE_PRESETS).map(([key, preset]) => ({
                value: key,
                label: preset.label,
                hint: preset.label,
                icon: (
                  <span
                    aria-hidden
                    style={{
                      display: 'block', width: 16, height: 10, borderRadius: 2,
                      background: `linear-gradient(90deg, ${preset.colors.join(', ')})`,
                    }}
                  />
                ),
              })),
            ]}
          />
        </Row>
        {typography.colorCycle && (
          <Row stack label="Cycle by" hint="A colour per letter reads as a gradient; a colour per word stays legible at small sizes.">
            <SegmentedControl
              ariaLabel="Colour cycle unit"
              value={typography.colorCycle.unit}
              onChange={(unit) => setTypography({
                colorCycle: { ...typography.colorCycle!, unit: unit as CycleUnit },
              })}
              segments={[
                { value: 'character', label: 'Letter', hint: 'Every character', icon: <span style={{ fontSize: 11, fontWeight: 600 }}>A</span> },
                { value: 'word', label: 'Word', hint: 'Every word', icon: <Type size={13} /> },
              ]}
            />
          </Row>
        )}
        <div className="prop-presets" role="group" aria-label="Text effect presets">
          {TEXT_PRESETS.map((preset) => {
            const active = isTextPresetActive(preset, typography);
            return (
              <button
                key={preset.id}
                type="button"
                className="prop-preset"
                data-active={active || undefined}
                aria-pressed={active}
                onClick={() => setTypography(preset.patch(typography))}
                data-tooltip={preset.hint}
                data-tooltip-pos="top"
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <SubGroup
          label="Highlight"
          hint="A rounded plate behind each line, sized to that line's own words."
          on={Boolean(typography.highlight)}
          onToggle={(on) => setTypography({ highlight: on ? DEFAULT_TEXT_HIGHLIGHT : undefined })}
        >
          {typography.highlight && (
            <>
              <Row label="Colour">
                <ColorPickerPopover
                  color={typography.highlight.color}
                  onChange={(color) =>
                    setTypography({ highlight: { ...typography.highlight!, color } })
                  }
                />
              </Row>
              <Row label="Shape" hint="Ribbon welds the lines into one shape with tucked corners. Plates keeps each line separate.">
                <SegmentedControl
                  ariaLabel="Highlight shape"
                  value={typography.highlight.join}
                  onChange={(v) =>
                    setTypography({
                      highlight: { ...typography.highlight!, join: v as 'ribbon' | 'plates' },
                    })
                  }
                  segments={[
                    { value: 'ribbon', label: 'Ribbon' },
                    { value: 'plates', label: 'Plates' },
                  ]}
                />
              </Row>
              <Row label="Corner" hint="How round each corner of the plate is.">
                <NumberStepper
                  value={typography.highlight.radius}
                  onChange={(radius) =>
                    setTypography({ highlight: { ...typography.highlight!, radius } })
                  }
                  min={0}
                  max={60}
                  step={1}
                  suffix="px"
                />
              </Row>
              <Row label="Padding" hint="Breathing room either side of each line's words.">
                <NumberStepper
                  value={typography.highlight.paddingX}
                  onChange={(paddingX) =>
                    setTypography({ highlight: { ...typography.highlight!, paddingX } })
                  }
                  min={0}
                  max={80}
                  step={1}
                  suffix="px"
                />
              </Row>
              <Row label="Auto ink" hint="Choose the text colour automatically, by contrast against the highlight.">
                <Switch
                  checked={Boolean(typography.highlight.autoContrast)}
                  onChange={(autoContrast) =>
                    setTypography({
                      highlight: {
                        ...typography.highlight!,
                        autoContrast: autoContrast || undefined,
                      },
                    })
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
            <>
              <Row label="Colour">
                <ColorPickerPopover
                  color={typography.outline.color}
                  onChange={(color) =>
                    setTypography({ outline: { ...typography.outline!, color } })
                  }
                />
              </Row>
              <Row label="Weight">
                <NumberStepper
                  value={typography.outline.width}
                  onChange={(width) =>
                    setTypography({ outline: { ...typography.outline!, width } })
                  }
                  min={0.5}
                  max={20}
                  step={0.5}
                  suffix="px"
                />
              </Row>
            </>
          )}
        </SubGroup>

        <SubGroup
          label="Glow"
          hint="A soft halo behind the words. Takes the place of the layer shadow."
          on={Boolean(typography.glow)}
          onToggle={(on) => setTypography({ glow: on ? DEFAULT_TEXT_GLOW : undefined })}
        >
          {typography.glow && (
            <>
              <Row label="Colour">
                <ColorPickerPopover
                  color={typography.glow.color}
                  onChange={(color) => setTypography({ glow: { ...typography.glow!, color } })}
                />
              </Row>
              <Row label="Spread">
                <NumberStepper
                  value={typography.glow.blur}
                  onChange={(blur) => setTypography({ glow: { ...typography.glow!, blur } })}
                  min={1}
                  max={100}
                  step={1}
                  suffix="px"
                />
              </Row>
            </>
          )}
        </SubGroup>
      </Accordion>
    </>
  );
};
