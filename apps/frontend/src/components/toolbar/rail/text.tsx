import React from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Italic,
  List,
  ListOrdered,
  Minus,
  PenLine,
  Strikethrough,
  Type,
  Underline,
  WandSparkles,
} from 'lucide-react';
import type { ListStyle, TextAlign, Typography } from '../../../engine/model/schema';
import { ColorPickerPopover } from '../../ui/ColorPickerPopover';
import { FontSelector } from '../../ui/FontSelector';
import { FontWeightSelect } from '../../ui/FontWeightSelect';
import { TextFaceToggle, TextStyleList } from '../../dock/TextStylePicker';
import { TEXT_FACES, TEXT_STYLES, faceOf, nextText, styleOf, stylePatch } from '../../../engine/tools/TextToolStyles';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { TEXT_PRESETS, isTextPresetActive } from '../../panel/textEffectPresets';
import { PopoverSlider } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { ScrubValue } from './controls';
import { HANDWRITTEN, MAX_FONT_SIZE, MIN_FONT_SIZE } from './fonts';


type SetTypography = (patch: Partial<Typography>) => void;

const ALIGN_ICON: Record<TextAlign, React.ReactNode> = {
  left: <AlignLeft size={16} />,
  center: <AlignCenter size={16} />,
  right: <AlignRight size={16} />,
  justify: <AlignJustify size={16} />,
};

const ALIGN_SEGMENTS = [
  { value: 'left', label: 'Left', icon: <AlignLeft size={14} /> },
  { value: 'center', label: 'Centre', icon: <AlignCenter size={14} /> },
  { value: 'right', label: 'Right', icon: <AlignRight size={14} /> },
  { value: 'justify', label: 'Justify', icon: <AlignJustify size={14} /> },
];

const LIST_SEGMENTS = [
  { value: 'none', label: 'None', hint: 'No list', icon: <Minus size={14} /> },
  { value: 'bullet', label: 'Bullet', hint: 'A round dot', icon: <List size={14} /> },
  { value: 'dash', label: 'Dash', hint: 'An en dash', icon: <span className="rail-glyph">&#8211;</span> },
  { value: 'circle', label: 'Hollow', hint: 'An open circle', icon: <span className="rail-glyph">&#9702;</span> },
  { value: 'number', label: 'Numbered', hint: '1. 2. 3.', icon: <ListOrdered size={14} /> },
  { value: 'letter', label: 'Lettered', hint: 'a. b. c.', icon: <span className="rail-glyph">a.</span> },
];

/** Family and size in one trigger: "Inter 24". The size scrubs; the popover holds the rest. */
export const FontControl: React.FC<{ typography: Typography; set: SetTypography }> = ({ typography, set }) => {
  const handwritten = HANDWRITTEN.includes(typography.fontFamily);
  const setSize = (fontSize: number) => set({ fontSize });
  return (
    <RailPopover
      label="Font"
      align="start"
      trigger={
        <span className="rail-font">
          <span className="rail-font__family">{typography.fontFamily}</span>
          <ScrubValue value={typography.fontSize} min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} onChange={setSize}>
            {null}
          </ScrubValue>
          <ChevronDown size={12} aria-hidden className="rail-kind__chevron" />
        </span>
      }
    >
      <span className="ctx-popover__label">Font</span>
      <FontSelector value={typography.fontFamily} onChange={(fontFamily) => set({ fontFamily })} weight={typography.fontWeight ?? 400} onWeightChange={(fontWeight) => set({ fontWeight })} />
      <span className="ctx-popover__label">Weight</span>
      <FontWeightSelect family={typography.fontFamily} value={typography.fontWeight} onChange={(fontWeight) => set({ fontWeight })} />
      <PopoverSlider label="Size" value={typography.fontSize} min={MIN_FONT_SIZE} max={160} onChange={setSize} />
      {/* A hand-drawn typeface rather than a filter: it exports as text and was drawn by a hand. */}
      <button
        type="button"
        className="ctx-popover__action"
        aria-pressed={handwritten}
        onClick={() => set({ fontFamily: handwritten ? 'Inter' : 'Caveat' })}
      >
        <PenLine size={14} />
        {handwritten ? 'Back to typed' : 'Handwritten'}
      </button>
    </RailPopover>
  );
};

/**
 * The text's style: Title, Heading, Subheading, Body or Caption, each shown in
 * itself, and the face. "Custom" when the size and weight match no style.
 *
 * Picking one also makes it the style the next text box is made in, so a
 * board settles into its hierarchy without anybody setting the tool twice.
 */
export const TextStyleControl: React.FC<{ typography: Typography; set: SetTypography }> = ({ typography, set }) => {
  const style = styleOf(typography);
  const face = faceOf(typography.fontFamily);
  return (
    <RailPopover
      label="Text style"
      align="start"
      trigger={
        <span className="rail-font">
          <span className="rail-font__family">{style ? TEXT_STYLES[style].label : 'Custom'}</span>
          <ChevronDown size={12} aria-hidden className="rail-kind__chevron" />
        </span>
      }
    >
      <span className="ctx-popover__label">Style</span>
      <TextStyleList
        value={style}
        face={face ?? 'sans'}
        onPick={(id) => {
          set(stylePatch(id));
          nextText.set({ style: id });
        }}
      />
      <span className="ctx-popover__label">Face</span>
      <TextFaceToggle
        labelled
        value={face}
        onPick={(f) => {
          set({ fontFamily: TEXT_FACES[f].family });
          nextText.set({ face: f });
        }}
      />
    </RailPopover>
  );
};

/** Alignment and lists: both decide how lines sit, so they share one popover. */
export const ParagraphControl: React.FC<{ typography: Typography; set: SetTypography }> = ({ typography, set }) => (
  <RailPopover label="Alignment and lists" trigger={ALIGN_ICON[typography.align] ?? ALIGN_ICON.left}>
    <span className="ctx-popover__label">Alignment</span>
    <SegmentedControl
      ariaLabel="Text alignment"
      value={typography.align}
      onChange={(align) => set({ align: align as TextAlign })}
      segments={ALIGN_SEGMENTS}
    />
    <span className="ctx-popover__label">List</span>
    <SegmentedControl
      ariaLabel="List style"
      value={typography.list ?? 'none'}
      onChange={(v) => set({ list: v === 'none' ? undefined : (v as ListStyle) })}
      segments={LIST_SEGMENTS}
    />
  </RailPopover>
);

/** Decoration and the effect presets: the rarer half of styling text. */
export const EffectsControl: React.FC<{ typography: Typography; set: SetTypography }> = ({ typography, set }) => (
  <RailPopover label="Text effects" trigger={<WandSparkles size={16} />} align="start">
    <span className="ctx-popover__label">Decoration</span>
    <div className="rail-toggle-row">
      <button
        type="button"
        className="ctx-shape-btn"
        aria-pressed={typography.underline}
        aria-label="Underline"
        data-tooltip="Underline"
        onClick={() => set({ underline: !typography.underline })}
      >
        <Underline size={15} />
      </button>
      <button
        type="button"
        className="ctx-shape-btn"
        aria-pressed={typography.strikethrough}
        aria-label="Strikethrough"
        data-tooltip="Strikethrough"
        onClick={() => set({ strikethrough: !typography.strikethrough })}
      >
        <Strikethrough size={15} />
      </button>
    </div>
    <span className="ctx-popover__label">Effects</span>
    <div className="rail-preset-grid">
      {TEXT_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="ctx-shape-btn ctx-shape-btn--text"
          aria-pressed={isTextPresetActive(preset, typography)}
          onClick={() => set(preset.patch(typography))}
          data-tooltip={preset.hint}
        >
          {preset.label}
        </button>
      ))}
    </div>
    {typography.highlight && (
      <div className="ctx-popover__row">
        <span className="ctx-popover__label">Highlight</span>
        <ColorPickerPopover
          color={typography.highlight.color}
          onChange={(color) => set({ highlight: { ...typography.highlight!, color } })}
        />
      </div>
    )}
    {typography.outline && (
      <div className="ctx-popover__row">
        <span className="ctx-popover__label">Outline</span>
        <ColorPickerPopover
          color={typography.outline.color}
          onChange={(color) => set({ outline: { ...typography.outline!, color } })}
        />
      </div>
    )}
    {typography.glow && (
      <div className="ctx-popover__row">
        <span className="ctx-popover__label">Glow</span>
        <ColorPickerPopover
          color={typography.glow.color}
          onChange={(color) => set({ glow: { ...typography.glow!, color } })}
        />
      </div>
    )}
  </RailPopover>
);


/**
 * A shape's label, styled from one popover.
 *
 * A shape's rail is about the shape; its words get one control that opens
 * everything a text object has inline.
 */
export const LabelStyleControl: React.FC<{ typography: Typography; set: SetTypography; surface: string }> = ({
  typography,
  set,
  surface,
}) => {
  const bold = typography.fontWeight >= 600;
  return (
    <RailPopover label="Label style" trigger={<Type size={16} />} align="start">
      <span className="ctx-popover__label">Font</span>
      <FontSelector value={typography.fontFamily} onChange={(fontFamily) => set({ fontFamily })} weight={typography.fontWeight ?? 400} onWeightChange={(fontWeight) => set({ fontWeight })} />
      <PopoverSlider
        label="Size"
        value={typography.fontSize}
        min={MIN_FONT_SIZE}
        max={160}
        onChange={(fontSize) => set({ fontSize })}
      />
      <div className="rail-toggle-row">
        <button
          type="button"
          className="ctx-shape-btn"
          aria-pressed={bold}
          aria-label="Bold"
          data-tooltip="Bold"
          onClick={() => set({ fontWeight: bold ? 400 : 700 })}
        >
          <Bold size={15} />
        </button>
        <button
          type="button"
          className="ctx-shape-btn"
          aria-pressed={typography.italic}
          aria-label="Italic"
          data-tooltip="Italic"
          onClick={() => set({ italic: !typography.italic })}
        >
          <Italic size={15} />
        </button>
        <button
          type="button"
          className="ctx-shape-btn"
          aria-pressed={typography.underline}
          aria-label="Underline"
          data-tooltip="Underline"
          onClick={() => set({ underline: !typography.underline })}
        >
          <Underline size={15} />
        </button>
      </div>
      <span className="ctx-popover__label">Alignment</span>
      <SegmentedControl
        ariaLabel="Label alignment"
        value={typography.align}
        onChange={(align) => set({ align: align as TextAlign })}
        segments={ALIGN_SEGMENTS}
      />
      <div className="ctx-popover__row">
        <span className="ctx-popover__label">Colour</span>
        <ColorPickerPopover color={typography.color} onChange={(color) => set({ color })} contrastAgainst={surface} />
      </div>
    </RailPopover>
  );
};
