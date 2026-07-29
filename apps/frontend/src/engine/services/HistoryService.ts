import { historyArray, localAuthor, provider } from '../document';
import { nanoid } from 'nanoid';

export interface CanvasCommand {
  id: string;
  timestamp: number;
  userId: string;
  userName: string;
  userColor: string;
  type: string;
  payload: unknown;
}

/**
 * How many authoring events the shared log retains.
 *
 * This log lives inside the *synced* CRDT document, so every entry is
 * replicated to every client and persisted to the room snapshot forever. It
 * was previously unbounded and append-only: one record per mutation, for the
 * life of the room — and `getHistory()` was called by nothing at all, so it
 * was pure write-only growth inflating every document and every sync payload.
 *
 * It now feeds the activity feed (which had no data source of its own) and is
 * capped. The cap is a ring: the feed only ever surfaces the last few seconds,
 * and Time Travel replays the server's own update log rather than this one, so
 * nothing needs deep retention here.
 */
const MAX_HISTORY_ENTRIES = 200;

/** Trim in chunks so a busy room isn't doing a CRDT delete on every keystroke. */
const TRIM_SLACK = 50;

type Listener = (events: CanvasCommand[]) => void;

class HistoryServiceClass {
  private listeners = new Set<Listener>();
  private observing = false;

  pushCommand(type: string, payload: unknown) {
    const author = localAuthor();

    const command: CanvasCommand = {
      id: nanoid(),
      timestamp: Date.now(),
      userId: author.id,
      userName: author.name,
      userColor: author.color,
      type,
      payload,
    };

    historyArray.push([command]);

    if (historyArray.length > MAX_HISTORY_ENTRIES + TRIM_SLACK) {
      historyArray.delete(0, historyArray.length - MAX_HISTORY_ENTRIES);
    }
  }

  getHistory(): CanvasCommand[] {
    // The document layer types this array as `unknown` because it must not
    // depend on service-layer types; this module owns the shape it writes.
    return historyArray.toArray() as CanvasCommand[];
  }

  /** Most recent entries, newest last. */
  getRecent(limit = 20): CanvasCommand[] {
    return this.getHistory().slice(-limit);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);

    if (!this.observing) {
      this.observing = true;
      historyArray.observe(() => {
        const snapshot = this.getRecent();
        this.listeners.forEach((l) => l(snapshot));
      });
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  clearHistory() {
    historyArray.delete(0, historyArray.length);
  }

  /** Client id of the local peer, used to filter own events out of the feed. */
  get localClientId(): string {
    return provider.awareness?.clientID?.toString() ?? 'local';
  }
}

export const historyService = new HistoryServiceClass();
