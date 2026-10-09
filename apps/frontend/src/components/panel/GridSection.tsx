import React from 'react';
import {
  ArrowLeftRight,
  ArrowUpDown,
  Columns3,
  Grid2x2,
  Link2,
  MoveHorizontal,
  MoveVertical,
  Rows3,
  Unlink2,
} from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { GridKindArt } from '../dock/art/DataArt';
import { canEditObjects } from '../../engine/model/permissions';
import { GRID_PRESETS, gridPresetMatching } from '../../engine/grid/gridPresets';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { setGridRecipe } from '../../engine/grid/gridApply';
import { gridContent, setItemPlacement } from '../../engine/grid/gridSlotApply';
import { recipeCells, switchKind, withSpec, withStyle, type GridRecipe } from '../../engine/grid/gridBuild';
import { canEditCells, currentTrackSizes, resetTracks, setTrack, setTrackCount } from '../../engine/grid/gridEdit';
import { gridEditMode, useGridEditMode } from '../../engine/grid/gridEditMode';
import { paddingOf } from '../../engine/grid/gridLayout';
import { MAX_TRACKS } from '../../engine/grid/gridTracks';
import { GridThumb, GridVariations } from './GridVariations';
import { CellFace } from './CellFace';
import {
  ColorChip,
  FullRow,
  IconToggle,
  Note,
  NumberField,
  PairRow,
  Row,
  Section,
  SegmentedControl,
  Select,
  SpecimenPicker,
  Switch,
  type NumberFieldChange,
} from './grammar';
import {
  GRID_HINTS,
  GRID_KINDS,
  GRID_LABELS,
  VARIATION_LABELS,
  type CellAlign,
  type CellAlignAxis,
  type GridKind,
  type GridPadding,
  type GridTrack,
} from '../../engine/grid/gridLayout';
import {
  CELL_SHAPES,
  COLOR_MODES,
  COLOR_MODE_LABELS,
  GRID_DISPLAY_HINTS,
  GRID_DISPLAY_LABELS,
  GRID_DISPLAY_MODES,
  GRID_PALETTES,
  SHAPE_LABELS,
  type CellShape,
  type ColorMode,
  type GridDisplayMode,
} from '../../engine/grid/gridStyle';
import './gridSection.css';

/**
 * Editing a grid after it exists.
 *
 * Six sections in the panel grammar's order of questions: what system it is,
 * how its tracks are arranged, how content sits in it, its individual tracks,
 * what its modules look like, and how colour is spent. Every number field
 * writes the document only when a value is committed, so a scrub is one undo
 * step.
 */

interface Props {
  /** The selected grid node. */
  nodeId: string;
}

/** The kinds with real rows and columns, which are the ones that can hug, span and size tracks. */
const REGULAR: ReadonlySet<GridKind> = new Set(['columns', 'modular']);

export const GridSection: React.FC<Props> = ({ nodeId }) => {
  const node = useStore((s) => s.objects[nodeId]);
  const recipe = node?.type === 'grid' ? node.grid : null;
  /**
   * What is in the grid, selected as one string so the section re-renders when
   * content enters, leaves or waits, and not on every edit elsewhere on the
   * board. A string rather than the summary object because the summary carries
   * an array, and a fresh array per read would never compare equal.
   */
  const contentKey = useStore((s) => {
    const c = gridContent(s.objects, nodeId);
    return `${c.modules}|${c.filled}|${c.parkedIds.join(',')}`;
  });
  const content = React.useMemo(() => {
    const [modules, filled, ids] = contentKey.split('|');
    const parkedIds = ids ? ids.split(',') : [];
    return { modules: Number(modules), filled: Number(filled), parked: parkedIds.length, parkedIds };
  }, [contentKey]);
  const editing = useGridEditMode();
  // Edit cells belongs to a selected grid: leaving the grid's panel leaves the mode.
  React.useEffect(
    () => () => {
      if (gridEditMode.get().gridId === nodeId) gridEditMode.exit();
    },
    [nodeId]
  );

  // Ways of editing rather than properties of the grid, so they stay local.
  const [gapsLinkWanted, setGapsLinkWanted] = React.useState(true);
  const [padLinkWanted, setPadLinkWanted] = React.useState(true);
  const [mixWanted, setMixWanted] = React.useState(false);

  const cellCount = React.useMemo(() => (recipe ? recipeCells(recipe).length : 0), [recipe]);
  const sampleCell = React.useMemo(() => {
    if (!recipe) return 0;
    const cells = recipeCells(recipe);
    return cells.length === 0 ? 0 : Math.min(...cells.map((c) => Math.min(c.width, c.height)));
  }, [recipe]);

  if (!recipe || node?.type !== 'grid') return null;

  const { spec, style } = recipe;
  const apply = (next: GridRecipe) => setGridRecipe(nodeId, next);
  const patchSpec = (patch: Parameters<typeof withSpec>[1]) => apply(withSpec(recipe, patch));
  const patchStyle = (patch: Parameters<typeof withStyle>[1]) => apply(withStyle(recipe, patch));
  /** A number field's handler: write on commit only. */
  const onCommit = (write: (v: number) => void) => (v: number, change: NumberFieldChange) => {
    if (change.commit) write(v);
  };

  const kind = spec.kind;
  const regular = REGULAR.has(kind);
  const merged = kind === 'radial' && spec.merged === true;
  const hasRings = kind === 'radial' || kind === 'orbit';
  const usesRows = !['columns', 'manuscript'].includes(kind);
  const usesColumns = !['manuscript', 'baseline'].includes(kind) && !merged;
  const variationLabel = VARIATION_LABELS[kind];
  const displayMode: GridDisplayMode = style.mode ?? 'surface';
  const mixing = mixWanted || style.shapes.length > 1;
  const activePreset = gridPresetMatching(spec);
  const gapsLinked = gapsLinkWanted && spec.gutterX === spec.gutterY;
  const pad = paddingOf(spec);
  const padUniform = pad.top === pad.right && pad.right === pad.bottom && pad.bottom === pad.left;
  const padLinked = padLinkWanted && padUniform;
  const align: CellAlign = spec.contentAlign ?? { x: 'stretch', y: 'stretch' };
  const hugging = spec.sizing === 'hug';
  const canEdit = canEditObjects();
  const editable = canEditCells(kind);
  const isEditing = editing.gridId === nodeId;

  /**
   * Track counts on the regular kinds go through `setTrackCount`, which keeps
   * content in the module it was in when the numbering shifts. Other kinds
   * number modules by position and keep the simple write.
   */
  const setCount = (axis: 'cols' | 'rows', n: number) => {
    if (regular) setTrackCount(nodeId, axis, n);
    else patchSpec(axis === 'cols' ? { columns: n } : { rows: n });
  };

  const setPadding = (next: GridPadding) => {
    const uniform = next.top === next.right && next.right === next.bottom && next.bottom === next.left;
    // A uniform inset is stored as the plain margin, so the common case keeps
    // the shape every older reader understands.
    patchSpec(uniform ? { margin: next.top, padding: undefined } : { padding: next, margin: 0 });
  };

  // Through `setItemPlacement`, which re-sets the text in the grid in the same
  // step: text in a cell takes its alignment from Item placement.
  const setAlign = (next: CellAlign) => setItemPlacement(nodeId, next);

  const rowLabel = hasRings ? 'Rings' : 'Rows';
  const colLabel = hasRings ? 'Spokes' : kind === 'golden' ? 'Steps' : 'Columns';

  return (
    <div className="gsec" data-readonly={!canEdit || undefined} inert={!canEdit || undefined}>
      {!canEdit && <Note>View only. Ask for edit access to change this grid.</Note>}
      <div className="gsec-mode" data-active={isEditing || undefined}>
        <div className="gsec-mode__text">
          <span className="gsec-mode__title">{isEditing ? 'Editing cells' : 'Edit cells'}</span>
          <span className="gsec-mode__hint">
            {!editable
              ? 'Cells can be edited on column, modular and bento grids'
              : isEditing
                ? 'Drag a track edge to resize (Shift: rest even, Alt: grow grid, double-click: fit). Pick modules to merge (M) or split. Esc leaves.'
                : 'Merge, split and resize tracks on the board, or double-click a gutter. Double-click an empty cell to type in it.'}
          </span>
        </div>
        <button
          type="button"
          className="gsec-action"
          aria-pressed={isEditing}
          disabled={!editable || !canEdit}
          onClick={() => (isEditing ? gridEditMode.exit() : gridEditMode.enter(nodeId))}
        >
          {isEditing ? 'Done' : 'Edit cells'}
        </button>
      </div>
      <Section
        id="grid-system"
        title="Grid"
        meta={`${cellCount} ${cellCount === 1 ? 'module' : 'modules'}`}
      >
        <div className="gsec-kinds" role="radiogroup" aria-label="Grid system">
          {GRID_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={k === kind}
              className="gsec-kind"
              data-tooltip={`${GRID_LABELS[k]}: ${GRID_HINTS[k]}`}
              onClick={() => k !== kind && apply(switchKind(recipe, k))}
            >
              <GridKindArt kind={k} size={44} />
              <span className="gsec-kind__name">{GRID_LABELS[k]}</span>
            </button>
          ))}
        </div>
        <Note>
          <strong className="gsec-strong">{GRID_LABELS[kind]}.</strong> {GRID_HINTS[kind]}
        </Note>
        <Row label="Preset">
          <Select
            label="Grid preset"
            value={activePreset?.id ?? 'custom'}
            options={[
              ...GRID_PRESETS.map((p) => ({ value: p.id, label: p.label, detail: p.hint })),
              { value: 'custom', label: 'Custom', detail: 'Your own numbers' },
            ]}
            onChange={(id) => {
              const preset = GRID_PRESETS.find((p) => p.id === id);
              // The kind first (it brings its own defaults), then the preset's numbers.
              if (preset) apply(withSpec(switchKind(recipe, preset.kind), preset.patch));
            }}
          />
        </Row>
        <Row label="Used as" hint={GRID_DISPLAY_HINTS[displayMode]} stack>
          <SegmentedControl
            ariaLabel="What the grid is used as"
            fill
            value={displayMode}
            segments={GRID_DISPLAY_MODES.map((m) => ({ value: m, label: GRID_DISPLAY_LABELS[m], hint: GRID_DISPLAY_HINTS[m] }))}
            onChange={(m) => patchStyle({ mode: m as GridDisplayMode })}
          />
        </Row>
      </Section>

      <Section id="grid-structure" title="Structure">
        {(usesRows || usesColumns) && (
          <PairRow>
            {usesRows ? (
              <NumberField
                label={rowLabel}
                glyph={<Rows3 size={12} />}
                value={kind === 'columns' ? 1 : spec.rows}
                min={1}
                max={MAX_TRACKS}
                onChange={onCommit((n) => setCount('rows', n))}
              />
            ) : (
              <span />
            )}
            {usesColumns ? (
              <NumberField
                label={colLabel}
                glyph={<Columns3 size={12} />}
                value={spec.columns}
                min={1}
                max={MAX_TRACKS}
                onChange={onCommit((n) => setCount('cols', n))}
              />
            ) : (
              <span />
            )}
          </PairRow>
        )}
        <Row
          label="Row height"
          hint={
            !regular
              ? 'Only column and modular grids have rows that can grow'
              : hugging
                ? 'Each row grows to fit the text, sticky or table in it; the grid gets taller to match'
                : "Rows share the grid's height, however much is in them"
          }
          stack
        >
          <SegmentedControl
            ariaLabel="Row sizing"
            fill
            value={hugging ? 'hug' : 'fixed'}
            disabledReason={regular ? undefined : 'Only column and modular grids have rows that can grow'}
            segments={[
              { value: 'fixed', label: 'Fixed', hint: 'Rows share the grid height' },
              { value: 'hug', label: 'Hug content', hint: 'Rows grow to fit what is in them' },
            ]}
            onChange={(v) => patchSpec({ sizing: v === 'hug' ? 'hug' : undefined })}
          />
        </Row>
        <PairRow linked>
          <NumberField
            label="Gap across"
            glyph={<MoveHorizontal size={12} />}
            value={spec.gutterX}
            min={0}
            max={400}
            unit="px"
            onChange={onCommit((v) => patchSpec(gapsLinked ? { gutterX: v, gutterY: v } : { gutterX: v }))}
          />
          <IconToggle
            label={gapsLinked ? 'Unlink the gaps' : 'Link the gaps'}
            pressed={gapsLinked}
            onClick={() => {
              const next = !gapsLinked;
              setGapsLinkWanted(next);
              if (next) patchSpec({ gutterY: spec.gutterX });
            }}
          >
            {gapsLinked ? <Link2 size={13} /> : <Unlink2 size={13} />}
          </IconToggle>
          <NumberField
            label="Gap down"
            glyph={<MoveVertical size={12} />}
            value={spec.gutterY}
            min={0}
            max={400}
            unit="px"
            onChange={onCommit((v) => patchSpec(gapsLinked ? { gutterX: v, gutterY: v } : { gutterY: v }))}
          />
        </PairRow>
        {variationLabel && !(regular && spec.tracks) && (
          <Row label={variationLabel} stack>
            <NumberField
              label={variationLabel}
              value={Math.round(spec.variation * 100)}
              min={0}
              max={100}
              unit="%"
              onChange={onCommit((v) => patchSpec({ variation: v / 100 }))}
            />
          </Row>
        )}
        {hasRings && spec.rows > 1 && !merged && (
          <Row label="Ring offset" hint="Turns each ring against the one inside it, in modules">
            <NumberField
              label="Ring offset"
              value={Math.round((spec.stagger ?? 0) * 100)}
              min={0}
              max={100}
              unit="%"
              onChange={onCommit((v) => patchSpec({ stagger: v / 100 }))}
            />
          </Row>
        )}
        {kind === 'radial' && (
          <FullRow>
            <Switch
              block
              checked={merged}
              label="Continuous ring"
              tooltip="One unbroken band per ring instead of sectors"
              onChange={(on) => patchSpec({ merged: on })}
            />
          </FullRow>
        )}
        <FullRow>
          <Switch
            block
            checked={style.showLabels === true}
            label="Track labels"
            tooltip="Name the top row and left column, C1 and R1"
            onChange={(on) => patchStyle({ showLabels: on })}
          />
        </FullRow>
      </Section>

      <Section id="grid-spacing" title="Spacing">
        {padLinked ? (
          <PairRow linked>
            <NumberField
              label="Padding"
              glyph={<Grid2x2 size={12} />}
              value={pad.top}
              min={0}
              max={400}
              unit="px"
              onChange={onCommit((v) => setPadding({ top: v, right: v, bottom: v, left: v }))}
            />
            <IconToggle label="Set each side" pressed={false} onClick={() => setPadLinkWanted(false)}>
              <Unlink2 size={13} />
            </IconToggle>
            <span />
          </PairRow>
        ) : (
          <>
            <PairRow linked>
              <NumberField
                label="Padding top"
                glyph="T"
                value={pad.top}
                min={0}
                max={400}
                onChange={onCommit((v) => setPadding({ ...pad, top: v }))}
              />
              <IconToggle
                label="Same on every side"
                pressed={false}
                onClick={() => {
                  setPadLinkWanted(true);
                  setPadding({ top: pad.top, right: pad.top, bottom: pad.top, left: pad.top });
                }}
              >
                <Link2 size={13} />
              </IconToggle>
              <NumberField
                label="Padding right"
                glyph="R"
                value={pad.right}
                min={0}
                max={400}
                onChange={onCommit((v) => setPadding({ ...pad, right: v }))}
              />
            </PairRow>
            <PairRow linked>
              <NumberField
                label="Padding bottom"
                glyph="B"
                value={pad.bottom}
                min={0}
                max={400}
                onChange={onCommit((v) => setPadding({ ...pad, bottom: v }))}
              />
              <span />
              <NumberField
                label="Padding left"
                glyph="L"
                value={pad.left}
                min={0}
                max={400}
                onChange={onCommit((v) => setPadding({ ...pad, left: v }))}
              />
            </PairRow>
          </>
        )}
      </Section>

      {regular && (
        <Section id="grid-tracks" title="Tracks" collapsible defaultOpen={false}>
          <TrackList node={node} axis="cols" title="Columns" />
          {kind === 'modular' && <TrackList node={node} axis="rows" title="Rows" />}
        </Section>
      )}

      <Section
        id="grid-cells"
        title="Cells"
        meta={
          <span className="gsec-specimen" aria-hidden="true">
            <CellFace
              shape={style.shapes[0] ?? 'rect'}
              size={18}
              fill={style.palette[Math.floor(style.palette.length / 2)] ?? 'currentColor'}
              radius={style.radius}
              cellSize={sampleCell}
              strokeColor={style.strokeColor}
              strokeWidth={style.strokeWidth}
              opacity={style.opacity}
            />
          </span>
        }
      >
        {mixing ? (
          <div className="gsec-shapes" role="group" aria-label="Shapes in the mix">
            {CELL_SHAPES.map((shape: CellShape) => {
              const on = style.shapes.includes(shape);
              return (
                <IconToggle
                  key={shape}
                  label={on ? `Take ${SHAPE_LABELS[shape].toLowerCase()} out of the mix` : `Add ${SHAPE_LABELS[shape].toLowerCase()} to the mix`}
                  pressed={on}
                  onClick={() => {
                    const next = on ? style.shapes.filter((s) => s !== shape) : [...style.shapes, shape];
                    patchStyle({ shapes: next.length > 0 ? next : [shape] });
                  }}
                >
                  <CellFace shape={shape} size={18} fill="currentColor" radius={style.radius} cellSize={sampleCell} />
                </IconToggle>
              );
            })}
          </div>
        ) : (
          <SpecimenPicker
            label="Cell shape"
            value={style.shapes[0] ?? 'rect'}
            options={CELL_SHAPES.map((shape) => ({
              value: shape,
              label: SHAPE_LABELS[shape],
              render: () => <CellFace shape={shape} size={18} fill="currentColor" radius={style.radius} cellSize={sampleCell} />,
            }))}
            onChange={(shape) => patchStyle({ shapes: [shape] })}
          />
        )}
        <FullRow>
          <Switch
            block
            checked={mixing}
            label="Mix shapes"
            tooltip="Draw each module from the shapes you pick"
            onChange={(on) => {
              setMixWanted(on);
              if (!on && style.shapes.length > 1) patchStyle({ shapes: [style.shapes[0]] });
            }}
          />
        </FullRow>
        <PairRow>
          <NumberField
            label="Corner radius"
            glyph="◜"
            value={style.radius}
            min={0}
            max={400}
            unit="px"
            onChange={onCommit((radius) => patchStyle({ radius }))}
          />
          <NumberField
            label="Stroke width"
            glyph="▭"
            value={style.strokeWidth}
            min={0}
            max={40}
            unit="px"
            onChange={onCommit((strokeWidth) => patchStyle({ strokeWidth }))}
          />
        </PairRow>
        {style.strokeWidth > 0 && (
          <Row label="Stroke">
            <ColorChip label="Stroke colour" value={style.strokeColor} onChange={(strokeColor) => patchStyle({ strokeColor })} />
          </Row>
        )}
        <Row label="Opacity">
          <NumberField
            label="Opacity"
            value={Math.round(style.opacity * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={onCommit((v) => patchStyle({ opacity: v / 100 }))}
          />
        </Row>
        <Row label="Item placement" hint="Where things in a cell sit, text included (typed or dropped in)">
          <div className="gsec-align">
            <AlignMatrix value={align} onChange={setAlign} />
            <div className="gsec-align__fill">
              <IconToggle
                label={align.x === 'stretch' ? 'Items fill the width' : 'Fill the width'}
                pressed={align.x === 'stretch'}
                onClick={() => setAlign({ ...align, x: align.x === 'stretch' ? 'center' : 'stretch' })}
              >
                <ArrowLeftRight size={13} />
              </IconToggle>
              <IconToggle
                label={align.y === 'stretch' ? 'Items fill the height' : 'Fill the height'}
                pressed={align.y === 'stretch'}
                onClick={() => setAlign({ ...align, y: align.y === 'stretch' ? 'center' : 'stretch' })}
              >
                <ArrowUpDown size={13} />
              </IconToggle>
            </div>
            <PlacementPreview value={align} />
          </div>
        </Row>
      </Section>

      <Section
        id="grid-colour"
        title="Colour"
        meta={GRID_PALETTES.find((p) => p.colors.join() === style.palette.join())?.name ?? 'Custom'}
      >
        <div className="gsec-palettes" role="radiogroup" aria-label="Palette">
          {GRID_PALETTES.map((palette) => {
            const on = palette.colors.join() === style.palette.join();
            return (
              <button
                key={palette.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={palette.name}
                className="gsec-palette"
                data-tooltip={palette.name}
                onClick={() => patchStyle({ palette: palette.colors })}
              >
                {palette.colors.map((c) => (
                  <span key={c} className="gsec-palette__chip" style={{ background: c }} />
                ))}
              </button>
            );
          })}
        </div>
        <Row label="Colours">
          <div className="gsec-swatches">
            {style.palette.map((color, i) => (
              <ColorPickerPopover
                key={i}
                color={color}
                allowNone={false}
                onChange={(next) => {
                  const palette = [...style.palette];
                  palette[i] = next;
                  patchStyle({ palette });
                }}
              />
            ))}
          </div>
        </Row>
        <SpecimenPicker
          label="How colours are used"
          value={style.colorMode}
          size={48}
          options={COLOR_MODES.map((mode: ColorMode) => ({
            value: mode,
            label: COLOR_MODE_LABELS[mode],
            render: () => <GridThumb recipe={withStyle(recipe, { colorMode: mode })} />,
          }))}
          onChange={(mode) => patchStyle({ colorMode: mode })}
        />
        <Note>{COLOR_MODE_LABELS[style.colorMode]}</Note>
      </Section>

      {content.filled + content.parked > 0 && (
        <Section id="grid-content" title="Content" meta={`${content.filled} of ${content.modules} filled`}>
          {content.parked > 0 ? (
            <Note>
              <button
                type="button"
                className="gsec-link"
                data-tooltip="Select the content that has no module in this arrangement"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: content.parkedIds } }))
                }
              >
                {content.parked} waiting
              </button>{' '}
              below the grid. They return when there is a module for them.
            </Note>
          ) : (
            <Note>Every item has a module. Drag one out to release it, or hold Ctrl while dropping to keep it free.</Note>
          )}
        </Section>
      )}

      <Section id="grid-variations" title="Variations" collapsible>
        <GridVariations recipe={recipe} onPick={apply} />
      </Section>
    </div>
  );
};

const AXES: readonly CellAlignAxis[] = ['start', 'center', 'end'];
const AXIS_WORD: Record<CellAlignAxis, [string, string]> = {
  start: ['left', 'top'],
  center: ['centre', 'middle'],
  end: ['right', 'bottom'],
  stretch: ['full width', 'full height'],
};

/**
 * Where content sits in its module, as a 3×3 matrix like Figma's.
 *
 * A stretched axis shows as a bar across that axis rather than a dot, and
 * clicking a position on a stretched axis keeps it stretched; the Fill
 * toggles beside the matrix are what turn stretching on and off.
 */
const AlignMatrix: React.FC<{ value: CellAlign; onChange: (next: CellAlign) => void }> = ({ value, onChange }) => {
  const pick = (x: CellAlignAxis, y: CellAlignAxis) =>
    onChange({ x: value.x === 'stretch' ? 'stretch' : x, y: value.y === 'stretch' ? 'stretch' : y });
  const onKey = (e: React.KeyboardEvent) => {
    const ix = AXES.indexOf(value.x === 'stretch' ? 'center' : value.x);
    const iy = AXES.indexOf(value.y === 'stretch' ? 'center' : value.y);
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = move[e.key];
    if (!d) return;
    e.preventDefault();
    const nx = AXES[Math.min(2, Math.max(0, ix + d[0]))];
    const ny = AXES[Math.min(2, Math.max(0, iy + d[1]))];
    pick(nx, ny);
  };
  return (
    <div
      className="gsec-matrix"
      role="radiogroup"
      aria-label="Item placement"
      data-stretch-x={value.x === 'stretch' || undefined}
      data-stretch-y={value.y === 'stretch' || undefined}
      onKeyDown={onKey}
    >
      {AXES.flatMap((y) =>
        AXES.map((x) => {
          const fx = value.x === 'stretch' ? 'center' : value.x;
          const fy = value.y === 'stretch' ? 'center' : value.y;
          const checked = fx === x && fy === y;
          // Bars: a horizontal one along the chosen row when width fills, a
          // vertical one down the chosen column when height fills.
          const inH = value.x === 'stretch' && y === fy;
          const inV = value.y === 'stretch' && x === fx;
          const isFocus =
            x === (value.x === 'stretch' ? 'center' : value.x) && y === (value.y === 'stretch' ? 'center' : value.y);
          const name = `${AXIS_WORD[value.y === 'stretch' ? 'stretch' : y][1]} ${AXIS_WORD[value.x === 'stretch' ? 'stretch' : x][0]}`;
          return (
            <button
              key={`${x}-${y}`}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`Align ${name}`}
              tabIndex={isFocus ? 0 : -1}
              className="gsec-matrix__cell"
              data-h={inH || undefined}
              data-v={inV || undefined}
              onClick={() => pick(x, y)}
            >
              <span className="gsec-matrix__mark" />
              {inH && <span className="gsec-matrix__bar gsec-matrix__bar--h" aria-hidden="true" />}
              {inV && <span className="gsec-matrix__bar gsec-matrix__bar--v" aria-hidden="true" />}
            </button>
          );
        })
      )}
    </div>
  );
};

/** A cell with one small item in it, drawn where the chosen placement puts it. */
const PlacementPreview: React.FC<{ value: CellAlign }> = ({ value }) => {
  const at = (v: CellAlignAxis) => (v === 'start' ? 'flex-start' : v === 'end' ? 'flex-end' : 'center');
  return (
    <span
      className="gsec-place"
      aria-hidden="true"
      data-testid="placement-preview"
      style={{ justifyContent: at(value.x), alignItems: at(value.y) }}
    >
      <span
        className="gsec-place__item"
        style={{ width: value.x === 'stretch' ? '100%' : undefined, height: value.y === 'stretch' ? '100%' : undefined }}
      />
    </span>
  );
};

type TrackKind = 'fr' | 'px' | 'auto';

const trackKind = (t: GridTrack | undefined): TrackKind => (t === 'auto' ? 'auto' : t && 'px' in t ? 'px' : 'fr');

/**
 * One axis's tracks, each with its sizing and size.
 *
 * Shares are shown as their weight and fixed tracks in pixels. Auto tracks
 * take their size from the content measured in them; with nothing measured
 * they behave as one share.
 */
const TrackList: React.FC<{
  node: Extract<ReturnType<typeof useStore.getState>['objects'][string], { type: 'grid' }>;
  axis: 'cols' | 'rows';
  title: string;
}> = ({ node, axis, title }) => {
  const spec = node.grid.spec;
  const n = axis === 'cols' ? Math.max(1, Math.floor(spec.columns)) : Math.max(1, Math.floor(spec.rows));
  const tracks = spec.tracks?.[axis];
  const sizes = React.useMemo(() => currentTrackSizes(node, axis), [node, axis]);
  // A long axis lists its first 24 tracks; the rest are edited on the board.
  const shown = Math.min(n, 24);
  const letter = axis === 'cols' ? 'C' : 'R';
  return (
    <div className="gsec-tracks" role="group" aria-label={title}>
      <div className="gsec-tracks__head">
        <span>{title}</span>
        {tracks && (
          <button type="button" className="gsec-link" onClick={() => resetTracks(node.id, axis)}>
            Make even
          </button>
        )}
      </div>
      {Array.from({ length: shown }, (_, i) => {
        const t = tracks?.[i];
        const k = trackKind(t);
        const value = k === 'px' ? (t as { px: number }).px : k === 'fr' && t ? (t as { fr: number }).fr : Math.round(sizes[i]);
        return (
          <div className="gsec-track" key={i}>
            <span className="gsec-track__name">{`${letter}${i + 1}`}</span>
            <Select<TrackKind>
              label={`${letter}${i + 1} sizing`}
              value={tracks ? k : 'fr'}
              options={[
                { value: 'fr', label: 'Share', detail: 'A share of the space left over' },
                { value: 'px', label: 'Fixed', detail: 'A size in pixels' },
                { value: 'auto', label: 'Auto', detail: 'As big as its content' },
              ]}
              onChange={(next) =>
                setTrack(
                  node.id,
                  axis,
                  i,
                  next === 'auto' ? 'auto' : next === 'px' ? { px: Math.round(sizes[i]) } : { fr: 1 }
                )
              }
            />
            <NumberField
              label={`${letter}${i + 1} ${k === 'px' ? 'size' : 'share'}`}
              value={tracks && k === 'auto' ? Math.round(sizes[i]) : tracks ? value : 1}
              min={k === 'px' ? 1 : 0.1}
              max={k === 'px' ? 100000 : 1000}
              step={k === 'px' ? 1 : 0.5}
              precision={k === 'px' ? 0 : 1}
              unit={k === 'px' ? 'px' : 'fr'}
              disabledReason={tracks && k === 'auto' ? 'Sized by its content' : undefined}
              onChange={(v, change) => {
                if (!change.commit) return;
                setTrack(node.id, axis, i, k === 'px' && tracks ? { px: v } : { fr: v });
              }}
            />
          </div>
        );
      })}
      {n > shown && <Note>{`${n - shown} more ${title.toLowerCase()}: edit them on the board.`}</Note>}
    </div>
  );
};
