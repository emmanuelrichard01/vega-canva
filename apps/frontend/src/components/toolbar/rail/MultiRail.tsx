import React from 'react';
import {
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  Combine,
  Crop,
  Group,
  ImageOff,
  ImagePlus,
  LayoutGrid,
  Layers,
  Lock,
  Grid2x2Check,
  Ungroup,
  Unlock,
} from 'lucide-react';
import { applyNodePatches, updateNodes } from '../../../engine/document';
import { applyBoolean, booleanPlans as plansFor } from '../../../engine/document/vectorOps';
import { editor } from '../../../engine/api/EditorAPI';
import { booleanPreview } from '../../../engine/interaction/booleanPreview';
import { alignSelection, distributeSelection } from '../../../engine/model/align';
import { BOOLEAN_OPS } from '../../../engine/model/pathBoolean';
import { sharedValue } from '../../../engine/model/selection';
import { compareStacking } from '../../../engine/model/stacking';
import type { AnyNode, Appearance, ConnectorNode, ImageNode } from '../../../engine/model/schema';
import { resolveAffordances, type AffordanceId } from '../../../engine/selection/affordances';
import { clampZoom, SLOT_MAX_ZOOM, SLOT_MIN_ZOOM } from '../../../engine/grid/gridSlot';
import { fillGridWithImages, recentreSlot, releaseSlots, setSlotZoom } from '../../../engine/grid/gridSlotApply';
import { setMultiplePathsAnchorMode } from '../../../engine/interaction/pathAnchorActions';
import { END_CAP_KINDS, type EndCapKind } from '../../../engine/model/connectorEnds';
import { useStore } from '../../../hooks/useStore';
import { FillEditor } from '../../ui/FillEditor';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { EndCapIcon, RouteIcon } from '../../panel/connectorIcons';
import { withShortcut, SHORTCUTS } from '../../menu/shortcuts';
import { PopoverSlider, RailButton } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { ALIGN_BUTTONS, BOOLEAN_BUTTONS } from '../railConstants';
import { RailAnatomy, type RailVerb } from './anatomy';
import { BulkSketchControl, CornerIcon, SymmetricIcon } from './controls';
import { EndsGlyph } from './ConnectorRail';
import { ROUTE_SEGMENTS } from './routeSegments';
import { tidySelection, tidyable } from './tidy';
import { describeMix } from './describeMix';
import { arrangeSelectionInGrid } from '../../../engine/grid/arrangeInGrid';



/** Lines things up, or evens the gaps between them, from one popover. */
const ArrangeControl: React.FC<{ nodes: readonly AnyNode[]; canDistribute: boolean }> = ({ nodes, canDistribute }) => (
  <RailPopover label="Align and distribute" trigger={ALIGN_BUTTONS[0].icon} align="start">
    <span className="ctx-popover__label">Align</span>
    <div className="rail-align-grid">
      {ALIGN_BUTTONS.map(({ edge, label, icon }) => (
        <button
          key={edge}
          type="button"
          className="ctx-shape-btn"
          aria-label={label}
          data-tooltip={label}
          onClick={() => applyNodePatches(alignSelection(nodes, edge))}
        >
          {icon}
        </button>
      ))}
    </div>
    <span className="ctx-popover__label">Distribute</span>
    <div className="rail-toggle-row">
      <button
        type="button"
        className="ctx-shape-btn"
        disabled={!canDistribute}
        aria-label="Distribute horizontally"
        data-tooltip={canDistribute ? 'Even horizontal gaps' : 'Needs three or more objects'}
        onClick={() => applyNodePatches(distributeSelection(nodes, 'horizontal'))}
      >
        <AlignHorizontalSpaceAround size={16} />
      </button>
      <button
        type="button"
        className="ctx-shape-btn"
        disabled={!canDistribute}
        aria-label="Distribute vertically"
        data-tooltip={canDistribute ? 'Even vertical gaps' : 'Needs three or more objects'}
        onClick={() => applyNodePatches(distributeSelection(nodes, 'vertical'))}
      >
        <AlignVerticalSpaceAround size={16} />
      </button>
    </div>
  </RailPopover>
);

/**
 * The four combines, each one previewed on the board while it is pointed at,
 * and each one that cannot apply saying why.
 */
const CombineControl: React.FC<{ ids: readonly string[] }> = ({ ids }) => {
  const plans = plansFor(ids as string[]);
  return (
    <RailPopover label="Combine shapes" trigger={<Combine size={16} />} align="start">
      {(close) => (
        <>
          <span className="ctx-popover__label">Combine</span>
          <div className="rail-list" onPointerLeave={() => booleanPreview.set(null)}>
            {BOOLEAN_OPS.map((op) => {
              const plan = plans[op];
              const refusal = 'refusal' in plan ? plan.refusal : null;
              const preview = 'geometry' in plan ? plan.geometry : null;
              return (
                <button
                  key={op}
                  type="button"
                  className="rail-list__item"
                  disabled={Boolean(refusal)}
                  data-tooltip={refusal ?? undefined}
                  onPointerEnter={() => booleanPreview.set(preview)}
                  onFocus={() => booleanPreview.set(preview)}
                  onBlur={() => booleanPreview.set(null)}
                  onClick={() => {
                    booleanPreview.set(null);
                    const id = applyBoolean(op, ids as string[]);
                    if (id) editor.select(id);
                    close();
                  }}
                >
                  {BOOLEAN_BUTTONS[op].icon}
                  <span className="rail-list__label">{BOOLEAN_BUTTONS[op].label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </RailPopover>
  );
};

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
 * What the selection *is* leads, when it has a uniform subject (connectors,
 * pictures in a grid); then arrangement, which is why a multi-selection
 * usually exists; then structure; then the properties they all share. Which of
 * these apply comes from `resolveAffordances`, the same resolver the panel and
 * the menu ask, and a control that cannot apply to all of the selection is not
 * shown rather than acting on part of it.
 */
export const MultiRail: React.FC<MultiRailProps> = ({ nodes, ids, conditional, tail, tailControls }) => {
  const offers = new Set(
    resolveAffordances(nodes, { surface: 'toolbar', allObjects: useStore.getState().objects }).map((a) => a.id)
  );
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
          <RailPopover label="Ends" trigger={<EndsGlyph start={first.endStart ?? 'none'} end={first.endEnd ?? 'none'} />} align="start">
            <span className="ctx-popover__label">Ends · {nodes.length} connectors</span>
            {(['endStart', 'endEnd'] as const).map((which) => (
              <SegmentedControl
                key={which}
                ariaLabel={which === 'endStart' ? 'Start cap' : 'End cap'}
                value={sharedValue(nodes, (n) => (n as ConnectorNode)[which] ?? 'none').value ?? 'none'}
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

  verbs.push({ id: 'align', controls: 1, node: <ArrangeControl nodes={nodes} canDistribute={affords('distribute')} /> });

  const movable = tidyable(nodes);
  if (movable.length >= 2) {
    verbs.push({
      id: 'tidy',
      controls: 1,
      node: (
        <RailButton label="Tidy up" hint="Line up into even rows, at the gap they already use" onClick={() => applyNodePatches(tidySelection(nodes))}>
          <Grid2x2Check size={16} />
        </RailButton>
      ),
    });
    // A live layout: the grid it makes is selected, so its rail can change the columns.
    verbs.push({
      id: 'arrange-grid',
      controls: 1,
      node: (
        <RailButton
          label="Arrange in grid"
          hint="Make this selection a live grid layout"
          onClick={() => {
            const gridId = arrangeSelectionInGrid(movable.map((n) => n.id));
            if (gridId) editor.select(gridId);
          }}
        >
          <LayoutGrid size={16} />
        </RailButton>
      ),
    });
  }

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
  if (affords('boolean')) verbs.push({ id: 'combine', controls: 1, node: <CombineControl ids={ids} /> });
  if (nodes.every((n) => (n.type === 'path' && n.geometry.kind !== 'freehand') || n.type === 'shape')) {
    verbs.push({ id: 'points', controls: 1, node: <PointsControl ids={ids} /> });
  }
  if (affords('sketch')) verbs.push({ id: 'sketch', controls: 1, node: <BulkSketchControl nodes={nodes} /> });

  const locked = sharedValue(nodes, (n) => Boolean(n.locked));
  verbs.push({
    id: 'lock',
    controls: 1,
    node: (
      <RailButton
        label={locked.mixed || !locked.value ? 'Lock all' : 'Unlock all'}
        pressed={!locked.mixed && locked.value}
        // A mixed lock resolves to locked: the safe direction, and one press to undo.
        onClick={() => updateNodes(ids, { locked: locked.mixed ? true : !locked.value })}
      >
        {!locked.mixed && locked.value ? <Lock size={16} /> : <Unlock size={16} />}
      </RailButton>
    ),
  });

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
      kind={
        <span className="ctx-kind" data-tooltip={describeMix(nodes)}>
          <Layers size={15} />
          {nodes.length}
        </span>
      }
      paint={fill}
      paintControls={fill ? 1 : 0}
      verbs={verbs}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
