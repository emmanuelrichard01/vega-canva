import React, { useEffect, useMemo } from 'react';
import {
  ChevronDown,
  Crop,
  Group,
  ImageOff,
  ImagePlus,
  Lock,
  Grid2x2Check,
  Palette,
  Ungroup,
  Unlock,
  Users,
} from 'lucide-react';
import { applyNodePatches, updateNodes } from '../../../engine/document';
import { editor } from '../../../engine/api/EditorAPI';
import { applyOrganiseStickies } from '../../../engine/tools/organiseStickies';
import { sharedValue } from '../../../engine/model/selection';
import { compareStacking } from '../../../engine/model/stacking';
import type { AnyNode, Appearance, ConnectorNode, ImageNode } from '../../../engine/model/schema';
import { resolveAffordances, type AffordanceId } from '../../../engine/selection/affordances';
import { clampZoom, SLOT_MAX_ZOOM, SLOT_MIN_ZOOM } from '../../../engine/grid/gridSlot';
import { fillGridWithImages, recentreSlot, releaseSlots, setSlotZoom } from '../../../engine/grid/gridSlotApply';
import { setMultiplePathsAnchorMode } from '../../../engine/interaction/pathAnchorActions';
import { END_CAP_KINDS, type EndCapKind } from '../../../engine/model/connectorEnds';
import { arrangeUnits } from '../../../engine/arrange/units';
import { combineAvailability, describeTidyShape, isPlan, planTidy, tidyShape } from '../../../engine/arrange/plans';
import { arrangeSession } from '../../../engine/arrange/session';
import { arrangeGhost } from '../../../engine/arrange/preview';
import { commitPatches } from '../../../engine/arrange/livePreview';
import { useStore } from '../../../hooks/useStore';
import { FillEditor } from '../../ui/FillEditor';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { EndCapIcon, RouteIcon } from '../../panel/connectorIcons';
import { withShortcut, SHORTCUTS } from '../../menu/shortcuts';
import { PopoverSlider, RailButton } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { AlignControl } from '../AlignmentToolbar';
import { CombineControl } from '../VectorBooleanSection';
import { GridControl } from '../../arrange/GridControl';
import { SelectionControl } from '../../arrange/SelectionControl';
import { ghostOf } from '../../arrange/ghost';
import { RailAnatomy, type RailVerb } from './anatomy';
import { BulkSketchControl, CornerIcon, SymmetricIcon } from './controls';
import { EndsGlyph } from './ConnectorRail';
import { ROUTE_SEGMENTS } from './routeSegments';

/** Stickies sorted into clusters by colour or by who wrote them. */
const OrganiseControl: React.FC<{ nodes: readonly AnyNode[] }> = ({ nodes }) => (
  <RailPopover
    label="Organise notes"
    align="start"
    trigger={
      <span className="rail-kind">
        <span className="rail-kind__name">Organise</span>
        <ChevronDown size={12} aria-hidden className="rail-kind__chevron" />
      </span>
    }
  >
    {(close) => (
      <>
        <span className="ctx-popover__label">Organise {nodes.length} notes</span>
        <div className="rail-list">
          <button
            type="button"
            className="rail-list__item"
            onClick={() => {
              applyOrganiseStickies(nodes, 'theme');
              close();
            }}
          >
            <Palette size={15} />
            <span className="rail-list__label">By colour</span>
          </button>
          <button
            type="button"
            className="rail-list__item"
            onClick={() => {
              applyOrganiseStickies(nodes, 'author');
              close();
            }}
          >
            <Users size={15} />
            <span className="rail-list__label">By author</span>
          </button>
        </div>
      </>
    )}
  </RailPopover>
);

/** Corner, smooth or symmetric, across every point of every selected path. */
const PointsControl: React.FC<{ ids: readonly string[] }> = ({ ids }) => (
  <RailPopover label="Points" trigger={<CornerIcon rounded />} align="start">
    <span className="ctx-popover__label">Every point</span>
    <div className="rail-list">
      <button type="button" className="rail-list__item" onClick={() => setMultiplePathsAnchorMode(ids as string[], 'corner')}>
        <CornerIcon rounded={false} />
        <span className="rail-list__label">Sharp corners</span>
      </button>
      <button type="button" className="rail-list__item" onClick={() => setMultiplePathsAnchorMode(ids as string[], 'smooth')}>
        <CornerIcon rounded />
        <span className="rail-list__label">Smooth curves</span>
      </button>
      <button type="button" className="rail-list__item" onClick={() => setMultiplePathsAnchorMode(ids as string[], 'mirrored')}>
        <SymmetricIcon />
        <span className="rail-list__label">Symmetric handles</span>
      </button>
    </div>
  </RailPopover>
);

export interface MultiRailProps {
  nodes: AnyNode[];
  ids: string[];
  conditional: React.ReactNode;
  tail: React.ReactNode;
  tailControls: number;
}

/**
 * The rail for several objects.
 *
 * The count chip leads and opens what the selection is and shares (see
 * `arrange/SelectionControl`). Then what the selection *is*, when it has a
 * uniform subject (connectors, pictures in a grid); then arrangement, which is
 * why a multi-selection usually exists; then structure. Arrangement acts on
 * units, so a whole group moves as one object (`arrange/units`). Which of
 * these apply comes from `resolveAffordances`, the same resolver the panel and
 * the menu ask, and a control that cannot apply to all of the selection is not
 * shown rather than acting on part of it.
 */
export const MultiRail: React.FC<MultiRailProps> = ({ nodes, ids, conditional, tail, tailControls }) => {
  const { objects, groups } = useStore.getState();
  // What an arrangement moves: whole groups as one, connectors and locked objects not at all.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const unitSet = useMemo(() => arrangeUnits(nodes, objects, groups), [nodes]);
  const selectionKey = ids.join(',');
  // A live grid belongs to the selection it was made for: leaving it settles the grid.
  useEffect(
    () => () => {
      if (arrangeSession.activeFor(selectionKey.split(','))) arrangeSession.commit();
      // A preview drawn for a control that is going away goes with it.
      arrangeGhost.set(null);
    },
    [selectionKey]
  );
  const offers = new Set(resolveAffordances(nodes, { surface: 'toolbar', allObjects: objects }).map((a) => a.id));
  const affords = (id: AffordanceId) => offers.has(id);
  const verbs: RailVerb[] = [];

  if (affords('routing')) {
    const routing = sharedValue(nodes, (n) => (n as ConnectorNode).routing);
    const first = nodes[0] as ConnectorNode;
    verbs.push(
      {
        id: 'route',
        controls: 1,
        node: (
          <RailPopover label="Route" trigger={<RouteIcon routing={first.routing} />} align="start">
            <span className="ctx-popover__label">Route · {nodes.length} connectors</span>
            <SegmentedControl
              ariaLabel="Routing"
              value={routing.value ?? 'orthogonal'}
              onChange={(r) => applyNodePatches(nodes.map((n) => ({ id: n.id, changes: { routing: r } })))}
              segments={ROUTE_SEGMENTS}
            />
          </RailPopover>
        ),
      },
      {
        id: 'ends',
        controls: 1,
        node: (
          <RailPopover label="Ends" trigger={<EndsGlyph start={first.endStart ?? 'none'} end={first.endEnd ?? 'none'} />} align="start" size="sm">
            <span className="ctx-popover__label">Ends · {nodes.length} connectors</span>
            {(['endStart', 'endEnd'] as const).map((which) => (
              <SegmentedControl
                key={which}
                fill
                ariaLabel={which === 'endStart' ? 'Start cap' : 'End cap'}
                value={sharedValue(nodes, (n) => (n as ConnectorNode)[which] ?? 'none').value ?? 'none'}
                // Connectors that disagree show no choice, rather than a "none" they do not all have.
                mixed={sharedValue(nodes, (n) => (n as ConnectorNode)[which] ?? 'none').mixed}
                onChange={(kind) => applyNodePatches(nodes.map((n) => ({ id: n.id, changes: { [which]: kind as EndCapKind } })))}
                segments={END_CAP_KINDS.map((kind) => ({
                  value: kind,
                  label: kind,
                  icon: <EndCapIcon kind={kind} flip={which === 'endStart'} />,
                }))}
              />
            ))}
          </RailPopover>
        ),
      }
    );
  }

  if (affords('grid-slot')) {
    const slotted = nodes.filter((n) => n.type === 'image' && n.gridSlot).map((n) => n.id);
    const zoom = clampZoom((nodes.find((n) => n.type === 'image' && n.gridSlot) as ImageNode | undefined)?.gridSlot?.zoom);
    if (slotted.length > 0) {
      verbs.push({
        id: 'reframe',
        controls: 1,
        node: (
          <RailPopover label="Reframe" trigger={<Crop size={16} />} align="start">
            <span className="ctx-popover__label">
              Reframe · {slotted.length} {slotted.length === 1 ? 'image' : 'images'}
            </span>
            <PopoverSlider
              label="Zoom"
              value={Math.round(zoom * 100)}
              min={SLOT_MIN_ZOOM * 100}
              max={SLOT_MAX_ZOOM * 100}
              step={5}
              suffix="%"
              onChange={(pct) => slotted.forEach((id) => setSlotZoom(id, pct / 100))}
            />
            <span className="ctx-popover__note">Double-click a picture to move and zoom it by hand, or use the arrow keys.</span>
            <button type="button" className="ctx-popover__action" onClick={() => recentreSlot(slotted)}>
              Recentre
            </button>
          </RailPopover>
        ),
      });
    }
    verbs.push({
      id: 'release',
      controls: 1,
      node: (
        <RailButton label="Remove from grid" hint="Take them out of their modules and leave them on the board" onClick={() => releaseSlots(ids)}>
          <ImageOff size={16} />
        </RailButton>
      ),
    });
  }

  if (affords('grid-fill')) {
    verbs.push({
      id: 'place',
      controls: 1,
      node: (
        <RailButton
          label="Place in grid"
          hint="Fit each image into a module, cropped to fill"
          onClick={() => {
            const grid = nodes.find((n) => n.type === 'grid');
            if (!grid) return;
            // Stacking order, so the same selection made two ways lays out the same.
            const images = nodes.filter((n) => n.type === 'image').sort(compareStacking).map((n) => n.id);
            const { overflow } = fillGridWithImages(grid.id, images);
            const landed = images.filter((id) => !overflow.includes(id));
            if (landed.length > 0) window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: landed } }));
          }}
        >
          <ImagePlus size={16} />
        </RailButton>
      ),
    });
  }

  // Notes all round: sort them into clusters, the reason a pile of stickies is selected.
  if (nodes.every((n) => n.type === 'sticky')) {
    verbs.push({ id: 'organise', controls: 1, node: <OrganiseControl nodes={nodes} /> });
  }

  // Pen paths all round: their points are what they are selected for. Only
  // paths that already have points: converting shapes is a decision, so it
  // lives in `⋯` as Convert to path rather than happening as a side effect here.
  if (nodes.every((n) => n.type === 'path' && n.geometry.kind !== 'freehand')) {
    verbs.push({ id: 'points', controls: 1, node: <PointsControl ids={ids} /> });
  }

  /*
   * Priority order, highest first; `fitVerbs` drops from the end when Paste
   * style or a fill takes a seat. Arrangement, then structure (Group, Lock),
   * then Combine when it can run, then the conveniences (Tidy, a live grid,
   * Sketch), so a full rail never loses the verbs a selection exists for.
   */
  verbs.push({ id: 'align', controls: 1, node: <AlignControl unitSet={unitSet} objects={objects} /> });

  verbs.push(
    affords('ungroup')
      ? {
          id: 'group',
          controls: 1,
          node: (
            <RailButton label="Ungroup" hint={withShortcut('Ungroup', SHORTCUTS.ungroup)} onClick={() => editor.ungroupNodes(ids)}>
              <Ungroup size={16} />
            </RailButton>
          ),
        }
      : {
          id: 'group',
          controls: 1,
          node: (
            <RailButton label="Group" hint={withShortcut('Group', SHORTCUTS.group)} onClick={() => editor.groupNodes(ids)}>
              <Group size={16} />
            </RailButton>
          ),
        }
  );

  const locked = sharedValue(nodes, (n) => Boolean(n.locked));
  verbs.push({
    id: 'lock',
    controls: 1,
    node: (
      <RailButton
        label={locked.mixed || !locked.value ? 'Lock all' : 'Unlock all'}
        hint={withShortcut(locked.mixed || !locked.value ? 'Lock all' : 'Unlock all', SHORTCUTS.lock)}
        pressed={!locked.mixed && locked.value}
        // A mixed lock resolves to locked: the safe direction, and one press to undo.
        onClick={() => updateNodes(ids, { locked: locked.mixed ? true : !locked.value })}
      >
        {!locked.mixed && locked.value ? <Lock size={16} /> : <Unlock size={16} />}
      </RailButton>
    ),
  });

  // A selection that can combine leads with it: shapes and paths are selected together to be combined.
  const combine = combineAvailability(nodes);
  const combineVerb: RailVerb = { id: 'combine', controls: 1, node: <CombineControl ids={ids} blocked={combine.reason} /> };
  if (combine.offer && !combine.reason) verbs.push(combineVerb);

  if (unitSet.units.length >= 2) {
    const tidy = planTidy(unitSet.units);
    const tidyLabel = describeTidyShape(tidyShape(unitSet.units));
    const tidied = isPlan(tidy) && tidy.patches.length === 0;
    verbs.push({
      id: 'tidy',
      controls: 1,
      node: (
        <RailButton
          label="Tidy up"
          hint={tidied ? 'Already tidy' : `${tidyLabel}, at the gaps they already use`}
          onHover={(over) => arrangeGhost.set(over ? ghostOf(tidy) : null)}
          onClick={() => {
            arrangeGhost.set(null);
            if (isPlan(tidy)) commitPatches(tidy.patches);
          }}
        >
          <Grid2x2Check size={16} />
        </RailButton>
      ),
    });
    verbs.push({ id: 'arrange-grid', controls: 1, node: <GridControl nodes={nodes} /> });
  }
  // Shown off with its reason when something in the selection has no outline, at the back of the queue.
  if (combine.offer && combine.reason) verbs.push(combineVerb);
  if (affords('sketch')) verbs.push({ id: 'sketch', controls: 1, node: <BulkSketchControl nodes={nodes} /> });

  const fill = affords('fill') ? (
    <FillEditor
      paint={(nodes[0] as { appearance?: Appearance }).appearance?.fill?.[0]}
      mixed={sharedValue(nodes, (n) => (n as { appearance?: Appearance }).appearance?.fill?.[0]).mixed}
      onChange={(paint) =>
        applyNodePatches(
          nodes.map((n) => ({
            id: n.id,
            // Merged per node: one fill must not overwrite everyone's stroke and shadow.
            changes: { appearance: { ...((n as { appearance?: Appearance }).appearance ?? {}), fill: [paint] } },
          }))
        )
      }
    />
  ) : null;

  return (
    <RailAnatomy
      kind={<SelectionControl nodes={nodes} unitSet={unitSet} />}
      kindControls={1}
      paint={fill}
      paintControls={fill ? 1 : 0}
      verbs={verbs}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
