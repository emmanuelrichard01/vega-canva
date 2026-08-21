import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlignCenter, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart,
  AlignHorizontalSpaceAround, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalSpaceAround, Bold, BringToFront, Copy, Crop, Download,
  Droplet, FlipHorizontal, FlipVertical, Group, ImageIcon, Italic, List, ListOrdered, Layers, Lock, Menu, MessageSquare,
  MessageSquarePlus, Mic, Minus, PenLine, Pin, Scissors, SendToBack, SmilePlus, Spline,
  SquaresExclude, SquaresIntersect, SquaresSubtract, SquaresUnite, Square, StickyNote,
  Strikethrough, Trash2, Type, Underline, Ungroup, Unlock,
} from 'lucide-react';

import {
  applyNodePatches, localAuthorId, lowestZIndex, nextZIndex, toggleReaction, updateNodes,
} from '../engine/document';
import { useStore } from '../hooks/useStore';
import { cameraSystem } from '../engine/CameraSystem';
import { engineEvents } from '../engine/EventBus';
import { cropMode } from '../engine/interaction/cropMode';
import { pathEdit } from '../engine/interaction/pathEdit';
import { Palette, Shuffle } from 'lucide-react';
import { GridKindIcon } from './workspace/gridIcons';
import { gridGroupOf } from './panel/GridSection';
import { gridRecipe as gridRecipeFor, relayoutGrid } from '../engine/grid/gridApply';
import { switchKind } from '../engine/grid/gridBuild';
import { GRID_HINTS, GRID_KINDS, GRID_LABELS } from '../engine/grid/gridLayout';
import { GRID_PALETTES } from '../engine/grid/gridStyle';
import {
  alignPickedAnchors,
  deletePickedAnchor,
  setPickedAnchorMode,
} from './canvas/PathEditor';
import { applyBoolean, canVectorize, flattenToPath, outlineStrokeOf } from '../engine/document/vectorOps';
import { BOOLEAN_OPS, type BooleanOp } from '../engine/model/pathBoolean';
import { deleteNodesWithFrames } from '../engine/interaction/frameMembership';
import { editor } from '../engine/api/EditorAPI';
import { nanoid } from 'nanoid';
import { ColorPickerPopover } from './ui/ColorPickerPopover';
import { isInsidePortalSurface } from './ui/portalSurface';
import { FillEditor } from './ui/FillEditor';
import { SegmentedControl } from './ui/SegmentedControl';
import { FontSelector } from './ui/FontSelector';

/** The hand-drawn faces, so the toggle knows which state it is in. */
const HANDWRITTEN = ['Caveat', 'Architects Daughter'];
import { THEMES } from './canvas/renderers/StickyRenderer';
import { STICKY_THEMES, type StickyTheme } from '../engine/model/schema';
import {
  DEFAULT_INK, DEFAULT_TYPOGRAPHY, MAX_POLYGON_SIDES, MIN_POLYGON_SIDES, isOpenShape,
  type AnyNode, type Appearance, type ConnectorNode, type FillStyle, type ShapeKind, type SketchLevel,
  type ListStyle, type TextAlign, type Typography,
} from '../engine/model/schema';
import { FillStyleIcon, SketchLevelIcon } from './panel/sketchIcons';
import { EndCapIcon, RouteIcon } from './panel/connectorIcons';
import { StrokeWeightIcon } from './panel/strokeWeightIcon';
import { LineSpecimen } from './panel/lineSpecimen';
import { LineProfileIcon } from './panel/lineProfileIcons';
import { LINE_PROFILES, LINE_PROFILE_LABELS, MIN_WAVES, type LineProfile } from '../engine/model/linePath';
import { ShapeIcon } from './workspace/shapeIcons';
import { END_CAP_KINDS, END_CAP_LABELS, MAX_END_SCALE, MIN_END_SCALE, type EndCapKind } from '../engine/model/connectorEnds';
import type { Routing } from '../engine/model/connector';
import { resolveAffordances, type AffordanceId } from '../engine/selection/affordances';
import { alignSelection, distributeSelection, type AlignEdge } from '../engine/model/align';
import { sharedValue } from '../engine/model/selection';

/**
 * The floating quick-actions rail.
 *
 * ## What changed and why
 *
 * The version this replaces was a two-row panel: a tools row stacked over a
 * "global actions" row. Three things were wrong with that, and all three are
 * structural rather than cosmetic.
 *
 * 1. **Its height changed with the selection**, because the top row's contents
 *    did. Moving between a shape and a sticky made the toolbar resize and jump
 *    over the artwork it is supposed to sit quietly above.
 * 2. **It was a panel, not a rail.** Once a surface has two rows and its own
 *    internal labels — "FILL", "OPACITY" — it has stopped being a heads-up
 *    control and become a second properties panel parked on the canvas, which
 *    is the one thing this surface exists to let you avoid.
 * 3. **It declared elevation twice**, hand-rolling `0 8px 32px …, 0 0 0 1px …`
 *    beside the committed `--shadow-float`, which already carries an offset, a
 *    blur and a hairline ring tuned per theme.
 *
 * The rebuild is one 40px row whatever is selected. Anything that does not fit
 * hangs off a single button in a popover. Density is the point.
 *
 * ## The two states
 *
 * One object selected gives the per-type rail. Several give the **union rail**:
 * everything type-specific drops away and what remains is structure (group,
 * booleans), arrangement (align, distribute), and the properties every visual
 * object has. A control that cannot apply to all of the selection is not shown
 * at all rather than silently acting on part of it.
 */

// Matches .hierarchy-panel / .context-inspector in index.css:
// `--shell-inset` (28px, set by the vertical ruler's width) + `--panel-w` (260).
const SIDEBAR_WIDTH = 288;
const BOTTOM_DOCK_HEIGHT = 76;
const EDGE_MARGIN = 16;
/** Clearance between the rail and the selection box it describes. */
const STANDOFF = 14;
const RAIL_HEIGHT = 40;

/** Small, deliberately-limited reaction set — a full emoji picker is noise here. */
const REACTION_SET = ['👍', '❤️', '🎯', '🔥', '❓'];

/**
 * The eight papers, offered as themselves.
 *
 * ## Why not the colour picker
 *
 * A sticky's colour is a **closed set of named themes** — the palette is
 * designed as eight paper-and-ink pairs, each ink a deep version of its own
 * paper so the note reads as one material. The toolbar was handing that to a
 * full RGB picker and then running `nearestTheme` over whatever came back.
 *
 * So the control offered sixteen million colours and honoured eight, silently
 * snapping every choice to something the user did not pick. It is the same sin
 * as a field the renderer ignores, arrived at from the other side: a control
 * that appears to do more than it does. It was also slow — a spectrum, a
 * gradient area and a hex field, to make a one-of-eight decision.
 *
 * Showing the eight directly is both more honest and fewer clicks: one press
 * to open, one to choose, and the options *are* the answer.
 */
const StickyPalette: React.FC<{
  theme: StickyTheme;
  onPick: (theme: StickyTheme) => void;
}> = ({ theme, onPick }) => (
  <RailPopover
    label="Note colour"
    align="start"
    trigger={
      <span
        className="ctx-sticky-swatch"
        style={{ background: THEMES[theme]?.bg, borderColor: THEMES[theme]?.edge }}
      />
    }
  >
    <span className="ctx-popover__label">Note colour</span>
    <div className="ctx-sticky-grid">
      {STICKY_THEMES.map((id) => {
        const paper = THEMES[id];
        return (
          <button
            key={id}
            type="button"
            className="ctx-sticky-chip"
            aria-pressed={id === theme}
            aria-label={id}
            data-tooltip={id[0].toUpperCase() + id.slice(1)}
            onClick={() => onPick(id)}
            style={{ background: paper.bg, borderColor: paper.edge, color: paper.text }}
          >
            {/* The letter is the note's own ink on its own paper, so each chip
                previews the pairing rather than just the background — which is
                the half of the choice that decides whether text reads. */}
            Aa
          </button>
        );
      })}
    </div>
  </RailPopover>
);

/**
 * Corner or smooth, drawn rather than lettered.
 *
 * The two states an anchor can be in are a shape, and the anchors themselves
 * are already drawn square and round to say which — so the buttons that set
 * them use the same two shapes. A pair of words would be a second vocabulary
 * for a distinction the canvas has already taught.
 */
const CornerIcon: React.FC<{ rounded: boolean }> = ({ rounded }) => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
    <path
      d={rounded ? 'M3 12 Q3 3 12 3' : 'M3 12 V3 H12'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
    />
    <circle cx="3" cy="12" r="1.8" fill="currentColor" />
  </svg>
);

const TYPE_LABEL: Record<string, { icon: React.ReactNode; name: string }> = {
  shape: { icon: <Square size={15} />, name: 'Shape' },
  text: { icon: <Type size={15} />, name: 'Text' },
  image: { icon: <ImageIcon size={15} />, name: 'Image' },
  sticky: { icon: <StickyNote size={15} />, name: 'Note' },
  audio: { icon: <Mic size={15} />, name: 'Voice' },
  comment: { icon: <MessageSquare size={15} />, name: 'Comment' },
  path: { icon: <PenLine size={15} />, name: 'Path' },
  frame: { icon: <Layers size={15} />, name: 'Frame' },
};

const BOOLEAN_BUTTONS: Record<BooleanOp, { icon: React.ReactNode; label: string }> = {
  union: { icon: <SquaresUnite size={16} />, label: 'Union' },
  subtract: { icon: <SquaresSubtract size={16} />, label: 'Subtract front from back' },
  intersect: { icon: <SquaresIntersect size={16} />, label: 'Intersect' },
  exclude: { icon: <SquaresExclude size={16} />, label: 'Exclude overlap' },
};

const ALIGN_BUTTONS: Array<{ edge: AlignEdge; label: string; icon: React.ReactNode }> = [
  { edge: 'left', label: 'Align left', icon: <AlignHorizontalJustifyStart size={16} /> },
  { edge: 'centerX', label: 'Align horizontal centres', icon: <AlignHorizontalJustifyCenter size={16} /> },
  { edge: 'right', label: 'Align right', icon: <AlignHorizontalJustifyEnd size={16} /> },
  { edge: 'top', label: 'Align top', icon: <AlignVerticalJustifyStart size={16} /> },
  { edge: 'middleY', label: 'Align vertical centres', icon: <AlignVerticalJustifyCenter size={16} /> },
  { edge: 'bottom', label: 'Align bottom', icon: <AlignVerticalJustifyEnd size={16} /> },
];

/**
 * The shapes a shape can become, drawn rather than named.
 *
 * `points` travels with the choice because a polygon and a star are the same
 * `kind` field plus a count — switching to "triangle" is `polygon` at 3, and
 * leaving the previous shape's count in place would turn a hexagon into a
 * three-sided "triangle" that still said six.
 */
/**
 * The shapes this swapper offers, wearing the dock's own glyphs.
 *
 * They were lucide icons, which is where a **hexagon drawn as a spline** came
 * from — lucide has no hexagon, so a curve stood in for one, and the tile that
 * turns a shape into a six-sided polygon showed a wiggle. `ShapeIcon` already
 * generates the whole set from side counts for the tool dock, so the swapper
 * and the dock now show the same mark for the same shape and no glyph is a
 * stand-in for a shape the library happened not to have.
 */
const SHAPE_CHOICES: Array<{ kind: ShapeKind; points?: number; label: string; icon: React.ReactNode }> = [
  { kind: 'rect', label: 'Rectangle', icon: <ShapeIcon kind="rect" size={16} /> },
  { kind: 'ellipse', label: 'Ellipse', icon: <ShapeIcon kind="ellipse" size={16} /> },
  { kind: 'polygon', points: 3, label: 'Triangle', icon: <ShapeIcon kind="triangle" size={16} /> },
  { kind: 'polygon', points: 5, label: 'Pentagon', icon: <ShapeIcon kind="pentagon" size={16} /> },
  { kind: 'polygon', points: 6, label: 'Hexagon', icon: <ShapeIcon kind="hexagon" size={16} /> },
  { kind: 'polygon', points: 8, label: 'Octagon', icon: <ShapeIcon kind="octagon" size={16} /> },
  { kind: 'star', points: 5, label: 'Star', icon: <ShapeIcon kind="star" size={16} /> },
  { kind: 'heart', label: 'Heart', icon: <ShapeIcon kind="heart" size={16} /> },
  { kind: 'line', label: 'Line', icon: <ShapeIcon kind="line" size={16} /> },
  { kind: 'arrow', label: 'Arrow', icon: <ShapeIcon kind="arrow" size={16} /> },
];

/**
 * The rail's shell.
 *
 * **Defined at module scope, and that is load-bearing.** It used to be declared
 * inside `ObjectContextToolbar`'s body, which creates a brand-new component
 * *type* on every render — so React could not match it against the previous
 * tree and unmounted and remounted the entire rail each time anything changed.
 * The visible symptom was the toolbar disappearing the moment you tried to use
 * it: opening the stroke or opacity popover re-rendered the parent, the remount
 * destroyed that popover's `open` state, and `AnimatePresence` replayed the
 * entrance on what looked like a new element. It also meant a fresh mount on
 * every frame the position changed.
 *
 * Three layers, because three different things want to write a transform and
 * none of them may share one:
 *   anchor   — where the selection is, written from the frame loop
 *   centring — static, so the rail hangs off that point correctly
 *   motion   — the entrance, owned entirely by framer-motion
 *
 * Centring is its own element rather than a margin on the rail: a percentage
 * margin resolves against the parent's width, and the parent here shrink-wraps
 * its child, which makes `-50%` circular.
 */
const Rail = React.forwardRef<
  HTMLDivElement,
  {
    id: string;
    placement: 'top' | 'bottom';
    anchorRef: React.RefObject<HTMLDivElement | null>;
    children: React.ReactNode;
  }
>(({ id, placement, anchorRef, children }, railRef) => (
  <div
    ref={anchorRef}
    // The anchor only ever translates, and only from the frame loop. It is
    // `pointer-events: none` so the empty space either side of the rail never
    // swallows a click meant for the canvas.
    style={{
      position: 'absolute', left: 0, top: 0, zIndex: 200,
      pointerEvents: 'none', willChange: 'transform',
    }}
  >
    <div
      style={{
        position: 'absolute',
        transform: `translate(-50%, ${placement === 'top' ? '-100%' : '0%'})`,
        width: 'max-content',
      }}
    >
      <motion.div
        key={id}
        ref={railRef}
        className="ctx-toolbar"
        initial={{ opacity: 0, y: placement === 'top' ? 6 : -6 }}
        animate={{ opacity: 0.94, y: 0 }}
        exit={{ opacity: 0, y: placement === 'top' ? 4 : -4 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ position: 'relative', pointerEvents: 'auto' }}
      >
        {children}
      </motion.div>
    </div>
  </div>
));
Rail.displayName = 'Rail';

/** An icon button on the rail. */
const RailButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}> = ({ label, onClick, children, pressed, disabled, danger, hint }) => (
  <button
    type="button"
    className={`ctx-btn${danger ? ' ctx-btn--danger' : ''}`}
    data-tooltip={hint ?? label}
    aria-label={label}
    aria-pressed={pressed}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </button>
);

const Divider = () => <span className="ctx-divider" aria-hidden="true" />;

/**
 * A button on the rail with a panel hanging off it.
 *
 * Closes on Escape and on a click outside — both, because either alone strands
 * it: Escape only helps if you know it is open, and outside-click only helps if
 * you can reach past it. Escape is captured so it closes the popover instead of
 * clearing the canvas selection underneath.
 */
const RailPopover: React.FC<{
  label: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
  placement?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
}> = ({ label, trigger, children, placement = 'bottom', align = 'center' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Which way it actually opens, decided by whether there is room.
   *
   * `placement` was a fixed prop, so a popover on a rail near the bottom of the
   * window opened downward into the edge and was cut off — which is precisely
   * where this rail sits when the object it belongs to is low on the board. The
   * prop is the *preference* now; this is the answer after measuring.
   */
  const [side, setSide] = useState<'top' | 'bottom'>(placement);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = ref.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const rect = trigger.getBoundingClientRect();
    // Measured rather than assumed: these panels hold anything from two swatches
    // to a stack of sliders, and a guess would be wrong for one of them.
    const needed = panel.offsetHeight + 8;
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;

    /**
     * Only flips when the preferred side genuinely cannot hold it *and* the
     * other side can. Flipping toward a side that is also too small trades a
     * clipped popover for a clipped popover that moved, which is worse — it
     * looks like a glitch rather than a constraint.
     */
    if (placement === 'bottom' && below < needed && above > below) setSide('top');
    else if (placement === 'top' && above < needed && below > above) setSide('bottom');
    else setSide(placement);
  }, [open, placement]);

  // Re-measured on the next open rather than kept, because the rail moves with
  // its object and the room available is a property of where it is now.
  useEffect(() => { if (!open) setSide(placement); }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // The stroke and fill popovers each host a portalled colour picker.
      if (isInsidePortalSurface(e.target)) return;
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'flex' }} ref={ref}>
      <button
        type="button"
        className="ctx-btn"
        data-tooltip={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panelRef}
          className="ctx-popover"
          role="dialog"
          aria-label={label}
          data-side={side}
          style={{
            [side === 'bottom' ? 'top' : 'bottom']: 'calc(100% + 8px)',
            /**
             * Centred with `translate`, not `transform`.
             *
             * `ctxPopIn` animates `transform`, so centring with it meant the
             * entrance overwrote the centring: the panel flew in half its own
             * width to the right and snapped into place on the last frame. The
             * independent `translate` property composes instead of being
             * replaced — the trap DESIGN.md names, and this is the sixth
             * surface to have had it.
             */
            ...(align === 'center'
              ? { left: '50%', translate: '-50% 0' }
              : align === 'end'
                ? { right: 0 }
                : { left: 0 }),
          } as React.CSSProperties}
        >
          {children}
        </div>
      )}
    </div>
  );
};

/**
 * A labelled slider for a value the rail shows but does not have room to edit.
 *
 * A real `range` rather than a drawn track: it is keyboard-operable, it honours
 * the OS pointer size, and `accent-color` already themes it. Reimplementing it
 * would cost all three to gain nothing.
 */
const PopoverSlider: React.FC<{
  label: string; value: number; min: number; max: number; step?: number; suffix?: string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, suffix = '', onChange }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div className="ctx-popover__row">
      <span className="ctx-popover__label">{label}</span>
      <span className="ctx-value">{Math.round(value)}{suffix}</span>
    </div>
    <input
      type="range"
      aria-label={label}
      min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--text-primary)' }}
    />
  </div>
);

/**
 * What each sketch level and shading style is called.
 *
 * Written out here rather than inline, because these strings appear twice —
 * as the tooltip and as the accessible name — and a button whose label and
 * whose tooltip disagree is worse than one with neither.
 */
const SKETCH_LABELS: Record<'off' | SketchLevel, string> = {
  off: 'Off — a ruled shape',
  light: 'Light — one confident pass',
  medium: 'Medium — drawn twice',
  heavy: 'Heavy — twice, and past every corner',
};

const FILL_LABELS: Record<FillStyle, string> = {
  solid: 'Solid — a flat fill',
  hachure: 'Hachure — parallel pen strokes',
  crosshatch: 'Cross-hatch — two sets, crossed',
};

interface Props {
  selectedId: string | null;
  selectedIds?: string[];
  onDeselect: () => void;
  /** Whether the side panels and bottom dock are on screen. */
  sidebarsVisible?: boolean;
}

export const ObjectContextToolbar: React.FC<Props> = ({ selectedId, selectedIds, onDeselect, sidebarsVisible = true }) => {
  /**
   * The rail's position is written to the DOM, never to React state.
   *
   * Two things were making this jitter while an object moved.
   *
   * 1. **A `setState` per frame.** The rAF loop called `setPosition` on every
   *    frame the rounded coordinate changed — which, during a drag, is every
   *    frame — re-rendering a component tree containing the fill editor and
   *    four popovers at 60fps. This codebase already has the rule for exactly
   *    this: positions go straight to the DOM inside the frame loop, because
   *    re-rendering a tree at pointer rate costs more than the thing it moves.
   * 2. **Two owners of one `transform`.** The rail is a `motion.div` animating
   *    `y` on entry, which framer-motion applies *as a transform* — while the
   *    style prop set `transform: translate(-50%, -100%)` for centring. One
   *    property, two writers, so the centring was being clobbered by the
   *    animation and snapped back when it finished.
   *
   * Splitting them fixes both: an outer anchor that only ever moves, written
   * imperatively, and an inner animated element that owns its own transform.
   */
  const anchorRef = useRef<HTMLDivElement>(null);
  /**
   * The rail itself, so the clamp can account for how wide it actually is.
   *
   * The bounds below were applied to the rail's *centre*, but the rail is
   * centred on that point — so a 370px rail whose centre was clamped to the
   * sidebar's edge still reached 185px past it, and sat on top of the layers
   * panel. Measured rather than estimated because the width changes with the
   * selection: a union rail carrying four booleans and eight alignment buttons
   * is more than twice the width of a sticky's.
   */
  const railRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const [isVisible, setIsVisible] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const myAuthorId = localAuthorId();
  const cropping = useSyncExternalStore(cropMode.subscribe, cropMode.getSnapshot, cropMode.getSnapshot);
  // So the button reads as pressed while the anchors are on screen, and can
  // close what it opened.
  const pathSelection = useSyncExternalStore(pathEdit.subscribe, pathEdit.getSnapshot, pathEdit.getSnapshot);
  const editingPath = pathSelection?.nodeId ?? null;
  /** How many anchors are picked, which is what the anchor rail is gated on. */
  const pickedAnchors = pathSelection?.anchors.length ?? 0;
  const isDraggingRef = useRef(false);
  const reactionsRef = useRef<HTMLDivElement>(null);
  // Mirrors state, read inside the rAF loop so it can skip setState on frames
  // where nothing moved. The loop has to run unconditionally — it is the only
  // thing tracking the rail during a live drag — but 60 renders a second of an
  // unchanged toolbar was pure waste.
  const lastRef = useRef({ x: -9999, y: -9999, placement: 'top' as 'top' | 'bottom', visible: false });

  const isBulk = (selectedIds?.length || 0) > 1;
  const bulkIds = selectedIds || [];
  const activeId = isBulk ? null : selectedId;

  // Stable-identity mirror of the selection, read imperatively by the rAF loop.
  const bulkIdsRef = useRef(bulkIds);
  useEffect(() => { bulkIdsRef.current = selectedIds || []; }, [selectedIds]);

  const liveNode = useStore((state) => (activeId ? state.objects[activeId] : undefined));
  const allObjects = useStore((state) => state.objects);
  /** The group tree, so the grid rail re-renders when a grid is re-laid. */
  const groupTree = useStore((state) => state.groups);

  useEffect(() => {
    if (!activeId && !isBulk) { setIsVisible(false); return; }

    /**
     * Forget where the rail was, every time the selection changes shape.
     *
     * The loop only writes the transform when the rounded coordinate differs
     * from the last one it wrote. That is the right optimisation and it had a
     * hole: switching between the single rail and the union rail swaps one
     * element tree for another, so the anchor node is destroyed and rebuilt
     * *without* a transform — while `lastRef` still holds the coordinate it
     * had written to the old node. The comparison then says "no change", the
     * write is skipped, and the new rail sits untransformed at the canvas
     * origin, translated up out of sight by its own centring.
     *
     * That is the toolbar "not always appearing" and "behaving strangely":
     * it was there, at 0,0, off screen. Resetting the bookkeeping whenever the
     * tree can change guarantees the first frame after a mount always writes.
     */
    lastRef.current = { x: -9999, y: -9999, placement: lastRef.current.placement, visible: false };

    const updatePosition = () => {
      if (isDraggingRef.current) {
        if (lastRef.current.visible) { lastRef.current.visible = false; setIsVisible(false); }
        return;
      }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const ids = isBulk ? bulkIdsRef.current : (activeId ? [activeId] : []);
      const store = useStore.getState().objects;
      for (const id of ids) {
        const node = store[id];
        if (!node) continue;
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + node.width);
        maxY = Math.max(maxY, node.y + node.height);
      }
      if (minX === Infinity) {
        if (lastRef.current.visible) { lastRef.current.visible = false; setIsVisible(false); }
        return;
      }

      const screenX = minX * cameraSystem.zoom + cameraSystem.x;
      const screenY = minY * cameraSystem.zoom + cameraSystem.y;
      const screenW = (maxX - minX) * cameraSystem.zoom;
      const screenH = (maxY - minY) * cameraSystem.zoom;

      // Above by preference, below when there is no room above. The rail must
      // never cover the thing it edits, which is why it flips rather than
      // simply clamping into the object's own box.
      let y = screenY - STANDOFF;
      let currentPlacement: 'top' | 'bottom' = 'top';
      if (y - RAIL_HEIGHT < EDGE_MARGIN + 48) {
        y = screenY + screenH + STANDOFF;
        currentPlacement = 'bottom';
      }
      const dockLimit = window.innerHeight - (sidebarsVisible ? BOTTOM_DOCK_HEIGHT : EDGE_MARGIN) - RAIL_HEIGHT;
      if (currentPlacement === 'bottom' && y > dockLimit) y = dockLimit;

      // Half the rail, so the clamp keeps its *edges* inside the free canvas
      // rather than its midpoint.
      const half = (railRef.current?.offsetWidth ?? 0) / 2;
      const leftBound = (sidebarsVisible ? SIDEBAR_WIDTH : EDGE_MARGIN) + 4 + half;
      const rightBound = window.innerWidth - (sidebarsVisible ? SIDEBAR_WIDTH : EDGE_MARGIN) - 4 - half;
      // When the free width is narrower than the rail there is no position that
      // satisfies both edges; centring it in what space there is beats pinning
      // it to one side and letting it run off the other.
      const x = rightBound < leftBound
        ? (leftBound + rightBound) / 2
        : Math.max(leftBound, Math.min(rightBound, screenX + screenW / 2));

      const rx = Math.round(x), ry = Math.round(y);
      const last = lastRef.current;

      // Position: straight to the DOM, every frame, no React involved.
      //
      // The guard is on the *node*, not just the coordinate. On the first pass
      // the rail has not rendered yet, so there is nothing to write to — and
      // recording the coordinate anyway would mark it as done, so the next
      // frame would see no change and skip the write forever. The toolbar then
      // sat untransformed at the canvas origin, translated up out of view by
      // its own centring, and never appeared at all.
      if (anchorRef.current && (last.x !== rx || last.y !== ry)) {
        lastRef.current.x = rx;
        lastRef.current.y = ry;
        anchorRef.current.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      }

      // Placement and visibility do go through state, because they change a
      // handful of times per session rather than sixty times a second, and
      // both decide what is *rendered* rather than merely where it sits.
      if (last.placement !== currentPlacement) {
        lastRef.current.placement = currentPlacement;
        setPlacement(currentPlacement);
      }
      if (!last.visible) {
        lastRef.current.visible = true;
        setIsVisible(true);
      }
    };

    const handleDragStart = () => { isDraggingRef.current = true; lastRef.current.visible = false; setIsVisible(false); };
    const handleDragEnd = () => { isDraggingRef.current = false; updatePosition(); };

    engineEvents.on('CameraChanged', updatePosition);
    engineEvents.on('ObjectMoved', updatePosition);
    engineEvents.on('ObjectModified', updatePosition);
    window.addEventListener('canvas-drag-start', handleDragStart);
    window.addEventListener('canvas-drag-end', handleDragEnd);
    updatePosition();

    let frame = requestAnimationFrame(function loop() {
      updatePosition();
      frame = requestAnimationFrame(loop);
    });

    return () => {
      engineEvents.off('CameraChanged', updatePosition);
      engineEvents.off('ObjectMoved', updatePosition);
      engineEvents.off('ObjectModified', updatePosition);
      window.removeEventListener('canvas-drag-start', handleDragStart);
      window.removeEventListener('canvas-drag-end', handleDragEnd);
      cancelAnimationFrame(frame);
    };
  }, [activeId, isBulk, sidebarsVisible]);

  useEffect(() => {
    if (!showReactions) return;
    const onDown = (e: MouseEvent) => {
      if (reactionsRef.current && !reactionsRef.current.contains(e.target as Node)) setShowReactions(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showReactions]);

  useEffect(() => { setShowReactions(false); }, [activeId, isBulk]);

  if ((!activeId && !isBulk) || !isVisible) return null;

  // ---------------------------------------------------------------- union rail
  if (isBulk) {
    const bulkNodes = bulkIds.map((id) => allObjects[id]).filter(Boolean) as AnyNode[];

    const restack = (dir: 'front' | 'back') => {
      const base = dir === 'front' ? nextZIndex() : lowestZIndex() - bulkIds.length;
      const ordered = [...bulkNodes].sort((a, b) => a.zIndex - b.zIndex);
      applyNodePatches(ordered.map((n, i) => ({ id: n.id, changes: { zIndex: base + i } })));
    };

    const duplicate = () => {
      bulkNodes.forEach((node) => {
        editor.createNode({ ...(node as unknown as Record<string, unknown>), id: nanoid(), x: node.x + 20, y: node.y + 20 } as never);
      });
    };

    /**
     * What this selection affords, resolved once.
     *
     * The predicates below were each written out inline — `every((n) =>
     * FILLABLE_TYPES.has(n.type))` and friends — which is three surfaces
     * answering the same question with three copies of the answer. They ask the
     * resolver now, and it is the same one the panel and the menu use.
     */
    const bulkOffers = new Set(
      resolveAffordances(bulkNodes, { surface: 'toolbar', allObjects }).map((a) => a.id)
    );
    /** The grid under this selection, when the selection is exactly one. */
    const gridGroup = gridGroupOf(bulkNodes, groupTree);
    const bulkAffords = (id: AffordanceId) => bulkOffers.has(id);

    /**
     * Six predicates used to live here, each one a second copy of a question
     * the resolver above had just answered.
     *
     * They had already drifted: `allSketchable` was shapes and connectors,
     * while the properties panel's version of the same rule also included
     * freehand paths — so whether a pencil stroke could be sketched depended
     * on which control you happened to reach for. The resolver carries the
     * panel's version, because the panel's was right.
     */
    const locked = sharedValue(bulkNodes, (n) => Boolean(n.locked));
    const bulkSketch = sharedValue(bulkNodes, (n) =>
      (n as { appearance?: Appearance }).appearance?.sketch ?? 'off'
    );
    const opacity = sharedValue(bulkNodes, (n) => n.opacity);

    return (
      <AnimatePresence>
        <Rail id="union" placement={placement} anchorRef={anchorRef} ref={railRef}>
          <span className="ctx-kind"><Layers size={15} />{bulkNodes.length}</span>
          <Divider />

          {/**
            * Zone 0 — what this selection *is*.
            *
            * A selection with a uniform type has a subject, and that type's own
            * controls are the answer to "why did I select these". Five
            * connectors used to get group, align and opacity — generic to the
            * point of useless, because no branch here knew what they were.
            *
            * Which controls belong is `resolveAffordances`, not a condition
            * written out again at each surface: the same resolver answers for
            * the properties panel and the right-click menu, so the three cannot
            * disagree about what a selection offers or which part of it leads.
            */}
          {bulkAffords('routing') && (
            <>
              <div className="ctx-group">
                <RailPopover
                  label="Route"
                  trigger={<RouteIcon routing={(bulkNodes[0] as ConnectorNode).routing} />}
                  align="start"
                >
                  <span className="ctx-popover__label">Route · {bulkNodes.length} connectors</span>
                  <SegmentedControl
                    ariaLabel="Routing"
                    value={sharedValue(bulkNodes, (n) => (n as ConnectorNode).routing).value ?? 'orthogonal'}
                    onChange={(routing) =>
                      applyNodePatches(bulkNodes.map((n) => ({ id: n.id, changes: { routing } })))
                    }
                    segments={[
                      { value: 'straight', label: 'Straight', hint: 'A direct line', icon: <RouteIcon routing="straight" /> },
                      { value: 'orthogonal', label: 'Right angles', hint: 'Elbows, the way a flowchart reads', icon: <RouteIcon routing="orthogonal" /> },
                      { value: 'curved', label: 'Curved', hint: 'A smooth arc', icon: <RouteIcon routing="curved" /> },
                    ]}
                  />
                </RailPopover>

                <RailPopover
                  label="Ends"
                  trigger={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                      <EndCapIcon kind={(bulkNodes[0] as ConnectorNode).endStart ?? 'none'} flip />
                      <EndCapIcon kind={(bulkNodes[0] as ConnectorNode).endEnd ?? 'none'} />
                    </span>
                  }
                  align="start"
                >
                  <span className="ctx-popover__label">Ends · {bulkNodes.length} connectors</span>
                  {(['endStart', 'endEnd'] as const).map((which) => (
                    <SegmentedControl
                      key={which}
                      ariaLabel={which === 'endStart' ? 'Start cap' : 'End cap'}
                      value={sharedValue(bulkNodes, (n) => (n as ConnectorNode)[which] ?? 'none').value ?? 'none'}
                      onChange={(kind) =>
                        applyNodePatches(bulkNodes.map((n) => ({ id: n.id, changes: { [which]: kind } })))
                      }
                      segments={END_CAP_KINDS.map((kind) => ({
                        value: kind,
                        label: kind,
                        icon: <EndCapIcon kind={kind} flip={which === 'endStart'} />,
                      }))}
                    />
                  ))}
                </RailPopover>
              </div>
              <Divider />
            </>
          )}

          {/**
            * A grid leads with the fact that it *is* a grid.
            *
            * Selecting one used to raise the ordinary multi-select rail --
            * group, align, distribute, opacity -- which is a true description
            * of twelve rectangles and a useless one for a composition that was
            * generated from a system. The first thing anyone wants from a grid
            * they have just made is a different arrangement of it, and that was
            * four clicks away in a panel.
            *
            * The same resolver rule as everywhere else: what the selection *is*
            * comes before what can be done to the set.
            */}
          {gridGroup && gridRecipeFor(gridGroup) && (
            <>
              <div className="ctx-group">
                <RailPopover
                  label="System"
                  trigger={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <GridKindIcon kind={gridRecipeFor(gridGroup)!.spec.kind} size={15} />
                      <span className="ctx-value">{GRID_LABELS[gridRecipeFor(gridGroup)!.spec.kind]}</span>
                    </span>
                  }
                  align="start"
                >
                  <span className="ctx-popover__label">Grid system</span>
                  {/* The same ten miniatures the panel shows, so a system picked
                      here and a system picked there are the same act. */}
                  <div className="ctx-shape-grid">
                    {GRID_KINDS.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className="ctx-shape"
                        data-active={gridRecipeFor(gridGroup)!.spec.kind === kind || undefined}
                        data-tooltip={`${GRID_LABELS[kind]} — ${GRID_HINTS[kind]}`}
                        aria-label={GRID_LABELS[kind]}
                        onClick={() => {
                          const recipe = gridRecipeFor(gridGroup);
                          if (recipe) relayoutGrid(gridGroup, switchKind(recipe, kind));
                        }}
                      >
                        <GridKindIcon kind={kind} size={16} />
                      </button>
                    ))}
                  </div>
                </RailPopover>

                <RailButton
                  label="Another arrangement"
                  hint="Re-lay this grid, same system"
                  onClick={() => {
                    const recipe = gridRecipeFor(gridGroup);
                    if (recipe) {
                      relayoutGrid(gridGroup, {
                        ...recipe,
                        spec: { ...recipe.spec, seed: Math.floor(Math.random() * 100000) },
                      });
                    }
                  }}
                >
                  <Shuffle size={16} />
                </RailButton>

                <RailButton
                  label="Another palette"
                  hint="Recolour this grid, same arrangement"
                  onClick={() => {
                    const recipe = gridRecipeFor(gridGroup);
                    if (!recipe) return;
                    // Steps to the *next* shipped palette rather than a random
                    // one, so pressing it repeatedly walks the set instead of
                    // returning to the same two or three by chance.
                    const at = GRID_PALETTES.findIndex((p) => p.colors.join() === recipe.style.palette.join());
                    const nextPalette = GRID_PALETTES[(at + 1) % GRID_PALETTES.length];
                    relayoutGrid(gridGroup, {
                      ...recipe,
                      style: { ...recipe.style, palette: nextPalette.colors },
                    });
                  }}
                >
                  <Palette size={16} />
                </RailButton>
              </div>
              <Divider />
            </>
          )}

          {/* Zone A — structure. */}
          <div className="ctx-group">
            {bulkAffords('ungroup') ? (
              <RailButton label="Ungroup" hint="Ungroup (Cmd+Shift+G)" onClick={() => editor.ungroupNodes(bulkIds)}><Ungroup size={16} /></RailButton>
            ) : (
              <RailButton label="Group" hint="Group (Cmd+G)" onClick={() => editor.groupNodes(bulkIds)}><Group size={16} /></RailButton>
            )}
            {bulkAffords('boolean') && BOOLEAN_OPS.map((op) => (
              <RailButton
                key={op}
                label={BOOLEAN_BUTTONS[op].label}
                onClick={() => { const id = applyBoolean(op, bulkIds); if (id) editor.select(id); }}
              >
                {BOOLEAN_BUTTONS[op].icon}
              </RailButton>
            ))}
          </div>
          <Divider />

          {/* Zone B — arrangement. The reason a multi-selection usually exists,
              and something this app had no way to do at all until now. */}
          <div className="ctx-group">
            {ALIGN_BUTTONS.map(({ edge, label, icon }) => (
              <RailButton key={edge} label={label} onClick={() => applyNodePatches(alignSelection(bulkNodes, edge))}>
                {icon}
              </RailButton>
            ))}
            <RailButton
              label="Distribute horizontally"
              hint={bulkAffords('distribute') ? 'Even horizontal gaps' : 'Needs three or more objects'}
              disabled={!bulkAffords('distribute')}
              onClick={() => applyNodePatches(distributeSelection(bulkNodes, 'horizontal'))}
            ><AlignHorizontalSpaceAround size={16} /></RailButton>
            <RailButton
              label="Distribute vertically"
              hint={bulkAffords('distribute') ? 'Even vertical gaps' : 'Needs three or more objects'}
              disabled={!bulkAffords('distribute')}
              onClick={() => applyNodePatches(distributeSelection(bulkNodes, 'vertical'))}
            ><AlignVerticalSpaceAround size={16} /></RailButton>
          </div>
          <Divider />

          {/* Zone C — what every one of them has. */}
          <div className="ctx-group">
            {bulkAffords('fill') && (
              <FillEditor
                paint={(bulkNodes[0] as { appearance?: Appearance }).appearance?.fill?.[0]}
                mixed={sharedValue(bulkNodes, (n) => (n as { appearance?: Appearance }).appearance?.fill?.[0]).mixed}
                onChange={(fill) =>
                  applyNodePatches(bulkNodes.map((n) => ({
                    id: n.id,
                    // Merged per node: a shared fill must not overwrite three
                    // objects' strokes and shadows with the first one's paint.
                    changes: { appearance: { ...((n as { appearance?: Appearance }).appearance ?? {}), fill: [fill] } },
                  })))
                }
              />
            )}
            {/* Icon plus value, not a bare number: a lone "–" for a mixed
                opacity is unreadable, and the glyph is what makes the control
                findable at a glance whatever the value says. */}
            <RailPopover
              label="Opacity"
              trigger={<><Droplet size={16} />{!opacity.mixed && <span className="ctx-value">{Math.round((opacity.value ?? 1) * 100)}</span>}</>}
            >
              <PopoverSlider
                label="Opacity" suffix="%"
                value={Math.round((opacity.value ?? 1) * 100)} min={0} max={100}
                onChange={(v) => updateNodes(bulkIds, { opacity: v / 100 })}
              />
            </RailPopover>
            {bulkAffords('sketch') && (
              <RailPopover
                label="Sketch"
                trigger={
                  <SketchLevelIcon
                    level={(bulkSketch.mixed ? 'off' : (bulkSketch.value as SketchLevel | 'off')) ?? 'off'}
                  />
                }
              >
                <span className="ctx-popover__label">Sketch</span>
                <div className="ctx-shape-grid">
                  {(['off', 'light', 'medium', 'heavy'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      className="ctx-shape-btn"
                      aria-pressed={!bulkSketch.mixed && (bulkSketch.value ?? 'off') === lvl}
                      aria-label={SKETCH_LABELS[lvl]}
                      data-tooltip={SKETCH_LABELS[lvl]}
                      // Merged per node, so applying a sketch across a
                      // selection cannot overwrite each object's own fill,
                      // stroke and shadow with the first one's paint.
                      onClick={() =>
                        applyNodePatches(
                          bulkNodes.map((n) => ({
                            id: n.id,
                            changes: {
                              appearance: {
                                ...((n as { appearance?: Appearance }).appearance ?? {}),
                                sketch: lvl === 'off' ? undefined : lvl,
                              },
                            },
                          }))
                        )
                      }
                    >
                      <SketchLevelIcon level={lvl} />
                    </button>
                  ))}
                </div>
              </RailPopover>
            )}
            <RailButton
              label={locked.mixed || !locked.value ? 'Lock all' : 'Unlock all'}
              pressed={!locked.mixed && locked.value}
              // A mixed lock resolves to locked: the safe direction, and it
              // leaves one unambiguous press to undo.
              onClick={() => updateNodes(bulkIds, { locked: locked.mixed ? true : !locked.value })}
            >
              {!locked.mixed && locked.value ? <Lock size={16} /> : <Unlock size={16} />}
            </RailButton>
          </div>
          <Divider />

          {/* Zone D — bulk management. */}
          <div className="ctx-group">
            <RailButton label="Bring to front" onClick={() => restack('front')}><BringToFront size={16} /></RailButton>
            <RailButton label="Send to back" onClick={() => restack('back')}><SendToBack size={16} /></RailButton>
            <RailButton label="Duplicate" hint="Duplicate (Cmd+D)" onClick={duplicate}><Copy size={16} /></RailButton>
            <RailButton label="Delete" hint="Delete (Del)" danger onClick={() => { deleteNodesWithFrames(bulkIds); onDeselect(); }}>
              <Trash2 size={16} />
            </RailButton>
          </div>
        </Rail>
      </AnimatePresence>
    );
  }

  // --------------------------------------------------------------- single rail
  if (!liveNode) return null;
  const node = liveNode;
  const isCropping = cropping?.nodeId === node.id;
  const kind = TYPE_LABEL[node.type] ?? { icon: <Square size={15} />, name: node.type };

  const updateProp = (updates: Record<string, unknown>) => editor.updateNode(node.id, updates);

  const typography: Typography | null =
    node.type === 'text' ? node.typography
      : node.type === 'shape' ? (node.typography ?? DEFAULT_TYPOGRAPHY)
        : null;
  const setTypography = (patch: Partial<Typography>) =>
    updateProp({ typography: { ...(typography ?? DEFAULT_TYPOGRAPHY), ...patch } });

  const appearance: Appearance = ('appearance' in node ? node.appearance : undefined) ?? {};
  const setAppearance = (patch: Partial<Appearance>) => updateProp({ appearance: { ...appearance, ...patch } });

  const openShape = node.type === 'shape' && isOpenShape(node.geometry.kind);
  const strokeWidth = appearance.stroke?.width ?? 0;

  /**
   * Whether there is any type here to style.
   *
   * A shape *can* carry a centred label, so the schema gives every shape a
   * `typography` block — but most shapes have no text in them, and offering a
   * family picker, a size and four style toggles for an empty string made the
   * rail wider than the object it floats over, for controls that provably
   * change nothing on screen. A text node always qualifies; a shape qualifies
   * once it actually has words.
   */
  /**
   * Not for a line's label, which is a *tag* rather than a text block.
   *
   * A line's label is one or two words riding a hairline to say what the edge
   * means — yes, no, retry, 40ms. Its size, weight, case and colour are fixed
   * by the renderer, so offering a font picker, a weight, an alignment and a
   * colour ramp for it is a dozen controls that change nothing, which is worse
   * than none: every one of them looks like it works.
   */
  const showTypography =
    node.type === 'text'
    || (node.type === 'shape' && !isOpenShape(node.geometry.kind)
        && Boolean(node.text && node.text.length > 0));

  return (
    <AnimatePresence>
      <Rail id={node.id} placement={placement} anchorRef={anchorRef} ref={railRef}>
        <span className="ctx-kind">{kind.icon}{kind.name}</span>
        <Divider />

        {/* ------------------------------------- shapes, paths and connectors */}
        {/* A connector is a stroke, and the registry has always said so —
            `supportsStroke` is on its capabilities and the properties panel
            offers its colour. This toolbar simply never asked: it gated the
            whole group on shape-or-path, so selecting a connector gave you a
            floating toolbar with no way to recolour the one thing a connector
            is made of. Fill stays out, because there is no interior. */}
        {(node.type === 'shape' || node.type === 'path' || node.type === 'connector') && (
          <>
            <div className="ctx-group">
              {/* The trigger shows the shape it currently *is*, not a generic
                  square. The button then says what it will change, and two
                  neighbouring controls cannot end up wearing the same glyph —
                  which is how this one and Sketch collided. */}
              {node.type === 'shape' && (
                <RailPopover
                  label="Change shape"
                  trigger={
                    // A line shows itself — profile and both ends — rather
                    // than a generic dash. On a line object this button sat
                    // next to Stroke and Sketch, and all three were the same
                    // straight mark.
                    isOpenShape(node.geometry.kind) ? (
                      <LineSpecimen
                        profile={node.geometry.lineProfile}
                        endStart={node.geometry.endStart}
                        endEnd={node.geometry.endEnd}
                      />
                    ) : (
                      SHAPE_CHOICES.find(
                        (c) => c.kind === node.geometry.kind
                          && (c.points === undefined || node.geometry.points === c.points)
                      )?.icon ?? <Square size={16} />
                    )
                  }
                  align="start"
                >
                  {/*
                    Closed shapes and lines, separated.

                    They were one undifferentiated grid, which quietly offered
                    to turn a rectangle into a line — a conversion that keeps
                    the box and throws away the fill, the corner radius and the
                    interior, and is almost never what someone reaching for a
                    shape swapper wants. Two labelled groups do not forbid it;
                    they just stop it being one slip away from a hexagon.
                  */}
                  <span className="ctx-popover__label">Shape</span>
                  <div className="ctx-shape-grid">
                    {SHAPE_CHOICES.filter((c) => !isOpenShape(c.kind)).map((choice) => {
                      const active = node.geometry.kind === choice.kind
                        && (choice.points === undefined || node.geometry.points === choice.points);
                      return (
                        <button
                          key={`${choice.kind}-${choice.points ?? 0}`}
                          type="button"
                          className="ctx-shape-btn"
                          aria-pressed={active}
                          aria-label={choice.label}
                          data-tooltip={choice.label}
                          // Size, paint and position all survive: only `kind`
                          // and its side count change, which is the whole
                          // point of a swapper rather than a delete-and-redraw.
                          onClick={() => updateProp({
                            geometry: {
                              ...node.geometry,
                              kind: choice.kind,
                              ...(choice.points !== undefined
                                ? { points: Math.max(MIN_POLYGON_SIDES, Math.min(MAX_POLYGON_SIDES, choice.points)) }
                                : {}),
                            },
                          })}
                        >
                          {choice.icon}
                        </button>
                      );
                    })}
                  </div>

                  {/* The side count, where the shape has one.
                      It lived only in the properties panel, so changing a
                      hexagon to a heptagon meant leaving the object you were
                      looking at — while the grid beside it offered a *fixed*
                      triangle and hexagon, implying those were the only
                      counts. The presets are shortcuts to common answers; this
                      is the answer itself. */}
                  {(node.geometry.kind === 'polygon' || node.geometry.kind === 'star') && (
                    <PopoverSlider
                      label={node.geometry.kind === 'star' ? 'Points' : 'Sides'}
                      value={node.geometry.points ?? 3}
                      min={MIN_POLYGON_SIDES}
                      max={MAX_POLYGON_SIDES}
                      onChange={(points) => updateProp({ geometry: { ...node.geometry, points } })}
                    />
                  )}

                  {/* Star only, and next to its point count for the same
                      reason: the two together are what a star *is*. */}
                  {node.geometry.kind === 'star' && (
                    <PopoverSlider
                      label="Depth"
                      value={Math.round((node.geometry.innerRatio ?? 0.5) * 100)}
                      min={10}
                      max={90}
                      suffix="%"
                      onChange={(v) => updateProp({ geometry: { ...node.geometry, innerRatio: v / 100 } })}
                    />
                  )}

                  {/* The profile and how much of it, on the rail as well as
                      in the inspector. Changing a coil from five loops to two
                      is something you do while looking at the line, and the
                      walk to the panel is what stops people doing it. */}
                  {isOpenShape(node.geometry.kind) && (
                    <>
                      <span className="ctx-popover__label">Style</span>
                      <SegmentedControl
                        ariaLabel="Line style"
                        value={node.geometry.lineProfile ?? 'straight'}
                        onChange={(v) => updateProp({
                          geometry: {
                            ...node.geometry,
                            lineProfile: v === 'straight' ? undefined : (v as LineProfile),
                          },
                        })}
                        segments={LINE_PROFILES.map((profile) => ({
                          value: profile,
                          label: LINE_PROFILE_LABELS[profile],
                          hint: LINE_PROFILE_LABELS[profile],
                          icon: <LineProfileIcon profile={profile} />,
                        }))}
                      />
                      {(node.geometry.lineProfile ?? 'straight') !== 'straight'
                        && node.geometry.lineProfile !== 'curved' && (
                        <PopoverSlider
                          label={node.geometry.lineProfile === 'coil' ? 'Loops' : 'Repeats'}
                          value={node.geometry.lineWaves ?? 6}
                          min={MIN_WAVES}
                          max={20}
                          onChange={(v) => updateProp({ geometry: { ...node.geometry, lineWaves: v } })}
                        />
                      )}
                    </>
                  )}
                  <span className="ctx-popover__label">Line</span>
                  <div className="ctx-shape-grid">
                    {SHAPE_CHOICES.filter((c) => isOpenShape(c.kind)).map((choice) => {
                      const active = node.geometry.kind === choice.kind;
                      return (
                        <button
                          key={choice.kind}
                          type="button"
                          className="ctx-shape-btn"
                          aria-pressed={active}
                          aria-label={choice.label}
                          data-tooltip={choice.label}
                          onClick={() => updateProp({
                            geometry: { ...node.geometry, kind: choice.kind },
                          })}
                        >
                          {/* Under the object's own profile, so switching
                              between line and arrow shows the one thing that
                              actually differs between them. */}
                          <LineSpecimen
                            profile={node.geometry.lineProfile}
                            endEnd={choice.kind === 'arrow' ? (node.geometry.endEnd ?? 'arrow') : 'none'}
                          />
                        </button>
                      );
                    })}
                  </div>
                </RailPopover>
              )}
              {/* The same editor the Properties panel uses, not a colour-only
                  shortcut — a fill control that could only make flat colours
                  would discard a gradient the moment anyone reached for it. */}
              {!openShape && node.type !== 'connector' && (
                <FillEditor paint={appearance.fill?.[0]} onChange={(fill) => setAppearance({ fill: [fill] })} />
              )}
              {/* A freehand blob is a filled outline with no separate stroke
                  render path, so stroke controls on one would do nothing. */}
              {(node.type === 'shape' || node.type === 'connector' || node.geometry.kind !== 'freehand') && (
                <RailPopover
                  label="Stroke"
                  // The weight it currently holds, drawn. A dash here was the
                  // same mark as Sketch's off state and, on a line object, as
                  // the shape swapper's glyph — three identical buttons in a
                  // row. See `StrokeWeightIcon`.
                  trigger={<><StrokeWeightIcon width={strokeWidth} /><span className="ctx-value">{strokeWidth}</span></>}
                >
                  <div className="ctx-popover__row">
                    <span className="ctx-popover__label">Colour</span>
                    {/* Opens on the colour the renderer will actually draw.
                        This defaulted to pure black while every renderer falls
                        back to `DEFAULT_INK`, so a shape with no stroke set
                        showed a black swatch and drew dark slate — the picker
                        was reporting a colour that existed nowhere. */}
                    <ColorPickerPopover
                      color={appearance.stroke?.color ?? DEFAULT_INK}
                      onChange={(color) => setAppearance({ stroke: { width: strokeWidth || 2, ...appearance.stroke, color } })}
                    />
                  </div>
                  <PopoverSlider
                    label="Weight" value={strokeWidth} min={0} max={40}
                    onChange={(width) => setAppearance({ stroke: { color: appearance.stroke?.color ?? DEFAULT_INK, ...appearance.stroke, width } })}
                  />
                </RailPopover>
              )}
              {/* Sketch lives on the rail, not only in the panel, because it
                  is a *drawing* decision: you reach for it while laying out a
                  diagram, repeatedly, and walking to the inspector each time
                  is the difference between using it and not. Shading is inside
                  the same popover rather than beside it — it is meaningless
                  without a sketch level, so it should not occupy rail width
                  when there is none. */}
              {/* Connectors included. `ConnectorRenderer` has always drawn its
                  run through the same `roughPolyline` the shapes use, so a
                  sketched flowchart with crisp arrows between its boxes was
                  never a decision — it was this gate saying `shape`. A hand
                  is the case sketch is most for, and half of a hand-drawn
                  diagram is the lines. */}
              {/* Freehand paths too: sketching one redraws it from its
                  centreline as a line gone over twice, which is a second way
                  to draw rather than a filter over the first. Pen and boolean
                  paths have no centreline and stay out. */}
              {(node.type === 'shape' || node.type === 'connector'
                || (node.type === 'path' && node.geometry.kind === 'freehand')) && (
                <RailPopover
                  label="Sketch"
                  trigger={<SketchLevelIcon level={appearance.sketch ?? 'off'} />}
                  align="start"
                >
                  <span className="ctx-popover__label">Sketch</span>
                  <div className="ctx-shape-grid">
                    {(['off', 'light', 'medium', 'heavy'] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        className="ctx-shape-btn"
                        aria-pressed={(appearance.sketch ?? 'off') === lvl}
                        aria-label={SKETCH_LABELS[lvl]}
                        data-tooltip={SKETCH_LABELS[lvl]}
                        onClick={() =>
                          setAppearance({ sketch: lvl === 'off' ? undefined : lvl })
                        }
                      >
                        <SketchLevelIcon level={lvl} />
                      </button>
                    ))}
                  </div>
                  {/* Shading fills an interior, and a connector has none. */}
                  {appearance.sketch && !openShape && node.type !== 'connector' && (
                    <>
                      <span className="ctx-popover__label">Shading</span>
                      <div className="ctx-shape-grid">
                        {(['solid', 'hachure', 'crosshatch'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            className="ctx-shape-btn"
                            aria-pressed={(appearance.fillStyle ?? 'solid') === st}
                            aria-label={FILL_LABELS[st]}
                            data-tooltip={FILL_LABELS[st]}
                            onClick={() =>
                              setAppearance({ fillStyle: st === 'solid' ? undefined : st })
                            }
                          >
                            <FillStyleIcon style={st} />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </RailPopover>
              )}
              {node.type === 'shape' && node.geometry.kind === 'rect' && (
                <RailPopover label="Corner radius" trigger={<><Spline size={16} /><span className="ctx-value">{appearance.cornerRadius ?? 0}</span></>}>
                  <PopoverSlider
                    label="Corner radius" value={appearance.cornerRadius ?? 0} min={0} max={200}
                    onChange={(cornerRadius) => setAppearance({ cornerRadius })}
                  />
                </RailPopover>
              )}
            </div>
            <Divider />
          </>
        )}

        {/* -------------------------------------------------------- connector */}
        {/* Route and ends, on the rail rather than only in the inspector.
            Both are *drawing* decisions in the sense sketch is: you change
            them while laying a diagram out, repeatedly, and on the object you
            are looking at. Walking to the panel each time is the difference
            between a flowchart that says three different things with three
            different arrows and one where every line looks the same because
            varying them cost too much.

            Two popovers rather than six buttons. The rail floats over the
            board and its width is taken from the object it belongs to, so
            every control that earns a permanent slot costs the ones that
            already have one; a trigger showing the current value, opening onto
            the full vocabulary, is the pattern the stroke and sketch controls
            already set. */}
        {node.type === 'connector' && (
          <>
            <div className="ctx-group">
              <RailPopover
                label="Route"
                trigger={<RouteIcon routing={node.routing} />}
                align="start"
              >
                <span className="ctx-popover__label">Route</span>
                <SegmentedControl
                  ariaLabel="Routing"
                  value={node.routing}
                  onChange={(routing) => updateProp({ routing: routing as Routing })}
                  segments={[
                    { value: 'straight', label: 'Straight', hint: 'A direct line', icon: <RouteIcon routing="straight" /> },
                    { value: 'orthogonal', label: 'Right angles', hint: 'Elbows, the way a flowchart reads', icon: <RouteIcon routing="orthogonal" /> },
                    { value: 'curved', label: 'Curved', hint: 'A smooth arc', icon: <RouteIcon routing="curved" /> },
                  ]}
                />
              </RailPopover>
              {/* The trigger shows both ends in the order they are drawn, so
                  the rail answers "which way does this point" without being
                  opened — which is the question you actually have when you
                  have just selected an arrow. */}
              <RailPopover
                label="Ends"
                trigger={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    <EndCapIcon kind={node.endStart ?? 'none'} flip />
                    <EndCapIcon kind={node.endEnd ?? 'none'} />
                  </span>
                }
                align="start"
              >
                {/* Two controls, because "what is at the start" and "what is
                    at the end" are separate decisions — one combined control
                    would have to enumerate thirty-six pairs. */}
                <span className="ctx-popover__label">Start</span>
                <SegmentedControl
                  ariaLabel="Start cap"
                  value={node.endStart ?? 'none'}
                  onChange={(v) => updateProp({ endStart: v as EndCapKind })}
                  segments={END_CAP_KINDS.map((k) => ({
                    value: k, label: END_CAP_LABELS[k], hint: END_CAP_LABELS[k],
                    icon: <EndCapIcon kind={k} flip />,
                  }))}
                />
                <span className="ctx-popover__label">End</span>
                <SegmentedControl
                  ariaLabel="End cap"
                  value={node.endEnd ?? 'none'}
                  onChange={(v) => updateProp({ endEnd: v as EndCapKind })}
                  segments={END_CAP_KINDS.map((k) => ({
                    value: k, label: END_CAP_LABELS[k], hint: END_CAP_LABELS[k],
                    icon: <EndCapIcon kind={k} />,
                  }))}
                />
                {/* One size for both. An arrow with a big head and a small
                    tail reads as a mistake, and two sliders would double the
                    popover for a case nobody asks for. */}
                <PopoverSlider
                  label="Size"
                  value={Math.round((node.endScale ?? 1) * 100)}
                  min={MIN_END_SCALE * 100}
                  max={MAX_END_SCALE * 100}
                  step={25}
                  suffix="%"
                  onChange={(v) => updateProp({ endScale: v === 100 ? undefined : v / 100 })}
                />
              </RailPopover>
              {/* A word riding the middle of the run — yes, no, retry. It is
                  the fastest thing to want on a freshly drawn arrow and the
                  slowest to reach, being the last row of the last section of
                  the inspector. */}
              <RailPopover label="Label" trigger={<Type size={16} />} align="start">
                <span className="ctx-popover__label">Label</span>
                {/* The panel's own text field, not a second one. A
                    near-duplicate here would be two answers to what an input
                    looks like, and the cheaper to keep correct is the one that
                    already exists. */}
                <input
                  className="prop-input"
                  value={node.label ?? ''}
                  placeholder="yes, no, retry"
                  onChange={(e) => updateProp({ label: e.target.value || undefined })}
                  aria-label="Connector label"
                />
              </RailPopover>
            </div>
            <Divider />
          </>
        )}

        {/* --------------------------------------------------------- vectors */}
        {/* Anchor editing has always worked — double-click a pen path and its
            points and handles appear. Nothing ever *said* so, which for a
            feature reached by a gesture on one node type out of a dozen means
            it may as well not exist: the only way to find it is to try
            double-clicking things. A button costs one slot on a rail that only
            appears for the paths it applies to. */}
        {/* Compound paths too, now that anchors are addressed per contour.
            Every boolean result was previously uneditable — the button was
            hidden on exactly the paths whose shape most needed correcting. */}
        {node.type === 'path' && node.geometry.kind !== 'freehand' && (
          <>
            <div className="ctx-group">
              <RailButton
                label="Edit points"
                hint="Direct select (A)"
                pressed={editingPath === node.id}
                onClick={() =>
                  editingPath === node.id ? pathEdit.exit() : pathEdit.enter(node.id)
                }
              >
                <Spline size={15} />
              </RailButton>
            </div>

            {/**
              * The anchor rail: what you can do to the points you have picked.
              *
              * Appears only while anchors are actually selected, which is the
              * whole reason it can sit inline rather than in a panel — it is
              * never on screen at a moment when it applies to nothing. Corner
              * and smooth were reachable only by double-clicking an anchor, a
              * gesture with no affordance at all; align had no route in.
              */}
            {editingPath === node.id && pickedAnchors > 0 && (
              <>
                <Divider />
                <div className="ctx-group">
                  <span className="ctx-value" style={{ marginRight: 2 }}>{pickedAnchors}</span>
                  <RailButton label="Corner" hint="Straighten these points" onClick={() => setPickedAnchorMode('corner')}>
                    <CornerIcon rounded={false} />
                  </RailButton>
                  <RailButton label="Smooth" hint="Round these points" onClick={() => setPickedAnchorMode('smooth')}>
                    <CornerIcon rounded />
                  </RailButton>
                </div>
                {/* Align needs two points to mean anything, so it is offered
                    on two rather than shown disabled on one. */}
                {pickedAnchors > 1 && (
                  <>
                    <Divider />
                    <div className="ctx-group">
                      {/* The same six edges the multi-select rail offers, read
                          from the same table — aligning three objects and
                          aligning three anchors are the same question asked of
                          different things, and two tables would be two chances
                          for "middle" to mean different edges. */}
                      {ALIGN_BUTTONS.map(({ edge, label, icon }) => (
                        <RailButton key={edge} label={label} onClick={() => alignPickedAnchors(edge)}>
                          {icon}
                        </RailButton>
                      ))}
                    </div>
                  </>
                )}
                <Divider />
                <div className="ctx-group">
                  <RailButton label="Delete points" hint="Remove these points (Del)" onClick={() => deletePickedAnchor()}>
                    <Trash2 size={15} />
                  </RailButton>
                </div>
              </>
            )}
            <Divider />
          </>
        )}

        {/* ------------------------------------------------------------- text */}
        {showTypography && typography && (
          <>
            <div className="ctx-group">
              {/* In a popover, not inline: the family picker is a 120px
                  dropdown, and inline it made the rail wider than the object
                  it was floating over. */}
              <RailPopover label="Font" trigger={<Type size={16} />} align="start">
                <span className="ctx-popover__label">Font</span>
                <FontSelector value={typography.fontFamily} onChange={(fontFamily) => setTypography({ fontFamily })} />
              </RailPopover>
              <RailButton label="Smaller" onClick={() => setTypography({ fontSize: Math.max(8, typography.fontSize - 2) })}><Minus size={14} /></RailButton>
              <span className="ctx-value">{typography.fontSize}</span>
              <RailButton label="Larger" onClick={() => setTypography({ fontSize: Math.min(500, typography.fontSize + 2) })}>
                <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
              </RailButton>
              {/* The text equivalent of Sketch, and the reason it is a font
                  rather than a filter: a hand-drawn typeface was drawn by
                  hand. Roughening glyph outlines would re-roughen every
                  character on every keystroke, could not be exported as text,
                  and would still be an algorithm's impression of a pen.

                  A toggle rather than a third entry in the font list, because
                  it is a *mode* people flip while laying out a board — the
                  list is still there for choosing which hand. */}
              <RailButton
                label={HANDWRITTEN.includes(typography.fontFamily) ? 'Back to typed' : 'Handwritten'}
                pressed={HANDWRITTEN.includes(typography.fontFamily)}
                onClick={() => setTypography({
                  fontFamily: HANDWRITTEN.includes(typography.fontFamily) ? 'Inter' : 'Caveat',
                })}
              >
                <PenLine size={15} />
              </RailButton>
              <RailButton label="Bold" pressed={typography.fontWeight >= 600} onClick={() => setTypography({ fontWeight: typography.fontWeight >= 600 ? 400 : 700 })}><Bold size={15} /></RailButton>
              <RailButton label="Italic" pressed={typography.italic} onClick={() => setTypography({ italic: !typography.italic })}><Italic size={15} /></RailButton>
              <RailButton label="Underline" pressed={typography.underline} onClick={() => setTypography({ underline: !typography.underline })}><Underline size={15} /></RailButton>
              <RailButton label="Strikethrough" pressed={typography.strikethrough} onClick={() => setTypography({ strikethrough: !typography.strikethrough })}><Strikethrough size={15} /></RailButton>
              {/* On the rail as well as in the panel: turning a few lines into
                  a list is something you do *while writing*, and the walk to
                  the inspector is what stops people doing it. */}
              <RailPopover label="List" trigger={<List size={16} />} align="start">
                <span className="ctx-popover__label">List</span>
                <SegmentedControl
                  ariaLabel="List style"
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
              </RailPopover>
              <RailPopover label="Alignment" trigger={<AlignLeft size={16} />}>
                <span className="ctx-popover__label">Alignment</span>
                <SegmentedControl
                  ariaLabel="Text alignment"
                  value={typography.align}
                  onChange={(align) => setTypography({ align: align as TextAlign })}
                  segments={[
                    { value: 'left', label: 'Left', icon: <AlignLeft size={14} /> },
                    { value: 'center', label: 'Centre', icon: <AlignCenter size={14} /> },
                    { value: 'right', label: 'Right', icon: <AlignRight size={14} /> },
                  ]}
                />
              </RailPopover>
              <ColorPickerPopover color={typography.color} onChange={(color) => setTypography({ color })} />
            </div>
            <Divider />
          </>
        )}

        {/* ------------------------------------------------------------ image */}
        {node.type === 'image' && (
          <>
            <div className="ctx-group">
              {/* Cropping is also on double-click, which is the convention —
                  but a gesture with no visible affordance is a feature most
                  people never discover. */}
              <RailButton
                label={isCropping ? 'Done cropping' : 'Crop image'}
                hint={isCropping ? 'Done cropping (Enter)' : 'Crop image'}
                pressed={isCropping}
                onClick={() => isCropping
                  ? cropMode.commit()
                  : cropMode.enter({
                    nodeId: node.id,
                    node: { x: node.x, y: node.y, width: node.width, height: node.height },
                    crop: node.crop,
                  })}
              ><Crop size={16} /></RailButton>
            </div>
            <Divider />
          </>
        )}

        {/* ------------------------------------------------------------ audio */}
        {node.type === 'audio' && node.src && (
          <>
            <div className="ctx-group">
              <a
                className="ctx-btn"
                href={node.src}
                download={`voice-note-${node.author.name.replace(/\s+/g, '-').toLowerCase()}.webm`}
                data-tooltip="Download recording"
                aria-label="Download recording"
              ><Download size={16} /></a>
            </div>
            <Divider />
          </>
        )}

        {/* ----------------------------------------------------------- sticky */}
        {node.type === 'sticky' && (
          <>
            <div className="ctx-group">
              <StickyPalette
                theme={node.theme}
                onPick={(theme) => {
                  updateProp({ theme });
                  // Recolouring a note also sets what the next one will be,
                  // the way picking a colour does in any drawing tool.
                  useStore.getState().setStickyTheme(theme);
                }}
              />
              {/* The "Size" stepper that used to sit here wrote `fontSize`,
                  which nothing has read since the type became fitted to the
                  note — a control that provably could not change a pixel. See
                  `engine/model/stickyText.ts`. */}
              <RailButton label={node.pinned ? 'Unpin' : 'Pin'} pressed={node.pinned} onClick={() => updateProp({ pinned: !node.pinned })}>
                <Pin size={16} fill={node.pinned ? 'currentColor' : 'none'} />
              </RailButton>
              <div style={{ position: 'relative', display: 'flex' }} ref={reactionsRef}>
                <button type="button" className="ctx-btn" data-tooltip="React" aria-label="React" aria-expanded={showReactions} onClick={() => setShowReactions((v) => !v)}>
                  <SmilePlus size={16} />
                </button>
                {showReactions && (
                  <div className="ctx-popover" style={{ top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', flexDirection: 'row', gap: 2, minWidth: 0, padding: 4 }}>
                    {REACTION_SET.map((emoji) => {
                      const mine = (node.reactions[emoji] ?? []).includes(myAuthorId);
                      return (
                        <button
                          key={emoji}
                          type="button"
                          // A toggle, not a counter: this used to write
                          // `count + 1`, so one person could react five times
                          // and nobody could take a reaction back.
                          onClick={() => { toggleReaction(node.id, emoji, myAuthorId); setShowReactions(false); }}
                          aria-pressed={mine}
                          title={mine ? `Remove ${emoji}` : `React ${emoji}`}
                          style={{
                            background: mine ? 'var(--surface-active)' : 'transparent',
                            border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1,
                            padding: '4px 6px', borderRadius: 6,
                          }}
                        >{emoji}</button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <Divider />
          </>
        )}

        {/* --------------------------------------------------- always present */}
        <div className="ctx-group">
          <RailPopover label="Opacity" trigger={<><Droplet size={16} /><span className="ctx-value">{Math.round((node.opacity ?? 1) * 100)}</span></>}>
            <PopoverSlider
              label="Opacity" suffix="%"
              value={Math.round((node.opacity ?? 1) * 100)} min={0} max={100}
              onChange={(v) => updateProp({ opacity: v / 100 })}
            />
          </RailPopover>
          <RailButton
            label="Comment"
            onClick={() => engineEvents.emit('CommentDraftRequested', { x: node.x + node.width, y: node.y, objectId: node.id })}
          ><MessageSquarePlus size={16} /></RailButton>
          <RailButton
            label="Duplicate" hint="Duplicate (Cmd+D)"
            onClick={() => editor.createNode({ ...(node as unknown as Record<string, unknown>), id: nanoid(), x: node.x + 20, y: node.y + 20 } as never)}
          ><Copy size={16} /></RailButton>

          {/* Everything that is real but rarely reached for. An overflow menu
              rather than eight more buttons: the rail is glanceable only while
              it stays scannable, and a row nobody can parse is not faster than
              the panel it exists to replace. */}
          <RailPopover label="More actions" trigger={<Menu size={16} />} align="end">
            <button className="ctx-menu-item" onClick={() => updateProp({ scaleX: -node.scaleX })}>
              <FlipHorizontal size={15} /> Flip horizontal
            </button>
            <button className="ctx-menu-item" onClick={() => updateProp({ scaleY: -node.scaleY })}>
              <FlipVertical size={15} /> Flip vertical
            </button>
            <button className="ctx-menu-item" onClick={() => updateProp({ zIndex: nextZIndex() })}>
              <BringToFront size={15} /> Bring to front <span className="ctx-menu-item__key">⌘⇧]</span>
            </button>
            <button className="ctx-menu-item" onClick={() => updateProp({ zIndex: lowestZIndex() - 1 })}>
              <SendToBack size={15} /> Send to back <span className="ctx-menu-item__key">⌘⇧[</span>
            </button>
            <button className="ctx-menu-item" onClick={() => updateProp({ locked: !node.locked })}>
              {node.locked ? <Unlock size={15} /> : <Lock size={15} />} {node.locked ? 'Unlock' : 'Lock'}
              <span className="ctx-menu-item__key">⌘⇧L</span>
            </button>
            {node.type === 'shape' && canVectorize(node) && (
              <button className="ctx-menu-item" onClick={() => { const id = flattenToPath(node.id); if (id) editor.select(id); }}>
                <Spline size={15} /> Flatten to path
              </button>
            )}
            {canVectorize(node) && strokeWidth > 0 && (
              <button className="ctx-menu-item" onClick={() => { const id = outlineStrokeOf(node.id); if (id) editor.select(id); }}>
                <Scissors size={15} /> Outline stroke
              </button>
            )}
            <button className="ctx-menu-item ctx-menu-item--danger" onClick={() => { deleteNodesWithFrames([node.id]); onDeselect(); }}>
              <Trash2 size={15} /> Delete <span className="ctx-menu-item__key">Del</span>
            </button>
          </RailPopover>
        </div>
      </Rail>
    </AnimatePresence>
  );
};
