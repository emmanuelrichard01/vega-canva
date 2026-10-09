import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { LayoutDashboard, PanelRightClose } from 'lucide-react';
import { localAuthorId, provider, updateNodes } from '../engine/document';
import { restackSelection, type RestackOp } from '../engine/model/restack';
import { useStore } from '../hooks/useStore';
import { spatialIndex } from '../engine/SpatialIndex';
import { APPEARANCE_TYPES } from '../engine/objects/appearanceTypes';
import { resolveAffordances, type AffordanceId } from '../engine/selection/affordances';
import { GridSection } from './panel/GridSection';
import { ChartSection } from './panel/ChartSection';
import { TableSection } from './panel/TableSection';
import { gridNodeOf } from '../engine/grid/gridApply';
import { objectRegistry } from '../engine/objects';
import {
  canResizeAsBox,
  intersectCapabilities,
  nodeBounds,
  scaleSelection,
  selectionBounds,
  sharedValue,
  translateSelection,
  type Shared,
} from '../engine/model/selection';
import {
  DEFAULT_TYPOGRAPHY,
  isOpenShape,
  type AnyNode,
  type Appearance,
  type ConnectorNode,
  type ImageNode,
  type Shadow,
  type Stroke,
  type Typography,
} from '../engine/model/schema';
import {
  buildStroke,
  capApplies,
  dashFor,
  restyleForWidth,
  styleOf,
  type DashRatio,
  type StrokeStyleId,
} from '../engine/model/strokeStyle';
import { descendantsOfFrame } from '../engine/model/frames';
import { type LayoutGuide } from '../engine/model/layoutGuide';
import { nodeLabel } from '../engine/model/nodeLabel';
import { getColorForUser } from '../engine/presence/ColorPalette';
import { CYCLE_PRESETS } from '../engine/text/colorCycle';
import { packAdjustments, readAdjustments, type AdjustmentId } from '../engine/model/imageAdjustments';
import { PanelSubjectContext, Section, writePatches } from './panel/grammar';
import { PanelHeader, type Editor } from './panel/PanelHeader';
import { TransformSection } from './panel/sections/TransformSection';
import { AppearanceSection, FillSection } from './panel/sections/FillAppearanceSection';
import { StrokeSection } from './panel/sections/StrokeSection';
import { SketchSection } from './panel/sections/SketchSection';
import { EffectsSection } from './panel/sections/EffectsSection';
import { TypographySection } from './panel/sections/TypographySection';
import { ShapeGeometrySection } from './panel/sections/ShapeGeometrySection';
import { ConnectorSection } from './panel/sections/ConnectorSection';
import { ImageSection } from './panel/sections/ImageSection';
import { IconSection } from './icons/IconSection';
import { PhysicsMaterialSection, MetadataSection } from './panel/sections/PhysicsMaterialSection';
import { StickySection } from './panel/sections/StickySection';
import { SelectionColorsSection } from './panel/sections/SelectionColorsSection';
import { BoardSection } from './panel/sections/BoardSection';
import { ExportSection } from './panel/sections/ExportSection';
import { cornerRadiiOf } from '../engine/model/cornerRadii';
import { FeatureBoundary } from './ui/FeatureBoundary';
import { storageGet, storageSet } from '../utils/safeStorage';
import { useSidewaysOverflowCheck } from './panel/overflowCheck';
import './panel/panel.css';
import { DEFAULT_DROP_SHADOW, DEFAULT_INNER_SHADOW } from '../engine/model/dropShadow';

const DEFAULT_SHADOW: Shadow = DEFAULT_DROP_SHADOW;

export const PANEL_WIDTH_KEY = 'vega.panel.width';
export const PANEL_MIN_W = 240;
export const PANEL_MAX_W = 400;
/** Wide enough for a label column beside a pair of fields without truncating either. */
export const PANEL_DEFAULT_W = 288;

export function clampPanelWidth(w: number): number {
  if (!Number.isFinite(w)) return PANEL_DEFAULT_W;
  return Math.round(Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, w)));
}

function applyPanelWidth(w: number) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--inspector-w', `${clampPanelWidth(w)}px`);
}

interface PropertiesPanelProps {
  selectedIds: string[];
  overrideObjects?: Record<string, AnyNode> | null;
  onCollapse?: () => void;
}

function appearanceOf(node: AnyNode): Appearance | null {
  if (!APPEARANCE_TYPES.has(node.type)) return null;
  return (node as { appearance?: Appearance }).appearance ?? {};
}

function typographyOf(node: AnyNode): Typography | null {
  if (node.type === 'text') return node.typography;
  if (node.type === 'shape') return node.typography ?? DEFAULT_TYPOGRAPHY;
  return null;
}

/**
 * The panel's left edge, dragged to set its width (240–400px, 288 to start).
 * The width is remembered per browser; arrow keys move it by 8px for keyboard
 * users and a double-click puts it back.
 */
const WidthHandle: React.FC = () => {
  const [width, setWidth] = useState(() => clampPanelWidth(Number(storageGet(PANEL_WIDTH_KEY) ?? PANEL_DEFAULT_W)));
  const drag = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => applyPanelWidth(width), [width]);

  const commit = useCallback((w: number) => {
    const next = clampPanelWidth(w);
    setWidth(next);
    storageSet(PANEL_WIDTH_KEY, String(next));
  }, []);

  return (
    <div
      className="panel-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel width"
      aria-valuemin={PANEL_MIN_W}
      aria-valuemax={PANEL_MAX_W}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = { x: e.clientX, w: width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setWidth(clampPanelWidth(drag.current.w + (drag.current.x - e.clientX)));
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        commit(width);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={() => commit(PANEL_DEFAULT_W)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          commit(width + 8);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          commit(width - 8);
        }
      }}
    />
  );
};

/** Collaborators other than this tab who have any of `ids` selected. */
function useEditors(ids: string[]): Editor[] {
  const [editors, setEditors] = useState<Editor[]>([]);
  const key = ids.join(',');
  useEffect(() => {
    const awareness = provider.awareness;
    if (!awareness) return;
    const read = () => {
      const mine = awareness.clientID;
      const next: Editor[] = [];
      awareness.getStates().forEach((state: any, clientId: number) => {
        if (clientId === mine || !state?.user || !Array.isArray(state.selection)) return;
        if (!ids.some((id) => state.selection.includes(id))) return;
        next.push({ name: state.user.name || 'Teammate', color: state.user.color || getColorForUser(String(clientId)) });
      });
      setEditors((prev) =>
        prev.length === next.length && prev.every((p, i) => p.name === next[i].name && p.color === next[i].color) ? prev : next
      );
    };
    read();
    awareness.on('change', read);
    return () => awareness.off('change', read);
    // `key` stands in for `ids`: a new array with the same ids is the same selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return editors;
}

const PropertiesPanelInner: React.FC<PropertiesPanelProps> = ({ selectedIds, overrideObjects, onCollapse }) => {
  const storeNodes = useStore(
    useShallow((state) => selectedIds.map((id) => state.objects[id]).filter((n): n is AnyNode => Boolean(n)))
  );
  const [aspectLocked, setAspectLocked] = useState(false);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  useSidewaysOverflowCheck(scroller);

  const nodes: AnyNode[] = useMemo(() => {
    if (!overrideObjects) return storeNodes;
    return selectedIds.map((id) => overrideObjects[id]).filter((n): n is AnyNode => Boolean(n));
  }, [overrideObjects, selectedIds, storeNodes]);

  const editors = useEditors(nodes.map((n) => n.id));

  const node: AnyNode | null = nodes[0] ?? null;
  const isMulti = nodes.length > 1;

  const shared = <T,>(read: (n: AnyNode) => T): Shared<T> => sharedValue(nodes, read);

  if (!node) {
    return (
      <PanelSubjectContext.Provider value="none">
        <div className="props-shell">
          <WidthHandle />
          <div ref={setScroller} className="props-panel custom-scrollbar">
            <header className="panel-head">
              <span className="panel-head__glyph" aria-hidden="true">
                <LayoutDashboard size={14} />
              </span>
              <span className="panel-head__name">Board</span>
              {onCollapse && (
                <button
                  type="button"
                  className="pg-icon-btn"
                  onClick={onCollapse}
                  data-tooltip="Collapse panel"
                  aria-label="Collapse the properties panel"
                >
                  <PanelRightClose size={15} aria-hidden="true" />
                </button>
              )}
            </header>
            <BoardSection />
          </div>
        </div>
      </PanelSubjectContext.Provider>
    );
  }

  const selectedIdsPresent = nodes.map((n) => n.id);
  const gridNode = gridNodeOf(nodes);
  const uniformType = !shared((n) => n.type).mixed;
  const uniformKind =
    uniformType && !shared((n) => ((n as { geometry?: { kind?: string } }).geometry?.kind ?? null)).mixed;
  const subject = isMulti && !uniformType ? 'multi' : node.type;

  const capabilities = isMulti
    ? intersectCapabilities(nodes.map((n) => objectRegistry.get(n.type)?.capabilities ?? {}))
    : objectRegistry.get(node.type)?.capabilities ?? {};
  const typography = typographyOf(node);
  const appearance = appearanceOf(node);
  // A frame's corners are set once, in the Frame section; Appearance does not repeat them.
  const appearanceCapabilities = nodes.every((n) => n.type === 'frame')
    ? { ...capabilities, supportsRadius: false }
    : capabilities;

  const openShape = nodes.some((n) => n.type === 'shape' && isOpenShape(n.geometry.kind));
  const offered = new Set(resolveAffordances(nodes, { surface: 'panel' }).map((a) => a.id));
  const affords = (id: AffordanceId) => offered.has(id);

  const sketchable = affords('sketch');
  const allClosed = nodes.length > 0 && nodes.every((n) => n.type === 'shape' && !isOpenShape(n.geometry.kind));
  const hasConnector = nodes.some((n) => n.type === 'connector');
  const hasImage = nodes.some((n) => n.type === 'image');

  const flipX = shared((n) => n.scaleX < 0);
  const flipY = shared((n) => n.scaleY < 0);
  const flipped = { x: Boolean(flipX.value), mixedX: flipX.mixed, y: Boolean(flipY.value), mixedY: flipY.mixed };
  const pickedTheme = shared((n) => (n.type === 'sticky' ? n.theme : null));
  const pinnedShared = shared((n) => (n.type === 'sticky' ? n.pinned : null));
  const allLocked = nodes.every((n) => n.locked);

  const hasCorners = nodes.every((n) => {
    const paint = appearanceOf(n);
    return n.type === 'path'
      ? n.geometry.kind !== 'freehand'
      : n.type === 'shape' &&
          (n.geometry.kind === 'polygon' ||
            n.geometry.kind === 'star' ||
            (n.geometry.kind === 'rect' && Math.max(...cornerRadiiOf(paint?.cornerRadius)) <= 0));
  });

  const hasEnds = nodes.every((n) => capApplies({ ...n, appearance: appearanceOf(n) }));

  /** Every write from the panel goes through `writePatches`, so a scrub previews live and lands as one undo step. */
  const set = (updates: Partial<AnyNode>) =>
    writePatches(selectedIdsPresent.map((id) => ({ id, changes: updates as Record<string, unknown> })));

  const patchEach = (build: (n: AnyNode) => Record<string, unknown> | null) =>
    writePatches(
      nodes
        .map((n) => {
          const changes = build(n);
          return changes ? { id: n.id, changes } : null;
        })
        .filter((p): p is { id: string; changes: Record<string, unknown> } => p !== null)
    );

  const setAppearance = (patch: Partial<Appearance>) =>
    patchEach((n) => ({ appearance: { ...(appearanceOf(n) ?? {}), ...patch } }));
  const cycleKey =
    Object.entries(CYCLE_PRESETS).find(
      ([, preset]) => preset.colors.join(',') === typography?.colorCycle?.colors.join(',')
    )?.[0] ?? (typography?.colorCycle ? 'rainbow' : 'none');

  const setTypography = (patch: Partial<Typography>) =>
    patchEach((n) => ({ typography: { ...(typographyOf(n) ?? DEFAULT_TYPOGRAPHY), ...patch } }));

  const setStroke = (patch: Partial<Pick<Stroke, 'color' | 'width' | 'align' | 'join' | 'miterLimit' | 'cap'>>) => {
    patchEach((n) => {
      const paint = appearanceOf(n);
      const current = paint?.stroke;
      const color = patch.color ?? current?.color ?? '#000000';
      const width = patch.width ?? current?.width ?? 2;
      const align = patch.align ?? current?.align;
      const join = patch.join ?? current?.join;
      const miterLimit = patch.miterLimit ?? current?.miterLimit;
      const cap = patch.cap ?? current?.cap;
      return {
        appearance: {
          ...(paint ?? {}),
          stroke: buildStroke({ color, width, align, join, miterLimit, cap }, restyleForWidth(current, width)),
        },
      };
    });
  };

  const adjustments = readAdjustments(node.type === 'image' ? node.filters : undefined);
  const setAdjustment = (id: AdjustmentId, value: number) =>
    patchEach((n) => (n.type === 'image' ? { filters: packAdjustments({ ...readAdjustments(n.filters), [id]: value }) } : null));

  const setShadow = (patch: Partial<Shadow>) =>
    patchEach((n) => {
      const paint = appearanceOf(n);
      return { appearance: { ...(paint ?? {}), shadow: { ...(paint?.shadow ?? DEFAULT_SHADOW), ...patch } } };
    });

  const setInnerShadow = (patch: Partial<Shadow>) =>
    patchEach((n) => {
      const paint = appearanceOf(n);
      return { appearance: { ...(paint ?? {}), innerShadow: { ...(paint?.innerShadow ?? DEFAULT_INNER_SHADOW), ...patch } } };
    });

  const setSafeArea = (edge: 'top' | 'right' | 'bottom' | 'left', value: number) =>
    patchEach((n) => {
      if (n.type !== 'frame') return null;
      const current = n.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
      const next = { ...current, [edge]: Math.max(0, value) };
      const empty = !next.top && !next.right && !next.bottom && !next.left;
      return { safeArea: empty ? undefined : next };
    });

  /** Swap a frame's width and height, transposing the safe area so turning twice is the identity. */
  const turnFrame = () =>
    patchEach((n) => {
      if (n.type !== 'frame') return null;
      const inset = n.safeArea;
      return {
        width: n.height,
        height: n.width,
        safeArea: inset ? { top: inset.left, left: inset.top, right: inset.bottom, bottom: inset.right } : undefined,
      };
    });

  /**
   * Shrink a frame to what it owns, plus a margin. Never moves the children
   * and never grows: a frame smaller than its contents may be cropping them on
   * purpose.
   */
  const fitFrameToContents = () => {
    const frame = nodes.find((n) => n.type === 'frame');
    if (!frame) return;
    const store = useStore.getState().objects;
    const childIds = descendantsOfFrame(frame.id, Object.values(store));
    const boxes = childIds.map((id) => store[id]).filter(Boolean);
    if (boxes.length === 0) return;
    const left = Math.min(...boxes.map((b) => b.x));
    const top = Math.min(...boxes.map((b) => b.y));
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));
    const margin = 24;
    writePatches([
      {
        id: frame.id,
        changes: {
          x: left - margin,
          y: top - margin,
          width: Math.max(1, right - left + margin * 2),
          height: Math.max(1, bottom - top + margin * 2),
        },
      },
    ]);
  };

  const setLayoutGuide = (guide: LayoutGuide | undefined) =>
    patchEach((n) => (n.type === 'frame' ? { layoutGuide: guide } : null));

  /** The names of what each end of the selected connector is attached to, as Layers shows them. */
  const connectorBoundNames = (() => {
    if (node.type !== 'connector') return {};
    const objects = useStore.getState().objects;
    const name = (id?: string) => {
      const target = id ? objects[id] : undefined;
      return target ? nodeLabel(target) : undefined;
    };
    return { from: name(node.from.nodeId), to: name(node.to.nodeId) };
  })();

  /**
   * How many objects the selected frame owns, for the fit control's label.
   * Candidates come from the spatial index around the frame rather than a
   * scan of the board: what a frame owns sits on it.
   */
  const frameChildCount = (() => {
    const frame = nodes.find((n) => n.type === 'frame');
    if (!frame) return 0;
    const b = nodeBounds(frame);
    const nearby = spatialIndex.query({ minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height });
    return descendantsOfFrame(frame.id, nearby).length;
  })();

  const setGeometry = (patch: Record<string, unknown>) =>
    patchEach((n) => (n.type === 'shape' ? { geometry: { ...n.geometry, ...patch } } : null));

  const setConnectorLikeColor = (color: string) => {
    setStroke({ color });
    if (nodes.length > 0 && nodes.every((n) => n.type === 'connector')) {
      useStore.getState().setConnectorColor(color);
    }
  };

  /**
   * Set the dash pattern, by style or by ratio. One writer for both, so
   * `buildStroke` is never forgotten; applied per node against its own
   * weight, so a mixed selection shares the ratio rather than the array.
   */
  const applyDash = (style: StrokeStyleId, ratio?: DashRatio) =>
    patchEach((n) => {
      const paint = appearanceOf(n);
      const current = paint?.stroke;
      const color = current?.color ?? '#000000';
      const width = current?.width && current.width > 0 ? current.width : 2;
      return {
        appearance: {
          ...(paint ?? {}),
          stroke: buildStroke(
            { color, width, align: current?.align, join: current?.join, miterLimit: current?.miterLimit, cap: current?.cap },
            dashFor(style, width, ratio)
          ),
        },
      };
    });

  const setStrokeStyle = (style: StrokeStyleId) => applyDash(style);
  const setDashRatio = (ratio: DashRatio) => applyDash(styleOf(appearance?.stroke), ratio);

  const bounds = selectionBounds(nodes);
  const boxResizable = !isMulti || canResizeAsBox(nodes);
  const resizeBlockedReason = boxResizable ? undefined : 'Resize is unavailable while something in the selection is rotated';

  const setOrigin = (axis: 'x' | 'y', value: number) => {
    if (!isMulti) {
      set({ [axis]: value } as Partial<AnyNode>);
      return;
    }
    if (bounds) writePatches(translateSelection(nodes, bounds, axis, value));
  };

  const nudgeEach = (key: 'x' | 'y' | 'rotation' | 'opacity' | 'skewX' | 'skewY', delta: number, min?: number, max?: number) =>
    patchEach((n) => {
      const fallback = key === 'opacity' ? 1 : 0;
      let next = Math.round((((n[key] as number | undefined) ?? fallback) + delta) * 10000) / 10000;
      if (min !== undefined) next = Math.max(min, next);
      if (max !== undefined) next = Math.min(max, next);
      return { [key]: next };
    });

  const resizeSelection = (axis: 'width' | 'height', value: number) => {
    if (!bounds || !boxResizable) return;
    if (!isMulti) {
      const other = axis === 'width' ? 'height' : 'width';
      const next = Math.max(1, value);
      const scaled = aspectLocked && node[axis] > 0 ? Math.round(next * (node[other] / node[axis])) : node[other];
      set({ [axis]: next, [other]: Math.max(1, scaled) } as Partial<AnyNode>);
      return;
    }
    const patches = scaleSelection(nodes, bounds, axis, value);
    if (!aspectLocked || bounds[axis] <= 0) {
      writePatches(patches);
      return;
    }
    const factor = Math.max(1, value) / bounds[axis];
    const other = axis === 'width' ? 'height' : 'width';
    const merged = new Map<string, Record<string, unknown>>();
    [...patches, ...scaleSelection(nodes, bounds, other, bounds[other] * factor)].forEach(({ id, changes }) =>
      merged.set(id, { ...(merged.get(id) ?? {}), ...changes })
    );
    writePatches([...merged].map(([id, changes]) => ({ id, changes })));
  };

  const restack = (op: RestackOp) => {
    const patches = restackSelection(Object.values(useStore.getState().objects), selectedIds, op);
    if (patches.length > 0) writePatches(patches);
  };
  const flip = (axis: 'x' | 'y') =>
    patchEach((n) => (axis === 'x' ? { scaleX: -n.scaleX } : { scaleY: -n.scaleY }));

  const createdByLabel = String(node.createdBy) === localAuthorId() ? 'You' : node.createdByName || 'Unknown';
  const updatedByLabel = String(node.updatedBy) === localAuthorId() ? 'You' : node.updatedByName || 'Unknown';

  const sharedType = <T,>(read: (t: Typography) => T): Shared<T> => shared((n) => read(typographyOf(n) ?? DEFAULT_TYPOGRAPHY));
  const weight = sharedType((t) => t.fontWeight ?? 400);
  const isBold = (weight.value ?? 400) >= 600;

  const sharedPaint = <T,>(read: (a: Appearance) => T): Shared<T> => shared((n) => read(appearanceOf(n) ?? {}));

  const opacityShared = shared((n) => n.opacity);
  const rotationShared = shared((n) => n.rotation);

  const noText = !isMulti && node.type === 'shape' && !(node.text ?? '').trim();
  const startTyping = () => document.dispatchEvent(new CustomEvent('requestEditNode', { detail: { id: node.id } }));

  return (
    <PanelSubjectContext.Provider value={subject}>
      <div className="props-shell">
        <WidthHandle />
        <div ref={setScroller} className="props-panel custom-scrollbar">
          <PanelHeader
            nodes={nodes}
            editors={editors}
            flipped={{ x: flipped.x && !flipped.mixedX, y: flipped.y && !flipped.mixedY }}
            locked={allLocked}
            canLock
            onRename={(title) => updateNodes([node.id], { title })}
            onRestack={restack}
            onFlip={flip}
            onToggleLock={() => set({ locked: !allLocked } as Partial<AnyNode>)}
            onCollapse={onCollapse}
          />

          {/* Subject: what this object is, first, because it is why it was selected. */}
          {gridNode && <GridSection nodeId={gridNode.id} />}
          {node.type === 'chart' && (
            <Section id="chart" title="Chart" collapsible subject="chart">
              <ChartSection node={node} />
            </Section>
          )}
          {node.type === 'table' && (
            <Section id="table" title="Table" collapsible subject="table">
              <TableSection node={node} />
            </Section>
          )}
          {affords('sticky-theme') && node.type === 'sticky' && (
            <StickySection node={node} isMulti={isMulti} pickedTheme={pickedTheme} pinned={pinnedShared} set={set} shared={shared} />
          )}
          <ConnectorSection
            node={node as ConnectorNode}
            affords={affords}
            shared={shared}
            set={set}
            boundNames={connectorBoundNames}
          />
          <ShapeGeometrySection
            node={node}
            uniformKind={uniformKind}
            openShape={openShape}
            affords={affords}
            shared={shared}
            setGeometry={setGeometry}
            setSafeArea={setSafeArea}
            turnFrame={turnFrame}
            fitFrameToContents={fitFrameToContents}
            frameChildCount={frameChildCount}
            setLayoutGuide={setLayoutGuide}
          />
          <ImageSection node={node as ImageNode} adjustments={adjustments} affords={affords} setAdjustment={setAdjustment} set={set} single={!isMulti} />
          {node.type === 'icon' && !isMulti && (
            <IconSection node={node} onChange={(patch) => set(patch as Partial<AnyNode>)} />
          )}

          <TransformSection
            bounds={bounds}
            node={node}
            aspectLocked={aspectLocked}
            setAspectLocked={setAspectLocked}
            resizeBlockedReason={resizeBlockedReason}
            rotationShared={rotationShared}
            setOrigin={setOrigin}
            resizeSelection={resizeSelection}
            set={set}
            nudgeEach={nudgeEach}
            shared={shared}
            flipped={flipped}
            onFlip={flip}
          />

          <AppearanceSection
            capabilities={appearanceCapabilities}
            appearance={appearance ?? undefined}
            openShape={openShape}
            hasConnector={hasConnector}
            sharedPaint={sharedPaint}
            opacityShared={opacityShared}
            setAppearance={setAppearance}
            set={set}
            nudgeOpacity={(d) => nudgeEach('opacity', d, 0, 1)}
          />

          <FillSection
            capabilities={capabilities}
            appearance={appearance ?? undefined}
            openShape={openShape}
            sharedPaint={sharedPaint}
            setAppearance={setAppearance}
            setConnectorLikeColor={setConnectorLikeColor}
          />

          <StrokeSection
            capabilities={capabilities}
            appearance={appearance ?? undefined}
            openShape={openShape}
            hasCorners={hasCorners}
            hasEnds={hasEnds}
            sharedPaint={sharedPaint}
            setStroke={setStroke}
            setStrokeStyle={setStrokeStyle}
            setDashRatio={setDashRatio}
            setAppearance={setAppearance}
          />

          {isMulti && <SelectionColorsSection nodes={nodes} />}

          <TypographySection
            node={node}
            typography={typography}
            uniformType={uniformType}
            openShape={openShape}
            cycleKey={cycleKey}
            isBold={isBold}
            noText={noText}
            onStartTyping={startTyping}
            sharedType={sharedType}
            shared={shared}
            setTypography={setTypography}
            set={set}
            patchEach={patchEach}
            typographyOf={typographyOf}
          />

          <EffectsSection
            capabilities={capabilities}
            appearance={appearance ?? undefined}
            openShape={openShape}
            hasConnector={hasConnector}
            hasImage={hasImage}
            sharedPaint={sharedPaint}
            setAppearance={setAppearance}
            setShadow={setShadow}
            setInnerShadow={setInnerShadow}
          />

          <SketchSection
            capabilities={capabilities}
            appearance={appearance ?? undefined}
            sketchable={sketchable}
            allClosed={allClosed}
            sharedPaint={sharedPaint}
            setAppearance={setAppearance}
          />

          <PhysicsMaterialSection nodes={nodes} node={node} set={set} />

          {!overrideObjects && <ExportSection nodes={nodes} />}

          <MetadataSection node={node} isMulti={isMulti} createdByLabel={createdByLabel} updatedByLabel={updatedByLabel} />
        </div>
      </div>
    </PanelSubjectContext.Provider>
  );
};

/** The panel, contained: a crash here resets on the next selection and leaves the board running. */
export const PropertiesPanel = React.memo(function PropertiesPanel(props: PropertiesPanelProps) {
  return (
    <FeatureBoundary name="properties panel" variant="panel" resetKey={props.selectedIds.join(',')}>
      <PropertiesPanelInner {...props} />
    </FeatureBoundary>
  );
});
