import React from 'react';
import { Clock, ImagePlus, Minus, Plus, Shuffle, Space } from 'lucide-react';
import { setGridRecipe } from '../../../engine/grid/gridApply';
import { switchKind, type GridRecipe } from '../../../engine/grid/gridBuild';
import { GRID_HINTS, GRID_KINDS, GRID_LABELS } from '../../../engine/grid/gridLayout';
import { gridContent } from '../../../engine/grid/gridSlotApply';
import { GRID_PALETTES } from '../../../engine/grid/gridStyle';
import type { GridNode } from '../../../engine/model/schema';
import { useStore } from '../../../hooks/useStore';
import { GridKindIcon } from '../../workspace/gridIcons';
import { PopoverSlider, RailButton } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { RailAnatomy, type RailVerb } from './anatomy';
import { ScrubValue } from './controls';
import type { SingleRail } from './types';
import { fillGridFromFiles, trackLabel } from './gridActions';

const MIN_TRACKS = 1;
const MAX_TRACKS = 24;
const MAX_GAP = 200;


/**
 * A grid: its palette as paint, then its tracks, its gap, its system, another
 * draw of the same system, and pictures to put in it.
 */
export const GridRail: SingleRail<GridNode> = ({ node, conditional, tail, tailControls }) => {
  const recipe = node.grid;
  const parked = useStore((s) => gridContent(s.objects, node.id).parked);
  const apply = (next: GridRecipe) => setGridRecipe(node.id, next);
  const patchSpec = (patch: Partial<GridRecipe['spec']>) => apply({ ...recipe, spec: { ...recipe.spec, ...patch } });
  const tracks = trackLabel(recipe);
  const gap = recipe.spec.gutterX;
  const setGap = (g: number) => patchSpec({ gutterX: g, gutterY: g });
  const paletteKey = recipe.style.palette.join();

  const verbs: RailVerb[] = [];
  if (tracks) {
    const n = recipe.spec.columns;
    verbs.push({
      id: 'tracks',
      controls: 2,
      node: (
        <span className="rail-stepper" role="group" aria-label={tracks}>
          <RailButton
            label={`Fewer ${tracks.toLowerCase()}`}
            disabled={n <= MIN_TRACKS}
            onClick={() => patchSpec({ columns: Math.max(MIN_TRACKS, n - 1) })}
          >
            <Minus size={14} />
          </RailButton>
          <span className="ctx-value rail-stepper__value" data-tooltip={tracks}>
            {n}
          </span>
          <RailButton
            label={`More ${tracks.toLowerCase()}`}
            disabled={n >= MAX_TRACKS}
            onClick={() => patchSpec({ columns: Math.min(MAX_TRACKS, n + 1) })}
          >
            <Plus size={14} />
          </RailButton>
        </span>
      ),
    });
  }
  verbs.push(
    {
      id: 'gap',
      controls: 1,
      node: (
        <RailPopover
          label="Gap"
          trigger={
            <ScrubValue value={gap} min={0} max={MAX_GAP} onChange={setGap}>
              <Space size={16} />
            </ScrubValue>
          }
        >
          <PopoverSlider label="Gap" value={gap} min={0} max={MAX_GAP} suffix="px" onChange={setGap} />
        </RailPopover>
      ),
    },
    {
      id: 'system',
      controls: 1,
      node: (
        <RailPopover label={`Arrangement: ${GRID_LABELS[recipe.spec.kind]}`} trigger={<GridKindIcon kind={recipe.spec.kind} size={16} />} align="start">
          <span className="ctx-popover__label">Arrangement</span>
          <div className="ctx-shape-grid">
            {GRID_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="ctx-shape-btn"
                aria-pressed={recipe.spec.kind === kind}
                data-tooltip={`${GRID_LABELS[kind]}: ${GRID_HINTS[kind]}`}
                aria-label={GRID_LABELS[kind]}
                onClick={() => apply(switchKind(recipe, kind))}
              >
                <GridKindIcon kind={kind} size={16} />
              </button>
            ))}
          </div>
        </RailPopover>
      ),
    },
    {
      id: 'shuffle',
      controls: 1,
      node: (
        <RailButton
          label="Reshuffle"
          hint="Another draw of the same system (undoable)"
          onClick={() => patchSpec({ seed: Math.floor(Math.random() * 100000) })}
        >
          <Shuffle size={16} />
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
    }
  );

  return (
    <RailAnatomy
      kind={
        <span className="ctx-kind">
          <GridKindIcon kind={recipe.spec.kind} size={15} />
          {GRID_LABELS[recipe.spec.kind]}
          {parked > 0 && (
            <span
              className="rail-badge"
              data-tooltip={`${parked} ${parked === 1 ? 'item has' : 'items have'} no module in this arrangement. They wait below the grid and return when there is room.`}
            >
              <Clock size={11} aria-hidden />
              {parked}
            </span>
          )}
        </span>
      }
      paint={
        <RailPopover
          label="Palette"
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
            <>
              <span className="ctx-popover__label">Palette</span>
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
            </>
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
