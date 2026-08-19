import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, BringToFront, CaseSensitive, ChevronRight,
  List, ListOrdered,
  FlipHorizontal, FlipVertical, ImageIcon, Italic, LayoutTemplate, Lock, MessageSquare,
  Mic, MoveHorizontal, MoveVertical, PenLine, SendToBack, Sliders, Square, StickyNote,
  Strikethrough, Type, Underline, Unlock, PanelRightClose,
  CornerDownRight, Minus, Spline,
} from 'lucide-react';
import { applyNodePatches, lowestZIndex, nextZIndex, provider, updateNodes } from '../engine/document';
import { useStore } from '../hooks/useStore';
import { APPEARANCE_TYPES } from '../engine/objects/appearanceTypes';
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
  DEFAULT_SHADOW_COLOR,
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
  type ListStyle,
  type CycleUnit,
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
import { Switch } from './ui/Switch';
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
import { getColorForUser } from '../engine/presence/ColorPalette';
import type { FillStyle, SketchLevel } from '../engine/model/rough';
import { FillStyleIcon, SketchLevelIcon } from './panel/sketchIcons';
import { EndCapIcon } from './panel/connectorIcons';
import { CYCLE_PRESETS } from '../engine/text/colorCycle';
import {
  DEFAULT_TEXT_GLOW,
  DEFAULT_TEXT_HIGHLIGHT,
  DEFAULT_TEXT_OUTLINE,
  TEXT_PRESETS,
  activeTextEffects,
  isTextPresetActive,
} from './panel/textEffectPresets';
import { MATERIALS, MATERIAL_IDS, resolveMaterial } from '../utils/behaviorSystem';
import { TagEditor } from './ui/TagEditor';
import { END_CAP_KINDS, END_CAP_LABELS, MAX_END_SCALE, MIN_END_SCALE, type EndCapKind } from '../engine/model/connectorEnds';

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

/**
 * One collapsible block of the inspector.
 *
 * ## What changed and why
 *
 * The header was 11px **bold uppercase at 0.1em tracking**. That breaks
 * DESIGN.md's rule that tracking is never applied below 16px — and the rule is
 * not arbitrary: opening up an 11px uppercase run is what made this panel read
 * as shouty and cramped at once, a dozen small headings all shouting the same
 * volume as each other down a narrow column. Sentence case at 600 needs no
 * tracking, is quieter against the controls it labels, and is what Figma and
 * the Apple inspectors both use.
 *
 * `aria-controls` and a real region were missing, so a screen reader could hear
 * "collapsed" without being told what had collapsed. The chevron is
 * `aria-hidden` because the button's own `aria-expanded` already carries that
 * state — announcing it twice is worse than not drawing it.
 *
 * The chevron **rotates** rather than swapping glyph. Two different icons at
 * the same spot read as two different controls; one that turns reads as the
 * same control in a different state, which is what it is.
 */
const Accordion: React.FC<{
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** A count or a state word shown beside the title, e.g. an active effect. */
  badge?: string;
}> = ({ title, children, defaultOpen = true, badge }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const id = React.useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-divider)' }}>
      <button
        type="button"
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 16px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left', width: '100%',
        }}
        className="hover-surface prop-section__header"
        aria-expanded={isOpen}
        aria-controls={`${id}-panel`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChevronRight
          size={13}
          color="var(--text-tertiary)"
          aria-hidden="true"
          style={{
            flexShrink: 0,
            transform: isOpen ? 'rotate(90deg)' : 'none',
            transition: 'transform var(--motion-hover)',
          }}
        />
        <span className="prop-section__title">{title}</span>
        {badge && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 'var(--text-2xs)',
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {badge}
          </span>
        )}
      </button>
      {isOpen && (
        <div
          id={`${id}-panel`}
          role="region"
          aria-label={title}
          style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}
        >
          {children}
        </div>
      )}
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

/**
 * One effect inside a section: a switch that owns the controls beneath it.
 *
 * The section this replaced was a flat list — a toggle row, then that effect's
 * five detail rows, then the next toggle row — all at one indentation, so
 * nothing said which rows belonged to which switch. Turning on a highlight
 * grew the panel by five rows that looked exactly like the three above them.
 *
 * The hairline and the inset are doing the whole job: they make "these belong
 * to that" a fact you can see rather than one you have to infer from order.
 * Nothing is drawn at all when the effect is off, so a section with three
 * effects off is three rows, not eighteen.
 */
const SubGroup: React.FC<{
  label: string;
  hint?: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  children?: React.ReactNode;
}> = ({ label, hint, on, onToggle, children }) => (
  <div className="prop-subgroup" data-on={on || undefined}>
    <Row label={label} hint={hint}>
      <Switch checked={on} onChange={onToggle} />
    </Row>
    {on && children && <div className="prop-subgroup__body">{children}</div>}
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
  color: DEFAULT_SHADOW_COLOR,
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
  color: DEFAULT_SHADOW_COLOR,
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
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>Nothing selected</span>
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
   * Which types can be drawn by hand.
   *
   * Shapes and connectors — the two whose renderers actually run the sketcher.
   * A flowchart is the case the feature is for, and boxes that could be
   * sketched joined by arrows that could not left every diagram half-drafted.
   */
  /**
   * Whether everything selected can be drawn by hand.
   *
   * Deliberately **not** gated on `uniformType`. A flowchart selection is
   * boxes *and* the arrows joining them, and that is the single most likely
   * thing anyone wants to sketch in one go — requiring one type meant the
   * control vanished for exactly the selection it was most useful on.
   *
   * Shapes and connectors are the set whose renderers honour it. Paths are
   * excluded on purpose: a freehand stroke is already a hand-drawn mark, so
   * offering to sketch one is a promise with nothing behind it.
   */
  const sketchable =
    nodes.length > 0 && nodes.every((n) => n.type === 'shape' || n.type === 'connector');

  /** Every selected object has an interior — the precondition for shading it. */
  const allClosed =
    nodes.length > 0 &&
    nodes.every((n) => n.type === 'shape' && !isOpenShape(n.geometry.kind));
  /**
   * Whether a connector is in the selection.
   *
   * Connectors reached the paint sections for the first time when they were
   * added to `APPEARANCE_TYPES`, which is right for colour and wrong for the
   * controls that assume an object with an interior. Two are gated off here:
   * **Blend** and **Blur**. Neither was a decision anyone made — both arrived
   * as a side effect of the appearance block, which is exactly the kind of
   * thing to check for when a type is given a capability it never had.
   */
  const hasConnector = nodes.some((n) => n.type === 'connector');
  /** Images carry their own blur in Adjust, so the generic one is suppressed. */
  const hasImage = nodes.some((n) => n.type === 'image');

  /**
   * Whether the selection is mirrored, per axis.
   *
   * Read from the sign of the scale, which is where a flip lives — there is no
   * separate `flipped` field, and adding one would be a second source of truth
   * that a transform drag could contradict.
   */
  const flipX = shared((n) => n.scaleX < 0);
  const flipY = shared((n) => n.scaleY < 0);
  const flipped = { x: Boolean(flipX.value), mixedX: flipX.mixed, y: Boolean(flipY.value), mixedY: flipY.mixed };
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
  const cycleKey =
    Object.entries(CYCLE_PRESETS).find(
      ([, preset]) => preset.colors.join(',') === typography?.colorCycle?.colors.join(',')
    )?.[0] ?? (typography?.colorCycle ? 'rainbow' : 'none');

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

  /**
   * Recolour a fill-less object, and remember it if it was a connector.
   *
   * Colour on a drawing tool is normally chosen *before* you draw — you do not
   * pick the pen up and then go back and repaint every line. There is no
   * pre-flight swatch on the connector tool, so the next best thing is that it
   * keeps the last colour you actually chose: recolour one arrow and the ones
   * you draw after it come out the same, instead of reverting to the theme
   * default every single time.
   *
   * Only for a uniform connector selection: recolouring a mixed bag of lines
   * and arrows says nothing about what the connector tool should do next.
   */
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
  const nudgeEach = (
    key: 'x' | 'y' | 'rotation' | 'opacity' | 'skewX' | 'skewY',
    delta: number,
    min?: number,
    max?: number
  ) =>
    patchEach((n) => {
      // Skew is absent when unsheared, so a nudge from nothing starts at zero
      // rather than turning the field into NaN on its first arrow press.
      let next = ((n[key] as number | undefined) ?? 0) + delta;
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
      // Falls back through the palette that already answers "what colour is
      // this person", rather than a literal pink chosen here. A second
      // opinion about identity colour is how one person ends up two colours
      // in two surfaces of the same app.
      activeEditors.push({
        name: state.user.name || 'Teammate',
        color: state.user.color || getColorForUser(String(clientId)),
      });
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
          {/* `data-tooltip` rather than `title`, so these match every other
              control in the panel — a native tooltip appears after a browser
              delay, in a different typeface, in a different place, and reads as
              a different application. `aria-pressed` carries the state the icon
              cannot: a flipped object looks identical to an unflipped one, and
              the button is the only thing that knows. */}
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
        {/* Shear, in degrees, about the centre — Illustrator's Shear Tool as a
            pair of numbers rather than a drag, because a precise angle is the
            thing the tool is for and the transformer already owns the
            free-form gestures. Per object and mixed-aware, the same as
            rotation and for the same reason: there is no single shear for a
            selection that disagrees. */}
        <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
          {(['skewX', 'skewY'] as const).map((axis) => {
            const s = shared((n) => n[axis] ?? 0);
            return (
              <NumberStepper
                key={axis}
                value={Math.round(s.value ?? 0)}
                mixed={s.mixed}
                // Stored absent rather than as zero, so an unsheared node
                // stays byte-identical to every document written before shear
                // existed.
                onChange={(v) => set({ [axis]: v === 0 ? undefined : v } as Partial<AnyNode>)}
                onNudge={(d) => nudgeEach(axis, d)}
                label={axis === 'skewX' ? 'SX' : 'SY'}
                suffix="deg"
                min={-89} max={89}
                step={5}
              />
            );
          })}
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
          {/* The hand-drawn look, per object.

              Three named hands rather than a slider, and they differ in *how
              the pen behaves* rather than in one amplitude: Light is a single
              confident pass, Medium goes round twice — the look people
              recognise — and Heavy goes round twice and crosses well past
              every corner. An amplitude knob was tried first and could not
              produce three usable settings, because turning displacement up
              makes a shape read as broken rather than as drawn. */}
          {/* Radius belongs to Appearance, with fill and opacity.
              It briefly followed the Sketch controls into the Stroke section
              when those moved, and Stroke is gated on `supportsStroke` — which
              an image does not have. So images silently lost their corner
              radius even though the renderer had always drawn one. A control
              that exists and cannot be reached is the same defect as one that
              was never built. */}
          {/* No longer rectangles only. Corner rounding is real geometry now —
              `roundCorners` fillets any sharp junction — so a triangle, a
              hexagon, a star and a heart all answer this control. Open runs
              still do not: a line has no corner. */}
          {capabilities.supportsRadius && !openShape && (
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
          {/**
            * The colour of an object that has no fill.
            *
            * A connector is a line and nothing else: its stroke colour is not
            * one of its properties, it is the whole of its appearance. Left
            * only in the Stroke accordion it sat beside weight, dash and caps
            * — correct filing, and invisible, because nobody opens a section
            * called Stroke to answer "what colour is this arrow". The same is
            * true of any object the registry gives a stroke and no fill.
            *
            * So it appears here, where the fill swatch sits for everything
            * that has one, and the Stroke accordion drops its own Color row
            * in this case rather than offering the identical control twice.
            */}
          {!capabilities.supportsFill && capabilities.supportsStroke && appearance && (
            <Row label="Color">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <ColorPickerPopover
                  color={appearance.stroke?.color ?? 'transparent'}
                  mixed={sharedPaint((a) => a.stroke?.color ?? 'transparent').mixed}
                  onChange={(color) => setConnectorLikeColor(color)}
                />
                <EyedropperButton
                  label="Pick a colour from the screen"
                  onPick={(color) => setConnectorLikeColor(color)}
                />
              </div>
            </Row>
          )}
          {/* Blend mode sits with the rest of the paint because that is what it
              is: how the object looks against what is behind it. Offered
              wherever `appearance` exists, because `ObjectRenderer` applies it
              to the whole node group and not to one shape inside it — so it
              works on an image and a path exactly as it works on a rectangle.

              Not on connectors. A connector's whole job is to stay legible
              across whatever it crosses, and every mode here works against
              that: multiply darkens it into the shapes it runs over, screen
              washes it out. It appeared there only as a side effect of
              connectors finally being given an appearance block at all. */}
          {appearance && !hasConnector && (
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

      {capabilities.supportsStroke && appearance && (
        <Accordion
          title="Stroke"
          // Open when there is a stroke *or* a sketch. Sketch moved into this
          // section, and a shape with no stroke weight left it collapsed —
          // burying the control that had just been given a better home.
          defaultOpen={Boolean(appearance.stroke?.width || appearance.sketch)}
        >
          {/* Offered up in Appearance instead when the object has no fill, so
              a connector shows one colour control rather than two. */}
          {capabilities.supportsFill && (
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
          )}
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

          {/* Sketch lives with Stroke, not with Fill.
              It is a decision about *how the marks are made* — the same
              question the dash pattern answers — and it is orthogonal to both:
              a dashed sketch is a real thing, so these stay separate controls
              rather than one merged "style" enum that would make them
              mutually exclusive for no reason but its own shape. */}
          {/* Offered for shapes and connectors, which is exactly the set whose
              renderers honour it. Deliberately *not* for paths: a freehand
              stroke is already a hand-drawn mark, and sketching one is a
              promise with nothing behind it. Declaring a capability the
              renderer ignores is the failure this codebase names most often. */}
          {sketchable && appearance && (
            <Row label="Sketch" hint="Draw this by hand. The result is stable — it never re-randomises.">
              {(() => {
                const sketch = sharedPaint((a) => a.sketch ?? 'off');
                return (
                  <SegmentedControl
                    ariaLabel="Hand-drawn sketch"
                    mixed={sketch.mixed}
                    value={String(sketch.value ?? 'off')}
                    onChange={(v) =>
                      setAppearance({ sketch: v === 'off' ? undefined : (v as SketchLevel) })
                    }
                    segments={[
                      { value: 'off', label: 'Off — a ruled shape', icon: <SketchLevelIcon level="off" /> },
                      { value: 'light', label: 'Light — one confident pass', icon: <SketchLevelIcon level="light" /> },
                      { value: 'medium', label: 'Medium — drawn twice', icon: <SketchLevelIcon level="medium" /> },
                      { value: 'heavy', label: 'Heavy — twice, and past every corner', icon: <SketchLevelIcon level="heavy" /> },
                    ]}
                  />
                );
              })()}
            </Row>
          )}
          {/* Shading, and only where there is a sketch for it to belong to.
              Hachure on a crisp machine-drawn rectangle is a mixed metaphor:
              the strokes say "a hand did this" while the outline says the
              opposite. Offered as specimens rather than words because the
              difference between hachure and cross-hatch is entirely visual. */}
          {/* Every selected object must have an interior to shade. `openShape`
              alone reads only the *primary* node, so a selection mixing a
              rectangle with a line would have offered hachure and applied it
              to something with no inside. */}
          {sketchable && capabilities.supportsFill && appearance?.sketch && allClosed && (
            <Row label="Shading" hint="How the inside is filled: flat colour, or pen strokes laid across it.">
              {(() => {
                const style = sharedPaint((a) => a.fillStyle ?? 'solid');
                return (
                  <SegmentedControl
                    ariaLabel="Sketch fill style"
                    mixed={style.mixed}
                    value={String(style.value ?? 'solid')}
                    onChange={(v) =>
                      setAppearance({ fillStyle: v === 'solid' ? undefined : (v as FillStyle) })
                    }
                    segments={[
                      { value: 'solid', label: 'Solid — a flat fill', icon: <FillStyleIcon style="solid" /> },
                      { value: 'hachure', label: 'Hachure — parallel pen strokes', icon: <FillStyleIcon style="hachure" /> },
                      { value: 'crosshatch', label: 'Cross-hatch — two sets, crossed', icon: <FillStyleIcon style="crosshatch" /> },
                    ]}
                  />
                );
              })()}
            </Row>
          )}
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

      {/* Blur, with the shadows rather than inside Appearance.
          Layer blur and backdrop blur used to sit under "Appearance", two rows
          below Fill, while the two shadows were top-level sections of their
          own — so the four effects an object can carry were split across two
          places on no principle at all. They are all effects; they are all
          here; and paint is only paint. */}
      {/* Only when at least one row inside it will actually render.
          Suppressing the Layer row for images left this section with nothing
          in it — Backdrop needs `supportsEdgeEffects`, which an image does not
          declare — so an image showed an accordion that opened onto empty
          space. An empty disclosure is worse than a missing one: it promises a
          control, costs a click to find out there is none, and does it again
          every time. */}
      {/* Not on connectors, for the same reason Blend is not. Both blurs
          assume an object with an interior and something meaningful behind it.
          A connector is a hairline: layer blur turns a 2px stroke into a smear
          and destroys the one property the object exists to have, which is
          being followable from one end to the other; backdrop blur is
          invisible under a stroke that thin. Like Blend, it appeared here only
          as a side effect of connectors finally being given an appearance
          block, and an accordion of controls that do nothing worth doing is
          the empty-disclosure problem above with extra steps. */}
      {appearance && !hasConnector && (!hasImage || (capabilities.supportsEdgeEffects && !openShape)) && (
        <Accordion
          title="Blur"
          defaultOpen={Boolean(appearance.blur || appearance.backdropBlur)}
        >
          {/* Not offered on an image, which already has a blur of its own in
              Adjust. Two controls both named Blur on one object, doing visibly
              the same thing, is a question the user has to answer before they
              can use either — and for a photograph the adjustment is the one
              that belongs. Backdrop stays, because blurring *what is behind*
              an object is a different effect and an image is a good place to
              want it. */}
          {!hasImage && (
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
          )}
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

      {capabilities.supportsTypography && typography && (
        <Accordion title="Typography">
          <FontSelector value={typography.fontFamily} onChange={(fontFamily) => setTypography({ fontFamily })} />
          <Row label="Size">
            {(() => {
              const size = sharedType((t) => t.fontSize);
              return (
                <NumberStepper
                  /* Rounded for display *and* on write. A drag stores an
                     arbitrary real factor, so a box scaled by hand carried a
                     size like 24.424470292956038 — which is not a size anyone
                     set, is not one any renderer resolves, and reads as the
                     software having failed rather than as a number. */
                  value={Math.round(size.value ?? 16)}
                  mixed={size.mixed}
                  onChange={(fontSize) => setTypography({ fontSize: Math.round(fontSize) })}
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
          {/* A list is a property of the block, not markup inside the text —
              see `Typography.list`. So it is a row here rather than something
              you type, and turning it off leaves exactly the text you wrote. */}
          {/* Which preset the current ramp is, matched by its colours rather
              than by a stored name — the ramp is the truth, so a document
              written before a preset was renamed still lights the right chip. */}
          {(() => null)()}
          {/* The ramp, and how finely it is handed out. Two rows rather than
              one control, because "which colours" and "how big a piece" are
              independent choices and a combined picker would have to enumerate
              every pairing. */}
          <Row label="Colour cycle" hint="Spreads a ramp of colours across the whole block. Editing the text re-spaces it.">
            <SegmentedControl
              ariaLabel="Colour ramp"
              mixed={sharedType((t) => t.colorCycle?.colors.join(',') ?? 'none').mixed}
              value={cycleKey}
              onChange={(key) => setTypography({
                colorCycle: key === 'none'
                  ? undefined
                  : {
                      unit: typography.colorCycle?.unit ?? 'character',
                      colors: CYCLE_PRESETS[key].colors,
                      ...(typography.colorCycle?.repeat ? { repeat: typography.colorCycle.repeat } : null),
                    },
              })}
              segments={[
                { value: 'none', label: 'None', hint: 'One flat colour', icon: <Minus size={14} /> },
                ...Object.entries(CYCLE_PRESETS).map(([key, preset]) => ({
                  value: key,
                  label: preset.label,
                  hint: preset.label,
                  // The ramp itself as the swatch, so the choice is visible
                  // rather than named — six words for six presets would say
                  // nothing about what any of them looks like.
                  icon: (
                    <span
                      aria-hidden
                      style={{
                        display: 'block', width: 16, height: 10, borderRadius: 2,
                        background: `linear-gradient(90deg, ${preset.colors.join(', ')})`,
                      }}
                    />
                  ),
                })),
              ]}
            />
          </Row>
          {typography.colorCycle && (
            <Row label="Cycle by" hint="A colour per letter reads as a gradient; a colour per word stays legible at small sizes.">
              <SegmentedControl
                ariaLabel="Colour cycle unit"
                value={typography.colorCycle.unit}
                onChange={(unit) => setTypography({
                  colorCycle: { ...typography.colorCycle!, unit: unit as CycleUnit },
                })}
                segments={[
                  { value: 'character', label: 'Letter', hint: 'Every character', icon: <span style={{ fontSize: 11, fontWeight: 600 }}>A</span> },
                  { value: 'word', label: 'Word', hint: 'Every word', icon: <Type size={13} /> },
                ]}
              />
            </Row>
          )}
          <Row label="List" hint="Marks every paragraph in this block. An empty line is a spacer and takes no marker.">
            <SegmentedControl
              ariaLabel="List style"
              mixed={sharedType((t) => t.list ?? 'none').mixed}
              value={typography.list ?? 'none'}
              onChange={(v) => setTypography({ list: v === 'none' ? undefined : (v as ListStyle) })}
              segments={[
                { value: 'none', label: 'None', hint: 'No list', icon: <Minus size={14} /> },
                { value: 'bullet', label: 'Bullet', hint: 'A round dot', icon: <List size={14} /> },
                { value: 'dash', label: 'Dash', hint: 'An en dash', icon: <span style={{ fontSize: 12, fontWeight: 700 }}>&#8211;</span> },
                { value: 'circle', label: 'Hollow', hint: 'An open circle', icon: <span style={{ fontSize: 12 }}>&#9702;</span> },
                { value: 'number', label: 'Numbered', hint: '1. 2. 3.', icon: <ListOrdered size={14} /> },
                { value: 'letter', label: 'Lettered', hint: 'a. b. c.', icon: <span style={{ fontSize: 11, fontWeight: 600 }}>a.</span> },
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
          {/* Leading opens up every line; this opens up only the gap between
              blocks. They are separate controls because they are separate
              questions, and raising leading to separate two paragraphs is the
              workaround this exists to remove. */}
          <Row label="Paragraph" hint="Extra space between paragraphs, on top of the leading.">
            {(() => {
              const ps = sharedType((t) => t.paragraphSpacing ?? 0);
              return (
                <NumberStepper
                  value={ps.value ?? 0}
                  mixed={ps.mixed}
                  onChange={(v) => setTypography({ paragraphSpacing: v > 0 ? v : undefined })}
                  min={0} max={200} step={2}
                />
              );
            })()}
          </Row>
          {/* Which of the box's dimensions follow the words. Replaces
              `autoHeight`, which was written by the normalizer and the text
              tool and read by nothing — and could only express two of these
              three, which is part of why nothing ever consumed it. */}
          {uniformType && node.type === 'text' && (
            <Row label="Resize" hint="Auto width grows sideways. Auto height wraps and grows down. Fixed imposes both — and is the mode where dragging an edge stretches the letterforms.">
              <SegmentedControl
                ariaLabel="Text box resizing"
                mixed={shared((n) => (n.type === 'text' ? n.resize : null)).mixed}
                value={node.resize}
                onChange={(v) => set({ resize: v as TextResize } as Partial<AnyNode>)}
                segments={[
                  { value: 'width', label: 'Auto width — the box is as wide as the longest line', icon: <MoveHorizontal size={14} /> },
                  { value: 'height', label: 'Auto height — wraps at this width and grows down', icon: <MoveVertical size={14} /> },
                  { value: 'fixed', label: 'Fixed — both dimensions imposed; drag an edge to stretch the type', icon: <Square size={14} /> },
                ]}
              />
            </Row>
          )}
        </Accordion>
      )}

      {/* Text effects — the block-level treatments, kept out of Typography
          because they are not properties of the type. Typography answers
          "what do the letters look like"; these answer "what is drawn around
          them", and they all need the per-line boxes that
          `engine/text/layout.ts` computes rather than anything a font knows.

          Structured as presets first, then three groups that each own their
          own controls. The flat stack this replaces put twelve rows at one
          level with no indication which belonged to what, so turning on a
          highlight grew the section by five rows indistinguishable from the
          three above them. Presets are also how people actually reach for
          this: nobody wants to specify a radius and a padding, they want the
          look they have already seen somewhere. */}
      {capabilities.supportsTypography && typography && (
        <Accordion
          title="Text effects"
          badge={activeTextEffects(typography)}
          defaultOpen={Boolean(typography.highlight || typography.outline || typography.glow)}
        >
          {/* The looks, one click each. `TEXT_PRESETS` owns what each one
              means, so a preset's values are not spread through the panel. */}
          <div className="prop-presets" role="group" aria-label="Text effect presets">
            {TEXT_PRESETS.map((preset) => {
              const active = isTextPresetActive(preset, typography);
              return (
                <button
                  key={preset.id}
                  type="button"
                  className="prop-preset"
                  data-active={active || undefined}
                  aria-pressed={active}
                  onClick={() => setTypography(preset.patch(typography))}
                  data-tooltip={preset.hint}
                  data-tooltip-pos="top"
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <SubGroup
            label="Highlight"
            hint="A rounded plate behind each line, sized to that line's own words."
            on={Boolean(typography.highlight)}
            onToggle={(on) => setTypography({ highlight: on ? DEFAULT_TEXT_HIGHLIGHT : undefined })}
          >
            {typography.highlight && (
              <>
                <Row label="Colour">
                  <ColorPickerPopover
                    color={typography.highlight.color}
                    onChange={(color) =>
                      setTypography({ highlight: { ...typography.highlight!, color } })
                    }
                  />
                </Row>
                <Row label="Shape" hint="Ribbon welds the lines into one shape with tucked corners. Plates keeps each line separate.">
                  <SegmentedControl
                    ariaLabel="Highlight shape"
                    value={typography.highlight.join}
                    onChange={(v) =>
                      setTypography({
                        highlight: { ...typography.highlight!, join: v as 'ribbon' | 'plates' },
                      })
                    }
                    segments={[
                      { value: 'ribbon', label: 'Ribbon' },
                      { value: 'plates', label: 'Plates' },
                    ]}
                  />
                </Row>
                <Row label="Corner" hint="How round each corner of the plate is.">
                  <NumberStepper
                    value={typography.highlight.radius}
                    onChange={(radius) =>
                      setTypography({ highlight: { ...typography.highlight!, radius } })
                    }
                    min={0}
                    max={60}
                    step={1}
                    suffix="px"
                  />
                </Row>
                <Row label="Padding" hint="Breathing room either side of each line's words.">
                  <NumberStepper
                    value={typography.highlight.paddingX}
                    onChange={(paddingX) =>
                      setTypography({ highlight: { ...typography.highlight!, paddingX } })
                    }
                    min={0}
                    max={80}
                    step={1}
                    suffix="px"
                  />
                </Row>
                {/* A highlight is picked for how it reads against the board; the
                    words then have to stay legible against *it*, which is a
                    different question and one people reliably get wrong. */}
                <Row label="Auto ink" hint="Choose the text colour automatically, by contrast against the highlight.">
                  <Switch
                    checked={Boolean(typography.highlight.autoContrast)}
                    onChange={(autoContrast) =>
                      setTypography({
                        highlight: {
                          ...typography.highlight!,
                          autoContrast: autoContrast || undefined,
                        },
                      })
                    }
                  />
                </Row>
              </>
            )}
          </SubGroup>

          <SubGroup
            label="Outline"
            hint="A stroke around the letterforms, drawn wholly outside them."
            on={Boolean(typography.outline)}
            onToggle={(on) => setTypography({ outline: on ? DEFAULT_TEXT_OUTLINE : undefined })}
          >
            {typography.outline && (
              <>
                <Row label="Colour">
                  <ColorPickerPopover
                    color={typography.outline.color}
                    onChange={(color) =>
                      setTypography({ outline: { ...typography.outline!, color } })
                    }
                  />
                </Row>
                <Row label="Weight">
                  <NumberStepper
                    value={typography.outline.width}
                    onChange={(width) =>
                      setTypography({ outline: { ...typography.outline!, width } })
                    }
                    min={0.5}
                    max={20}
                    step={0.5}
                    suffix="px"
                  />
                </Row>
              </>
            )}
          </SubGroup>

          <SubGroup
            label="Glow"
            hint="A soft halo behind the words. Takes the place of the layer shadow."
            on={Boolean(typography.glow)}
            onToggle={(on) => setTypography({ glow: on ? DEFAULT_TEXT_GLOW : undefined })}
          >
            {typography.glow && (
              <>
                <Row label="Colour">
                  <ColorPickerPopover
                    color={typography.glow.color}
                    onChange={(color) => setTypography({ glow: { ...typography.glow!, color } })}
                  />
                </Row>
                <Row label="Spread">
                  <NumberStepper
                    value={typography.glow.blur}
                    onChange={(blur) => setTypography({ glow: { ...typography.glow!, blur } })}
                    min={1}
                    max={100}
                    step={1}
                    suffix="px"
                  />
                </Row>
              </>
            )}
          </SubGroup>
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
          {/* The same six styles a connector offers, through the same control
              and the same specimens. These were two raw checkboxes — the only
              unstyled input left in this panel — and they could express one
              shape of head where a connector could express five. A line and a
              connector are both a run with two ends; which tool drew it should
              not decide what you can put on it. */}
          {/* One size for both ends. Two independent sizes is a control nobody
              asks for — an arrow with a big head and a small tail reads as a
              mistake — and it would double this section for a case that does
              not exist. */}
          <Row label="End size" hint="How big both markers are, relative to the stroke.">
            {(() => {
              const scale = shared((n) => (n.type === 'shape' ? n.geometry.endScale ?? 1 : null));
              return (
                <NumberStepper
                  value={Math.round((scale.value ?? 1) * 100)}
                  mixed={scale.mixed}
                  onChange={(v) => setGeometry({ endScale: v === 100 ? undefined : v / 100 })}
                  min={MIN_END_SCALE * 100}
                  max={MAX_END_SCALE * 100}
                  step={25}
                  suffix="%"
                />
              );
            })()}
          </Row>
          {(['endStart', 'endEnd'] as const).map((side) => (
            <Row
              key={side}
              label={side === 'endStart' ? 'Start' : 'End'}
              hint={side === 'endStart' ? 'What sits at the first end.' : 'What sits at the second end.'}
            >
              <SegmentedControl
                ariaLabel={side === 'endStart' ? 'Start of the line' : 'End of the line'}
                mixed={shared((n) => (n.type === 'shape' ? n.geometry[side] ?? 'none' : null)).mixed}
                value={node.geometry[side] ?? 'none'}
                onChange={(v) => setGeometry({ [side]: v as EndCapKind })}
                segments={END_CAP_KINDS.map((kind) => ({
                  value: kind,
                  label: END_CAP_LABELS[kind],
                  icon: <EndCapIcon kind={kind} flip={side === 'endStart'} />,
                }))}
              />
            </Row>
          ))}
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
          {/* The same control the line gets, for the same reason. */}
          <Row label="End size" hint="How big both markers are, relative to the stroke.">
            {(() => {
              const scale = shared((n) => (n.type === 'connector' ? n.endScale ?? 1 : null));
              return (
                <NumberStepper
                  value={Math.round((scale.value ?? 1) * 100)}
                  mixed={scale.mixed}
                  onChange={(v) => set({ endScale: v === 100 ? undefined : v / 100 } as Partial<AnyNode>)}
                  min={MIN_END_SCALE * 100}
                  max={MAX_END_SCALE * 100}
                  step={25}
                  suffix="%"
                />
              );
            })()}
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

      {/* The safe area, for the frame sizes where part of the rectangle is
          covered by something that is not yours. Seeded from the preset and
          editable here, because the presets can only cover the cases that are
          the same for everyone — a slide deck's own template, or a printer
          with a wider margin than most, is a number only the person making it
          knows. Four edges rather than one: a story's insets are not
          symmetrical, and forcing them to be would waste 320 units of width to
          protect against nothing. */}
      {uniformType && node.type === 'frame' && (
        <Accordion title="Safe area" defaultOpen={Boolean(node.safeArea)}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
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
