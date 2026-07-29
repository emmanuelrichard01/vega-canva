import { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { commentsMap, provider, doc } from '../engine/document';
import { nanoid } from 'nanoid';

export interface Message {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  body: string;
  createdAt: number;
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

  const getAuthorInfo = () => {
    const localState = provider.awareness?.getLocalState();
    const user = localState?.user as any;
    return {
      authorId: provider.awareness?.clientID.toString() || 'local',
      authorName: user?.name || 'You',
      authorColor: user?.color || '#3B82F6',
    };
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

    const message = {
      id: messageId,
      authorId: author.authorId,
      authorName: author.authorName,
      authorColor: author.authorColor,
      body,
      createdAt: Date.now(),
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
    const message = {
      id: nanoid(),
      authorId: author.authorId,
      authorName: author.authorName,
      authorColor: author.authorColor,
      body,
      createdAt: Date.now(),
    };

    messagesArray.push([message]);
  }, []);

  /** Stable identity for "did I write this?" checks. */
  const currentAuthorId = provider.awareness?.clientID.toString() || 'local';

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

    const myId = provider.awareness?.clientID.toString() || 'local';
    const items = messagesArray.toArray();
    const idx = items.findIndex((m: any) => m.id === messageId);
    if (idx === -1) return;
    if (items[idx].authorId !== myId) return; // not the author — refuse

    const updated = { ...items[idx], body: newBody, editedAt: Date.now() };
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

    const myId = provider.awareness?.clientID.toString() || 'local';
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
