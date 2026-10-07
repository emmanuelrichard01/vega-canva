// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { act, renderHook } from '@testing-library/react';

vi.mock('../engine/document', async () => {
  const Y2 = await import('yjs');
  const doc = new Y2.Doc();
  return {
    doc,
    commentsMap: doc.getMap('comments'),
    localAuthorId: () => 'me',
    localAuthor: () => ({ id: 'me', name: 'Me', color: '#000' }),
  };
});

const { useComments } = await import('./useComments');
const { doc } = await import('../engine/document');
const { setRoomRole } = await import('../engine/model/permissions');

describe('useComments', () => {
  it('keeps a reply posted while the only message was being deleted', () => {
    const { result } = renderHook(() => useComments());
    act(() => result.current.addComment(0, 0, 'first'));
    const thread = result.current.comments[0];

    // A collaborator, concurrently, replies to the thread.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const theirThread = other.getMap('comments').get(thread.id) as Y.Map<unknown>;
    (theirThread.get('messages') as Y.Array<unknown>).push([{ id: 'r', authorId: 'them', body: 'reply', createdAt: 2 }]);

    act(() => result.current.deleteMessage(thread.id, thread.messages[0].id));
    expect(result.current.comments).toHaveLength(0);

    act(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc))));
    expect(result.current.comments).toHaveLength(1);
    expect(result.current.comments[0].messages.map((m) => m.body)).toEqual(['reply']);
  });

  it('deletes a thread only for its starter or an editor, and keeps the container', () => {
    const { result } = renderHook(() => useComments());
    act(() => result.current.addComment(0, 0, 'mine'));
    const mine = result.current.comments.at(-1)!;
    // A thread someone else started.
    act(() => {
      doc.transact(() => {
        const m = new Y.Map();
        m.set('id', 'theirs');
        m.set('resolved', false);
        m.set('createdAt', 5);
        const arr = new Y.Array();
        arr.push([{ id: 'x', authorId: 'them', body: 'hi', createdAt: 5 }]);
        m.set('messages', arr);
        doc.getMap('comments').set('theirs', m);
      });
    });
    setRoomRole('commenter');
    act(() => result.current.deleteComment('theirs'));
    expect(result.current.comments.some((t) => t.id === 'theirs')).toBe(true);
    act(() => result.current.deleteComment(mine.id));
    expect(result.current.comments.some((t) => t.id === mine.id)).toBe(false);
    expect(doc.getMap('comments').has(mine.id)).toBe(true);
    setRoomRole('editor');
    act(() => result.current.deleteComment('theirs'));
    expect(result.current.comments.some((t) => t.id === 'theirs')).toBe(false);
  });

  it('refuses writes from a viewer', () => {
    setRoomRole('viewer');
    const { result } = renderHook(() => useComments());
    const before = result.current.comments.length;
    act(() => result.current.addComment(0, 0, 'nope'));
    expect(result.current.comments.length).toBe(before);
    setRoomRole('editor');
  });

  it('shares one list between every component that reads it', () => {
    const a = renderHook(() => useComments());
    const b = renderHook(() => useComments());
    expect(a.result.current.comments).toBe(b.result.current.comments);
  });
});
