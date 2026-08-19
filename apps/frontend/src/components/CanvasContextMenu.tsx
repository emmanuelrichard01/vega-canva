import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Circle, Copy, ClipboardPaste, FileCode2, ImageDown, Minus, MousePointerSquareDashed,
  MoveRight, Square, Star, Trash2, Triangle, BringToFront, SendToBack, Shapes, Workflow, Code2,
} from 'lucide-react';
import type { AnyNode, ShapeKind } from '../engine/model/schema';

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
  };
  canPaste: boolean;
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

          <Item icon={<BringToFront size={15} />} label="Bring to front" onClick={actions.bringToFront} />
          <Item icon={<SendToBack size={15} />} label="Send to back" onClick={actions.sendToBack} />
          <div className="ctxmenu__rule" role="separator" />

          {typeName && (
            <Item
              icon={<MousePointerSquareDashed size={15} />}
              label={`Select all ${typeName}s`}
              onClick={actions.selectAllOfType}
            />
          )}
          <Item icon={<Trash2 size={15} />} label="Delete" shortcut="Del" danger onClick={actions.remove} />
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
