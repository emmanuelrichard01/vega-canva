import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, BringToFront, CaseSensitive, ChevronDown, ChevronRight,
  FlipHorizontal, FlipVertical, ImageIcon, Italic, LayoutTemplate, Lock, MessageSquare,
  Mic, MoveHorizontal, MoveVertical, PenLine, SendToBack, Sliders, Square, StickyNote,
  Strikethrough, Type, Underline, Unlock, PanelRightClose,
  CornerDownRight, Minus, Spline,
} from 'lucide-react';
import { applyNodePatches, lowestZIndex, nextZIndex, provider, updateNodes } from '../engine/document';
import { useStore } from '../hooks/useStore';
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
  type LineCap,
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
  capApplies,
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
import { END_CAP_KINDS, END_CAP_LABELS, endCapShape, type EndCapKind } from '../engine/model/connectorEnds';

/**
 * Types that are simulated at all. Comments and frames are anchors — offering
 * them a material would imply a behaviour they deliberately do not have.
 */
const NON_PHYSICAL_TYPES = new Set(['comment', 'artboard', 'frame']);
const isPhysicalType = (type: string) => !NON_PHYSICAL_TYPES.has(type);

interface PropertiesPanelProps {
  /**
   * Everything selected, in the order it was selected.
   *
   * This was `selectedId: string | null`, fed by `Room` collapsing the
   * selection to a single id — so the panel showed "Select an object" for the
   * entirely ordinary case of having selected three things. The whole
   * selection is threaded through instead, and every control reports *Mixed*
   * where the objects disagree. See `engine/model/selection.ts`.
   */
  selectedIds: string[];
  /** Time Travel replay snapshot, which replaces the live document while scrubbing. */
  overrideObjects?: Record<string, AnyNode> | null;
  /** Collapse this panel to its rail, handing the width back to the canvas. */
  onCollapse?: () => void;
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

/**
 * A labelled control.
 *
 * A grid with a fixed label column, not `justify-content: space-between`.
 * That one property was most of why this panel read as chaotic: with
 * space-between every control starts wherever its own label happens to end,
 * so "Fill", "Radius" and "Backdrop" pushed their inputs to three different
 * positions and nothing in the column lined up with anything below it. The eye
 * reads that as noise long before it can name the cause.
 *
 * `hint` explains a control that cannot explain itself in one word, on the
 * label rather than in prose beneath it — this panel is scanned far more often
 * than it is read.
 */
const Row: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <div className="prop-row">
    <span className="prop-row__label" data-tooltip={hint} data-tooltip-pos="left">{label}</span>
    <div className="prop-row__control">{children}</div>
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
 * A specimen of the connector end, drawn from the same geometry the canvas
 * uses — so the swatch cannot drift from what the line actually gets.
 */
const polygonPoints = (flat: number[]): string => {
  const pairs: string[] = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push(`${flat[i]},${flat[i + 1]}`);
  return pairs.join(' ');
};

const EndCapIcon: React.FC<{ kind: EndCapKind; flip?: boolean }> = ({ kind, flip }) => {
  const tip = { x: flip ? 4 : 16, y: 6 };
  const shape = endCapShape(kind, tip, flip ? Math.PI : 0, 7);
  return (
    <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" focusable="false">
      <line
        x1={flip ? 6 : 3} y1="6" x2={flip ? 17 : 14} y2="6"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      />
      {shape?.circle && (
        <circle cx={shape.circle.x} cy={shape.circle.y} r={shape.circle.radius} fill="currentColor" />
      )}
      {shape?.points && (
        <polygon
          points={polygonPoints(shape.points)}
          fill={shape.filled ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
};

/**
 * A specimen of the cap, drawn at the end it describes.
 *
 * The same call as the align and join icons, and the case for showing rather
 * than naming is strongest here: "butt", "round" and "square" are the words
 * Canvas2D and SVG use, and two of the three tell you nothing — a square cap
 * and a butt cap are *both* square, and the actual difference is that one
 * extends half the stroke weight past the end point and the other stops on it.
 *
 * So the specimen draws the end point as a hairline tick underneath. Where the
 * ink stops relative to that tick is the whole distinction, and it is visible
 * at a glance instead of being something you have to already know.
 */
const StrokeCapIcon: React.FC<{ cap: LineCap }> = ({ cap }) => (
  <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" focusable="false">
    {/* Where the path actually ends. Butt lands on it, square runs past it,
        round runs past it curved. */}
    <line x1="14" y1="1" x2="14" y2="11" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
    <path d="M 4 6 L 14 6" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap={cap} />
  </svg>
);

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

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ selectedIds, overrideObjects, onCollapse }) => {
  /**
   * The selected nodes, and *only* those.
   *
   * `useShallow` compares the resulting array element by element, and the
   * store preserves the reference of every node it did not change — so this
   * re-renders when something selected changes and stays still when anything
   * else on the board moves. Subscribing to `state.objects` instead would
   * re-render fifty controls on every remote cursor's drag, which is the
   * per-object subscription rule the renderers already follow.
   */
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

  /**
   * The object a control falls back to when the selection disagrees, and the
   * one whose *structure* decides which sections appear at all.
   *
   * Keeping this named `node` is deliberate: every per-type block below reads
   * it, and a selection is only offered those blocks when it is uniform, so
   * within them the primary genuinely does speak for the rest.
   */
  const node: AnyNode | null = nodes[0] ?? null;
  const isMulti = nodes.length > 1;

  /** Read one field across the selection. */
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
          <span style={{ fontSize: '14px', fontWeight: 500 }}>Select an object</span>
        </div>
      </div>
    );
  }

  const selectedIdsPresent = nodes.map((n) => n.id);

  /**
   * Whether every selected object is the same type.
   *
   * The gate on every per-type section. A Star block over a selection holding
   * a star and an image is a control that can only act on part of what is
   * selected — the same defect as a control the renderer ignores, arrived at
   * from the other direction.
   */
  const uniformType = !shared((n) => n.type).mixed;

  /**
   * Whether the selection is also all the *same shape*.
   *
   * `uniformType` is not enough on its own, and the browser caught it: a star,
   * a rectangle and a rounded rectangle are all `type: 'shape'`, so selecting
   * the three of them passed the type gate and showed the **Star** section —
   * with the point count and depth of whichever happened to be primary, and
   * writes that would have turned the other two into stars.
   *
   * Kinds are only comparable within a type, so this is deliberately false for
   * a mixed-type selection rather than accidentally true when neither has a
   * `geometry`.
   */
  const uniformKind =
    uniformType &&
    !shared((n) => ((n as { geometry?: { kind?: string } }).geometry?.kind ?? null)).mixed;

  /**
   * What the whole selection supports, which is the intersection and not the
   * union — see `intersectCapabilities`.
   */
  const capabilities = isMulti
    ? intersectCapabilities(
        nodes.map((n) => objectRegistry.get(n.type)?.capabilities ?? {})
      )
    : objectRegistry.get(node.type)?.capabilities ?? {};
  const typography = typographyOf(node);
  const appearance = appearanceOf(node);

  /**
   * A line or an arrow: no interior, so no fill, no corner radius, and none of
   * the effects that clip to one. Read once here rather than repeated as
   * `node.geometry.kind === 'line' || ...` at seven call sites.
   */
  const openShape = nodes.some((n) => n.type === 'shape' && isOpenShape(n.geometry.kind));
  /**
   * Whether this object's outline has a corner for a join to apply to.
   *
   * An ellipse has none, a fully rounded rectangle has none left, and a line
   * is two points with nothing in between them to meet at. Offering the
   * control on those is offering a control that provably cannot change the
   * pixels — the same failure as one the renderer ignores, arrived at from
   * the other direction.
   */
  const hasCorners = nodes.every((n) => {
    const paint = appearanceOf(n);
    return n.type === 'path'
      ? n.geometry.kind !== 'freehand'
      : n.type === 'shape' &&
          (n.geometry.kind === 'polygon' ||
            n.geometry.kind === 'star' ||
            (n.geometry.kind === 'rect' && !(paint?.cornerRadius && paint.cornerRadius > 0)));
  });

  /**
   * Whether this object's outline has an end for a cap to sit on.
   *
   * Two ways to get one, and missing the second is what made this control look
   * broken:
   *
   *  - **An open outline** — a line, an arrow, an unclosed bezier, a connector.
   *    It stops somewhere, and a cap is drawn where a stroke stops.
   *  - **A dash pattern, on any outline at all.** A dash breaks a closed
   *    contour into segments, and *every segment has two ends*. Rounding the
   *    dashes on a rectangle is probably the single most common reason to
   *    reach for this setting, and the first version disabled it there and
   *    said "this outline is closed — it has no loose end for a cap to sit
   *    on", which is both unhelpful and untrue.
   *
   * A solid closed outline is the only case with genuinely nowhere to put a
   * cap. Freehand belongs there too when solid: its `svgPath` is already the
   * *outline of its own stroke* rather than a line to be stroked, so its ends
   * were shaped when it was drawn.
   */
  const hasEnds = nodes.every((n) => capApplies({ ...n, appearance: appearanceOf(n) }));

  /**
   * Write the same fields to everything selected, as one action.
   *
   * `updateNodes` runs a single Yjs transaction, so setting a fill across four
   * objects is one document change, one history entry and one undo — not four
   * of each, which is what a loop of `updateNode` would have produced.
   */
  const set = (updates: Partial<AnyNode>) =>
    updateNodes(selectedIdsPresent, updates as Record<string, unknown>);

  /**
   * Patch a nested block, merging each node with **its own** current value.
   *
   * The single-node panel could merge against the one `appearance` it had read.
   * Fanning that out is the trap: `{ ...primaryAppearance, ...patch }` written
   * to all four objects does not set a fill on four objects, it *replaces*
   * three objects' entire paint — stroke, shadow, blend and all — with the
   * primary's. Every nested setter below therefore rebuilds per node.
   */
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
  const setTypography = (patch: Partial<Typography>) =>
    patchEach((n) => ({ typography: { ...(typographyOf(n) ?? DEFAULT_TYPOGRAPHY), ...patch } }));

  /**
   * Write the stroke, keeping its dash pattern proportional to its weight.
   *
   * A dash array is absolute, so a pattern authored at 1px closes up into a
   * near-solid line by the time the stroke is 12px. Re-deriving on every write
   * means the *style* is what persists, which is what someone who picked
   * "Dashed" actually chose. `buildStroke` omits the dash keys entirely for a
   * solid stroke rather than writing `undefined` into a nested value.
   */
  const setStroke = (patch: Partial<Pick<Stroke, 'color' | 'width' | 'align' | 'join' | 'miterLimit' | 'cap'>>) => {
    patchEach((n) => {
      const paint = appearanceOf(n);
      const current = paint?.stroke;
      const color = patch.color ?? current?.color ?? '#000000';
      const width = patch.width ?? current?.width ?? 2;
      const align = patch.align ?? current?.align;
      const join = patch.join ?? current?.join;
      const miterLimit = patch.miterLimit ?? current?.miterLimit;
      // `??` rather than `||` throughout, and it matters for the cap: `'butt'`
      // is a legitimate choice, and the falsy check would have discarded it in
      // favour of whatever was stored.
      const cap = patch.cap ?? current?.cap;
      return {
        appearance: {
          ...(paint ?? {}),
          stroke: buildStroke({ color, width, align, join, miterLimit, cap }, restyleForWidth(current, width)),
        },
      };
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
  const setAdjustment = (id: AdjustmentId, value: number) =>
    patchEach((n) =>
      n.type === 'image'
        ? { filters: packAdjustments({ ...readAdjustments(n.filters), [id]: value }) }
        : null
    );

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
   * Patch a shape's geometry, preserving `kind`.
   *
   * `updateNode` replaces the whole `geometry` value, so a patch that omitted
   * `kind` would turn a star into a rect — the same trap `setAppearance` has.
   */
  const setGeometry = (patch: Partial<ShapeGeometry>) =>
    patchEach((n) => (n.type === 'shape' ? { geometry: { ...n.geometry, ...patch } } : null));

  const setStrokeStyle = (style: StrokeStyleId) =>
    patchEach((n) => {
      const paint = appearanceOf(n);
      const current = paint?.stroke;
      const color = current?.color ?? '#000000';
      // Picking a dash on a shape with no outline yet is a request for an
      // outline — a control that visibly changes nothing is worse than no
      // control, and a 0-width stroke is exactly that.
      const width = current?.width && current.width > 0 ? current.width : 2;
      return {
        appearance: {
          ...(paint ?? {}),
          // `join` and `miterLimit` travel with the rest. They were omitted
          // here, and `buildStroke` writes only what it is handed — so picking
          // a dash style silently reset a bevelled or rounded corner back to
          // miter and dropped any custom limit. Choosing "Dashed" is not a
          // request to change the corners.
          stroke: buildStroke(
            {
              color,
              width,
              align: current?.align,
              join: current?.join,
              miterLimit: current?.miterLimit,
              // The cap travels too, for the same reason. Leaving dotted is
              // the interesting case: `dashFor` stops forcing round, and this
              // is what the cap falls *back* to — whatever was authored before
              // the dots, rather than nothing.
              cap: current?.cap,
            },
            dashFor(style, width)
          ),
        },
      };
    });

  /**
   * The box the Transform block describes.
   *
   * For one object that is its own rectangle; for several it is the box drawn
   * around all of them, which is what the transformer on the canvas is showing
   * at the same moment. A panel reporting anything else would be describing a
   * rectangle nobody can see.
   */
  const bounds = selectionBounds(nodes);
  /**
   * A rotated selection cannot be resized as a box — see `canResizeAsBox`.
   * Single objects are exempt: one node *is* the box, so its own width and
   * height are exactly what the field means whatever it is rotated to.
   */
  const boxResizable = !isMulti || canResizeAsBox(nodes);
  const resizeBlockedReason =
    boxResizable ? undefined : 'Resize is unavailable while something in the selection is rotated';

  /** Move the selection so its box starts at `value` on one axis. */
  const setOrigin = (axis: 'x' | 'y', value: number) => {
    if (!isMulti) {
      set({ [axis]: value } as Partial<AnyNode>);
      return;
    }
    if (bounds) applyNodePatches(translateSelection(nodes, bounds, axis, value));
  };

  /** Shift every selected object by the same amount, from wherever it is. */
  const nudgeEach = (key: 'x' | 'y' | 'rotation' | 'opacity', delta: number, min?: number, max?: number) =>
    patchEach((n) => {
      let next = (n[key] as number) + delta;
      if (min !== undefined) next = Math.max(min, next);
      if (max !== undefined) next = Math.min(max, next);
      return { [key]: next };
    });

  // Resizing writes width/height only. There is no second copy of the size to
  // keep in step any more — this used to fan a single edit out to `width`,
  // `content.width` and `geometry.width` and hope they stayed consistent.
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

    // With the ratio locked, the other axis scales by the same factor — and
    // both halves have to land in **one** transaction, or the canvas renders
    // the intermediate state where the selection has been stretched on one
    // axis only.
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
      activeEditors.push({ name: state.user.name || 'Teammate', color: state.user.color || '#EC4899' });
    }
  });

  // Authorship is denormalised onto the node at creation, so it survives the
  // author disconnecting. This used to resolve a bare client id against the
  // live awareness roster and fall back to "Unknown" for anyone who had left.
  const createdByLabel =
    String(node.createdBy) === String(myClientId) ? 'You' : node.createdByName || 'Unknown';

  // Every typographic control reads across the selection; `typography` above
  // remains the primary's, which is what these fall back to when they agree.
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
            {/* A mixed selection gets the neutral icon rather than the first
                object's — a star beside "3 objects" claims the other two are
                stars too. */}
            {isMulti && !uniformType
              ? <LayoutTemplate size={16} color="var(--text-secondary)" />
              : TYPE_ICONS[node.type] ?? <LayoutTemplate size={16} color="var(--text-secondary)" />}
            <span style={{ textTransform: 'capitalize' }}>{selectionLabel(nodes)}</span>
          </div>
          {/* The id identifies one object, so it is shown for one object. Over
              a selection it would name whichever happened to be first, which
              is information about nothing anyone asked about. */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!isMulti && (
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)', background: 'var(--surface-hover)', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', fontFamily: 'monospace' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-secondary)' }}>
            <span style={{ position: 'relative', display: 'flex', height: '8px', width: '8px' }}>
              <span style={{ position: 'absolute', height: '100%', width: '100%', borderRadius: '50%', backgroundColor: activeEditors[0].color, opacity: 0.7, animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite' }} />
              <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '50%', height: '8px', width: '8px', backgroundColor: activeEditors[0].color }} />
            </span>
            {activeEditors[0].name} is editing
          </div>
        )}

        <div style={{ display: 'flex', background: 'var(--surface-hover)', padding: '2px', borderRadius: '6px', width: '100%', marginTop: '8px' }}>
          {/* Restacking several objects assigns consecutive slots rather than
              one shared slot, so the selection keeps its own internal order
              instead of collapsing into a tie broken by id. */}
          <button
            className="btn-icon" style={{ flex: 1, padding: '6px' }}
            onClick={() => {
              const base = nextZIndex();
              const ordered = [...nodes].sort((a, b) => a.zIndex - b.zIndex);
              applyNodePatches(ordered.map((n, i) => ({ id: n.id, changes: { zIndex: base + i } })));
            }}
            title="Bring to Front"
          ><BringToFront size={14} /></button>
          <button
            className="btn-icon" style={{ flex: 1, padding: '6px' }}
            onClick={() => {
              const base = lowestZIndex() - nodes.length;
              const ordered = [...nodes].sort((a, b) => a.zIndex - b.zIndex);
              applyNodePatches(ordered.map((n, i) => ({ id: n.id, changes: { zIndex: base + i } })));
            }}
            title="Send to Back"
          ><SendToBack size={14} /></button>
          <div style={{ width: '1px', height: '20px', margin: 'auto 4px', background: 'var(--border-divider)' }} />
          {/* Each object flips about its own centre. Flipping the selection as
              a unit — mirroring positions across the bounding box too — is a
              different operation, and not the one this button has ever been. */}
          <button className="btn-icon" style={{ flex: 1, padding: '6px' }} onClick={() => patchEach((n) => ({ scaleX: -n.scaleX }))} title="Flip Horizontal"><FlipHorizontal size={14} /></button>
          <button className="btn-icon" style={{ flex: 1, padding: '6px' }} onClick={() => patchEach((n) => ({ scaleY: -n.scaleY }))} title="Flip Vertical"><FlipVertical size={14} /></button>
        </div>
      </div>

      <Accordion title="Transform">
        {/* X/Y/W/H describe the selection's box, not any one member of it, so
            they are never Mixed: a box has exactly one origin and one size
            however many objects are inside it. Editing X moves everything by
            the same delta, which keeps the arrangement intact — setting four
            objects to the same X would stack them. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <NumberStepper value={Math.round(bounds?.x ?? node.x)} onChange={(v) => setOrigin('x', v)} label="X" />
          <NumberStepper value={Math.round(bounds?.y ?? node.y)} onChange={(v) => setOrigin('y', v)} label="Y" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <NumberStepper
              value={Math.round(bounds?.width ?? node.width)}
              onChange={(v) => resizeSelection('width', v)}
              label="W"
              min={1}
              disabledReason={resizeBlockedReason}
            />
          </div>
          <button
            className="btn-icon"
            onClick={() => setAspectLocked((v) => !v)}
            data-tooltip={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            aria-pressed={aspectLocked}
            style={{
              // `marginTop: 10px` used to sit here, nudging the lock down to
              // clear a stacked label the stepper no longer has — so it hung
              // below the two fields it belongs between.
              padding: '6px', borderRadius: '4px', flexShrink: 0, alignSelf: 'center',
              color: aspectLocked ? 'var(--text-primary)' : 'var(--text-tertiary)',
              background: aspectLocked ? 'var(--surface-hover)' : 'transparent',
            }}
          >
            {aspectLocked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <NumberStepper
              value={Math.round(bounds?.height ?? node.height)}
              onChange={(v) => resizeSelection('height', v)}
              label="H"
              min={1}
              disabledReason={resizeBlockedReason}
            />
          </div>
        </div>
        {/* Rotation is the one transform field that *is* per object: there is
            no single angle for a box, so objects that disagree read Mixed, the
            arrows turn each from where it already points, and typing a number
            sets them all to it. */}
        <div style={{ marginTop: '8px' }}>
          <NumberStepper
            value={Math.round(rotationShared.value ?? 0)}
            mixed={rotationShared.mixed}
            onChange={(v) => set({ rotation: v })}
            onNudge={(d) => nudgeEach('rotation', d)}
            label="R"
            suffix="deg"
            step={15}
          />
        </div>
      </Accordion>

      {(capabilities.supportsFill || capabilities.supportsOpacity || capabilities.supportsRadius) && (
        <Accordion title="Appearance">
          {capabilities.supportsFill && appearance && !openShape && (
            <Row label="Fill" hint="Solid colour or gradient. Click the swatch to change the kind.">
              {/* A paint is a whole object — type, stops, angle — so "mixed"
                  here is a swatch that would misreport three of four fills.
                  The editor still opens on the primary's paint and writes to
                  everything, which is what makes it the way to resolve them. */}
              <FillEditor
                paint={appearance.fill?.[0]}
                mixed={sharedPaint((a) => a.fill?.[0]).mixed}
                onChange={(fill) => setAppearance({ fill: [fill] })}
              />
            </Row>
          )}
          {capabilities.supportsRadius && (!uniformType || node.type !== 'shape' || node.geometry.kind === 'rect') && !openShape && (
            <Row label="Radius" hint="Rounds every corner by the same amount.">
              {(() => {
                const radius = sharedPaint((a) => a.cornerRadius ?? 0);
                return (
                  <NumberStepper
                    value={radius.value ?? 0}
                    mixed={radius.mixed}
                    onChange={(v) => setAppearance({ cornerRadius: v })}
                    min={0} max={200}
                  />
                );
              })()}
            </Row>
          )}
          {capabilities.supportsOpacity && (
            <Row label="Opacity">
              <NumberStepper
                suffix="%"
                value={Math.round((opacityShared.value ?? 1) * 100)}
                mixed={opacityShared.mixed}
                onChange={(v) => set({ opacity: v / 100 })}
                onNudge={(d) => nudgeEach('opacity', d / 100, 0, 1)}
                min={0} max={100} step={10}
              />
            </Row>
          )}
          {/* Blend mode and layer blur sit with the rest of the paint because
              that is what they are: how the object looks against what is
              behind it. Offered wherever `appearance` exists, because
              `ObjectRenderer` applies both to the whole node group and not to
              one shape inside it — so they work on an image and a path exactly
              as they work on a rectangle. */}
          {appearance && (
            <Row label="Blend" hint="How this object\u2019s pixels combine with whatever is beneath it.">
              {/* A `<select>` has no third state, so a mixed selection shows an
                  extra option that is present only while it applies and
                  disappears the moment a real one is chosen. Picking it is a
                  no-op rather than a value that can be written. */}
              <select
                className="prop-select"
                value={sharedPaint((a) => a.blendMode ?? 'normal').mixed ? '__mixed' : appearance.blendMode ?? 'normal'}
                onChange={(e) => {
                  if (e.target.value === '__mixed') return;
                  setAppearance({
                    // `normal` is stored as absent, matching the normalizer:
                    // the common case costs nothing and "has a blend mode"
                    // stays a question about presence.
                    blendMode: e.target.value === 'normal' ? undefined : (e.target.value as BlendMode),
                  });
                }}
              >
                {sharedPaint((a) => a.blendMode ?? 'normal').mixed && (
                  <option value="__mixed">Mixed</option>
                )}
                {BLEND_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {BLEND_LABELS[mode]}
                  </option>
                ))}
              </select>
            </Row>
          )}
        </Accordion>
      )}

      {/* Image adjustments. `filters` sat on the schema for the project's
          whole life and `ImageRenderer` read four properties, none of them
          this — so a stored adjustment was silently ignored. */}
      {uniformType && node.type === 'image' && (
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
      {uniformKind && node.type === 'shape' && node.geometry.kind === 'star' && (
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
      {uniformType && node.type === 'frame' && (
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
        <Accordion title="Drop shadow" defaultOpen={Boolean(appearance.shadow)}>
          <Row label="Enabled" hint="A shadow cast outward, behind the object.">
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
                  mixed={sharedPaint((a) => a.shadow?.color).mixed}
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
                <Row label="Spread" hint="Grows the shadow\u2019s own silhouette before it is blurred.">
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

      {/* A connector's own properties: how it gets there, and which ends it
          points at. Everything else it needs — stroke colour, weight, dash,
          opacity — is the ordinary Stroke and Appearance sections, because a
          connector is a line and those already describe lines. */}
      {uniformType && node.type === 'connector' && (
        <Accordion title="Connector">
          <Row label="Route" hint="Straight goes corner to corner. Orthogonal turns at right angles, which is what a flowchart reads as. Curved eases between the two ends.">
            <SegmentedControl
              ariaLabel="Routing"
              mixed={shared((n) => (n.type === 'connector' ? n.routing : null)).mixed}
              value={node.routing}
              onChange={(routing) => set({ routing } as Partial<AnyNode>)}
              segments={[
                {
                  value: 'straight', label: 'Straight', icon: <Minus size={14} />,
                  hint: 'A direct line',
                },
                {
                  value: 'orthogonal', label: 'Right angles', icon: <CornerDownRight size={14} />,
                  hint: 'Right-angled elbows',
                },
                {
                  value: 'curved', label: 'Curved', icon: <Spline size={14} />,
                  hint: 'A smooth arc',
                },
              ]}
            />
          </Row>
          {/* Each end chosen independently, from the same vocabulary. Two
              rows rather than one, because "what is at the start" and "what is
              at the end" are separate decisions and a combined control would
              have to enumerate thirty-six pairs. */}
          <Row label="Start" hint="What sits at the first end.">
            <SegmentedControl
              ariaLabel="Start cap"
              mixed={shared((n) => (n.type === 'connector' ? n.endStart ?? 'none' : null)).mixed}
              value={node.endStart ?? 'none'}
              onChange={(v) => set({ endStart: v } as Partial<AnyNode>)}
              segments={END_CAP_KINDS.map((k) => ({
                value: k,
                label: END_CAP_LABELS[k],
                hint: END_CAP_LABELS[k],
                icon: <EndCapIcon kind={k} flip />,
              }))}
            />
          </Row>
          <Row label="End" hint="What sits at the second end.">
            <SegmentedControl
              ariaLabel="End cap"
              mixed={shared((n) => (n.type === 'connector' ? n.endEnd ?? 'none' : null)).mixed}
              value={node.endEnd ?? 'none'}
              onChange={(v) => set({ endEnd: v } as Partial<AnyNode>)}
              segments={END_CAP_KINDS.map((k) => ({
                value: k,
                label: END_CAP_LABELS[k],
                hint: END_CAP_LABELS[k],
                icon: <EndCapIcon kind={k} />,
              }))}
            />
          </Row>
          <Row label="Label" hint="A word riding the middle of the run — yes, no, retry.">
            <input
              className="prop-input"
              value={node.label ?? ''}
              placeholder="None"
              onChange={(e) => set({ label: e.target.value || undefined } as Partial<AnyNode>)}
              aria-label="Connector label"
            />
          </Row>
          {/* Attachment is stated rather than editable: it is set by drawing,
              and a dropdown of node ids would be a control nobody can read. */}
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            {node.from.nodeId && node.to.nodeId
              ? 'Both ends follow the objects they are attached to.'
              : 'One end is loose — drag it onto an object to attach it.'}
          </p>
        </Accordion>
      )}

      {/* One number, one control. `triangle` and `hexagon` used to be separate
          shape kinds, which is two hard-coded side counts where the
          specification asks for any of them. */}
      {uniformKind && node.type === 'shape' && node.geometry.kind === 'polygon' && (
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
      {uniformKind && node.type === 'shape' && openShape && (
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
        <Accordion title="Stroke" defaultOpen={Boolean(appearance.stroke?.width)}>
          <Row label="Color">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <ColorPickerPopover
                color={appearance.stroke?.color ?? 'transparent'}
                mixed={sharedPaint((a) => a.stroke?.color ?? 'transparent').mixed}
                onChange={(color) => setStroke({ color })}
              />
              <EyedropperButton
                label="Pick a stroke colour from the screen"
                onPick={(color) => setStroke({ color })}
              />
            </div>
          </Row>
          <Row label="Weight" hint="Thickness of the outline, in pixels. Zero removes it.">
            {(() => {
              const strokeWidth = sharedPaint((a) => a.stroke?.width ?? 0);
              return (
                <NumberStepper
                  value={strokeWidth.value ?? 0}
                  mixed={strokeWidth.mixed}
                  /* The dash pattern is re-derived from the new weight, so a
                     dashed line stays visibly dashed instead of closing up into
                     a near-solid one as it gets thicker. */
                  onChange={(width) => setStroke({ width })}
                  min={0} max={100}
                />
              );
            })()}
          </Row>
          <Row label="Style" hint="Solid, dashed or dotted. The pattern scales with the weight so it stays legible.">
            <SegmentedControl
              ariaLabel="Stroke style"
              mixed={sharedPaint((a) => styleOf(a.stroke)).mixed}
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
            <Row label="Align" hint="Where the line sits relative to the shape\u2019s edge.">
              <SegmentedControl
                ariaLabel="Stroke alignment"
                mixed={sharedPaint((a) => a.stroke?.align ?? 'center').mixed}
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
          {/* Where the line stops. Shown on the same terms as Join and for the
              same reason: present but disabled with a stated cause, rather than
              silently absent, because a control that is missing is
              indistinguishable from one that is broken. */}
          {capabilities.supportsStroke && (
            <Row label="Cap" hint="How the two ends of an open line are finished.">
              <SegmentedControl
                ariaLabel="Line cap"
                disabledReason={
                  styleOf(appearance.stroke) === 'dotted'
                    ? 'A dotted line is drawn entirely from round caps — that is what makes the dots. Switch to Solid or Dashed to set a cap.'
                    : !hasEnds
                      ? 'A solid closed outline has no ends. Use a line or an open path, or add a dash — every dash has two ends of its own.'
                      : undefined
                }
                /* `butt` is what a stroke with no cap set already draws, so it
                   is the value shown rather than a blank — the control opens
                   telling the truth about the object instead of asking to be
                   initialised. */
                mixed={sharedPaint((a) => a.stroke?.cap ?? 'butt').mixed}
                value={appearance.stroke?.cap ?? 'butt'}
                onChange={(cap) => setStroke({ cap: cap as LineCap })}
                segments={[
                  { value: 'butt', label: 'Flat', icon: <StrokeCapIcon cap="butt" /> },
                  { value: 'round', label: 'Round', icon: <StrokeCapIcon cap="round" /> },
                  { value: 'square', label: 'Square', icon: <StrokeCapIcon cap="square" /> },
                ]}
              />
            </Row>
          )}
          {/* How two segments meet. Only a shape with corners has any, so it
              is not offered on an ellipse — a control that provably cannot
              change anything about the selected object is the same mistake as
              one the renderer ignores. */}
          {/* Shown always, disabled with a reason when the geometry has no
              corner for a join to apply to.
              These two rows used to disappear entirely — an ellipse, or a
              rectangle with any corner radius at all, simply had no Join row,
              and picking Round made the Miter row vanish too. Both were
              *correct*: an arc has no join and only a miter has a limit. But a
              control that silently is not there is indistinguishable from one
              that is broken, which is exactly how these read. */}
          {capabilities.supportsStroke && (
            <Row label="Join" hint="How two straight edges meet at a corner.">
              <SegmentedControl
                ariaLabel="Line join"
                disabledReason={hasCorners ? undefined : 'This shape has no straight corners — a rounded or curved edge has no join.'}
                mixed={sharedPaint((a) => a.stroke?.join ?? 'miter').mixed}
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
          {capabilities.supportsStroke && (
            <Row label="Miter" hint="How far a sharp corner may extend before it is cut flat. Only a miter join has one.">
              {(() => {
                const limit = sharedPaint((a) => a.stroke?.miterLimit ?? DEFAULT_MITER_LIMIT);
                return (
                  <NumberStepper
                    value={limit.value ?? DEFAULT_MITER_LIMIT}
                    mixed={limit.mixed}
                    onChange={(miterLimit) => setStroke({ miterLimit })}
                    min={MIN_MITER_LIMIT}
                    max={MAX_MITER_LIMIT}
                    disabledReason={
                      !hasCorners
                        ? 'This shape has no straight corners.'
                        : (appearance.stroke?.join ?? 'miter') !== 'miter'
                          ? 'Only a miter join has a limit. Switch Join to Miter to set one.'
                          : undefined
                    }
                  />
                );
              })()}
            </Row>
          )}
        </Accordion>
      )}

      {/* Blur, with the shadows rather than inside Appearance.
          Layer blur and backdrop blur used to sit under "Appearance", two rows
          below Fill, while the two shadows were top-level sections of their
          own — so the four effects an object can carry were split across two
          places on no principle at all. They are all effects; they are all
          here; and paint is only paint. */}
      {appearance && (
        <Accordion
          title="Blur"
          defaultOpen={Boolean(appearance.blur || appearance.backdropBlur)}
        >
          <Row label="Layer" hint="Blurs this object itself.">
            {(() => {
              const blur = sharedPaint((a) => a.blur ?? 0);
              return (
                <NumberStepper
                  value={Math.round(blur.value ?? 0)}
                  mixed={blur.mixed}
                  onChange={(v) => setAppearance({ blur: v > 0 ? v : undefined })}
                  min={0} max={100} step={2} suffix="px"
                />
              );
            })()}
          </Row>
          {capabilities.supportsEdgeEffects && !openShape && (
            <Row label="Backdrop" hint="Blurs the board behind this object. Only visible through a fill that is not fully opaque.">
              {(() => {
                const backdrop = sharedPaint((a) => a.backdropBlur ?? 0);
                return (
                  <NumberStepper
                    value={Math.round(backdrop.value ?? 0)}
                    mixed={backdrop.mixed}
                    onChange={(v) => setAppearance({ backdropBlur: v > 0 ? v : undefined })}
                    min={0} max={100} step={2} suffix="px"
                  />
                );
              })()}
            </Row>
          )}
        </Accordion>
      )}

      {/* Inner shadow. Its own section rather than a flag on Shadow, because
          an object can want both: a card raised off the page and inset at its
          own edges is an ordinary thing to draw. */}
      {capabilities.supportsEdgeEffects && appearance && !openShape && (
        <Accordion title="Inner shadow" defaultOpen={Boolean(appearance.innerShadow)}>
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
                  mixed={sharedPaint((a) => a.innerShadow?.color).mixed}
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
            {(() => {
              const size = sharedType((t) => t.fontSize);
              return (
                <NumberStepper
                  value={size.value ?? 16}
                  mixed={size.mixed}
                  onChange={(fontSize) => setTypography({ fontSize })}
                  onNudge={(d) =>
                    patchEach((n) => {
                      const t = typographyOf(n);
                      if (!t) return null;
                      return { typography: { ...t, fontSize: Math.max(8, Math.min(500, t.fontSize + d)) } };
                    })
                  }
                  min={8} max={500}
                />
              );
            })()}
          </Row>
          <Row label="Color">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <ColorPickerPopover color={typography.color} mixed={sharedType((t) => t.color).mixed} onChange={(color) => setTypography({ color })} />
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
              <ToggleButton active={isBold} mixed={sharedType((t) => (t.fontWeight ?? 400) >= 600).mixed} onClick={() => setTypography({ fontWeight: isBold ? 400 : 700 })} label="Bold"><Bold size={14} /></ToggleButton>
              <ToggleButton active={typography.italic} mixed={sharedType((t) => Boolean(t.italic)).mixed} onClick={() => setTypography({ italic: !typography.italic })} label="Italic"><Italic size={14} /></ToggleButton>
              <ToggleButton active={typography.underline} mixed={sharedType((t) => Boolean(t.underline)).mixed} onClick={() => setTypography({ underline: !typography.underline })} label="Underline"><Underline size={14} /></ToggleButton>
              {/* Its own flag rather than sharing one with the underline:
                  Canvas2D and SVG both draw a run with both at once, and a
                  single-valued field would make them exclusive for no reason
                  but its own shape. */}
              <ToggleButton active={typography.strikethrough} mixed={sharedType((t) => Boolean(t.strikethrough)).mixed} onClick={() => setTypography({ strikethrough: !typography.strikethrough })} label="Strikethrough"><Strikethrough size={14} /></ToggleButton>
            </div>
          </Row>
          {/* A case shown, not typed. The stored string is never rewritten, so
              switching to upper case and back returns what was written rather
              than a shouted version of it. */}
          <Row label="Case" hint="Changes how the text is shown, never what is stored — switching back returns exactly what you typed.">
            <SegmentedControl
              ariaLabel="Text case"
              mixed={sharedType((t) => t.textCase ?? 'none').mixed}
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
              ariaLabel="Text alignment"
              mixed={sharedType((t) => t.align).mixed}
              value={typography.align}
              onChange={(v) => setTypography({ align: v as TextAlign })}
              segments={[
                { value: 'left', icon: <AlignLeft size={14} /> },
                { value: 'center', icon: <AlignCenter size={14} /> },
                { value: 'right', icon: <AlignRight size={14} /> },
              ]}
            />
          </Row>
          <Row label="Leading" hint="Distance between baselines, as a multiple of the font size.">
            {(() => {
              const lh = sharedType((t) => t.lineHeight);
              return (
                <NumberStepper
                  value={lh.value ?? 1.2}
                  mixed={lh.mixed}
                  onChange={(lineHeight) => setTypography({ lineHeight })}
                  min={0.5} max={3} step={0.1}
                />
              );
            })()}
          </Row>
          <Row label="Tracking" hint="Space added between every character.">
            {(() => {
              const ls = sharedType((t) => t.letterSpacing);
              return (
                <NumberStepper
                  value={ls.value ?? 0}
                  mixed={ls.mixed}
                  onChange={(letterSpacing) => setTypography({ letterSpacing })}
                  min={-10} max={50} step={1}
                />
              );
            })()}
          </Row>
          {/* Which of the box's dimensions follow the words. Replaces
              `autoHeight`, which was written by the normalizer and the text
              tool and read by nothing — and could only express two of these
              three, which is part of why nothing ever consumed it. */}
          {uniformType && node.type === 'text' && (
            <Row label="Resize" hint="Auto width grows sideways, auto height wraps and grows down, fixed clips.">
              <SegmentedControl
                ariaLabel="Text box resizing"
                mixed={shared((n) => (n.type === 'text' ? n.resize : null)).mixed}
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

      {uniformType && node.type === 'sticky' && (
        <Accordion title="Note">
          <Row label="Color">
            <ColorPickerPopover
              // A sticky's colour is a named theme on the node, not a paint.
              // This used to write `appearance.fill`, which the sticky renderer
              // never reads — so recolouring a sticky here did nothing at all.
              color={THEMES[node.theme]?.bg ?? '#FDE047'}
              onChange={(color) => {
                const theme = nearestTheme(color);
                set({ theme });
                // Recolouring a note also sets what the next one will be, the
                // way a colour picker works in every drawing tool. Without
                // this you would recolour a note and the tool would carry on
                // placing the old colour.
                useStore.getState().setStickyTheme(theme);
              }}
            />
          </Row>
          {/* "Text Size" used to live here. It set a `fontSize` that nothing
              reads any more: the type is fitted to the note so the words
              always fit, which is a promise a manual size cannot keep. See
              `engine/model/stickyText.ts`. */}
          <Row label="Pinned" hint="A pinned note stays put when a layout is rearranged.">
            <input type="checkbox" checked={node.pinned} onChange={(e) => set({ pinned: e.target.checked })} />
          </Row>
          {/* Tags stay a single-note control. The editor shows one list and
              writes what it shows, so over four notes it would replace four
              different tag sets with one — destroying data rather than
              editing it. Adding a tag *across* a selection is a union, which
              is a different control than this one. */}
          {!isMulti && <TagEditor tags={node.tags} onChange={(tags: string[]) => set({ tags })} />}
        </Accordion>
      )}

      {/* What the object is made of, and therefore how it moves under force.
          The material profiles have always driven the simulation but were keyed
          to node type and invisible — an audio note was bouncy and nobody could
          see why, or make a sticky heavy. */}
      {nodes.every((n) => isPhysicalType(n.type)) && (
        <Accordion title="Physics" defaultOpen={false}>
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

      {/* Metadata is about one object — an id, a creation time, an author.
          Over a selection every row would name whichever node happened to be
          first, which is a fact about nothing the panel is describing. */}
      {!isMulti && (
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
      )}
    </div>
  );
};

/**
 * An on/off style toggle, which over a selection has a third state.
 *
 * `aria-pressed="mixed"` is the platform's own word for it, so a screen reader
 * says "partially pressed" rather than picking one of two wrong answers. It is
 * drawn as an outline rather than as a raised surface: raised means *on*
 * everywhere else in this panel, and reusing it here would make a selection
 * where one of four items is bold look exactly like one where all four are.
 */
const ToggleButton: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  mixed?: boolean;
  children: React.ReactNode;
}> = ({ active, onClick, label, mixed = false, children }) => (
  <button
    className="btn-icon"
    aria-pressed={mixed ? 'mixed' : active}
    aria-label={label}
    onClick={onClick}
    style={{
      padding: '6px', borderRadius: '4px',
      background: !mixed && active ? 'var(--surface-primary)' : 'transparent',
      color: mixed || active ? 'var(--text-primary)' : 'var(--text-secondary)',
      boxShadow: !mixed && active ? 'var(--shadow-sm)' : 'none',
      outline: mixed ? '1px dashed var(--border-strong, var(--border-divider))' : 'none',
      outlineOffset: '-2px',
    }}
  >
    {children}
  </button>
);
