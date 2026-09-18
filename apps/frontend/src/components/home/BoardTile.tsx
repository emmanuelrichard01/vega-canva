import React from 'react';
import { Check, Copy, ExternalLink, MoreHorizontal, X } from 'lucide-react';
import { WorkspaceCover } from '../WorkspaceCover';
import { whenOpened, type ShelfBoard } from '../../engine/room/boardShelf';

export type BoardLayout = 'grid' | 'list';

interface Props {
  board: ShelfBoard;
  layout: BoardLayout;
  /** Which board's menu is open, so only ever one is. */
  openMenu: string | null;
  onMenu: (id: string | null) => void;
  onCopyLink: (board: ShelfBoard) => void;
  onRemove: (board: ShelfBoard) => void;
  copied: boolean;
}

/**
 * One board in the library, as a card or as a row.
 *
 * ## The whole tile is the link
 *
 * It is an `<a href>` around the picture and the name, so a board opens with a
 * click, a middle click, ⌘-click or "open in new tab" — the things people
 * already do to a link, none of which a `div` with an `onClick` can do. The
 * two controls inside it stop the click from reaching the link.
 *
 * ## Two layouts, one component
 *
 * A grid is for recognising a board by its picture; a list is for finding one
 * of forty by name. They are the same object with the same actions, so they
 * are the same component and the difference is CSS — which is what stops the
 * list quietly growing a different menu.
 */
export const BoardTile: React.FC<Props> = ({ board, layout, openMenu, onMenu, onCopyLink, onRemove, copied }) => {
  const open = openMenu === board.id;
  const stop = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <a className={`bcard bcard--${layout}`} href={`/room/${board.id}`} data-open={open || undefined}>
      <span className="bcard__art">
        <WorkspaceCover workspaceId={board.id} name={board.name} />
      </span>

      <span className="bcard__body">
        <span className="bcard__name">{board.name}</span>
        {/* In a row the dates line up in their own column, so the word that
            labels them would repeat down the page; in a grid each date stands
            alone under a name and needs it. */}
        <span className="bcard__meta">
          {layout === 'list' ? whenOpened(board.lastAccessed) : `Opened ${whenOpened(board.lastAccessed)}`}
        </span>
      </span>

      <span className="bcard__tools">
        <button
          type="button"
          className="bcard__tool"
          aria-label={`More for ${board.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          data-tooltip={open ? undefined : 'More'}
          onClick={(event) => {
            stop(event);
            onMenu(open ? null : board.id);
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </span>

      {open && (
        <span
          className="bcard__menu ctx-popover"
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="ctx-menu-item"
            role="menuitem"
            onClick={(event) => {
              stop(event);
              onMenu(null);
              window.open(`/room/${board.id}`, '_blank', 'noopener');
            }}
          >
            <ExternalLink size={15} /> Open in a new tab
          </button>
          <button
            type="button"
            className="ctx-menu-item"
            role="menuitem"
            onClick={(event) => {
              stop(event);
              onCopyLink(board);
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Link copied' : 'Copy link'}
          </button>
          <span className="ctx-popover__rule" role="separator" />
          {/* Removal takes the address off this device and nothing else, which
              is why it says so here and why the shelf below the grid keeps it. */}
          <button
            type="button"
            className="ctx-menu-item ctx-menu-item--danger"
            role="menuitem"
            onClick={(event) => {
              stop(event);
              onMenu(null);
              onRemove(board);
            }}
          >
            <X size={15} /> Remove from this device
          </button>
        </span>
      )}
    </a>
  );
};
