import { useCallback, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { commentsMap, doc, localAuthor, localAuthorId } from '../engine/document';
import { extractMentions, reactionKey } from '../engine/comments/threads';
import { canEditObjects, canPostComments } from '../engine/model/permissions';
import { nanoid } from 'nanoid';

export interface Message {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  /** Stored form, mention markup included — see `engine/comments/threads`. */
  body: string;
  createdAt: number;
  editedAt?: number;
  /**
   * Author ids named in `body`, denormalised at write time.
   *
   * Derivable by re-parsing the body, and stored anyway: "does anything unread
   * name me" runs over every message of every thread on each render of the
   * pins and the inbox, and a regex scan of every comment in the document is
   * not a thing to do sixty times a second.
   */
  mentions?: string[];
}

export interface CommentThread {
  id: string;
  x: number;
  y: number;
  objectId?: string;
  /** Where on the object the pin sits; see `anchorPoint`. */
  anchor?: { u: number; v: number };
  messages: Message[];
  resolved: boolean;
  createdAt: number;
  /** Raw reaction keys; read them through `messageReactions`. */
  reactions?: Record<string, unknown>;
}

/**
 * One observer and one sorted list for the whole page.
 *
 * Several components read the comments; each mounting its own `observeDeep`
 * meant each re-serialised and re-sorted every thread on every change. The
 * list is built once per document change and shared through
 * `useSyncExternalStore`.
 *
 * A thread with no messages is not listed. Deleting the last message empties
 * the thread rather than deleting its container, because deleting the
 * container would also discard a reply someone posted at the same moment;
 * emptied, that reply simply brings the thread back.
 */
let snapshot: CommentThread[] = [];
const listeners = new Set<() => void>();

function rebuild(): void {
  const result: CommentThread[] = [];
  commentsMap.forEach((commentMap) => {
    const thread = commentMap.toJSON() as CommentThread;
    if (Array.isArray(thread.messages) && thread.messages.length > 0) result.push(thread);
  });
  result.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  snapshot = result;
  listeners.forEach((fn) => fn());
}

const onCommentsChanged = () => rebuild();

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    commentsMap.observeDeep(onCommentsChanged);
    rebuild();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) commentsMap.unobserveDeep(onCommentsChanged);
  };
}

const getSnapshot = () => snapshot;

export function useComments() {
  const comments = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  /**
   * Who is writing. Routed through `localAuthor()` so comments are stamped
   * with the same identity as every node in the document — this used to read
   * `awareness.clientID` directly, which is a per-session number, so after a
   * reload none of your own comments were "yours" any more.
   */
  const getAuthorInfo = () => {
    const author = localAuthor();
    return { authorId: author.id, authorName: author.name, authorColor: author.color };
  };

  const addComment = useCallback((x: number, y: number, body: string, objectId?: string, anchor?: { u: number; v: number }) => {
    if (!canPostComments()) return;
    const threadId = nanoid();
    const messageId = nanoid();
    const author = getAuthorInfo();

    const newMap = new Y.Map();
    newMap.set('id', threadId);
    newMap.set('x', x);
    newMap.set('y', y);
    if (objectId) newMap.set('objectId', objectId);
    if (objectId && anchor) newMap.set('anchor', { u: anchor.u, v: anchor.v });
    // Created with the thread, so no two people ever race to create it.
    newMap.set('reactions', new Y.Map());
    newMap.set('resolved', false);
    newMap.set('createdAt', Date.now());

    const message: Message = {
      id: messageId,
      authorId: author.authorId,
      authorName: author.authorName,
      authorColor: author.authorColor,
      body,
      createdAt: Date.now(),
      mentions: extractMentions(body),
    };

    const messagesArray = new Y.Array();
    messagesArray.push([message]);
    newMap.set('messages', messagesArray);

    commentsMap.set(threadId, newMap);
  }, []);

  const addReply = useCallback((threadId: string, body: string) => {
    if (!canPostComments()) return;
    const threadMap = commentsMap.get(threadId);
    if (!threadMap) return;

    const messagesArray = threadMap.get('messages') as Y.Array<any>;
    if (!messagesArray) return;

    const author = getAuthorInfo();
    const message: Message = {
      id: nanoid(),
      authorId: author.authorId,
      authorName: author.authorName,
      authorColor: author.authorColor,
      body,
      createdAt: Date.now(),
      mentions: extractMentions(body),
    };

    messagesArray.push([message]);
  }, []);

  /** Stable identity for "did I write this?" checks — see `localAuthorId`. */
  const currentAuthorId = localAuthorId();

  /**
   * Edit a single message. Only the original author may edit their own message —
   * everyone else can reply, but not rewrite someone else's words. The check is
   * enforced here rather than only hidden in the UI so a stale render can't
   * produce an unauthorized write.
   */
  const editMessage = useCallback((threadId: string, messageId: string, newBody: string) => {
    if (!canPostComments()) return;
    const threadMap = commentsMap.get(threadId);
    if (!threadMap) return;

    const messagesArray = threadMap.get('messages') as Y.Array<any>;
    if (!messagesArray) return;

    const myId = localAuthorId();
    const items = messagesArray.toArray();
    const idx = items.findIndex((m: any) => m.id === messageId);
    if (idx === -1) return;
    if (items[idx].authorId !== myId) return; // not the author — refuse

    // Mentions are re-derived: an edit that adds or removes a name has to
    // change who the thread is "for", or the inbox keeps flagging someone who
    // was edited out of the message.
    const updated = {
      ...items[idx],
      body: newBody,
      editedAt: Date.now(),
      mentions: extractMentions(newBody),
    };
    // Y.Array has no in-place set; delete + insert at the same index preserves order.
    doc.transact(() => {
      messagesArray.delete(idx, 1);
      messagesArray.insert(idx, [updated]);
    });
  }, []);

  /** Delete a single message. Author-only, same reasoning as editMessage. */
  const deleteMessage = useCallback((threadId: string, messageId: string) => {
    if (!canPostComments()) return;
    const threadMap = commentsMap.get(threadId);
    if (!threadMap) return;

    const messagesArray = threadMap.get('messages') as Y.Array<any>;
    if (!messagesArray) return;

    const myId = localAuthorId();
    const items = messagesArray.toArray();
    const idx = items.findIndex((m: any) => m.id === messageId);
    if (idx === -1) return;
    if (items[idx].authorId !== myId) return;

    // Only the message goes, never the container: see the note on `snapshot`.
    messagesArray.delete(idx, 1);
  }, []);

  /** Any commenter may resolve or reopen a thread: closing the loop is shared work. */
  const resolveComment = useCallback((threadId: string) => {
    if (!canPostComments()) return;
    const threadMap = commentsMap.get(threadId);
    if (!threadMap) return;

    const currentResolved = threadMap.get('resolved') as boolean;
    threadMap.set('resolved', !currentResolved);
  }, []);
  
  /**
   * Add or take back the local person's reaction to one message.
   *
   * Threads created before reactions existed get their map on first use; a
   * collision there costs at most one reaction, once, on an old thread.
   */
  const toggleMessageReaction = useCallback((threadId: string, messageId: string, emoji: string) => {
    if (!canPostComments()) return;
    const threadMap = commentsMap.get(threadId);
    if (!threadMap) return;
    doc.transact(() => {
      let reactions = threadMap.get('reactions') as Y.Map<boolean> | undefined;
      if (!(reactions instanceof Y.Map)) {
        reactions = new Y.Map<boolean>();
        threadMap.set('reactions', reactions);
      }
      const key = reactionKey(messageId, emoji, localAuthorId());
      if (reactions.has(key)) reactions.delete(key);
      else reactions.set(key, true);
    });
  }, []);

  /**
   * Delete a whole thread. Its starter or an editor may; other commenters can
   * reply and resolve but not erase someone else's conversation.
   *
   * The messages go, never the container: deleting the container would also
   * discard a reply posted at the same moment, whereas an emptied thread is
   * simply brought back by that reply (see the note on `snapshot`).
   */
  const deleteComment = useCallback((threadId: string) => {
    if (!canPostComments()) return;
    const threadMap = commentsMap.get(threadId);
    if (!threadMap) return;
    const messagesArray = threadMap.get('messages') as Y.Array<Message> | undefined;
    if (!messagesArray) return;
    const starter = messagesArray.get(0);
    if (!canEditObjects() && starter?.authorId !== localAuthorId()) return;
    // Only what this client has seen: a concurrent reply is not in the range.
    messagesArray.delete(0, messagesArray.length);
  }, []);

  return {
    comments,
    addComment,
    addReply,
    editMessage,
    deleteMessage,
    resolveComment,
    toggleMessageReaction,
    deleteComment,
    currentAuthorId,
  };
}
