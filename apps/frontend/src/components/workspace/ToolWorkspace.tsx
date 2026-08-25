import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore, useMemo } from 'react';
import { GridKindIcon } from './gridIcons';
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
  type DockSeat,
} from '../../engine/workspace/dockLayout';
import { gridDefaults } from '../../engine/grid/gridDefaults';
import { switchKind } from '../../engine/grid/gridBuild';
import { MousePointer2, MousePointerClick, LayoutGrid, Hand, Pen, PenTool as PenToolIcon, Type, Square, StickyNote, MessageSquare, ImageIcon, Mic, Sparkles, Frame, Eraser, Workflow, MoreVertical, TextQuote } from 'lucide-react';
import { Check, Minus, RotateCcw, SeparatorVertical, SlidersHorizontal, Spline } from 'lucide-react';
import { SegmentedControl } from '../ui/SegmentedControl';
import { SketchLevelIcon } from '../panel/sketchIcons';
import type { PencilNib } from '../../engine/model/rough';
import { LINE_PROFILES, LINE_PROFILE_LABELS, MIN_WAVES, type LineProfile } from '../../engine/model/linePath';
import { LineProfileIcon } from '../panel/lineProfileIcons';
import { LineSpecimen } from '../panel/lineSpecimen';
import { isForceTool } from '../../engine/physics/forces';
import { FRAME_PRESETS, FRAME_PRESET_GROUPS } from '../../engine/model/frames';
import { ShapeIcon } from './shapeIcons';
import { LINE_KINDS, SHAPE_KINDS, SHAPE_LABELS, shapeToolId, shapeKindFromToolId, type ShapePreset } from './shapePresetTypes';
import { shortcutFor } from '../../engine/tools/shortcuts';
import { DEMO_LENGTHS } from '../../engine/text/demoText';
import { useStore } from '../../hooks/useStore';

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
    seat?: { style?: React.CSSProperties; hidden?: boolean; 'data-seat'?: string };
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
  }
>(({ icon, label, description, toolId, active, onClick, hasMenu, menuOpen, tabIndex, children, seat, onRemove, onPointerDown, editing }, ref) => {
  const key = toolId ? shortcutFor(toolId) : undefined;
  // Rendered from the shortcut map rather than typed into the string, so the
  // hint and the binding are the same fact.
  const tooltip = [label, key ? `(${key})` : null, description ? `— ${description}` : null]
    .filter(Boolean)
    .join(' ');

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
        onClick={editing ? undefined : onClick}
        onPointerDown={onPointerDown}
        // Suppressed while the menu is open: a tooltip and the flyout it
        // belongs to occupy the same space above the button, and the tooltip
        // wins the paint.
        data-tooltip={menuOpen ? undefined : tooltip}
        aria-label={tooltip}
        data-label={label}
        tabIndex={tabIndex}
      >
        {icon}
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
const Flyout: React.FC<{ title: string; children: React.ReactNode; wide?: boolean }> = ({
  title,
  children,
  wide,
}) => (
  <div role="menu" className="dock-flyout" aria-label={title}>
    <div className={`panel-surface dock-flyout__panel ${wide ? 'dock-flyout__panel--wide' : ''}`}>
      <div className="dock-flyout__title" role="presentation">{title}</div>
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
}> = ({ icon, label, toolId, active, onClick, description, detail }) => {
  const key = toolId ? shortcutFor(toolId) : undefined;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={`btn-icon dock-item ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-label={description ? `${label} — ${description}` : label}
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
const NibSize: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, onChange }) => (
  <div className="dock-nib">
    <div className="dock-nib__head">
      <span className="dock-nib__label">{label}</span>
      <span className="dock-nib__value">{Math.round(value)}</span>
    </div>
    <div className="dock-nib__row">
      <span className="dock-nib__preview" aria-hidden="true">
        <span
          style={{
            // Clamped so the preview stays inside its slot at any size.
            width: Math.min(20, Math.max(2, value)),
            height: Math.min(20, Math.max(2, value)),
          }}
        />
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
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
  select: 'Select', directSelect: 'Direct select', hand: 'Hand',
  draw: 'Draw', eraser: 'Eraser',
  text: 'Text', block: 'Text block', shape: 'Shape', line: 'Line',
  frame: 'Frame', grid: 'Grid', connector: 'Connector', sticky: 'Note',
  image: 'Image', audio: 'Audio', forces: 'Forces',
};

const SEAT_GLYPH: Record<DockSeat, React.ReactNode> = {
  select: <MousePointer2 size={16} />, directSelect: <MousePointerClick size={16} />, hand: <Hand size={16} />,
  draw: <Pen size={16} />, eraser: <Eraser size={16} />,
  text: <Type size={16} />, block: <TextQuote size={16} />, shape: <Square size={16} />, line: <Minus size={16} />,
  frame: <Frame size={16} />, grid: <LayoutGrid size={16} />, connector: <Spline size={16} />, sticky: <StickyNote size={16} />,
  image: <ImageIcon size={16} />, audio: <Mic size={16} />, forces: <Sparkles size={16} />,
};


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
  const activeExtra = EXTRA_TOOLS.find((entry) => entry.isActive(activeToolId));


  const penSize = useStore((s) => s.penSize);
  const setPenSize = useStore((s) => s.setPenSize);
  const pencilNib = useStore((s) => s.pencilNib);
  const setPencilNib = useStore((s) => s.setPencilNib);
  const penStrokeWidth = useStore((s) => s.penStrokeWidth);
  const setPenStrokeWidth = useStore((s) => s.setPenStrokeWidth);
  const lineProfile = useStore((s) => s.lineProfile);
  const setLineProfile = useStore((s) => s.setLineProfile);
  const lineWaves = useStore((s) => s.lineWaves);
  const setLineWaves = useStore((s) => s.setLineWaves);
  const lineAmplitude = useStore((s) => s.lineAmplitude);
  const setLineAmplitude = useStore((s) => s.setLineAmplitude);
  const lastForce = useStore((s) => s.lastForce);
  const eraserSize = useStore((s) => s.eraserSize);
  const setEraserSize = useStore((s) => s.setEraserSize);

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

  type DockMenu = 'pen' | 'shape' | 'line' | 'frame' | 'grid' | 'eraser' | 'block' | 'more';
  const [pinnedMenu, setPinnedMenu] = useState<DockMenu | null>(null);
  const [hoveredMenu, setHoveredMenu] = useState<DockMenu | null>(null);
  const openMenu = pinnedMenu ?? hoveredMenu;

  const toggleMenu = (menu: DockMenu) => setPinnedMenu(current => (current === menu ? null : menu));
  const hoverProps = (menu: DockMenu) => ({
    onMouseEnter: () => setHoveredMenu(menu),
    onMouseLeave: () => setHoveredMenu(current => (current === menu ? null : current)),
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

  const armedShape = shapeKindFromToolId(activeToolId);
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
  const armedLine = armedShape && LINE_KINDS.includes(armedShape) ? armedShape : null;
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
  const isShape = activeToolId.startsWith('shape') && !armedLine;
  const isLine = Boolean(armedLine);
  const isFrame = activeToolId === 'frame' || activeToolId.startsWith('frame-');
  const isPen = ['pen', 'bezier-pen'].includes(activeToolId);

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

  /** Editing the dock is a mode, and a loud one -- see `dock-editing`. */
  const [editing, setEditing] = useState(false);

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
  const [dragging, setDragging] = useState<DockSeat | null>(null);
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
  const seatChrome = (id: DockSeat) => ({
    style: { order: seatIndex.get(id) ?? DOCK_SEATS.length },
    hidden: hiddenSeats.has(id),
    'data-seat': id,
  });

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
    };
  };

  /** The drawer, which is never part of the arrangement. */
  const moreSeatProps = () => ({
    ref: registerButton(MORE_SEAT),
    tabIndex: focusIndex === MORE_SEAT ? 0 : -1,
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
  const dropIndexAt = (clientX: number, clientY: number): number => {
    const dock = dockRef.current;
    if (!dock) return layout.order.length;
    const slots = Array.from(dock.querySelectorAll<HTMLElement>('[data-seat]'))
      .filter((el) => !el.hidden)
      .map((el) => ({ id: el.dataset.seat!, box: el.getBoundingClientRect() }));

    let best = layout.order.length;
    let bestDistance = Infinity;
    for (const { id, box } of slots) {
      const index = seatIndex.get(id);
      if (index === undefined) continue;
      // Rows first: on a wrapped dock the nearest seat by x alone can be on a
      // different line entirely.
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

  /** Pick a seat up. Only in edit mode: a plain click still selects the tool. */
  const beginSeatDrag = (id: DockSeat) => (e: React.PointerEvent) => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(id);

    const move = (ev: PointerEvent) => {
      const from = seatIndex.get(id);
      if (from === undefined) return;
      const to = dropIndexAt(ev.clientX, ev.clientY);
      if (to === from || to === from + 1) return;
      dockDefaults.set({ ...layoutRef.current, order: moveItem(layoutRef.current.order, from, to) });
    };
    const up = () => {
      setDragging(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={dockRef}
      className="tool-dock panel-surface"
      data-editing={editing || undefined}
      data-dragging={dragging || undefined}
      role="toolbar"
      aria-label="Canvas tools"
      aria-orientation="horizontal"
      onKeyDown={onToolbarKeyDown}
    >
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
      {layout.order.map((item, i) =>
        item === SEPARATOR ? (
          <span
            key={`sep-${i}`}
            className="dock-rule"
            style={{ order: i }}
            role={editing ? undefined : 'separator'}
            aria-hidden={!editing}
            onClick={editing ? () => dockDefaults.set(removeAt(layout, i)) : undefined}
            title={editing ? 'Remove this divider' : undefined}
          />
        ) : null
      )}
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
          icon={<Hand size={17} />} label="Hand" toolId="hand"
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
                  {isPen && <div className="flyout-rule" role="presentation" />}
                  {!isPen ? null : activeToolId === 'bezier-pen' ? (
                    <NibSize
                      label="Stroke weight"
                      value={penStrokeWidth}
                      min={1}
                      max={40}
                      onChange={setPenStrokeWidth}
                    />
                  ) : (
                    <>
                      <NibSize label="Brush size" value={penSize} min={1} max={60} onChange={setPenSize} />
                      {/* Which nib is in the pencil. A tool setting rather than
                          an object one, because a stroke is finished the moment
                          the pen lifts — deciding afterwards means drawing a
                          line, selecting it and changing it, every time. */}
                      <div className="flyout-field">
                        <span className="flyout-field__label">Stroke</span>
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
                      </div>
                    </>
                  )}
                </Flyout>
              )}
            </DockButton>
        </div>

        <div {...hoverProps('eraser')} className="dock-slot-wrap" {...seatChrome('eraser')}>
            <DockButton
              {...seatProps('eraser', true)}
              icon={<Eraser size={17} />} label="Eraser" toolId="eraser"
              description="[ and ] resize it"
              active={activeToolId === 'eraser'} hasMenu menuOpen={openMenu === 'eraser'}
              onClick={() => { setTool('eraser'); toggleMenu('eraser'); }}
            >
              {openMenu === 'eraser' && (
                <Flyout title="Eraser">
                  <NibSize label="Eraser size" value={eraserSize} min={4} max={200} onChange={setEraserSize} />
                </Flyout>
              )}
            </DockButton>
        </div>
      </div>

      {/* Create. The old dock put seven buttons in one undifferentiated run
          here, which is the density problem in one line: a row that long is
          scanned rather than read, so nothing in it is found quickly. */}
      <div className="dock-group">
        <DockButton
          {...seatProps('text')}
          icon={<Type size={17} />} label="Text" toolId="text"
          active={activeToolId === 'text'} onClick={() => setTool('text')}
        />

        {/* A block of placeholder prose, at a length you pick.

            Separate from the Text tool rather than a mode of it, because it is
            a different action: Text arms a tool and waits for a click, this
            drops a finished object. Folding them together would mean one seat
            that sometimes arms and sometimes creates, which is the kind of
            button people stop trusting.

            The copy is readable English rather than lorem ipsum — see
            `engine/text/demoText.ts` for why that matters here. */}
        <div {...hoverProps('block')} className="dock-slot-wrap" {...seatChrome('block')}>
          <DockButton
            {...seatProps('block', true)}
            icon={<TextQuote size={17} />} label="Text block"
            description="drop a paragraph of placeholder copy"
            active={false}
            hasMenu
            menuOpen={openMenu === 'block'}
            onClick={() => toggleMenu('block')}
          >
            {openMenu === 'block' && (
              <Flyout title="Text block" wide>
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

        <div {...hoverProps('shape')} className="dock-slot-wrap" {...seatChrome('shape')}>
            <DockButton
              {...seatProps('shape', true)}
              icon={armedBoxShape ? <ShapeIcon kind={armedBoxShape} size={18} /> : <Square size={18} />}
              label="Shape" toolId="shape" active={isShape}
              hasMenu menuOpen={openMenu === 'shape'} onClick={() => toggleMenu('shape')}
            >
              {openMenu === 'shape' && (
                <Flyout title="Shapes">
                  <div className="dock-flyout__grid">
                    {SHAPE_KINDS.map(kind => {
                      const id = shapeToolId(kind);
                      return (
                        <button
                          key={kind}
                          type="button"
                          role="menuitemradio"
                          aria-checked={activeToolId === id}
                          className={`btn-icon dock-tile ${activeToolId === id ? 'active' : ''}`}
                          onClick={() => pick(id)}
                          data-tooltip={SHAPE_LABELS[kind]}
                          aria-label={SHAPE_LABELS[kind]}
                        >
                          <ShapeIcon kind={kind} size={17} />
                        </button>
                      );
                    })}
                  </div>
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
            between them costs one click rather than a trip through a menu. */}
        <div {...hoverProps('line')} className="dock-slot-wrap" {...seatChrome('line')}>
          <DockButton
            {...seatProps('line', true)}
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
            label={`${LINE_PROFILE_LABELS[lineProfile]} ${SHAPE_LABELS[armedLine ?? lastLine].toLowerCase()}`}
            description="click to start, click again to finish"
            active={isLine}
            hasMenu
            menuOpen={openMenu === 'line'}
            /**
             * Arms the tool as well as opening the menu.
             *
             * It only opened the menu, so the seat lit up while nothing was
             * armed — you could pick a style, close the flyout, click the
             * board and have a marquee appear, because Select was still the
             * active tool the whole time. A seat that looks armed and is not
             * is the worst of the three states.
             *
             * This is what the eraser seat already did; the line seat was the
             * one that did not.
             */
            onClick={() => { pick(shapeToolId(armedLine ?? lastLine)); toggleMenu('line'); }}
          >
            {openMenu === 'line' && (
              <Flyout title="Line">
                <div className="dock-flyout__grid">
                  {LINE_KINDS.map((kind) => {
                    const id = shapeToolId(kind);
                    return (
                      <button
                        key={kind}
                        type="button"
                        role="menuitemradio"
                        aria-checked={activeToolId === id}
                        className={`btn-icon dock-tile ${activeToolId === id ? 'active' : ''}`}
                        onClick={() => { setLastLine(kind); pick(id); }}
                        data-tooltip={SHAPE_LABELS[kind]}
                        aria-label={SHAPE_LABELS[kind]}
                      >
                        {/* Each tile shows itself under the armed profile, so
                            the two choices differ by the one thing they are
                            choosing between — a head or no head. */}
                        <LineSpecimen profile={lineProfile} endEnd={kind === 'arrow' ? 'arrow' : 'none'} />
                      </button>
                    );
                  })}
                </div>
                {/* What the run does between its two ends.
                    Here rather than only in the inspector for the same reason
                    the nib is: you decide what kind of line you are drawing
                    before you draw it, and the two questions — does it have a
                    head, and what shape does it make — belong side by side. */}
                <div className="flyout-rule" role="presentation" />
                <div className="flyout-field">
                  <span className="flyout-field__label">Style</span>
                  <SegmentedControl
                    ariaLabel="Line style"
                    value={lineProfile}
                    /**
                     * Picking a style arms the tool as well as setting it.
                     *
                     * Choosing "wavy" is already a statement that you are about
                     * to draw a wavy line — making you then click Line or Arrow
                     * to confirm it is a second question with the same answer.
                     * The seat wears whichever of the two was used last, so
                     * there is always one armed; switching between them stays a
                     * single click for the times you do want the other.
                     */
                    onChange={(v) => {
                      setLineProfile(v as LineProfile);
                      pick(shapeToolId(armedLine ?? lastLine));
                    }}
                    segments={LINE_PROFILES.map((profile) => ({
                      value: profile,
                      label: LINE_PROFILE_LABELS[profile],
                      hint: LINE_PROFILE_LABELS[profile],
                      icon: <LineProfileIcon profile={profile} />,
                    }))}
                  />
                </div>
                {/* How much of the shape. A profile without a count is half a
                    choice: "a coil" and "a coil with two loops" are the same
                    decision, and splitting them means drawing the wrong one
                    and editing it every time. Curved has a single arc and
                    nothing to count. */}
                {lineProfile !== 'straight' && lineProfile !== 'curved' && (
                  <NibSize
                    label={lineProfile === 'coil' ? 'Loops' : 'Repeats'}
                    value={lineWaves}
                    min={MIN_WAVES}
                    max={20}
                    onChange={setLineWaves}
                  />
                )}
                {lineProfile !== 'straight' && (
                  <NibSize
                    label={lineProfile === 'coil' ? 'Loop size' : lineProfile === 'curved' ? 'Bow depth' : 'Wave height'}
                    value={Math.round(lineAmplitude * 100)}
                    min={25}
                    max={300}
                    onChange={(v) => setLineAmplitude(v / 100)}
                  />
                )}
              </Flyout>
            )}
          </DockButton>
        </div>

        {/* Frames. The flyout is a size picker rather than a tool switcher:
            every entry draws a frame, and the one you pick decides what a
            *click* produces. Dragging always sizes it by hand. */}
        <div {...hoverProps('frame')} className="dock-slot-wrap" {...seatChrome('frame')}>
            <DockButton
              {...seatProps('frame', true)}
              icon={<Frame size={17} />} label="Frame" toolId="frame"
              description="a bounded region with a size"
              active={isFrame} hasMenu menuOpen={openMenu === 'frame'}
              onClick={() => toggleMenu('frame')}
            >
              {openMenu === 'frame' && (
                <Flyout title="Frame size" wide>
                  <div className="dock-flyout__scroll">
                    <FlyoutItem
                      icon={<Frame size={15} />} label="Custom" detail="drag"
                      active={activeToolId === 'frame'} onClick={() => pick('frame')}
                      description="drag to size"
                    />
                    {FRAME_PRESET_GROUPS.map((group) => (
                      <React.Fragment key={group}>
                        <div className="dock-flyout__group" role="presentation">{group}</div>
                        {FRAME_PRESETS.filter((p) => p.group === group).map((preset) => (
                          <FlyoutItem
                            key={preset.id}
                            icon={<Frame size={15} />}
                            label={preset.label}
                            detail={`${preset.width} × ${preset.height}`}
                            active={activeToolId === `frame-${preset.id}`}
                            onClick={() => pick(`frame-${preset.id}`)}
                            description={`${preset.width} by ${preset.height}`}
                          />
                        ))}
                      </React.Fragment>
                    ))}
                  </div>
                </Flyout>
              )}
            </DockButton>
        </div>

        {/* Grid. Beside Frame because both answer "where does everything go"
            — a frame bounds a composition, a grid divides one — and because
            drawing a grid inside a frame you have just drawn is the sequence
            people actually perform. The flyout picks the system before the
            drag, so the preview under the pointer is already the right one. */}
        <div {...hoverProps('grid')} className="dock-slot-wrap" {...seatChrome('grid')}>
          <DockButton
            {...seatProps('grid', true)}
            icon={<LayoutGrid size={17} />} label="Grid" toolId="grid"
            description="lay out a composition"
            active={activeToolId === 'grid'} hasMenu menuOpen={openMenu === 'grid'}
            onClick={() => toggleMenu('grid')}
          >
            {openMenu === 'grid' && (
              <Flyout title="Grid system" wide>
                <div className="dock-flyout__scroll">
                  {GRID_KINDS.map((kind) => (
                    <FlyoutItem
                      key={kind}
                      icon={<GridKindIcon kind={kind} />}
                      label={GRID_LABELS[kind]}
                      description={GRID_HINTS[kind]}
                      active={gridKind === kind}
                      onClick={() => {
                        // Remembering the pick *and* arming the tool, so the
                        // flyout is a choice rather than a menu of ten tools
                        // that would each need registering.
                        //
                        // `switchKind` brings the kind's own track counts along:
                        // twelve spokes for a dial, five squares for a golden
                        // spiral. Carrying a 3x3 across would make the preview
                        // under the pointer the worst version of what was picked.
                        gridDefaults.remember(
                          switchKind(gridDefaults.forBox({ x: 0, y: 0, width: 0, height: 0 }), kind)
                        );
                        pick('grid');
                      }}
                    />
                  ))}
                </div>
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
        <DockButton
          {...seatProps('sticky')}
          icon={<StickyNote size={17} />} label="Sticky" toolId="sticky"
          active={activeToolId === 'sticky'} onClick={() => setTool('sticky')}
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
        <div {...hoverProps('more')} className="dock-slot-wrap">
          <DockButton
            {...moreSeatProps()}
            icon={activeExtra ? activeExtra.icon : <MoreVertical size={18} />}
            label={activeExtra ? activeExtra.label : 'More'}
            description={activeExtra ? activeExtra.description : 'comments and diagrams'}
            active={Boolean(activeExtra)}
            hasMenu
            menuOpen={openMenu === 'more'}
            onClick={() => toggleMenu('more')}
          >
            {openMenu === 'more' && (
              <Flyout title={editing ? 'Editing the toolbar' : 'More'} wide>
                {!editing && EXTRA_TOOLS.map((entry) => (
                  <FlyoutItem
                    key={entry.id}
                    icon={entry.icon}
                    label={entry.label}
                    description={entry.description}
                    active={entry.isActive(activeToolId)}
                    onClick={() => { setPinnedMenu(null); entry.run(); }}
                  />
                ))}

                {/**
                  * Tools that have been put away.
                  *
                  * The drawer is where a hidden seat goes, so the drawer is
                  * where it has to be reachable from -- a tool you can remove
                  * and not restore is a tool you have deleted. Listed outside
                  * edit mode too, and usable there, because someone who tidied
                  * the dock last week should not have to remember that this is
                  * a mode before they can reach the eraser.
                  */}
                {layout.hidden.length > 0 && (
                  <>
                    <div className="dock-flyout__group" role="presentation">Put away</div>
                    {layout.hidden.map((seat) => (
                      <FlyoutItem
                        key={seat}
                        icon={SEAT_GLYPH[seat]}
                        label={SEAT_LABEL[seat]}
                        description="back onto the dock"
                        active={false}
                        onClick={() => dockDefaults.set(showSeat(layout, seat))}
                      />
                    ))}
                  </>
                )}

                <div className="dock-flyout__group" role="presentation">Toolbar</div>
                <FlyoutItem
                  icon={editing ? <Check size={16} /> : <SlidersHorizontal size={16} />}
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
                    onClick={() => dockDefaults.set(addSeparator(layout, layout.order.length))}
                  />
                )}
                {!isDefaultLayout(layout) && (
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
  );
};
