import React from 'react';
import { ChevronDown, Clock, Columns3, Grid3x3, ImagePlus, MoveHorizontal, Shuffle, SlidersHorizontal, Square, StretchVertical } from 'lucide-react';
import type { GridRecipe } from '../../../engine/grid/gridBuild';
import { switchKind } from '../../../engine/grid/gridBuild';
import { GRID_HINTS, GRID_KINDS, GRID_LABELS } from '../../../engine/grid/gridLayout';
import { GRID_PRESETS, gridPresetMatching } from '../../../engine/grid/gridPresets';
import { gridEditMode } from '../../../engine/grid/gridEditMode';
import { requestGridSettings } from '../../../engine/grid/gridSettings';
import { GRID_PALETTES } from '../../../engine/grid/gridStyle';
import { canEditObjects } from '../../../engine/model/permissions';
import type { GridNode } from '../../../engine/model/schema';
import { useStore } from '../../../hooks/useStore';
import { GridArt, GridKindArt } from '../../dock/art/DataArt';
import { NumberField, SegmentedControl } from '../../panel/grammar';
import { GridKindIcon } from '../../workspace/gridIcons';
import { RailButton } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { RailAnatomy, type RailVerb } from './anatomy';
import type { SingleRail } from './types';
import {
  MAX_GUTTER,
  MAX_MARGIN,
  MAX_TRACKS,
  MIN_TRACKS,
  canHug,
  fillGridFromFiles,
  trackLabel,
  withFitContent,
  withLayoutField,
  withPreset,
  writeGridRecipe,
  type LayoutField,
} from './gridActions';
import { parkedCount } from './gridSlotIndex';

type Family = 'systems' | 'named';

/** Systems and named grids as art tiles; one family at a time keeps the popover short. */
const ArrangementPanel: React.FC<{
  recipe: GridRecipe;
  parked: number;
  apply: (next: GridRecipe) => void;
}> = ({ recipe, parked, apply }) => {
  const matched = gridPresetMatching(recipe.spec);
  const [family, setFamily] = React.useState<Family>(matched ? 'named' : 'systems');
  return (
    <div className="grid-pop">
      <SegmentedControl
        fill
        ariaLabel="Arrangement family"
        value={family}
        onChange={(v) => setFamily(v as Family)}
        segments={[
          { value: 'systems', label: 'Systems' },
          { value: 'named', label: 'Named grids' },
        ]}
      />
      <div className="grid-tiles" role="group" aria-label={family === 'systems' ? 'Grid systems' : 'Named grids'}>
        {family === 'systems'
          ? GRID_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="grid-tile"
                aria-pressed={recipe.spec.kind === kind && !matched}
                aria-label={GRID_LABELS[kind]}
                data-tooltip={GRID_HINTS[kind]}
                onClick={() => apply(switchKind(recipe, kind))}
              >
                <GridKindArt kind={kind} size={52} />
                <span className="grid-tile__name">{GRID_LABELS[kind]}</span>
              </button>
            ))
          : GRID_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="grid-tile"
                aria-pressed={matched?.id === preset.id}
                aria-label={preset.label}
                data-tooltip={preset.hint}
                onClick={() => apply(withPreset(recipe, preset))}
              >
                <GridArt preset={preset.id} size={52} />
                <span className="grid-tile__name">{preset.label}</span>
              </button>
            ))}
      </div>
      {parked > 0 && (
        <p className="ctx-popover__note">
          {parked} {parked === 1 ? 'item has' : 'items have'} no module in this arrangement. They wait below the grid and
          return when there is room.
        </p>
      )}
    </div>
  );
};

/** Columns, gutter and margin: the three numbers that define a layout grid. Deeper settings live in Properties. */
const LayoutPanel: React.FC<{
  recipe: GridRecipe;
  tracks: string | null;
  write: (field: LayoutField, value: number, commit: boolean) => void;
}> = ({ recipe, tracks, write }) => {
  const { spec } = recipe;
  return (
    <div className="grid-pop grid-pop--fields">
      <div className="grid-field">
        <span className="grid-field__name">{tracks ?? 'Columns'}</span>
        <NumberField
          label={tracks ?? 'Columns'}
          glyph={<Columns3 size={13} />}
          value={spec.columns}
          min={MIN_TRACKS}
          max={MAX_TRACKS}
          step={1}
          precision={0}
          disabledReason={tracks ? undefined : `${GRID_LABELS[spec.kind]} sets its own columns`}
          onChange={(v, c) => write('tracks', v, c.commit)}
        />
      </div>
      <div className="grid-field">
        <span className="grid-field__name">Gutter</span>
        <NumberField
          label="Gutter"
          glyph={<MoveHorizontal size={13} />}
          value={spec.gutterX}
          min={0}
          max={MAX_GUTTER}
          step={1}
          precision={0}
          unit="px"
          onChange={(v, c) => write('gutter', v, c.commit)}
        />
      </div>
      <div className="grid-field">
        <span className="grid-field__name">Margin</span>
        <NumberField
          label="Margin"
          glyph={<Square size={13} />}
          value={spec.margin}
          min={0}
          max={MAX_MARGIN}
          step={1}
          precision={0}
          unit="px"
          onChange={(v, c) => write('margin', v, c.commit)}
        />
      </div>
      <p className="ctx-popover__note">Tracks, spans, alignment and colour are in Properties.</p>
    </div>
  );
};

/**
 * A grid leads with its arrangement, the picker that says what it is; then its
 * palette as paint, its three layout numbers, fitting its rows to content, its
 * cells, pictures to put in it, and another draw of the same system. Anything
 * deeper is in Properties.
 */
export const GridRail: SingleRail<GridNode> = ({ node, conditional, tail, tailControls }) => {
  const recipe = node.grid;
  // A number, so the rail re-renders only when the count changes.
  const parked = useStore((s) => parkedCount(s.objects, node.id));
  const editable = canEditObjects();
  const apply = (next: GridRecipe) => writeGridRecipe(node.id, next, true);
  const tracks = trackLabel(recipe);
  const paletteKey = recipe.style.palette.join();
  const hugging = recipe.spec.sizing === 'hug';
  const name = GRID_LABELS[recipe.spec.kind];

  const kindLabel =
    parked > 0
      ? `Arrangement: ${name}. ${parked} ${parked === 1 ? 'item has' : 'items have'} no module in this arrangement`
      : `Arrangement: ${name}`;
  const kindFace = (
    <span className="rail-kind">
      <GridKindIcon kind={recipe.spec.kind} size={16} />
      <span className="rail-kind__name">{name}</span>
      {parked > 0 && (
        <span className="rail-badge" aria-hidden="true">
          <Clock size={11} aria-hidden />
          {parked}
        </span>
      )}
      {editable && <ChevronDown size={12} aria-hidden className="rail-kind__chevron" />}
    </span>
  );

  // Viewers and commenters see what the grid is, and nothing to change.
  if (!editable) {
    return (
      <RailAnatomy
        kind={
          <span className="ctx-btn" role="img" aria-label={kindLabel}>
            {kindFace}
          </span>
        }
        kindControls={0}
        verbs={[]}
        conditional={conditional}
        tail={tail}
        tailControls={tailControls}
      />
    );
  }

  const writeLayout = (field: LayoutField, value: number, commit: boolean) =>
    writeGridRecipe(node.id, withLayoutField(recipe, field, value), commit);
  const fit = withFitContent(recipe, !hugging);

  const verbs: RailVerb[] = [
    {
      id: 'layout',
      controls: 1,
      node: (
        <RailPopover
          label="Layout: columns, gutter and margin"
          size="sm"
          live
          trigger={
            <span className="rail-kind">
              <Columns3 size={16} aria-hidden />
              <span className="ctx-value">{recipe.spec.columns}</span>
            </span>
          }
        >
          <LayoutPanel recipe={recipe} tracks={tracks} write={writeLayout} />
        </RailPopover>
      ),
    },
    {
      id: 'fit',
      controls: 1,
      node: (
        <RailButton
          label={hugging ? 'Rows fit content' : 'Fit rows to content'}
          hint={fit ? 'Rows grow to hold what is in them (undoable)' : `${name} has no rows to fit`}
          pressed={hugging}
          disabled={!canHug(recipe)}
          onClick={() => fit && apply(fit)}
        >
          <StretchVertical size={16} />
        </RailButton>
      ),
    },
    {
      id: 'cells',
      controls: 1,
      node: (
        <RailButton label="Edit cells" hint="Pick, merge and split modules (Enter)" onClick={() => gridEditMode.enter(node.id)}>
          <Grid3x3 size={16} />
        </RailButton>
      ),
    },
    {
      id: 'settings',
      controls: 1,
      node: (
        <RailButton label="Grid settings" hint="Open every grid setting in the properties panel" onClick={() => requestGridSettings(node.id)}>
          <SlidersHorizontal size={16} />
        </RailButton>
      ),
    },
    {
      id: 'images',
      controls: 1,
      node: (
        <RailButton label="Fill with images" hint="Choose pictures to fill the free modules" onClick={() => fillGridFromFiles(node)}>
          <ImagePlus size={16} />
        </RailButton>
      ),
    },
    {
      id: 'shuffle',
      controls: 1,
      node: (
        <RailButton
          label="Reshuffle"
          hint="Another draw of the same system (undoable)"
          onClick={() => apply({ ...recipe, spec: { ...recipe.spec, seed: Math.floor(Math.random() * 100000) } })}
        >
          <Shuffle size={16} />
        </RailButton>
      ),
    },
  ];

  return (
    <RailAnatomy
      kind={
        <RailPopover label={kindLabel} size="md" align="start" trigger={kindFace}>
          <ArrangementPanel recipe={recipe} parked={parked} apply={apply} />
        </RailPopover>
      }
      kindControls={1}
      paint={
        <RailPopover
          label="Palette"
          size="sm"
          trigger={
            <span className="rail-ribbon" aria-hidden="true">
              {recipe.style.palette.slice(0, 5).map((c, i) => (
                <i key={i} style={{ background: c }} />
              ))}
            </span>
          }
          align="start"
        >
          {(close) => (
            <div className="ctx-palettes" role="radiogroup" aria-label="Grid palette">
              {GRID_PALETTES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={p.colors.join() === paletteKey}
                  className="ctx-palette"
                  onClick={() => {
                    apply({ ...recipe, style: { ...recipe.style, palette: p.colors } });
                    close();
                  }}
                >
                  <span className="ctx-palette__ribbon">
                    {p.colors.map((c, i) => (
                      <i key={i} style={{ background: c }} />
                    ))}
                  </span>
                  <span className="ctx-palette__name">{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </RailPopover>
      }
      paintControls={1}
      verbs={verbs}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
