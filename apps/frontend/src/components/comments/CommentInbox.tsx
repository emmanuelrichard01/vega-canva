import React, { useMemo, useState } from 'react';
import { initialsFor } from '../../engine/presence/collaborators';
import { Check, CheckCheck, Inbox, X } from 'lucide-react';
import {
  anchorPoint,
  isUnread,
  lastMessage,
  mentionsMe,
  plainText,
  relativeTime,
  sortForInbox,
  type ReadMarks,
  type Thread,
} from '../../engine/comments/threads';
import { readMarks } from '../../engine/comments/readMarks';
import { commentView } from '../../engine/comments/commentView';

/**
 * Every thread in the workspace, in one list.
 *
 * Until this existed the only way to find a comment was to already be looking
 * at the part of an infinite canvas its pin happened to sit on — which means
 * that on a board of any size, a comment addressed to you was effectively
 * undiscoverable. That is the gap this closes; the sorting is the feature.
 *
 * Order is fixed and not user-configurable, because there is a right answer:
 * things that name you, then things that are new, then everything else by
 * recency, then resolved. See `sortForInbox`.
 */

interface CommentInboxProps {
  threads: Thread[];
  objects: Record<string, any>;
  marks: ReadMarks;
  myAuthorId: string;
  onClose: () => void;
  /** Fly the camera to a thread and open it. */
  onOpenThread: (thread: Thread) => void;
}

type Filter = 'open' | 'mine' | 'resolved';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'mine', label: 'For me' },
  { id: 'resolved', label: 'Resolved' },
];

export const CommentInbox: React.FC<CommentInboxProps> = ({
  threads,
  objects,
  marks,
  myAuthorId,
  onClose,
  onOpenThread,
}) => {
  const [filter, setFilter] = useState<Filter>('open');

  const sorted = useMemo(
    () => sortForInbox(threads, marks, myAuthorId),
    [threads, marks, myAuthorId]
  );

  const visible = useMemo(() => {
    if (filter === 'resolved') return sorted.filter((t) => t.resolved);
    if (filter === 'mine') {
      return sorted.filter(
        (t) =>
          !t.resolved &&
          (mentionsMe(t, marks, myAuthorId) ||
            t.messages.some((m) => m.authorId === myAuthorId))
      );
    }
    return sorted.filter((t) => !t.resolved);
  }, [sorted, filter, marks, myAuthorId]);

  const unreadOpen = useMemo(
    () => sorted.filter((t) => !t.resolved && isUnread(t, marks, myAuthorId)),
    [sorted, marks, myAuthorId]
  );

  return (
    <aside className="comment-inbox panel-surface" aria-label="Comments">
      <header className="comment-inbox-head">
        <span className="comment-inbox-title">
          <Inbox size={14} aria-hidden="true" />
          Comments
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {unreadOpen.length > 0 && (
            <button
              type="button"
              className="btn-icon"
              style={{ padding: 5 }}
              onClick={() => readMarks.markAllRead(unreadOpen)}
              aria-label={`Mark all ${unreadOpen.length} unread threads as read`}
              data-tooltip="Mark all read"
            >
              <CheckCheck size={14} />
            </button>
          )}
          <button
            type="button"
            className="btn-icon"
            style={{ padding: 5 }}
            onClick={onClose}
            aria-label="Close comments"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="comment-inbox-filters" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className="comment-filter"
            data-active={filter === f.id}
            onClick={() => {
              setFilter(f.id);
              // Looking at resolved threads in the list and not being able to
              // see their pins is the kind of half-state that makes a filter
              // feel broken. Selecting the tab reveals them on the canvas too.
              commentView.setShowResolved(f.id === 'resolved');
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="comment-inbox-list">
        {visible.length === 0 && (
          <p className="comment-inbox-empty">
            {filter === 'resolved'
              ? 'Nothing resolved yet.'
              : filter === 'mine'
                ? 'Nothing needs you right now.'
                : 'No open comments. Press C and click the canvas to leave one.'}
          </p>
        )}

        {visible.map((thread) => {
          const last = lastMessage(thread);
          const unread = isUnread(thread, marks, myAuthorId);
          const forMe = mentionsMe(thread, marks, myAuthorId);
          const anchor = anchorPoint(thread, thread.objectId ? objects[thread.objectId] : null);
          const opener = thread.messages[0];

          return (
            <button
              key={thread.id}
              type="button"
              className="comment-row"
              data-unread={unread || undefined}
              onClick={() => onOpenThread({ ...thread, x: anchor.x, y: anchor.y })}
            >
              <span
                className="comment-row-avatar"
                style={{ background: opener?.authorColor ?? 'var(--gray-500)' }}
                aria-hidden="true"
              >
                {initialsFor(opener?.authorName ?? '')}
              </span>

              <span className="comment-row-body">
                <span className="comment-row-meta">
                  <strong>{opener?.authorName ?? 'Unknown'}</strong>
                  {forMe && <span className="comment-row-flag">mentioned you</span>}
                  {thread.resolved && (
                    <span className="comment-row-resolved">
                      <Check size={10} aria-hidden="true" /> Resolved
                    </span>
                  )}
                  <span className="comment-row-time">
                    {relativeTime(last?.createdAt ?? thread.createdAt)}
                  </span>
                </span>
                <span className="comment-row-text">{plainText(last?.body ?? '')}</span>
                {thread.messages.length > 1 && (
                  <span className="comment-row-count">
                    {thread.messages.length} messages
                  </span>
                )}
              </span>

              {unread && <span className="comment-row-dot" aria-label="Unread" />}
            </button>
          );
        })}
      </div>
    </aside>
  );
};
