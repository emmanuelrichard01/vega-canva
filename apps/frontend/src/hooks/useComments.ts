import { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { commentsMap, doc, localAuthor, localAuthorId } from '../engine/document';
import { extractMentions } from '../engine/comments/threads';
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
  messages: Message[];
  resolved: boolean;
  createdAt: number;
}

export function useComments() {
  const [comments, setComments] = useState<CommentThread[]>([]);

  useEffect(() => {
    const updateComments = () => {
      const result: CommentThread[] = [];
      commentsMap.forEach((commentMap) => {
        result.push(commentMap.toJSON() as CommentThread);
      });
      result.sort((a, b) => a.createdAt - b.createdAt);
      setComments(result);
    };

    updateComments();

    const observer = () => {
      updateComments();
    };

    commentsMap.observeDeep(observer);
    return () => {
      commentsMap.unobserveDeep(observer);
    };
  }, []);

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

  const addComment = useCallback((x: number, y: number, body: string, objectId?: string) => {
    const threadId = nanoid();
    const messageId = nanoid();
    const author = getAuthorInfo();

    const newMap = new Y.Map();
    newMap.set('id', threadId);
    newMap.set('x', x);
    newMap.set('y', y);
    if (objectId) newMap.set('objectId', objectId);
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
    const threadMap = commentsMap.get(threadId);
    if (!threadMap) return;

    const messagesArray = threadMap.get('messages') as Y.Array<any>;
    if (!messagesArray) return;

    const myId = localAuthorId();
    const items = messagesArray.toArray();
    const idx = items.findIndex((m: any) => m.id === messageId);
    if (idx === -1) return;
    if (items[idx].authorId !== myId) return;

    // Removing the only message removes the whole thread — an empty pin is noise.
    if (items.length === 1) {
      commentsMap.delete(threadId);
    } else {
      messagesArray.delete(idx, 1);
    }
  }, []);

  const resolveComment = useCallback((threadId: string) => {
    const threadMap = commentsMap.get(threadId);
    if (!threadMap) return;
    
    // Toggle resolved state
    const currentResolved = threadMap.get('resolved') as boolean;
    threadMap.set('resolved', !currentResolved);
  }, []);
  
  const deleteComment = useCallback((threadId: string) => {
    commentsMap.delete(threadId);
  }, []);

  return {
    comments,
    addComment,
    addReply,
    editMessage,
    deleteMessage,
    resolveComment,
    deleteComment,
    currentAuthorId,
  };
}
