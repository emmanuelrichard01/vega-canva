import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  BringToFront,
  FlipHorizontal,
  FlipVertical,
  LayoutGrid,
  LayoutTemplate,
  PanelRightClose,
  SendToBack,
  StickyNote,
} from 'lucide-react';
import { applyNodePatches, localAuthorId, lowestZIndex, nextZIndex, provider, updateNodes } from '../engine/document';
import { useStore } from '../hooks/useStore';
import { APPEARANCE_TYPES } from '../engine/objects/appearanceTypes';
import { resolveAffordances, type AffordanceId } from '../engine/selection/affordances';
import { GridSection } from './panel/GridSection';
import { gridNodeOf } from '../engine/grid/gridApply';
import { objectRegistry } from '../engine/objects';
import {
  canResizeAsBox,
  intersectCapabilities,
  scaleSelection,
  selectionBounds,
  selectionLabel,
  sharedValue,
  translateSelection,
  type Shared,
} from '../engine/model/selection';
import {
  DEFAULT_SHADOW_COLOR,
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
import { descendantsOfFrame, type FramePreset } from '../engine/model/frames';
import { type LayoutGuide } from '../engine/model/layoutGuide';
import { TagEditor } from './ui/TagEditor';
import { THEMES } from '../engine/model/stickyThemes';
import { STICKY_THEMES } from '../engine/model/schema';
import { getColorForUser } from '../engine/presence/ColorPalette';
import { CYCLE_PRESETS } from '../engine/text/colorCycle';
import { packAdjustments, readAdjustments, type AdjustmentId } from '../engine/model/imageAdjustments';
import { Accordion, Row } from './panel/panelPrimitives';
import { TYPE_ICONS } from './panel/panelIcons';
import { TransformSection } from './panel/sections/TransformSection';
import { FillAppearanceSection } from './panel/sections/FillAppearanceSection';
import { StrokeSection } from './panel/sections/StrokeSection';
import { SketchSection } from './panel/sections/SketchSection';
import { EffectsSection } from './panel/sections/EffectsSection';
import { TypographySection } from './panel/sections/TypographySection';
import { ShapeGeometrySection } from './panel/sections/ShapeGeometrySection';
import { ConnectorSection } from './panel/sections/ConnectorSection';
import { ImageSection } from './panel/sections/ImageSection';
import { PhysicsMaterialSection, MetadataSection } from './panel/sections/PhysicsMaterialSection';
import { cornerRadiiOf } from '../engine/model/cornerRadii';

const DEFAULT_SHADOW: Shadow = {
  color: DEFAULT_SHADOW_COLOR,
  blur: 12,
  offsetX: 0,
  offsetY: 4,
  spread: 0,
  opacity: 0.25,
};

const DEFAULT_INNER_SHADOW: Shadow = {
  color: DEFAULT_SHADOW_COLOR,
  blur: 8,
  offsetX: 0,
  offsetY: 2,
  spread: 0,
  opacity: 0.35,
};

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

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ selectedIds, overrideObjects, onCollapse }) => {
  const storeNodes = useStore(
    useShallow((state) =>
      selectedIds.map((id) => state.objects[id]).filter((n): n is AnyNode => Boolean(n))
    )
  );
  const [aspectLocked, setAspectLocked] = useState(false);

  const nodes: AnyNode[] = useMemo(() => {
    if (!overrideObjects) return storeNodes;
    return selectedIds.map((id) => overrideObjects[id]).filter((n): n is AnyNode => Boolean(n));
  }, [overrideObjects, selectedIds, storeNodes]);

  const node: AnyNode | null = nodes[0] ?? null;
  const isMulti = nodes.length > 1;

  const shared = <T,>(read: (n: AnyNode) => T): Shared<T> => sharedValue(nodes, read);

  /**
   * Nothing selected.
   *
   * ## Why this stayed a message
   *
   * The first attempt filled the space with board properties -- a count per
   * node type that selected its type on click, and the snap and theme toggles.
   * Useful in isolation and redundant in this app: the Layers panel already
   * lists and filters by type, and both settings already live in the View menu.
   * A panel that repeats two other surfaces is not richer, it is a third place
   * to keep in step, and the reader has to work out which one is authoritative.
   *
   * So the honest answer is that there is nothing to inspect, and the work goes
   * into saying it well rather than into finding something to say.
   *
   * ## What "well" means here
   *
   * The old version was an icon and a line at `opacity: 0.7`. Fading a whole
   * block is the visual language of a *disabled* control -- it reads as
   * something that should be working and is not, which is the one impression an
   * empty state must avoid. Full-strength type in the tertiary role says the
   * same thing calmly, and lets the two lines take a deliberate hierarchy
   * instead of both being dimmed equally.
   *
   * The mark is a marquee: the dashed rectangle the Select tool drags, at the
   * moment it has caught nothing. It says which gesture fills this panel,
   * which a slider glyph -- the previous icon, borrowed from "settings" -- did
   * not.
   */
  if (!node) {
    return (
      <div className="props-empty">
        {onCollapse && (
          <div className="props-empty__bar">
            <button
              className="btn-icon"
              onClick={onCollapse}
              data-tooltip="Collapse panel"
              aria-label="Collapse the properties panel"
            >
              <PanelRightClose size={15} />
            </button>
          </div>
        )}
        <div className="props-empty__body">
          <svg width="44" height="34" viewBox="0 0 44 34" fill="none" aria-hidden focusable="false">
            {/* The marquee, mid-drag: three dashed sides and a cursor at the
                corner it is being pulled from. Drawn rather than imported so it
                matches the real marquee's dash rhythm. */}
            <rect
              x="1.5" y="1.5" width="33" height="25" rx="2.5"
              stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3"
            />
            <path
              d="M30 20.5 L41 25.5 L36.2 27.4 L34.3 32.2 Z"
              fill="var(--surface-primary)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
            />
          </svg>
          <p className="props-empty__title">Nothing selected</p>
          <p className="props-empty__hint">Pick an object on the board to edit it here.</p>
        </div>
      </div>
    );
  }

  const selectedIdsPresent = nodes.map((n) => n.id);
  const gridNode = gridNodeOf(nodes);
  const uniformType = !shared((n) => n.type).mixed;
  const uniformKind =
    uniformType &&
    !shared((n) => ((n as { geometry?: { kind?: string } }).geometry?.kind ?? null)).mixed;

  const capabilities = isMulti
    ? intersectCapabilities(
        nodes.map((n) => objectRegistry.get(n.type)?.capabilities ?? {})
      )
    : objectRegistry.get(node.type)?.capabilities ?? {};
  const typography = typographyOf(node);
  const appearance = appearanceOf(node);

  const openShape = nodes.some((n) => n.type === 'shape' && isOpenShape(n.geometry.kind));
  const offered = new Set(resolveAffordances(nodes, { surface: 'panel' }).map((a) => a.id));
  const affords = (id: AffordanceId) => offered.has(id);

  const sketchable = affords('sketch');
  const allClosed =
    nodes.length > 0 &&
    nodes.every((n) => n.type === 'shape' && !isOpenShape(n.geometry.kind));
  const hasConnector = nodes.some((n) => n.type === 'connector');
  const hasImage = nodes.some((n) => n.type === 'image');

  const flipX = shared((n) => n.scaleX < 0);
  const flipY = shared((n) => n.scaleY < 0);
  const flipped = { x: Boolean(flipX.value), mixedX: flipX.mixed, y: Boolean(flipY.value), mixedY: flipY.mixed };
  /** The paper every selected note is on, or nothing when they disagree. */
  const pickedTheme = shared((n) => (n.type === 'sticky' ? n.theme : null));

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

  const set = (updates: Partial<AnyNode>) =>
    updateNodes(selectedIdsPresent, updates as Record<string, unknown>);

  const patchEach = (build: (n: AnyNode) => Record<string, unknown> | null) =>
    applyNodePatches(
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
    patchEach((n) =>
      n.type === 'image'
        ? { filters: packAdjustments({ ...readAdjustments(n.filters), [id]: value }) }
        : null
    );

  const setShadow = (patch: Partial<Shadow>) =>
    patchEach((n) => {
      const paint = appearanceOf(n);
      return {
        appearance: { ...(paint ?? {}), shadow: { ...(paint?.shadow ?? DEFAULT_SHADOW), ...patch } },
      };
    });

  const setInnerShadow = (patch: Partial<Shadow>) =>
    patchEach((n) => {
      const paint = appearanceOf(n);
      return {
        appearance: {
          ...(paint ?? {}),
          innerShadow: { ...(paint?.innerShadow ?? DEFAULT_INNER_SHADOW), ...patch },
        },
      };
    });

  const setSafeArea = (edge: 'top' | 'right' | 'bottom' | 'left', value: number) =>
    patchEach((n) => {
      if (n.type !== 'frame') return null;
      const current = n.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
      const next = { ...current, [edge]: Math.max(0, value) };
      const empty = !next.top && !next.right && !next.bottom && !next.left;
      return { safeArea: empty ? undefined : next };
    });

  /**
   * Resize a frame to a named size, keeping its top-left corner.
   *
   * The corner rather than the centre, because a frame is a page on a desk and
   * a page is placed by its corner — growing an A4 into an A3 from the middle
   * would push it under whatever is above and to the left of it, which is
   * usually the frame you laid out first.
   *
   * The preset's safe area comes with it, and replaces whatever was there.
   * That is the honest reading of "make this an A4": the guides belong to the
   * size, and keeping a story's 250/320 insets on a business card would leave
   * a frame promising a safe area that means nothing.
   */
  const applyFramePreset = (preset: FramePreset) =>
    patchEach((n) =>
      n.type === 'frame'
        ? { width: preset.width, height: preset.height, safeArea: preset.safeArea }
        : null
    );

  /**
   * Swap a frame's width and height.
   *
   * Operates on the frame's own numbers rather than looking up a preset, so it
   * works on a custom size too — which is most frames after anybody has
   * dragged one.
   *
   * The safe area is transposed with the box: top swaps with left, bottom with
   * right. That is the operation `turnPreset` performs and, unlike a quarter
   * rotation, it is its own inverse — so turning twice returns exactly what
   * you started with rather than leaving the guides upside down.
   */
  const turnFrame = () =>
    patchEach((n) => {
      if (n.type !== 'frame') return null;
      const inset = n.safeArea;
      return {
        width: n.height,
        height: n.width,
        safeArea: inset
          ? { top: inset.left, left: inset.top, right: inset.bottom, bottom: inset.right }
          : undefined,
      };
    });

  /**
   * Shrink a frame to the union of what it contains, plus a margin.
   *
   * Reads the frame's own membership — the containment it already maintains —
   * rather than testing overlap, so an object that merely passes over a frame
   * is not counted and one that belongs to it is, wherever it currently sits.
   *
   * Two things it deliberately does not do. It does not move the children:
   * their world positions are what "fit" is measured *from*, and moving them
   * would make the operation something you have to undo to see. And it does
   * not grow — a frame smaller than its contents is clipping them on purpose
   * as often as by accident, and quietly revealing what somebody cropped is a
   * bigger surprise than leaving it.
   */
  const fitFrameToContents = () => {
    const frame = nodes.find((n) => n.type === 'frame');
    if (!frame) return;
    const store = useStore.getState().objects;
    const childIds = descendantsOfFrame(frame.id, Object.values(store));
    if (childIds.length === 0) return;

    const boxes = childIds.map((id) => store[id]).filter(Boolean);
    if (boxes.length === 0) return;

    const left = Math.min(...boxes.map((b) => b.x));
    const top = Math.min(...boxes.map((b) => b.y));
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));

    // A margin, so the fit does not put the frame's own hairline through the
    // edge of whatever was furthest out.
    const margin = 24;
    applyNodePatches([
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

  /**
   * Set or clear a frame's column measure.
   *
   * Written whole rather than patched field by field, because a measure with
   * no columns is not a measure — the normalizer drops one, so a control that
   * could put the count to zero would silently delete the guide and leave the
   * switch on.
   */
  const setLayoutGuide = (guide: LayoutGuide | undefined) =>
    patchEach((n) => (n.type === 'frame' ? { layoutGuide: guide } : null));

  /** How many objects the selected frame owns, for the fit control's label. */
  const frameChildCount = (() => {
    const frame = nodes.find((n) => n.type === 'frame');
    if (!frame) return 0;
    return descendantsOfFrame(frame.id, Object.values(useStore.getState().objects)).length;
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
   * Set the dash pattern, either by picking a style or by shaping one.
   *
   * One writer for both, because they produce the same thing: picking a style
   * is choosing a ratio from `DASH_PRESET`, and shaping one is supplying it.
   * Two paths writing `stroke.dash` would be two chances to forget
   * `buildStroke`, which is the function that keeps a solid stroke from
   * carrying a stale `dash` key.
   *
   * Shaping is applied **per node**, against each node's own weight, so a
   * multi-selection of different weights all end up with the same *ratio*
   * rather than the same array — which is the whole point of the ratio.
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
            {
              color,
              width,
              align: current?.align,
              join: current?.join,
              miterLimit: current?.miterLimit,
              cap: current?.cap,
            },
            dashFor(style, width, ratio)
          ),
        },
      };
    });

  const setStrokeStyle = (style: StrokeStyleId) => applyDash(style);

  const setDashRatio = (ratio: DashRatio) => applyDash(styleOf(appearance?.stroke), ratio);

  const bounds = selectionBounds(nodes);
  const boxResizable = !isMulti || canResizeAsBox(nodes);
  const resizeBlockedReason =
    boxResizable ? undefined : 'Resize is unavailable while something in the selection is rotated';

  const setOrigin = (axis: 'x' | 'y', value: number) => {
    if (!isMulti) {
      set({ [axis]: value } as Partial<AnyNode>);
      return;
    }
    if (bounds) applyNodePatches(translateSelection(nodes, bounds, axis, value));
  };

  const nudgeEach = (
    key: 'x' | 'y' | 'rotation' | 'opacity' | 'skewX' | 'skewY',
    delta: number,
    min?: number,
    max?: number
  ) =>
    patchEach((n) => {
      let next = ((n[key] as number | undefined) ?? 0) + delta;
      if (min !== undefined) next = Math.max(min, next);
      if (max !== undefined) next = Math.min(max, next);
      return { [key]: next };
    });

  const resizeSelection = (axis: 'width' | 'height', value: number) => {
    if (!bounds || !boxResizable) return;

    if (!isMulti) {
      const other = axis === 'width' ? 'height' : 'width';
      const next = Math.max(1, value);
      const scaled =
        aspectLocked && node[axis] > 0 ? Math.round(next * (node[other] / node[axis])) : node[other];
      set({ [axis]: next, [other]: Math.max(1, scaled) } as Partial<AnyNode>);
      return;
    }

    const patches = scaleSelection(nodes, bounds, axis, value);
    if (!aspectLocked || bounds[axis] <= 0) {
      applyNodePatches(patches);
      return;
    }

    const factor = Math.max(1, value) / bounds[axis];
    const other = axis === 'width' ? 'height' : 'width';
    const merged = new Map<string, Record<string, unknown>>();
    [...patches, ...scaleSelection(nodes, bounds, other, bounds[other] * factor)].forEach(
      ({ id, changes }) => merged.set(id, { ...(merged.get(id) ?? {}), ...changes })
    );
    applyNodePatches([...merged].map(([id, changes]) => ({ id, changes })));
  };

  const awarenessStates = provider.awareness?.getStates();
  const myClientId = provider.awareness?.clientID;
  const activeEditors: Array<{ name: string; color: string }> = [];
  (awarenessStates ?? new Map()).forEach((state: any, clientId: number) => {
    if (
      clientId !== myClientId &&
      state.user &&
      Array.isArray(state.selection) &&
      selectedIdsPresent.some((id) => state.selection.includes(id))
    ) {
      activeEditors.push({
        name: state.user.name || 'Teammate',
        color: state.user.color || getColorForUser(String(clientId)),
      });
    }
  });

  const createdByLabel =
    String(node.createdBy) === localAuthorId() ? 'You' : node.createdByName || 'Unknown';
  const updatedByLabel =
    String(node.updatedBy) === localAuthorId() ? 'You' : node.updatedByName || 'Unknown';

  const sharedType = <T,>(read: (t: Typography) => T): Shared<T> =>
    shared((n) => read(typographyOf(n) ?? DEFAULT_TYPOGRAPHY));
  const weight = sharedType((t) => t.fontWeight ?? 400);
  const isBold = (weight.value ?? 400) >= 600;

  const sharedPaint = <T,>(read: (a: Appearance) => T): Shared<T> =>
    shared((n) => read(appearanceOf(n) ?? {}));

  const opacityShared = shared((n) => n.opacity);
  const rotationShared = shared((n) => n.rotation);

  return (
    <div className="custom-scrollbar" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', overflowX: 'hidden', userSelect: 'none', background: 'var(--surface-primary)', paddingBottom: '24px' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', borderBottom: '1px solid var(--border-divider)', background: 'var(--surface-elevated)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontWeight: 500 }}>
            {isMulti && !uniformType
              ? <LayoutTemplate size={16} color="var(--text-secondary)" />
              : TYPE_ICONS[node.type] ?? <LayoutTemplate size={16} color="var(--text-secondary)" />}
            <span style={{ textTransform: 'capitalize' }}>{selectionLabel(nodes)}</span>
          </div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!isMulti && (
              <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, color: 'var(--text-tertiary)', background: 'var(--surface-hover)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', letterSpacing: '0.04em', fontFamily: 'var(--font-mono, monospace)' }}>
                {node.id.slice(0, 4)}
              </span>
            )}
            {onCollapse && (
              <button
                className="btn-icon"
                style={{ padding: '4px' }}
                onClick={onCollapse}
                data-tooltip="Collapse panel"
                aria-label="Collapse the properties panel"
              >
                <PanelRightClose size={15} />
              </button>
            )}
          </span>
        </div>

        {activeEditors.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            <span style={{ position: 'relative', display: 'flex', height: '8px', width: '8px' }}>
              <span style={{ position: 'absolute', height: '100%', width: '100%', borderRadius: '50%', backgroundColor: activeEditors[0].color, opacity: 0.7, animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite' }} />
              <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '50%', height: '8px', width: '8px', backgroundColor: activeEditors[0].color }} />
            </span>
            {activeEditors[0].name} is editing
          </div>
        )}

        <div style={{ display: 'flex', background: 'var(--surface-hover)', padding: '2px', borderRadius: '6px', width: '100%', marginTop: '8px' }}>
          <button
            className="btn-icon btn-icon--sm" style={{ flex: 1 }}
            onClick={() => {
              const base = nextZIndex();
              const ordered = [...nodes].sort((a, b) => a.zIndex - b.zIndex);
              applyNodePatches(ordered.map((n, i) => ({ id: n.id, changes: { zIndex: base + i } })));
            }}
            data-tooltip="Bring to front"
            aria-label="Bring to front"
          ><BringToFront size={14} /></button>
          <button
            className="btn-icon btn-icon--sm" style={{ flex: 1 }}
            onClick={() => {
              const base = lowestZIndex() - nodes.length;
              const ordered = [...nodes].sort((a, b) => a.zIndex - b.zIndex);
              applyNodePatches(ordered.map((n, i) => ({ id: n.id, changes: { zIndex: base + i } })));
            }}
            data-tooltip="Send to back"
            aria-label="Send to back"
          ><SendToBack size={14} /></button>
          <div style={{ width: '1px', height: '20px', margin: 'auto 4px', background: 'var(--border-divider)' }} />
          <button
            className="btn-icon"
            style={{ flex: 1 }}
            onClick={() => patchEach((n) => ({ scaleX: -n.scaleX }))}
            data-tooltip="Flip horizontally"
            aria-label="Flip horizontally"
            aria-pressed={!flipped.mixedX && flipped.x}
          ><FlipHorizontal size={14} /></button>
          <button
            className="btn-icon"
            style={{ flex: 1 }}
            onClick={() => patchEach((n) => ({ scaleY: -n.scaleY }))}
            data-tooltip="Flip vertically"
            aria-label="Flip vertically"
            aria-pressed={!flipped.mixedY && flipped.y}
          ><FlipVertical size={14} /></button>
        </div>
      </div>

      {gridNode && (
        <Accordion title="Grid" icon={<LayoutGrid size={13} />} defaultOpen>
          <GridSection nodeId={gridNode.id} />
        </Accordion>
      )}

      {affords('sticky-theme') && node.type === 'sticky' && (
        <Accordion title="Note" icon={<StickyNote size={13} />}>
          {/*
            The eight papers, offered as themselves.

            This was a full RGB picker with `nearestTheme` run over whatever
            came back — sixteen million colours offered and eight honoured,
            silently snapping every choice to something nobody picked. A sticky
            has no free fill: the palette is eight paper-and-ink pairs, each ink
            a deep version of its own paper so the note reads as one material,
            and a control that shows a spectrum to make a one-of-eight decision
            is lying about what it does. The contextual rail has offered the
            papers directly for a while; the panel does now too.
          */}
          <Row label="Paper">
            <div className="sticky-papers" role="radiogroup" aria-label="Note colour">
              {STICKY_THEMES.map((id) => {
                const paper = THEMES[id];
                // Nothing reads as chosen across a mixed selection: two notes on
                // different papers have no one answer, and showing the first
                // one's as selected would claim they agreed.
                const active = !pickedTheme.mixed && pickedTheme.value === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={id}
                    data-tooltip={id[0].toUpperCase() + id.slice(1)}
                    className={`sticky-paper${active ? ' is-active' : ''}`}
                    style={{ background: paper.bg, borderColor: paper.edge, color: paper.text }}
                    onClick={() => {
                      set({ theme: id });
                      // The next note drawn takes the colour just chosen, which
                      // is what makes picking one feel like setting a default.
                      useStore.getState().setStickyTheme(id);
                    }}
                  >
                    Aa
                  </button>
                );
              })}
            </div>
          </Row>
          <Row label="Pinned" hint="A pinned note is held where it is and cannot be dragged. Everything else about it stays editable.">
            <input type="checkbox" checked={node.pinned} onChange={(e) => set({ pinned: e.target.checked })} />
          </Row>
          {!isMulti && <TagEditor tags={node.tags} onChange={(tags: string[]) => set({ tags })} />}
        </Accordion>
      )}

      <ConnectorSection
        node={node as ConnectorNode}
        affords={affords}
        shared={shared}
        set={set}
      />

      <ShapeGeometrySection
        node={node}
        uniformKind={uniformKind}
        openShape={openShape}
        affords={affords}
        shared={shared}
        setGeometry={setGeometry}
        setSafeArea={setSafeArea}
        applyFramePreset={applyFramePreset}
        turnFrame={turnFrame}
        fitFrameToContents={fitFrameToContents}
        frameChildCount={frameChildCount}
        setLayoutGuide={setLayoutGuide}
      />

      <ImageSection
        node={node as ImageNode}
        adjustments={adjustments}
        affords={affords}
        setAdjustment={setAdjustment}
        set={set}
      />

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
      />

      <FillAppearanceSection
        capabilities={capabilities}
        appearance={appearance ?? undefined}
        openShape={openShape}
        hasConnector={hasConnector}
        sharedPaint={sharedPaint}
        opacityShared={opacityShared}
        setAppearance={setAppearance}
        set={set}
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
      />

      {/* Between the paint and the effects, which is where it belongs: how the
          marks are made is a property of the drawing, not of the light on it. */}
      <SketchSection
        capabilities={capabilities}
        appearance={appearance ?? undefined}
        sketchable={sketchable}
        allClosed={allClosed}
        sharedPaint={sharedPaint}
        setAppearance={setAppearance}
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

      <TypographySection
        node={node}
        typography={typography}
        uniformType={uniformType}
        openShape={openShape}
        cycleKey={cycleKey}
        isBold={isBold}
        sharedType={sharedType}
        shared={shared}
        setTypography={setTypography}
        set={set}
        patchEach={patchEach}
        typographyOf={typographyOf}
      />

      <PhysicsMaterialSection
        nodes={nodes}
        node={node}
        set={set}
      />

      <MetadataSection
        node={node}
        isMulti={isMulti}
        createdByLabel={createdByLabel}
        updatedByLabel={updatedByLabel}
      />
    </div>
  );
};
