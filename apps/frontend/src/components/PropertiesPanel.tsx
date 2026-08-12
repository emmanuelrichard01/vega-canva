import React, { useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, BringToFront, CaseSensitive, ChevronDown, ChevronRight,
  FlipHorizontal, FlipVertical, ImageIcon, Italic, LayoutTemplate, Lock, MessageSquare,
  Mic, MoveHorizontal, MoveVertical, PenLine, SendToBack, Sliders, Square, StickyNote,
  Strikethrough, Type, Underline, Unlock,
} from 'lucide-react';
import { lowestZIndex, nextZIndex, provider, updateNode } from '../engine/document';
import { useStore } from '../hooks/useStore';
import { objectRegistry } from '../engine/objects';
import {
  BLEND_MODES,
  DEFAULT_MITER_LIMIT,
  DEFAULT_TYPOGRAPHY,
  MAX_MITER_LIMIT,
  MAX_POLYGON_SIDES,
  MAX_STAR_POINTS,
  MAX_STAR_RATIO,
  MIN_MITER_LIMIT,
  MIN_POLYGON_SIDES,
  MIN_STAR_POINTS,
  MIN_STAR_RATIO,
  isOpenShape,
  type AnyNode,
  type Appearance,
  type BlendMode,
  type LineJoin,
  type TextCase,
  type TextResize,
  type ShapeGeometry,
  type Shadow,
  type Stroke,
  type StrokeAlign,
  type TextAlign,
  type Typography,
} from '../engine/model/schema';
import {
  STROKE_STYLE_IDS,
  STROKE_STYLE_LABELS,
  buildStroke,
  dashFor,
  restyleForWidth,
  styleOf,
  type StrokeStyleId,
} from '../engine/model/strokeStyle';
import { ColorPickerPopover } from './ui/ColorPickerPopover';
import { EyedropperButton } from './ui/EyedropperButton';
import { FillEditor } from './ui/FillEditor';
import { NumberStepper } from './ui/NumberStepper';
import { FontSelector } from './ui/FontSelector';
import { SegmentedControl } from './ui/SegmentedControl';
import { Slider } from './ui/Slider';
import {
  ADJUSTMENT_IDS,
  ADJUSTMENT_LABELS,
  ADJUSTMENT_MIN,
  hasAdjustments,
  packAdjustments,
  readAdjustments,
  type AdjustmentId,
} from '../engine/model/imageAdjustments';
import { THEMES, nearestTheme } from './canvas/renderers/StickyRenderer';
import { MATERIALS, MATERIAL_IDS, resolveMaterial } from '../utils/behaviorSystem';
import { TagEditor } from './ui/TagEditor';

/**
 * Types that are simulated at all. Comments and frames are anchors — offering
 * them a material would imply a behaviour they deliberately do not have.
 */
const NON_PHYSICAL_TYPES = new Set(['comment', 'artboard', 'frame']);
const isPhysicalType = (type: string) => !NON_PHYSICAL_TYPES.has(type);

interface PropertiesPanelProps {
  selectedId: string | null;
  /** Time Travel replay snapshot, which replaces the live document while scrubbing. */
  overrideObjects?: Record<string, AnyNode> | null;
}

const Accordion: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = true }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-divider)' }}>
      <button
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left', width: '100%',
        }}
        className="hover-surface"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{title}</span>
        {isOpen ? <ChevronDown size={14} color="var(--text-secondary)" /> : <ChevronRight size={14} color="var(--text-secondary)" />}
      </button>
      {isOpen && <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>{children}</div>}
    </div>
  );
};

/**
 * A specimen of the stroke style, not a symbol for it.
 *
 * Three lucide glyphs would approximate a thing the control can simply show,
 * and 20px is enough room to draw the pattern itself. `currentColor` inherits
 * the segment's own active/inactive colour, so the specimen dims with its
 * label instead of sitting at full strength on an inactive segment.
 *
 * The numbers here are tuned for legibility at 20px and are deliberately *not*
 * the ones `dashFor` produces — that pattern is derived from the stroke's own
 * weight, which this 2px specimen does not have. At the real `[w*3, w*2]` only
 * two dashes fit in the icon, which reads as "two dashes" rather than as a
 * dashed line; three is the point where the eye sees a repeat. Dotted needs
 * its round cap for the same reason the real thing does — `0 gap` with a butt
 * cap draws nothing at all.
 */
const StrokeStyleIcon: React.FC<{ style: StrokeStyleId }> = ({ style }) => (
  <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" focusable="false">
    <line
      x1="1" y1="6" x2="19" y2="6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap={style === 'dotted' ? 'round' : 'butt'}
      strokeDasharray={style === 'solid' ? undefined : style === 'dotted' ? '0 4.5' : '4 3'}
      vectorEffect="non-scaling-stroke"
    />
  </svg>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
    {children}
  </div>
);

const TYPE_ICONS: Record<string, React.ReactNode> = {
  sticky: <StickyNote size={16} color="var(--text-secondary)" />,
  shape: <Square size={16} color="var(--text-secondary)" />,
  text: <Type size={16} color="var(--text-secondary)" />,
  image: <ImageIcon size={16} color="var(--text-secondary)" />,
  audio: <Mic size={16} color="var(--text-secondary)" />,
  path: <PenLine size={16} color="var(--text-secondary)" />,
  comment: <MessageSquare size={16} color="var(--text-secondary)" />,
};

/** Types that carry their own `typography` block. */
function typographyOf(node: AnyNode): Typography | null {
  if (node.type === 'text') return node.typography;
  if (node.type === 'shape') return node.typography ?? DEFAULT_TYPOGRAPHY;
  return null;
}

/**
 * Blend modes as people name them, not as a canvas does.
 *
 * The stored values are Canvas2D's, which are hyphenated and lower-case
 * because they are API identifiers. A menu is read, not parsed.
 */
const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  darken: 'Darken',
  multiply: 'Multiply',
  'color-burn': 'Color Burn',
  lighten: 'Lighten',
  screen: 'Screen',
  'color-dodge': 'Color Dodge',
  overlay: 'Overlay',
  'soft-light': 'Soft Light',
  'hard-light': 'Hard Light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

/**
 * The shadow a shape gets when you first switch one on.
 *
 * Visible immediately and not overpowering. A default of all zeroes would put
 * a control on screen that appears to do nothing until three more are moved,
 * which reads as the feature being broken.
 */
const DEFAULT_SHADOW: Shadow = {
  color: '#000000',
  blur: 12,
  offsetX: 0,
  offsetY: 4,
  spread: 0,
  opacity: 0.25,
};

/**
 * The inner shadow a shape gets when you first switch one on.
 *
 * Tighter and darker than the drop shadow's default: an inset shadow reads as
 * depth only when it hugs the edge, and the same 12px blur that lifts a card
 * off the page just fogs the inside of it.
 */
const DEFAULT_INNER_SHADOW: Shadow = {
  color: '#000000',
  blur: 8,
  offsetX: 0,
  offsetY: 2,
  spread: 0,
  opacity: 0.35,
};

/**
 * A specimen of the alignment, not a symbol for it.
 *
 * The same call the stroke-style control makes: three lucide glyphs would
 * approximate something 20px can simply show. The faint rectangle is the path
 * and the solid band is where the stroke actually lands relative to it —
 * which is the entire difference between the three options.
 */
const ALIGN_BAND: Record<'inside' | 'center' | 'outside', { x: number; y: number; w: number; h: number }> = {
  inside: { x: 4, y: 3, w: 12, h: 6 },
  center: { x: 3, y: 2, w: 14, h: 8 },
  outside: { x: 2, y: 1, w: 16, h: 10 },
};

const StrokeAlignIcon: React.FC<{ align: 'inside' | 'center' | 'outside' }> = ({ align }) => {
  const band = ALIGN_BAND[align];
  return (
    <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" focusable="false">
      {/* The path itself, always in the same place. */}
      <rect x="3" y="2" width="14" height="8" fill="none" stroke="currentColor" strokeOpacity="0.3" />
      <rect
        x={band.x}
        y={band.y}
        width={band.w}
        height={band.h}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
};

/**
 * A specimen of the join, drawn at the corner it describes.
 *
 * The same call as the alignment icon: a mitred corner, a rounded one and a
 * cut one are three shapes, and showing them is more direct than naming them.
 * Drawn thick, because at a hairline all three corners look identical — which
 * is also true on the canvas, and part of why the control needs a preview.
 */
const StrokeJoinIcon: React.FC<{ join: LineJoin }> = ({ join }) => (
  <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" focusable="false">
    <path
      d="M 3 11 L 3 4 L 17 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinejoin={join}
      strokeLinecap="butt"
      // A sharp corner needs room to run past itself before the limit cuts it;
      // the default of 10 is far more than a right angle uses.
      strokeMiterlimit={10}
    />
  </svg>
);

/** The four safe-area edges, in the order a CSS inset is written. */
const SAFE_EDGES = [
  { key: 'top', label: 'T' },
  { key: 'right', label: 'R' },
  { key: 'bottom', label: 'B' },
  { key: 'left', label: 'L' },
] as const;

/**
 * Types that carry an `appearance` block.
 *
 * A list rather than `'appearance' in node`, which asks whether the key is
 * *present* — and on a type where the field is optional it is absent until
 * something writes it. Text is exactly that case, so the key check meant a
 * text node could never be given its first shadow: the Appearance section
 * would not render until the value it sets already existed.
 */
const APPEARANCE_TYPES = new Set(['shape', 'path', 'image', 'frame', 'text']);

function appearanceOf(node: AnyNode): Appearance | null {
  if (!APPEARANCE_TYPES.has(node.type)) return null;
  return (node as { appearance?: Appearance }).appearance ?? {};
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ selectedId, overrideObjects }) => {
  const storeObj = useStore((state) => (selectedId ? state.objects[selectedId] : null));
  const [aspectLocked, setAspectLocked] = useState(false);

  const node: AnyNode | null = (overrideObjects && selectedId ? overrideObjects[selectedId] : storeObj) ?? null;

  if (!node || !selectedId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', gap: '12px', opacity: 0.7, marginTop: '120px' }}>
        <Sliders size={28} />
        <span style={{ fontSize: '14px', fontWeight: 500 }}>Select an object</span>
      </div>
    );
  }

  const capabilities = objectRegistry.get(node.type)?.capabilities ?? {};
  const typography = typographyOf(node);
  const appearance = appearanceOf(node);

  /**
   * A line or an arrow: no interior, so no fill, no corner radius, and none of
   * the effects that clip to one. Read once here rather than repeated as
   * `node.geometry.kind === 'line' || ...` at seven call sites.
   */
  const openShape = node.type === 'shape' && isOpenShape(node.geometry.kind);
  /**
   * Whether this object's outline has a corner for a join to apply to.
   *
   * An ellipse has none, a fully rounded rectangle has none left, and a line
   * is two points with nothing in between them to meet at. Offering the
   * control on those is offering a control that provably cannot change the
   * pixels — the same failure as one the renderer ignores, arrived at from
   * the other direction.
   */
  const hasCorners =
    node.type === 'path'
      ? node.geometry.kind !== 'freehand'
      : node.type === 'shape' &&
        (node.geometry.kind === 'polygon' ||
          node.geometry.kind === 'star' ||
          (node.geometry.kind === 'rect' && !(appearance?.cornerRadius && appearance.cornerRadius > 0)));

  const set = (updates: Partial<AnyNode>) => updateNode(selectedId, updates as Record<string, unknown>);
  const setAppearance = (patch: Partial<Appearance>) =>
    set({ appearance: { ...(appearance ?? {}), ...patch } } as Partial<AnyNode>);
  const setTypography = (patch: Partial<Typography>) =>
    set({ typography: { ...(typography ?? DEFAULT_TYPOGRAPHY), ...patch } } as Partial<AnyNode>);

  /**
   * Write the stroke, keeping its dash pattern proportional to its weight.
   *
   * A dash array is absolute, so a pattern authored at 1px closes up into a
   * near-solid line by the time the stroke is 12px. Re-deriving on every write
   * means the *style* is what persists, which is what someone who picked
   * "Dashed" actually chose. `buildStroke` omits the dash keys entirely for a
   * solid stroke rather than writing `undefined` into a nested value.
   */
  const setStroke = (patch: Partial<Pick<Stroke, 'color' | 'width' | 'align' | 'join' | 'miterLimit'>>) => {
    const current = appearance?.stroke;
    const color = patch.color ?? current?.color ?? '#000000';
    const width = patch.width ?? current?.width ?? 2;
    const align = patch.align ?? current?.align;
    const join = patch.join ?? current?.join;
    const miterLimit = patch.miterLimit ?? current?.miterLimit;
    setAppearance({
      stroke: buildStroke({ color, width, align, join, miterLimit }, restyleForWidth(current, width)),
    });
  };

  /**
   * The image's adjustments, read through the same clamp the renderer uses.
   *
   * `packAdjustments` strips anything back at 0 rather than storing it, so a
   * slider nudged and returned leaves no trace — and `filters` stays a reliable
   * answer to "has this image been adjusted at all", which is what keeps an
   * untouched image out of Konva's cache.
   */
  const adjustments = readAdjustments(node.type === 'image' ? node.filters : undefined);
  const setAdjustment = (id: AdjustmentId, value: number) => {
    set({ filters: packAdjustments({ ...adjustments, [id]: value }) } as Partial<AnyNode>);
  };

  /**
   * Patch one edge of a frame's safe area.
   *
   * Four zeroes are stored as no safe area at all, matching the normalizer:
   * "has a guide" stays a question about one field rather than about four
   * numbers, and clearing the last edge removes the guide rather than leaving
   * a collapsed rectangle behind.
   */
  /**
   * Patch the shadow, keeping the rest of it.
   *
   * `updateNode` replaces the whole `appearance.shadow` value, so a patch that
   * omitted `blur` would erase it — the same trap `setAppearance` and
   * `setGeometry` document.
   */
  const setShadow = (patch: Partial<Shadow>) => {
    const current = appearance?.shadow ?? DEFAULT_SHADOW;
    setAppearance({ shadow: { ...current, ...patch } });
  };

  const setInnerShadow = (patch: Partial<Shadow>) => {
    const current = appearance?.innerShadow ?? DEFAULT_INNER_SHADOW;
    setAppearance({ innerShadow: { ...current, ...patch } });
  };

  const setSafeArea = (edge: 'top' | 'right' | 'bottom' | 'left', value: number) => {
    if (node.type !== 'frame') return;
    const current = node.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const next = { ...current, [edge]: Math.max(0, value) };
    const empty = !next.top && !next.right && !next.bottom && !next.left;
    set({ safeArea: empty ? undefined : next } as Partial<AnyNode>);
  };

  /**
   * Patch a shape's geometry, preserving `kind`.
   *
   * `updateNode` replaces the whole `geometry` value, so a patch that omitted
   * `kind` would turn a star into a rect — the same trap `setAppearance` has.
   */
  const setGeometry = (patch: Partial<ShapeGeometry>) => {
    if (node.type !== 'shape') return;
    set({ geometry: { ...node.geometry, ...patch } } as Partial<AnyNode>);
  };

  const setStrokeStyle = (style: StrokeStyleId) => {
    const current = appearance?.stroke;
    const color = current?.color ?? '#000000';
    // Picking a dash on a shape with no outline yet is a request for an
    // outline — a control that visibly changes nothing is worse than no
    // control, and a 0-width stroke is exactly that.
    const width = current?.width && current.width > 0 ? current.width : 2;
    setAppearance({ stroke: buildStroke({ color, width, align: current?.align }, dashFor(style, width)) });
  };

  // Resizing writes width/height only. There is no second copy of the size to
  // keep in step any more — this used to fan a single edit out to `width`,
  // `content.width` and `geometry.width` and hope they stayed consistent.
  const setWidth = (width: number) => {
    const height = aspectLocked && node.width > 0 ? Math.round(width * (node.height / node.width)) : node.height;
    set({ width: Math.max(1, width), height: Math.max(1, height) });
  };
  const setHeight = (height: number) => {
    const width = aspectLocked && node.height > 0 ? Math.round(height * (node.width / node.height)) : node.width;
    set({ width: Math.max(1, width), height: Math.max(1, height) });
  };

  const awarenessStates = provider.awareness?.getStates();
  const myClientId = provider.awareness?.clientID;
  const activeEditors: Array<{ name: string; color: string }> = [];
  (awarenessStates ?? new Map()).forEach((state: any, clientId: number) => {
    if (clientId !== myClientId && state.user && Array.isArray(state.selection) && state.selection.includes(selectedId)) {
      activeEditors.push({ name: state.user.name || 'Teammate', color: state.user.color || '#EC4899' });
    }
  });

  // Authorship is denormalised onto the node at creation, so it survives the
  // author disconnecting. This used to resolve a bare client id against the
  // live awareness roster and fall back to "Unknown" for anyone who had left.
  const createdByLabel =
    String(node.createdBy) === String(myClientId) ? 'You' : node.createdByName || 'Unknown';

  const isBold = (typography?.fontWeight ?? 400) >= 600;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', userSelect: 'none', background: 'var(--surface-primary)', paddingBottom: '24px' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', borderBottom: '1px solid var(--border-divider)', background: 'var(--surface-elevated)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontWeight: 500 }}>
            {TYPE_ICONS[node.type] ?? <LayoutTemplate size={16} color="var(--text-secondary)" />}
            <span style={{ textTransform: 'capitalize' }}>{node.type}</span>
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', background: 'var(--surface-hover)', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', fontFamily: 'monospace' }}>
            {node.id.slice(0, 4)}
          </span>
        </div>

        {activeEditors.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-secondary)' }}>
            <span style={{ position: 'relative', display: 'flex', height: '8px', width: '8px' }}>
              <span style={{ position: 'absolute', height: '100%', width: '100%', borderRadius: '50%', backgroundColor: activeEditors[0].color, opacity: 0.7, animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite' }} />
              <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '50%', height: '8px', width: '8px', backgroundColor: activeEditors[0].color }} />
            </span>
            {activeEditors[0].name} is editing
          </div>
        )}

        <div style={{ display: 'flex', background: 'var(--surface-hover)', padding: '2px', borderRadius: '6px', width: '100%', marginTop: '8px' }}>
          <button className="btn-icon" style={{ flex: 1, padding: '6px' }} onClick={() => set({ zIndex: nextZIndex() })} title="Bring to Front"><BringToFront size={14} /></button>
          <button className="btn-icon" style={{ flex: 1, padding: '6px' }} onClick={() => set({ zIndex: lowestZIndex() - 1 })} title="Send to Back"><SendToBack size={14} /></button>
          <div style={{ width: '1px', height: '20px', margin: 'auto 4px', background: 'var(--border-divider)' }} />
          <button className="btn-icon" style={{ flex: 1, padding: '6px' }} onClick={() => set({ scaleX: -node.scaleX })} title="Flip Horizontal"><FlipHorizontal size={14} /></button>
          <button className="btn-icon" style={{ flex: 1, padding: '6px' }} onClick={() => set({ scaleY: -node.scaleY })} title="Flip Vertical"><FlipVertical size={14} /></button>
        </div>
      </div>

      <Accordion title="Transform">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <NumberStepper value={Math.round(node.x)} onChange={(v) => set({ x: v })} label="X" />
          <NumberStepper value={Math.round(node.y)} onChange={(v) => set({ y: v })} label="Y" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <NumberStepper value={Math.round(node.width)} onChange={setWidth} label="W" min={1} />
          </div>
          <button
            className="btn-icon"
            onClick={() => setAspectLocked((v) => !v)}
            data-tooltip={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            aria-pressed={aspectLocked}
            style={{
              padding: '6px', marginTop: '10px', borderRadius: '4px', flexShrink: 0,
              color: aspectLocked ? 'var(--text-primary)' : 'var(--text-tertiary)',
              background: aspectLocked ? 'var(--surface-hover)' : 'transparent',
            }}
          >
            {aspectLocked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <NumberStepper value={Math.round(node.height)} onChange={setHeight} label="H" min={1} />
          </div>
        </div>
        <div style={{ marginTop: '8px' }}>
          <NumberStepper value={Math.round(node.rotation)} onChange={(v) => set({ rotation: v })} label="R" step={15} />
        </div>
      </Accordion>

      {(capabilities.supportsFill || capabilities.supportsOpacity || capabilities.supportsRadius) && (
        <Accordion title="Appearance">
          {capabilities.supportsFill && appearance && !openShape && (
            <Row label="Fill">
              <FillEditor
                paint={appearance.fill?.[0]}
                onChange={(fill) => setAppearance({ fill: [fill] })}
              />
            </Row>
          )}
          {capabilities.supportsRadius && (node.type !== 'shape' || node.geometry.kind === 'rect') && !openShape && (
            <Row label="Corner Radius">
              <NumberStepper
                value={appearance?.cornerRadius ?? 0}
                onChange={(v) => setAppearance({ cornerRadius: v })}
                min={0} max={200}
              />
            </Row>
          )}
          {capabilities.supportsOpacity && (
            <Row label="Opacity">
              <NumberStepper value={Math.round(node.opacity * 100)} onChange={(v) => set({ opacity: v / 100 })} min={0} max={100} step={10} />
            </Row>
          )}
          {/* Blend mode and layer blur sit with the rest of the paint because
              that is what they are: how the object looks against what is
              behind it. Offered wherever `appearance` exists, because
              `ObjectRenderer` applies both to the whole node group and not to
              one shape inside it — so they work on an image and a path exactly
              as they work on a rectangle. */}
          {appearance && (
            <Row label="Blend">
              <select
                className="prop-select"
                value={appearance.blendMode ?? 'normal'}
                onChange={(e) =>
                  setAppearance({
                    // `normal` is stored as absent, matching the normalizer:
                    // the common case costs nothing and "has a blend mode"
                    // stays a question about presence.
                    blendMode: e.target.value === 'normal' ? undefined : (e.target.value as BlendMode),
                  })
                }
              >
                {BLEND_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {BLEND_LABELS[mode]}
                  </option>
                ))}
              </select>
            </Row>
          )}
          {appearance && (
            <Row label="Layer Blur">
              <NumberStepper
                value={Math.round(appearance.blur ?? 0)}
                onChange={(v) => setAppearance({ blur: v > 0 ? v : undefined })}
                min={0}
                max={100}
                step={2}
              />
            </Row>
          )}
          {/* Frosted glass: the board blurred *behind* the shape rather than
              the shape blurred itself. Only visible through a fill that is not
              fully opaque, which is why it sits next to Opacity. Offered where
              the renderer can clip to an outline, same as the other edge
              effects. */}
          {capabilities.supportsEdgeEffects && appearance && !openShape && (
            <Row label="Backdrop Blur">
              <NumberStepper
                value={Math.round(appearance.backdropBlur ?? 0)}
                onChange={(v) => setAppearance({ backdropBlur: v > 0 ? v : undefined })}
                min={0}
                max={100}
                step={2}
              />
            </Row>
          )}
        </Accordion>
      )}

      {/* Image adjustments. `filters` sat on the schema for the project's
          whole life and `ImageRenderer` read four properties, none of them
          this — so a stored adjustment was silently ignored. */}
      {node.type === 'image' && (
        <Accordion title="Adjust">
          {ADJUSTMENT_IDS.map((id) => (
            <Slider
              key={id}
              label={ADJUSTMENT_LABELS[id]}
              value={adjustments[id]}
              min={ADJUSTMENT_MIN[id]}
              max={100}
              /* Blur runs from zero, so its fill starts at the left like a
                 quantity. The other three are departures from "as shot" and
                 fill outward from the middle. */
              origin={0}
              onChange={(v) => setAdjustment(id, v)}
            />
          ))}
          {hasAdjustments(adjustments) && (
            <button
              type="button"
              className="adjustments__reset"
              onClick={() => set({ filters: undefined } as Partial<AnyNode>)}
            >
              Reset adjustments
            </button>
          )}
        </Accordion>
      )}

      {/* Star geometry. The renderer has always honoured `points` and
          `innerRatio` and nothing has ever set them, so every star in every
          document has been five-pointed at half depth. */}
      {node.type === 'shape' && node.geometry.kind === 'star' && (
        <Accordion title="Star">
          <Row label="Points">
            <NumberStepper
              value={node.geometry.points ?? 5}
              onChange={(points) => setGeometry({ points })}
              min={MIN_STAR_POINTS}
              max={MAX_STAR_POINTS}
            />
          </Row>
          <Row label="Depth">
            {/* Stored as a fraction of the outer radius; shown as a
                percentage, because "0.35" is not a quantity anyone has an
                intuition for. Inverted so that more depth means spikier: the
                stored value is an inner *radius*, where a bigger number is a
                blunter star, and a control that gets sharper as you turn it
                down is one nobody predicts. */}
            <NumberStepper
              value={Math.round((1 - (node.geometry.innerRatio ?? 0.5)) * 100)}
              onChange={(depth) => setGeometry({ innerRatio: 1 - depth / 100 })}
              min={Math.round((1 - MAX_STAR_RATIO) * 100)}
              max={Math.round((1 - MIN_STAR_RATIO) * 100)}
              step={5}
            />
          </Row>
        </Accordion>
      )}

      {/* The safe area, for the frame sizes where part of the rectangle is
          covered by something that is not yours. Seeded from the preset and
          editable here, because the presets can only cover the cases that are
          the same for everyone — a slide deck's own template, or a printer
          with a wider margin than most, is a number only the person making it
          knows. Four edges rather than one: a story's insets are not
          symmetrical, and forcing them to be would waste 320 units of width to
          protect against nothing. */}
      {node.type === 'frame' && (
        <Accordion title="Safe Area" defaultOpen={Boolean(node.safeArea)}>
          {/* Two by two, not four across: a stepper is a label, a value and
              two buttons, and four of them in a 230px panel leaves no room for
              the number — which is the only part anyone reads. The X/Y row
              above already settled on two per line. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {SAFE_EDGES.map(({ key, label }) => (
              <NumberStepper
                key={key}
                value={Math.round(node.safeArea?.[key] ?? 0)}
                onChange={(v) => setSafeArea(key, v)}
                label={label}
                min={0}
                step={8}
              />
            ))}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
            A guide only. Nothing is clipped or moved, and it never appears in an export.
          </p>
        </Accordion>
      )}

      {/* Shadow. `Appearance.shadow` was on the schema from the first commit,
          read and written by the normalizer, declared as a capability by five
          types — and rendered by nothing. There has never been a control for
          it either, which is presumably how it stayed invisible for so long. */}
      {capabilities.supportsShadow && appearance && (
        <Accordion title="Shadow" defaultOpen={Boolean(appearance.shadow)}>
          <Row label="Enabled">
            <input
              type="checkbox"
              checked={Boolean(appearance.shadow)}
              onChange={(e) =>
                setAppearance({ shadow: e.target.checked ? { ...DEFAULT_SHADOW } : undefined })
              }
              aria-label="Drop shadow"
            />
          </Row>
          {appearance.shadow && (
            <>
              <Row label="Color">
                <ColorPickerPopover
                  color={appearance.shadow.color}
                  onChange={(color) => setShadow({ color })}
                />
              </Row>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <NumberStepper
                  value={Math.round(appearance.shadow.offsetX)}
                  onChange={(v) => setShadow({ offsetX: v })}
                  label="X"
                />
                <NumberStepper
                  value={Math.round(appearance.shadow.offsetY)}
                  onChange={(v) => setShadow({ offsetY: v })}
                  label="Y"
                />
              </div>
              <Row label="Blur">
                <NumberStepper
                  value={Math.round(appearance.shadow.blur)}
                  onChange={(v) => setShadow({ blur: v })}
                  min={0}
                  max={200}
                />
              </Row>
              {/* Spread grows the shadow's silhouette by stroking the same
                  path, which needs a shape a stroke can grow — not a pen path
                  that is already stroked, nor glyphs a stroke would fatten. */}
              {capabilities.supportsShadowSpread && !openShape && (
                <Row label="Spread">
                  <NumberStepper
                    value={Math.round(appearance.shadow.spread ?? 0)}
                    onChange={(v) => setShadow({ spread: v })}
                    min={0}
                    max={100}
                  />
                </Row>
              )}
              <Row label="Opacity">
                <NumberStepper
                  value={Math.round((appearance.shadow.opacity ?? 1) * 100)}
                  onChange={(v) => setShadow({ opacity: v / 100 })}
                  min={0}
                  max={100}
                  step={10}
                />
              </Row>
            </>
          )}
        </Accordion>
      )}

      {/* One number, one control. `triangle` and `hexagon` used to be separate
          shape kinds, which is two hard-coded side counts where the
          specification asks for any of them. */}
      {node.type === 'shape' && node.geometry.kind === 'polygon' && (
        <Accordion title="Polygon">
          <Row label="Sides">
            <NumberStepper
              value={node.geometry.points ?? 3}
              onChange={(points) => setGeometry({ points })}
              min={MIN_POLYGON_SIDES}
              max={MAX_POLYGON_SIDES}
            />
          </Row>
        </Accordion>
      )}

      {/* A line and an arrow are the same shape with different ends, so the
          heads are a property rather than a second kind — turning one on makes
          a line an arrow without changing what the object is. */}
      {node.type === 'shape' && openShape && (
        <Accordion title="Ends">
          <Row label="Start">
            <input
              type="checkbox"
              checked={node.geometry.arrowStart ?? false}
              onChange={(e) => setGeometry({ arrowStart: e.target.checked })}
              aria-label="Arrowhead at the start"
            />
          </Row>
          <Row label="End">
            <input
              type="checkbox"
              checked={node.geometry.arrowEnd ?? false}
              onChange={(e) => setGeometry({ arrowEnd: e.target.checked })}
              aria-label="Arrowhead at the end"
            />
          </Row>
        </Accordion>
      )}

      {capabilities.supportsStroke && appearance && (
        <Accordion title="Stroke">
          <Row label="Color">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <ColorPickerPopover
                color={appearance.stroke?.color ?? 'transparent'}
                onChange={(color) => setStroke({ color })}
              />
              <EyedropperButton
                label="Pick a stroke colour from the screen"
                onPick={(color) => setStroke({ color })}
              />
            </div>
          </Row>
          <Row label="Width">
            <NumberStepper
              value={appearance.stroke?.width ?? 0}
              /* The dash pattern is re-derived from the new weight, so a
                 dashed line stays visibly dashed instead of closing up into a
                 near-solid one as it gets thicker. */
              onChange={(width) => setStroke({ width })}
              min={0} max={100}
            />
          </Row>
          <Row label="Style">
            <SegmentedControl
              ariaLabel="Stroke style"
              value={styleOf(appearance.stroke)}
              onChange={(id) => setStrokeStyle(id as StrokeStyleId)}
              segments={STROKE_STYLE_IDS.map((id) => ({
                value: id,
                label: STROKE_STYLE_LABELS[id],
                icon: <StrokeStyleIcon style={id} />,
              }))}
            />
          </Row>
          {/* Where the line sits on the path. A canvas only draws centred, so
              inside and outside are a double-weight stroke clipped to one
              side — which needs an outline, and is why this is offered on
              shapes and not on a pencil blob whose path is already the
              outline of its own stroke. */}
          {capabilities.supportsEdgeEffects && !openShape && (
            <Row label="Align">
              <SegmentedControl
                ariaLabel="Stroke alignment"
                value={appearance.stroke?.align ?? 'center'}
                onChange={(align) => setStroke({ align: align as StrokeAlign })}
                segments={[
                  { value: 'inside', label: 'Inside', icon: <StrokeAlignIcon align="inside" /> },
                  { value: 'center', label: 'Center', icon: <StrokeAlignIcon align="center" /> },
                  { value: 'outside', label: 'Outside', icon: <StrokeAlignIcon align="outside" /> },
                ]}
              />
            </Row>
          )}
          {/* How two segments meet. Only a shape with corners has any, so it
              is not offered on an ellipse — a control that provably cannot
              change anything about the selected object is the same mistake as
              one the renderer ignores. */}
          {hasCorners && (
            <Row label="Join">
              <SegmentedControl
                ariaLabel="Line join"
                value={appearance.stroke?.join ?? 'miter'}
                onChange={(join) => setStroke({ join: join as LineJoin })}
                segments={[
                  { value: 'miter', label: 'Miter', icon: <StrokeJoinIcon join="miter" /> },
                  { value: 'round', label: 'Round', icon: <StrokeJoinIcon join="round" /> },
                  { value: 'bevel', label: 'Bevel', icon: <StrokeJoinIcon join="bevel" /> },
                ]}
              />
            </Row>
          )}
          {/* The cutoff, shown only while the join is a miter — it is the only
              join that has one, and a slider that does nothing beside a
              control that just disabled it reads as a bug. */}
          {hasCorners && (appearance.stroke?.join ?? 'miter') === 'miter' && (
            <Row label="Miter limit">
              <NumberStepper
                value={appearance.stroke?.miterLimit ?? DEFAULT_MITER_LIMIT}
                onChange={(miterLimit) => setStroke({ miterLimit })}
                min={MIN_MITER_LIMIT}
                max={MAX_MITER_LIMIT}
              />
            </Row>
          )}
        </Accordion>
      )}

      {/* Inner shadow. Its own section rather than a flag on Shadow, because
          an object can want both: a card raised off the page and inset at its
          own edges is an ordinary thing to draw. */}
      {capabilities.supportsEdgeEffects && appearance && !openShape && (
        <Accordion title="Inner Shadow" defaultOpen={Boolean(appearance.innerShadow)}>
          <Row label="Enabled">
            <input
              type="checkbox"
              checked={Boolean(appearance.innerShadow)}
              onChange={(e) =>
                setAppearance({ innerShadow: e.target.checked ? { ...DEFAULT_INNER_SHADOW } : undefined })
              }
              aria-label="Inner shadow"
            />
          </Row>
          {appearance.innerShadow && (
            <>
              <Row label="Color">
                <ColorPickerPopover
                  color={appearance.innerShadow.color}
                  onChange={(color) => setInnerShadow({ color })}
                />
              </Row>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <NumberStepper
                  value={Math.round(appearance.innerShadow.offsetX)}
                  onChange={(v) => setInnerShadow({ offsetX: v })}
                  label="X"
                />
                <NumberStepper
                  value={Math.round(appearance.innerShadow.offsetY)}
                  onChange={(v) => setInnerShadow({ offsetY: v })}
                  label="Y"
                />
              </div>
              <Row label="Blur">
                <NumberStepper
                  value={Math.round(appearance.innerShadow.blur)}
                  onChange={(v) => setInnerShadow({ blur: v })}
                  min={0}
                  max={200}
                />
              </Row>
              <Row label="Spread">
                <NumberStepper
                  value={Math.round(appearance.innerShadow.spread ?? 0)}
                  onChange={(v) => setInnerShadow({ spread: v })}
                  min={0}
                  max={100}
                />
              </Row>
              <Row label="Opacity">
                <NumberStepper
                  value={Math.round((appearance.innerShadow.opacity ?? 1) * 100)}
                  onChange={(v) => setInnerShadow({ opacity: v / 100 })}
                  min={0}
                  max={100}
                  step={10}
                />
              </Row>
            </>
          )}
        </Accordion>
      )}

      {capabilities.supportsTypography && typography && (
        <Accordion title="Typography">
          <FontSelector value={typography.fontFamily} onChange={(fontFamily) => setTypography({ fontFamily })} />
          <Row label="Size">
            <NumberStepper value={typography.fontSize} onChange={(fontSize) => setTypography({ fontSize })} min={8} max={500} />
          </Row>
          <Row label="Color">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <ColorPickerPopover color={typography.color} onChange={(color) => setTypography({ color })} />
              <EyedropperButton
                label="Pick a text colour from the screen"
                onPick={(color) => setTypography({ color })}
              />
            </div>
          </Row>
          <Row label="Style">
            <div style={{ display: 'flex', background: 'var(--surface-hover)', padding: '2px', borderRadius: '6px' }}>
              {/* These write the same canonical fields Cmd+B/I/U do, and the
                  renderer composes Konva's fontStyle from them in one place. */}
              <ToggleButton active={isBold} onClick={() => setTypography({ fontWeight: isBold ? 400 : 700 })} label="Bold"><Bold size={14} /></ToggleButton>
              <ToggleButton active={typography.italic} onClick={() => setTypography({ italic: !typography.italic })} label="Italic"><Italic size={14} /></ToggleButton>
              <ToggleButton active={typography.underline} onClick={() => setTypography({ underline: !typography.underline })} label="Underline"><Underline size={14} /></ToggleButton>
              {/* Its own flag rather than sharing one with the underline:
                  Canvas2D and SVG both draw a run with both at once, and a
                  single-valued field would make them exclusive for no reason
                  but its own shape. */}
              <ToggleButton active={typography.strikethrough} onClick={() => setTypography({ strikethrough: !typography.strikethrough })} label="Strikethrough"><Strikethrough size={14} /></ToggleButton>
            </div>
          </Row>
          {/* A case shown, not typed. The stored string is never rewritten, so
              switching to upper case and back returns what was written rather
              than a shouted version of it. */}
          <Row label="Case">
            <SegmentedControl
              ariaLabel="Text case"
              value={typography.textCase ?? 'none'}
              onChange={(v) => setTypography({ textCase: v === 'none' ? undefined : (v as TextCase) })}
              segments={[
                { value: 'none', label: 'As typed', icon: <span style={{ fontSize: 11, fontWeight: 600 }}>Ag</span> },
                { value: 'upper', label: 'Upper case', icon: <span style={{ fontSize: 11, fontWeight: 600 }}>AG</span> },
                { value: 'lower', label: 'Lower case', icon: <span style={{ fontSize: 11, fontWeight: 600 }}>ag</span> },
                { value: 'title', label: 'Title Case', icon: <CaseSensitive size={14} /> },
              ]}
            />
          </Row>
          <Row label="Alignment">
            <SegmentedControl
              value={typography.align}
              onChange={(v) => setTypography({ align: v as TextAlign })}
              segments={[
                { value: 'left', icon: <AlignLeft size={14} /> },
                { value: 'center', icon: <AlignCenter size={14} /> },
                { value: 'right', icon: <AlignRight size={14} /> },
              ]}
            />
          </Row>
          <Row label="Line Height">
            <NumberStepper value={typography.lineHeight} onChange={(lineHeight) => setTypography({ lineHeight })} min={0.5} max={3} step={0.1} />
          </Row>
          <Row label="Spacing">
            <NumberStepper value={typography.letterSpacing} onChange={(letterSpacing) => setTypography({ letterSpacing })} min={-10} max={50} step={1} />
          </Row>
          {/* Which of the box's dimensions follow the words. Replaces
              `autoHeight`, which was written by the normalizer and the text
              tool and read by nothing — and could only express two of these
              three, which is part of why nothing ever consumed it. */}
          {node.type === 'text' && (
            <Row label="Resize">
              <SegmentedControl
                ariaLabel="Text box resizing"
                value={node.resize}
                onChange={(v) => set({ resize: v as TextResize } as Partial<AnyNode>)}
                segments={[
                  { value: 'width', label: 'Auto width — the box is as wide as the longest line', icon: <MoveHorizontal size={14} /> },
                  { value: 'height', label: 'Auto height — wraps at this width and grows down', icon: <MoveVertical size={14} /> },
                  { value: 'fixed', label: 'Fixed — overflow is truncated', icon: <Square size={14} /> },
                ]}
              />
            </Row>
          )}
        </Accordion>
      )}

      {node.type === 'sticky' && (
        <Accordion title="Sticky Note">
          <Row label="Color">
            <ColorPickerPopover
              // A sticky's colour is a named theme on the node, not a paint.
              // This used to write `appearance.fill`, which the sticky renderer
              // never reads — so recolouring a sticky here did nothing at all.
              color={THEMES[node.theme]?.bg ?? '#FDE047'}
              onChange={(color) => set({ theme: nearestTheme(color) })}
            />
          </Row>
          {/* "Text Size" used to live here. It set a `fontSize` that nothing
              reads any more: the type is fitted to the note so the words
              always fit, which is a promise a manual size cannot keep. See
              `engine/model/stickyText.ts`. */}
          <Row label="Pinned">
            <input type="checkbox" checked={node.pinned} onChange={(e) => set({ pinned: e.target.checked })} />
          </Row>
          <TagEditor tags={node.tags} onChange={(tags: string[]) => set({ tags })} />
        </Accordion>
      )}

      {/* What the object is made of, and therefore how it moves under force.
          The material profiles have always driven the simulation but were keyed
          to node type and invisible — an audio note was bouncy and nobody could
          see why, or make a sticky heavy. */}
      {isPhysicalType(node.type) && (
        <Accordion title="Physics">
          {/* Full width rather than squeezed into a label/control row: five
              named choices need the space, and the description below changes
              with the selection so you can tell what you are picking before
              you throw anything. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <label
              htmlFor="material-select"
              style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}
            >
              Material
            </label>
            <select
              id="material-select"
              value={resolveMaterial(node).id}
              onChange={(e) => set({ material: e.target.value } as Partial<AnyNode>)}
              style={{
                width: '100%',
                background: 'var(--surface-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-divider)',
                borderRadius: 'var(--radius-md)',
                padding: '6px 8px',
                fontSize: 'var(--text-sm)',
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
              }}
            >
              {MATERIAL_IDS.map((id) => (
                <option key={id} value={id}>{MATERIALS[id].label}</option>
              ))}
            </select>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
              {resolveMaterial(node).hint}
            </p>
          </div>
        </Accordion>
      )}

      <Accordion title="Metadata" defaultOpen={false}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <Row label="ID">
            <span style={{ fontFamily: 'monospace', background: 'var(--surface-hover)', padding: '2px 4px', borderRadius: '4px' }}>{node.id.slice(0, 8)}</span>
          </Row>
          <Row label="Created"><span>{new Date(node.createdAt).toLocaleString()}</span></Row>
          {/* Now genuinely updated — the document layer stamps updatedAt on
              every write, where before nothing ever set it after creation and
              this always displayed the creation date. */}
          <Row label="Updated"><span>{new Date(node.updatedAt).toLocaleString()}</span></Row>
          <Row label="Author"><span>{createdByLabel}</span></Row>
          {node.parentId && (
            <Row label="Group">
              <span style={{ fontFamily: 'monospace', background: 'var(--surface-hover)', padding: '2px 4px', borderRadius: '4px' }}>{node.parentId.slice(0, 8)}</span>
            </Row>
          )}
        </div>
      </Accordion>
    </div>
  );
};

const ToggleButton: React.FC<{ active: boolean; onClick: () => void; label: string; children: React.ReactNode }> = ({ active, onClick, label, children }) => (
  <button
    className="btn-icon"
    aria-pressed={active}
    aria-label={label}
    onClick={onClick}
    style={{
      padding: '6px', borderRadius: '4px',
      background: active ? 'var(--surface-primary)' : 'transparent',
      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      boxShadow: active ? 'var(--shadow-sm)' : 'none',
    }}
  >
    {children}
  </button>
);
