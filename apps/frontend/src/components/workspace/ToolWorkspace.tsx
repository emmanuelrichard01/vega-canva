import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, MotionConfig, motion, type Transition } from 'framer-motion';
import { GridKindIcon } from './gridIcons';
import { DockSheet, type SheetSection } from './DockSheet';
import { ChartKindIcon } from './chartIcons';
import { CHART_HINTS, CHART_LABELS, chartPickerGroups } from '../../engine/chart/chartKinds';
import { ChartTool } from '../../engine/tools/ChartTool';
import { TableTool } from '../../engine/tools/TableTool';
import { TABLE_EXAMPLES, TABLE_EXAMPLE_CATEGORIES } from '../../engine/table/tableExamples';
import { TableThumb } from '../table/TableThumb';
import { GRID_HINTS, GRID_KINDS, GRID_LABELS } from '../../engine/grid/gridLayout';
import { dockDefaults } from '../../engine/workspace/dockDefaults';
import {
  addSeparator,
  DOCK_SEATS,
  isDefaultLayout,
  moveItem,
  hideSeat,
  removeAt,
  SEPARATOR,
  showSeat,
  type DockItem,
  type DockSeat,
} from '../../engine/workspace/dockLayout';
import { gridDefaults } from '../../engine/grid/gridDefaults';
import { switchKind } from '../../engine/grid/gridBuild';
import {
  BarChart3, MousePointer2, MousePointerClick, LayoutGrid, Pen, PenTool as PenToolIcon, Type, Square, StickyNote, MessageSquare, ImageIcon, Mic, Sparkles, Frame, Eraser, Workflow, MoreVertical, TextQuote } from 'lucide-react';
import { Check, Lock, LockOpen, Minus, Move, RotateCcw, SeparatorVertical, Spline, Table2, Undo2 } from 'lucide-react';
import { SegmentedControl } from '../ui/SegmentedControl';
import { SketchLevelIcon } from '../panel/sketchIcons';
import type { PencilNib } from '../../engine/model/rough';
import { LINE_PROFILES, LINE_PROFILE_LABELS, type LineProfile } from '../../engine/model/linePath';
import { LineProfileIcon } from '../panel/lineProfileIcons';
import { LineSpecimen } from '../panel/lineSpecimen';
import { isForceTool } from '../../engine/physics/forces';
import { FRAME_PRESETS, FRAME_PRESET_GROUPS } from '../../engine/model/frames';
import { ShapeIcon } from './shapeIcons';
import { HandIcon } from './HandIcon';
import {
  LINE_PRESETS,
  SHAPE_BY_PRESET,
  shapeToolId,
  shapeKindFromToolId,
  type ShapePreset,
} from './shapeCatalog';
import { ShapeSheet } from './ShapeSheet';
import { SeatMenu, type QuickChoice } from './SeatMenu';
import { shortcutFor } from '../../engine/tools/shortcuts';
import { DEMO_LENGTHS } from '../../engine/text/demoText';
import { useStore } from '../../hooks/useStore';
import { Slider } from '../ui/Slider';
import { Switch } from '../ui/Switch';
import { isLockable, lockFamily, toolModes } from '../../engine/tools/toolModes';
import { placeSticky, STICKY_SIZE } from '../../engine/tools/StickyTool';
import { THEMES } from '../../engine/model/stickyThemes';
import { STICKY_THEMES, type StickyTheme } from '../../engine/model/schema';
import { cameraSystem } from '../../engine/CameraSystem';
import { editor } from '../../engine/api/EditorAPI';
import { canUseTool } from '../../engine/model/permissions';

/**
 * How the active-tool marker travels from seat to seat.
 *
 * The dock's one authored motion, and the reason there is a single marker at
 * all: the active seat used to be its own inverted fill, so changing tool was
 * one fill going out and another coming on somewhere else, and the eye had to
 * go and find it. A marker that travels shows *where* the tool went -- which
 * is the question a keyboard switch leaves open, since nobody looked at the
 * dock to press `E`.
 *
 * The same exponential settle every other surface uses, so it decelerates and
 * never rebounds; `MotionConfig` below hands it to the reduced-motion setting.
 */
const PUCK_GLIDE: Transition = { type: 'tween', duration: 0.32, ease: [0.16, 1, 0.3, 1] };

/**
 * The tool dock.
 *
 * ## What was wrong with the previous one
 *
 * Twelve buttons, each written out by hand with its own `style={{padding}}`,
 * its own hand-typed `data-tooltip` naming a shortcut that nothing guaranteed
 * was bound, and — behind four of them — four flyouts that shared no structure
 * at all. Shapes were a bare row of icons, frames were a titled list, forces
 * were labelled rows, and the pen was a row plus a slider. Four designs for one
 * idea is three too many: nothing you learn from opening one helps with the
 * next, and every new one is a new small thing to figure out.
 *
 * ## What this is instead
 *
 * One `DockButton`, one `Flyout`, one `FlyoutItem`. Everything on the dock is
 * built from those three, so every button behaves the same way, every flyout
 * opens the same way, and every item in one shows its name beside its icon with
 * its shortcut on the right. The grouping — navigate, draw, create, place,
 * act — is the same reading it always had; it is the execution that is now
 * consistent.
 *
 * ## The keyboard
 *
 * `role="toolbar"` promises arrow-key navigation, and the dock did not deliver
 * it: twelve buttons meant twelve tab stops between the canvas and anything
 * after it. It is one stop now, with the arrows moving along it, which is both
 * the ARIA pattern and what anyone who has used a toolbar expects.
 */

/** One button's worth of dock, so all of them are identical by construction. */
const DockButton = React.forwardRef<
  HTMLButtonElement,
  {
    icon: React.ReactNode;
    /** The short name under the icon on touch, and the accessible name. */
    label: string;
    /** What the tooltip says beyond the name — the "why", not the "what". */
    description?: string;
    toolId?: string;
    active: boolean;
    onClick: () => void;
    hasMenu?: boolean;
    menuOpen?: boolean;
    tabIndex: number;
    children?: React.ReactNode;
    /**
     * Where this seat sits, and whether it is on the dock at all.
     *
     * Applied to the slot rather than to the button, because the slot is what
     * the dock lays out -- see `seatChrome`. Optional so the overflow seat,
     * which is not part of the arrangement, can leave it off.
     */
    seat?: {
      style?: React.CSSProperties;
      hidden?: boolean;
      'data-seat'?: string;
      /** Its place in the arrangement, read back by a drag -- see `dropIndexAt`. */
      'data-dock-index'?: number;
    };
    /** Put this seat away. Present only while the dock is being edited. */
    onRemove?: () => void;
    onPointerDown?: (e: React.PointerEvent) => void;
    /**
     * The dock is being rearranged, so this button is furniture rather than a
     * tool.
     *
     * Without it a seat picked up and put down without moving far enough to
     * reorder still fires its `onClick` -- so tidying the toolbar would switch
     * you to the eraser, which is the kind of thing that makes a mode feel
     * unsafe and stops people using it.
     */
    editing?: boolean;
    /** The dock's one active-tool marker, handed to whichever seat is active. See `PUCK_GLIDE`. */
    puckId?: string;
    /** The armed tool is kept after each use. See `toolModes`. */
    locked?: boolean;
    /** Keep the armed tool, or stop keeping it. Wired to a double-click on the active seat. */
    onToggleLock?: () => void;
    /**
     * Open this seat's menu on purpose: Up from the keyboard, or a tap on the
     * seat while it is armed on a device with no hover -- which is the only way
     * touch reaches a menu that opens on rest.
     */
    onOpenMenu?: () => void;
  }
>(({ icon, label, description, toolId, active, onClick, hasMenu, menuOpen, tabIndex, children, seat, onRemove, onPointerDown, editing, puckId, locked, onToggleLock, onOpenMenu }, ref) => {
  const key = toolId ? shortcutFor(toolId) : undefined;
  /**
   * Three separate things, kept separate.
   *
   * Every seat used to build one string out of a name, an accelerator and a
   * description — "Direct select (A) — anchors and handles" — and it went wrong
   * in three ways at once. The em-dash made a label look like a sentence with
   * an aside. The accelerator sat in bare brackets mid-string, so it read as
   * punctuation rather than as a key, and the tooltip layer could not lift it
   * into a real chip because it only recognises a *trailing* parenthetical.
   * And since some seats carry a description and others do not, no two tips
   * along the row had the same shape.
   *
   * Now the name and its key go in `data-tooltip`, where the layer splits them
   * and sets the key as a `<kbd>`; the description goes in its own attribute
   * and becomes a quieter second line. Every seat renders the same way whether
   * it has one part, two or three.
   *
   * Still read from the shortcut map rather than typed into a string, so the
   * hint and the binding remain the same fact.
   */
  const tooltip = key ? `${label} (${key})` : label;
  /* Capitalised here rather than at ten call sites: these were written as
     fragments to follow a dash, and they now open a line. */
  const tooltipDesc = description
    ? description.charAt(0).toUpperCase() + description.slice(1)
    : undefined;
  const kept = active && Boolean(locked);
  /* A screen reader has no second line to put it on, so it gets one phrase --
     and the padlock, which it cannot see either. */
  const ariaLabel = `${description ? `${label}, ${description}` : label}${kept ? ', kept armed' : ''}`;

  return (
    <div className={hasMenu ? 'dock-slot dock-slot--menu' : 'dock-slot'} {...seat}>
      {/* The way out of the dock, drawn by the slot so all sixteen seats get
          one from one place. Only rendered while editing -- see the `hidden`
          attribute below, which is set by CSS rather than by a prop so the
          button never exists as a tab stop outside the mode. */}
      {onRemove && (
        <button
          type="button"
          className="dock-slot__remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label={`Put ${label} away`}
          title={`Put ${label} away`}
          tabIndex={-1}
        >
          <Minus size={10} />
        </button>
      )}
      <button
        ref={ref}
        type="button"
        className={`btn-icon dock-btn ${hasMenu ? 'dock-more' : ''} ${active ? 'active' : ''}`}
        aria-pressed={active}
        aria-haspopup={hasMenu ? 'menu' : undefined}
        aria-expanded={hasMenu ? menuOpen : undefined}
        onClick={
          editing
            ? undefined
            : () => {
                if (active && onOpenMenu && !window.matchMedia('(hover: hover)').matches) onOpenMenu();
                else onClick();
              }
        }
        onKeyDown={
          onOpenMenu && !editing
            ? (e) => {
                if (e.key !== 'ArrowUp') return;
                e.preventDefault();
                onOpenMenu();
              }
            : undefined
        }
        onPointerDown={onPointerDown}
        // Suppressed while the menu is open: a tooltip and the flyout it
        // belongs to occupy the same space above the button, and the tooltip
        // wins the paint. `TooltipLayer` also watches this attribute, so a tip
        // already on screen when the menu opens is taken down rather than left
        // sitting on top of it.
        data-tooltip={menuOpen ? undefined : tooltip}
        data-tooltip-desc={menuOpen ? undefined : tooltipDesc}
        aria-label={ariaLabel}
        data-label={label}
        tabIndex={tabIndex}
        /* Sketch's and Illustrator's gesture for keeping an insert tool: a
           double-click on the seat that holds it. The first click of the pair
           arms the tool if it was not armed, so one double-click on a cold
           seat arms it *and* keeps it. `Q` does the same from the keyboard. */
        onDoubleClick={!editing && active && onToggleLock ? onToggleLock : undefined}
      >
        {active && puckId && (
          <motion.span
            layoutId={puckId}
            initial={false}
            className="dock-puck"
            aria-hidden="true"
            transition={PUCK_GLIDE}
          />
        )}
        {icon}
        {kept && (
          <span className="dock-lock" aria-hidden="true">
            <Lock strokeWidth={3} />
          </span>
        )}
        {hasMenu && <span className="dock-more__dot" aria-hidden="true" />}
      </button>
      {children}
    </div>
  );
});
DockButton.displayName = 'DockButton';

/**
 * The shell every flyout shares.
 *
 * Positioned above its button and given a title, because a menu that appears
 * with no heading makes you infer what you are choosing from the options
 * themselves. The gap below it is padding rather than margin so the pointer can
 * travel from button to menu without crossing dead space and closing it.
 */
const Flyout: React.FC<{
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  /** No title row: the seat menus, whose row says what they are. The title stays the accessible name. */
  bare?: boolean;
}> = ({
  title,
  children,
  wide,
  bare,
}) => (
  <div role="menu" className="dock-flyout" aria-label={title}>
    <div className={`panel-surface dock-flyout__panel ${wide ? 'dock-flyout__panel--wide' : ''}`}>
      {!bare && <div className="dock-flyout__title" role="presentation">{title}</div>}
      {children}
    </div>
  </div>
);

/**
 * One choice inside a flyout: what it is, what it is called, how to reach it.
 *
 * The shortcut badge is the point. These are the tools most worth learning a
 * key for — they are the ones buried a click deep — and the old menus were the
 * one place in the app that knew which key and did not say.
 */
const FlyoutItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  toolId?: string;
  active: boolean;
  onClick: () => void;
  description?: string;
  /** Right-hand text when there is no shortcut — a frame's dimensions. */
  detail?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}> = ({ icon, label, toolId, active, onClick, description, detail, onMouseEnter, onMouseLeave }) => {
  const key = toolId ? shortcutFor(toolId) : undefined;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={`btn-icon dock-item ${active ? 'active' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      aria-label={description ? `${label}. ${description}` : label}
    >
      <span className="dock-item__icon" aria-hidden="true">{icon}</span>
      <span className="dock-item__label">{label}</span>
      {key && <kbd className="dock-item__key">{key}</kbd>}
      {!key && detail && <span className="dock-item__detail">{detail}</span>}
    </button>
  );
};

/**
 * A nib size, shown as the thing it produces.
 *
 * Neither the pencil nor the eraser had any way to change size — the pencil's
 * was a constant in the class and the eraser's was a literal `15` written in
 * two places. Both are the first thing anyone reaches for after picking up the
 * tool, and neither existed.
 *
 * The dot is the control's own preview: a number alone tells you nothing about
 * what a "6" draws, and this is a property whose whole meaning is visual.
 */
/**
 * A rectangle drawn to a preset's own proportions.
 *
 * A picker of sizes is scanned by shape far faster than it is read by numbers.
 * "The tall one" and "the wide one" is how anybody thinks about this, and a
 * glyph at the preset's ratio answers that without being read at all — where
 * `1080 x 1920` has to be parsed, compared, and turned back into a shape in
 * your head.
 *
 * Fitted inside a fixed box so every glyph occupies the same room and the
 * column stays a column. The *ratio* is the information; the absolute size is
 * not, and scaling by it would make a business card a speck beside a Desktop.
 */
const AspectGlyph: React.FC<{ width: number; height: number }> = ({ width, height }) => {
  const box = 15;
  const scale = Math.min(box / width, box / height);
  return (
    <span className="frame-chip__glyph" aria-hidden="true">
      <span
        style={{
          width: Math.max(3, Math.round(width * scale)),
          height: Math.max(3, Math.round(height * scale)),
        }}
      />
    </span>
  );
};

const ShelfSize: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, onChange }) => (
  /*
    The shared slider, rather than a caption row above a native range.

    It carried its own head — a label and a value on their own line — which is
    the same information the primitive lays out on one, and a native range is
    the thing that follows neither the theme nor the focus ring nor the other
    platforms. Coming through `Slider` also brings the fine-step modifier and
    the typable readout, and a nib size is exactly the kind of value somebody
    arrives already knowing.

    The preview stays: a number alone tells you nothing about what a "6" draws,
    and this is a property whose whole meaning is visual. It lived in the Draw
    and Eraser flyouts as `NibSize`; it lives on the shelf now, which is shown
    for as long as the tool is in your hand rather than for as long as the
    pointer happens to be over its seat.
  */
  <div className="shelf-size">
    <span className="shelf-size__preview" aria-hidden="true">
      <span
        style={{
          // Clamped so the preview stays inside its slot at any size.
          width: Math.min(20, Math.max(2, value)),
          height: Math.min(20, Math.max(2, value)),
        }}
      />
    </span>
    <Slider label={label} value={value} min={min} max={max} unit="px" onChange={onChange} />
  </div>
);

interface Props {
  activeToolId: string;
  /** Open the Mermaid editor. Not a tool — it makes objects and hands back. */
  onOpenDiagram?: () => void;
  /** Drop a placeholder paragraph of roughly this many words. */
  onAddTextBlock?: (words: number) => void;
}

/**
 * The overflow seat's index for the roving tabindex.
 *
 * Every other seat's index now comes from the layout -- see `dockLayout` -- and
 * the drawer is the one that is never part of it, so it takes the position
 * after the last of them. It used to be one entry in a hand-written `SEAT`
 * table that also *was* the dock's order, which is the arrangement that had to
 * become data before anyone could rearrange it.
 */
/**
 * How long the pointer must rest on a dock seat before its flyout opens.
 *
 * Short enough that resting on a button feels immediate, long enough that
 * crossing the dock on the way elsewhere opens nothing.
 */
const HOVER_INTENT = 170;

/**
 * How long a hover-opened flyout waits before believing the pointer has left.
 *
 * Not a comfort delay -- a correctness one. The pointer can end up outside a
 * panel that nobody moved away from, because the panel itself changed size
 * under it, and closing on that reads as the interface flinching away from
 * the click that caused it.
 */
const HOVER_CLOSE_GRACE = 140;

const MORE_SEAT = DOCK_SEATS.length;

/**
 * A seat's name and glyph, for the drawer's list of put-away tools.
 *
 * The dock's own buttons carry these inline, and a seat that has been put away
 * has no button to read them off -- so the drawer needs its own copy. Kept
 * beside the layout rather than inside the render so the two lists are one
 * screen apart, and typed as a full `Record` so putting a new tool on the dock
 * without giving it a name here fails the build rather than showing an
 * unlabelled row nobody can identify.
 */
const SEAT_LABEL: Record<DockSeat, string> = {
  chart: 'Chart', table: 'Table',
  select: 'Select', directSelect: 'Direct select', hand: 'Hand',
  draw: 'Draw', eraser: 'Eraser',
  type: 'Type', shape: 'Shape', line: 'Line',
  frame: 'Frame', grid: 'Grid', connector: 'Connector', sticky: 'Note',
  image: 'Image', audio: 'Audio', forces: 'Forces',
};

/**
 * The tool a seat arms, where arming it is a single act.
 *
 * Read only by the overflow drawer: taking a put-away seat from there restores
 * it *and* arms it, so it is ready to use rather than merely back.
 *
 * Partial on purpose. `block` is the one seat that arms nothing -- it is five
 * paragraph lengths behind a button, not a tool -- so restoring it opens that
 * choice on its own seat, which is exactly where the choice belongs. The other
 * flyout seats do have a sensible default to arm on arrival.
 */
const SEAT_TOOL: Partial<Record<DockSeat, string>> = {
  select: 'select',
  directSelect: 'direct-select',
  hand: 'hand',
  draw: 'pen',
  eraser: 'eraser',
  type: 'text',
  shape: 'shape',
  line: 'line',
  frame: 'frame',
  grid: 'grid',
  chart: 'chart',
  table: 'table',
  connector: 'connector',
  sticky: 'sticky',
  image: 'image',
  audio: 'audio',
  forces: 'forces',
};

const SEAT_GLYPH: Record<DockSeat, React.ReactNode> = {
  select: <MousePointer2 size={16} />, directSelect: <MousePointerClick size={16} />, hand: <HandIcon size={16} />,
  draw: <Pen size={16} />, eraser: <Eraser size={16} />,
  type: <Type size={16} />, shape: <Square size={16} />, line: <Minus size={16} />,
  frame: <Frame size={16} />, grid: <LayoutGrid size={16} />, chart: <BarChart3 size={16} />, table: <Table2 size={16} />, connector: <Spline size={16} />, sticky: <StickyNote size={16} />,
  image: <ImageIcon size={16} />, audio: <Mic size={16} />, forces: <Sparkles size={16} />,
};


/** Which systems each category shows. A constant, so it lives out here:
 *  rebuilt in the component body it was a new object every render and the
 *  memo that reads it could not list it as a dependency. */

export const ToolWorkspace: React.FC<Props> = ({ activeToolId, onOpenDiagram, onAddTextBlock }) => {
  /** What the drawer holds, as data — the menu and the seat's icon read it. */
  const EXTRA_TOOLS: Array<{
    id: string;
    icon: React.ReactNode;
    label: string;
    description: string;
    isActive: (tool: string) => boolean;
    run: () => void;
  }> = [
    {
      id: 'comment', icon: <MessageSquare size={16} />, label: 'Comment',
      description: 'pin a note to a point or an object',
      isActive: (t) => t === 'comment', run: () => setTool('comment'),
    },
    {
      id: 'diagram', icon: <Workflow size={16} />, label: 'Diagram from code',
      description: 'write a flowchart in Mermaid',
      // Never "active": it opens a dialog and hands control straight back.
      isActive: () => false, run: () => onOpenDiagram?.(),
    },
  ];


  const penSize = useStore((s) => s.penSize);
  const setPenSize = useStore((s) => s.setPenSize);
  const pencilNib = useStore((s) => s.pencilNib);
  const penSmoothing = useStore((s) => s.penSmoothing);
  const setPenSmoothing = useStore((s) => s.setPenSmoothing);
  const penKeepSelected = useStore((s) => s.penKeepSelected);
  const setPenKeepSelected = useStore((s) => s.setPenKeepSelected);
  const setPencilNib = useStore((s) => s.setPencilNib);
  const penStrokeWidth = useStore((s) => s.penStrokeWidth);
  const setPenStrokeWidth = useStore((s) => s.setPenStrokeWidth);
  const lineProfile = useStore((s) => s.lineProfile);
  const setLineProfile = useStore((s) => s.setLineProfile);
  const lineSmooth = useStore((s) => s.lineSmooth);
  const setLineSmooth = useStore((s) => s.setLineSmooth);
  const lastForce = useStore((s) => s.lastForce);
  const eraserSize = useStore((s) => s.eraserSize);
  const setEraserSize = useStore((s) => s.setEraserSize);
  const stickyTheme = useStore((s) => s.stickyTheme);
  const setStickyTheme = useStore((s) => s.setStickyTheme);

  /** The lock and the key-hold, for the seat and the shelf. See `toolModes`. */
  const modes = useSyncExternalStore(toolModes.subscribe, toolModes.getSnapshot, toolModes.getSnapshot);
  const lockedHere = modes.locked !== null && modes.locked === lockFamily(activeToolId);
  const heldHere = modes.held !== null && modes.held === activeToolId;
  const toggleLock = () => {
    toolModes.toggleLock();
  };
  /** One marker per dock: there is a second dock in focus mode. */
  const puckId = `dock-puck${useId()}`;

  /**
   * The dock's grouped tools share one menu model.
   *
   * Each opens on hover *or* on click, and only a click keeps it open. Hover
   * alone is a trap: the menu is invisible until you happen to pass over the
   * icon, and on a touch device there is no hover at all — the variants behind
   * these buttons simply could not be reached. One piece of state rather than
   * a pair per menu also guarantees only one can ever be open.
   */
  /**
   * Which grid system the next drag will produce.
   *
   * Read from `gridDefaults` rather than held here, because the tool reads it
   * from there too — a second copy in this component would let the flyout's
   * tick and the preview under the pointer disagree about what is armed.
   */
  const gridKind = useSyncExternalStore(
    gridDefaults.subscribe,
    () => gridDefaults.getSnapshot().spec.kind,
    () => gridDefaults.getSnapshot().spec.kind
  );

  /** Editing the dock is a mode, and a loud one -- see `dock-editing`. */
  const [editing, setEditing] = useState(false);

  type DockMenu = 'pen' | 'shape' | 'frame' | 'grid' | 'chart' | 'table' | 'block' | 'more';
  const [pinnedMenu, setPinnedMenu] = useState<DockMenu | null>(null);
  const [hoveredMenu, setHoveredMenu] = useState<DockMenu | null>(null);
  const [lastShape, setLastShape] = useState<ShapePreset>('rect');
  /**
   * What the Chart, Table and Frame seats wear, and so what a click on each
   * arms: the choice used last. (Grid reads its own from `gridDefaults`.) Local
   * state for the reason `lastShape` is -- a memory of a gesture, not a fact
   * about the board.
   */
  type ChartKindId = typeof ChartTool.kind;
  type GridKindId = (typeof GRID_KINDS)[number];
  const [lastChart, setLastChart] = useState<ChartKindId>(ChartTool.kind);
  const [lastTable, setLastTable] = useState<string>(TableTool.preset);
  const [lastFrame, setLastFrame] = useState<string>('frame');

  /**
   * While the dock is being edited, only the drawer opens.
   *
   * Every other flyout belongs to a *tool* -- which pen, which shape, which
   * grid system -- and in edit mode the seats are not tools, they are furniture
   * being moved. So the menus are noise at best: a panel unfolding over the
   * dock the instant the pointer crosses a button, covering the very gaps the
   * drag is aiming at, and offering choices that do not apply to what you are
   * doing.
   *
   * The drawer is the exception because it *is* the editor -- it holds Done,
   * Add a divider, Reset, and the seats waiting to come back.
   *
   * Suppressed here, at the one place that decides what is open, rather than in
   * each of the seven `hoverProps` call sites. One rule cannot be forgotten by
   * the eighth menu somebody adds.
   */
  const openMenu = editing
    ? (pinnedMenu === 'more' ? 'more' : null)
    : (pinnedMenu ?? hoveredMenu);

  const toggleMenu = (menu: DockMenu) => setPinnedMenu(current => (current === menu ? null : menu));

  /**
   * Hover intent, rather than hover.
   *
   * These opened on `mouseenter` with no delay, so crossing the dock on the way
   * somewhere else unfolded every menu the pointer passed under: three panels
   * bloom and collapse behind it, over the very gaps a drag might be aiming at.
   * The dock's own comment already describes this as "a panel unfolding over
   * the dock the instant the pointer crosses a button", while suppressing it
   * for a different reason.
   *
   * A short wait is the whole difference between passing over a control and
   * resting on one, which is why every desktop menu bar has had one. It is
   * deliberately shorter than the tooltip's delay: for a seat with a menu the
   * flyout is the answer to hovering it, and the tooltip stands down.
   */
  const hoverTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const cancelHoverOpen = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };
  const cancelHoverClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  useEffect(
    () => () => {
      cancelHoverOpen();
      cancelHoverClose();
    },
    []
  );
  const hoverProps = (menu: DockMenu) => ({
    onMouseEnter: () => {
      cancelHoverOpen();
      cancelHoverClose();
      // Already showing a menu: move between seats with no wait, the way a
      // menu bar hands off once one of its menus is open.
      if (hoveredMenu !== null || pinnedMenu !== null) {
        setHoveredMenu(menu);
        return;
      }
      hoverTimer.current = window.setTimeout(() => setHoveredMenu(menu), HOVER_INTENT);
    },
    /**
     * Leaving is given a moment to be a mistake.
     *
     * A hover-opened panel closes when the pointer leaves it, and the pointer
     * can leave it without anybody moving: switching to a category with fewer
     * shapes in it made the panel shorter, the pointer was suddenly below its
     * bottom edge, and the whole flyout vanished mid-click. The panel now
     * holds its height (see `.kp__body`), and this is the belt to that
     * braces -- any geometry change that briefly strands the pointer has a
     * grace period to be corrected before it counts as leaving.
     *
     * Short enough to still feel like a hover menu, long enough that no
     * re-layout can beat it.
     */
    onMouseLeave: () => {
      cancelHoverOpen();
      cancelHoverClose();
      closeTimer.current = window.setTimeout(() => {
        setHoveredMenu((current) => (current === menu ? null : current));
      }, HOVER_CLOSE_GRACE);
    },
    /**
     * A click inside the panel makes it stick.
     *
     * Hovering a seat is a glance; clicking something in the panel it opened
     * is a commitment to working in there, and from that moment the panel
     * should not evaporate because the pointer wandered. This is what every
     * menu bar does, and it is what makes changing category safe: the panel
     * is already pinned by the time it re-lays-out.
     *
     * The seat's own button is excluded -- it has a toggle of its own, and
     * pinning here would fight it.
     */
    onClickCapture: (e: React.MouseEvent) => {
      if (pinnedMenu === menu) return;
      if ((e.target as HTMLElement).closest('.dock-flyout')) setPinnedMenu(menu);
    },
    // Keep presses inside a menu away from the close-on-outside-press listener,
    // which would otherwise cancel the button's own toggle.
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  });

  // A click-opened menu needs an obvious way out: anywhere else, or Escape.
  useEffect(() => {
    if (!pinnedMenu) return;
    const close = () => setPinnedMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinnedMenu(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [pinnedMenu]);

  /**
   * Roving tabindex across the dock.
   *
   * A toolbar is one tab stop with arrows moving inside it. Without this the
   * dock was twelve stops, so tabbing off the canvas meant twelve presses
   * before reaching anything beyond it — and `role="toolbar"` was promising
   * behaviour that was not there.
   */
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const registerButton = useCallback(
    (index: number) => (el: HTMLButtonElement | null) => {
      buttonsRef.current[index] = el;
    },
    []
  );

  const onToolbarKeyDown = (e: React.KeyboardEvent) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    // Arrows inside a flyout or on the shelf belong to the control that has
    // them -- a slider, a segmented choice. The dock took them first, so the
    // Smoothing slider in the Draw flyout could not be moved from the keyboard
    // at all: every arrow moved focus to another seat instead.
    if ((e.target as HTMLElement).closest?.('.dock-flyout, .tool-shelf')) return;
    const live = buttonsRef.current.filter(Boolean) as HTMLButtonElement[];
    if (live.length === 0) return;
    e.preventDefault();

    const current = live.findIndex((b) => b === document.activeElement);
    const from = current === -1 ? focusIndex : current;
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? live.length - 1
      : e.key === 'ArrowRight' ? (from + 1) % live.length
      : (from - 1 + live.length) % live.length;

    setFocusIndex(next);
    live[next]?.focus();
  };

  // Canvas.tsx owns the real ToolManager instance and reacts to this event.
  const setTool = (id: string) => {
    window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: id }));
  };
  const pick = (id: string) => {
    setTool(id);
    setPinnedMenu(null);
  };

  const pickShape = (kind: ShapePreset) => {
    setLastShape(kind);
    pick(shapeToolId(kind));
    // Closed on the pick even when the sheet was opened by hover -- the choice
    // is made, and a sheet left open over the board covers where it will go.
    setHoveredMenu(null);
  };

  /** Picks for the other seats with sheets. Each arms, and closes a hovered menu. */
  const pickChart = (kind: ChartKindId) => {
    // Remembered on the tool and armed, so this is a choice about the next
    // drag rather than thirty tools that would each need registering.
    ChartTool.kind = kind;
    setLastChart(kind);
    pick('chart');
    setHoveredMenu(null);
  };

  const pickGrid = (kind: GridKindId) => {
    gridDefaults.remember(switchKind(gridDefaults.forBox({ x: 0, y: 0, width: 0, height: 0 }), kind));
    pick('grid');
    setHoveredMenu(null);
  };

  const pickTable = (id: string) => {
    TableTool.preset = id;
    setLastTable(id);
    pick('table');
    setHoveredMenu(null);
  };

  const pickFrame = (id: string) => {
    setLastFrame(id);
    pick(id);
    setHoveredMenu(null);
  };

  /**
   * A seat menu's padlock: keep the seat's current choice armed.
   *
   * Pressed on a seat that is not armed, it arms it too -- a padlock that
   * locked nothing until you went and clicked the seat would be a control that
   * does half its job. Armed with `setTool` rather than a pick, so the menu
   * stays open and shows the padlock go down. The lock is set *before* the tool
   * arrives -- see `toolModes.keep`.
   */
  const seatLocked = (toolId: string) => modes.locked !== null && modes.locked === lockFamily(toolId);
  const lockSeat = (toolId: string, arm: () => void) => {
    if (seatLocked(toolId)) {
      toolModes.keep(toolId, false);
      return;
    }
    toolModes.keep(toolId, true);
    if (lockFamily(activeToolId) !== lockFamily(toolId)) arm();
  };

  /**
   * Open a seat's menu from the keyboard (Up on the seat) or from a tap on an
   * armed seat where there is no hover, and put focus in its row.
   */
  const openSeatMenu = (menu: DockMenu) => {
    setPinnedMenu(menu);
    window.setTimeout(() => {
      dockRef.current?.querySelector<HTMLElement>('.dock-flyout .seat-menu__tile')?.focus();
    }, 0);
  };

  /**
   * The three pickers' options, built from the lists that already describe
   * them -- the shape catalogue, `GRID_LABELS`/`GRID_HINTS` and
   * `chartPickerGroups`. Nothing here restates a name or a sentence: a
   * picker that carried its own copy of a label is how the dock came to call
   * something by a name the panel no longer used.
   */
  /**
   * The fixed few each seat menu opens with, and how any choice becomes a
   * tile. Fixed rather than recent -- see `SeatMenu`. Chosen as the ones a
   * board reaches for first; everything else is one press of More away.
   */
  const QUICK_SHAPES: ShapePreset[] = ['rect', 'rounded_rect', 'ellipse', 'triangle', 'diamond', 'star'];
  const QUICK_CHARTS: ChartKindId[] = ['bar', 'line', 'area', 'pie', 'scatter'];
  const QUICK_GRIDS: GridKindId[] = ['columns', 'modular', 'bento', 'masonry', 'golden'];
  const QUICK_FRAMES = ['frame', 'frame-desktop', 'frame-tablet', 'frame-phone', 'frame-a4', 'frame-slide'];
  const QUICK_TABLES = [
    'blank',
    ...TABLE_EXAMPLE_CATEGORIES.slice(0, 3).flatMap((cat) => {
      const first = TABLE_EXAMPLES.find((e) => e.category === cat.id);
      return first ? [first.id] : [];
    }),
  ];

  const shapeTile = (p: ShapePreset): QuickChoice<ShapePreset> => ({
    id: p,
    label: SHAPE_BY_PRESET[p].label,
    icon: <ShapeIcon kind={p} size={18} />,
  });
  const chartTile = (k: ChartKindId): QuickChoice<ChartKindId> => ({
    id: k,
    label: CHART_LABELS[k],
    icon: <ChartKindIcon kind={k} size={18} />,
  });
  const gridTile = (k: GridKindId): QuickChoice<GridKindId> => ({
    id: k,
    label: GRID_LABELS[k],
    icon: <GridKindIcon kind={k} size={18} />,
  });
  const tableTile = (id: string): QuickChoice<string> => {
    const example = TABLE_EXAMPLES.find((e) => e.id === id);
    return example
      ? { id, label: example.name, icon: <TableThumb example={example} crop className="dock-tablethumb dock-tablethumb--mini" /> }
      : { id: 'blank', label: 'Blank table', icon: <Table2 size={18} /> };
  };
  const frameTile = (id: string): QuickChoice<string> => {
    const preset = FRAME_PRESETS.find((p) => `frame-${p.id}` === id);
    return preset
      ? { id, label: preset.label, detail: `${preset.width} × ${preset.height}`, icon: <AspectGlyph width={preset.width} height={preset.height} /> }
      : { id: 'frame', label: 'Custom size', detail: 'drag to size', icon: <Frame size={16} /> };
  };

  /**
   * The sheets' contents, built from the lists that already describe them --
   * `GRID_LABELS`/`GRID_HINTS`, `chartPickerGroups` and the table examples.
   * Nothing here restates a name or a sentence: a picker that carried its own
   * copy of a label is how the dock came to call something by a name the panel
   * no longer used.
   */
  const gridSections = useMemo<SheetSection<GridKindId>[]>(
    () => [
      {
        id: 'systems',
        items: GRID_KINDS.map((kind) => ({
          id: kind,
          label: GRID_LABELS[kind],
          hint: GRID_HINTS[kind],
          icon: <GridKindIcon kind={kind} size={28} />,
        })),
      },
    ],
    []
  );

  const chartSections = useMemo<SheetSection<ChartKindId>[]>(
    () =>
      chartPickerGroups().map((group) => ({
        id: group.family,
        label: group.label,
        items: group.kinds.map((kind) => ({
          id: kind,
          label: CHART_LABELS[kind],
          hint: CHART_HINTS[kind],
          icon: <ChartKindIcon kind={kind} size={24} />,
        })),
      })),
    []
  );

  /**
   * A blank table first, then the examples by what they are for.
   *
   * Each card is the example itself in miniature — header row, tints, merges —
   * cropped to its top-left, because that is the part of a table people
   * recognise it by.
   */
  const tableSections = useMemo<SheetSection<string>[]>(
    () => [
      {
        id: 'start',
        items: [
          { id: 'blank', label: 'Blank table', hint: 'Rows follow the drag; cells open to type', icon: <Table2 size={22} /> },
        ],
      },
      ...TABLE_EXAMPLE_CATEGORIES.map((cat) => ({
        id: cat.id,
        label: cat.label,
        items: TABLE_EXAMPLES.filter((e) => e.category === cat.id).map((e) => ({
          id: e.id,
          label: e.name,
          hint: e.note,
          keywords: e.spec.cells[0] ?? [],
          icon: <TableThumb example={e} crop className="dock-tablethumb" />,
        })),
      })),
    ],
    []
  );

  // `R` arms the bare `shape` id, which the canvas resolves to a rectangle --
  // so the seat and the shelf say rectangle too, rather than nothing.
  const armedShape: ShapePreset | null =
    activeToolId === 'shape' ? 'rect' : shapeKindFromToolId(activeToolId);
  /**
   * Which of the two the seat wears when neither is armed.
   *
   * Local state rather than the store: it is a memory of a *gesture*, not a
   * fact about the board, so it should not sync to anyone else or survive into
   * a document. The same reasoning `lastForce` follows, one level down.
   */
  const [lastLine, setLastLine] = useState<ShapePreset>('arrow');
  /**
   * The two seats both hold `shape-*` tool ids, so neither can claim the whole
   * prefix — the Shape seat lit up while a line was armed until this split the
   * two apart by *which* preset is in hand.
   */
  const armedLine = armedShape && LINE_PRESETS.includes(armedShape) ? armedShape : null;
  /**
   * The preset the *Shape* seat wears — never a line.
   *
   * `armedShape` resolves every preset now, including the two that moved to
   * their own seat, so using it directly made the Shape button change its glyph
   * to a line whenever the line tool was armed. The highlight was fixed and the
   * icon was not, which is arguably the more confusing half: the seat looked
   * like it held something it did not.
   */
  const armedBoxShape = armedShape && !armedLine ? armedShape : null;
  /** What the Shape seat wears, and so what clicking it arms: the armed shape, or the last one used. */
  const seatShape: ShapePreset = armedBoxShape ?? lastShape;
  const isShape = activeToolId.startsWith('shape') && !armedLine;
  const isLine = Boolean(armedLine);
  const isFrame = activeToolId === 'frame' || activeToolId.startsWith('frame-');
  const isPen = ['pen', 'bezier-pen'].includes(activeToolId);
  /** The frame a click on the seat draws: the armed one, or the last one picked. */
  const currentFrame = isFrame ? activeToolId : lastFrame;
  const framePresetNow = FRAME_PRESETS.find((p) => `frame-${p.id}` === currentFrame);
  const frameChoice = framePresetNow
    ? { label: framePresetNow.label, detail: `${framePresetNow.width} × ${framePresetNow.height}` }
    : { label: 'Custom size', detail: 'drag to size' };
  const tableName = TABLE_EXAMPLES.find((e) => e.id === lastTable)?.name ?? 'Blank table';

  /**
   * Where each button sits along the arrow-key run.
   *
   * Written out rather than counted up during render, so the order the arrows
   * walk is a thing you can read and check against the layout instead of an
   * emergent property of which JSX happens to come first.
   */
  /**
   * The person's own arrangement of the dock.
   *
   * Read through `useSyncExternalStore` rather than held here, so the editor's
   * drag, the drawer's restore button and a second dock (there is one on a
   * narrow layout) all read one value -- and so a rearrangement survives a
   * remount, which a `useState` here would not.
   */
  const layout = useSyncExternalStore(
    dockDefaults.subscribe,
    dockDefaults.getSnapshot,
    dockDefaults.getSnapshot
  );

  /**
   * Everything the drawer offers, whether it was born there or was put there.
   *
   * ## Why a put-away seat has to be a real entry
   *
   * The drawer already held two tools that behave properly: Comment arms the
   * comment tool, and the three-dots button becomes a speech bubble while it is
   * armed, so the dock still answers "what am I holding" with the seat that is
   * holding it. A put-away seat listed beside them that only offered to move
   * itself back would be the odd one out in its own menu -- and would make
   * putting a tool away a decision to stop using it, rather than a decision
   * about where it lives.
   *
   * So they are folded into one list. Same rows, same activation, same icon
   * swap on the button. Where a seat *lives* is then genuinely a layout
   * question and nothing more, which is the whole premise of an editable dock.
   */
  const drawerTools = useMemo(() => {
    /**
     * A put-away seat, offered as "put it back and use it".
     *
     * ## Why picking one restores it rather than arming it in place
     *
     * Arming it in place is what this did, and it half-works: it is fine for a
     * tool that is a single act -- the eraser, the hand -- and broken for the
     * seven whose button opens a flyout. Draw is pencil *or* pen at four sizes;
     * Shape is a grid of presets; Grid is ten systems. From a menu row there is
     * nowhere for any of that to go, so the drawer silently armed the default
     * and the rest of the tool was unreachable. A tool you can only half-use is
     * worse than one you have to fetch.
     *
     * Temporarily adding the seat and taking it away again -- the obvious
     * repair -- has no defensible revert moment. After one stroke? After
     * switching tools? After the flyout closes? Every answer is wrong for some
     * tool. And it makes the dock's geometry unstable: buttons that come and go
     * mid-session shift every other seat under the pointer, so muscle memory
     * never forms. That is a worse fault than the one it fixes.
     *
     * So: reaching for a tool in the drawer *is* the signal that it belongs on
     * your dock. It goes back, next to the drawer you clicked -- so it arrives
     * under the pointer rather than somewhere you have to hunt for -- and it
     * arms. Full flyout, full behaviour, no special case. Putting it away again
     * is one drag, and the drawer is where you just were.
     */
    const fromSeats = layout.hidden.map((seat) => {
      const toolId = SEAT_TOOL[seat];
      return {
        id: seat,
        icon: SEAT_GLYPH[seat],
        label: SEAT_LABEL[seat],
        description: 'add to the toolbar',
        // Never "active": it is not the tool, it is the offer to have the tool.
        // Once taken, the seat is on the dock and shows its own state.
        isActive: () => false,
        run: () => {
          // Back on the dock, at the end -- beside the drawer that offered it.
          dockDefaults.set(showSeat(layoutRef.current, seat));
          if (toolId) setTool(toolId);
        },
      };
    });
    return [...EXTRA_TOOLS, ...fromSeats];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.hidden, activeToolId]);

  const activeExtra = drawerTools.find((entry) => entry.isActive(activeToolId));


  /**
   * Escape leaves the mode.
   *
   * Every other mode on this canvas ends on Escape, and one that could only be
   * left through the menu it was entered from would be the exception people
   * find by getting stuck in it. Registered in the capture phase, ahead of the
   * canvas's own Escape handling, so it clears the mode rather than the
   * selection underneath -- and only while the mode is on, so it costs nothing
   * the rest of the time.
   */
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setEditing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing]);
  /** Which seat is under the pointer's grip, or null. */
  const [dragging, setDragging] = useState<DockItem | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  /**
   * The live layout, for the drag's window listeners.
   *
   * The `pointermove` closure is created once per drag and would otherwise
   * capture the layout as it was when the seat was picked up -- so every move
   * after the first would compute its new order from a stale array and undo the
   * previous one. A ref is read at call time, which is what a long-lived
   * listener needs.
   */
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  /**
   * Where each seat sits, as a lookup.
   *
   * Built once per layout rather than calling `indexOf` per seat: sixteen
   * linear scans of a nineteen-item array is nothing, and a map is what the
   * drop calculation wants anyway.
   */
  const seatIndex = useMemo(() => {
    const map = new Map<string, number>();
    layout.order.forEach((item, i) => {
      if (item !== SEPARATOR) map.set(item, i);
    });
    return map;
  }, [layout]);

  const hiddenSeats = useMemo(() => new Set<string>(layout.hidden), [layout]);

  /** `seatIndex` for the drag's window listeners -- see `layoutRef`. */
  const seatIndexRef = useRef(seatIndex);
  seatIndexRef.current = seatIndex;

  /**
   * Everything the dock's layout does to one seat.
   *
   * `order` on the slot, and `hidden` when the seat has been put away. Both go
   * on the *slot* rather than the button because the slot is the flex child --
   * `.dock-group` is `display: contents`, so every slot is a direct child of
   * the dock however the JSX nests them, and CSS `order` can reach across the
   * groups the source still writes them in.
   *
   * Using `order` rather than reordering the JSX is what keeps this a
   * fifty-line change instead of a rewrite of five hundred lines of flyouts:
   * the markup stays in the order a reader would want it in, and the dock lays
   * it out in the order its owner asked for.
   */
  const seatChrome = (id: DockSeat) => {
    const index = seatIndex.get(id);
    return {
      style: { order: index ?? DOCK_SEATS.length },
      hidden: hiddenSeats.has(id),
      'data-seat': id,
      // Stated on the element so a drag reads it back rather than looking it up
      // in a map captured at render time -- see `dropIndexAt`.
      ...(index === undefined ? null : { 'data-dock-index': index }),
    };
  };

  /**
   * A seat's keyboard registration, and its place in the dock.
   *
   * `wrapped` is for the seven seats whose button lives inside a
   * `.dock-slot-wrap` -- the ones with flyouts. There the *wrapper* is the flex
   * child, so it carries the order and the button's own slot must not, or two
   * elements in one `display: contents` chain would both claim a position and
   * the browser would honour the inner one.
   */
  const seatProps = (id: DockSeat, wrapped = false) => {
    const index = DOCK_SEATS.indexOf(id);
    return {
      ref: registerButton(index),
      tabIndex: focusIndex === index ? 0 : -1,
      ...(wrapped ? null : { seat: seatChrome(id) }),
      onPointerDown: editing ? beginSeatDrag(id) : undefined,
      onRemove: editing ? () => dockDefaults.set(hideSeat(layoutRef.current, id)) : undefined,
      editing,
      puckId,
      locked: lockedHere,
      onToggleLock: toggleLock,
    };
  };

  /** The drawer, which is never part of the arrangement. */
  const moreSeatProps = () => ({
    ref: registerButton(MORE_SEAT),
    tabIndex: focusIndex === MORE_SEAT ? 0 : -1,
    // The drawer wears the marker while a tool from it is armed, like any
    // other seat -- see `activeExtra`.
    puckId,
  });

  /**
   * Where a pointer at `clientX` would drop a seat.
   *
   * Measured from the slots as laid out, not computed from the order array,
   * because `order` means the browser has already decided where everything is
   * and the wrapped rows on a narrow viewport make that arithmetic unguessable.
   * Reading the boxes back is both simpler and exactly right.
   *
   * The midpoint test is what makes a drag feel like it is going where you are
   * pointing: past half of a seat's width, you have passed it.
   */
  /**
   * Where a pointer at (`clientX`, `clientY`) would drop what it is carrying.
   *
   * ## Read from the DOM, and from the ref
   *
   * Measured from the items as laid out rather than computed from the order
   * array, because `order` means the browser has already decided where
   * everything is -- and a wrapped dock makes that arithmetic unguessable.
   * Reading the boxes back is both simpler and exactly right.
   *
   * Every position comes off `data-dock-index`, which each item carries. The
   * first version looked its seats up in a `seatIndex` map captured from the
   * render that started the drag, so after the first move it was answering
   * against an arrangement that no longer existed and the item jittered between
   * two places. An index the element states about itself cannot go stale,
   * because the element is re-rendered by the same change that moves it.
   *
   * Separators are targets too. They were skipped -- only `[data-seat]` was
   * queried -- so a gap next to a divider could not be aimed at, and dropping
   * there silently landed somewhere else.
   */
  const dropIndexAt = (clientX: number, clientY: number): number => {
    const dock = dockRef.current;
    if (!dock) return layoutRef.current.order.length;

    const items = Array.from(dock.querySelectorAll<HTMLElement>('[data-dock-index]'))
      .filter((el) => !el.hidden && el.offsetParent !== null);

    let best = layoutRef.current.order.length;
    let bestDistance = Infinity;

    for (const el of items) {
      const index = Number(el.dataset.dockIndex);
      if (!Number.isFinite(index)) continue;
      const box = el.getBoundingClientRect();
      // Rows first: on a wrapped dock the nearest item by x alone can be on a
      // different line entirely, so vertical distance is weighted heavily and
      // measured to the row's edge rather than its centre.
      const dy = Math.max(0, Math.abs(clientY - (box.top + box.height / 2)) - box.height / 2);
      const after = clientX > box.left + box.width / 2;
      const dx = Math.abs(clientX - (after ? box.right : box.left));
      const distance = dy * 4 + dx;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = after ? index + 1 : index;
      }
    }
    return best;
  };

  /** Past this many pixels a press is a drag, and never a click. */
  const DRAG_SLOP = 4;

  /**
   * Pick an item up.
   *
   * ## Why a finder rather than an index
   *
   * Both callers' items move *while the drag is running*, and they know where
   * they are differently. A seat keeps its id through any number of moves, so it
   * is found by id. A separator has no id at all, so it is found by ordinal --
   * "the second divider" -- and re-found on every move, because the previous
   * move is what changed its position.
   *
   * ## Why a press that does not move is not a drag
   *
   * A separator is a three-pixel target that has to support both moving and
   * removing, and it cannot spend a modifier or a second click on the
   * difference. So the gesture decides: past `DRAG_SLOP` it is a move, and a
   * press released without travelling that far is a tap. That is the same rule
   * a canvas uses to tell a click from a marquee, and it means the divider
   * never vanishes when you meant to nudge it -- the failure that made the
   * previous double-click version feel like the dock was falling apart.
   */
  const beginDrag = (
    find: () => number,
    label: DockItem,
    onTap?: () => void
  ) => (e: React.PointerEvent) => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();

    const originX = e.clientX;
    const originY = e.clientY;
    let moved = false;
    // Where the item is *now*, which after the first move is not where it
    // started.
    let at = find();

    const move = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - originX, ev.clientY - originY) < DRAG_SLOP) return;
        moved = true;
        setDragging(label);
      }
      const from = at;
      if (from < 0) return;
      const to = dropIndexAt(ev.clientX, ev.clientY);
      // A drop into either side of the item's own slot is where it already is.
      if (to === from || to === from + 1) return;
      dockDefaults.set({ ...layoutRef.current, order: moveItem(layoutRef.current.order, from, to) });
      // Its landing index: one earlier when it travelled rightwards, because
      // `moveItem` removes before it inserts and everything after the source
      // shifted down by one.
      at = to > from ? to - 1 : to;
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(null);
      if (!moved) onTap?.();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** A seat, found by id so it survives its own reordering. */
  const beginSeatDrag = (id: DockSeat) => beginDrag(() => seatIndexRef.current.get(id) ?? -1, id);

  /** The nth divider's position in the order as it stands right now. */
  const separatorAt = (nth: number) => {
    const marks: number[] = [];
    layoutRef.current.order.forEach((item, at) => {
      if (item === SEPARATOR) marks.push(at);
    });
    return marks[nth] ?? -1;
  };

  /**
   * Put a divider on the dock.
   *
   * ## Why it lands second-to-last rather than at the end
   *
   * `tidy` strips a trailing separator, because a rule with nothing after it is
   * a stray line rather than a division — a rule the arrangement genuinely
   * needs. Appending one therefore *created and immediately destroyed it*, so
   * the menu item did nothing at all and looked broken.
   *
   * One place in from the end is the nearest position that survives, and it is
   * also visible without scrolling and adjacent to the button that made it, so
   * the new divider is under the pointer and ready to be dragged wherever it is
   * actually wanted.
   */
  const addDivider = () => {
    const order = layoutRef.current.order;
    dockDefaults.set(addSeparator(layoutRef.current, Math.max(0, order.length - 1)));
  };

  /* --------------------------------------------------------------- the shelf */

  /**
   * The armed tool's options, on a tray above the dock.
   *
   * ## What was wrong with keeping them in the flyouts
   *
   * A flyout opens when the pointer rests on a seat and closes when it leaves,
   * which is exactly backwards for these: the pencil's size, the eraser's
   * width, a note's colour, a line's profile are what you change *between*
   * strokes, with your eye and the pointer on the board. Every change meant
   * going back down to the dock, hovering, waiting out the intent delay,
   * adjusting, and going back up. And a note's colour could not be chosen
   * before placing one at all -- it was whatever you last used, changed after
   * the fact on the object's own rail.
   *
   * FigJam's answer is a tray that rises from the toolbar while a tool is in
   * hand, and that is the right answer here too, for a reason already written
   * into the Line flyout: **arm here, adjust there**. The shelf is the "arm
   * here" half made visible for as long as it applies. The panel and the rail
   * remain the "adjust there" half, for the object once it exists.
   *
   * ## What is on it
   *
   * Only decisions about the *next* gesture: a note's colour, the pencil's nib
   * and size, the pen's weight, the eraser's size, a line's head, path and
   * profile, a shape from the recent few. Behaviour you set once -- smoothing,
   * keep selected -- stays in the flyout, which is the split that flyout's
   * own comment already drew between "the mark" and "the tool".
   *
   * And the padlock, for any tool that places one object and hands the board
   * back. It is where the lock can be *seen* as well as toggled: `Q` and a
   * double-click on the seat are fast, and neither says it exists.
   *
   * ## When it stands down
   *
   * While any flyout is open, and while the dock is being edited. Two panels
   * stacked above one dock is two answers to "where do I click".
   */
  const shelfName =
    activeToolId === 'sticky' ? 'Note'
    : activeToolId === 'pen' ? 'Pencil'
    : activeToolId === 'bezier-pen' ? 'Pen'
    : activeToolId === 'eraser' ? 'Eraser'
    : isLine ? 'Line'
    : isShape ? 'Shape'
    : isFrame ? 'Frame'
    : activeToolId === 'text' ? 'Text'
    : activeToolId === 'grid' ? 'Grid'
    : activeToolId === 'chart' ? 'Chart'
    : activeToolId === 'table' ? 'Table'
    : null;

  let shelfBody: React.ReactNode = null;
  if (activeToolId === 'sticky') {
    shelfBody = (
      <div className="shelf-swatches" role="radiogroup" aria-label="Note colour">
        {STICKY_THEMES.map((id) => {
          const name = id[0].toUpperCase() + id.slice(1);
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={id === stickyTheme}
              aria-label={name}
              data-tooltip={name}
              className="shelf-swatch"
              style={{ background: THEMES[id].bg, borderColor: THEMES[id].edge }}
              onClick={() => setStickyTheme(id as StickyTheme)}
            />
          );
        })}
      </div>
    );
  } else if (activeToolId === 'pen') {
    shelfBody = (
      <>
        {/* Which nib is in the pencil. A tool setting rather than an object
            one, because a stroke is finished the moment the pen lifts —
            deciding afterwards means drawing a line, selecting it and changing
            it, every time.

            Called "Nib" rather than "Stroke". A stroke has a colour and a
            weight of its own on every pencil mark — see `PenTool`'s appearance
            — so four *textures* under that word would name the wrong thing. */}
        <SegmentedControl
          ariaLabel="Pencil nib"
          value={pencilNib}
          onChange={(v) => setPencilNib(v as PencilNib)}
          segments={[
            { value: 'smooth', label: 'Smooth', hint: 'One continuous, tapered line', icon: <Minus size={14} /> },
            { value: 'light', label: 'Drawn', hint: 'Gone over once, by hand', icon: <SketchLevelIcon level="light" /> },
            { value: 'medium', label: 'Sketched', hint: 'Gone over twice', icon: <SketchLevelIcon level="medium" /> },
            { value: 'heavy', label: 'Scribbled', hint: 'Twice, and past every turn', icon: <SketchLevelIcon level="heavy" /> },
          ]}
        />
        <span className="dock-rule" aria-hidden="true" />
        <ShelfSize label="Size" value={penSize} min={1} max={60} onChange={setPenSize} />
      </>
    );
  } else if (activeToolId === 'bezier-pen') {
    shelfBody = (
      <ShelfSize label="Weight" value={penStrokeWidth} min={1} max={40} onChange={setPenStrokeWidth} />
    );
  } else if (activeToolId === 'eraser') {
    // A width, the same unit the pencil's own Size means. It was read as a
    // radius once, so the tip was twice the number shown and the top of the
    // range was unreachable in practice.
    shelfBody = <ShelfSize label="Size" value={eraserSize} min={4} max={120} onChange={setEraserSize} />;
  } else if (isLine) {
    const lineKind = armedLine ?? lastLine;
    shelfBody = (
      <>
        {/* Each choice shows itself under the armed profile, so the two differ
            by the one thing they choose between — a head or no head. */}
        <SegmentedControl
          ariaLabel="Line or arrow"
          value={lineKind}
          onChange={(v) => {
            setLastLine(v as ShapePreset);
            pick(shapeToolId(v as ShapePreset));
          }}
          segments={LINE_PRESETS.map((kind) => ({
            value: kind,
            label: SHAPE_BY_PRESET[kind].label,
            hint: SHAPE_BY_PRESET[kind].label,
            icon: <LineSpecimen profile={lineProfile} endEnd={kind === 'arrow' ? 'arrow' : 'none'} />,
          }))}
        />
        <span className="dock-rule" aria-hidden="true" />
        {/* The decision nobody could find: a line can be two points or a run
            of corners, and the gesture decides which. The hint says the
            gesture outright, which is the part that actually teaches. */}
        <SegmentedControl
          ariaLabel="Line path"
          value={lineSmooth ? 'rounded' : 'corners'}
          onChange={(v) => {
            setLineSmooth(v === 'rounded');
            pick(shapeToolId(lineKind));
          }}
          segments={[
            { value: 'corners', label: 'Corners', hint: 'Sharp turns. Click once per corner, Enter to finish', icon: <LineSpecimen run="corners" /> },
            { value: 'rounded', label: 'Rounded', hint: 'The corners are curved away', icon: <LineSpecimen run="rounded" /> },
          ]}
        />
        <span className="dock-rule" aria-hidden="true" />
        {/* A profile is defined along one run from A to B, so it applies to
            two-point lines; the group says so rather than hiding on a guess
            about what you are about to draw. */}
        <SegmentedControl
          ariaLabel="Line style, for two-point lines"
          value={lineProfile}
          onChange={(v) => {
            setLineProfile(v as LineProfile);
            pick(shapeToolId(lineKind));
          }}
          segments={LINE_PROFILES.map((profile) => ({
            value: profile,
            label: LINE_PROFILE_LABELS[profile],
            hint: LINE_PROFILE_LABELS[profile],
            icon: <LineProfileIcon profile={profile} />,
          }))}
        />
      </>
    );
  }

  // Shape, Frame, Grid, Chart and Table carry their padlock in their own seat
  // menu -- see `SeatMenu` -- so the shelf only keeps it for Text and Note.
  const hasSeatMenu = isShape || isFrame || ['chart', 'grid', 'table'].includes(activeToolId);
  const shelfLock = isLockable(activeToolId) && !hasSeatMenu ? (
    <button
      type="button"
      className="btn-icon shelf-btn shelf-lock"
      aria-pressed={lockedHere}
      aria-label={lockedHere ? 'Stop keeping this tool armed' : 'Keep this tool armed'}
      data-tooltip={lockedHere ? 'Kept armed (Q)' : 'Keep armed (Q)'}
      data-tooltip-desc={
        lockedHere
          ? 'It stays in your hand after each one. Esc hands back to Select'
          : 'Place several in a row without coming back to the dock'
      }
      onClick={toggleLock}
    >
      {lockedHere ? <Lock size={15} /> : <LockOpen size={15} />}
    </button>
  ) : null;

  const showShelf =
    !editing && openMenu === null && shelfName !== null && (shelfBody !== null || shelfLock !== null);

  /* ----------------------------------------------------- a note off the pad */

  /**
   * Drag a note off the dock and put it down where you let go.
   *
   * ## Why only the note
   *
   * It is the one seat whose glyph is the object itself, at a size that does
   * not need deciding: a note is 200 by 200 and sits where it is put. A shape
   * dragged off the dock would still need a size and a preset, which is a
   * drag on the board with the tool -- the gesture that already exists. So the
   * note gets the pad-of-paper gesture and nothing pretends to.
   *
   * ## Why it starts only upward
   *
   * Sliding sideways along the dock is how people cross it, and the seat's
   * ordinary job is to be clicked. A carry begins when the pointer has lifted
   * clear of the dock (`CARRY_LIFT`), so a click that wobbles is still a click.
   *
   * ## What it looks like
   *
   * Over the board the ghost is the note at the size it will land at, at the
   * current zoom -- a preview of the result, not of the button. Over the
   * chrome, where letting go puts nothing down, it shrinks to a token. Its
   * position is written straight to the element on every move, never through
   * React state, for the same reason the presence layer does it.
   */
  const CARRY_LIFT = 12;
  const [carry, setCarry] = useState<StickyTheme | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const carryPoint = useRef({ x: 0, y: 0 });
  /** Set for the click that follows the release of a carry -- see the seat. */
  const carryEnded = useRef(false);

  const placeGhost = (x: number, y: number) => {
    carryPoint.current = { x, y };
    const el = ghostRef.current;
    if (!el) return;
    const onBoard = Boolean(document.elementFromPoint(x, y)?.closest('.konvajs-content'));
    const size = onBoard ? Math.min(240, Math.max(40, STICKY_SIZE * cameraSystem.zoom)) : 44;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    // Centred on the pointer by its own size, so a size change does not move it.
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    el.dataset.over = onBoard ? 'board' : 'chrome';
  };

  // The ghost's first frame, once it exists to be placed.
  useLayoutEffect(() => {
    if (carry) placeGhost(carryPoint.current.x, carryPoint.current.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carry]);

  const beginStickyCarry = (e: React.PointerEvent) => {
    if (e.button !== 0 || !canUseTool('sticky')) return;
    const button = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const originY = e.clientY;
    let carrying = false;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!carrying) {
        if (originY - ev.clientY < CARRY_LIFT) return;
        carrying = true;
        // Captured, so the board under the pointer sees none of this: no hover
        // outlines, no marquee from the select tool.
        try { button.setPointerCapture(pointerId); } catch { /* already released */ }
        carryPoint.current = { x: ev.clientX, y: ev.clientY };
        setPinnedMenu(null);
        setHoveredMenu(null);
        setCarry(useStore.getState().stickyTheme);
        return;
      }
      placeGhost(ev.clientX, ev.clientY);
    };

    const finish = (ev: PointerEvent | null) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKey, true);
      if (!carrying) return;
      // A captured pointer's click lands on the seat; this keeps it from
      // arming the tool the note was just dragged out of.
      carryEnded.current = true;
      window.setTimeout(() => { carryEnded.current = false; }, 0);
      try { button.releasePointerCapture(pointerId); } catch { /* already released */ }
      setCarry(null);
      if (!ev) return;

      const stage = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.konvajs-content');
      if (!stage) return;
      const box = stage.getBoundingClientRect();
      const world = cameraSystem.screenToWorld(ev.clientX - box.left, ev.clientY - box.top);
      if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return;
      placeSticky(editor, world.x, world.y);
    };

    const up = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(ev);
    };
    const cancel = () => finish(null);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !carrying) return;
      ev.stopPropagation();
      finish(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey, true);
  };


  return (
    <MotionConfig reducedMotion="user">
    <div
      ref={dockRef}
      className="tool-dock panel-surface"
      // Held on its key rather than armed -- the marker goes hollow. See
      // `toolModes`.
      data-held={heldHere || undefined}
      // The walkthrough finds its anchors by this attribute rather than by a
      // ref threaded down from `Room`. See `engine/learn/tour.ts`; a test fails
      // if a step names an anchor nothing carries.
      data-tour="dock"
      data-editing={editing || undefined}
      data-dragging={dragging || undefined}
      role="toolbar"
      aria-label="Canvas tools"
      aria-orientation="horizontal"
      onKeyDown={onToolbarKeyDown}
    >
      <AnimatePresence>
        {showShelf && (
          <motion.div
            key="shelf"
            className="tool-shelf panel-surface"
            role="group"
            aria-label={`${shelfName} options`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {shelfBody}
            {shelfBody !== null && shelfLock && <span className="dock-rule" aria-hidden="true" />}
            {shelfLock}
          </motion.div>
        )}
      </AnimatePresence>
      {/**
        * The separators, rendered from the layout rather than written between
        * the groups.
        *
        * They are items in the order like any seat, so they take an `order` of
        * their own and land wherever their owner put them. The groups in the
        * markup below are `display: contents` and draw nothing -- they survive
        * only because they are the comments that explain what the tools are
        * *for*, and losing that to a flat list would cost a future reader more
        * than the divs cost the browser.
        */}
      {layout.order.map((item, i) => {
        if (item !== SEPARATOR) return null;
        // Which separator this is, counting from the left. A separator has no
        // id, so its ordinal is the only stable handle on it across a drag that
        // is moving it.
        const nth = layout.order.slice(0, i).filter((it) => it === SEPARATOR).length;
        return (
          <span
            key={`sep-${i}`}
            className="dock-rule"
            style={{ order: i }}
            role={editing ? undefined : 'separator'}
            aria-hidden={!editing}
            data-dock-index={i}
            /* Drag to move, tap to remove -- see `beginDrag`. Found by ordinal
               because a separator has no id, and re-found on every move. */
            onPointerDown={
              editing
                ? beginDrag(
                    () => separatorAt(nth),
                    SEPARATOR,
                    () => {
                      const at = separatorAt(nth);
                      if (at >= 0) dockDefaults.set(removeAt(layoutRef.current, at));
                    }
                  )
                : undefined
            }
            title={editing ? 'Drag to move, click to remove' : undefined}
          />
        );
      })}
      {/* Navigate. Two tools that move you rather than change the board, so
          they lead and are separated from everything that creates. */}
      <div className="dock-group">
        <DockButton
          {...seatProps('select')}
          icon={<MousePointer2 size={18} />} label="Select" toolId="select"
          active={activeToolId === 'select'} onClick={() => setTool('select')}
        />
        {/* Direct selection sits beside Select because it is the same act at a
            different grain — one asks which object, the other which part of it.
            Every vector editor pairs them, and putting it in a drawer would
            make the only way to reshape a curve a thing you have to find. */}
        <DockButton
          {...seatProps('directSelect')}
          icon={<MousePointerClick size={18} />} label="Direct select" toolId="direct-select"
          description="anchors and handles"
          active={activeToolId === 'direct-select'} onClick={() => setTool('direct-select')}
        />
        <DockButton
          {...seatProps('hand')}
          icon={<HandIcon />} label="Hand" toolId="hand"
          description="pan the board"
          active={activeToolId === 'hand'} onClick={() => setTool('hand')}
        />
      </div>

      {/* Draw. Freehand and bezier live behind one button because they are the
          same act with different precision; the eraser belongs with them. */}
      <div className="dock-group">
        <div {...hoverProps('pen')} className="dock-slot-wrap" {...seatChrome('draw')}>
            <DockButton
              {...seatProps('draw', true)}
              icon={activeToolId === 'bezier-pen' ? <PenToolIcon size={18} /> : <Pen size={18} />}
              label="Draw" active={isPen} hasMenu menuOpen={openMenu === 'pen'}
              onClick={() => toggleMenu('pen')}
            >
              {openMenu === 'pen' && (
                <Flyout title="Draw">
                  <FlyoutItem
                    icon={<Pen size={16} />} label="Pencil" toolId="pen"
                    description="freehand" active={activeToolId === 'pen'}
                    onClick={() => pick('pen')}
                  />
                  <FlyoutItem
                    icon={<PenToolIcon size={16} />} label="Pen" toolId="bezier-pen"
                    description="anchor points and curves" active={activeToolId === 'bezier-pen'}
                    onClick={() => pick('bezier-pen')}
                  />
                  {/*
                    The options below belong to whichever tool is armed.

                    They were all shown at once, which meant arming the Pen
                    offered a brush size and a pencil nib — two controls that
                    would not touch the next thing it drew. A flyout listing
                    two tools and then one undifferentiated pile of settings
                    makes you work out which of them apply, and the answer is
                    not written anywhere.

                    The two tool entries stay above, because that list is what
                    the seat is: hovering it should say what is in it. What
                    changes is everything under the rule.
                  */}
                  {/* Nothing at all until one of them is armed.
                      The seat holds two tools, and with neither picked there is
                      no answer to "whose settings are these" — showing the
                      pencil's by default made the flyout claim a tool was
                      selected when none was, and the brush size sat there
                      looking like it applied to whatever you did next. An
                      empty list of two tools is the honest first state: pick
                      one, then it tells you about it. */}
                  {activeToolId === 'pen' && <div className="flyout-rule" role="presentation" />}
                  {/*
                    The settings get their own width.

                    The flyout is 200px, which is right for a list of tool
                    names and too narrow for a slider: the Size and Smoothing
                    tracks came out 44 and 38 pixels wide, which is not an
                    instrument but a decoration you can nudge, and the label
                    column alone was taking a third of the row.

                    Declared on a wrapper rather than on the shared `--wide`
                    modifier, which is the mistake the frame picker made one
                    commit ago: a modifier named for a *degree* gets worn by
                    everything that wants any of it, and widening it moved
                    three unrelated flyouts.
                  */}
                  {/*
                    The **mark** moved to the shelf; the **behaviour** stayed.

                    This flyout held two groups with a rule between them: what
                    the mark looks like (size, nib) and how the tool behaves
                    while you use it (smoothing, keep selected). The comment
                    that drew that line also said when each is reached -- the
                    mark every time you decide what you are drawing, the
                    behaviour once and then never again.

                    That is the split between the shelf and the flyout exactly.
                    The shelf is on screen for as long as the pencil is in your
                    hand, so the thing you change stroke to stroke is where your
                    eye already is; the flyout is a hover away, which is right
                    for something you set once. The Pen's stroke weight went
                    the same way, which leaves it with nothing under the rule.
                  */}
                  {activeToolId !== 'pen' ? null : (
                  <div className="draw-settings">
                      {/*
                        Fidelity, which the tool has always had and never
                        offered.

                        `streamline` was two hard-coded numbers chosen by input
                        device, and the reasoning was sound — mouse samples
                        arrive in bursts shaped by the OS, and every burst
                        became a bulge. The constant was still the wrong shape.
                        How literal a line should be is a property of what is
                        being drawn: handwriting wants the hand's own wobble
                        and a quick circle wants none of it, on the same
                        device. The device is an offset now; this is the value.

                        Marked at 40 and 72 — the two settings worth returning
                        to. 72 is where the tool has always sat and what the
                        reference workflows recommend for freehand; 40 is about
                        as literal as a mouse can usefully be.
                      */}
                      <div className="flyout-field">
                        <Slider
                          label="Smoothing"
                          value={penSmoothing}
                          min={0}
                          max={100}
                          ticks={[40, 72]}
                          onChange={setPenSmoothing}
                          hint="How much of your hand's movement the line ignores. Low follows every wobble; high draws through it."
                        />
                      </div>
                      {/*
                        Off by default, and it is the setting anybody who draws
                        a lot ends up on: a stroke that stays selected puts a
                        handle under the next press and changes the panel
                        between strokes. On is right for the other job —
                        drawing one line and restyling it — which is why it is
                        a preference rather than a decision.
                      */}
                      <div className="flyout-field flyout-field--row">
                        <span className="flyout-field__label">Keep selected</span>
                        <Switch
                          checked={penKeepSelected}
                          onChange={setPenKeepSelected}
                          tooltip="Leave the stroke you just drew selected"
                        />
                      </div>
                  </div>
                  )}
                </Flyout>
              )}
            </DockButton>
        </div>

        {/* No flyout. Its one setting, the size, is on the shelf while the
            eraser is armed, and `[` / `]` change it from the keyboard -- a
            menu holding a single slider put the thing you adjust mid-erase a
            hover away from where you were erasing. */}
        <DockButton
          {...seatProps('eraser')}
          icon={<Eraser size={17} />} label="Eraser" toolId="eraser"
          description="[ and ] resize it"
          active={activeToolId === 'eraser'}
          onClick={() => setTool('eraser')}
        />
      </div>

      {/* Create. The old dock put seven buttons in one undifferentiated run
          here, which is the density problem in one line: a row that long is
          scanned rather than read, so nothing in it is found quickly. */}
      <div className="dock-group">
        {/**
          * Type: the text tool, and the paragraph blocks, on one seat.
          *
          * ## Why these are now grouped, when a note here argued they should not be
          *
          * That note said folding them together would make "one seat that
          * sometimes arms and sometimes creates, which is the kind of button
          * people stop trusting". The observation is right and the conclusion
          * was wrong, because the seat does not have to do both: **clicking it
          * always arms the Text tool**, and the blocks live in the flyout,
          * which is the same shape as Draw -- click arms the pencil, the flyout
          * offers the pen. What made the old pairing untrustworthy would have
          * been a button whose *primary* click changed meaning, and that is not
          * what this is.
          *
          * The flyout labels the two groups with different verbs, so the arm /
          * insert distinction is stated rather than inferred.
          *
          * It also buys back a seat, which is what let the text block come off
          * the hidden list -- it was only ever put there because the dock
          * overflowed a laptop by one button.
          */}
        <div {...hoverProps('block')} className="dock-slot-wrap" {...seatChrome('type')}>
          <DockButton
            {...seatProps('type', true)}
            icon={<Type size={17} />} label="Type" toolId="text"
            description="text and paragraph blocks"
            active={activeToolId === 'text'}
            hasMenu
            menuOpen={openMenu === 'block'}
            // The seat arms the tool; the caret is what opens the choices. A
            // menu that stole the click would make the commonest act -- place
            // some text -- cost two.
            onClick={() => setTool('text')}
          >
            {openMenu === 'block' && (
              <Flyout title="Type" wide>
                <div className="dock-flyout__group" role="presentation">Draw a box</div>
                <FlyoutItem
                  icon={<Type size={15} />}
                  label="Text"
                  detail={shortcutFor('text') ?? undefined}
                  description="click or drag on the board"
                  active={activeToolId === 'text'}
                  onClick={() => { setPinnedMenu(null); setTool('text'); }}
                />
                {/* Readable English rather than lorem ipsum -- see
                    `engine/text/demoText.ts` for why that matters here. */}
                <div className="dock-flyout__group" role="presentation">Drop a paragraph</div>
                {DEMO_LENGTHS.map((words) => (
                  <FlyoutItem
                    key={words}
                    icon={<TextQuote size={15} />}
                    label={`${words} words`}
                    detail={words <= 30 ? 'caption' : words <= 50 ? 'paragraph' : 'body copy'}
                    active={false}
                    onClick={() => { setPinnedMenu(null); onAddTextBlock?.(words); }}
                  />
                ))}
              </Flyout>
            )}
          </DockButton>
        </div>

        {/* Shapes. Click arms the shape the seat is wearing -- the last one
            used. Resting on the seat opens its menu: a row of the common few
            and the padlock, with every shape one press of More away. See
            `SeatMenu`.

            The click used to open a menu and arm nothing, so the commonest
            act on this seat, drawing another of the same, cost a trip through
            a menu; and a double-click to keep the tool had nothing to keep. */}
        <div {...hoverProps('shape')} className="dock-slot-wrap" {...seatChrome('shape')}>
          <DockButton
            {...seatProps('shape', true)}
            icon={<ShapeIcon kind={seatShape} size={18} />}
            label="Shape" toolId="shape"
            description={SHAPE_BY_PRESET[seatShape].label}
            active={isShape}
            hasMenu
            menuOpen={openMenu === 'shape'}
            onClick={() => pick(shapeToolId(seatShape))}
            onOpenMenu={() => openSeatMenu('shape')}
          >
            {openMenu === 'shape' && (
              <Flyout title="Shapes" bare>
                <SeatMenu
                  noun="shapes"
                  quick={QUICK_SHAPES.map(shapeTile)}
                  current={shapeTile(seatShape)}
                  onPick={pickShape}
                  locked={seatLocked(shapeToolId(seatShape))}
                  onLock={() => lockSeat(shapeToolId(seatShape), () => setTool(shapeToolId(seatShape)))}
                  sheet={<ShapeSheet value={armedBoxShape} onPick={pickShape} focusSearch />}
                />
              </Flyout>
            )}
          </DockButton>
        </div>

        {/* Line and arrow, paired the way the pencil and the pen are.

            They were entries in the Shape flyout, in a grid of rectangles and
            polygons, which implied a similarity the tools do not have: every
            other entry there is drawn by dragging a box, while these are drawn
            click–move–click, have two ends rather than four corners, and are
            edited by their endpoints. Same node type in the document, different
            gesture in the hand — and the dock describes gestures.

            The seat wears whichever of the two was used last, so switching
            between them costs one click rather than a trip through a menu.

            It has no flyout any more. Everything the flyout held -- line or
            arrow, corners or rounded, the profile -- decides what the *next*
            line comes out as, which is exactly what the shelf is for: it rises
            the moment the seat is armed and keeps those three choices in view
            while you draw, where the flyout kept them a hover away and closed
            them the moment you reached for the board. The sentence that taught
            the gesture is the seat's description now, and the hint on Corners. */}
        <DockButton
          {...seatProps('line')}
          /* The line it will draw — profile *and* head — not a generic
             dash. The seat already changed glyph for line versus arrow, and
             the profile is the same kind of fact about the same gesture; a
             seat that showed a straight dash and then drew a coil would be
             lying about what pressing it does. Generated from `linePoints`
             and `endCapShape`, so it cannot drift from the result. */
          icon={
            <LineSpecimen
              profile={lineProfile}
              endEnd={(armedLine ?? lastLine) === 'arrow' ? 'arrow' : 'none'}
            />
          }
          label={`${LINE_PROFILE_LABELS[lineProfile]} ${SHAPE_BY_PRESET[armedLine ?? lastLine].label.toLowerCase()}`}
          description="drag, or click once per corner"
          active={isLine}
          onClick={() => pick(shapeToolId(armedLine ?? lastLine))}
        />

        {/*
          Frame, Grid, Chart and Table follow Shape exactly: click arms the
          choice the seat wears (the size, system, chart or table used last);
          resting opens a row of the common few with More and the padlock; the
          full sheet grows upward from the row on request. See `SeatMenu`.
        */}

        {/* Frames. The choice is a size: what a *click* on the board produces.
            Dragging always sizes by hand. Expanded, it keeps its three
            columns rather than a scroll, because its groups *are* its columns
            -- Screen, Social, Print side by side, so a Story and an A4 are
            compared at a glance. */}
        <div {...hoverProps('frame')} className="dock-slot-wrap" {...seatChrome('frame')}>
          <DockButton
            {...seatProps('frame', true)}
            icon={<Frame size={17} />} label="Frame" toolId="frame"
            description={frameChoice.detail ? `${frameChoice.label}, ${frameChoice.detail}` : frameChoice.label}
            active={isFrame} hasMenu menuOpen={openMenu === 'frame'}
            onClick={() => pick(currentFrame)}
            onOpenMenu={() => openSeatMenu('frame')}
          >
            {openMenu === 'frame' && (
              <Flyout title="Frame size" bare>
                <SeatMenu
                  noun="sizes"
                  quick={QUICK_FRAMES.map(frameTile)}
                  current={frameTile(currentFrame)}
                  onPick={pickFrame}
                  locked={seatLocked(currentFrame)}
                  onLock={() => lockSeat(currentFrame, () => setTool(currentFrame))}
                  sheet={
                    <div className="frame-picker">
                      {FRAME_PRESET_GROUPS.map((group) => (
                        <div className="frame-picker__col" key={group}>
                          <div className="dock-flyout__group" role="presentation">{group}</div>
                          {FRAME_PRESETS.filter((p) => p.group === group).map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              className="frame-chip"
                              data-active={currentFrame === `frame-${preset.id}` || undefined}
                              onClick={() => pickFrame(`frame-${preset.id}`)}
                              aria-label={`${preset.label}, ${preset.width} by ${preset.height}`}
                            >
                              <AspectGlyph width={preset.width} height={preset.height} />
                              <span className="frame-chip__text">
                                <span className="frame-chip__label">{preset.label}</span>
                                <span className="frame-chip__size">
                                  {preset.width} × {preset.height}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  }
                />
              </Flyout>
            )}
          </DockButton>
        </div>

        {/* Grid. Beside Frame because both answer "where does everything go"
            — a frame bounds a composition, a grid divides one — and because
            drawing a grid inside a frame you have just drawn is the sequence
            people actually perform. The seat wears the system it will draw.
            Expanded: twelve captioned cards and no search, because filtering
            twelve pictures you can already see is slower than looking. */}
        <div {...hoverProps('grid')} className="dock-slot-wrap" {...seatChrome('grid')}>
          <DockButton
            {...seatProps('grid', true)}
            icon={<GridKindIcon kind={gridKind} size={18} />} label="Grid" toolId="grid"
            description={GRID_LABELS[gridKind]}
            active={activeToolId === 'grid'} hasMenu menuOpen={openMenu === 'grid'}
            onClick={() => pick('grid')}
            onOpenMenu={() => openSeatMenu('grid')}
          >
            {openMenu === 'grid' && (
              <Flyout title="Grid system" bare>
                <SeatMenu
                  noun="grids"
                  quick={QUICK_GRIDS.map(gridTile)}
                  current={gridTile(gridKind)}
                  onPick={pickGrid}
                  locked={seatLocked('grid')}
                  onLock={() => lockSeat('grid', () => setTool('grid'))}
                  sheet={
                    <DockSheet
                      variant="card"
                      columns={3}
                      width={318}
                      sections={gridSections}
                      value={gridKind}
                      onPick={pickGrid}
                      idle="Pick a system, then drag it out on the board"
                    />
                  }
                />
              </Flyout>
            )}
          </DockButton>
        </div>

        {/* Chart. Beside Grid because both are composite objects built from a
            drag, and the menu asks the same shape of question -- which kind,
            before the gesture. Expanded, grouped by the question a chart
            answers: nobody arrives wanting "a stacked area", they arrive
            wanting to show how a total split up over time. */}
        <div {...hoverProps('chart')} className="dock-slot-wrap" {...seatChrome('chart')}>
          <DockButton
            {...seatProps('chart', true)}
            icon={<ChartKindIcon kind={lastChart} size={18} />} label="Chart" toolId="chart"
            description={CHART_LABELS[lastChart]}
            active={activeToolId === 'chart'} hasMenu menuOpen={openMenu === 'chart'}
            onClick={() => pickChart(lastChart)}
            onOpenMenu={() => openSeatMenu('chart')}
          >
            {openMenu === 'chart' && (
              <Flyout title="Chart type" bare>
                <SeatMenu
                  noun="charts"
                  quick={QUICK_CHARTS.map(chartTile)}
                  current={chartTile(lastChart)}
                  onPick={pickChart}
                  locked={seatLocked('chart')}
                  onLock={() => lockSeat('chart', () => { ChartTool.kind = lastChart; setTool('chart'); })}
                  sheet={
                    <DockSheet
                      variant="card"
                      columns={4}
                      width={344}
                      height={320}
                      searchPlaceholder="Search charts"
                      sections={chartSections}
                      value={lastChart}
                      onPick={pickChart}
                      focusSearch
                      idle="Pick what the chart should show, then drag it out"
                    />
                  }
                />
              </Flyout>
            )}
          </DockButton>
        </div>

        {/* Table. Beside Chart: the two are where data lives on a board, and a
            table is often the step before the chart. Blank first, then the
            finished examples by what they are for, each drawn in miniature by
            the board's own painter. */}
        <div {...hoverProps('table')} className="dock-slot-wrap" {...seatChrome('table')}>
          <DockButton
            {...seatProps('table', true)}
            icon={<Table2 size={17} />} label="Table" toolId="table"
            description={tableName}
            active={activeToolId === 'table'} hasMenu menuOpen={openMenu === 'table'}
            onClick={() => pickTable(lastTable)}
            onOpenMenu={() => openSeatMenu('table')}
          >
            {openMenu === 'table' && (
              <Flyout title="Table" bare>
                <SeatMenu
                  noun="tables"
                  wideTiles
                  quick={QUICK_TABLES.map(tableTile)}
                  current={tableTile(lastTable)}
                  onPick={pickTable}
                  locked={seatLocked('table')}
                  onLock={() => lockSeat('table', () => { TableTool.preset = lastTable; setTool('table'); })}
                  sheet={
                    <DockSheet
                      variant="card"
                      columns={3}
                      width={360}
                      height={340}
                      searchPlaceholder="Tables, or a column like “owner”"
                      sections={tableSections}
                      value={lastTable}
                      onPick={pickTable}
                      focusSearch
                      idle="Start blank, or from a finished table"
                    />
                  }
                />
              </Flyout>
            )}
          </DockButton>
        </div>

        {/* Connector. Sits with the creation tools rather than with the shapes,
            because what it makes is a *relationship* — it needs two objects to
            already exist and adds nothing on its own. */}
        <DockButton
          {...seatProps('connector')}
          icon={<Spline size={17} />} label="Connect" toolId="connector"
          description="join two objects"
          active={activeToolId === 'connector'} onClick={() => setTool('connector')}
        />
        {/* Click arms the note tool; drag one straight up off the seat and it
            lands where you let go. FigJam's pad of notes -- and the one seat
            where the thing on the button is the thing you get, so pulling it
            out is the gesture people try first. See `beginStickyCarry`. */}
        <DockButton
          {...seatProps('sticky')}
          onPointerDown={editing ? beginSeatDrag('sticky') : beginStickyCarry}
          icon={<StickyNote size={17} />} label="Sticky" toolId="sticky"
          description="click to arm, or drag one onto the board"
          active={activeToolId === 'sticky'}
          onClick={() => {
            // The click that ends a carry is not a request for the tool.
            if (!carryEnded.current) setTool('sticky');
          }}
        />
      </div>

      {/* Place, and the diagram editor.

          These briefly lived behind an overflow seat. That was the wrong trade:
          collapsing them bought a shorter dock and cost the thing a dock is
          for, which is seeing what you can reach. The crowding it was meant to
          fix turned out to be the *spacing* between groups, not the number of
          buttons — so the spacing was tuned instead and everything came back
          into view. */}
      <div className="dock-group">
        <DockButton
          {...seatProps('image')}
          icon={<ImageIcon size={17} />} label="Image" toolId="image"
          active={activeToolId === 'image'} onClick={() => setTool('image')}
        />
        <DockButton
          {...seatProps('audio')}
          icon={<Mic size={17} />} label="Voice" toolId="audio"
          description="record a spoken note"
          active={activeToolId === 'audio'} onClick={() => setTool('audio')}
        />
        {/* Force sits with these rather than alone. It had its own group on the
            grounds that it acts on what is already there instead of adding
            anything — true, and too fine a distinction to spend a divider on:
            placing media and applying a force are both "do something to the
            board" rather than "draw on it", which is the split the eye is
            actually reading. */}
        <DockButton
          {...seatProps('forces')}
          icon={<Sparkles size={17} />} label="Forces"
          description="push, pull and drop objects"
          active={isForceTool(activeToolId)}
          onClick={() => pick(lastForce)}
        />
      </div>

      {/* The two that earn a drawer.

          Only two, and that is the whole lesson from the first attempt: five
          was too many and the dock came out looking sparse. Comment annotates
          rather than draws, and the diagram editor opens a dialog — neither is
          a thing anyone holds while working, and neither is missed from the
          main run.

          The seat is not a generic menu button: when comment is armed it wears
          the comment glyph, so the dock still answers "what am I holding?"
          without being opened. Same rule the Shape and Line seats follow. */}
      <div className="dock-group">
        {/**
          * The drawer is always last, and has to say so explicitly.
          *
          * Every other slot takes an `order` from the layout. This one is not
          * in the layout -- it is the thing hidden seats go *into* -- so
          * without a value of its own it fell to CSS's default of `order: 0`
          * and tied with the first seat, landing second in the dock. One past
          * the end of the arrangement keeps it after every seat and after every
          * divider, whatever the person has done to them.
          */}
        <div
          {...hoverProps('more')}
          className="dock-slot-wrap"
          style={{ order: layout.order.length + 1 }}
        >
          <DockButton
            {...moreSeatProps()}
            icon={activeExtra ? activeExtra.icon : <MoreVertical size={18} />}
            label={activeExtra ? activeExtra.label : 'More'}
            /* Was "comments and diagrams", which both undersold the drawer --
               it holds put-away tools and the toolbar editor now -- and made
               the tooltip the widest thing in the dock, a strip of text hanging
               over the board every time the pointer crossed the last button.
               One word, because the flyout beneath it does the explaining. */
            description={activeExtra ? activeExtra.description : undefined}
            active={Boolean(activeExtra)}
            hasMenu
            menuOpen={openMenu === 'more'}
            onClick={() => toggleMenu('more')}
          >
            {openMenu === 'more' && (
              <Flyout title={editing ? 'Editing the toolbar' : 'More'} wide>
                {!editing && drawerTools.map((entry) => (
                  <FlyoutItem
                    key={entry.id}
                    icon={entry.icon}
                    label={entry.label}
                    description={entry.description}
                    active={entry.isActive(activeToolId)}
                    onClick={() => { setPinnedMenu(null); entry.run(); }}
                  />
                ))}

                {/* In edit mode the same seats are what you drag back, so they
                    are listed under the heading for the mode rather than among
                    the tools. */}
                {editing && layout.hidden.length > 0 && (
                  <>
                    <div className="dock-flyout__group" role="presentation">Not on the toolbar</div>
                    {layout.hidden.map((seat) => (
                      <FlyoutItem
                        key={seat}
                        icon={SEAT_GLYPH[seat]}
                        label={SEAT_LABEL[seat]}
                        description="put it back"
                        active={false}
                        onClick={() => dockDefaults.set(showSeat(layoutRef.current, seat))}
                      />
                    ))}
                  </>
                )}

                <div className="dock-flyout__group" role="presentation">Toolbar</div>
                <FlyoutItem
                  // `Move`, not `SlidersHorizontal`: what this mode does is let
                  // you drag seats around, and the sliders glyph is the
                  // properties panel's. See the note in `WorkspaceShell`.
                  icon={editing ? <Check size={16} /> : <Move size={16} />}
                  label={editing ? 'Done editing' : 'Edit toolbar'}
                  description={editing ? 'stop rearranging' : 'drag tools to rearrange or put away'}
                  active={editing}
                  onClick={() => {
                    setEditing((v) => !v);
                    // Pinned open: entering the mode from a menu that then shut
                    // would hide the drawer you are about to drag things into.
                    setPinnedMenu('more');
                  }}
                />
                {editing && (
                  <FlyoutItem
                    icon={<SeparatorVertical size={16} />}
                    label="Add a divider"
                    description="group the tools your way"
                    active={false}
                    onClick={addDivider}
                  />
                )}
                {/**
                  * Reset, and the way back from it.
                  *
                  * The row becomes its own undo rather than gaining a
                  * confirmation. A confirmation taxes every deliberate reset to
                  * guard against the rare accidental one, and it sits directly
                  * under "Edit toolbar" where a misclick is most likely -- so
                  * the fix is to make the mistake cheap, not to make the action
                  * expensive. See `dockDefaults.undoReset`.
                  */}
                {dockDefaults.canUndo() ? (
                  <FlyoutItem
                    icon={<Undo2 size={16} />}
                    label="Undo reset"
                    description="put your arrangement back"
                    active={false}
                    onClick={() => dockDefaults.undoReset()}
                  />
                ) : !isDefaultLayout(layout) && (
                  <FlyoutItem
                    icon={<RotateCcw size={16} />}
                    label="Reset toolbar"
                    description="back to the arrangement it shipped with"
                    active={false}
                    onClick={() => dockDefaults.reset()}
                  />
                )}
              </Flyout>
            )}
          </DockButton>
        </div>
      </div>

    </div>
    {carry && createPortal(
      <div
        ref={ghostRef}
        className="sticky-ghost"
        aria-hidden="true"
        style={{ background: THEMES[carry].bg, borderColor: THEMES[carry].edge }}
      />,
      document.body
    )}
    </MotionConfig>
  );
};
