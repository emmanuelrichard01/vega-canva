import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlignCenter,
  AlignHorizontalSpaceAround, AlignJustify, AlignLeft, AlignRight,
  AlignVerticalSpaceAround, Bold, CopyPlus, Crop, Download,
  Droplet, Group, Italic, List, ListOrdered, Layers, Lock,
  MessageSquarePlus, Minus, PenLine, Pin, SmilePlus,
  Square, Waypoints, Radius, WandSparkles, ChevronRight,
  Strikethrough, Trash2, Type, Underline, Ungroup, Unlock,
} from 'lucide-react';
import { TEXT_PRESETS, isTextPresetActive } from './panel/textEffectPresets';

import {
  applyNodePatches, localAuthorId, toggleReaction, updateNodes,
} from '../engine/document';
import { useStore } from '../hooks/useStore';
import { cameraSystem } from '../engine/CameraSystem';
import { engineEvents } from '../engine/EventBus';
import { cropMode } from '../engine/interaction/cropMode';
import { slotReframe } from '../engine/interaction/slotReframe';
import { pathEdit } from '../engine/interaction/pathEdit';
import { railVeil, type VeilKind } from '../engine/interaction/railVeil';
import { lineEdit } from '../engine/interaction/lineEdit';
import { hasBend, isMultiPoint } from '../engine/model/polyline';
import { swapShapeKind } from '../engine/model/shapeSwap';
import { setLineCurved } from '../engine/interaction/lineVertexActions';
import { requestEditOnMount } from '../engine/interaction/pendingEdit';
import { textEditing } from '../engine/interaction/textEditing';
import { Clock, ImageOff, ImagePlus, Palette, Shuffle } from 'lucide-react';
import { GridKindIcon } from './workspace/gridIcons';
import { KindPicker } from './workspace/KindPicker';
import { ChartRailSection } from './toolbar/ChartRailSection';
import { breakApartGrid, gridNodeOf, gridRecipe as gridRecipeFor, setGridRecipe } from '../engine/grid/gridApply';
import {
  fillGridWithImages,
  gridContent,
  recentreSlot,
  releaseSlots,
  setSlotZoom,
} from '../engine/grid/gridSlotApply';
import { clampZoom, SLOT_MAX_ZOOM, SLOT_MIN_ZOOM } from '../engine/grid/gridSlot';
import { switchKind } from '../engine/grid/gridBuild';
import { GRID_HINTS, GRID_KINDS, GRID_LABELS } from '../engine/grid/gridLayout';
import { GRID_PALETTES } from '../engine/grid/gridStyle';
import {
  alignPickedAnchors,
  deletePickedAnchor,
  setMultiplePathsAnchorMode,
  setPickedAnchorMode,
} from '../engine/interaction/pathAnchorActions';
import { applyBoolean, booleanPlans as plansFor, flattenToPath } from '../engine/document/vectorOps';
import { booleanPreview } from '../engine/interaction/booleanPreview';
import { deleteNodesWithFrames } from '../engine/interaction/frameMembership';
import { editor } from '../engine/api/EditorAPI';
import { ColorPickerPopover } from './ui/ColorPickerPopover';
import { FillEditor } from './ui/FillEditor';
import { SegmentedControl } from './ui/SegmentedControl';
import { FontSelector } from './ui/FontSelector';
import { RailPopover } from './toolbar/RailPopover';
import { StickyPalette } from './toolbar/StickyToolbar';

/** The hand-drawn faces, so the toggle knows which state it is in. */
const HANDWRITTEN = ['Caveat', 'Architects Daughter'];
import type { StickyTheme } from '../engine/model/schema';
import {
  DEFAULT_INK, DEFAULT_TYPOGRAPHY, MAX_POLYGON_SIDES, MIN_POLYGON_SIDES, isOpenShape,
  type AnyNode, type Appearance, type ConnectorNode, type ImageNode, type SketchLevel,
  type ListStyle, type TextAlign, type Typography,
} from '../engine/model/schema';
import { FillStyleIcon, ShadingDensityIcon, SketchLevelIcon } from './panel/sketchIcons';
import { HACHURE_ANGLE, SHADING_DENSITIES } from '../engine/model/rough';
import {
  SHADING_DENSITY_HINTS,
  SHADING_DENSITY_LABELS,
  FILL_STYLE_LABELS,
  SKETCH_LEVEL_LABELS,
} from '../engine/model/shadingLabels';
import { EndCapIcon, RouteIcon } from './panel/connectorIcons';
import { StrokeWeightIcon } from './panel/strokeWeightIcon';
import { LineSpecimen } from './panel/lineSpecimen';
import { LineProfileIcon } from './panel/lineProfileIcons';
import { LINE_PROFILES, LINE_PROFILE_LABELS, type LineProfile } from '../engine/model/linePath';
import { END_CAP_KINDS, END_CAP_LABELS, MAX_END_SCALE, MIN_END_SCALE, type EndCapKind } from '../engine/model/connectorEnds';
import type { Routing } from '../engine/model/connector';
import { resolveAffordances, type AffordanceId } from '../engine/selection/affordances';
import { inflate, placeRail, selectionHull, type RailSide } from '../engine/interaction/railPlacement';
import { alignSelection, distributeSelection } from '../engine/model/align';
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
const BOTTOM_DOCK_HEIGHT = 76;
const EDGE_MARGIN = 16;

/**
 * How far the chrome on one side actually reaches into the window.
 *
 * ## Why this is measured and not a constant
 *
 * It was `sidebarsVisible ? 288 : 16` — the Layers and Properties panels'
 * expanded width, hard-coded. `sidebarsVisible` only means "not in
 * presentation mode", so a **collapsed** panel still reserved all 288px: the
 * rail refused to go anywhere near a side that was, by then, empty board. The
 * panels collapse to a narrow rail and the toolbar never found out.
 *
 * Measuring removes the question rather than answering it again. A collapsed
 * panel measures narrow, a hidden one measures zero, a panel someone drags
 * wider measures wider, and none of that needs a second signal or a prop
 * threaded down from whoever owns the collapse state. `PresenceEdgeMarkers`
 * already learned this and the README states it: the edge to use is the edge
 * of the *visible canvas*, measured from the DOM, not the window — markers
 * placed against the window went behind the Properties panel.
 *
 * ## Why the result is cached
 *
 * `updatePosition` runs from a `requestAnimationFrame` loop for as long as the
 * rail is on screen, so measuring inside it would be two forced layouts every
 * frame — the kind of cost that does not show up in a profile as one bad
 * function, only as a canvas that feels heavy while anything is selected.
 *
 * A `ResizeObserver` fires on exactly the events that can change the answer:
 * a panel collapsing, expanding, or being resized, and the window changing
 * size. Between those the answer cannot have changed, so the loop reads a
 * number instead of the DOM.
 */
function chromeInset(selector: string, side: 'left' | 'right'): number {
  const el = document.querySelector(selector);
  if (!el) return EDGE_MARGIN;
  const r = el.getBoundingClientRect();
  // Hidden entirely — presentation mode, or a viewport too narrow for it.
  if (r.width === 0 || r.height === 0) return EDGE_MARGIN;
  const reach = side === 'left' ? r.right : window.innerWidth - r.left;
  // Never *less* than the plain margin: a panel that has scrolled off or is
  // mid-transition must not let the rail sit against the window edge.
  return Math.max(EDGE_MARGIN, reach);
}
const TOP_BAR_HEIGHT = 48;
const RAIL_HEIGHT = 40;

/**
 * Clearance between the rail and the selection it describes, per side.
 *
 * Not one number, because the rail is not equally thick all round.
 * `--shadow-float` is `0 12px 32px -12px`, and `0 16px 32px -12px` in dark mode
 * — a shadow that falls *downward*, reaching about twenty pixels past the
 * rail's own bottom edge. A rail above an object therefore laid that smear
 * straight through the standoff, over the handles and onto the artwork, and on
 * a single line of text there is not enough object for it to miss. Measuring
 * the gap to the rail's box was measuring to the wrong edge.
 *
 * Below it casts almost nothing, and still wants the most room of the four. A
 * gap is not read symmetrically: above an object the rail sits between the work
 * and the top of the screen, where the eye already expects chrome, while below
 * it lands between the work and empty canvas and reads as a caption attached to
 * it. So the two numbers differ on purpose.
 *
 * They are smaller than they were, because they had been inflated to
 * compensate for a coordinate error -- the rail was being drawn a ruler's width
 * above where it was computed, which quietly added to every gap above and took
 * the same amount off every gap below. See the note in the frame loop.
 *
 * The size-aware ramp in `placeRail` widens all four as the subject gets thin,
 * on top of these.
 */
const STANDOFF = { top: 26, bottom: 34, left: 20, right: 20 };
/**
 * How far the selection's chrome reaches past the object's own box.
 *
 * `anchorSize={9}` on the transformer, centred on the edge, plus its 1px
 * stroke: the handles stand about six pixels proud on every side. Measuring the
 * standoff from the raw box therefore left the rail sitting on the bottom
 * handles -- the "obstructs a bit of the object" that no amount of adjusting
 * `STANDOFF` would have explained, because the number was being measured from
 * the wrong edge.
 */
const HANDLE_REACH = 6;

/** Refined, high-intent reaction set for collaborative brainstorming. */
const REACTION_SET = ['👍', '❤️', '🎉', '🔥', '🚀', '👀', '💡', '💯'];

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
 */

/**
 * Corner or smooth, drawn rather than lettered.
 *
 * The two states an anchor can be in are a shape, and the anchors themselves
 * are already drawn square and round to say which — so the buttons that set
 * them use the same two shapes. A pair of words would be a second vocabulary
 * for a distinction the canvas has already taught.
 */
/**
 * Symmetric: one straight tangent through the point, equal on both sides.
 *
 * Drawn as the *handles* rather than as a curve, because that is the
 * distinction it names. Corner and Smooth differ in the shape of the path, so
 * they are drawn as path shapes; Symmetric and Smooth produce the same shape
 * and differ only in what the handles do next — a curve icon could not tell
 * them apart, and two buttons with one picture is worse than a third shape.
 */
const SymmetricIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
    <path d="M2.5 11.5 12.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="2.5" cy="11.5" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="12.5" cy="3.5" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="7.5" cy="7.5" r="2" fill="currentColor" />
  </svg>
);

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

import {
  VectorEditIcon,
  Rail,
  RailButton,
  Divider,
  PopoverSlider,
} from './toolbar/RailBase';
import {
  TYPE_LABEL,
  ALIGN_BUTTONS,
  SHAPE_CHOICES,
} from './toolbar/railConstants';
import { setRailSubject } from './toolbar/railSubject';
import { SHAPE_BY_PRESET } from './workspace/shapeCatalog';
import {
  SHAPE_FACETS,
  SHAPE_GLYPH,
  SHAPE_TILE,
  presetForGeometry,
  shapeGroups,
} from './workspace/shapePicker';
import { VectorBooleanSection } from './toolbar/VectorBooleanSection';
import { cornerRadiiOf } from '../engine/model/cornerRadii';
import { RailMenuButton } from './toolbar/RailBase';
import { CodeRailSection } from './toolbar/CodeRailSection';
import { LinkRailSection } from './toolbar/LinkRailSection';
import { selectionMenu, type CanvasContextMenuActions } from './menu/canvasMenu';
import { canPasteStyle, styleClipboard, type StyleSnapshot } from '../engine/model/styleClipboard';
import { kindNoun } from '../engine/model/selectMatching';
import { SHORTCUTS, withShortcut } from './menu/shortcuts';
import { PaintRoller } from 'lucide-react';
import { boardSurface, textSurface } from '../engine/model/textSurface';

/**
 * The names, from the one module that holds them.
 *
 * These were written out here as `SKETCH_LABELS` and `FILL_LABELS`, and again
 * in `SketchSection` as the labels on its two segmented controls: nine strings
 * each side, identical by hand. The note that used to sit here was right that
 * a label and a tooltip must not disagree, and was solving that inside one
 * file while another file held a second copy of the same nine answers.
 */
const SKETCH_LABELS = SKETCH_LEVEL_LABELS;
const FILL_LABELS = FILL_STYLE_LABELS;

interface Props {
  selectedId: string | null;
  selectedIds?: string[];
  onDeselect: () => void;
  /** Whether the side panels and bottom dock are on screen. */
  sidebarsVisible?: boolean;
  /**
   * The board's commands — the same object the right-click menu runs.
   *
   * The rail's `⋯` opens that menu, and its Duplicate and Paste style run those
   * actions, so a command reached from here and from a right-click cannot do
   * two different things.
   */
  menuActions: CanvasContextMenuActions;
}

/** "3 shapes, 2 connectors" — what a multiple selection is made of. */
function describeMix(nodes: readonly AnyNode[]): string {
  const counts = new Map<string, { node: AnyNode; n: number }>();
  for (const node of nodes) {
    const entry = counts.get(node.type);
    if (entry) entry.n += 1;
    else counts.set(node.type, { node, n: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .map(({ node, n }) => `${n} ${kindNoun(node, n !== 1)}`)
    .join(', ');
}

export const ObjectContextToolbar: React.FC<Props> = ({ selectedId, selectedIds, onDeselect, sidebarsVisible = true, menuActions }) => {
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
   * The rail itself, because its size is an input to where it goes.
   *
   * Estimating it does not work: the union rail carrying four booleans and
   * eight alignment buttons is more than twice the width of a sticky's, and the
   * width decides both how far the rail may slide along the selection and
   * whether there is room to stand beside it at all.
   */
  const railRef = useRef<HTMLDivElement>(null);
  /** How far the side chrome reaches in, re-measured only when it changes. */
  const insetsRef = useRef({ left: EDGE_MARGIN, right: EDGE_MARGIN });
  const [placement, setPlacement] = useState<RailSide>('top');
  /**
   * False when the selection left the rail nowhere to stand.
   *
   * Drives nothing but the rail's resting opacity -- see `.ctx-toolbar--veiled`.
   * When the artwork fills the screen there is no honest way to stay off it, so
   * the rail stops competing instead: it rests quieter and comes fully solid the
   * moment it is reached for.
   */
  const [clear, setClear] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const myAuthorId = localAuthorId();
  const cropping = useSyncExternalStore(cropMode.subscribe, cropMode.getSnapshot, cropMode.getSnapshot);
  const reframing = useSyncExternalStore(
    slotReframe.subscribe,
    slotReframe.getSnapshot,
    slotReframe.getSnapshot
  );
  /** Which line, if any, is open for point editing — so the rail can say so. */
  const lineSelection = useSyncExternalStore(lineEdit.subscribe, lineEdit.getSnapshot, lineEdit.getSnapshot);
  /**
   * Whether the shape swapper has the other family revealed.
   *
   * Up here with the rest of the hooks, not beside the JSX that reads it: the
   * single-object rail returns early for a bulk selection, and a `useState`
   * below that runs on some renders and not others.
   */
  const [otherShapesOpen, setOtherShapesOpen] = useState(false);
  /** Which family the swapper is showing. A view, so it stays out of the document. */
  const [swapCategory, setSwapCategory] = useState('basic');
  // So the button reads as pressed while the anchors are on screen, and can
  // close what it opened.
  const pathSelection = useSyncExternalStore(pathEdit.subscribe, pathEdit.getSnapshot, pathEdit.getSnapshot);
  /**
   * A table's cells are open on the board.
   *
   * The editor brings its own toolbar — formatting, rows, sort — and two rails
   * over one table is two answers to "what can I do here", one of them about
   * the object and one about its cells. The object rail steps back while the
   * cells are open and returns the moment they close (Done, Escape or a click
   * away), exactly as the transform handles do.
   */
  const tableEditing = useStore((s) => s.tableEditNodeId);
  /** The same for a code block: its editor's bar holds language, theme, wrap and Done. */
  const codeEditing = useStore((s) => s.codeEditNodeId);
  const editingPath = pathSelection?.nodeId ?? null;
  /** How many anchors are picked, which is what the anchor rail is gated on. */
  const pickedAnchors = pathSelection?.anchors.length ?? 0;
  /**
   * Whether a gesture is hiding the rail.
   *
   * A module singleton rather than a ref, because the events that raise it are
   * global and because a ref would be re-created if this component ever
   * remounted mid-gesture. See `engine/interaction/railVeil.ts` for why it is
   * falsifiable rather than merely paired.
   */
  /** The element the last transform was written to — see the write guard. */
  const wroteToRef = useRef<HTMLElement | null>(null);
  /**
   * Where the Konva stage begins, in window coordinates.
   *
   * Not a constant: the rulers can be switched off, the window can be resized,
   * and the panels can be hidden. Re-read each frame, at the top of the loop,
   * which is one rect on one element and the only cheap moment to ask.
   */
  const stageOriginRef = useRef({ left: 0, top: 0 });
  const reactionsRef = useRef<HTMLDivElement>(null);
  // Mirrors state, read inside the rAF loop so it can skip setState on frames
  // where nothing moved. The loop has to run unconditionally — it is the only
  // thing tracking the rail during a live drag — but 60 renders a second of an
  // unchanged toolbar was pure waste.
  const lastRef = useRef({ x: -9999, y: -9999, placement: 'top' as RailSide, clear: true, visible: false });

  const isBulk = (selectedIds?.length || 0) > 1;
  const bulkIds = selectedIds || [];
  const activeId = isBulk ? null : selectedId;

  // Stable-identity mirror of the selection, read imperatively by the rAF loop.
  const bulkIdsRef = useRef(bulkIds);
  useEffect(() => { bulkIdsRef.current = selectedIds || []; }, [selectedIds]);

  const liveNode = useStore((state) => (activeId ? state.objects[activeId] : undefined));
  const allObjects = useStore((state) => state.objects);
  /** What Copy style last took, so the rail can offer to put it here. */
  const copiedStyle = useSyncExternalStore(styleClipboard.subscribe, styleClipboard.get, styleClipboard.get);
  /** The group tree, so the grid rail re-renders when a grid is re-laid. */

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
    lastRef.current = { x: -9999, y: -9999, placement: lastRef.current.placement, clear: lastRef.current.clear, visible: false };

    /**
     * Re-measure the chrome, and only when it can have changed.
     *
     * Observed rather than derived from a prop: whether a panel is open is
     * state that lives with the panel, and threading it here would be a second
     * copy of it to keep in step. The DOM already knows, and a collapsed panel
     * is *narrow* rather than absent — so this reads the same for a collapse,
     * an expand, and a drag-resize, none of which have to be told apart.
     */
    const measure = () => {
      insetsRef.current = {
        left: chromeInset('.hierarchy-panel', 'left'),
        right: chromeInset('.context-inspector', 'right'),
      };
    };
    measure();

    const observer = new ResizeObserver(measure);
    for (const sel of ['.hierarchy-panel', '.context-inspector']) {
      const el = document.querySelector(sel);
      if (el) observer.observe(el);
    }
    window.addEventListener('resize', measure);

    const updatePosition = () => {
      // Read before anything is written this frame. Taking a rect after writing
      // a transform forces the browser to lay out again to answer.
      const canvas = document.querySelector('.konvajs-content');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        stageOriginRef.current = { left: rect.left, top: rect.top };
      }

      if (railVeil.held) {
        if (lastRef.current.visible) { lastRef.current.visible = false; setIsVisible(false); }
        return;
      }

      const ids = isBulk ? bulkIdsRef.current : (activeId ? [activeId] : []);
      const store = useStore.getState().objects;
      const nodes = ids.map((id) => store[id]).filter(Boolean);

      /**
       * What the selection actually covers, turns and handles included.
       *
       * The loop used to take `x, y, width, height` straight off the nodes,
       * which is the box *before* rotation -- so a turned shape reached past
       * the rectangle the rail was being kept out of, and the rail sat inside
       * the artwork. `selectionHull` swings the corners; `inflate` then adds the
       * handles, which are part of what the rail must not cover.
       */
      const hull = selectionHull(nodes);
      if (!hull) {
        if (lastRef.current.visible) { lastRef.current.visible = false; setIsVisible(false); }
        return;
      }

      /**
       * World to *window*, which needs the stage's own origin.
       *
       * `cameraSystem.x/y` are an offset within the Konva stage, and the stage
       * does not start at the window's corner: it is inset by the rulers, and
       * by whatever chrome sits above it. The rail is a DOM element positioned
       * against the app container, so leaving the origin out drew it up and to
       * the left of the object by exactly the ruler's width.
       *
       * That is why the two sides behaved differently. Twenty-eight pixels up
       * is twenty-eight pixels of extra air above the object -- which read as
       * correct -- and twenty-eight pixels *off* the gap below it, which is why
       * no amount of raising the standoff below ever quite fixed it. The
       * editor overlay has always added this; the rail never did.
       */
      const stage = stageOriginRef.current;
      const zoom = cameraSystem.zoom;
      const onScreen = inflate({
        x: stage.left + hull.x * zoom + cameraSystem.x,
        y: stage.top + hull.y * zoom + cameraSystem.y,
        width: hull.width * zoom,
        height: hull.height * zoom,
      }, HANDLE_REACH);

      /**
       * The free strip: inside the panels, under the top bar, above the dock.
       *
       * Both insets collapse to a plain margin in presentation mode, where none
       * of that chrome is on screen to be avoided.
       */
      /**
       * The free strip, from where the chrome actually is.
       *
       * Both sides are measured independently, because they collapse
       * independently: opening Layers and closing Properties is an ordinary
       * thing to do and used to move the rail on neither side.
       */
      const { left, right } = sidebarsVisible
        ? insetsRef.current
        : { left: EDGE_MARGIN, right: EDGE_MARGIN };
      const bounds = {
        top: EDGE_MARGIN + TOP_BAR_HEIGHT,
        bottom: window.innerHeight - (sidebarsVisible ? BOTTOM_DOCK_HEIGHT : EDGE_MARGIN),
        left: left + 4,
        right: window.innerWidth - right - 4,
      };

      // Measured, not estimated: the union rail carrying four booleans and eight
      // alignment buttons is more than twice the width of a sticky's, and a
      // guess would decide "it fits beside the object" wrongly in both
      // directions. `offsetWidth` is 0 for one frame before the first paint,
      // which the centring transform covers.
      const rail = {
        width: railRef.current?.offsetWidth || 0,
        height: railRef.current?.offsetHeight || RAIL_HEIGHT,
      };

      // Published for the popovers, which must not open onto the artwork.
      // Here rather than anywhere else because this is where both are already
      // known, and a second computation would be a second answer.
      setRailSubject({ subject: onScreen, bounds });

      const spot = placeRail(onScreen, rail, bounds, STANDOFF, lastRef.current.placement);
      const currentPlacement = spot.side;
      const x = spot.x;
      const y = spot.y;

      const rx = Math.round(x), ry = Math.round(y);
      const last = lastRef.current;

      /**
       * Position: straight to the DOM, every frame, no React involved.
       *
       * The guard is on the *node*, not just the coordinate. On the first pass
       * the rail has not rendered yet, so there is nothing to write to — and
       * recording the coordinate anyway would mark it as done, so the next
       * frame would see no change and skip the write forever. The toolbar then
       * sat untransformed at the canvas origin, translated up out of view by
       * its own centring, and never appeared at all.
       *
       * And the guard remembers **which** node it wrote to, not merely that it
       * wrote. The rail unmounts whenever a gesture veils it and mounts again
       * afterwards, and the replacement element has no transform of its own —
       * so a rail hidden and shown at the *same* coordinates was skipped as
       * "no change" and left at the origin, off screen. Editing a text object
       * does exactly that: the veil goes up, the object does not move, and the
       * rail comes back invisible. Comparing the node makes every mount write
       * its first frame, whatever the arithmetic says.
       */
      if (anchorRef.current && (wroteToRef.current !== anchorRef.current || last.x !== rx || last.y !== ry)) {
        wroteToRef.current = anchorRef.current;
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
      if (last.clear !== spot.clear) {
        lastRef.current.clear = spot.clear;
        setClear(spot.clear);
      }
      if (!last.visible) {
        lastRef.current.visible = true;
        setIsVisible(true);
      }
    };

    const handleDragStart = (e: Event) => {
      // The kind travels on the event; see `ObjectRenderer`'s drag start.
      const kind = (e as CustomEvent<{ kind?: VeilKind }>).detail?.kind ?? 'gesture';
      railVeil.begin(kind);
      lastRef.current.visible = false;
      setIsVisible(false);
    };
    const handleDragEnd = () => { railVeil.end(); updatePosition(); };
    /**
     * The floor under a gesture that never announced its end.
     *
     * Six components dispatch `canvas-drag-start`, and Konva does not fire
     * `dragend` for a node destroyed mid-drag — so a handle unmounted by a
     * selection change, or an object deleted by a collaborator, left the rail
     * hidden for the life of the page. A pointer release with nothing being
     * typed into cannot have a gesture behind it.
     *
     * Capture phase, so a handler that stops propagation on its way up cannot
     * take the recovery with it.
     */
    const handlePointerRelease = () => {
      if (railVeil.settle(textEditing.getSnapshot())) updatePosition();
    };

    engineEvents.on('CameraChanged', updatePosition);
    engineEvents.on('ObjectMoved', updatePosition);
    engineEvents.on('ObjectModified', updatePosition);
    window.addEventListener('canvas-drag-start', handleDragStart);
    window.addEventListener('canvas-drag-end', handleDragEnd);
    window.addEventListener('pointerup', handlePointerRelease, true);
    window.addEventListener('pointercancel', handlePointerRelease, true);
    updatePosition();

    /**
     * The next frame is booked *before* the work, not after.
     *
     * Written the other way round, a single throw inside `updatePosition` ends
     * the loop permanently — and this loop is the only thing that can bring the
     * rail back, so one bad frame meant a reload. Scheduling first costs
     * nothing and makes the loop survive its own mistakes.
     */
    let frame = requestAnimationFrame(function loop() {
      frame = requestAnimationFrame(loop);
      updatePosition();
    });

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      engineEvents.off('CameraChanged', updatePosition);
      engineEvents.off('ObjectMoved', updatePosition);
      engineEvents.off('ObjectModified', updatePosition);
      window.removeEventListener('canvas-drag-start', handleDragStart);
      window.removeEventListener('canvas-drag-end', handleDragEnd);
      window.removeEventListener('pointerup', handlePointerRelease, true);
      window.removeEventListener('pointercancel', handlePointerRelease, true);
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

  /**
   * Take the combine ghost away when the rail stops being the rail it was.
   *
   * `pointerleave` cannot be relied on to clear it: pressing a shortcut that
   * changes the selection, or dismissing the rail, unmounts the button under
   * the pointer without it ever firing — and a stranded blue outline of a shape
   * that is no longer being considered is worse than no preview at all.
   */
  useEffect(() => () => booleanPreview.set(null), []);
  useEffect(() => { booleanPreview.set(null); }, [activeId, isBulk, selectedIds]);

  if ((!activeId && !isBulk) || !isVisible) return null;

  /**
   * The `⋯`: the right-click menu for what the rail is showing.
   *
   * Built when it opens rather than on every render, because the rail renders
   * whenever the selection's objects change — which during a drag is every
   * frame — and the menu is only wanted when somebody asks for it.
   */
  const moreButton = (nodes: AnyNode[]) => (
    <RailMenuButton
      entries={() =>
        selectionMenu({
          nodes,
          allObjects,
          actions: menuActions,
          canEdit: true,
          style: styleClipboard.get(),
          atPointer: false,
        })
      }
    />
  );

  /**
   * Paste style, on the rail only while it would do something here.
   *
   * The format painter's second half is the one that wants to be one click
   * away: you copy a style once and put it on a run of objects, each selected
   * in turn. So the button appears the moment a style is on the clipboard and
   * the selection can take it, wearing the colour it will bring — and stays
   * off the rail the rest of the time, including on the object it came from.
   */
  const pasteStyleButton = (nodes: AnyNode[], style: StyleSnapshot | null) =>
    style && !(nodes.length === 1 && nodes[0].id === style.sourceId) && canPasteStyle(nodes, style) ? (
      <RailButton
        label="Paste style"
        hint={withShortcut(
          `Paste the copied ${kindNoun({ type: style.sourceType } as AnyNode, false)} style`,
          SHORTCUTS.pasteStyle
        )}
        onClick={menuActions.pasteStyle}
      >
        <span className="ctx-paste-style">
          <PaintRoller size={16} />
          {style.swatch && <i style={{ background: style.swatch }} aria-hidden="true" />}
        </span>
      </RailButton>
    ) : null;

  /**
   * A locked selection gets a rail that says so, and one way out.
   *
   * The full rail over a locked object offered fill, stroke, font and a shape
   * swapper for something that could not be dragged — two answers to "can I
   * change this". Miro's answer is the one taken: a locked object shows that it
   * is locked and how to unlock it, and everything else waits behind that one
   * press. The `⋯` is still there, because copying, exporting and commenting on
   * a locked object are all things it is for.
   */
  const lockedRail = (key: string, chip: React.ReactNode, label: string, nodes: AnyNode[]) => (
    <AnimatePresence>
      <Rail id={`${key}-locked`} label={label} placement={placement} clear={clear} anchorRef={anchorRef} ref={railRef}>
        {chip}
        <Divider />
        <span
          className="ctx-locked"
          data-tooltip={nodes.length === 1 ? 'Locked, so it cannot be moved or restyled' : 'All locked, so they cannot be moved or restyled'}
        >
          <Lock size={13} aria-hidden="true" />
          Locked
        </span>
        <RailButton label="Unlock" hint={withShortcut('Unlock to edit', SHORTCUTS.lock)} onClick={menuActions.toggleLock}>
          <Unlock size={16} />
        </RailButton>
        <Divider />
        {nodes.length === 1 && (
          <RailButton label="Comment" onClick={menuActions.comment}>
            <MessageSquarePlus size={16} />
          </RailButton>
        )}
        {moreButton(nodes)}
      </Rail>
    </AnimatePresence>
  );

  // ---------------------------------------------------------------- union rail
  if (isBulk) {
    const bulkNodes = bulkIds.map((id) => allObjects[id]).filter(Boolean) as AnyNode[];
    const countChip = (
      <span className="ctx-kind" data-tooltip={describeMix(bulkNodes)}>
        <Layers size={15} />
        {bulkNodes.length}
      </span>
    );
    const railLabel = `${bulkNodes.length} objects`;
    if (bulkNodes.length > 0 && bulkNodes.every((n) => n.locked)) {
      return lockedRail('union', countChip, railLabel, bulkNodes);
    }

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
    /** The grid this selection names, when it names exactly one. */
    const gridGroup = gridNodeOf(bulkNodes)?.id ?? null;
    /** How much of its content has no module in the current arrangement. */
    const parked = gridGroup ? gridContent(allObjects, gridGroup).parked : 0;
    const bulkAffords = (id: AffordanceId) => bulkOffers.has(id);

    /** The slotted *pictures*, which are the only ones with a source to reframe. */
    const slottedImageIds = bulkNodes
      .filter((n) => n.type === 'image' && n.gridSlot)
      .map((n) => n.id);
    /**
     * The zoom the slider shows for a mixed selection: the first one's.
     *
     * A shared-value readout would be the careful answer and it is the wrong
     * one here, because `Slider` has no mixed state to render — it would have
     * to pick a number anyway, and picking the minimum or the mean would both
     * move every picture on the first touch. The first picture's zoom is at
     * least a value that is true of something in the selection.
     */
    const slotZoom = clampZoom(
      (bulkNodes.find((n) => n.type === 'image' && n.gridSlot) as ImageNode | undefined)?.gridSlot
        ?.zoom
    );

    /**
     * What each of the four combines would produce for this selection.
     *
     * Worked out once, because the same answer drives three things: whether the
     * button is live, the sentence it gives when it is not, and the outline
     * drawn on the canvas while the pointer is on it. Computing the result in
     * order to decide whether to offer the result is not waste -- it is the only
     * honest way to know whether "intersect" has anything to intersect.
     *
     * Memoised inside `booleanPlans` rather than with a hook: this block sits
     * behind `if (isBulk)`, so a `useMemo` here would be a conditional hook.
     */
    const booleanPlans = plansFor(bulkIds);

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
        <Rail id="union" label={railLabel} placement={placement} clear={clear} anchorRef={anchorRef} ref={railRef}>
          {countChip}
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
                        data-tooltip={`${GRID_LABELS[kind]}: ${GRID_HINTS[kind]}`}
                        aria-label={GRID_LABELS[kind]}
                        onClick={() => {
                          const recipe = gridRecipeFor(gridGroup);
                          if (recipe) setGridRecipe(gridGroup, switchKind(recipe, kind));
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
                      setGridRecipe(gridGroup, {
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
                    setGridRecipe(gridGroup, {
                      ...recipe,
                      style: { ...recipe.style, palette: nextPalette.colors },
                    });
                  }}
                >
                  <Palette size={16} />
                </RailButton>

                {/**
                  * Why some of this grid's content is sitting in a strip below
                  * it rather than in the composition.
                  *
                  * Parking is the right behaviour — cycling arrangements must
                  * not destroy anything — but a person who has just switched
                  * from a 3x3 to a manuscript grid sees six photographs jump
                  * out of the board with no explanation. This is that
                  * explanation, and it is the answer to the objection parking
                  * has to carry: a state you cannot name is an invisible one.
                  *
                  * Shown only when there is something waiting, so it costs
                  * nothing the rest of the time.
                  */}
                {parked > 0 && (
                  <span className="ctx-kind" data-tooltip={`${parked} ${parked === 1 ? 'item has' : 'items have'} no module in this arrangement. They are waiting below the grid and will return when there is room.`} data-tooltip-pos="top">
                    <Clock size={14} />
                    {parked}
                  </span>
                )}

                {/* The escape hatch, on the rail rather than buried, because
                    the moment you want it is the moment you are looking at one
                    module and wishing it were somewhere else. */}
                <RailButton
                  label="Break apart"
                  hint="Turn the modules into editable shapes"
                  onClick={() => {
                    const ids = breakApartGrid(gridGroup);
                    if (ids.length > 0) {
                      window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids } }));
                    }
                  }}
                >
                  <Ungroup size={16} />
                </RailButton>
              </div>
              <Divider />
            </>
          )}

          {/**
            * Pictures and the grid to put them in.
            *
            * Its own block rather than part of the grid group above, because
            * that group is gated on the selection being *only* a grid — with
            * pictures selected too, `gridNodeOf` correctly declines to name
            * one, and this is the case where it should.
            *
            * The resolver has already guaranteed exactly one grid and at least
            * one picture, so the button cannot be pressed into doing nothing.
            */}
          {/**
            * What you can do to content that is already in a module.
            *
            * Leads the rail because it is the most specific thing true of the
            * selection, and because the first question anyone has about a
            * picture that will not move is *why won't it move* — a control
            * saying "In a grid · Reframe · Remove" answers that before it is
            * asked.
            *
            * The reframe popover is offered only for pictures: a caption has no
            * source to pan or zoom, and a slider that did nothing for half the
            * selection would be worse than its absence.
            */}
          {bulkAffords('grid-slot') && (
            <>
              <div className="ctx-group">
                {slottedImageIds.length > 0 && (
                  <RailPopover label="Reframe" trigger={<Crop size={16} />} align="start">
                    <span className="ctx-popover__label">
                      Reframe · {slottedImageIds.length}{' '}
                      {slottedImageIds.length === 1 ? 'image' : 'images'}
                    </span>
                    {/* As a percentage, not a multiplier: `PopoverSlider`
                        rounds its readout, so 1.00×–8.00× would show as five
                        identical "1×" steps. The star's Depth control right
                        below takes the same shape for the same reason. */}
                    <PopoverSlider
                      label="Zoom"
                      value={Math.round(slotZoom * 100)}
                      min={SLOT_MIN_ZOOM * 100}
                      max={SLOT_MAX_ZOOM * 100}
                      step={5}
                      suffix="%"
                      onChange={(pct) =>
                        slottedImageIds.forEach((id) => setSlotZoom(id, pct / 100))
                      }
                    />
                    {/**
                      * What the slider is the precise version *of*.
                      *
                      * Reframing is a drag and a scroll wheel on the canvas,
                      * and both are silent: a gesture nobody can discover is a
                      * feature nobody has. This popover is the path that
                      * survives a multiple selection, where a mode belonging to
                      * one picture cannot go.
                      */}
                    <span className="ctx-popover__note">
                      Double-click a picture to move and zoom it by hand, or use
                      the arrow keys.
                    </span>
                    <button
                      type="button"
                      className="ctx-popover__action"
                      onClick={() => recentreSlot(slottedImageIds)}
                    >
                      Recentre
                    </button>
                  </RailPopover>
                )}

                <RailButton
                  label="Remove from grid"
                  hint="Take it out of the module and leave it on the board"
                  onClick={() => releaseSlots(bulkIds)}
                >
                  <ImageOff size={16} />
                </RailButton>
              </div>
              <Divider />
            </>
          )}

          {bulkAffords('grid-fill') && (
            <>
              <div className="ctx-group">
                <RailButton
                  label="Place in grid"
                  hint="Fit each image into a module, cropped to fill"
                  onClick={() => {
                    const grid = bulkNodes.find((n) => n.type === 'grid');
                    if (!grid) return;
                    // Stacking order, not selection order: it is what the
                    // Layers panel shows and what the board looks like, so two
                    // people making the same selection two different ways get
                    // the same arrangement.
                    const images = bulkNodes
                      .filter((n) => n.type === 'image')
                      .sort((a, b) => a.zIndex - b.zIndex)
                      .map((n) => n.id);
                    const { overflow } = fillGridWithImages(grid.id, images);
                    const landed = images.filter((id) => !overflow.includes(id));
                    if (landed.length > 0) {
                      window.dispatchEvent(
                        new CustomEvent('requestSelectNodes', { detail: { ids: landed } })
                      );
                    }
                  }}
                >
                  <ImagePlus size={16} />
                </RailButton>
              </div>
              <Divider />
            </>
          )}

          {/* Zone A — structure. */}
          <div className="ctx-group">
            {bulkAffords('ungroup') ? (
              <RailButton label="Ungroup" hint={withShortcut('Ungroup', SHORTCUTS.ungroup)} onClick={() => editor.ungroupNodes(bulkIds)}><Ungroup size={16} /></RailButton>
            ) : (
              <RailButton label="Group" hint={withShortcut('Group', SHORTCUTS.group)} onClick={() => editor.groupNodes(bulkIds)}><Group size={16} /></RailButton>
            )}
            {bulkAffords('boolean') && (
              <VectorBooleanSection
                booleanPlans={booleanPlans}
                onApplyBoolean={(op) => {
                  const id = applyBoolean(op, bulkIds);
                  if (id) editor.select(id);
                }}
              />
            )}
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

          {/* Multi-vector corner and curve conversion */}
          {bulkNodes.every((n) => (n.type === 'path' && (n.geometry as any)?.kind !== 'freehand') || n.type === 'shape') && (
            <>
              <div className="ctx-group">
                <RailButton
                  label="Make Sharp"
                  hint="Convert all points across selected shapes to sharp corners"
                  onClick={() => setMultiplePathsAnchorMode(bulkIds, 'corner')}
                >
                  <CornerIcon rounded={false} />
                </RailButton>
                <RailButton
                  label="Make Curved"
                  hint="Convert all points across selected shapes to smooth curves"
                  onClick={() => setMultiplePathsAnchorMode(bulkIds, 'smooth')}
                >
                  <CornerIcon rounded />
                </RailButton>
                {/* The same three the single-path rail offers. Two lists of
                    modes is how one of them ends up missing the third. */}
                <RailButton
                  label="Make Symmetric"
                  hint="Convert all points across selected shapes to symmetric — equal handles either side"
                  onClick={() => setMultiplePathsAnchorMode(bulkIds, 'mirrored')}
                >
                  <SymmetricIcon />
                </RailButton>
              </div>
              <Divider />
            </>
          )}

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

          {/* Zone D — bulk management. Restacking moved into the `⋯`, where
              it has all four steps rather than two, and where its order is the
              same one the keyboard uses. */}
          <div className="ctx-group">
            {pasteStyleButton(bulkNodes, copiedStyle)}
            <RailButton label="Duplicate" hint={withShortcut('Duplicate', SHORTCUTS.duplicate)} onClick={menuActions.duplicate}>
              <CopyPlus size={16} />
            </RailButton>
            <RailButton label="Delete" hint={withShortcut('Delete', SHORTCUTS.delete)} danger onClick={() => { deleteNodesWithFrames(bulkIds); onDeselect(); }}>
              <Trash2 size={16} />
            </RailButton>
            {moreButton(bulkNodes)}
          </div>
        </Rail>
      </AnimatePresence>
    );
  }

  // --------------------------------------------------------------- single rail
  if (!liveNode || tableEditing || codeEditing) return null;
  const node = liveNode;
  const isCropping = cropping?.nodeId === node.id;
  const isReframing = reframing?.nodeId === node.id;
  const baseKind = TYPE_LABEL[node.type] ?? { icon: <Square size={15} />, name: node.type };
  /**
   * A shape is named for what it is — Diamond, Cylinder, Arrow — not "Shape".
   *
   * Every one of the sixty kinds said the same word, which told you nothing the
   * outline on the board had not already; the name is the one fact the chip
   * could add, and the catalogue already has it.
   */
  const kind =
    node.type === 'shape'
      ? { ...baseKind, name: SHAPE_BY_PRESET[presetForGeometry(node.geometry)]?.label ?? baseKind.name }
      : baseKind;
  const kindChip = <span className="ctx-kind">{kind.icon}{kind.name}</span>;
  if (node.locked) return lockedRail(node.id, kindChip, kind.name, [node]);

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

  /** Whether this line's own points describe its shape, rather than a profile. */
  const multiPointLine =
    node.type === 'shape' &&
    (isMultiPoint(node.geometry.vertices) ||
      hasBend(node.geometry.bends) ||
      node.geometry.smooth === true);
  /** Whether this line's point editor is open, so the button can close it. */
  const editingLine = lineSelection?.nodeId === node.id;
  /** Whether the run is drawn as a curve, so the toggle reads correctly. */
  const lineCurved = node.type === 'shape' && node.geometry.smooth === true;

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
  /**
   * The two halves of the shape swapper, built once and placed by the popover.
   *
   * Defined here rather than inline so the popover's body reads as the two
   * decisions it offers — this family, then the other one behind a disclosure —
   * instead of two hundred lines in which the order is the only thing that says
   * which matters.
   */
  /**
   * The closed shapes, as the picker the dock uses rather than a wall of tiles.
   *
   * This was one flat grid of every closed shape, which was tolerable at
   * twenty-two and stopped being so at fifty: a popover anchored to an object
   * on the board is the worst place in the product to put an undifferentiated
   * sheet, because it has to fit beside the thing you are editing. Categories,
   * a search field and a line of explanation are the same three answers the
   * dock already gives to the same question, and sharing the control is what
   * stops the two drifting apart again.
   *
   * Narrower than the dock's — five columns rather than six — because this one
   * has to be *placed*, not parked at a screen edge. See `RailPopover`.
   */
  const closedTiles = node.type === 'shape' ? (
    <KindPicker
      columns={5}
      tile={SHAPE_TILE - 8}
      search
      searchPlaceholder="Search shapes"
      groups={shapeGroups(swapCategory, SHAPE_GLYPH - 2)}
      facets={SHAPE_FACETS}
      activeFacet={swapCategory}
      onFacet={setSwapCategory}
      value={presetForGeometry(node.geometry)}
      // Size, paint and position all survive: only the form changes, which is
      // the whole point of a swapper rather than a delete-and-redraw. Through
      // `swapShapeKind`, so the new kind keeps only what it can express.
      onPick={(preset) => {
        const recipe = SHAPE_BY_PRESET[preset].geometry;
        updateProp({
          geometry: swapShapeKind(node.geometry, recipe.kind, recipe.points),
        });
      }}
    />
  ) : null;

  const lineTiles = node.type === 'shape' ? (
    <div className="ctx-shape-grid">
      {SHAPE_CHOICES.filter((c) => isOpenShape(c.kind)).map((choice) => (
        <button
          key={choice.kind}
          type="button"
          className="ctx-shape-btn"
          aria-pressed={node.geometry.kind === choice.kind}
          aria-label={choice.label}
          data-tooltip={choice.label}
          onClick={() => updateProp({ geometry: swapShapeKind(node.geometry, choice.kind) })}
        >
          {/* Under the object's own profile and run, so switching between line
              and arrow shows the one thing that actually differs between them. */}
          <LineSpecimen
            profile={node.geometry.lineProfile}
            endEnd={choice.kind === 'arrow' ? (node.geometry.endEnd ?? 'arrow') : 'none'}
            run={multiPointLine ? (node.geometry.smooth ? 'rounded' : 'corners') : 'two-point'}
          />
        </button>
      ))}
    </div>
  ) : null;

  /**
   * The side count and the star's depth, where the shape has one.
   *
   * They lived only in the properties panel, so changing a hexagon to a
   * heptagon meant leaving the object you were looking at — while the grid
   * beside it offered a *fixed* triangle and hexagon, implying those were the
   * only counts. The presets are shortcuts to common answers; this is the
   * answer itself.
   */
  const shapeCounts = node.type === 'shape' ? (
    <>
      {(node.geometry.kind === 'polygon' || node.geometry.kind === 'star') && (
        <PopoverSlider
          label={node.geometry.kind === 'star' ? 'Points' : 'Sides'}
          value={node.geometry.points ?? 3}
          min={MIN_POLYGON_SIDES}
          max={MAX_POLYGON_SIDES}
          onChange={(points) => updateProp({ geometry: { ...node.geometry, points } })}
        />
      )}
      {/* Star only, and next to its point count for the same reason: the two
          together are what a star *is*. */}
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
    </>
  ) : null;

  /**
   * The profile, and how much of it — for the lines that can have one.
   *
   * A profile is defined along *one* run from A to B, and a line with corners
   * has several, so it is withdrawn for those rather than left to do nothing.
   * The replacement says why: an option that vanishes with no explanation reads
   * as a bug, and the honest sentence is one line.
   */
  const lineStyle = node.type === 'shape' && openShape ? (
    multiPointLine ? (
      <p className="ctx-popover__note">
        This line takes its shape from its points. Round its corners from the
        toolbar, or open the point editor to bend one segment.
      </p>
    ) : (
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
      </>
    )
  ) : null;

  /**
   * The family this object is not in, one press away.
   *
   * A disclosure rather than a hidden command: crossing families throws work
   * away — a line becoming a rectangle loses its run, a rectangle becoming a
   * line loses its fill, its radius and its interior — and one press is the
   * right price for that. The label says which direction it goes, so the
   * consequence is legible before it is opened.
   */
  const otherFamily = (label: string, tiles: React.ReactNode) => (
    <>
      <div className="ctx-popover__rule" role="presentation" />
      <button
        type="button"
        className="ctx-popover__disclosure"
        aria-expanded={otherShapesOpen}
        onClick={() => setOtherShapesOpen((open) => !open)}
      >
        <ChevronRight size={13} className={otherShapesOpen ? 'is-open' : undefined} aria-hidden="true" />
        {label}
      </button>
      {otherShapesOpen && tiles}
    </>
  );

  const showTypography =
    node.type === 'text'
    || (node.type === 'shape' && !isOpenShape(node.geometry.kind)
        && Boolean(node.text && node.text.length > 0));

  return (
    <AnimatePresence>
      <Rail id={node.id} label={kind.name} placement={placement} clear={clear} anchorRef={anchorRef} ref={railRef}>
        {kindChip}
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
                  float
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
                  {/*
                    What the object *is*, first — and the other family behind a
                    disclosure.

                    Both grids used to render in a fixed order with the ten
                    closed shapes on top, so swapping a line to an arrow meant
                    scrolling past a rectangle, an ellipse, a triangle, a
                    pentagon, a hexagon, a star, a heart and a squircle to reach
                    the two tiles that were the whole reason the popover was
                    open. The popover was three times as tall as the decision
                    inside it.

                    Leading with the object's own family is not just shorter, it
                    is the right order: the likely swap is within a family — line
                    to arrow, hexagon to pentagon — and crossing families is a
                    *conversion* that throws work away. A line becoming a
                    rectangle loses its run; a rectangle becoming a line loses
                    its fill, its radius and its interior. One press to reveal is
                    the right price for that, and it is the same reasoning that
                    put the two in separate labelled groups to begin with.
                  */}
                  {openShape ? (
                    <>
                      <span className="ctx-popover__label">Line</span>
                      {lineTiles}
                      {lineStyle}
                      {otherFamily('Convert to a shape', closedTiles)}
                    </>
                  ) : (
                    <>
                      <span className="ctx-popover__label">Shape</span>
                      {closedTiles}
                      {shapeCounts}
                      {/* No "Convert to a line" here: a shape that becomes a
                          line loses its fill, radius and interior, and the
                          line tool is one key away for anyone who wants one. */}
                    </>
                  )}

                  <div className="ctx-popover__rule" role="presentation" />
                  {/*
                    Was six inline style properties with hard-coded rgba
                    fallbacks beside every token — which meant it did not follow
                    the theme, and read as pasted-in rather than built.
                  */}
                  <button
                    type="button"
                    className="ctx-popover__action"
                    onClick={() => flattenToPath(node.id)}
                  >
                    <VectorEditIcon size={14} />
                    Convert to vector path
                  </button>
                </RailPopover>
              )}
              {/* The same editor the Properties panel uses, not a colour-only
                  shortcut — a fill control that could only make flat colours
                  would discard a gradient the moment anyone reached for it. */}
              {!openShape && node.type !== 'connector' && (
                <FillEditor paint={appearance.fill?.[0]} onChange={(fill) => setAppearance({ fill: [fill] })} />
              )}
              {/*
                  A freehand stroke has a stroke colour now, so it gets the
                  control.

                  This withheld it on the reasoning that a pencil mark is a
                  filled outline with no separate stroke render path — true of
                  the *weight*, which the nib fixed when the pen lifted, and no
                  longer true of the colour. Both renderers read `stroke.color`
                  for the ink, so this was hiding the one control that changes
                  what a pencil line looks like.
              */}
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
                        {(['solid', 'hachure', 'crosshatch', 'zigzag', 'dots'] as const).map((st) => (
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
                  {/*
                    Density and angle, and only once there is shading to lay.

                    The popover grows by exactly what the current choice makes
                    meaningful: a solid fill has no strokes to space or turn, so
                    two controls that could not change anything would be two
                    rows of noise on the commonest setting. The panel gates them
                    the same way, from the same two facts.
                  */}
                  {appearance.sketch && !openShape && node.type !== 'connector'
                    && appearance.fillStyle && appearance.fillStyle !== 'solid' && (
                    <>
                      <span className="ctx-popover__label">Density</span>
                      <div className="ctx-shape-grid">
                        {SHADING_DENSITIES.map((d) => (
                          <button
                            key={d}
                            type="button"
                            className="ctx-shape-btn"
                            aria-pressed={(appearance.shadingDensity ?? 'medium') === d}
                            aria-label={SHADING_DENSITY_LABELS[d]}
                            data-tooltip={SHADING_DENSITY_HINTS[d]}
                            onClick={() =>
                              setAppearance({ shadingDensity: d === 'medium' ? undefined : d })
                            }
                          >
                            <ShadingDensityIcon density={d} />
                          </button>
                        ))}
                      </div>
                      <PopoverSlider
                        label="Angle"
                        value={appearance.shadingAngle ?? HACHURE_ANGLE}
                        min={-90}
                        max={90}
                        suffix="°"
                        onChange={(shadingAngle) => setAppearance({ shadingAngle })}
                      />
                    </>
                  )}
                </RailPopover>
              )}
              {node.type === 'shape' && node.geometry.kind === 'rect' && (
                <RailPopover label="Corner radius" trigger={<><CornerIcon rounded /><span className="ctx-value">{cornerRadiiOf(appearance.cornerRadius)[0]}</span></>}>
                  <PopoverSlider
                    label="Corner radius" value={cornerRadiiOf(appearance.cornerRadius)[0]} min={0} max={200}
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
        {/* Anchor editing for vector paths */}
        {node.type === 'path' && node.geometry.kind !== 'freehand' && (
          <>
            <div className="ctx-group">
              <RailButton
                label="Edit points"
                hint="Direct select anchors (A)"
                pressed={editingPath === node.id}
                onClick={() => {
                  if (editingPath === node.id) {
                    pathEdit.exit();
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'select' }));
                    }
                  } else {
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'direct-select' }));
                    }
                    pathEdit.enter(node.id);
                  }
                }}
              >
                <VectorEditIcon size={15} />
              </RailButton>
            </div>

            {editingPath === node.id && (
              <>
                <Divider />
                <div className="ctx-group">
                  {pickedAnchors > 0 && (
                    <span className="ctx-value" style={{ marginRight: 2 }}>{pickedAnchors} pts</span>
                  )}
                  <RailButton
                    label="Corner"
                    hint={pickedAnchors > 0 ? "Make selected points sharp (Corner)" : "Make all points sharp (Corner)"}
                    onClick={() => setPickedAnchorMode('corner')}
                  >
                    <CornerIcon rounded={false} />
                  </RailButton>
                  <RailButton
                    label="Smooth"
                    hint={pickedAnchors > 0 ? "Make selected points curved (Smooth)" : "Make all points curved (Smooth)"}
                    onClick={() => setPickedAnchorMode('smooth')}
                  >
                    <CornerIcon rounded />
                  </RailButton>
                  {/*
                    The third alignment, which the model has always had and
                    nothing could ask for: `HandleMode` declares `mirrored`,
                    `handleMode` derives it, and `moveHandle` honours it — but
                    `setAnchorMode` took two values, so it could only ever come
                    about by dragging until the lengths happened to match.
                    Smooth keeps each handle's own length; symmetric equalises
                    them, which is what a circle's anchors are.
                  */}
                  <RailButton
                    label="Symmetric"
                    hint={
                      pickedAnchors > 0
                        ? 'Make selected points symmetric — equal handles either side'
                        : 'Make all points symmetric — equal handles either side'
                    }
                    onClick={() => setPickedAnchorMode('mirrored')}
                  >
                    <SymmetricIcon />
                  </RailButton>
                </div>
                {/* Align needs two points to mean anything */}
                {pickedAnchors > 1 && (
                  <>
                    <Divider />
                    <div className="ctx-group">
                      {ALIGN_BUTTONS.map(({ edge, label, icon }) => (
                        <RailButton key={edge} label={label} onClick={() => alignPickedAnchors(edge)}>
                          {icon}
                        </RailButton>
                      ))}
                    </div>
                  </>
                )}
                {pickedAnchors > 0 && (
                  <>
                    <Divider />
                    <div className="ctx-group">
                      <RailButton label="Delete points" hint="Remove selected points (Del)" onClick={() => deletePickedAnchor()}>
                        <Trash2 size={15} />
                      </RailButton>
                    </div>
                  </>
                )}
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
              <RailPopover
                label="Alignment"
                trigger={
                  typography.align === 'center' ? (
                    <AlignCenter size={16} />
                  ) : typography.align === 'right' ? (
                    <AlignRight size={16} />
                  ) : typography.align === 'justify' ? (
                    <AlignJustify size={16} />
                  ) : (
                    <AlignLeft size={16} />
                  )
                }
              >
                <span className="ctx-popover__label">Alignment</span>
                <SegmentedControl
                  ariaLabel="Text alignment"
                  value={typography.align}
                  onChange={(align) => setTypography({ align: align as TextAlign })}
                  segments={[
                    { value: 'left', label: 'Left', icon: <AlignLeft size={14} /> },
                    { value: 'center', label: 'Centre', icon: <AlignCenter size={14} /> },
                    { value: 'right', label: 'Right', icon: <AlignRight size={14} /> },
                    { value: 'justify', label: 'Justify', icon: <AlignJustify size={14} /> },
                  ]}
                />
              </RailPopover>
              {/*
                `WandSparkles`, not `Sparkles`: the Forces tool in the dock is a
                bare `Sparkles`, so a shadow-and-blur menu and a physics tool
                were the same mark on the same screen. Neither is wrong on its
                own; sharing is what makes them wrong. The wand keeps the
                "applied effect" reading and is unmistakably a different glyph.
              */}
              <RailPopover label="Effects" trigger={<WandSparkles size={16} />} align="start">
                <span className="ctx-popover__label">Text Effects</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginBottom: '8px' }}>
                  {TEXT_PRESETS.map((preset) => {
                    const active = isTextPresetActive(preset, typography);
                    /**
                     * `aria-pressed`, not a hand-painted selected state.
                     *
                     * These carried five inline colours: a hardcoded `#2563EB`
                     * behind `var(--accent)`, white ink on it, and
                     * `rgba(255,255,255,0.06)` as the resting ground — the
                     * Two-Halves Rule broken three ways, and a resting ground
                     * that is invisible in a light theme.
                     *
                     * `.ctx-shape-btn[aria-pressed='true']` already states the
                     * selected state in tokens. The modifier carries only the
                     * fact that these read as words rather than as glyphs.
                     */
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className="ctx-shape-btn ctx-shape-btn--text"
                        aria-pressed={active}
                        onClick={() => setTypography(preset.patch(typography))}
                        data-tooltip={preset.hint}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                {typography.highlight && (
                  <div className="ctx-popover__row">
                    <span className="ctx-popover__label">Highlight</span>
                    <ColorPickerPopover
                      color={typography.highlight.color}
                      onChange={(color) => setTypography({ highlight: { ...typography.highlight!, color } })}
                    />
                  </div>
                )}
                {typography.outline && (
                  <div className="ctx-popover__row">
                    <span className="ctx-popover__label">Outline</span>
                    <ColorPickerPopover
                      color={typography.outline.color}
                      onChange={(color) => setTypography({ outline: { ...typography.outline!, color } })}
                    />
                  </div>
                )}
                {typography.glow && (
                  <div className="ctx-popover__row">
                    <span className="ctx-popover__label">Glow</span>
                    <ColorPickerPopover
                      color={typography.glow.color}
                      onChange={(color) => setTypography({ glow: { ...typography.glow!, color } })}
                    />
                  </div>
                )}
              </RailPopover>
              <ColorPickerPopover
                color={typography.color}
                onChange={(color) => setTypography({ color })}
                contrastAgainst={textSurface(node, boardSurface())}
              />
            </div>
            <Divider />
          </>
        )}

        {/* ------------------------------------------------------------- line */}
        {node.type === 'shape' && isOpenShape(node.geometry.kind) && (
          <>
            <div className="ctx-group">
              {/*
                Editing the points is on double-click and on Ctrl+Enter, which
                is the convention — and a gesture with no visible affordance is
                a feature most people never find. The old tool made two-point
                lines only, so nobody has any reason to suspect this one can do
                more; a button is how they find out.
              */}
              <RailButton
                label={editingLine ? 'Done editing points' : 'Edit points'}
                hint={editingLine ? 'Done editing points (Esc)' : 'Edit points: add corners and curves (⏎)'}
                pressed={editingLine}
                onClick={() => (editingLine ? lineEdit.end(node.id) : lineEdit.begin(node.id))}
              ><Waypoints size={16} /></RailButton>
              {/*
                The answer to "how do I make it curvy", which is the first
                thing anyone asks after drawing a route: the corners stop being
                corners and the run is drawn as one curve through the same
                points.

                Only once there is a corner to round — a two-point line has
                none, and a control that could not change anything is worse
                than an absent one.

                `Radius`, deliberately, and not `Spline`: the Connect tool in
                the dock wears `Spline`, and two different things sharing a
                glyph is how someone learns the wrong thing about one of them.
                `Radius` is also the glyph the corner-radius handle already
                uses, which is right — this is corner rounding, on a run
                instead of on a box.
              */}
              {isMultiPoint(node.geometry.vertices) && (
                <RailButton
                  label={lineCurved ? 'Sharpen corners' : 'Round corners'}
                  hint={lineCurved ? 'Give the corners back' : 'Draw the run as one smooth curve'}
                  pressed={lineCurved}
                  onClick={() => setLineCurved(node, !lineCurved)}
                ><Radius size={16} /></RailButton>
              )}
              {/*
                A line's label used to be reachable only by double-clicking the
                line — the gesture that now opens the point editor. It was a
                poor home for it anyway: undiscoverable, and a label is an
                annotation *on* a line rather than something inside it.
              */}
              <RailButton
                label={node.text ? 'Edit label' : 'Add label'}
                hint={node.text ? 'Edit label' : 'Add a label to this line'}
                onClick={() => requestEditOnMount(node.id)}
              ><Type size={15} /></RailButton>
            </div>
            <Divider />
          </>
        )}

        {/* ------------------------------------------------------------ image */}
        {node.type === 'image' && (
          <>
            <div className="ctx-group">
              {/**
                * Crop, or reframe, depending on who owns the edges.
                *
                * Both are on double-click, which is the convention -- but a
                * gesture with no visible affordance is a feature most people
                * never find, so it is also a button.
                *
                * A picture in a module cannot be cropped the usual way: the
                * handles would drag a box the grid rewrites on its next pass.
                * Inside a module the frame holds still and the picture moves,
                * which is the same idea with the two halves swapped, and it
                * gets its own verb rather than pretending to be the other one.
                */}
              {node.gridSlot ? (
                <RailButton
                  label={isReframing ? 'Done reframing' : 'Reframe in module'}
                  hint={
                    isReframing
                      ? 'Done reframing (Enter)'
                      : 'Drag to move the picture, scroll to zoom'
                  }
                  pressed={isReframing}
                  onClick={() =>
                    isReframing
                      ? slotReframe.commit()
                      : slotReframe.enter({ nodeId: node.id, fit: node.gridSlot })
                  }
                ><Crop size={16} /></RailButton>
              ) : (
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
              )}
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

        {/* ------------------------------------------------------------ chart */}
        {node.type === 'chart' && <ChartRailSection node={node} />}

        {/* ------------------------------------------------------ code, link */}
        {node.type === 'code' && <CodeRailSection node={node} onRenderDiagram={menuActions.renderDiagram} />}
        {node.type === 'link' && <LinkRailSection node={node} />}

        {/* ----------------------------------------------------------- sticky */}
        {node.type === 'sticky' && (
          <>
            <div className="ctx-group">
              <StickyPalette
                theme={node.theme}
                onPick={(theme: StickyTheme) => {
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
              {/*
                One popover implementation, not two.

                This was hand-rolled: its own open state, its own outside-click
                listener, and `top: calc(100% + 8px)` hard-coded -- so it always
                dropped downward, onto the object whenever the rail was above
                it, and off the bottom of the window when the rail was low. It
                had no Escape, and none of the flipping every other control on
                this rail has had all along.
              */}
              <RailPopover
                label="React"
                align="center"
                trigger={<SmilePlus size={16} />}
              >
                {(close) => (
                  <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
                    {REACTION_SET.map((emoji) => {
                      const mine = (node.reactions[emoji] ?? []).includes(myAuthorId);
                      return (
                        <motion.button
                          key={emoji}
                          type="button"
                          whileHover={{ scale: 1.25, y: -2 }}
                          whileTap={{ scale: 0.88 }}
                          onClick={() => {
                            toggleReaction(node.id, emoji, myAuthorId);
                            close();
                          }}
                          aria-pressed={mine}
                          title={mine ? `Remove ${emoji}` : `React ${emoji}`}
                          className="ctx-reaction"
                          data-mine={mine || undefined}
                        >
                          {emoji}
                        </motion.button>
                      );
                    })}
                  </div>
                )}
              </RailPopover>
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
          <RailButton label="Comment" onClick={menuActions.comment}>
            <MessageSquarePlus size={16} />
          </RailButton>
          {pasteStyleButton([node], copiedStyle)}
          <RailButton
            label="Duplicate"
            hint={withShortcut('Duplicate', SHORTCUTS.duplicate)}
            onClick={menuActions.duplicate}
          ><CopyPlus size={16} /></RailButton>

          {/* Everything real but rarely reached for, as the same menu a
              right-click opens. See `RailMenuButton`. */}
          {moreButton([node])}
        </div>
      </Rail>
    </AnimatePresence>
  );
};
