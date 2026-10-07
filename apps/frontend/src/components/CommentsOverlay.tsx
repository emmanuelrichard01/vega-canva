import React, { useCallback, useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom';
import { Check, ChevronDown, ChevronUp, RotateCcw, Pencil, Trash2, X, ArrowUp } from 'lucide-react';
import { initialsFor } from '../engine/presence/collaborators';
import { contrastInk } from '../engine/model/color';
import { cameraSystem } from '../engine/CameraSystem';
import { engineEvents } from '../engine/EventBus';
import { useComments, type CommentThread } from '../hooks/useComments';
import {
  anchorPoint,
  isUnread,
  lastMessage,
  mentionsMe,
  messageReactions,
  relativeTime,
  type MentionCandidate,
} from '../engine/comments/threads';
import { readMarks } from '../engine/comments/readMarks';
import { commentView } from '../engine/comments/commentView';
import { useCollaborators } from '../engine/presence/useCollaborators';
import { liveTransformStore } from '../engine/model/liveTransformStore';
import { canPostComments, getRoomRole, subscribeRoomRole } from '../engine/model/permissions';
import { MentionInput } from './comments/MentionInput';
import { EmojiPicker } from './comments/EmojiPicker';
import { MessageBody } from './comments/MessageBody';
import './comments/comments.css';

interface CommentsOverlayProps {
  comments: CommentThread[];
  objects: Record<string, any>;
  onAddComment: (x: number, y: number, body: string, objectId?: string, anchor?: { u: number; v: number }) => void;
  onAddReply: (commentId: string, text: string) => void;
  onEditMessage: (commentId: string, messageId: string, body: string) => void;
  onDeleteMessage: (commentId: string, messageId: string) => void;
  onResolveComment: (commentId: string) => void;
  currentAuthorId: string;
}

/** The thread card's box, used to decide which way it opens. */
const CARD_WIDTH = 336;
const CARD_MAX_HEIGHT = 480;
const COMPOSER_WIDTH = 300;
/** Keep-out band at the viewport edge. */
const EDGE_GAP = 16;

/** Reactions offered in one click; the picker covers the rest. */
const QUICK_REACTIONS = ['👍', '❤️', '🎉', '👀'];

interface Draft {
  x: number;
  y: number;
  objectId?: string;
  anchor?: { u: number; v: number };
}

/**
 * Re-render when any anchored object is mid-gesture.
 *
 * During a drag the document is deliberately stale (see `liveTransformStore`),
 * so a pin reading only the committed position would stay behind and jump on
 * release. Subscribing per anchored id keeps the pin on its object while it
 * moves.
 */
function useLiveAnchors(ids: readonly string[]): number {
  const versionRef = useRef(0);
  const key = ids.join('|');
  // Re-created when the anchored set changes, which re-subscribes.
  const subscribe = useCallback(
    (notify: () => void) => {
      const offs = key
        ? key.split('|').map((id) =>
            liveTransformStore.subscribe(id, () => {
              versionRef.current += 1;
              notify();
            })
          )
        : [];
      return () => offs.forEach((off) => off());
    },
    [key]
  );
  const read = useCallback(() => versionRef.current, []);
  return useSyncExternalStore(subscribe, read, read);
}

function useRole() {
  return useSyncExternalStore(subscribeRoomRole, getRoomRole, getRoomRole);
}

function Avatar({ name, color, small }: { name: string; color: string; small?: boolean }) {
  return (
    <span
      className={small ? 'cmt-avatar cmt-avatar--sm' : 'cmt-avatar'}
      // Data-driven: each person's presence colour.
      style={{ background: color, color: contrastInk(color) }}
      aria-hidden="true"
    >
      {initialsFor(name)}
    </span>
  );
}

export const CommentsOverlay: React.FC<CommentsOverlayProps> = ({
  comments,
  objects,
  onAddComment,
  onAddReply,
  onEditMessage,
  onDeleteMessage,
  onResolveComment,
  currentAuthorId,
}) => {
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const marks = useSyncExternalStore(readMarks.subscribe, readMarks.getSnapshot, readMarks.getSnapshot);
  const showResolved = useSyncExternalStore(commentView.subscribe, commentView.getSnapshot, commentView.getSnapshot);
  const collaborators = useCollaborators();
  const { toggleMessageReaction } = useComments();
  useRole();
  const canWrite = canPostComments();

  /**
   * Who can be mentioned: everyone in the room now, plus everyone who has
   * written in this board's comments. Comments outlive sessions, and the
   * person you most want to reply to has often closed the tab.
   */
  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    const byId = new Map<string, MentionCandidate>();
    for (const person of collaborators) {
      byId.set(person.id, { id: person.id, name: person.name, color: person.color });
    }
    for (const thread of comments) {
      for (const message of thread.messages ?? []) {
        if (message.authorId === currentAuthorId) continue;
        byId.set(message.authorId, { id: message.authorId, name: message.authorName, color: message.authorColor });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [collaborators, comments, currentAuthorId]);

  const nameOf = useMemo(() => {
    const names = new Map<string, string>();
    for (const c of mentionCandidates) names.set(c.id, c.name);
    return (id: string) => (id === currentAuthorId ? 'You' : names.get(id) ?? 'Someone');
  }, [mentionCandidates, currentAuthorId]);

  /** Opening a thread is what marks it read. */
  useEffect(() => {
    if (!activeCommentId) return;
    const thread = comments.find((c) => c.id === activeCommentId);
    const newest = thread ? lastMessage(thread)?.createdAt : undefined;
    if (newest) readMarks.markRead(activeCommentId, newest);
  }, [activeCommentId, comments]);

  // The inbox asks for a thread by event; the camera fly-to is its own.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      setDraft(null);
      setActiveCommentId(id);
    };
    window.addEventListener('focusCommentThread', onFocus);
    return () => window.removeEventListener('focusCommentThread', onFocus);
  }, []);

  const [replyText, setReplyText] = useState('');
  const [, setForceRender] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  // A thread that hasn't been written yet. Kept local, so an abandoned
  // composer never leaves an empty pin behind for everyone.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftText, setDraftText] = useState('');
  // One insert hook per composer: the new-thread box and the reply box have
  // separate carets.
  const draftInsert = useRef<((text: string) => void) | null>(null);
  const replyInsert = useRef<((text: string) => void) | null>(null);
  const draftInputRef = useRef<HTMLTextAreaElement>(null);

  // Inline editing of one's own message.
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  useEffect(() => {
    const handleCameraChange = () => setForceRender((r) => r + 1);
    engineEvents.on('CameraChanged', handleCameraChange);
    return () => engineEvents.off('CameraChanged', handleCameraChange);
  }, []);

  // The Comment tool (and "Comment" in the context menu) ask for a composer.
  useEffect(() => {
    const handleDraft = (payload: any) => {
      if (!canPostComments()) return;
      setActiveCommentId(null);
      setDraft({ x: payload.x, y: payload.y, objectId: payload.objectId, anchor: payload.anchor });
      setDraftText('');
      setTimeout(() => draftInputRef.current?.focus(), 0);
    };
    engineEvents.on('CommentDraftRequested', handleDraft);
    return () => engineEvents.off('CommentDraftRequested', handleDraft);
  }, []);

  // A half-typed reply belongs to the thread it was typed in.
  useEffect(() => {
    setReplyText('');
    setEditingMessageId(null);
  }, [activeCommentId]);

  // A click outside the open card (and not on a pin, which toggles itself)
  // closes it.
  useEffect(() => {
    if (!activeCommentId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (cardRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-comment-pin], .emoji-picker, .mention-picker')) return;
      setActiveCommentId(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeCommentId]);

  const visibleComments = useMemo(
    () => comments.filter((c) => showResolved || !c.resolved),
    [comments, showResolved]
  );

  const anchoredIds = useMemo(
    () => visibleComments.map((c) => c.objectId).filter((id): id is string => Boolean(id)),
    [visibleComments]
  );
  useLiveAnchors(anchoredIds);

  /** A thread's pin, in world space, following its object through a gesture. */
  const worldPointOf = (thread: CommentThread) => {
    const object = thread.objectId ? objects[thread.objectId] : null;
    if (!object) return anchorPoint(thread, null);
    const live = liveTransformStore.get(object.id);
    return anchorPoint(thread, {
      x: live?.x ?? object.x,
      y: live?.y ?? object.y,
      width: live?.width ?? object.width * Math.abs(object.scaleX || 1),
      height: live?.height ?? object.height * Math.abs(object.scaleY || 1),
      rotation: live?.rotation ?? object.rotation ?? 0,
    });
  };

  /** Threads in reading order of their pins, for Alt+↑/↓. */
  const ordered = useMemo(() => {
    return [...visibleComments]
      .map((t) => ({ t, p: worldPointOf(t) }))
      .sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x || (a.t.id < b.t.id ? -1 : 1))
      .map(({ t }) => t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reading order from committed positions is enough here
  }, [visibleComments, objects]);

  const goToThread = (step: 1 | -1) => {
    if (ordered.length === 0) return;
    const index = ordered.findIndex((t) => t.id === activeCommentId);
    const next = ordered[(index + step + ordered.length) % ordered.length];
    const p = worldPointOf(next);
    window.dispatchEvent(
      new CustomEvent('navigateViewport', { detail: { x: p.x, y: p.y, zoom: cameraSystem.zoom } })
    );
    setActiveCommentId(next.id);
  };

  // Escape closes innermost-first; Alt+↑/↓ walks threads while one is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingMessageId) setEditingMessageId(null);
        else if (draft) setDraft(null);
        else if (activeCommentId) setActiveCommentId(null);
        return;
      }
      if (activeCommentId && e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        e.stopPropagation();
        goToThread(e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const commitDraft = () => {
    if (!draft || !draftText.trim()) {
      setDraft(null);
      return;
    }
    onAddComment(draft.x, draft.y, draftText.trim(), draft.objectId, draft.anchor);
    setDraft(null);
    setDraftText('');
  };

  const submitReply = () => {
    const body = replyText.trim();
    if (!body || !activeCommentId) return;
    onAddReply(activeCommentId, body);
    setReplyText('');
  };

  const toScreen = (wx: number, wy: number) => ({
    x: wx * cameraSystem.zoom + cameraSystem.x,
    y: wy * cameraSystem.zoom + cameraSystem.y,
  });

  /**
   * Viewport position for a portaled surface opening from a pin.
   *
   * The overlay is offset from the viewport by the stage's origin (header,
   * rulers), so the screen point is translated by that rect before it is used
   * as `position: fixed` coordinates. The card flips across the anchor rather
   * than clamping, so it stays attached to its pin near an edge.
   */
  const placeFrom = (s: { x: number; y: number }, width: number, height: number) => {
    const host = document.querySelector('.konvajs-content')?.getBoundingClientRect();
    const vx = s.x + (host?.left ?? 0);
    const vy = s.y + (host?.top ?? 0);
    const flipX = vx + width + EDGE_GAP > window.innerWidth;
    const flipY = vy + height + EDGE_GAP > window.innerHeight;
    return {
      left: flipX ? undefined : vx + 8,
      right: flipX ? window.innerWidth - vx + 8 : undefined,
      top: flipY ? undefined : Math.max(EDGE_GAP, vy - 12),
      bottom: flipY ? Math.max(EDGE_GAP, window.innerHeight - vy - 12) : undefined,
    };
  };

  const activeThread = activeCommentId ? comments.find((c) => c.id === activeCommentId) ?? null : null;

  return (
    <div className="cmt-layer">
      {draft &&
        ReactDOM.createPortal(
          <div
            className="cmt-composer"
            role="dialog"
            aria-label="New comment"
            // Placement is data-driven.
            style={placeFrom(toScreen(draft.x, draft.y), COMPOSER_WIDTH, 200)}
          >
            <MentionInput
              inputRef={draftInputRef}
              insertRef={draftInsert}
              value={draftText}
              onChange={setDraftText}
              onSubmit={commitDraft}
              onCancel={() => setDraft(null)}
              candidates={mentionCandidates}
              placeholder={draft.objectId ? 'Comment on this…' : 'Add a comment…'}
              aria-label="New comment"
            />
            <div className="cmt-composer__foot">
              <span className="cmt-hint">
                <EmojiPicker onPick={(char) => draftInsert.current?.(char)} placement="down" />
                <span>@ to mention</span>
              </span>
              <span className="cmt-hint">
                <button type="button" className="cmt-btn" onClick={() => setDraft(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="cmt-btn cmt-btn--primary"
                  onClick={commitDraft}
                  disabled={!draftText.trim()}
                >
                  Post
                </button>
              </span>
            </div>
          </div>,
          document.body
        )}

      {visibleComments.map((comment) => {
        const world = worldPointOf(comment);
        const s = toScreen(world.x, world.y);
        const unread = isUnread(comment, marks, currentAuthorId);
        const forMe = mentionsMe(comment, marks, currentAuthorId);
        const isOpen = activeCommentId === comment.id;
        const first = comment.messages?.[0];
        const author = first?.authorName || 'Unknown';
        const color = first?.authorColor || 'var(--text-secondary)';
        const count = comment.messages?.length || 0;

        return (
          <div
            key={comment.id}
            className="cmt-pin-anchor"
            data-open={isOpen}
            // Position is data-driven.
            style={{ left: s.x, top: s.y }}
          >
            <button
              type="button"
              className="cmt-pin"
              data-comment-pin={comment.id}
              data-open={isOpen}
              data-resolved={comment.resolved}
              onClick={() => setActiveCommentId(isOpen ? null : comment.id)}
              aria-expanded={isOpen}
              aria-label={`${forMe ? 'You were mentioned. ' : ''}${unread ? 'Unread thread' : 'Thread'} by ${author}, ${count} ${count === 1 ? 'message' : 'messages'}${comment.resolved ? ', resolved' : ''}`}
              title={`${author} · ${relativeTime(lastMessage(comment)?.createdAt ?? comment.createdAt)}`}
            >
              {unread && <span className="cmt-pin__unread" data-for-me={forMe} aria-hidden="true" />}
              <Avatar name={author} color={color} />
              <span>{count}</span>
            </button>
          </div>
        );
      })}

      {activeThread &&
        ReactDOM.createPortal(
          (() => {
            const s = toScreen(worldPointOf(activeThread).x, worldPointOf(activeThread).y);
            const replies = Math.max(0, (activeThread.messages?.length || 0) - 1);
            return (
              <div
                ref={cardRef}
                className="cmt-card"
                role="dialog"
                aria-label={`Comment thread by ${activeThread.messages?.[0]?.authorName ?? 'Unknown'}`}
                style={placeFrom(s, CARD_WIDTH, CARD_MAX_HEIGHT)}
              >
                <div className="cmt-card__head">
                  <div className="cmt-card__title">
                    {activeThread.resolved ? 'Resolved' : 'Comment'}{' '}
                    <span>
                      · {replies} {replies === 1 ? 'reply' : 'replies'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="cmt-icon-btn"
                    onClick={() => goToThread(-1)}
                    disabled={ordered.length < 2}
                    aria-label="Previous thread"
                    title="Previous thread (Alt+↑)"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    className="cmt-icon-btn"
                    onClick={() => goToThread(1)}
                    disabled={ordered.length < 2}
                    aria-label="Next thread"
                    title="Next thread (Alt+↓)"
                  >
                    <ChevronDown size={16} />
                  </button>
                  {canWrite && (
                    <button
                      type="button"
                      className="cmt-icon-btn"
                      onClick={() => {
                        onResolveComment(activeThread.id);
                        if (!activeThread.resolved && !showResolved) setActiveCommentId(null);
                      }}
                      aria-label={activeThread.resolved ? 'Reopen thread' : 'Resolve thread'}
                      title={activeThread.resolved ? 'Reopen' : 'Resolve'}
                    >
                      {activeThread.resolved ? <RotateCcw size={15} /> : <Check size={16} />}
                    </button>
                  )}
                  <button
                    type="button"
                    className="cmt-icon-btn"
                    onClick={() => setActiveCommentId(null)}
                    aria-label="Close thread"
                    title="Close (Esc)"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="cmt-card__body custom-scrollbar">
                  {activeThread.messages.map((msg) => {
                    const isMine = msg.authorId === currentAuthorId;
                    const isEditing = editingMessageId === msg.id;
                    const reactions = messageReactions(activeThread.reactions, msg.id);
                    return (
                      <div key={msg.id} className="cmt-msg">
                        <Avatar name={msg.authorName} color={msg.authorColor} small />
                        <div>
                          <div className="cmt-msg__meta">
                            <span className="cmt-msg__name">{isMine ? 'You' : msg.authorName}</span>
                            <span title={new Date(msg.createdAt).toLocaleString()}>{relativeTime(msg.createdAt)}</span>
                            {msg.editedAt && <span>· edited</span>}
                          </div>

                          {isEditing ? (
                            <>
                              <textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    if (editingText.trim()) onEditMessage(activeThread.id, msg.id, editingText.trim());
                                    setEditingMessageId(null);
                                  }
                                }}
                                rows={2}
                                autoFocus
                                aria-label="Edit message"
                                className="comment-edit-field"
                              />
                              <div className="cmt-msg__edit-row">
                                <button type="button" className="cmt-btn" onClick={() => setEditingMessageId(null)}>
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="cmt-btn cmt-btn--primary"
                                  disabled={!editingText.trim()}
                                  onClick={() => {
                                    if (editingText.trim()) onEditMessage(activeThread.id, msg.id, editingText.trim());
                                    setEditingMessageId(null);
                                  }}
                                >
                                  Save
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="cmt-msg__text">
                              <MessageBody body={msg.body} myAuthorId={currentAuthorId} />
                            </div>
                          )}

                          {(reactions.length > 0 || canWrite) && !isEditing && (
                            <div className="cmt-reactions">
                              {reactions.map(({ emoji, authorIds }) => {
                                const mine = authorIds.includes(currentAuthorId);
                                const who = authorIds.map(nameOf).join(', ');
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className="cmt-reaction"
                                    aria-pressed={mine}
                                    disabled={!canWrite}
                                    onClick={() => toggleMessageReaction(activeThread.id, msg.id, emoji)}
                                    title={who}
                                    aria-label={`${emoji} ${authorIds.length}, from ${who}`}
                                  >
                                    <span className="cmt-reaction__emoji">{emoji}</span>
                                    {authorIds.length}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {canWrite && !isEditing && (
                          <div className="cmt-msg__actions">
                            {QUICK_REACTIONS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                className="cmt-icon-btn"
                                onClick={() => toggleMessageReaction(activeThread.id, msg.id, emoji)}
                                aria-label={`React with ${emoji}`}
                              >
                                <span className="cmt-reaction__emoji">{emoji}</span>
                              </button>
                            ))}
                            <EmojiPicker
                              onPick={(char) => toggleMessageReaction(activeThread.id, msg.id, char)}
                              placement="down"
                            />
                            {isMine && (
                              <>
                                <button
                                  type="button"
                                  className="cmt-icon-btn"
                                  onClick={() => {
                                    setEditingMessageId(msg.id);
                                    setEditingText(msg.body);
                                  }}
                                  aria-label="Edit your message"
                                  title="Edit"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="cmt-icon-btn"
                                  onClick={() => onDeleteMessage(activeThread.id, msg.id)}
                                  aria-label="Delete your message"
                                  title="Delete"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {canWrite ? (
                  <div className="cmt-card__foot">
                    <div className="cmt-grow">
                      <MentionInput
                        value={replyText}
                        onChange={setReplyText}
                        insertRef={replyInsert}
                        onSubmit={submitReply}
                        candidates={mentionCandidates}
                        placeholder="Reply…"
                        aria-label="Reply to thread"
                        rows={1}
                      />
                    </div>
                    <EmojiPicker onPick={(char) => replyInsert.current?.(char)} placement="up" />
                    <button
                      type="button"
                      className="cmt-btn cmt-btn--primary"
                      onClick={submitReply}
                      disabled={!replyText.trim()}
                      aria-label="Send reply"
                    >
                      <ArrowUp size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="cmt-readonly">You can read comments on this board but not reply.</div>
                )}
              </div>
            );
          })(),
          document.body
        )}
    </div>
  );
};

