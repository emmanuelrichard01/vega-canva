import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Lock, LockOpen } from 'lucide-react';

/**
 * The menu a seat with choices opens: a short row first, everything on request.
 *
 * ## Why not the whole sheet straight away
 *
 * These menus open on every click of their seat (see `seatMenuModel`), so
 * they have to cost the board almost nothing: opening straight into every
 * shape, every chart, every table would put a tall panel over the work each
 * time a tool is picked up -- and the commonest choice in each is one of a
 * handful. So the row comes first: a few fixed choices, the way to see all of
 * them, and the padlock. FigJam and Miro open their shape menus the same way.
 *
 * ## The row
 *
 * - **Fixed choices, not recents.** A recent list reshuffles under the pointer
 *   as it is used, so nobody learns where anything sits. The one exception is
 *   the current choice: if it is not among the few it takes the last slot, so
 *   the row always shows what a click on the seat will make.
 * - **More, then the padlock, on the right** -- the two controls that act on
 *   the menu and on the tool rather than choosing a kind.
 *
 * ## Expanding
 *
 * The flyout hangs from the dock by its bottom edge, so the sheet grows
 * *upward* and the row stays exactly where it was: nothing the pointer was on
 * moves. The sheet takes the keyboard when it opens, because pressing More is
 * a decision to go looking.
 *
 * The row hugs its own buttons, More and the padlock trailing the choices at
 * one fixed gap, and the panel hugs the row (see `dock.css`). Stretched to
 * the sheet's width it pushed More and the padlock to the far edge with a
 * hole between them and the choices. Open, the sheet takes the panel's step
 * on the flyout scale and the row is centred under it; the flyout is centred
 * on its seat, so the row does not move.
 *
 * A pick from the sheet folds it back to the row: the choice is made, and the
 * row keeps it one click from changing without covering the board.
 *
 * ## Why the shelf no longer carries these
 *
 * It did -- recent shapes, charts and grids, "All …", and the padlock, on the
 * tray above the dock. With this row that would be the same controls twice,
 * stacked. The shelf keeps the tools whose settings change stroke to stroke
 * (pencil, eraser, line, note); these seats carry their own.
 */

export interface QuickChoice<T extends string> {
  id: T;
  label: string;
  /** Said after the name -- a frame's size. */
  detail?: string;
  icon: React.ReactNode;
}

interface Props<T extends string> {
  /** What the choices are, plural, for the More control: "shapes". */
  noun: string;
  /** The fixed few. */
  quick: readonly QuickChoice<T>[];
  /** The current choice as a tile, shown in the last slot when it is not one of the few. */
  current: QuickChoice<T>;
  onPick: (id: T) => void;
  /** Wide tiles, for pictures wider than they are tall. */
  wideTiles?: boolean;
  locked: boolean;
  onLock: () => void;
  /** The full sheet. Given `fold`, which a pick in it calls to go back to the row. */
  sheet: React.ReactNode | ((fold: () => void) => React.ReactNode);
  /** Above the row: a switch between the tools one seat carries. */
  header?: React.ReactNode;
  /** After the common few, behind a rule: tools the seat carries beside its own. */
  trailing?: React.ReactNode;
}

export function SeatMenu<T extends string>({
  noun,
  quick,
  current,
  onPick,
  wideTiles = false,
  locked,
  onLock,
  sheet,
  header,
  trailing,
}: Props<T>) {
  const [expanded, setExpanded] = useState(false);

  const row = quick.some((q) => q.id === current.id) ? quick : [...quick.slice(0, -1), current];

  // Left and right walk the row; the dock's own arrow handling stands down
  // inside a flyout, so without this the row would be tab stops only.
  const onRowKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    buttons[(at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div className="seat-menu">
      {header && <div className="seat-menu__header">{header}</div>}
      {expanded && (
        <div className="seat-menu__sheet">{typeof sheet === 'function' ? sheet(() => setExpanded(false)) : sheet}</div>
      )}

      <div className="seat-menu__row" onKeyDown={onRowKey}>
        <div className="seat-menu__quick" role="group" aria-label={`Common ${noun}`}>
          {row.map((choice) => {
            const name = choice.detail ? `${choice.label}, ${choice.detail}` : choice.label;
            const on = choice.id === current.id;
            return (
              <button
                key={choice.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                aria-label={name}
                data-tooltip={name}
                data-wide={wideTiles || undefined}
                className={`btn-icon seat-menu__tile${on ? ' active' : ''}`}
                onClick={() => onPick(choice.id)}
              >
                {choice.icon}
              </button>
            );
          })}
        </div>

        {trailing && (
          <>
            <span className="seat-menu__rule" aria-hidden="true" />
            <div className="seat-menu__quick">{trailing}</div>
          </>
        )}
        <span className="seat-menu__rule" aria-hidden="true" />
        <button
          type="button"
          className="btn-icon seat-menu__more"
          aria-expanded={expanded}
          aria-label={expanded ? `Fewer ${noun}` : `All ${noun}`}
          data-tooltip={expanded ? `Fewer ${noun}` : `All ${noun}`}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <button
          type="button"
          className="btn-icon seat-menu__lock"
          aria-pressed={locked}
          aria-label={locked ? 'Stop keeping this tool armed' : 'Keep this tool armed'}
          data-tooltip={locked ? 'Kept armed (Q)' : 'Keep armed (Q)'}
          data-tooltip-desc={
            locked
              ? 'It stays in your hand after each one. Esc hands back to Select'
              : 'Place several in a row without coming back to the dock'
          }
          onClick={onLock}
        >
          {locked ? <Lock size={15} /> : <LockOpen size={15} />}
        </button>
      </div>
    </div>
  );
}
