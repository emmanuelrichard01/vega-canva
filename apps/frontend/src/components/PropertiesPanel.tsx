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
  Sliders,
  StickyNote,
} from 'lucide-react';
import { applyNodePatches, localAuthorId, lowestZIndex, nextZIndex, provider, updateNodes } from '../engine/document';
import { useStore } from '../hooks/useStore';
import { APPEARANCE_TYPES } from '../engine/objects/appearanceTypes';
import { resolveAffordances, type AffordanceId } from '../engine/selection/affordances';
import { GridSection } from './panel/GridSection';
import { gridGroupOf } from '../engine/grid/gridGroupUtils';
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
  type StrokeStyleId,
} from '../engine/model/strokeStyle';
import { ColorPickerPopover } from './ui/ColorPickerPopover';
import { TagEditor } from './ui/TagEditor';
import { THEMES, nearestTheme } from '../engine/model/stickyThemes';
import { getColorForUser } from '../engine/presence/ColorPalette';
import { CYCLE_PRESETS } from '../engine/text/colorCycle';
import { packAdjustments, readAdjustments, type AdjustmentId } from '../engine/model/imageAdjustments';
import { Accordion, Row } from './panel/panelPrimitives';
import { TYPE_ICONS } from './panel/panelIcons';
import { TransformSection } from './panel/sections/TransformSection';
import { FillAppearanceSection } from './panel/sections/FillAppearanceSection';
import { StrokeSection } from './panel/sections/StrokeSection';
import { EffectsSection } from './panel/sections/EffectsSection';
import { TypographySection } from './panel/sections/TypographySection';
import { ShapeGeometrySection } from './panel/sections/ShapeGeometrySection';
import { ConnectorSection } from './panel/sections/ConnectorSection';
import { ImageSection } from './panel/sections/ImageSection';
import { PhysicsMaterialSection, MetadataSection } from './panel/sections/PhysicsMaterialSection';

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
  const groups = useStore((state) => state.groups);

  const nodes: AnyNode[] = useMemo(() => {
    if (!overrideObjects) return storeNodes;
    return selectedIds.map((id) => overrideObjects[id]).filter((n): n is AnyNode => Boolean(n));
  }, [overrideObjects, selectedIds, storeNodes]);

  const node: AnyNode | null = nodes[0] ?? null;
  const isMulti = nodes.length > 1;

  const shared = <T,>(read: (n: AnyNode) => T): Shared<T> => sharedValue(nodes, read);

  if (!node) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-primary)' }}>
        {onCollapse && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 12px' }}>
            <button
              className="btn-icon"
              style={{ padding: '4px' }}
              onClick={onCollapse}
              data-tooltip="Collapse panel"
              aria-label="Collapse the properties panel"
            >
              <PanelRightClose size={15} />
            </button>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-secondary)', gap: '12px', opacity: 0.7 }}>
          <Sliders size={28} />
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>Nothing selected</span>
        </div>
      </div>
    );
  }

  const selectedIdsPresent = nodes.map((n) => n.id);
  const gridGroup = gridGroupOf(nodes, groups);
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

  const hasCorners = nodes.every((n) => {
    const paint = appearanceOf(n);
    return n.type === 'path'
      ? n.geometry.kind !== 'freehand'
      : n.type === 'shape' &&
          (n.geometry.kind === 'polygon' ||
            n.geometry.kind === 'star' ||
            (n.geometry.kind === 'rect' && !(paint?.cornerRadius && paint.cornerRadius > 0)));
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

  const setGeometry = (patch: Record<string, unknown>) =>
    patchEach((n) => (n.type === 'shape' ? { geometry: { ...n.geometry, ...patch } } : null));

  const setConnectorLikeColor = (color: string) => {
    setStroke({ color });
    if (nodes.length > 0 && nodes.every((n) => n.type === 'connector')) {
      useStore.getState().setConnectorColor(color);
    }
  };

  const setStrokeStyle = (style: StrokeStyleId) =>
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
            dashFor(style, width)
          ),
        },
      };
    });

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
            className="btn-icon" style={{ flex: 1, padding: '6px' }}
            onClick={() => {
              const base = nextZIndex();
              const ordered = [...nodes].sort((a, b) => a.zIndex - b.zIndex);
              applyNodePatches(ordered.map((n, i) => ({ id: n.id, changes: { zIndex: base + i } })));
            }}
            data-tooltip="Bring to front"
            aria-label="Bring to front"
          ><BringToFront size={14} /></button>
          <button
            className="btn-icon" style={{ flex: 1, padding: '6px' }}
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
            style={{ flex: 1, padding: '6px' }}
            onClick={() => patchEach((n) => ({ scaleX: -n.scaleX }))}
            data-tooltip="Flip horizontally"
            aria-label="Flip horizontally"
            aria-pressed={!flipped.mixedX && flipped.x}
          ><FlipHorizontal size={14} /></button>
          <button
            className="btn-icon"
            style={{ flex: 1, padding: '6px' }}
            onClick={() => patchEach((n) => ({ scaleY: -n.scaleY }))}
            data-tooltip="Flip vertically"
            aria-label="Flip vertically"
            aria-pressed={!flipped.mixedY && flipped.y}
          ><FlipVertical size={14} /></button>
        </div>
      </div>

      {gridGroup && (
        <Accordion title="Grid" icon={<LayoutGrid size={13} />} defaultOpen>
          <GridSection groupId={gridGroup} />
        </Accordion>
      )}

      {affords('sticky-theme') && node.type === 'sticky' && (
        <Accordion title="Note" icon={<StickyNote size={13} />}>
          <Row label="Color">
            <ColorPickerPopover
              color={THEMES[node.theme]?.bg ?? '#FDE047'}
              onChange={(color) => {
                const theme = nearestTheme(color);
                set({ theme });
                useStore.getState().setStickyTheme(theme);
              }}
            />
          </Row>
          <Row label="Pinned" hint="A pinned note stays put when a layout is rearranged.">
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
        nudgeEach={nudgeEach}
        setConnectorLikeColor={setConnectorLikeColor}
      />

      <StrokeSection
        capabilities={capabilities}
        appearance={appearance ?? undefined}
        sketchable={sketchable}
        allClosed={allClosed}
        openShape={openShape}
        hasCorners={hasCorners}
        hasEnds={hasEnds}
        sharedPaint={sharedPaint}
        setStroke={setStroke}
        setStrokeStyle={setStrokeStyle}
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
