import React, { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { initialsFor } from '../engine/presence/collaborators';
import ReactDOM from 'react-dom';
import { Check, X, Send, Pencil, Trash2, CornerDownLeft } from 'lucide-react';
import { cameraSystem } from '../engine/CameraSystem';
import { engineEvents } from '../engine/EventBus';
import type { CommentThread } from '../hooks/useComments';
import {
  anchorPoint,
  isUnread,
  lastMessage,
  mentionsMe,
  relativeTime,
  type MentionCandidate,
} from '../engine/comments/threads';
import { readMarks } from '../engine/comments/readMarks';
import { commentView } from '../engine/comments/commentView';
import { useCollaborators } from '../engine/presence/useCollaborators';
import { MentionInput } from './comments/MentionInput';
import { MessageBody } from './comments/MessageBody';

interface CommentsOverlayProps {
  comments: CommentThread[];
  objects: Record<string, any>;
  onAddComment: (x: number, y: number, body: string, objectId?: string) => void;
  onAddReply: (commentId: string, text: string) => void;
  onEditMessage: (commentId: string, messageId: string, body: string) => void;
  onDeleteMessage: (commentId: string, messageId: string) => void;
  onResolveComment: (commentId: string) => void;
  currentAuthorId: string;
}

/** The expanded thread's box, used to decide which way it opens. */
const THREAD_WIDTH = 320;
const THREAD_MAX_HEIGHT = 420;
/** Keep-out band at the viewport edge. */
const EDGE_GAP = 16;

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
  const showResolved = useSyncExternalStore(
    commentView.subscribe,
    commentView.getSnapshot,
    commentView.getSnapshot
  );
  const collaborators = useCollaborators();

  /**
   * Who can be mentioned: everyone in the room right now, plus everyone who
   * has ever written in this document's comments.
   *
   * The second half matters more than the first. Comments outlive sessions —
   * the person you most want to reply to is usually the one who left the note
   * and then closed the tab, and a picker built only from live awareness
   * cannot offer them at all.
   */
  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    const byId = new Map<string, MentionCandidate>();
    for (const person of collaborators) {
      byId.set(person.clientId.toString(), {
        id: person.clientId.toString(),
        name: person.name,
        color: person.color,
      });
    }
    for (const thread of comments) {
      for (const message of thread.messages ?? []) {
        if (message.authorId === currentAuthorId) continue;
        byId.set(message.authorId, {
          id: message.authorId,
          name: message.authorName,
          color: message.authorColor,
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [collaborators, comments, currentAuthorId]);

  /** Opening a thread is what marks it read. */
  useEffect(() => {
    if (!activeCommentId) return;
    const thread = comments.find((c) => c.id === activeCommentId);
    const newest = thread ? lastMessage(thread)?.createdAt : undefined;
    if (newest) readMarks.markRead(activeCommentId, newest);
  }, [activeCommentId, comments]);

  // The inbox asks for a thread by event rather than by prop, matching how the
  // rest of the app talks across the Room/Canvas boundary (`navigateViewport`,
  // `requestEditNode`). The camera fly-to is dispatched by the inbox; this only
  // has to expand the right thread when it arrives.
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
  const expandedPanelRef = useRef<HTMLDivElement>(null);

  // A pending thread that hasn't been committed to the doc yet. Keeping the draft
  // local means an abandoned composer never leaves an empty pin behind for everyone.
  const [draft, setDraft] = useState<{ x: number; y: number; objectId?: string } | null>(null);
  const [draftText, setDraftText] = useState('');
  const draftInputRef = useRef<HTMLTextAreaElement>(null);

  // Inline message editing (author-only).
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  useEffect(() => {
    const handleCameraChange = () => setForceRender(r => r + 1);
    engineEvents.on('CameraChanged', handleCameraChange);
    return () => engineEvents.off('CameraChanged', handleCameraChange);
  }, []);

  // The CommentTool emits this when the user clicks the canvas with the tool active.
  useEffect(() => {
    const handleDraft = (payload: any) => {
      setActiveCommentId(null);
      setDraft({ x: payload.x, y: payload.y, objectId: payload.objectId });
      setDraftText('');
      setTimeout(() => draftInputRef.current?.focus(), 0);
    };
    engineEvents.on('CommentDraftRequested', handleDraft);
    return () => engineEvents.off('CommentDraftRequested', handleDraft);
  }, []);

  // Escape cancels whatever is open, innermost first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editingMessageId) setEditingMessageId(null);
      else if (draft) setDraft(null);
      else if (activeCommentId) setActiveCommentId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, activeCommentId, editingMessageId]);

  // replyText was a single field shared by every thread — switching from
  // replying in one thread to opening another left your half-typed reply
  // sitting in the new thread's box instead of the one you were actually
  // writing to.
  useEffect(() => {
    setReplyText('');
  }, [activeCommentId]);

  // Clicking anywhere outside the expanded thread (but not another pin, which
  // has its own toggle logic) closes it — matches Figma/Notion; previously
  // only Escape or the explicit X button could dismiss it.
  useEffect(() => {
    if (!activeCommentId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (expandedPanelRef.current?.contains(target)) return;
      // The pin lives in the canvas overlay and the thread is portaled above
      // the chrome, so they are no longer in one subtree. Without this, the
      // pin's own mousedown counts as "outside", closing the thread a moment
      // before its click reopens it — the toggle appears dead.
      if (target instanceof Element && target.closest('[data-comment-pin]')) return;
      setActiveCommentId(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeCommentId]);

  const commitDraft = () => {
    if (!draft || !draftText.trim()) {
      setDraft(null);
      return;
    }
    onAddComment(draft.x, draft.y, draftText.trim(), draft.objectId);
    setDraft(null);
    setDraftText('');
  };

  const submitReply = () => {
    const body = replyText.trim();
    if (!body || !activeCommentId) return;
    onAddReply(activeCommentId, body);
    setReplyText('');
  };

  const visibleComments = comments.filter(c => showResolved || !c.resolved);


  const toScreen = (wx: number, wy: number) => ({
    x: wx * cameraSystem.zoom + cameraSystem.x,
    y: wy * cameraSystem.zoom + cameraSystem.y,
  });

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40, overflow: 'hidden' }}>
      {/* The floating "Show Resolved" pill used to live here, pinned to the
          bottom-right — the same corner the comment inbox occupies, so opening
          the inbox buried it. It was also a second control for a preference
          the inbox already exposes as a filter. One control now, in the inbox,
          backed by `commentView`. */}

      {/* New-thread composer */}
      {draft && (() => {
        const s = toScreen(draft.x, draft.y);
        // Portaled for the same reason the thread is: a new comment dropped
        // near a panel opened its composer underneath that panel.
        const flip = s.x + 280 + EDGE_GAP > window.innerWidth;
        return ReactDOM.createPortal(
          <div
            style={{
              position: 'fixed',
              left: flip ? undefined : s.x,
              right: flip ? window.innerWidth - s.x : undefined,
              top: Math.min(s.y, window.innerHeight - 220),
              pointerEvents: 'auto',
              zIndex: 200,
              animation: 'popIn 180ms var(--ease-settle)',
            }}
          >
            <div
              className="panel-surface"
              style={{ width: 280, borderRadius: 12, padding: 12, boxShadow: 'var(--shadow-float)' }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 8,
                }}
              >
                New comment
              </div>
              <MentionInput
                inputRef={draftInputRef}
                value={draftText}
                onChange={setDraftText}
                onSubmit={commitDraft}
                onCancel={() => setDraft(null)}
                candidates={mentionCandidates}
                placeholder="Add a comment…  @ to mention"
                aria-label="New comment"
                rows={3}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CornerDownLeft size={11} /> to post
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => setDraft(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '6px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={commitDraft}
                    disabled={!draftText.trim()}
                    style={{
                      background: draftText.trim() ? 'var(--text-primary)' : 'var(--surface-secondary)',
                      color: draftText.trim() ? 'var(--surface-primary)' : 'var(--text-tertiary)',
                      border: 'none',
                      borderRadius: 6,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: draftText.trim() ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Send size={12} /> Post
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {visibleComments.map(comment => {
        // Rotation-aware, so a pin stays on the corner of a rotated object
        // instead of hanging in the air where that corner used to be.
        const world = anchorPoint(
          comment,
          comment.objectId ? objects[comment.objectId] : null
        );
        const s = toScreen(world.x, world.y);

        const unread = isUnread(comment, marks, currentAuthorId);
        const forMe = mentionsMe(comment, marks, currentAuthorId);
        const isExpanded = activeCommentId === comment.id;

        // Which way the thread opens. Pinned below-right of the pin by
        // default, but a comment near the right edge — which is exactly where
        // people leave comments, because that is where the work is — opened a
        // 320px panel straight off the screen with no way to read or scroll
        // it. Same failure the cursor name chips had, same fix: flip across
        // the anchor rather than clamp, so the panel stays attached to its pin.
        const flipX = s.x + THREAD_WIDTH + EDGE_GAP > window.innerWidth;
        const flipY = s.y + THREAD_MAX_HEIGHT + EDGE_GAP > window.innerHeight;

        // The thread's identity color comes from whoever started it, so you can tell
        // at a glance whose comment a pin belongs to without opening it.
        // Falls back to the accent when an author left no presence colour —
        // the role rather than the palette value behind it, so a theme
        // change cannot leave this one thread a different orange.
        const threadColor = comment.messages?.[0]?.authorColor || 'var(--text-accent)';
        const threadAuthor = comment.messages?.[0]?.authorName || 'Unknown';

        return (
          <div
            key={comment.id}
            style={{
              position: 'absolute',
              left: s.x,
              top: s.y,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'auto',
              zIndex: isExpanded ? 100 : 50,
            }}
          >
            {/* Collapsed pin — author-colored, with avatar initials */}
            <button
              data-comment-pin={comment.id}
              onClick={() => setActiveCommentId(isExpanded ? null : comment.id)}
              title={`${threadAuthor} · ${comment.messages?.length || 0} message${(comment.messages?.length || 0) === 1 ? '' : 's'}${unread ? ' · unread' : ''}`}
              aria-label={`${forMe ? 'You were mentioned. ' : ''}${unread ? 'Unread thread' : 'Thread'} by ${threadAuthor}, ${comment.messages?.length || 0} messages`}
              style={{
                position: 'relative',
                background: 'var(--surface-elevated)',
                border: `2px solid ${threadColor}`,
                borderRadius: '16px 16px 16px 4px',
                padding: '3px 8px 3px 3px',
                // An unread thread carries a ring in the accent colour. Colour
                // alone would be the only signal, so the dot below repeats it
                // as a shape — the pin is already author-coloured, and "which
                // shade of border is this" is not a distinction anyone can make
                // across a board.
                boxShadow: unread
                  ? `0 0 0 3px var(--surface-primary), 0 0 0 5px ${
                      forMe ? 'var(--text-accent)' : threadColor
                    }, var(--shadow-md)`
                  : isExpanded
                    ? 'var(--shadow-float)'
                    : 'var(--shadow-md)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--text-primary)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'transform var(--motion-hover), box-shadow var(--motion-hover)',
                transform: isExpanded ? 'scale(1.08) translateY(-2px)' : 'scale(1)',
                opacity: comment.resolved ? 0.55 : 1,
              }}
            >
              {unread && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: forMe ? 'var(--text-accent)' : threadColor,
                    border: '2px solid var(--surface-elevated)',
                  }}
                />
              )}
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: threadColor,
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {initialsFor(threadAuthor)}
              </span>
              <span>{comment.messages?.length || 0}</span>
            </button>

            {/* Expanded thread.
                Portaled to <body>, not rendered inside the pin. The comments
                overlay sits at z-index 40 *inside* the canvas, beneath both
                side panels — so an open thread anywhere near the left or right
                edge rendered underneath the Layers or Properties column and
                could not be read or typed into. It is also clipped by the
                overlay's own `overflow: hidden`. An open thread is a focused,
                transient surface; it belongs above the chrome, and the pins
                stay below it where they belong. */}
            {isExpanded &&
              ReactDOM.createPortal(
                <div
                  ref={expandedPanelRef}
                  className="panel-surface"
                  style={{
                    position: 'fixed',
                    left: flipX ? undefined : s.x,
                    right: flipX ? window.innerWidth - s.x : undefined,
                    top: flipY ? undefined : s.y + 26,
                    bottom: flipY ? window.innerHeight - s.y + 26 : undefined,
                    width: THREAD_WIDTH,
                    maxHeight: THREAD_MAX_HEIGHT,
                    overflowY: 'auto',
                    zIndex: 200,
                    borderRadius: 12,
                    padding: 14,
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    fontFamily: 'var(--font-sans)',
                    boxShadow: 'var(--shadow-overlay)',
                    animation: 'popIn 180ms var(--ease-settle)',
                  }}
                >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 12,
                    paddingBottom: 10,
                    borderBottom: '1px solid var(--border-divider)',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Thread</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {!comment.resolved ? (
                      <button
                        onClick={() => {
                          onResolveComment(comment.id);
                          setActiveCommentId(null);
                        }}
                        style={{
                          // The accent pair. This was `--amber-500` with white
                          // on it, which is 2.15:1 — unreadable, and a raw
                          // palette primitive where a role belongs.
                          background: 'var(--accent)',
                          border: 'none',
                          color: 'var(--accent-on)',
                          borderRadius: 6,
                          padding: '4px 8px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                        title="Mark as resolved"
                      >
                        <Check size={12} /> Resolve
                      </button>
                    ) : (
                      <button
                        onClick={() => onResolveComment(comment.id)}
                        style={{
                          color: 'var(--text-accent)',
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '4px 8px',
                          background: 'var(--surface-hover)',
                          borderRadius: 6,
                          border: 'none',
                          cursor: 'pointer',
                        }}
                        title="Reopen thread"
                      >
                        Reopen
                      </button>
                    )}
                    <button
                      onClick={() => setActiveCommentId(null)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'flex' }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {comment.messages && comment.messages.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      marginBottom: 14,
                      maxHeight: 240,
                      overflowY: 'auto',
                      paddingRight: 4,
                    }}
                    className="custom-scrollbar"
                  >
                    {comment.messages.map(msg => {
                      const isMine = msg.authorId === currentAuthorId;
                      const isEditingThis = editingMessageId === msg.id;

                      return (
                        <div
                          key={msg.id}
                          style={{
                            background: 'var(--surface-hover)',
                            borderRadius: 8,
                            padding: '10px 12px',
                            // A subtle left rule in the author's color makes it scannable
                            // who said what without reading every name.
                            borderLeft: `3px solid ${msg.authorColor}`,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              marginBottom: 6,
                              fontSize: 11,
                              color: 'var(--text-tertiary)',
                            }}
                          >
                            <div
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: '50%',
                                background: msg.authorColor,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                fontSize: 8,
                                color: 'white',
                                flexShrink: 0,
                              }}
                            >
                              {initialsFor(msg.authorName)}
                            </div>
                            <span style={{ color: msg.authorColor, fontWeight: 600 }}>
                              {msg.authorName}
                              {isMine && <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}> (you)</span>}
                            </span>
                            <span title={new Date(msg.createdAt).toLocaleString()}>
                              · {relativeTime(msg.createdAt)}
                            </span>
                            {(msg as any).editedAt && (
                              <span style={{ fontStyle: 'italic' }}>· edited</span>
                            )}

                            {/* Author-only controls */}
                            {isMine && !isEditingThis && (
                              <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                                <button
                                  onClick={() => {
                                    setEditingMessageId(msg.id);
                                    setEditingText(msg.body);
                                  }}
                                  title="Edit your message"
                                  style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'flex', padding: 2 }}
                                >
                                  <Pencil size={11} />
                                </button>
                                <button
                                  onClick={() => onDeleteMessage(comment.id, msg.id)}
                                  title="Delete your message"
                                  style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'flex', padding: 2 }}
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            )}
                          </div>

                          {isEditingThis ? (
                            <div>
                              <textarea
                                value={editingText}
                                onChange={e => setEditingText(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    if (editingText.trim()) onEditMessage(comment.id, msg.id, editingText.trim());
                                    setEditingMessageId(null);
                                  }
                                }}
                                rows={2}
                                autoFocus
                                style={{
                                  width: '100%',
                                  resize: 'none',
                                  background: 'var(--surface-primary)',
                                  border: '1px solid var(--border-divider)',
                                  borderRadius: 6,
                                  padding: '6px 8px',
                                  color: 'var(--text-primary)',
                                  fontSize: 13,
                                  fontFamily: 'Inter, sans-serif',
                                  outline: 'none',
                                }}
                              />
                              <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                                <button
                                  onClick={() => setEditingMessageId(null)}
                                  style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => {
                                    if (editingText.trim()) onEditMessage(comment.id, msg.id, editingText.trim());
                                    setEditingMessageId(null);
                                  }}
                                  style={{
                                    background: 'var(--text-primary)',
                                    color: 'var(--surface-primary)',
                                    border: 'none',
                                    borderRadius: 6,
                                    padding: '4px 10px',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ color: 'var(--text-secondary)' }}>
                              <MessageBody body={msg.body} myAuthorId={currentAuthorId} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <MentionInput
                      value={replyText}
                      onChange={setReplyText}
                      onSubmit={submitReply}
                      candidates={mentionCandidates}
                      placeholder="Reply…  @ to mention"
                      aria-label="Reply to thread"
                      rows={2}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={submitReply}
                    disabled={!replyText.trim()}
                    aria-label="Send reply"
                    style={{
                      background: replyText.trim() ? 'var(--text-primary)' : 'var(--surface-secondary)',
                      border: 'none',
                      borderRadius: 8,
                      padding: '8px 12px',
                      color: replyText.trim() ? 'var(--surface-primary)' : 'var(--text-tertiary)',
                      cursor: replyText.trim() ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Send size={14} />
                  </button>
                </div>
                </div>,
                document.body
              )}
          </div>
        );
      })}
    </div>
  );
};
