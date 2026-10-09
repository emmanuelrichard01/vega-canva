import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenterVertical,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartVertical,
  Columns3,
  RectangleHorizontal,
  RectangleVertical,
  Rows3,
  Shrink,
  SmilePlus,
  SquareRoundCorner,
  UnfoldHorizontal,
} from 'lucide-react';
import { SubGroup } from '../panelPrimitives';
import { NumberField, Note, PairRow, Row, Section, SegmentedControl, Select, Switch, writePatches } from '../grammar';
import type { AnyNode, FrameNode } from '../../../engine/model/schema';
import type { Shared } from '../../../engine/model/selection';
import {
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  LAYOUT_GUIDE_PRESETS,
  guideDraws,
  type LayoutAxis,
  type LayoutGuide,
} from '../../../engine/model/layoutGuide';
import {
  FRAME_PRESETS,
  FRAME_PRESET_GROUPS,
  FRAME_THEMES,
  framePreset,
  frameThemeFill,
  frameThemeOf,
  presetMatching,
} from '../../../engine/model/frames';
import { MAX_FRAME_DESCRIPTION } from '../../../engine/document/normalize';
import { Emoji } from '../../emoji/Emoji';
import { EmojiPickerPopover } from '../../emoji/EmojiPickerPopover';
import { useEmojiAutocomplete } from '../../emoji/useEmojiAutocomplete';
import { cornerRadiiOf } from '../../../engine/model/cornerRadii';
import { FramePresetIcon } from './framePresetIcons';
import { SlideSection } from '../../slides/SlideSection';
import './frameSection.css';

const SAFE_EDGES = [
  { key: 'top', label: 'T', name: 'Top' },
  { key: 'right', label: 'R', name: 'Right' },
  { key: 'bottom', label: 'B', name: 'Bottom' },
  { key: 'left', label: 'L', name: 'Left' },
] as const;

const AXES: {
  key: 'columns' | 'rows';
  label: string;
  hint: string;
  fallback: LayoutAxis;
  glyph: React.ReactNode;
}[] = [
  { key: 'columns', label: 'Columns', hint: 'Vertical tracks, dividing the width.', fallback: DEFAULT_COLUMNS, glyph: <Columns3 size={13} /> },
  {
    key: 'rows',
    label: 'Rows',
    hint: 'Horizontal tracks, dividing the height. A baseline rhythm more often than eight stacked boxes.',
    fallback: DEFAULT_ROWS,
    glyph: <Rows3 size={13} />,
  },
];

function sameGuide(a: LayoutGuide | undefined, b: LayoutGuide): boolean {
  const axis = (x: LayoutAxis | undefined, y: LayoutAxis | undefined) =>
    (!x && !y) || Boolean(x && y && x.count === y.count && x.gutter === y.gutter && x.margin === y.margin);
  return axis(a?.columns, b.columns) && axis(a?.rows, b.rows);
}

export interface FrameSectionProps {
  node: FrameNode;
  shared: <T>(read: (n: AnyNode) => T) => Shared<T>;
  setSafeArea: (edge: 'top' | 'right' | 'bottom' | 'left', value: number) => void;
  turnFrame: () => void;
  fitFrameToContents: () => void;
  frameChildCount: number;
  setLayoutGuide: (guide: LayoutGuide | undefined) => void;
}

/**
 * The frames in the selection.
 *
 * The panel hands sections a reader over the selection rather than the
 * selection itself; reading every node through it (a constant result never
 * short-circuits as "mixed") visits each one, which is how this section writes
 * to all selected frames and not just the one the header names.
 */
function selectedFrames(shared: FrameSectionProps['shared']): FrameNode[] {
  const frames: FrameNode[] = [];
  shared((n) => {
    if (n.type === 'frame') frames.push(n);
    return 0;
  });
  return frames;
}

/**
 * Frame: what it is called and shows, how big it is, how it looks, and the
 * guides drawn over it.
 *
 * The header (emoji and description) leads because it is what a frame is
 * known by on the board. Size presets carry the same icons as the dock's
 * frame shelf. Background themes are a short row of quiet page colours, and
 * "None" turns the frame into an outline; any other colour is still in Fill.
 */
export const FrameSection: React.FC<FrameSectionProps> = ({
  node,
  shared,
  setSafeArea,
  turnFrame,
  fitFrameToContents,
  frameChildCount,
  setLayoutGuide,
}) => {
  const write = (build: (f: FrameNode) => Record<string, unknown>) =>
    writePatches(selectedFrames(shared).map((f) => ({ id: f.id, changes: build(f) })));

  const iconRef = useRef<HTMLButtonElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const icon = shared((n) => (n.type === 'frame' ? n.icon ?? '' : ''));
  const clip = shared((n) => (n.type === 'frame' ? n.clipContent !== false : true));
  // A frame's corners are drawn as one radius; a per-corner value from elsewhere reads as its largest.
  const radius = shared((n) => (n.type === 'frame' ? Math.max(...cornerRadiiOf(n.appearance?.cornerRadius)) : 0));
  const theme = shared((n) => (n.type === 'frame' ? frameThemeOf(n.appearance?.fill)?.id ?? 'custom' : 'custom'));
  const matched = presetMatching(node.width, node.height, node.preset);

  const frameSection = (
    <Section id="frame" title="Frame" meta={matched?.label}>
      <Row label="Icon" hint="An emoji before the frame's name, as a page has in Notion.">
        <div className="frame-icon-row">
          <button
            ref={iconRef}
            type="button"
            className="frame-icon-btn"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            aria-label={icon.mixed ? 'Choose an icon for every selected frame' : icon.value ? 'Change icon' : 'Add icon'}
            onClick={() => setPickerOpen((o) => !o)}
          >
            {icon.mixed ? (
              <span className="frame-icon-btn__mixed">Mixed</span>
            ) : icon.value ? (
              <Emoji native={icon.value} size={18} />
            ) : (
              <>
                <SmilePlus size={14} aria-hidden="true" />
                <span>Add icon</span>
              </>
            )}
          </button>
          {!icon.mixed && icon.value && (
            <button type="button" className="frame-icon-clear" onClick={() => write(() => ({ icon: undefined }))}>
              Remove
            </button>
          )}
        </div>
        <EmojiPickerPopover
          anchor={iconRef}
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          label="Frame icon"
          current={icon.mixed ? undefined : icon.value || undefined}
          onPick={(native) => write(() => ({ icon: native }))}
          onRemove={icon.value || icon.mixed ? () => write(() => ({ icon: undefined })) : undefined}
          removeLabel="Remove icon"
        />
      </Row>

      <DescriptionRow
        value={shared((n) => (n.type === 'frame' ? n.description ?? '' : ''))}
        onCommit={(description) => write(() => ({ description: description || undefined }))}
      />

      <Row label="Size" hint="Resize to a standard size. The frame keeps its top-left corner.">
        <Select
          label="Frame size"
          value={matched?.id ?? '__custom'}
          options={[
            ...(matched ? [] : [{ value: '__custom', label: 'Custom', detail: `${Math.round(node.width)} × ${Math.round(node.height)}` }]),
            ...FRAME_PRESET_GROUPS.flatMap((group) =>
              FRAME_PRESETS.filter((p) => p.group === group).map((p) => ({
                value: p.id,
                label: p.label,
                icon: <FramePresetIcon icon={p.icon} />,
                detail: `${p.width} × ${p.height}`,
                group,
              }))
            ),
          ]}
          onChange={(id) => {
            const preset = framePreset(id);
            if (!preset) return;
            // Keep the orientation the frame already has: a landscape phone stays landscape.
            write((f) => {
              const turned = f.width > f.height !== preset.width > preset.height && f.width !== f.height;
              const inset = preset.safeArea;
              return turned
                ? {
                    width: preset.height,
                    height: preset.width,
                    safeArea: inset ? { top: inset.left, left: inset.top, right: inset.bottom, bottom: inset.right } : undefined,
                    preset: preset.id,
                  }
                : { width: preset.width, height: preset.height, safeArea: inset, preset: preset.id };
            });
          }}
        />
      </Row>
      <Row label="Orientation" hint="Swap width and height. The safe area is transposed with them.">
        <SegmentedControl
          ariaLabel="Frame orientation"
          fill
          disabledReason={node.width === node.height ? 'A square frame is the same either way up.' : undefined}
          value={node.height > node.width ? 'portrait' : 'landscape'}
          onChange={(next) => {
            const isPortrait = node.height > node.width;
            if ((next === 'portrait') === isPortrait) return;
            turnFrame();
          }}
          segments={[
            { value: 'portrait', label: 'Portrait', icon: <RectangleVertical size={14} /> },
            { value: 'landscape', label: 'Landscape', icon: <RectangleHorizontal size={14} /> },
          ]}
        />
      </Row>
      <button
        type="button"
        className="sketch-redraw"
        onClick={fitFrameToContents}
        disabled={frameChildCount === 0}
        data-tooltip={
          frameChildCount === 0 ? 'Nothing in this frame to fit to' : `Fit to the ${frameChildCount} object${frameChildCount === 1 ? '' : 's'} inside`
        }
      >
        <Shrink size={13} aria-hidden="true" />
        Fit to contents
      </button>

      <Row label="Background" hint="A page colour for the frame, or None to leave only its outline. Any other colour is in Fill.">
        <div
          className="frame-themes"
          role="radiogroup"
          aria-label="Frame background"
          onKeyDown={(e) => {
            const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!dir) return;
            e.preventDefault();
            const at = FRAME_THEMES.findIndex((t) => !theme.mixed && t.id === theme.value);
            const next = (Math.max(0, at) + dir + FRAME_THEMES.length) % FRAME_THEMES.length;
            const pick = FRAME_THEMES[next];
            write((f) => ({ appearance: { ...(f.appearance ?? {}), fill: frameThemeFill(pick) } }));
            e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
          }}
        >
          {FRAME_THEMES.map((t, i) => {
            const active = !theme.mixed && theme.value === t.id;
            const anyActive = !theme.mixed && FRAME_THEMES.some((x) => x.id === theme.value);
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={t.label}
                tabIndex={active || (!anyActive && i === 0) ? 0 : -1}
                data-tooltip={t.label}
                className="frame-theme"
                data-none={t.fill === null || undefined}
                style={t.fill ? { background: t.fill } : undefined}
                onClick={() => write((f) => ({ appearance: { ...(f.appearance ?? {}), fill: frameThemeFill(t) } }))}
              />
            );
          })}
        </div>
      </Row>

      <Row label="Corners">
        <NumberField
          label="Corner radius"
          glyph={<SquareRoundCorner size={13} />}
          unit="px"
          min={0}
          max={400}
          value={radius.mixed ? 'mixed' : radius.value}
          onChange={(r) => write((f) => ({ appearance: { ...(f.appearance ?? {}), cornerRadius: Math.max(0, r) || undefined } }))}
        />
      </Row>

      <Row label="Clip content" hint="Cut off what the frame holds at its edge. Off lets a caption or callout hang over while still moving with the frame.">
        <Switch ariaLabel="Clip content" checked={clip.mixed ? 'mixed' : clip.value} onChange={(on) => write(() => ({ clipContent: on ? undefined : false }))} />
      </Row>

      <SubGroup
        label="Measure"
        hint="Columns and rows drawn over the frame for placing things against. Never exported, and objects snap to them."
        on={Boolean(node.layoutGuide)}
        onToggle={(on) => setLayoutGuide(on ? { columns: DEFAULT_COLUMNS } : undefined)}
      >
        {node.layoutGuide && (
          <>
            <div className="grid-presets" role="group" aria-label="Measure preset">
              {LAYOUT_GUIDE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="grid-preset"
                  data-active={sameGuide(node.layoutGuide, preset.guide) || undefined}
                  aria-pressed={sameGuide(node.layoutGuide, preset.guide)}
                  onClick={() => setLayoutGuide(preset.guide)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {AXES.map(({ key, label, hint, fallback, glyph }) => {
              const axis = node.layoutGuide?.[key];
              return (
                <React.Fragment key={key}>
                  <Row label={label} hint={hint}>
                    <Switch
                      ariaLabel={`${label} measure`}
                      checked={Boolean(axis)}
                      onChange={(on) => setLayoutGuide({ ...node.layoutGuide, [key]: on ? fallback : undefined })}
                    />
                  </Row>
                  {axis && (
                    <PairRow>
                      <NumberField
                        label={`${label} count`}
                        glyph={glyph}
                        min={1}
                        max={48}
                        value={axis.count}
                        onChange={(count) => setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, count } })}
                      />
                      <NumberField
                        label={`Gutter between ${label.toLowerCase()}`}
                        glyph={<UnfoldHorizontal size={13} />}
                        unit="px"
                        min={0}
                        max={200}
                        value={axis.gutter}
                        onChange={(gutter) => setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, gutter } })}
                      />
                    </PairRow>
                  )}
                  {axis && (
                    <Row label="Align" hint="Stretch divides the space between the margins. Start, Centre and End give each track a fixed size and place the run.">
                      <SegmentedControl
                        ariaLabel={`${label} alignment`}
                        fill
                        value={axis.align ?? 'stretch'}
                        onChange={(v) => {
                          const align = v as NonNullable<LayoutAxis['align']>;
                          const size = align === 'stretch' ? axis.size : axis.size ?? 80;
                          setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, align: align === 'stretch' ? undefined : align, size } });
                        }}
                        segments={[
                          { value: 'stretch', label: 'Stretch', icon: <AlignHorizontalSpaceAround size={14} /> },
                          { value: 'start', label: 'Start', icon: <AlignStartVertical size={14} /> },
                          { value: 'center', label: 'Centre', icon: <AlignCenterVertical size={14} /> },
                          { value: 'end', label: 'End', icon: <AlignEndVertical size={14} /> },
                        ]}
                      />
                    </Row>
                  )}
                  {axis && (axis.align ?? 'stretch') !== 'stretch' && (
                    <Row label="Size" hint="Each track's width or height while the run is not stretched.">
                      <NumberField
                        label={`${label} track size`}
                        glyph="S"
                        unit="px"
                        min={1}
                        max={2000}
                        value={axis.size ?? 80}
                        onChange={(size) => setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, size } })}
                      />
                    </Row>
                  )}
                  {axis && (
                    <Row label="Margin" hint="Inset from the two edges this axis runs between. The first and last tracks start here.">
                      <NumberField
                        label={`${label} margin`}
                        glyph="M"
                        unit="px"
                        min={0}
                        max={400}
                        step={8}
                        value={axis.margin}
                        onChange={(margin) => setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, margin } })}
                      />
                    </Row>
                  )}
                </React.Fragment>
              );
            })}
            {!guideDraws(node, node.layoutGuide) && (
              <Note>The gutters and margins come to more than the frame. Lower one of them, or reduce the count.</Note>
            )}
          </>
        )}
      </SubGroup>

      <Row stack label="Safe area" hint="Where content is guaranteed to survive. A guide only: nothing is clipped or moved, and it never appears in an export.">
        <PairRow>
          {SAFE_EDGES.slice(0, 2).map(({ key, label, name }) => (
            <NumberField
              key={key}
              label={`${name} safe area`}
              glyph={label}
              unit="px"
              min={0}
              step={8}
              value={Math.round(node.safeArea?.[key] ?? 0)}
              onChange={(v) => setSafeArea(key, v)}
            />
          ))}
        </PairRow>
        <PairRow>
          {SAFE_EDGES.slice(2).map(({ key, label, name }) => (
            <NumberField
              key={key}
              label={`${name} safe area`}
              glyph={label}
              unit="px"
              min={0}
              step={8}
              value={Math.round(node.safeArea?.[key] ?? 0)}
              onChange={(v) => setSafeArea(key, v)}
            />
          ))}
        </PairRow>
      </Row>
    </Section>
  );

  // A top-level frame is a slide: its transition, skip, section and notes follow.
  if (node.frameId) return frameSection;
  return (
    <>
      {frameSection}
      <SlideSection node={node} shared={shared} />
    </>
  );
};

/**
 * The description field: one line, committed on Enter or on leaving it, with
 * `:shortcode` emoji. A local draft, so typing does not write a transaction
 * per keystroke and undo takes back the whole edit.
 */
const DescriptionRow: React.FC<{ value: Shared<string>; onCommit: (value: string) => void }> = ({ value, onCommit }) => {
  const committed = value.mixed ? '' : value.value;
  const [draft, setDraft] = useState(committed);
  const ref = useRef<HTMLInputElement>(null);
  const complete = useEmojiAutocomplete(ref, setDraft);
  useEffect(() => setDraft(committed), [committed]);

  const commit = () => {
    const next = draft.replace(/\s+/g, ' ').trim().slice(0, MAX_FRAME_DESCRIPTION);
    if (next !== committed || value.mixed) onCommit(next);
  };

  return (
    <Row stack label="Description" hint="A line under the frame's name saying what it is for. Not exported.">
      <input
        ref={ref}
        className="frame-desc-input"
        aria-label="Frame description"
        placeholder={value.mixed ? 'Mixed' : 'What this frame is for'}
        value={draft}
        maxLength={MAX_FRAME_DESCRIPTION}
        onChange={(e) => {
          setDraft(e.target.value);
          complete.sync();
        }}
        onSelect={complete.sync}
        onBlur={() => {
          complete.dismiss();
          commit();
        }}
        onKeyDown={(e) => {
          if (complete.onKeyDown(e)) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            ref.current?.blur();
          } else if (e.key === 'Escape') {
            setDraft(committed);
          }
        }}
        {...complete.fieldProps}
      />
      {complete.menu}
    </Row>
  );
};
