import React, { useMemo, useRef } from 'react';
import { Pin } from 'lucide-react';
import { WorkspaceCover } from '../WorkspaceCover';
import { loadPreview } from '../../engine/model/boardPreview';
import { whenOpened, type ShelfBoard } from '../../engine/room/boardShelf';
import { presenceLine, type BoardStatus } from './library';

interface Props {
  boards: readonly ShelfBoard[];
  statusOf: (id: string) => BoardStatus | undefined;
  pinned: ReadonlySet<string>;
  onOpen: (board: ShelfBoard, cover: HTMLElement | null) => void;
}

/**
 * The two or three boards opened most recently, larger, at the top.
 *
 * Most visits to the library are on the way back into something already
 * started, so the shortest path there gets the biggest pictures. Each card is
 * a plain link — the full set of actions lives on the same board in the grid
 * below — and the roving id is prefixed so arrow keys can tell the two apart.
 */
export const ContinueStrip: React.FC<Props> = ({ boards, statusOf, pinned, onOpen }) => {
  if (boards.length === 0) return null;
  return (
    <section className="lcont" aria-labelledby="lcont-title">
      <h2 className="lcont__title" id="lcont-title">Continue where you left off</h2>
      <div className="lcont__row">
        {boards.map((board) => (
          <ContinueCard key={board.id} board={board} status={statusOf(board.id)} pinned={pinned.has(board.id)} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
};

const ContinueCard: React.FC<{
  board: ShelfBoard;
  status?: BoardStatus;
  pinned: boolean;
  onOpen: Props['onOpen'];
}> = ({ board, status, pinned, onOpen }) => {
  const preview = useMemo(() => loadPreview(board.id), [board.id]);
  const artRef = useRef<HTMLDivElement>(null);
  const live = status ? presenceLine(status) : null;
  const metaId = `lcont-meta-${board.id}`;
  return (
    <article className="lcont__card" data-cell>
      <div className="lcont__art" ref={artRef}>
        <WorkspaceCover workspaceId={board.id} name={board.name} preview={preview} />
        {pinned && (
          <span className="bcard__pinbadge" role="img" aria-label="Pinned">
            <Pin size={12} aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="lcont__body">
        <a
          className="lcont__link"
          href={`/room/${board.id}`}
          data-roving={`continue:${board.id}`}
          aria-describedby={metaId}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            onOpen(board, artRef.current);
          }}
        >
          {board.name}
        </a>
        <p className="lcont__meta" id={metaId}>
          <span>Opened {whenOpened(board.lastAccessed)}</span>
          {live && (
            <span className="lcont__live">
              <span className="bcard__live-dot" aria-hidden="true" />
              {live}
            </span>
          )}
        </p>
      </div>
    </article>
  );
};
