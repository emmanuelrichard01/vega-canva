import { describe, it, expect } from 'vitest';
import {
  activeMentionQuery,
  anchorPoint,
  encodeMention,
  extractMentions,
  isUnread,
  mentionsMe,
  parseMessage,
  plainText,
  rankMentions,
  relativeTime,
  sortForInbox,
  unreadCount,
  type Thread,
  type ThreadMessage,
} from './threads';

const message = (over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id: 'm1',
  authorId: 'dana',
  authorName: 'Dana Ito',
  authorColor: '#F59E0B',
  body: 'looks good',
  createdAt: 1000,
  ...over,
});

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 't1',
  x: 0,
  y: 0,
  messages: [message()],
  resolved: false,
  createdAt: 1000,
  ...over,
});

describe('mention encoding', () => {
  it('round-trips a mention through encode and parse', () => {
    const body = `Can ${encodeMention('Dana Ito', 'user_7')} take this?`;
    expect(parseMessage(body)).toEqual([
      { kind: 'text', text: 'Can ' },
      { kind: 'mention', text: 'Dana Ito', authorId: 'user_7' },
      { kind: 'text', text: ' take this?' },
    ]);
  });

  it('strips brackets from a display name so the token cannot be broken', () => {
    // Names are user-supplied at sign-in; a `]` would terminate the token
    // early and spill the raw id into the message.
    expect(encodeMention('Da]na[', 'u1')).toBe('@[Dana](u1)');
  });

  it('handles several mentions and text in between', () => {
    const body = `${encodeMention('A', 'a')} and ${encodeMention('B', 'b')}`;
    expect(extractMentions(body)).toEqual(['a', 'b']);
  });

  it('de-duplicates a person mentioned twice', () => {
    const body = `${encodeMention('A', 'a')} ${encodeMention('A', 'a')}`;
    expect(extractMentions(body)).toEqual(['a']);
  });

  it('leaves a body with no mentions completely alone', () => {
    expect(parseMessage('plain words')).toEqual([{ kind: 'text', text: 'plain words' }]);
    expect(extractMentions('plain words')).toEqual([]);
  });

  it('does not treat a bare @ as markup', () => {
    expect(parseMessage('email me @ work')).toEqual([{ kind: 'text', text: 'email me @ work' }]);
  });

  it('renders to plain text for previews', () => {
    expect(plainText(`ping ${encodeMention('Dana Ito', 'u1')} please`)).toBe(
      'ping @Dana Ito please'
    );
  });
});

describe('activeMentionQuery', () => {
  it('finds the fragment the caret is inside', () => {
    const text = 'ask @dan';
    expect(activeMentionQuery(text, text.length)).toEqual({ query: 'dan', from: 4, to: 8 });
  });

  it('opens on an @ at the very start', () => {
    expect(activeMentionQuery('@d', 2)).toEqual({ query: 'd', from: 0, to: 2 });
  });

  it('ignores an @ inside a word, so an email is not a mention search', () => {
    expect(activeMentionQuery('mail me at dana@vega.io', 22)).toBeNull();
  });

  it('closes once the fragment contains a space', () => {
    expect(activeMentionQuery('@dana ito', 9)).toBeNull();
  });

  it('is null when there is no @ before the caret', () => {
    expect(activeMentionQuery('nothing here', 5)).toBeNull();
  });
});

describe('rankMentions', () => {
  const people = [
    { id: '1', name: 'Dana Ito', color: '#000' },
    { id: '2', name: 'Daniel K', color: '#000' },
    { id: '3', name: 'Mike Osei', color: '#000' },
  ];

  it('prefers a prefix match on the full name', () => {
    expect(rankMentions(people, 'dan').map((p) => p.name)).toEqual(['Dana Ito', 'Daniel K']);
  });

  it('matches the start of a later word', () => {
    expect(rankMentions(people, 'ito').map((p) => p.id)).toEqual(['1']);
  });

  it('returns everyone for an empty query', () => {
    expect(rankMentions(people, '')).toHaveLength(3);
  });
});

describe('unread state', () => {
  const me = 'me';

  it('is unread when someone else wrote after you last looked', () => {
    const t = thread({ messages: [message({ createdAt: 5000 })] });
    expect(isUnread(t, { t1: 4000 }, me)).toBe(true);
  });

  it('is read once you have seen the newest message', () => {
    const t = thread({ messages: [message({ createdAt: 5000 })] });
    expect(isUnread(t, { t1: 5000 }, me)).toBe(false);
  });

  it('never marks your own message unread to you', () => {
    // Otherwise posting a comment instantly badges it as news from yourself.
    const t = thread({ messages: [message({ authorId: me, createdAt: 9000 })] });
    expect(isUnread(t, {}, me)).toBe(false);
  });

  it('treats a thread you have never opened as unread', () => {
    expect(isUnread(thread(), {}, me)).toBe(true);
  });

  it('counts only unresolved threads', () => {
    const threads = [thread({ id: 'a' }), thread({ id: 'b', resolved: true })];
    expect(unreadCount(threads, {}, me)).toBe(1);
  });

  it('spots a mention of you among the unseen messages', () => {
    const t = thread({
      messages: [message({ body: `hey @[Me](${me})`, createdAt: 5000 })],
    });
    expect(mentionsMe(t, { t1: 4000 }, me)).toBe(true);
  });

  it('does not re-flag a mention you have already read', () => {
    const t = thread({ messages: [message({ body: `hey @[Me](${me})`, createdAt: 5000 })] });
    expect(mentionsMe(t, { t1: 5000 }, me)).toBe(false);
  });

  it('ignores a mention of you written by you', () => {
    const t = thread({
      messages: [message({ authorId: me, body: `note to self @[Me](${me})`, createdAt: 5000 })],
    });
    expect(mentionsMe(t, {}, me)).toBe(false);
  });
});

describe('sortForInbox', () => {
  const me = 'me';

  it('puts mentions first, then unread, then read, then resolved', () => {
    const threads = [
      thread({ id: 'read', messages: [message({ createdAt: 100 })] }),
      thread({ id: 'resolved', resolved: true, messages: [message({ createdAt: 900 })] }),
      thread({ id: 'unread', messages: [message({ createdAt: 800 })] }),
      thread({ id: 'mention', messages: [message({ body: `@[Me](${me})`, createdAt: 700 })] }),
    ];
    const marks = { read: 100 };
    expect(sortForInbox(threads, marks, me).map((t) => t.id)).toEqual([
      'mention',
      'unread',
      'read',
      'resolved',
    ]);
  });

  it('orders within a rank by most recent activity', () => {
    const threads = [
      thread({ id: 'old', messages: [message({ createdAt: 100 })] }),
      thread({ id: 'new', messages: [message({ createdAt: 900 })] }),
    ];
    const marks = { old: 100, new: 900 };
    expect(sortForInbox(threads, marks, me).map((t) => t.id)).toEqual(['new', 'old']);
  });
});

describe('anchorPoint', () => {
  it('falls back to the thread’s own point with no target', () => {
    expect(anchorPoint({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });

  it('rides the target’s top-right corner', () => {
    expect(anchorPoint({ x: 0, y: 0 }, { x: 100, y: 50, width: 200, height: 100 })).toEqual({
      x: 300,
      y: 50,
    });
  });

  it('rotates the corner about the centre, not the origin', () => {
    // A 180° turn must put the pin on the opposite corner. Before this, the
    // pin stayed at the unrotated corner, pointing at empty canvas.
    const p = anchorPoint({ x: 0, y: 0 }, { x: 0, y: 0, width: 200, height: 100, rotation: 180 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(100);
  });

  it('handles a quarter turn', () => {
    const p = anchorPoint({ x: 0, y: 0 }, { x: 0, y: 0, width: 200, height: 100, rotation: 90 });
    expect(p.x).toBeCloseTo(150);
    expect(p.y).toBeCloseTo(150);
  });
});

describe('relativeTime', () => {
  const now = 1_000_000_000;
  it('reads as elapsed time, not a clock', () => {
    expect(relativeTime(now - 5_000, now)).toBe('just now');
    expect(relativeTime(now - 4 * 60_000, now)).toBe('4m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('never shows a negative age for a clock that is slightly ahead', () => {
    expect(relativeTime(now + 5_000, now)).toBe('just now');
  });
});
