import React from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignVerticalSpaceBetween,
  ALargeSmall,
  PenLine,
  Squircle,
  Sun,
  UnfoldHorizontal,
  UnfoldVertical,
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
import { EffectSpecimen, VerticalAlignGlyph } from '../typeGlyphs';
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
        {/*
          Weight and size, on one line, with no labels.

          ## Why these rows lost their label column

          The panel is built on label-plus-control rows, and that is right where
          a control's job is not visible from its own shape — a swatch, a
          segmented choice, a list style. The type block is where it stops
          paying. Eight rows each spending 84px of a 260px panel on one word,
          for fields that already carry a glyph and a unit: "Size" beside a
          field reading `16 px` is a label restating its own value.

          Figma and Illustrator both drop the labels here and pair the fields
          two to a row, and the pairing is not only density — **leading is read
          against tracking**, and size against weight. Two numbers you compare
          belong on one line.

          Scoped to these rows rather than applied to the panel, so everything
          else keeps its column and nothing looks like it came from a different
          app.
        */}
        <div className="prop-grid">
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
          {(() => {
            const size = sharedType((t) => t.fontSize);
            return (
              <NumberStepper
                aria-label="Font size"
                glyph={<ALargeSmall size={13} />}
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
        </div>

        {/*
          Leading and tracking, which belong to the letters rather than the block.

          They lived under Paragraph, and that is the one place this panel's
          split came out on the wrong side of the line it drew. Illustrator's
          Character panel holds size, leading, kerning and tracking; its
          Paragraph panel holds alignment, indents and space around. The test
          the split states — "what the letters are" against "what the block does
          with them" — gives the same answer: leading is the distance between
          two lines of *type*, and changing the size changes it, which is not
          true of anything else that was down there.

          The glyphs are the controls' names: one opens vertical space, the
          other horizontal. That is the whole distinction, and it is faster to
          see than to read.
        */}
        <div className="prop-grid">
          {(() => {
            const lh = sharedType((t) => t.lineHeight);
            const ratio = lh.value ?? 1.2;
            /**
             * Shown in pixels, stored as a ratio.
             *
             * The field used to show the multiplier with the pixel value beside
             * it, which is two numbers for one setting — and the multiplier is
             * the one nobody is reading. `1.2` is a ratio against a size you
             * have to remember; `19px` is the distance you are actually
             * setting, and it is what Figma shows and what Illustrator shows
             * in points. The row beside it is already in pixels, so the two
             * were being read in different units on the same line.
             *
             * The **ratio stays in the model**, and that is deliberate rather
             * than a leftover: a leading stored in pixels does not follow a
             * size change, so scaling a heading from 16 to 48 would leave its
             * lines overlapping. Storing the ratio and editing the product is
             * the arrangement that gets both — a number you can reason about,
             * on type that keeps its proportions.
             *
             * The bounds move with the size for the same reason: 0.5x to 3x is
             * the range the model allows, and expressed in pixels that is a
             * different pair of numbers at every size.
             */
            const px = Math.round(typography.fontSize * ratio);
            return (
              <NumberStepper
                aria-label="Leading, the distance between baselines"
                glyph={<UnfoldVertical size={13} />}
                suffix="px"
                value={px}
                mixed={lh.mixed}
                onChange={(next) => setTypography({ lineHeight: next / typography.fontSize })}
                min={Math.round(typography.fontSize * 0.5)}
                max={Math.round(typography.fontSize * 3)}
                step={1}
              />
            );
          })()}
          {(() => {
            const ls = sharedType((t) => t.letterSpacing);
            return (
              <NumberStepper
                aria-label="Tracking, the space added between characters"
                glyph={<UnfoldHorizontal size={13} />}
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
        </div>

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
        {/*
          Beside its label, not under it.

          `stack` is for a control that cannot fit the 136px value column — six
          list styles, three resize modes with words in them. Four case
          segments fit in 34px each, which is exactly what the Style toggles
          directly above are given, and the two rows are the same kind of thing:
          a small group of marks describing how the letters look. Stacking one
          and not the other made them read as different orders of setting and
          cost a row of height for nothing.
        */}
        <Row label="Case" hint="Changes how the text is shown, never what is stored. Switching back returns what you typed.">
          <SegmentedControl
            ariaLabel="Text case"
            fill
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

        **Leading and tracking moved up on 2026-09-03**, which is the one place
        the first cut came out on the wrong side of its own line. Illustrator's
        Character panel holds size, leading, kerning and tracking; its Paragraph
        panel holds alignment, indents and space around. The test above agrees:
        leading is the distance between two lines of *type* and changes when the
        size does, which is not true of anything else that was down here.
      */}
      <Accordion
        title="Paragraph"
        icon={<AlignLeft size={13} />}
        defaultOpen={node.type === 'text'}
      >
        {/*
          Both alignments, on one line.

          Horizontal and vertical are one question asked twice — *where in its
          box does this sit* — and on separate rows, each with its own label,
          they read as two unrelated settings. Side by side the seven buttons
          are one control with two axes, which is what they are, and what both
          references show.

          The vertical one is newly reachable at all. `verticalAlign` has been
          in the schema since the beginning and every renderer forwards it, and
          there has never been a control: the only way a board got anything but
          `top` was a shape whose renderer hard-codes `middle`. It matters most
          where this app is used most — a label against the top edge of a box
          it is centred in horizontally is the commonest thing to want to fix,
          and the answer used to be to nudge the text by hand.
        */}
        <div className="prop-grid prop-grid--align">
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
              /*
                Drawn here rather than borrowed. Lucide's `AlignStartVertical`
                and its siblings show several objects distributed along an
                axis — they are the marks for aligning a *selection of shapes to
                each other*, which is a different operation this app also has.
                Using them here said the wrong thing twice: it failed to depict
                vertical alignment, and it claimed a meaning already spoken for.
                A box with type sitting in part of it is what the setting
                actually is, and what both references draw.
              */
              { value: 'top', label: 'Top', hint: 'Sits against the top of the box', icon: <VerticalAlignGlyph where="top" /> },
              { value: 'middle', label: 'Middle', hint: 'Centred in the box', icon: <VerticalAlignGlyph where="middle" /> },
              { value: 'bottom', label: 'Bottom', hint: 'Sits against the bottom of the box', icon: <VerticalAlignGlyph where="bottom" /> },
            ]}
          />
        </div>
        {/*
          Space between paragraphs.

          Called "Paragraph" inside a section called Paragraph, which named the
          section rather than the setting and left the row meaning nothing on
          its own. It is the gap after a paragraph, so it says that.
        */}
        <Row label="Space after" hint="Extra room between paragraphs, on top of the leading.">
          {(() => {
            const ps = sharedType((t) => t.paragraphSpacing ?? 0);
            return (
              <NumberStepper
                aria-label="Space after a paragraph"
                glyph={<AlignVerticalSpaceBetween size={13} />}
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
            fill
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
            fill
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
          The presets come first now.

          They sat below two rows of colour-cycle controls, in the middle of the
          section, which put the section's *fast path* behind its most
          specialised setting. A preset is the answer to "give me a look" and
          the three groups below are the answer to "now change one thing about
          it" — that is an order, and the section was in the other one.

          And each chip shows itself. A row of words is a list of things you
          have to try; a row of specimens is a row of answers. They are drawn
          with the same numbers the preset would write, so a chip is not an
          illustration of the preset, it is the preset.
        */}
        <div className="prop-presets fx-presets" role="group" aria-label="Text effect presets">
          {TEXT_PRESETS.map((preset) => {
            const active = isTextPresetActive(preset, typography);
            // What this chip would produce, applied to the chip itself.
            const t = preset.patch(typography) as Partial<Typography>;
            return (
              <button
                key={preset.id}
                type="button"
                className="prop-preset fx-preset"
                data-active={active || undefined}
                aria-pressed={active}
                onClick={() => setTypography(preset.patch(typography))}
                data-tooltip={preset.hint}
                data-tooltip-pos="top"
              >
                <EffectSpecimen
                  color={t.color ?? typography.color}
                  highlight={t.highlight ?? null}
                  outline={t.outline ?? null}
                  glow={t.glow ?? null}
                />
                <span className="fx-preset__name">{preset.label}</span>
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
                {/*
                  A pipette here as well as on the type colour.

                  A highlight is chosen *against* something — the board, the
                  text, an image behind it — which is the exact case a pipette
                  exists for, and it was offered on the one colour in this panel
                  least likely to be sampled from the screen and withheld from
                  the three most likely.
                */}
                <div className="prop-inline">
                  <ColorPickerPopover
                    color={typography.highlight.color}
                    onChange={(color) =>
                      setTypography({ highlight: { ...typography.highlight!, color } })
                    }
                  />
                  <EyedropperButton
                    label="Pick a highlight colour from the screen"
                    onPick={(color) =>
                      setTypography({ highlight: { ...typography.highlight!, color } })
                    }
                  />
                </div>
              </Row>
              <Row label="Shape" hint="Ribbon welds the lines into one shape with tucked corners. Plates keeps each line separate.">
                <SegmentedControl
                  ariaLabel="Highlight shape"
            fill
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
              {/*
                Corner and padding are the plate's two dimensions and were two
                labelled rows. They are read against each other — a large radius
                on tight padding is a lozenge, on loose padding a rounded box —
                so they go on one line with the glyphs doing the naming, the
                same treatment leading and tracking got above.
              */}
              <div className="prop-grid">
                <NumberStepper
                  aria-label="Corner radius of the highlight plate"
                  glyph={<Squircle size={13} />}
                  value={typography.highlight.radius}
                  onChange={(radius) =>
                    setTypography({ highlight: { ...typography.highlight!, radius } })
                  }
                  min={0}
                  max={60}
                  step={1}
                  suffix="px"
                />
                <NumberStepper
                  aria-label="Padding either side of each line"
                  glyph={<UnfoldHorizontal size={13} />}
                  value={typography.highlight.paddingX}
                  onChange={(paddingX) =>
                    setTypography({ highlight: { ...typography.highlight!, paddingX } })
                  }
                  min={0}
                  max={80}
                  step={1}
                  suffix="px"
                />
              </div>
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
                <div className="prop-inline">
                  <ColorPickerPopover
                    color={typography.outline.color}
                    onChange={(color) =>
                      setTypography({ outline: { ...typography.outline!, color } })
                    }
                  />
                  <EyedropperButton
                    label="Pick an outline colour from the screen"
                    onPick={(color) => setTypography({ outline: { ...typography.outline!, color } })}
                  />
                </div>
              </Row>
              <Row label="Weight">
                <NumberStepper
                  aria-label="Outline weight"
                  glyph={<PenLine size={13} />}
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
                <div className="prop-inline">
                  <ColorPickerPopover
                    color={typography.glow.color}
                    onChange={(color) => setTypography({ glow: { ...typography.glow!, color } })}
                  />
                  <EyedropperButton
                    label="Pick a glow colour from the screen"
                    onPick={(color) => setTypography({ glow: { ...typography.glow!, color } })}
                  />
                </div>
              </Row>
              <Row label="Spread">
                <NumberStepper
                  aria-label="Glow spread"
                  glyph={<Sun size={13} />}
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

        {/*
          The colour cycle, last.

          It led this section, and it is the most specialised thing in it — a
          ramp spread across a whole block, which almost nothing needs and which
          took two full-width rows to offer. Leading with it put the rare answer
          where the eye lands and pushed the presets, which are the common one,
          into the middle.

          It stays in this section rather than up with the type colour: a ramp
          across a block is an *effect* on the letters, in the same family as a
          highlight or a glow, and nothing about it belongs beside a font size.
        */}
        <Row stack label="Colour cycle" hint="Spreads a ramp of colours across the whole block. Editing the text re-spaces it.">
          <SegmentedControl
            ariaLabel="Colour ramp"
            fill
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
            fill
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
      </Accordion>
    </>
  );
};
