import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, MotionConfig, motion, useReducedMotion, type Transition } from 'framer-motion';
import { GridKindIcon } from './gridIcons';
import { ChartArt, GridKindArt } from '../dock/art/LazyDataArt';
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
  isCarried,
  isDefaultLayout,
  isOnDock,
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
import { Check, Lock, LockOpen, Minus, Move, RotateCcw, SeparatorVertical, Undo2 } from 'lucide-react';
import {
  AllToolsGlyph, ChartGlyph, CodeGlyph, CommentGlyph, ConnectorGlyph, DiagramGlyph, DirectSelectGlyph, EraserGlyph,
  ForcesGlyph, FrameGlyph, GridGlyph, HandGlyph, HighlighterGlyph, ImageGlyph, InsertGlyph, LineGlyph, LinkGlyph,
  MarkerGlyph, MicGlyph, ParagraphGlyph, PencilGlyph, SelectGlyph, ShapeGlyph, StickyGlyph, TableGlyph, TypeGlyph,
  VectorPenGlyph,
} from '../dock/glyphs';
import { DrawingTray } from '../dock/DrawingTray';
import { ToolLibrary, type ToolEntry } from '../dock/ToolLibrary';
import { MENU_FLYOUT_SIZE, SHEET_LAYOUT, sheetWidth, type DockMenuId } from '../dock/flyoutScale';
import { flyoutMotion, flyoutTransition, seatMenuStep, type FlyoutMotion, type SeatMenuEvent } from '../dock/seatMenuModel';
import { EraserTray } from '../tools/draw/EraserTray';
import { drawSettings } from '../../engine/tools/drawSettings';
import { useThemeInk } from '../dock/useDockEnv';
import '../dock/dock.css';
import { SegmentedControl } from '../ui/SegmentedControl';
import { LINE_PROFILES, LINE_PROFILE_LABELS, type LineProfile } from '../../engine/model/linePath';
import { LineProfileIcon } from '../panel/lineProfileIcons';
import { LineSpecimen } from '../panel/lineSpecimen';
import { isForceTool } from '../../engine/physics/forces';
import { FRAME_PRESETS, FRAME_PRESET_GROUPS } from '../../engine/model/frames';
import { FramePresetIcon } from '../panel/sections/framePresetIcons';
import { ShapeIcon } from './shapeIcons';
import {
  LINE_PRESETS,
  SHAPE_BY_PRESET,
  SHAPE_PRESETS,
  shapeToolId,
  shapeKindFromToolId,
  type ShapePreset,
} from './shapeCatalog';
import { ShapeSheet } from './ShapeSheet';
import { SeatMenu, type QuickChoice } from './SeatMenu';
import { shortcutFor } from '../../engine/tools/shortcuts';
import { keyBelongsToFocus } from '../../engine/interaction/keyTarget';
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
import { canEditObjects, canUseTool } from '../../engine/model/permissions';
import { FeatureBoundary } from '../ui/FeatureBoundary';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { EndCapIcon, RouteIcon } from '../panel/connectorIcons';
import { ThemeService } from '../../engine/ThemeService';
import type { Routing } from '../../engine/model/connector';
import { Menu } from '../menu/Menu';
import { connectorDefaults } from '../../engine/tools/connectorDefaults';
import { END_CAP_KINDS, END_CAP_LABELS, type EndCapKind } from '../../engine/model/connectorEnds';
import { storageGet, storageSet } from '../../utils/safeStorage';
import { useDockCentred, useDockPlacement } from './boardLayout';
import { useSuppressTooltips } from '../ui/Tooltip';
import './shell.css';
import { IconsGlyph } from '../icons/IconsGlyph';
import { TextFaceToggle, TextStyleChips, TextStyleList } from '../dock/TextStylePicker';
import { TEXT_FACES, TEXT_STYLES, nextText } from '../../engine/tools/TextToolStyles';
import { openIconBrowser } from '../../engine/icons/iconStore';
import { usePhone } from './usePhone';
import { PhoneToolbar } from './PhoneToolbar';

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

/** How long a press on a seat must last before it opens the seat's menu. */
const LONG_PRESS_MS = 380;

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
      'data-tour'?: string;
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
     * Open this seat's menu without arming: Up from the keyboard, or a long
     * press. (A click on a seat with variants opens it too; see `clickSeat`.)
     */
    onOpenMenu?: () => void;
    /**
     * The seat's click opens its menu rather than arming a tool: Insert and
     * All tools, which are libraries rather than tools. Such a seat has no
     * caret, because the whole button is the way in.
     */
    clickOpensMenu?: boolean;
    /** Toggle the menu from the corner caret. Present on seats whose click arms a tool. */
    onCaret?: () => void;
    /**
     * Hold this seat's tooltip back while a shelf or the drawing tray is up:
     * a seat's tip rises into the band the shelf occupies and would cover it.
     * Menus need no help -- `TooltipLayer` shows nothing while one is open,
     * and never tips an anchor that is `aria-expanded`.
     */
    quietTip?: boolean;
    /** The button's id, which the tooltip manager keys suppression by. */
    anchorId?: string;
    /**
     * The seat is put away. Its button stays mounted, and it must not claim
     * the active state: the marker is one shared element, and a put-away seat
     * holding it (the eraser, while Draw carries it) left the visible seat
     * with neither the marker nor a readable glyph.
     */
    parked?: boolean;
  }
>(({ icon, label, description, toolId, active: activeProp, parked, onClick, hasMenu, menuOpen, tabIndex, children, seat, onRemove, onPointerDown, editing, puckId, locked, onToggleLock, onOpenMenu, clickOpensMenu, onCaret, quietTip, anchorId }, ref) => {
  const key = toolId ? shortcutFor(toolId) : undefined;
  const active = activeProp && !parked;
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

  /**
   * Long-press opens the menu, as on a phone or in Photoshop's tool groups.
   * The click that ends a long-press is swallowed, so the seat does not also
   * arm its tool underneath the menu that just opened.
   */
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const pressOrigin = useRef({ x: 0, y: 0 });
  const endPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  useEffect(() => endPress, []);
  const onPress = (e: React.PointerEvent) => {
    if (editing) {
      onPointerDown?.(e);
      return;
    }
    onPointerDown?.(e);
    longPressed.current = false;
    if (!onOpenMenu || clickOpensMenu || e.button !== 0) return;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    endPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      longPressed.current = true;
      onOpenMenu();
    }, LONG_PRESS_MS);
  };
  const onPressMove = (e: React.PointerEvent) => {
    if (pressTimer.current === null) return;
    if (Math.hypot(e.clientX - pressOrigin.current.x, e.clientY - pressOrigin.current.y) > 6) endPress();
  };
  useSuppressTooltips(Boolean(quietTip && anchorId), anchorId);

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
        aria-pressed={clickOpensMenu ? undefined : active}
        aria-haspopup={clickOpensMenu || onOpenMenu ? 'menu' : undefined}
        aria-expanded={hasMenu ? menuOpen : undefined}
        aria-keyshortcuts={onOpenMenu && !clickOpensMenu ? 'ArrowUp' : undefined}
        onClick={
          editing
            ? undefined
            : () => {
                if (longPressed.current) {
                  longPressed.current = false;
                  return;
                }
                onClick();
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
        onPointerDown={onPress}
        onPointerMove={onPressMove}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onPointerCancel={endPress}
        onContextMenu={onOpenMenu && !clickOpensMenu && !editing ? (e) => { e.preventDefault(); } : undefined}
        id={anchorId}
        data-tooltip={tooltip}
        data-tooltip-desc={tooltipDesc}
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
      </button>
      {onCaret && !editing && (
        <button
          type="button"
          className="dock-caret"
          aria-label={`${label} options`}
          aria-haspopup="menu"
          aria-expanded={Boolean(menuOpen)}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onCaret();
          }}
        >
          <svg viewBox="0 0 5 5" aria-hidden="true" focusable="false">
            <path d="M5 0 V5 H0 Z" fill="currentColor" />
          </svg>
        </button>
      )}
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
 *
 * Its width is a step on the flyout scale, from the menu it shows (see
 * `flyoutScale.ts`), and does not change with what the menu is showing.
 */
const Flyout: React.FC<{
  /** Whether it is up. It stays mounted, so it can leave as well as arrive. */
  open: boolean;
  /** How it arrives: see `flyoutMotion`. */
  motion: FlyoutMotion;
  title: string;
  /** Which menu this is, for its step on the width scale. */
  menu: DockMenuId;
  children: React.ReactNode;
  /** No title row: the seat menus, whose row says what they are. The title stays the accessible name. */
  bare?: boolean;
}> = ({
  open,
  motion: arrival,
  title,
  menu,
  children,
  bare,
}) => {
  // One entrance for every flyout: a short rise from the seat and a fade,
  // decelerating with no rebound; a quicker fade out; a cross-fade in place
  // when it replaces another seat's; nothing at all under reduced motion.
  const t = flyoutTransition(arrival, Boolean(useReducedMotion()));
  // Centred on the dock whichever seat opened it, with a notch back to the seat.
  const centred = useDockCentred(true);
  return (
    <AnimatePresence>
      {open && (
        <div key="flyout" ref={centred} role="menu" className="dock-flyout" aria-label={title} onKeyDown={onFlyoutKey}>
          <motion.div
            className="panel-surface dock-flyout__panel"
            data-size={MENU_FLYOUT_SIZE[menu]}
            initial={{ opacity: 0, y: t.rise }}
            animate={{ opacity: 1, y: 0, transition: { duration: t.enter, ease: [0.16, 1, 0.3, 1] } }}
            exit={{ opacity: 0, transition: { duration: t.exit, ease: [0.4, 0, 1, 1] } }}
          >
            {!bare && <div className="dock-flyout__title" role="presentation">{title}</div>}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

/**
 * Up and Down walk a flyout's rows, as in any menu. Rows in a seat menu's tile
 * row walk with Left and Right instead (see `SeatMenu`), and a library list
 * handles its own keys (see `ToolLibrary`).
 */
function onFlyoutKey(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if ((e.target as HTMLElement).closest('.tool-lib, input, [role="slider"], .seg')) return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.dock-item'));
  const at = rows.indexOf(document.activeElement as HTMLElement);
  if (at < 0 || rows.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
}

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
  chart: 'Chart', table: 'Table', data: 'Data',
  select: 'Select', directSelect: 'Direct select', hand: 'Hand',
  draw: 'Draw', eraser: 'Eraser',
  type: 'Text', shape: 'Shape', line: 'Line and arrow',
  frame: 'Frame', grid: 'Layout grid', connector: 'Connector',
  image: 'Image', audio: 'Voice note', media: 'Insert', comment: 'Comment', forces: 'Physics',
};

/** The three tools the Data seat carries, in the order its switch shows them. */
const DATA_KINDS = ['table', 'chart', 'grid'] as const;
type DataKind = (typeof DATA_KINDS)[number];
const DATA_KIND_KEY = 'vega_dock_data_kind';
const SHAPE_KEY = 'vega_dock_shape';

/** The tools the Insert seat wears while one of them is armed. */
const MEDIA_TOOLS = ['image', 'audio', 'link', 'code'] as const;
type MediaTool = (typeof MEDIA_TOOLS)[number];

function readChoice<T extends string>(key: string, options: readonly T[], fallback: T): T {
  const stored = storageGet(key);
  return options.includes(stored as T) ? (stored as T) : fallback;
}

const SEAT_GLYPH: Record<DockSeat, React.ReactNode> = {
  select: <SelectGlyph />, directSelect: <DirectSelectGlyph />, hand: <HandGlyph />,
  draw: <PencilGlyph />, eraser: <EraserGlyph />,
  type: <TypeGlyph />, shape: <ShapeGlyph />, line: <LineGlyph />,
  frame: <FrameGlyph />, grid: <GridGlyph />, chart: <ChartGlyph />, table: <TableGlyph />, data: <TableGlyph />,
  connector: <ConnectorGlyph />,
  image: <ImageGlyph />, audio: <MicGlyph />, media: <InsertGlyph />, comment: <CommentGlyph />, forces: <ForcesGlyph />,
};


/** Which systems each category shows. A constant, so it lives out here:
 *  rebuilt in the component body it was a new object every render and the
 *  memo that reads it could not list it as a dependency. */

const ToolWorkspaceInner: React.FC<Props> = ({ activeToolId, onOpenDiagram, onAddTextBlock }) => {


  const lineProfile = useStore((s) => s.lineProfile);
  const setLineProfile = useStore((s) => s.setLineProfile);
  const lineSmooth = useStore((s) => s.lineSmooth);
  const setLineSmooth = useStore((s) => s.setLineSmooth);
  const lastForce = useStore((s) => s.lastForce);
  const eraserSize = useStore((s) => s.eraserSize);
  const setEraserSize = useStore((s) => s.setEraserSize);
  const stickyTheme = useStore((s) => s.stickyTheme);
  const setStickyTheme = useStore((s) => s.setStickyTheme);
  /** The style and face the next text box is made in. See `TextToolStyles`. */
  const textNext = useSyncExternalStore(nextText.subscribe, nextText.get, nextText.get);
  const textSeatDescription = `${TEXT_STYLES[textNext.style].label}${textNext.face === 'hand' ? ', handwritten' : ''}`;

  /** The drawing settings, for the Draw seat's glyph and the lists' brush rows. */
  const draw = useSyncExternalStore(drawSettings.subscribe, drawSettings.get, drawSettings.get);
  const themeInk = useThemeInk();
  /** The ink the next pen or marker stroke is drawn in. */
  const drawInk = draw.ink ?? themeInk;

  /** The lock and the key-hold, for the seat and the shelf. See `toolModes`. */
  const modes = useSyncExternalStore(toolModes.subscribe, toolModes.getSnapshot, toolModes.getSnapshot);
  const lockedHere = modes.locked !== null && modes.locked === lockFamily(activeToolId);
  const heldHere = modes.held !== null && modes.held === activeToolId;
  const toggleLock = () => {
    toolModes.toggleLock();
  };
  /** One marker per dock: there is a second dock in focus mode. */
  const puckId = `dock-puck${useId()}`;
  /** A per-dock suffix for seat ids: there is a second dock in focus mode. */
  const dockUid = useId().replace(/:/g, '');

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

  type DockMenu = 'select' | 'pen' | 'shape' | 'frame' | 'grid' | 'chart' | 'table' | 'data' | 'media' | 'block' | 'more';
  const [pinnedMenu, setPinnedMenu] = useState<DockMenu | null>(null);
  /**
   * The shape the Shape seat wears when none is armed: the last one picked,
   * kept across sessions and shared by both docks, since a board that is all
   * diamonds wants a diamond tomorrow too.
   */
  const [lastShape, setLastShapeState] = useState<ShapePreset>(() => readChoice(SHAPE_KEY, SHAPE_PRESETS, 'rect'));
  const setLastShape = useCallback((preset: ShapePreset) => {
    setLastShapeState(preset);
    storageSet(SHAPE_KEY, preset);
  }, []);
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
   * Which data tool the Data seat wears, and which the Media seat wears.
   *
   * Remembered across sessions: a person who works in tables reaches for the
   * seat expecting a table every time, the way the Shape seat remembers its
   * shape within one.
   */
  const [lastData, setLastData] = useState<DataKind>(() => readChoice(DATA_KIND_KEY, DATA_KINDS, 'table'));
  /**
   * Which drawing tool the Draw seat wears and a click on it arms: the one used
   * last. The pen's brush is remembered by `drawSettings`.
   */
  type DrawTool = 'pen' | 'bezier-pen' | 'eraser';
  const [lastDraw, setLastDraw] = useState<DrawTool>('pen');
  useEffect(() => {
    if (activeToolId === 'pen' || activeToolId === 'bezier-pen' || activeToolId === 'eraser') setLastDraw(activeToolId);
  }, [activeToolId]);

  /** Which data tool's choices the Data flyout is showing. Follows the seat until switched. */
  const [dataTab, setDataTab] = useState<DataKind>(lastData);
  useEffect(() => {
    if ((DATA_KINDS as readonly string[]).includes(activeToolId)) {
      setLastData(activeToolId as DataKind);
      setDataTab(activeToolId as DataKind);
      storageSet(DATA_KIND_KEY, activeToolId);
    }
  }, [activeToolId]);

  /** The next connector's route and ends, for the connector shelf. */
  const nextConnector = useSyncExternalStore(
    connectorDefaults.subscribe,
    connectorDefaults.getSnapshot,
    connectorDefaults.getSnapshot
  );
  const [capMenu, setCapMenu] = useState<{ which: 'endStart' | 'endEnd'; rect: DOMRect; keyboard: boolean } | null>(null);
  useEffect(() => {
    if (activeToolId !== 'connector') setCapMenu(null);
  }, [activeToolId]);
  /** The press that closed a cap menu, so the click after it does not reopen it. */
  const capClosed = useRef<{ which: string; at: number } | null>(null);
  const connectorColor = useStore((s) => s.connectorColor);
  const setConnectorColor = useStore((s) => s.setConnectorColor);

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
   * each seat's call site. One rule cannot be forgotten by
   * the eighth menu somebody adds.
   */
  const openMenu: DockMenu | null = editing ? (pinnedMenu === 'more' ? 'more' : null) : pinnedMenu;

  /**
   * How the flyout now open arrived: risen from nothing, or swapped in for
   * another seat's. Read during the render that opens it; see `flyoutMotion`.
   */
  const shownMenu = useRef<DockMenu | null>(openMenu);
  const flyoutEntry = flyoutMotion(shownMenu.current, openMenu);
  useEffect(() => {
    shownMenu.current = openMenu;
  }, [openMenu]);

  /** Apply one event of the seat menu model. Returns whether the event asks for the tool to be armed. */
  const stepMenu = (event: SeatMenuEvent<DockMenu>): boolean => {
    const step = seatMenuStep(pinnedMenu, event);
    if (step.open !== pinnedMenu) setPinnedMenu(step.open);
    return step.arm;
  };

  /** The caret: open or close the menu, without arming anything. */
  const toggleMenu = (menu: DockMenu) => {
    stepMenu({ type: 'caret', menu, allowed: true });
  };

  /**
   * A click on a seat with variants: arm its tool and open its flyout, or,
   * on the armed seat with its flyout up, close it and keep the tool. See
   * `seatMenuModel`. `toolId` is what the click arms, for the role check: a
   * viewer gets the refusal, not a menu of things they cannot place.
   */
  const clickSeat = (menu: DockMenu, toolId: string, armed: boolean, arm: () => void) => {
    if (stepMenu({ type: 'click', menu, armed, allowed: canUseTool(toolId) })) arm();
  };

  /**
   * Menus open on purpose: the caret, a long press, Up on the seat, or a
   * click on a seat that is a library (Insert, All tools). Never on hover.
   * A menu that unfolded whenever the pointer crossed a seat put a panel over
   * the board on the way to somewhere else, and fought the seat's tooltip for
   * the same space above the button.
   *
   * Presses inside a menu are kept from the close-on-outside-press listener,
   * which would otherwise cancel the control's own action.
   */
  const menuProps = () => ({
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  });

  /** The seat button each menu belongs to, for handing focus back. */
  const MENU_SEAT: Record<DockMenu, DockSeat | 'more'> = {
    select: 'select', pen: 'draw', shape: 'shape', frame: 'frame', grid: 'grid', chart: 'chart',
    table: 'table', data: 'data', media: 'media', block: 'type', more: 'more',
  };
  const seatButtonFor = (menu: DockMenu) => {
    const seat = MENU_SEAT[menu];
    return buttonsRef.current[seat === 'more' ? MORE_SEAT : DOCK_SEATS.indexOf(seat)] ?? null;
  };

  // A menu closes on a press anywhere else, or on Escape. Escape hands focus
  // back to the seat when the keyboard was working inside the dock.
  useEffect(() => {
    if (!pinnedMenu) return;
    const menu = pinnedMenu;
    const close = () => setPinnedMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const inside = Boolean(dockRef.current?.contains(document.activeElement));
      setPinnedMenu(null);
      if (inside) seatButtonFor(menu)?.focus();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // In the order the dock shows them, which the layout decides, and only the
    // seats actually on it: a put-away seat's button is still mounted.
    const live = (buttonsRef.current.filter(Boolean) as HTMLButtonElement[])
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({ b, r: b.getBoundingClientRect() }))
      .sort((p, q) => (Math.abs(p.r.top - q.r.top) > 8 ? p.r.top - q.r.top : p.r.left - q.r.left))
      .map((p) => p.b);
    if (live.length === 0) return;
    e.preventDefault();

    const current = live.findIndex((b) => b === document.activeElement);
    const from = current === -1 ? focusIndex : current;
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? live.length - 1
      : e.key === 'ArrowRight' ? (from + 1) % live.length
      : (from - 1 + live.length) % live.length;

    setFocusIndex(Math.max(0, buttonsRef.current.indexOf(live[next])));
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

  /**
   * The picks inside a seat's flyout arm the variant and leave the flyout up,
   * so the next choice is one click away; a press on the board (the
   * placement), Escape or a press elsewhere closes it. A pick from a full
   * sheet folds the sheet back to the row, so the board is clear to draw on.
   */
  const pickShape = (kind: ShapePreset) => {
    setLastShape(kind);
    setTool(shapeToolId(kind));
  };

  /** Picks for the other seats with sheets. Each arms, and closes a hovered menu. */
  const pickChart = (kind: ChartKindId) => {
    // Remembered on the tool and armed, so this is a choice about the next
    // drag rather than thirty tools that would each need registering.
    ChartTool.kind = kind;
    setLastChart(kind);
    setTool('chart');
  };

  const pickGrid = (kind: GridKindId) => {
    gridDefaults.remember(switchKind(gridDefaults.forBox({ x: 0, y: 0, width: 0, height: 0 }), kind));
    setTool('grid');
  };

  const pickTable = (id: string) => {
    TableTool.preset = id;
    setLastTable(id);
    setTool('table');
  };

  const pickFrame = (id: string) => {
    setLastFrame(id);
    setTool(id);
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
    stepMenu({ type: 'open', menu, allowed: true });
    window.setTimeout(() => {
      // A library's search first, since opening one is a decision to look;
      // otherwise the current choice, so Enter keeps it and the arrows start
      // from where the seat already is; otherwise the first row.
      const root = dockRef.current;
      const flyout = root?.querySelector<HTMLElement>('.dock-flyout');
      const target =
        flyout?.querySelector<HTMLElement>('.tool-lib__search input') ??
        flyout?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ??
        flyout?.querySelector<HTMLElement>('.seat-menu__tile, .dock-item') ??
        root?.querySelector<HTMLElement>('.dock-tray .dock-tray__tool[tabindex="0"]');
      target?.focus();
    }, 0);
  };

  const openSeatMenuRef = useRef(openSeatMenu);
  openSeatMenuRef.current = openSeatMenu;

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
    icon: <ChartArt kind={k} size={32} />,
  });
  const gridTile = (k: GridKindId): QuickChoice<GridKindId> => ({
    id: k,
    label: GRID_LABELS[k],
    icon: <GridKindArt kind={k} size={32} />,
  });
  const tableTile = (id: string): QuickChoice<string> => {
    const example = TABLE_EXAMPLES.find((e) => e.id === id);
    return example
      ? { id, label: example.name, icon: <TableThumb example={example} crop className="dock-tablethumb dock-tablethumb--mini" /> }
      : { id: 'blank', label: 'Blank table', icon: <TableGlyph size={18} /> };
  };
  const frameTile = (id: string): QuickChoice<string> => {
    const preset = FRAME_PRESETS.find((p) => `frame-${p.id}` === id);
    return preset
      ? { id, label: preset.label, detail: `${preset.width} × ${preset.height}`, icon: <AspectGlyph width={preset.width} height={preset.height} /> }
      : { id: 'frame', label: 'Custom size', detail: 'drag to size', icon: <FrameGlyph size={18} /> };
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
          icon: <GridKindArt kind={kind} size={56} />,
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
          icon: <ChartArt kind={kind} size={56} />,
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
          { id: 'blank', label: 'Blank table', hint: 'Rows follow the drag; cells open to type', icon: <TableGlyph size={28} /> },
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

  /**
   * The Grid, Chart and Table menus, as functions, because each is shown by
   * its own seat when that seat is pinned and by the Data seat otherwise.
   * `header` is the Data seat's switch between the three.
   */
  const gridSeatMenu = (header?: React.ReactNode) => (
    <SeatMenu
      header={header}
      noun="grids"
      quick={QUICK_GRIDS.map(gridTile)}
      current={gridTile(gridKind)}
      onPick={pickGrid}
      locked={seatLocked('grid')}
      onLock={() => lockSeat('grid', () => setTool('grid'))}
      sheet={(fold) => (
        <DockSheet
          variant="card"
          layout={SHEET_LAYOUT.grid}
          width={sheetWidth(MENU_FLYOUT_SIZE.grid)}
          sections={gridSections}
          value={gridKind}
          onPick={(id) => { pickGrid(id); fold(); }}
          idle="Pick a system, then drag it out on the board"
        />
      )}
    />
  );
  const chartSeatMenu = (header?: React.ReactNode) => (
    <SeatMenu
      header={header}
      noun="charts"
      quick={QUICK_CHARTS.map(chartTile)}
      current={chartTile(lastChart)}
      onPick={pickChart}
      locked={seatLocked('chart')}
      onLock={() => lockSeat('chart', () => { ChartTool.kind = lastChart; setTool('chart'); })}
      sheet={(fold) => (
        <DockSheet
          variant="card"
          layout={SHEET_LAYOUT.chart}
          width={sheetWidth(MENU_FLYOUT_SIZE.chart)}
          height={320}
          searchPlaceholder="Search charts"
          sections={chartSections}
          value={lastChart}
          onPick={(id) => { pickChart(id); fold(); }}
          focusSearch
          idle="Pick what the chart should show, then drag it out"
        />
      )}
    />
  );
  const tableSeatMenu = (header?: React.ReactNode) => (
    <SeatMenu
      header={header}
      noun="tables"
      wideTiles
      quick={QUICK_TABLES.map(tableTile)}
      current={tableTile(lastTable)}
      onPick={pickTable}
      locked={seatLocked('table')}
      onLock={() => lockSeat('table', () => { TableTool.preset = lastTable; setTool('table'); })}
      sheet={(fold) => (
        <DockSheet
          variant="card"
          layout={SHEET_LAYOUT.table}
          width={sheetWidth(MENU_FLYOUT_SIZE.table)}
          height={340}
          searchPlaceholder="Tables, or a column like “owner”"
          sections={tableSections}
          value={lastTable}
          onPick={(id) => { pickTable(id); fold(); }}
          focusSearch
          idle="Start blank, or from a finished table"
        />
      )}
    />
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
  // However it was armed (a key, the palette, the library), the seat keeps it.
  useEffect(() => {
    if (armedBoxShape && armedBoxShape !== lastShape) setLastShape(armedBoxShape);
  }, [armedBoxShape, lastShape, setLastShape]);
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
   * Whether a put-away seat is carried by a seat on the dock -- Direct select
   * by Select, the eraser by Draw, and so on. A carried tool shows in its
   * host's flyout and nowhere else.
   */
  const carried = (seat: DockSeat) => isCarried(layout, seat);

  /* --------------------------------------------- what the carrying seats wear */

  /** Select wears direct selection while that is armed and has no seat of its own. */
  const selectWearsDirect = activeToolId === 'direct-select' && carried('directSelect');
  const eraserCarried = carried('eraser');
  /** The note is the pad in the Draw tray, and has no seat of its own: the Draw seat holds it. */
  const stickyArmed = activeToolId === 'sticky';
  const drawActive = isPen || (activeToolId === 'eraser' && eraserCarried) || stickyArmed;
  const lineCarried = carried('line');
  const shapeActive = isShape || (isLine && lineCarried);

  /**
   * What the Draw seat wears: the drawing tool used last, with its ink on the
   * tip. The one touch of colour on the dock, and the only one: the full,
   * shaded art stays in the tray.
   */
  const drawShown: DrawTool = activeToolId === 'pen' || activeToolId === 'bezier-pen' || (activeToolId === 'eraser' && eraserCarried)
    ? (activeToolId as DrawTool)
    : lastDraw;
  const drawSeatGlyph =
    stickyArmed ? <StickyGlyph />
    : drawShown === 'eraser' ? <EraserGlyph />
    : drawShown === 'bezier-pen' ? <VectorPenGlyph />
    : draw.brush === 'marker' ? <MarkerGlyph tip={drawInk} />
    : draw.brush === 'highlighter' ? <HighlighterGlyph tip={draw.highlight} />
    : <PencilGlyph tip={drawInk} />;
  const drawSeatTool = stickyArmed ? 'sticky' : drawShown;
  const drawSeatName =
    stickyArmed ? 'Sticky note'
    : drawShown === 'eraser' ? 'Eraser'
    : drawShown === 'bezier-pen' ? 'Vector pen'
    : draw.brush === 'marker' ? 'Marker'
    : draw.brush === 'highlighter' ? 'Highlighter'
    : 'Pen';

  /* ------------------------------------------------- Insert, and All tools */

  /** Close whatever menu is open, then run an entry's act. */
  const runEntry = (run: () => void) => () => {
    setPinnedMenu(null);
    run();
  };

  /**
   * What the Insert seat offers: everything that comes onto the board from
   * outside it. One library, each row saying what it is and how to reach it.
   */
  const insertEntries: ToolEntry[] = [
    {
      id: 'image', group: 'Pictures and sound', icon: <ImageGlyph />, label: 'Image', shortcut: shortcutFor('image'),
      description: 'Upload a picture. Paste or drop works anywhere too',
      keywords: ['photo', 'picture', 'upload', 'png', 'jpg'], active: activeToolId === 'image',
      run: runEntry(() => setTool('image')),
    },
    // A document write, so editors only. Opens the link field in its picture form.
    ...(canEditObjects()
      ? [{
          id: 'image-url', group: 'Pictures and sound', icon: <LinkGlyph />, label: 'Image from URL…',
          description: 'Place a picture from its web address',
          keywords: ['picture', 'photo', 'web', 'link', 'address', 'download'],
          run: runEntry(() => {
            const client = { x: window.innerWidth / 2, y: window.innerHeight / 2 - 60 };
            const world = cameraSystem.screenToWorld(client.x, client.y);
            useStore.getState().setLinkComposer({ clientX: client.x, clientY: client.y, x: world.x, y: world.y, as: 'image' });
          }),
        } satisfies ToolEntry]
      : []),
    {
      id: 'audio', group: 'Pictures and sound', icon: <MicGlyph />, label: 'Voice note', shortcut: shortcutFor('audio'),
      description: 'Record a spoken note on the board',
      keywords: ['audio', 'record', 'microphone'], active: activeToolId === 'audio',
      run: runEntry(() => setTool('audio')),
    },
    {
      id: 'link', group: 'From the web', icon: <LinkGlyph />, label: 'Link card',
      description: 'A card, or a player for videos and Figma',
      keywords: ['url', 'embed', 'video', 'youtube', 'figma', 'bookmark'], active: activeToolId === 'link',
      run: runEntry(() => setTool('link')),
    },
    {
      id: 'code', group: 'From the web', icon: <CodeGlyph />, label: 'Code block',
      description: 'Highlighted code, editable in place',
      keywords: ['snippet', 'syntax', 'programming'], active: activeToolId === 'code',
      run: runEntry(() => setTool('code')),
    },
    {
      id: 'diagram', group: 'Diagrams and icons', icon: <DiagramGlyph />, label: 'Diagram from code',
      description: 'Write a flowchart or sequence in Mermaid',
      keywords: ['mermaid', 'flowchart', 'sequence', 'graph'],
      run: runEntry(() => onOpenDiagram?.()),
    },
    {
      id: 'icons', group: 'Diagrams and icons', icon: <IconsGlyph size={18} />, label: 'Icons',
      description: 'AWS, Azure, Google Cloud and Kubernetes',
      keywords: ['cloud', 'architecture', 'aws', 'azure', 'gcp', 'kubernetes', 'logo'],
      run: runEntry(() => openIconBrowser()),
    },
  ];

  /** A seat's pin in All tools: on the dock or off it, through the same layout edits as edit mode. */
  const pinFor = (seat: DockSeat) => ({
    pinned: isOnDock(layout, seat),
    toggle: () => {
      const now = layoutRef.current;
      dockDefaults.set(isOnDock(now, seat) ? hideSeat(now, seat) : showSeat(now, seat));
    },
  });

  /**
   * Every tool, grouped by what it is for.
   *
   * A tool with a seat of its own carries a pin; a tool inside another seat
   * says which. Forces sits under Playful, where someone looking for physics
   * would look.
   */
  const brushNow = draw.brush;
  const allEntries: ToolEntry[] = [
    { id: 'select', group: 'Select and move', icon: <SelectGlyph />, label: 'Select', shortcut: shortcutFor('select'), description: 'Pick, move and resize whole objects', active: activeToolId === 'select', run: runEntry(() => setTool('select')), pin: pinFor('select') },
    { id: 'direct-select', group: 'Select and move', icon: <DirectSelectGlyph />, label: 'Direct select', shortcut: shortcutFor('direct-select'), description: 'Edit the points and handles inside a shape', keywords: ['anchor', 'node', 'vector'], active: activeToolId === 'direct-select', run: runEntry(() => setTool('direct-select')), pin: pinFor('directSelect'), home: carried('directSelect') ? 'in Select' : undefined },
    { id: 'hand', group: 'Select and move', icon: <HandGlyph />, label: 'Hand', shortcut: shortcutFor('hand'), description: 'Pan the board', keywords: ['pan', 'scroll', 'move'], active: activeToolId === 'hand', run: runEntry(() => setTool('hand')), pin: pinFor('hand') },

    { id: 'text', group: 'Create', icon: <TypeGlyph />, label: 'Text', shortcut: shortcutFor('text'), description: 'Click to type, or drag a box', keywords: ['type', 'paragraph', 'words'], active: activeToolId === 'text', run: runEntry(() => setTool('text')), pin: pinFor('type') },
    { id: 'sticky', group: 'Create', icon: <StickyGlyph />, label: 'Sticky note', shortcut: shortcutFor('sticky'), description: 'A note to put down and move around', keywords: ['post-it', 'note'], active: activeToolId === 'sticky', run: runEntry(() => setTool('sticky')), home: 'in Draw' },
    { id: 'shape', group: 'Create', icon: <ShapeGlyph />, label: 'Shape', shortcut: shortcutFor('shape'), description: 'Rectangles, flowchart symbols and the full library', keywords: ['rectangle', 'circle', 'ellipse', 'flowchart'], active: isShape, run: runEntry(() => setTool(shapeToolId(seatShape))), pin: pinFor('shape') },
    { id: 'line', group: 'Create', icon: <LineGlyph />, label: 'Line and arrow', shortcut: shortcutFor('shape-line'), description: 'Click once per corner, Enter to finish', keywords: ['arrow'], active: isLine, run: runEntry(() => setTool(shapeToolId(armedLine ?? lastLine))), pin: pinFor('line'), home: lineCarried ? 'in Shape' : undefined },
    { id: 'connector', group: 'Create', icon: <ConnectorGlyph />, label: 'Connector', shortcut: shortcutFor('connector'), description: 'Join two objects; it follows them', keywords: ['link', 'arrow', 'flow'], active: activeToolId === 'connector', run: runEntry(() => setTool('connector')), pin: pinFor('connector') },
    { id: 'frame', group: 'Create', icon: <FrameGlyph />, label: 'Frame', shortcut: shortcutFor('frame'), description: 'A page, screen or slide to compose in', keywords: ['artboard', 'section', 'slide'], active: isFrame, run: runEntry(() => setTool(currentFrame)), pin: pinFor('frame') },

    { id: 'pen', group: 'Draw', icon: <PencilGlyph tip={drawInk} />, label: 'Pen', shortcut: brushNow === 'pen' ? shortcutFor('pen') : undefined, description: 'Pressure-sensitive ink that tapers', keywords: ['pencil', 'freehand', 'draw'], active: activeToolId === 'pen' && brushNow === 'pen', run: runEntry(() => { drawSettings.set({ brush: 'pen' }); setTool('pen'); }), ...(isOnDock(layout, 'draw') ? { home: 'in Draw' } : { pin: pinFor('draw') }) },
    { id: 'marker', group: 'Draw', icon: <MarkerGlyph tip={drawInk} />, label: 'Marker', shortcut: brushNow === 'marker' ? shortcutFor('pen') : undefined, description: 'An even felt-tip line', keywords: ['freehand', 'draw', 'felt'], active: activeToolId === 'pen' && brushNow === 'marker', run: runEntry(() => { drawSettings.set({ brush: 'marker' }); setTool('pen'); }), home: 'in Draw' },
    { id: 'highlighter', group: 'Draw', icon: <HighlighterGlyph tip={draw.highlight} />, label: 'Highlighter', shortcut: brushNow === 'highlighter' ? shortcutFor('pen') : undefined, description: 'A translucent band over what matters', keywords: ['freehand', 'highlight'], active: activeToolId === 'pen' && brushNow === 'highlighter', run: runEntry(() => { drawSettings.set({ brush: 'highlighter' }); setTool('pen'); }), home: 'in Draw' },
    { id: 'eraser', group: 'Draw', icon: <EraserGlyph />, label: 'Eraser', shortcut: shortcutFor('eraser'), description: 'Wipe strokes away, or lasso them', keywords: ['delete', 'rubber'], active: activeToolId === 'eraser', run: runEntry(() => setTool('eraser')), pin: pinFor('eraser'), home: eraserCarried ? 'in Draw' : undefined },
    { id: 'bezier-pen', group: 'Draw', icon: <VectorPenGlyph />, label: 'Vector pen', shortcut: shortcutFor('bezier-pen'), description: 'Place anchor points and pull curves', keywords: ['bezier', 'path', 'curve'], active: activeToolId === 'bezier-pen', run: runEntry(() => setTool('bezier-pen')), home: 'in Draw' },

    { id: 'table', group: 'Data', icon: <TableGlyph />, label: 'Table', shortcut: shortcutFor('table'), description: 'Rows and columns, blank or from an example', keywords: ['spreadsheet', 'sheet', 'cells'], active: activeToolId === 'table', run: runEntry(() => pickTable(lastTable)), pin: pinFor('table'), home: carried('table') ? 'in Data' : undefined },
    { id: 'chart', group: 'Data', icon: <ChartGlyph />, label: 'Chart', shortcut: shortcutFor('chart'), description: 'Bars, lines, pies and more, from data', keywords: ['graph', 'plot'], active: activeToolId === 'chart', run: runEntry(() => pickChart(lastChart)), pin: pinFor('chart'), home: carried('chart') ? 'in Data' : undefined },
    { id: 'grid', group: 'Data', icon: <GridGlyph />, label: 'Layout grid', shortcut: shortcutFor('grid'), description: 'Columns, modules and bento layouts', keywords: ['columns', 'bento', 'masonry'], active: activeToolId === 'grid', run: runEntry(() => pick('grid')), pin: pinFor('grid'), home: carried('grid') ? 'in Data' : undefined },

    ...insertEntries.map((entry): ToolEntry => {
      const seat: DockSeat | null = entry.id === 'image' ? 'image' : entry.id === 'audio' ? 'audio' : null;
      return seat
        ? { ...entry, group: 'Insert', pin: pinFor(seat), home: carried(seat) ? 'in Insert' : undefined }
        : { ...entry, group: 'Insert', home: 'in Insert' };
    }),

    { id: 'comment', group: 'Collaborate', icon: <CommentGlyph />, label: 'Comment', shortcut: shortcutFor('comment'), description: 'Pin a note to a point or an object', keywords: ['feedback', 'review'], active: activeToolId === 'comment', run: runEntry(() => setTool('comment')), pin: pinFor('comment') },

    { id: 'forces', group: 'Playful', icon: <ForcesGlyph />, label: 'Physics', shortcut: 'Shift+P', description: 'Push, pull and drop objects with forces', keywords: ['forces', 'gravity', 'magnet', 'push', 'pull', 'throw'], active: isForceTool(activeToolId), run: runEntry(() => pick(lastForce)), pin: pinFor('forces') },
  ];

  /** A data tool is the Data seat's to show only when that tool has no seat of its own. */
  const armedData = (DATA_KINDS as readonly string[]).includes(activeToolId) && carried(activeToolId as DockSeat)
    ? (activeToolId as DataKind)
    : null;
  const DATA_LABEL: Record<DataKind, string> = { table: 'Table', chart: 'Chart', grid: 'Grid' };
  const dataGlyph = (kind: DataKind, size = 18) =>
    kind === 'table' ? <TableGlyph size={size} />
    : kind === 'chart' ? <ChartKindIcon kind={lastChart} size={size} />
    : <GridKindIcon kind={gridKind} size={size} />;
  const dataDescription = (kind: DataKind) =>
    kind === 'table' ? tableName : kind === 'chart' ? CHART_LABELS[lastChart] : GRID_LABELS[gridKind];
  const armData = (kind: DataKind) => {
    if (kind === 'table') pickTable(lastTable);
    else if (kind === 'chart') pickChart(lastChart);
    else setTool('grid');
  };
  /** The switch at the top of the Data flyout. Switching shows a tool's choices; it arms nothing. */
  const dataSwitch = (
    <SegmentedControl
      ariaLabel="Data tool"
      value={dataTab}
      onChange={(v) => setDataTab(v as DataKind)}
      fill
      segments={DATA_KINDS.map((kind) => ({
        value: kind,
        label: DATA_LABEL[kind],
        hint: `${DATA_LABEL[kind]} (${shortcutFor(kind)})`,
      }))}
    />
  );

  const MEDIA_GLYPH: Record<MediaTool, React.ReactNode> = {
    image: <ImageGlyph />,
    audio: <MicGlyph />,
    link: <LinkGlyph />,
    code: <CodeGlyph />,
  };
  const mediaArmed =
    activeToolId === 'link' || activeToolId === 'code' ||
    ((activeToolId === 'image' || activeToolId === 'audio') && carried(activeToolId));


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
  /**
   * The flyout a tool's seat opens, given the tool in hand, or null for a
   * tool whose seat has none (or no seat on the dock).
   */
  const menuForTool = (toolId: string): DockMenu | null => {
    const preset = toolId === 'shape' ? 'rect' : shapeKindFromToolId(toolId);
    if (preset) return LINE_PRESETS.includes(preset) ? (lineCarried ? 'shape' : null) : isOnDock(layout, 'shape') ? 'shape' : null;
    if (toolId === 'frame' || toolId.startsWith('frame-')) return isOnDock(layout, 'frame') ? 'frame' : null;
    if ((DATA_KINDS as readonly string[]).includes(toolId)) {
      const seat = toolId as DataKind;
      return isOnDock(layout, seat) ? seat : carried(seat) ? 'data' : null;
    }
    if (toolId === 'text') return isOnDock(layout, 'type') ? 'block' : null;
    if (toolId === 'pen' || toolId === 'bezier-pen' || (toolId === 'eraser' && eraserCarried)) return isOnDock(layout, 'draw') ? 'pen' : null;
    return null;
  };
  const menuForToolRef = useRef(menuForTool);
  menuForToolRef.current = menuForTool;

  /**
   * A second press of the armed tool's key opens its flyout, focused on the
   * current choice, as Up does on the seat: the key arms, the key again
   * chooses. The room's own handler re-arms the same tool, which changes
   * nothing, so the two agree.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (keyBelongsToFocus(e.key)) return;
      const tool = toolRef.current;
      // A preset answers to its family's key: `R` for every box shape, `F`
      // for every frame size, `L` for both lines.
      const preset = shapeKindFromToolId(tool);
      const family =
        preset && LINE_PRESETS.includes(preset) ? 'shape-line'
        : preset ? 'shape'
        : tool.startsWith('frame-') ? 'frame'
        : tool;
      const key = shortcutFor(tool) ?? shortcutFor(family);
      if (!key || key.length !== 1 || key.toLowerCase() !== e.key.toLowerCase()) return;
      const menu = menuForToolRef.current(tool);
      if (menu && canUseTool(tool)) openSeatMenuRef.current(menu);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Which seat is under the pointer's grip, or null. */
  const [dragging, setDragging] = useState<DockItem | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  // Centred on the window, whatever the side columns do. See `useDockPlacement`.
  useDockPlacement(dockRef);
  // Shelves and the tray are centred on the dock and kept inside the free strip.
  const shelfCentred = useDockCentred(false);
  const trayCentred = useDockCentred(false);

  /**
   * The dock stands back while something is being drawn or dragged on the
   * board, so a stroke that runs down to the bottom edge is not drawn under
   * it. Pressing on the board with any tool but Select and Hand starts it;
   * letting go ends it. CSS delays the fade, so a click never flashes it.
   */
  const toolRef = useRef(activeToolId);
  toolRef.current = activeToolId;
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const STILL = new Set(['select', 'hand', 'direct-select', 'comment']);
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || STILL.has(toolRef.current)) return;
      if (!(e.target as Element | null)?.closest?.('.konvajs-content')) return;
      dock.dataset.receding = '';
    };
    const up = () => {
      delete dock.dataset.receding;
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', up);
      up();
    };
  }, []);
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
      // The tour points at the Insert seat by this name.
      ...(id === 'media' ? { 'data-tour': 'insert' } : null),
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
      quietTip: shelfSeat !== null,
      anchorId: `dock-seat-${id}-${dockUid}`,
      parked: hiddenSeats.has(id),
    };
  };

  /** The drawer, which is never part of the arrangement. */
  const moreSeatProps = () => ({
    ref: registerButton(MORE_SEAT),
    tabIndex: focusIndex === MORE_SEAT ? 0 : -1,
    // The drawer wears the marker while a tool from it is armed, like any
    // other seat -- see `activeExtra`.
    puckId,
    anchorId: `dock-seat-all-${dockUid}`,
    quietTip: shelfSeat !== null,
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

    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      setDragging(null);
    };
    const up = () => {
      end();
      if (!moved) onTap?.();
    };
    // A touch the browser takes over (a scroll, a system gesture) ends here
    // instead of in `pointerup`; without it the listeners stayed attached and
    // the dock stayed in its dragging state. A cancelled press is never a tap.
    const cancel = () => end();

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
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
    : activeToolId === 'connector' ? 'Connector'
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
  } else if (activeToolId === 'text') {
    // The style the next box is made in, and its face: decisions about the
    // next click, which is what the shelf is for.
    shelfBody = (
      <>
        <TextStyleChips value={textNext.style} face={textNext.face} onPick={(style) => nextText.set({ style })} />
        <span className="dock-rule" aria-hidden="true" />
        <TextFaceToggle value={textNext.face} onPick={(face) => nextText.set({ face })} />
      </>
    );
  } else if (activeToolId === 'eraser' && !eraserCarried) {
    // The eraser on a seat of its own: its mode and its width, on its shelf.
    // Carried by Draw, it is in the drawing tray instead.
    shelfBody = (
      <>
        <EraserTray />
        <span className="dock-rule" aria-hidden="true" />
        <ShelfSize label="Size" value={eraserSize} min={4} max={120} onChange={setEraserSize} />
      </>
    );
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
  } else if (activeToolId === 'connector') {
    shelfBody = (
      <>
        <SegmentedControl
          ariaLabel="Route for the next connector"
          value={nextConnector.routing}
          onChange={(v) => connectorDefaults.set({ routing: v as Routing })}
          segments={[
            { value: 'orthogonal', label: 'Elbow', hint: 'Right angles, the way a flowchart reads', icon: <RouteIcon routing="orthogonal" /> },
            { value: 'curved', label: 'Curved', hint: 'A smooth arc', icon: <RouteIcon routing="curved" /> },
            { value: 'straight', label: 'Straight', hint: 'A direct line', icon: <RouteIcon routing="straight" /> },
          ]}
        />
        <span className="dock-rule" aria-hidden="true" />
        {/* The two ends in the order they are drawn, each its own choice. */}
        <div className="shelf-ends" role="group" aria-label="Ends of the next connector">
          {(['endStart', 'endEnd'] as const).map((which) => (
            <button
              key={which}
              type="button"
              className={`btn-icon shelf-btn shelf-end${capMenu?.which === which ? ' is-on' : ''}`}
              aria-haspopup="menu"
              aria-expanded={capMenu?.which === which}
              aria-label={`${which === 'endStart' ? 'Start' : 'End'}: ${END_CAP_LABELS[nextConnector[which]]}`}
              data-tooltip={capMenu ? undefined : `${which === 'endStart' ? 'Start' : 'End'}: ${END_CAP_LABELS[nextConnector[which]]}`}
              onClick={(e) => {
                const recent = capClosed.current;
                if (recent && recent.which === which && performance.now() - recent.at < 300) return;
                setCapMenu({ which, rect: e.currentTarget.getBoundingClientRect(), keyboard: e.detail === 0 });
              }}
            >
              <EndCapIcon kind={nextConnector[which]} flip={which === 'endStart'} />
            </button>
          ))}
        </div>
        <span className="dock-rule" aria-hidden="true" />
        {/* The router steps around objects in the way, for elbow and curved
            routes. A straight connector has nothing to step around with. */}
        <div className="shelf-avoid">
          <Switch
            checked={nextConnector.routing !== 'straight' && nextConnector.avoid}
            onChange={(avoid) => connectorDefaults.set({ avoid })}
            label="Avoid objects"
            disabled={nextConnector.routing === 'straight'}
            tooltip={
              nextConnector.routing === 'straight'
                ? 'Straight lines go straight'
                : 'Route the next connector around objects in its way'
            }
          />
        </div>
        <span className="dock-rule" aria-hidden="true" />
        <div className="shelf-colour" data-tooltip="Colour of the next connector">
          <ColorPickerPopover
            color={connectorColor || ThemeService.getDefaultStrokeColor()}
            onChange={setConnectorColor}
            allowNone={false}
          />
        </div>
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

  /**
   * The drawing tray stands where the shelf does, for the Draw seat: while one
   * of its tools is in hand, or while its menu is open with nothing armed yet.
   */
  const trayTool = isPen || (activeToolId === 'eraser' && eraserCarried);
  const showTray = !editing && ((trayTool && openMenu === null) || openMenu === 'pen');
  const showShelf =
    !showTray && !editing && openMenu === null && shelfName !== null && (shelfBody !== null || shelfLock !== null);
  /** The seat whose shelf is up, whose tooltip therefore stands down. */
  const shelfSeat: DockSeat | null = showTray
    ? 'draw'
    : showShelf
      ? activeToolId === 'sticky' ? 'draw'
        : activeToolId === 'eraser' ? 'eraser'
        : isLine ? (lineCarried ? 'shape' : 'line')
        : activeToolId === 'connector' ? 'connector'
        : activeToolId === 'text' ? 'type'
        : null
      : null;

  /* ----------------------------------------------------- a note off the pad */

  /**
   * Drag a note off the pad in the Draw tray and put it down where you let go.
   *
   * ## Why only the note
   *
   * It is the one tool whose art is the object itself, at a size that does
   * not need deciding: a note is 200 by 200 and sits where it is put. A shape
   * dragged out would still need a size and a preset, which is a drag on the
   * board with the tool -- the gesture that already exists. So the note gets
   * the pad-of-paper gesture and nothing pretends to.
   *
   * ## Why it starts only upward
   *
   * Sliding sideways along the rack is how people cross it, and the pad's
   * ordinary job is to be clicked. A carry begins when the pointer has lifted
   * clear of it (`CARRY_LIFT`), so a click that wobbles is still a click.
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
  /** Set for the click that follows the release of a carry -- see the tray's pad. */
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
      // A captured pointer's click lands on the pad; this keeps it from
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
      data-region="2"
      data-editing={editing || undefined}
      data-dragging={dragging || undefined}
      // A menu is open: the dock rises above the board's other floating
      // chrome for as long as it is, so nothing paints over the menu. See
      // `dock.css`.
      data-menu-open={openMenu !== null || undefined}
      role="toolbar"
      aria-label="Canvas tools"
      aria-orientation="horizontal"
      onKeyDown={onToolbarKeyDown}
    >
      <AnimatePresence>
        {showShelf && (
          <motion.div
            key="shelf"
            ref={shelfCentred}
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
        {showTray && (
          <motion.div
            key="tray"
            ref={trayCentred}
            className="tool-shelf dock-tray panel-surface"
            role="group"
            aria-label="Drawing tray"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <DrawingTray
              activeToolId={activeToolId}
              onArm={(id) => {
                setLastDraw(id === 'sticky' ? lastDraw : (id as DrawTool));
                pick(id);
              }}
              onStickyPointerDown={beginStickyCarry}
              stickyCarryEnded={() => carryEnded.current}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {capMenu && (
        <Menu
          label={capMenu.which === 'endStart' ? 'Start of the next connector' : 'End of the next connector'}
          entries={END_CAP_KINDS.map((kind: EndCapKind) => ({
            kind: 'item' as const,
            id: kind,
            label: END_CAP_LABELS[kind],
            icon: <EndCapIcon kind={kind} flip={capMenu.which === 'endStart'} />,
            // One of six, not a switch: announced as a radio, the current one ticked.
            radio: true,
            checked: nextConnector[capMenu.which] === kind,
            onSelect: () => connectorDefaults.set({ [capMenu.which]: kind }),
          }))}
          anchor={{ kind: 'rect', rect: capMenu.rect, prefer: 'above', align: 'start' }}
          focusFirst={capMenu.keyboard}
          onClose={() => {
            capClosed.current = { which: capMenu.which, at: performance.now() };
            setCapMenu(null);
          }}
        />
      )}
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
        {/* Select carries Direct select while that has no seat of its own:
            the same act at a different grain, one caret away. */}
        <div {...menuProps()} className="dock-slot-wrap" {...seatChrome('select')}>
          <DockButton
            {...seatProps('select', true)}
            icon={selectWearsDirect ? <DirectSelectGlyph /> : <SelectGlyph />}
            label={selectWearsDirect ? 'Direct select' : 'Select'}
            toolId={selectWearsDirect ? 'direct-select' : 'select'}
            description={selectWearsDirect ? 'anchors and handles' : undefined}
            active={activeToolId === 'select' || selectWearsDirect}
            hasMenu={carried('directSelect')}
            menuOpen={openMenu === 'select'}
            onClick={() => setTool(selectWearsDirect ? 'direct-select' : 'select')}
            onOpenMenu={carried('directSelect') ? () => openSeatMenu('select') : undefined}
            onCaret={carried('directSelect') ? () => toggleMenu('select') : undefined}
          >
            <Flyout open={openMenu === 'select'} motion={flyoutEntry} title="Select" menu="select">
                <FlyoutItem
                  icon={<SelectGlyph size={16} />} label="Select" toolId="select"
                  description="whole objects" active={activeToolId === 'select'}
                  onClick={() => pick('select')}
                />
                <FlyoutItem
                  icon={<DirectSelectGlyph size={16} />} label="Direct select" toolId="direct-select"
                  description="anchors and handles" active={activeToolId === 'direct-select'}
                  onClick={() => pick('direct-select')}
                />
              </Flyout>
          </DockButton>
        </div>
        <DockButton
          {...seatProps('directSelect')}
          icon={<DirectSelectGlyph />} label="Direct select" toolId="direct-select"
          description="anchors and handles"
          active={activeToolId === 'direct-select'} onClick={() => setTool('direct-select')}
        />
        <DockButton
          {...seatProps('hand')}
          icon={<HandGlyph />} label="Hand" toolId="hand"
          description="pan the board"
          active={activeToolId === 'hand'} onClick={() => setTool('hand')}
        />
      </div>

      {/* Draw. A click arms the tool used last; the caret, a long press or Up
          opens the drawing tray with nothing armed yet. The tray is the seat's
          menu: pen, marker, highlighter, eraser, vector pen and the note pad,
          with the ink well beside them. See `DrawingTray`. */}
      <div className="dock-group">
        <div {...menuProps()} className="dock-slot-wrap" {...seatChrome('draw')}>
          <DockButton
            {...seatProps('draw', true)}
            icon={drawSeatGlyph}
            label="Draw"
            toolId={drawSeatTool}
            description={drawSeatName}
            active={drawActive}
            hasMenu
            menuOpen={openMenu === 'pen'}
            onClick={() => {
              if (lastDraw === 'pen') drawSettings.set({ brush: draw.brush });
              setTool(lastDraw);
            }}
            onOpenMenu={() => openSeatMenu('pen')}
            onCaret={() => toggleMenu('pen')}
          />
        </div>

        {/* The eraser on a seat of its own, when someone pins it. Its mode and
            width go on its shelf; `[` and `]` change the width too. */}
        <DockButton
          {...seatProps('eraser')}
          icon={<EraserGlyph />} label="Eraser" toolId="eraser"
          description="[ and ] resize it"
          active={activeToolId === 'eraser'}
          onClick={() => setTool('eraser')}
        />
      </div>

      {/* Create. */}
      <div className="dock-group">
        {/* Type: a click arms the Text tool in the remembered style; the
            caret opens the styles, the face and the paragraph blocks. */}
        <div {...menuProps()} className="dock-slot-wrap" {...seatChrome('type')}>
          <DockButton
            {...seatProps('type', true)}
            icon={<TypeGlyph />} label="Text" toolId="text"
            description={textSeatDescription}
            active={activeToolId === 'text'}
            hasMenu
            menuOpen={openMenu === 'block'}
            onClick={() => setTool('text')}
            onOpenMenu={() => openSeatMenu('block')}
            onCaret={() => toggleMenu('block')}
          >
            <Flyout open={openMenu === 'block'} motion={flyoutEntry} title="Text" menu="block">
                {/* The face, then the styles, each name set in itself. Picking
                    a style arms the tool in it; click to type, drag for a
                    box that wraps. The face stays a choice, so the menu stays. */}
                <div className="dock-flyout__faces">
                  <TextFaceToggle labelled value={textNext.face} onPick={(face) => nextText.set({ face })} />
                </div>
                <TextStyleList
                  inMenu
                  rowClassName="btn-icon dock-item"
                  value={textNext.style}
                  face={textNext.face}
                  onPick={(style) => {
                    nextText.set({ style });
                    setPinnedMenu(null);
                    setTool('text');
                  }}
                />
                <div className="dock-flyout__group" role="presentation">Drop a paragraph</div>
                {DEMO_LENGTHS.map((words) => (
                  <FlyoutItem
                    key={words}
                    icon={<ParagraphGlyph size={16} />}
                    label={`${words} words`}
                    detail={words <= 30 ? 'caption' : words <= 50 ? 'paragraph' : 'body copy'}
                    active={false}
                    onClick={() => { setPinnedMenu(null); onAddTextBlock?.(words); }}
                  />
                ))}
              </Flyout>
          </DockButton>
        </div>

        {/* Shapes. A click arms the shape the seat wears, the last one used;
            the caret opens the common few, the padlock and the full library. */}
        <div {...menuProps()} className="dock-slot-wrap" {...seatChrome('shape')}>
          <DockButton
            {...seatProps('shape', true)}
            icon={
              isLine && lineCarried
                ? <LineSpecimen profile={lineProfile} endEnd={armedLine === 'arrow' ? 'arrow' : 'none'} />
                : <ShapeIcon kind={seatShape} size={20} />
            }
            label="Shape" toolId="shape"
            description={isLine && lineCarried ? SHAPE_BY_PRESET[armedLine!].label : SHAPE_BY_PRESET[seatShape].label}
            active={shapeActive}
            hasMenu
            menuOpen={openMenu === 'shape'}
            onClick={() => clickSeat('shape', shapeToolId(seatShape), shapeActive, () => setTool(shapeToolId(seatShape)))}
            onOpenMenu={() => openSeatMenu('shape')}
            onCaret={() => toggleMenu('shape')}
          >
            <Flyout open={openMenu === 'shape'} motion={flyoutEntry} title="Shapes" menu="shape" bare>
                <SeatMenu
                  noun="shapes"
                  quick={QUICK_SHAPES.map(shapeTile)}
                  current={shapeTile(seatShape)}
                  onPick={pickShape}
                  locked={seatLocked(shapeToolId(seatShape))}
                  onLock={() => lockSeat(shapeToolId(seatShape), () => setTool(shapeToolId(seatShape)))}
                  sheet={(fold) => (
                    <ShapeSheet
                      value={armedBoxShape}
                      onPick={(preset) => {
                        pickShape(preset);
                        fold();
                      }}
                      // Shift+click arms and keeps the library open; the seat
                      // remembers that shape as it does a plain pick.
                      onArm={(preset) => {
                        setLastShape(preset);
                        setTool(shapeToolId(preset));
                      }}
                      focusSearch
                    />
                  )}
                  trailing={
                    lineCarried &&
                    LINE_PRESETS.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        role="menuitemradio"
                        aria-checked={armedLine === kind}
                        aria-label={`${SHAPE_BY_PRESET[kind].label} (L)`}
                        data-tooltip={`${SHAPE_BY_PRESET[kind].label} (L)`}
                        className={`btn-icon seat-menu__tile${armedLine === kind ? ' active' : ''}`}
                        onClick={() => {
                          setLastLine(kind);
                          setTool(shapeToolId(kind));
                        }}
                      >
                        <LineSpecimen profile={lineProfile} endEnd={kind === 'arrow' ? 'arrow' : 'none'} />
                      </button>
                    ))
                  }
                />
              </Flyout>
          </DockButton>
        </div>

        {/* Line and arrow on a seat of its own, when pinned. Its choices are
            on the shelf, which rises when it is armed. */}
        <DockButton
          {...seatProps('line')}
          icon={
            <LineSpecimen
              profile={lineProfile}
              endEnd={(armedLine ?? lastLine) === 'arrow' ? 'arrow' : 'none'}
            />
          }
          label={`${LINE_PROFILE_LABELS[lineProfile]} ${SHAPE_BY_PRESET[armedLine ?? lastLine].label.toLowerCase()}`}
          toolId="shape-line"
          description="drag, or click once per corner"
          active={isLine}
          onClick={() => pick(shapeToolId(armedLine ?? lastLine))}
        />

        {/* Frames. The choice is a size: what a click on the board produces.
            Dragging always sizes by hand. */}
        <div {...menuProps()} className="dock-slot-wrap" {...seatChrome('frame')}>
          <DockButton
            {...seatProps('frame', true)}
            icon={<FrameGlyph />} label="Frame" toolId="frame"
            description={frameChoice.detail ? `${frameChoice.label}, ${frameChoice.detail}` : frameChoice.label}
            active={isFrame} hasMenu menuOpen={openMenu === 'frame'}
            onClick={() => clickSeat('frame', currentFrame, isFrame, () => setTool(currentFrame))}
            onOpenMenu={() => openSeatMenu('frame')}
            onCaret={() => toggleMenu('frame')}
          >
            <Flyout open={openMenu === 'frame'} motion={flyoutEntry} title="Frame size" menu="frame" bare>
                <SeatMenu
                  noun="sizes"
                  quick={QUICK_FRAMES.map(frameTile)}
                  current={frameTile(currentFrame)}
                  onPick={pickFrame}
                  locked={seatLocked(currentFrame)}
                  onLock={() => lockSeat(currentFrame, () => setTool(currentFrame))}
                  sheet={(fold) => (
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
                              onClick={() => {
                                pickFrame(`frame-${preset.id}`);
                                fold();
                              }}
                              aria-label={`${preset.label}, ${preset.width} by ${preset.height}`}
                            >
                              <span className="frame-chip__glyph" aria-hidden="true">
                                <FramePresetIcon icon={preset.icon} />
                              </span>
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
                  )}
                />
              </Flyout>
          </DockButton>
        </div>

        {/* Grid, Chart and Table on seats of their own, when pinned. By
            default all three are carried by the Data seat. */}
        <div {...menuProps()} className="dock-slot-wrap" {...seatChrome('grid')}>
          <DockButton
            {...seatProps('grid', true)}
            icon={<GridKindIcon kind={gridKind} size={20} />} label="Grid" toolId="grid"
            description={GRID_LABELS[gridKind]}
            active={activeToolId === 'grid'} hasMenu menuOpen={openMenu === 'grid'}
            onClick={() => clickSeat('grid', 'grid', activeToolId === 'grid', () => setTool('grid'))}
            onOpenMenu={() => openSeatMenu('grid')}
            onCaret={() => toggleMenu('grid')}
          >
            <Flyout open={openMenu === 'grid'} motion={flyoutEntry} title="Grid system" menu="grid" bare>
                {gridSeatMenu()}
              </Flyout>
          </DockButton>
        </div>

        <div {...menuProps()} className="dock-slot-wrap" {...seatChrome('chart')}>
          <DockButton
            {...seatProps('chart', true)}
            icon={<ChartKindIcon kind={lastChart} size={20} />} label="Chart" toolId="chart"
            description={CHART_LABELS[lastChart]}
            active={activeToolId === 'chart'} hasMenu menuOpen={openMenu === 'chart'}
            onClick={() => clickSeat('chart', 'chart', activeToolId === 'chart', () => pickChart(lastChart))}
            onOpenMenu={() => openSeatMenu('chart')}
            onCaret={() => toggleMenu('chart')}
          >
            <Flyout open={openMenu === 'chart'} motion={flyoutEntry} title="Chart type" menu="chart" bare>
                {chartSeatMenu()}
              </Flyout>
          </DockButton>
        </div>

        <div {...menuProps()} className="dock-slot-wrap" {...seatChrome('table')}>
          <DockButton
            {...seatProps('table', true)}
            icon={<TableGlyph />} label="Table" toolId="table"
            description={tableName}
            active={activeToolId === 'table'} hasMenu menuOpen={openMenu === 'table'}
            onClick={() => clickSeat('table', 'table', activeToolId === 'table', () => pickTable(lastTable))}
            onOpenMenu={() => openSeatMenu('table')}
            onCaret={() => toggleMenu('table')}
          >
            <Flyout open={openMenu === 'table'} motion={flyoutEntry} title="Table" menu="table" bare>
                {tableSeatMenu()}
              </Flyout>
          </DockButton>
        </div>

        {/* Data: Table, Chart and Grid on one seat, wearing the last used. A
            click arms that one; the caret opens a switch between the three
            above the chosen tool's own menu. */}
        <div {...menuProps()} className="dock-slot-wrap" {...seatChrome('data')}>
          <DockButton
            {...seatProps('data', true)}
            icon={dataGlyph(armedData ?? lastData)}
            label={DATA_LABEL[armedData ?? lastData]}
            toolId={armedData ?? lastData}
            description={dataDescription(armedData ?? lastData)}
            active={armedData !== null}
            hasMenu
            menuOpen={openMenu === 'data'}
            onClick={() => clickSeat('data', lastData, armedData !== null, () => armData(lastData))}
            onOpenMenu={() => openSeatMenu('data')}
            onCaret={() => toggleMenu('data')}
          >
            <Flyout open={openMenu === 'data'} motion={flyoutEntry} title="Data" menu="data" bare>
                {dataTab === 'table' ? tableSeatMenu(dataSwitch)
                  : dataTab === 'chart' ? chartSeatMenu(dataSwitch)
                  : gridSeatMenu(dataSwitch)}
              </Flyout>
          </DockButton>
        </div>

        {/* Connector: it makes a relationship, so it needs two objects to
            exist already. Its route, ends and colour are on its shelf. */}
        <DockButton
          {...seatProps('connector')}
          icon={<ConnectorGlyph />} label="Connector" toolId="connector"
          description="join two objects"
          active={activeToolId === 'connector'} onClick={() => setTool('connector')}
        />
      </div>

      {/* Insert, and the tools it carries when they are pinned on their own. */}
      <div className="dock-group">
        <DockButton
          {...seatProps('image')}
          icon={<ImageGlyph />} label="Image" toolId="image"
          description="upload a picture"
          active={activeToolId === 'image'} onClick={() => setTool('image')}
        />
        <DockButton
          {...seatProps('audio')}
          icon={<MicGlyph />} label="Voice note" toolId="audio"
          description="record a spoken note"
          active={activeToolId === 'audio'} onClick={() => setTool('audio')}
        />
        <DockButton
          {...seatProps('forces')}
          icon={<ForcesGlyph />} label="Physics"
          description="push, pull and drop objects (Shift+P)"
          active={isForceTool(activeToolId)}
          onClick={() => pick(lastForce)}
        />

        {/* Insert: everything that comes onto the board from outside it, in
            one searchable library. The seat is the library's door, so a click
            opens it; while an inserted tool is armed the seat wears it. */}
        <div {...menuProps()} className="dock-slot-wrap" {...seatChrome('media')}>
          <DockButton
            {...seatProps('media', true)}
            icon={mediaArmed ? MEDIA_GLYPH[activeToolId as MediaTool] : <InsertGlyph />}
            label="Insert"
            description="images, voice, links, code, diagrams and icons"
            active={mediaArmed}
            hasMenu
            clickOpensMenu
            menuOpen={openMenu === 'media'}
            onClick={() => (openMenu === 'media' ? setPinnedMenu(null) : openSeatMenu('media'))}
            onOpenMenu={() => openSeatMenu('media')}
          >
            <Flyout open={openMenu === 'media'} motion={flyoutEntry} title="Insert" menu="media" bare>
                <ToolLibrary label="Insert" entries={insertEntries} searchPlaceholder="Search what to insert" />
              </Flyout>
          </DockButton>
        </div>

        <DockButton
          {...seatProps('comment')}
          icon={<CommentGlyph />} label="Comment" toolId="comment"
          description="pin a note to a point or an object"
          active={activeToolId === 'comment'}
          onClick={() => setTool('comment')}
        />
      </div>

      {/* All tools: every tool, grouped and searchable, each with its key and
          a pin to put it on the dock, and the way into editing the dock. It
          is not part of the arrangement, so it says where it goes: after
          every seat and every divider. */}
      <div className="dock-group">
        <div
          {...menuProps()}
          className="dock-slot-wrap"
          data-tour="all-tools"
          style={{ order: layout.order.length + 1 }}
        >
          <DockButton
            {...moreSeatProps()}
            icon={<AllToolsGlyph />}
            label={editing ? 'Editing the dock' : 'All tools'}
            description={editing ? undefined : 'every tool, and customising the dock'}
            active={false}
            hasMenu
            clickOpensMenu
            menuOpen={openMenu === 'more'}
            onClick={() => (openMenu === 'more' ? setPinnedMenu(null) : openSeatMenu('more'))}
            onOpenMenu={() => openSeatMenu('more')}
          >
            <Flyout open={openMenu === 'more' && !editing} motion={flyoutEntry} title="All tools" menu="more" bare>
                <ToolLibrary
                  label="All tools"
                  entries={allEntries}
                  searchPlaceholder="Search all tools"
                  footer={
                    <>
                      <FlyoutItem
                        icon={<Move size={16} />}
                        label="Customise dock…"
                        description="drag tools to rearrange, add dividers, put tools away"
                        active={false}
                        onClick={() => {
                          setEditing(true);
                          setPinnedMenu('more');
                        }}
                      />
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
                          label="Reset dock"
                          description="back to the arrangement it shipped with"
                          active={false}
                          onClick={() => dockDefaults.reset()}
                        />
                      )}
                    </>
                  }
                />
              </Flyout>
            <Flyout open={openMenu === 'more' && editing} motion={flyoutEntry} title="Editing the dock" menu="editing">
                {layout.hidden.length > 0 && (
                  <>
                    <div className="dock-flyout__group" role="presentation">Not on the dock</div>
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
                <div className="dock-flyout__group" role="presentation">Dock</div>
                <FlyoutItem
                  icon={<Check size={16} />}
                  label="Done editing"
                  description="stop rearranging"
                  active
                  onClick={() => {
                    setEditing(false);
                    setPinnedMenu(null);
                  }}
                />
                <FlyoutItem
                  icon={<SeparatorVertical size={16} />}
                  label="Add a divider"
                  description="group the tools your way"
                  active={false}
                  onClick={addDivider}
                />
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
                    label="Reset dock"
                    description="back to the arrangement it shipped with"
                    active={false}
                    onClick={() => dockDefaults.reset()}
                  />
                )}
              </Flyout>
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

/**
 * The dock, contained: a crash here leaves the board and its other chrome
 * running. On a phone it is the compact bar instead (`PhoneToolbar`).
 */
export const ToolWorkspace = React.memo(function ToolWorkspace(props: Props) {
  const phone = usePhone();
  return (
    <FeatureBoundary name="tool dock" variant="panel" resetKey={props.activeToolId}>
      {phone ? <PhoneToolbar activeToolId={props.activeToolId} /> : <ToolWorkspaceInner {...props} />}
    </FeatureBoundary>
  );
});
