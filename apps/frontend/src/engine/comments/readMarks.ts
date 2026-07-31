/**
 * Which comments you have already seen.
 *
 * **Deliberately not in the CRDT.** Read state is per person, not per
 * document: putting it in the shared doc would mean your colleague opening a
 * thread marks it read for you, and it would grow the document — and its
 * history — with data no one else can use. It lives in `localStorage`, keyed
 * by room, and is the one piece of comment state that is allowed to be local
 * and lossy. Losing it shows you a few threads as new again, which is a much
 * better failure than the alternatives.
 *
 * A store rather than component state because two surfaces read it — the pins
 * on the canvas and the inbox — and they must never disagree about what is
 * new.
 */

import type { ReadMarks } from './threads';

const KEY_PREFIX = 'vega_comment_reads:';

/**
 * Marks are pruned to this many threads on write, newest first.
 *
 * Without a bound this grows forever, including entries for threads that were
 * deleted years ago, and `localStorage` is a hard 5MB per origin shared with
 * the offline media queue and the workspace list.
 */
const MAX_TRACKED = 500;

class ReadMarksStore {
  private roomId = '';
  private marks: ReadMarks = {};
  private listeners = new Set<() => void>();

  private key() {
    return `${KEY_PREFIX}${this.roomId}`;
  }

  /** Point the store at a room. Safe to call repeatedly with the same id. */
  load(roomId: string) {
    if (!roomId || roomId === this.roomId) return;
    this.roomId = roomId;
    try {
      const raw = localStorage.getItem(this.key());
      const parsed = raw ? JSON.parse(raw) : {};
      // A corrupt or hand-edited entry must not take the comments UI down with
      // it; an empty map just shows everything as new.
      this.marks =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ReadMarks) : {};
    } catch {
      this.marks = {};
    }
    this.emit();
  }

  getSnapshot = (): ReadMarks => this.marks;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Record that you have seen everything in a thread up to `at`.
   *
   * Never moves a mark backwards. Opening an old thread after a newer message
   * arrived in it would otherwise un-read the newer message.
   */
  markRead(threadId: string, at: number) {
    if (!threadId || !Number.isFinite(at)) return;
    if ((this.marks[threadId] ?? 0) >= at) return;
    this.marks = { ...this.marks, [threadId]: at };
    this.persist();
    this.emit();
  }

  /** Mark every given thread read, in one write. */
  markAllRead(threads: Array<{ id: string; messages: Array<{ createdAt: number }> }>) {
    const next = { ...this.marks };
    let changed = false;
    for (const thread of threads) {
      const newest = thread.messages?.[thread.messages.length - 1]?.createdAt;
      if (!Number.isFinite(newest)) continue;
      if ((next[thread.id] ?? 0) >= newest!) continue;
      next[thread.id] = newest!;
      changed = true;
    }
    if (!changed) return;
    this.marks = next;
    this.persist();
    this.emit();
  }

  /** Drop marks for threads that no longer exist. */
  prune(liveThreadIds: Iterable<string>) {
    const live = new Set(liveThreadIds);
    const entries = Object.entries(this.marks).filter(([id]) => live.has(id));
    if (entries.length === Object.keys(this.marks).length) return;
    this.marks = Object.fromEntries(entries);
    this.persist();
    this.emit();
  }

  private persist() {
    if (!this.roomId) return;
    try {
      let entries = Object.entries(this.marks);
      if (entries.length > MAX_TRACKED) {
        entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_TRACKED);
        this.marks = Object.fromEntries(entries);
      }
      localStorage.setItem(this.key(), JSON.stringify(this.marks));
    } catch {
      /* private mode or quota — read state is allowed to be lossy */
    }
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}

export const readMarks = new ReadMarksStore();
