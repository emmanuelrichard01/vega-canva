/**
 * The arithmetic and text handling behind comment threads.
 *
 * Pure, and separated from `CommentsOverlay` for the same reason the presence
 * maths was: none of it can be judged from a screenshot. Whether a thread is
 * unread, whether a mention points at you, and where a pin sits on a rotated
 * object are all things that look right in the one case you happen to try and
 * are wrong in the case that matters.
 */

/** One message in a thread. Mirrors `hooks/useComments`. */
export interface ThreadMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  body: string;
  createdAt: number;
  editedAt?: number;
  /** Author ids named in `body`. Denormalised so "am I mentioned" is a lookup. */
  mentions?: string[];
}

export interface Thread {
  id: string;
  x: number;
  y: number;
  objectId?: string;
  messages: ThreadMessage[];
  resolved: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

/**
 * How a mention is stored: `@[Display Name](authorId)`.
 *
 * The id travels with the text rather than in a side-array alone, because the
 * *position* is part of the meaning — "ask @Dana, not @Mike" is not the same
 * sentence with the names in a separate list. The display name is captured at
 * write time and never re-resolved: a comment is a record of what someone
 * said, and silently rewriting the name in a year-old message because that
 * person changed their profile is editing history.
 */
const MENTION_PATTERN = /@\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; authorId: string };

/** Split a stored body into runs of plain text and mentions, for rendering. */
export function parseMessage(body: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let cursor = 0;

  // `matchAll` needs the global flag and a fresh lastIndex; a module-level
  // regex with /g is stateful, so this must not use `.test` or `.exec` on it.
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const at = match.index ?? 0;
    if (at > cursor) segments.push({ kind: 'text', text: body.slice(cursor, at) });
    segments.push({ kind: 'mention', text: match[1], authorId: match[2] });
    cursor = at + match[0].length;
  }

  if (cursor < body.length) segments.push({ kind: 'text', text: body.slice(cursor) });
  return segments;
}

/** The author ids named in a body. */
export function extractMentions(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_PATTERN)].map((m) => m[2]))];
}

/** The body as a human reads it, with the markup removed. For lists and previews. */
export function plainText(body: string): string {
  return body.replace(MENTION_PATTERN, (_, name) => `@${name}`);
}

/** Encode one mention for insertion into a composer. */
export function encodeMention(name: string, authorId: string): string {
  // A `]` or `)` in a display name would terminate the token early and turn
  // the rest of the mention into visible junk. Names are user-supplied.
  const safeName = name.replace(/[[\]]/g, '').trim() || 'Unknown';
  return `@[${safeName}](${authorId})`;
}

/**
 * The `@…` fragment the caret currently sits in, if any.
 *
 * Returns the range to replace when a suggestion is picked. An `@` only opens
 * the picker at a word boundary, so an email address does not turn the rest of
 * a sentence into a mention search.
 */
export function activeMentionQuery(
  text: string,
  caret: number
): { query: string; from: number; to: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;

  const preceding = at === 0 ? '' : before[at - 1];
  if (preceding && !/\s/.test(preceding)) return null;

  const query = before.slice(at + 1);
  // A space ends the query: mentions are picked, not typed indefinitely.
  if (/[\s\n]/.test(query)) return null;
  return { query, from: at, to: caret };
}

export interface MentionCandidate {
  id: string;
  name: string;
  color: string;
}

/** Rank candidates for a query. Prefix matches first, then contains. */
export function rankMentions(candidates: MentionCandidate[], query: string): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates.slice(0, 6);

  const scored = candidates
    .map((c) => {
      const name = c.name.toLowerCase();
      if (name.startsWith(q)) return { c, score: 0 };
      // Match the start of any word too, so "ito" finds "Dana Ito".
      if (name.split(/\s+/).some((w) => w.startsWith(q))) return { c, score: 1 };
      if (name.includes(q)) return { c, score: 2 };
      return null;
    })
    .filter((s): s is { c: MentionCandidate; score: number } => s !== null);

  scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
  return scored.slice(0, 6).map((s) => s.c);
}

// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

/** `threadId → timestamp of the newest message you had seen`. */
export type ReadMarks = Record<string, number>;

export const lastMessage = (thread: Thread): ThreadMessage | undefined =>
  thread.messages?.[thread.messages.length - 1];

/**
 * Is there something in this thread you have not seen?
 *
 * Your own message never counts: posting is not news to the person who posted.
 * A thread you have never opened counts as unread only if someone *else* has
 * written in it, which is what stops your own new comment from immediately
 * marking itself unread.
 */
export function isUnread(thread: Thread, marks: ReadMarks, myAuthorId: string): boolean {
  const last = lastMessage(thread);
  if (!last) return false;
  if (last.authorId === myAuthorId) return false;
  return last.createdAt > (marks[thread.id] ?? 0);
}

/** Does anything unread in this thread name you specifically? */
export function mentionsMe(thread: Thread, marks: ReadMarks, myAuthorId: string): boolean {
  const seenAt = marks[thread.id] ?? 0;
  return (thread.messages ?? []).some(
    (m) =>
      m.authorId !== myAuthorId &&
      m.createdAt > seenAt &&
      (m.mentions ?? extractMentions(m.body)).includes(myAuthorId)
  );
}

/** How many threads have something new in them. */
export function unreadCount(threads: Thread[], marks: ReadMarks, myAuthorId: string): number {
  return threads.filter((t) => !t.resolved && isUnread(t, marks, myAuthorId)).length;
}

/**
 * Inbox order: what needs you, then what is new, then everything else newest
 * first. Resolved threads always sink to the bottom regardless.
 */
export function sortForInbox(threads: Thread[], marks: ReadMarks, myAuthorId: string): Thread[] {
  const rank = (t: Thread) => {
    if (t.resolved) return 3;
    if (mentionsMe(t, marks, myAuthorId)) return 0;
    if (isUnread(t, marks, myAuthorId)) return 1;
    return 2;
  };
  return [...threads].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return (lastMessage(b)?.createdAt ?? b.createdAt) - (lastMessage(a)?.createdAt ?? a.createdAt);
  });
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export interface AnchorTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, about the object's centre — which is how everything here rotates. */
  rotation?: number;
}

/**
 * Where a pin sits in world space.
 *
 * A thread anchored to an object rides that object's top-right corner, so it
 * moves when the object moves. It used to compute that corner as
 * `(x + width, y)`, which is only the top-right corner of an *unrotated* box —
 * rotate a sticky and its comment stayed behind in mid-air, pointing at
 * nothing. Objects rotate about their centre, so the corner has to be rotated
 * about the centre too.
 */
export function anchorPoint(
  thread: { x: number; y: number },
  target?: AnchorTarget | null
): { x: number; y: number } {
  if (!target) return { x: thread.x, y: thread.y };

  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const dx = target.width / 2;
  const dy = -target.height / 2;

  const radians = ((target.rotation ?? 0) * Math.PI) / 180;
  if (!radians) return { x: cx + dx, y: cy + dy };

  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * "just now", "4m", "3h", "2d", then a date.
 *
 * Comment timestamps were an absolute clock time, which answers the wrong
 * question — in a thread you want to know how long ago, and "14:32" makes you
 * do that subtraction yourself and gets it wrong across midnight.
 */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
