import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Check, X, Send, Pencil, Trash2, CornerDownLeft } from 'lucide-react';
import { cameraSystem } from '../engine/CameraSystem';
import { engineEvents } from '../engine/EventBus';
import type { CommentThread } from '../hooks/useComments';

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

/** Initials for an avatar chip, e.g. "Dev E" -> "DE". */
const initialsOf = (name?: string) =>
  (name || 'U')
    .split(' ')
    .map(p => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

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
  const [replyText, setReplyText] = useState('');
  const [, setForceRender] = useState(0);
  const [showResolved, setShowResolved] = useState(false);
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
      if (expandedPanelRef.current && !expandedPanelRef.current.contains(e.target as Node)) {
        setActiveCommentId(null);
      }
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

  const visibleComments = comments.filter(c => showResolved || !c.resolved);

  const toScreen = (wx: number, wy: number) => ({
    x: wx * cameraSystem.zoom + cameraSystem.x,
    y: wy * cameraSystem.zoom + cameraSystem.y,
  });

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40, overflow: 'hidden' }}>
      {/* Show Resolved Toggle */}
      {comments.some(c => c.resolved) && (
        <div style={{ position: 'absolute', bottom: 24, right: 280, pointerEvents: 'auto' }}>
          <button
            onClick={() => setShowResolved(!showResolved)}
            className="panel-surface"
            style={{
              padding: '8px 16px',
              color: 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderRadius: 20,
              transition: 'var(--motion-hover)',
            }}
          >
            {showResolved ? <Check size={14} /> : <MessageSquare size={14} />}
            {showResolved ? 'Hide Resolved' : 'Show Resolved'}
          </button>
        </div>
      )}

      {/* New-thread composer */}
      {draft && (() => {
        const s = toScreen(draft.x, draft.y);
        return (
          <div
            style={{
              position: 'absolute',
              left: s.x,
              top: s.y,
              pointerEvents: 'auto',
              zIndex: 120,
              animation: 'popIn 180ms cubic-bezier(0.175, 0.885, 0.32, 1.275)',
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
              <textarea
                ref={draftInputRef}
                value={draftText}
                onChange={e => setDraftText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    commitDraft();
                  }
                }}
                placeholder="Add a comment…"
                rows={3}
                style={{
                  width: '100%',
                  resize: 'none',
                  background: 'var(--surface-secondary)',
                  border: '1px solid var(--border-divider)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  fontFamily: 'Inter, sans-serif',
                  outline: 'none',
                }}
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
          </div>
        );
      })()}

      {visibleComments.map(comment => {
        let worldX = comment.x;
        let worldY = comment.y;

        if (comment.objectId && objects[comment.objectId]) {
          const targetObj = objects[comment.objectId];
          worldX = targetObj.x + targetObj.width;
          worldY = targetObj.y;
        }

        const s = toScreen(worldX, worldY);
        const isExpanded = activeCommentId === comment.id;

        // The thread's identity color comes from whoever started it, so you can tell
        // at a glance whose comment a pin belongs to without opening it.
        const threadColor = comment.messages?.[0]?.authorColor || 'var(--amber-500)';
        const threadAuthor = comment.messages?.[0]?.authorName || 'Unknown';

        return (
          <div
            key={comment.id}
            // Attached only while expanded: keeps the pin's own toggle click
            // "inside" the ref'd region so the outside-click handler doesn't
            // race the button's onClick and immediately reopen what it just closed.
            ref={isExpanded ? expandedPanelRef : undefined}
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
              onClick={() => setActiveCommentId(isExpanded ? null : comment.id)}
              title={`${threadAuthor} · ${comment.messages?.length || 0} message${(comment.messages?.length || 0) === 1 ? '' : 's'}`}
              style={{
                background: 'var(--surface-elevated)',
                border: `2px solid ${threadColor}`,
                borderRadius: '16px 16px 16px 4px',
                padding: '3px 8px 3px 3px',
                boxShadow: isExpanded ? 'var(--shadow-float)' : 'var(--shadow-md)',
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
                {initialsOf(threadAuthor)}
              </span>
              <span>{comment.messages?.length || 0}</span>
            </button>

            {/* Expanded thread */}
            {isExpanded && (
              <div
                className="panel-surface"
                style={{
                  position: 'absolute',
                  top: 40,
                  left: 0,
                  width: 320,
                  borderRadius: 12,
                  padding: 14,
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  fontFamily: 'Inter, sans-serif',
                  boxShadow: 'var(--shadow-float)',
                  animation: 'popIn 180ms cubic-bezier(0.175, 0.885, 0.32, 1.275)',
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
                          background: 'var(--amber-500)',
                          border: 'none',
                          color: 'white',
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
                          color: 'var(--amber-500)',
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
                              {initialsOf(msg.authorName)}
                            </div>
                            <span style={{ color: msg.authorColor, fontWeight: 600 }}>
                              {msg.authorName}
                              {isMine && <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}> (you)</span>}
                            </span>
                            <span>
                              · {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                            <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{msg.body}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <form
                  onSubmit={e => {
                    e.preventDefault();
                    if (!replyText.trim()) return;
                    onAddReply(comment.id, replyText.trim());
                    setReplyText('');
                  }}
                  style={{ display: 'flex', gap: 8 }}
                >
                  <input
                    type="text"
                    placeholder="Reply…"
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    style={{
                      flex: 1,
                      background: 'var(--surface-secondary)',
                      border: '1px solid var(--border-divider)',
                      borderRadius: 8,
                      padding: '8px 12px',
                      color: 'var(--text-primary)',
                      fontSize: 13,
                      outline: 'none',
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      background: 'var(--text-primary)',
                      border: 'none',
                      borderRadius: 8,
                      padding: '8px 12px',
                      color: 'var(--surface-primary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Send size={14} />
                  </button>
                </form>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
