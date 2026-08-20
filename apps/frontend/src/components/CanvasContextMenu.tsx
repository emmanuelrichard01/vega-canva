import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Circle, Copy, ClipboardPaste, FileCode2, ImageDown, Minus, MousePointerSquareDashed,
  MoveRight, Square, Star, Trash2, Triangle, BringToFront, SendToBack, Shapes, Workflow, Code2,
  Group, Ungroup, Lock, Unlock, Eye, EyeOff,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
} from 'lucide-react';
import type { AnyNode, ShapeKind } from '../engine/model/schema';
import { resolveAffordances, type AffordanceId } from '../engine/selection/affordances';
import type { AlignEdge, DistributeAxis } from '../engine/model/align';

export interface ContextTarget {
  /** Where the menu was summoned, in screen coordinates. */
  x: number;
  y: number;
  /** What was under the pointer. Empty for the bare board. */
  ids: string[];
}

interface Props {
  target: ContextTarget | null;
  onClose: () => void;
  objects: Record<string, AnyNode>;
  actions: {
    copy: () => void;
    paste: () => void;
    duplicate: () => void;
    remove: () => void;
    bringToFront: () => void;
    sendToBack: () => void;
    selectAll: () => void;
    selectAllOfType: () => void;
    copyPng: () => void;
    copySvg: () => void;
    copyMermaid: () => void;
    editMermaid: () => void;
    swapShape: (kind: ShapeKind, points?: number) => void;
    group: () => void;
    ungroup: () => void;
    align: (edge: AlignEdge) => void;
    distribute: (axis: DistributeAxis) => void;
    toggleLock: () => void;
    hide: () => void;
  };
  canPaste: boolean;
  /** Everything on the board, so the resolver can tell a whole group from part of one. */
  allObjects?: Record<string, AnyNode>;
}

/**
 * The shapes a selection can be swapped between.
 *
 * The same seven the floating toolbar offers, and deliberately the same list:
 * a swapper that knew about a shape the toolbar did not — or the reverse —
 * would make what you can turn a box into depend on where you asked.
 */
const SWAP_CHOICES: Array<{ kind: ShapeKind; points?: number; label: string; icon: React.ReactNode }> = [
  { kind: 'rect', label: 'Rectangle', icon: <Square size={15} /> },
  { kind: 'ellipse', label: 'Ellipse', icon: <Circle size={15} /> },
  { kind: 'polygon', points: 3, label: 'Triangle', icon: <Triangle size={15} /> },
  { kind: 'polygon', points: 6, label: 'Hexagon', icon: <Shapes size={15} /> },
  { kind: 'star', points: 5, label: 'Star', icon: <Star size={15} /> },
  { kind: 'line', label: 'Line', icon: <Minus size={15} /> },
  { kind: 'arrow', label: 'Arrow', icon: <MoveRight size={15} /> },
];

/**
 * The commands this menu can run, keyed by the affordance that offers them.
 *
 * Deliberately a lookup rather than a chain of conditions: the resolver
 * answers *whether* and *in what order*, this answers *what it does*, and
 * neither can silently drift into deciding the other's half. `order`,
 * `boolean`, `routing` and `crop` on a multi-selection have no single menu
 * command, so they are absent here and the menu skips them — without any
 * surface having to know that in advance.
 */
const MENU_COMMANDS: Partial<Record<AffordanceId, {
  icon: (nodes: AnyNode[]) => React.ReactNode;
  label: (nodes: AnyNode[]) => string;
  shortcut?: string;
  danger?: boolean;
  run: (a: Props['actions']) => () => void;
}>> = {
  group: { icon: () => <Group size={15} />, label: () => 'Group', shortcut: 'Ctrl G', run: (a) => a.group },
  ungroup: { icon: () => <Ungroup size={15} />, label: () => 'Ungroup', shortcut: '⇧Ctrl G', run: (a) => a.ungroup },
  order: { icon: () => <BringToFront size={15} />, label: () => 'Bring to front', run: (a) => a.bringToFront },
  lock: {
    // Says which way it will go. A toggle labelled with its own name rather
    // than its effect makes you look at the object to find out.
    icon: (nodes) => (nodes.every((n) => n.locked) ? <Unlock size={15} /> : <Lock size={15} />),
    label: (nodes) => (nodes.every((n) => n.locked) ? 'Unlock' : 'Lock'),
    run: (a) => a.toggleLock,
  },
  visibility: {
    icon: (nodes) => (nodes.every((n) => n.hidden) ? <Eye size={15} /> : <EyeOff size={15} />),
    label: (nodes) => (nodes.every((n) => n.hidden) ? 'Show' : 'Hide'),
    run: (a) => a.hide,
  },
  delete: {
    icon: () => <Trash2 size={15} />, label: () => 'Delete', shortcut: 'Del', danger: true,
    run: (a) => a.remove,
  },
};

/** The six edges, in the order the toolbar shows them. */
const ALIGN_CHOICES: Array<{ edge: AlignEdge; label: string; icon: React.ReactNode }> = [
  { edge: 'left', label: 'Align left', icon: <AlignStartVertical size={15} /> },
  { edge: 'centerX', label: 'Align horizontal centres', icon: <AlignCenterVertical size={15} /> },
  { edge: 'right', label: 'Align right', icon: <AlignEndVertical size={15} /> },
  { edge: 'top', label: 'Align top', icon: <AlignStartHorizontal size={15} /> },
  { edge: 'middleY', label: 'Align vertical centres', icon: <AlignCenterHorizontal size={15} /> },
  { edge: 'bottom', label: 'Align bottom', icon: <AlignEndHorizontal size={15} /> },
];

/**
 * The board's right-click menu.
 *
 * ## What is in it, and what is deliberately not
 *
 * A context menu earns its place by holding what has **nowhere else to live**,
 * not by mirroring the inspector. Copy-as-PNG and copy-as-SVG are the clearest
 * case: both existed in the export pipeline and neither was reachable without
 * opening a modal and choosing a format, which is three steps too many for
 * "put this in the message I am writing". Select-all-of-type is the same —
 * real, useful, and previously unreachable.
 *
 * Swap shape is the one borrowed item, and it is borrowed because it is the
 * single most-wanted thing that currently requires finding a small button on a
 * floating toolbar. It keeps size, paint, position and rotation; only the form
 * changes, which is what makes it a swap rather than a delete and redraw.
 *
 * Fill, stroke, opacity and the rest are **not** here. They are a panel's worth
 * of controls, they already have a panel, and a menu that tried to hold them
 * would be a worse copy of it that also covers the object being edited.
 */
export const CanvasContextMenu: React.FC<Props> = ({
  target,
  onClose,
  objects,
  actions,
  canPaste,
  allObjects,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState({ dx: 0, dy: 0 });

  /**
   * Pull back inside the window once the real size is known.
   *
   * Measured after layout rather than estimated: the menu's height depends on
   * whether anything is selected and whether that selection is swappable, so a
   * guess would be wrong for at least one of the three shapes it takes. A
   * right-click near the bottom of the screen is completely ordinary, and a
   * menu that opens half off it is unusable exactly when it is most convenient.
   */
  useLayoutEffect(() => {
    if (!target || !ref.current) return;
    setNudge({ dx: 0, dy: 0 });
    const rect = ref.current.getBoundingClientRect();
    const dx = rect.right > window.innerWidth - 8 ? window.innerWidth - 8 - rect.right : 0;
    const dy = rect.bottom > window.innerHeight - 8 ? window.innerHeight - 8 - rect.bottom : 0;
    if (dx || dy) setNudge({ dx, dy });
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // `pointerdown` rather than `click`: a menu that survived until mouseup
    // would still be on screen while the next drag had already begun.
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [target, onClose]);

  if (!target) return null;

  const selected = target.ids.map((id) => objects[id]).filter(Boolean);
  const hasSelection = selected.length > 0;
  // Swapping is offered when *everything* selected is a shape — a mixed
  // selection has no single form to change, and silently swapping only the
  // shapes in it would be a different, unasked-for operation.
  const canSwap = hasSelection && selected.every((n) => n.type === 'shape');
  /**
   * Whether Mermaid has anything to say about this selection — and how much.
   *
   * ## Why this is not "everything must be a shape or a connector"
   *
   * That was the first rule and it fails the case the feature is most for. The
   * canvas cannot tell a flowchart from a pile of rectangles, so the signal has
   * to come from the person: they **group** the thing, which is exactly what
   * grouping means. But a real grouped diagram routinely has a stray sticky
   * note stuck to it, or a title in a text box — and a strict rule hides the
   * action on precisely those, with no explanation.
   *
   * So the gate is "at least one shape", and the menu **says what will not
   * survive** rather than silently dropping it or refusing outright. Mermaid
   * describes boxes joined by arrows; a note, an image and a voice memo have no
   * representation in it, and no amount of trying changes that. Telling the
   * user "12 of 14 objects" is the honest version of a limitation that cannot
   * be engineered away.
   */
  /**
   * Which structural commands belong here, and in what order.
   *
   * `surface: 'menu'` is the filter, and `MENU_COMMANDS` is the other half:
   * an affordance the resolver offers but this menu has no command for simply
   * does not render, which is what lets a new affordance be added to the
   * resolver without breaking a surface that is not ready for it.
   */
  const offered = resolveAffordances(selected, {
    surface: 'menu',
    allObjects: allObjects ?? objects,
  });
  const affords = new Set(offered.map((a) => a.id));
  /**
   * Delete is held back to the end regardless of what it weighs.
   *
   * The resolver ranks by *specificity*, which is the right question for
   * "which of these leads". It is not the right question for "which of these
   * is one slip away from destroying the work": a destructive item goes last,
   * behind a rule, in every menu anyone has used, and that convention outranks
   * the ordering here.
   */
  const structural = offered.filter((a) => a.id in MENU_COMMANDS && a.id !== 'delete');
  const canDelete = affords.has('delete');

  const diagramParts = selected.filter((n) => n.type === 'shape' || n.type === 'connector');
  const isDiagram = hasSelection && selected.some((n) => n.type === 'shape');
  const dropped = selected.length - diagramParts.length;
  const typeName = selected[0]?.type;

  const Item: React.FC<{
    icon: React.ReactNode;
    label: string;
    shortcut?: string;
    disabled?: boolean;
    danger?: boolean;
    onClick: () => void;
  }> = ({ icon, label, shortcut, disabled, danger, onClick }) => (
    <button
      type="button"
      className={`ctxmenu__item${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      onClick={() => {
        onClick();
        onClose();
      }}
    >
      <span className="ctxmenu__icon">{icon}</span>
      <span className="ctxmenu__label">{label}</span>
      {shortcut && <span className="ctxmenu__key">{shortcut}</span>}
    </button>
  );

  return (
    <div
      ref={ref}
      className="ctxmenu"
      role="menu"
      aria-label="Canvas actions"
      style={{ left: target.x + nudge.dx, top: target.y + nudge.dy }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {hasSelection ? (
        <>
          <Item icon={<Copy size={15} />} label="Copy" shortcut="Ctrl C" onClick={actions.copy} />
          <Item icon={<Copy size={15} />} label="Duplicate" shortcut="Ctrl D" onClick={actions.duplicate} />
          <div className="ctxmenu__rule" role="separator" />

          {canSwap && (
            <>
              <div className="ctxmenu__heading">Swap shape</div>
              <div className="ctxmenu__swatches">
                {SWAP_CHOICES.map((choice) => (
                  <button
                    key={`${choice.kind}-${choice.points ?? 0}`}
                    type="button"
                    className="ctxmenu__swatch"
                    data-tooltip={choice.label}
                    aria-label={`Swap to ${choice.label}`}
                    onClick={() => {
                      actions.swapShape(choice.kind, choice.points);
                      onClose();
                    }}
                  >
                    {choice.icon}
                  </button>
                ))}
              </div>
              <div className="ctxmenu__rule" role="separator" />
            </>
          )}

          {/**
            * What this selection affords, from the same resolver the toolbar
            * and the properties panel read.
            *
            * These commands were simply **absent** from the menu. Right-click
            * on two objects and there was no Group — the single most expected
            * item in a context menu on a multi-selection anywhere — no align,
            * no lock, no hide. They were on the floating toolbar, so the menu
            * was not a smaller version of it but a differently-shaped one, and
            * which commands you could reach depended on where you asked.
            *
            * Rendered in the resolver's order, so the most specific thing this
            * selection offers leads here exactly as it leads there. The menu
            * declares `surface: 'menu'`, which is how the continuous controls
            * — fill, opacity, the type sections — stay out: they are a panel's
            * worth of controls, they have a panel, and a menu holding them
            * would be a worse copy of it that also covers what you are editing.
            */}
          {structural.map(({ id }) => {
            const command = MENU_COMMANDS[id];
            if (!command) return null;
            return (
              <Item
                key={id}
                icon={command.icon(selected)}
                label={command.label(selected)}
                shortcut={command.shortcut}
                danger={command.danger}
                onClick={command.run(actions)}
              />
            );
          })}
          {/* `order` renders as a pair: the resolver answers "can this be
              restacked", and both directions are the same answer. */}
          {affords.has('order') && (
            <Item icon={<SendToBack size={15} />} label="Send to back" onClick={actions.sendToBack} />
          )}

          {/**
            * Arrangement, as a strip rather than as items.
            *
            * Align is not one command but six, and distribute is two more.
            * Eight rows would be most of the menu, so they render the way swap
            * shape already does — a row of targets, each one a single click.
            * That the resolver offers them at all is the same question it
            * answers for the toolbar, which is why five connectors get the
            * same arrangement controls in both places.
            */}
          {affords.has('align') && (
            <>
              <div className="ctxmenu__rule" role="separator" />
              <div className="ctxmenu__heading">Arrange</div>
              <div className="ctxmenu__swatches">
                {ALIGN_CHOICES.map(({ edge, label, icon }) => (
                  <button
                    key={edge}
                    type="button"
                    className="ctxmenu__swatch"
                    data-tooltip={label}
                    aria-label={label}
                    onClick={() => { actions.align(edge); onClose(); }}
                  >
                    {icon}
                  </button>
                ))}
                {affords.has('distribute') && (
                  <>
                    <button
                      type="button"
                      className="ctxmenu__swatch"
                      data-tooltip="Even horizontal gaps"
                      aria-label="Distribute horizontally"
                      onClick={() => { actions.distribute('horizontal'); onClose(); }}
                    >
                      <AlignHorizontalSpaceAround size={15} />
                    </button>
                    <button
                      type="button"
                      className="ctxmenu__swatch"
                      data-tooltip="Even vertical gaps"
                      aria-label="Distribute vertically"
                      onClick={() => { actions.distribute('vertical'); onClose(); }}
                    >
                      <AlignVerticalSpaceAround size={15} />
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          <div className="ctxmenu__rule" role="separator" />

          {/* Both of these were already built and neither was reachable
              without opening the export modal and picking a format. */}
          <Item icon={<ImageDown size={15} />} label="Copy as PNG" onClick={actions.copyPng} />
          <Item icon={<FileCode2 size={15} />} label="Copy as SVG" onClick={actions.copySvg} />

          {/* Offered only when the selection reads as a diagram.
              Mermaid describes boxes joined by arrows, so a photograph and a
              sticky note have nothing to say in it — putting "Copy as Mermaid"
              on every selection would make it noise on most of them and hide
              the one case where it is the most useful item in the menu.

              Two entries, because they answer different questions. Copy is for
              taking the diagram somewhere else — a README, an issue, a chat.
              Edit reopens it *as code*, which for a flowchart of any size is a
              far faster way to restructure it than dragging boxes. */}
          {isDiagram && (
            <>
              <Item icon={<Workflow size={15} />} label="Copy as Mermaid" onClick={actions.copyMermaid} />
              <Item icon={<Code2 size={15} />} label="Edit as Mermaid…" onClick={actions.editMermaid} />
              {dropped > 0 && (
                <p className="ctxmenu__note">
                  {diagramParts.length} of {selected.length} objects. Mermaid describes boxes and
                  arrows — {dropped === 1 ? 'the other one is' : `the other ${dropped} are`} left out.
                </p>
              )}
            </>
          )}
          <div className="ctxmenu__rule" role="separator" />

          {typeName && (
            <Item
              icon={<MousePointerSquareDashed size={15} />}
              label={`Select all ${typeName}s`}
              onClick={actions.selectAllOfType}
            />
          )}
          {canDelete && (
            <Item icon={<Trash2 size={15} />} label="Delete" shortcut="Del" danger onClick={actions.remove} />
          )}
        </>
      ) : (
        <>
          <Item
            icon={<ClipboardPaste size={15} />}
            label="Paste here"
            shortcut="Ctrl V"
            disabled={!canPaste}
            onClick={actions.paste}
          />
          <Item
            icon={<MousePointerSquareDashed size={15} />}
            label="Select all"
            shortcut="Ctrl A"
            onClick={actions.selectAll}
          />
          <div className="ctxmenu__rule" role="separator" />
          <Item icon={<ImageDown size={15} />} label="Copy board as PNG" onClick={actions.copyPng} />
          <Item icon={<FileCode2 size={15} />} label="Copy board as SVG" onClick={actions.copySvg} />
        </>
      )}
    </div>
  );
};
