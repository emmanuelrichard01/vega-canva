import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Lock, LockOpen } from 'lucide-react';

/**
 * The menu a seat with choices opens: a short row first, everything on request.
 *
 * ## Why not the whole sheet straight away
 *
 * These menus open when the pointer *rests* on a seat, and the pointer rests
 * on seats on its way to somewhere else. Opening straight into every shape,
 * every chart, every table put a 340px panel over the board for a glance --
 * and the commonest choice in each is one of a handful. So the row comes
 * first: a few fixed choices, the way to see all of them, and the padlock.
 * FigJam and Miro open their shape menus the same way.
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
 * The row hugs its own buttons, and is centred under a wider sheet. It first
 * took the sheet's width in both states, to stop the panel widening sideways
 * -- which pushed the tiles left and More right with a hole between them, a
 * row that looked broken to fix a movement that centring already prevents:
 * the flyout is centred on its seat, so a centred row is where it was.
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
  /** The full sheet. */
  sheet: React.ReactNode;
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
      {expanded && <div className="seat-menu__sheet">{sheet}</div>}

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
