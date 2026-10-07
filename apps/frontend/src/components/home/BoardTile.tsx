import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Pin } from 'lucide-react';
import { WorkspaceCover } from '../WorkspaceCover';
import { loadPreview } from '../../engine/model/boardPreview';
import { whenOpened, type ShelfBoard } from '../../engine/room/boardShelf';
import type { MenuAnchor } from '../menu/Menu';
import { changedSinceOpened, MAX_BOARD_NAME, presenceLine, type BoardStatus } from './library';

export type BoardLayout = 'grid' | 'list';

interface Props {
  board: ShelfBoard;
  layout: BoardLayout;
  status?: BoardStatus;
  pinned: boolean;
  renaming: boolean;
  /** Whether this device's link lets it rename the board. */
  canRename: boolean;
  menuOpen: boolean;
  onOpenMenu: (board: ShelfBoard, anchor: MenuAnchor) => void;
  onStartRename: (board: ShelfBoard) => void;
  /** `null` cancels. */
  onRename: (board: ShelfBoard, name: string | null) => void;
  onTogglePin: (board: ShelfBoard) => void;
  onRemove: (board: ShelfBoard) => void;
  /** About to follow the link, given the cover so it can travel into the board. */
  onOpen: (board: ShelfBoard, cover: HTMLElement | null) => void;
}

/**
 * One board in the library, as a card or as a row.
 *
 * The card is an `<article>` and the name is its one link, stretched over the
 * whole card by a pseudo-element: a click anywhere opens the board, and a
 * middle click, ⌘-click or "open in new tab" behave as they do on any link.
 * The ⋯ button is the link's sibling, never its child.
 *
 * Keys on a focused card: Enter opens, F2 renames, P pins, Delete (or
 * ⌘/Ctrl+Backspace) removes, Shift+F10 or the menu key opens the menu.
 * Backspace alone never removes — it is the key people press by accident.
 */
export const BoardTile: React.FC<Props> = ({
  board, layout, status, pinned, renaming, canRename, menuOpen,
  onOpenMenu, onStartRename, onRename, onTogglePin, onRemove, onOpen,
}) => {
  const preview = useMemo(() => loadPreview(board.id), [board.id]);
  const artRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const total = preview?.total;
  const missing = status ? !status.exists : false;
  const live = status ? presenceLine(status) : null;
  const changed = !missing && changedSinceOpened(board, status);

  const openMenuFromButton = () => {
    const rect = moreRef.current?.getBoundingClientRect();
    if (rect) onOpenMenu(board, { kind: 'rect', rect, prefer: 'below', align: 'end' });
  };

  const onLinkKey = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Backspace' && mod && !e.altKey) { e.preventDefault(); onRemove(board); return; }
    if (e.altKey || mod) return;
    if (e.key === 'F2') { e.preventDefault(); if (canRename) onStartRename(board); return; }
    if ((e.key === 'p' || e.key === 'P') && !e.shiftKey) { e.preventDefault(); onTogglePin(board); return; }
    if (e.key === 'Delete') { e.preventDefault(); onRemove(board); return; }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); openMenuFromButton(); }
  };

  const when = missing
    ? 'Not found on the server'
    : changed && status?.updatedAt
      ? `Edited ${whenOpened(Date.parse(status.updatedAt))}`
      : layout === 'list' ? whenOpened(board.lastAccessed) : `Opened ${whenOpened(board.lastAccessed)}`;
  const size = total === undefined ? null : `${total.toLocaleString()} object${total === 1 ? '' : 's'}`;
  const gridMeta = missing || !size ? when : `${size} · ${changed ? when : whenOpened(board.lastAccessed)}`;

  const name = renaming ? (
    <RenameField board={board} onDone={(value) => onRename(board, value)} />
  ) : (
    <a
      className="bcard__link"
      href={`/room/${board.id}`}
      data-roving={board.id}
      onKeyDown={onLinkKey}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        onOpen(board, artRef.current);
      }}
      aria-describedby={`bmeta-${board.id}`}
    >
      {board.name}
    </a>
  );

  const liveChip = live ? (
    <span className="bcard__live" role="img" aria-label={`${live} now`} data-tooltip={`${live} now`}>
      <span className="bcard__live-dot" aria-hidden="true" />
      <span aria-hidden="true">{status!.onlineCount}</span>
    </span>
  ) : null;

  return (
    <article
      className={`bcard bcard--${layout}`}
      data-cell
      data-pinned={pinned || undefined}
      data-missing={missing || undefined}
      data-open={menuOpen || undefined}
      onContextMenu={(e) => {
        if (renaming) return;
        e.preventDefault();
        onOpenMenu(board, { kind: 'point', x: e.clientX, y: e.clientY });
      }}
    >
      <div className="bcard__art" ref={artRef}>
        <WorkspaceCover workspaceId={board.id} name={board.name} preview={preview} />
        {layout === 'grid' && liveChip}
      </div>

      {layout === 'grid' ? (
        <div className="bcard__body">
          <h3 className="bcard__title">
            {name}
            {pinned && !renaming && <Pin size={12} className="bcard__pin" aria-label="Pinned" role="img" />}
          </h3>
          <p className="bcard__meta" id={`bmeta-${board.id}`}>
            {changed && <span className="bcard__fresh" aria-hidden="true" />}
            {gridMeta}
            {changed && <span className="sr-only"> (changed since you last opened it)</span>}
          </p>
        </div>
      ) : (
        <>
          <h3 className="bcard__title bcard__col bcard__col--name">
            {name}
            {pinned && !renaming && <Pin size={12} className="bcard__pin" aria-label="Pinned" role="img" />}
            {liveChip}
          </h3>
          <span className="bcard__col bcard__col--size">{missing ? '' : size ?? '—'}</span>
          <span className="bcard__col bcard__col--when" id={`bmeta-${board.id}`}>
            {changed && <span className="bcard__fresh" aria-hidden="true" />}
            {when}
            {changed && <span className="sr-only"> (changed since you last opened it)</span>}
          </span>
        </>
      )}

      <button
        ref={moreRef}
        type="button"
        className="bcard__more"
        aria-label={`More for ${board.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-tooltip={menuOpen ? undefined : 'More'}
        tabIndex={-1}
        onClick={openMenuFromButton}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
    </article>
  );
};

/**
 * The name, editable in place: Enter or leaving the field keeps it, Escape
 * puts the old one back, and an empty name reverts.
 */
const RenameField: React.FC<{ board: ShelfBoard; onDone: (name: string | null) => void }> = ({ board, onDone }) => {
  const [value, setValue] = useState(board.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };

  return (
    <input
      ref={ref}
      className="bcard__rename"
      value={value}
      maxLength={MAX_BOARD_NAME}
      aria-label={`Rename ${board.name}`}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(value); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      }}
      onBlur={() => finish(value)}
    />
  );
};
