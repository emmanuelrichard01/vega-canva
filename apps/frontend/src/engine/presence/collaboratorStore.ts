/**
 * The single reader of other people's awareness state.
 *
 * `PresenceManager` is the only *writer*; this is the mirror of it. Before, the
 * radar had its own awareness subscription and its own interpolation, the
 * remote cursors had a second, the off-screen markers read `getStates()`
 * inline during render with no subscription at all (so they updated only when
 * something else happened to re-render the room), and the selection outlines
 * had a fourth that rebuilt a `Map` on every broadcast. Four readers, three
 * different answers, and the one with the worst answer was the one users saw
 * first.
 *
 * Two things this owns that are easy to get wrong separately:
 *
 * 1. **One frame loop.** Interpolation stepped once per frame, for everybody,
 *    before any consumer draws. The radar used to own it — so collapsing the
 *    radar froze the smoothing that the *cursors* depended on.
 * 2. **Roster changes and position changes are different events.** React
 *    subscribes to the first (a few times a minute); the frame loop reads the
 *    second (15Hz in, 60Hz out). Conflating them re-renders a component tree
 *    to move an arrow.
 */

import { provider } from '../document';
import { smoothingFactor } from '../cursor/remoteCursor';
import { readCollaborators, rosterSignature, type Collaborator } from './collaborators';

type Unsubscribe = () => void;

class CollaboratorStore {
  /**
   * The stable snapshot. Replaced with a new array only when the roster
   * signature changes, so `useSyncExternalStore` can compare by identity.
   *
   * The *contents* are mutated in place every broadcast — cursor, viewport,
   * throws. That is intentional and is why nothing should read a position
   * during render: read it in the frame loop, where it is always current.
   */
  private roster: Collaborator[] = [];
  private signature = '';

  private rosterListeners = new Set<() => void>();
  private frameListeners = new Set<(dtMs: number) => void>();

  private frame = 0;
  private lastFrameAt = 0;
  private attached = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.attach();
  }

  // -- awareness -----------------------------------------------------------

  private attach() {
    const awareness = provider.awareness;
    if (!awareness) {
      // The provider builds its awareness asynchronously in some transports.
      this.retryTimer = setTimeout(() => this.attach(), 100);
      return;
    }
    if (this.attached) return;
    this.attached = true;
    awareness.on('change', this.read);
    this.read();
  }

  private read = () => {
    const next = readCollaborators(provider.awareness?.getStates(), provider.awareness?.clientID);

    // Carry smoothing across the update, so a broadcast does not restart the
    // interpolation from wherever the last one landed.
    const previous = new Map(this.roster.map((c) => [c.clientId, c]));
    for (const person of next) {
      const before = previous.get(person.clientId);
      if (!before) continue;
      if (!person.cursor) {
        // They left the canvas. Drop the smoothed position so that coming back
        // at a different edge fades in *there*, rather than sliding across the
        // whole board from wherever they were last seen.
        person.smoothed = null;
      } else {
        person.smoothed = before.smoothed ?? { ...person.cursor };
      }
    }

    const signature = rosterSignature(next);
    if (signature === this.signature) {
      // Same people, same states — only positions moved. Update in place and
      // do not touch React.
      const byId = new Map(next.map((c) => [c.clientId, c]));
      for (const person of this.roster) {
        const fresh = byId.get(person.clientId);
        if (!fresh) continue;
        person.cursor = fresh.cursor;
        person.smoothed = fresh.smoothed;
        person.viewport = fresh.viewport;
        person.throws = fresh.throws;
        person.selection = fresh.selection;
      }
      return;
    }

    this.signature = signature;
    this.roster = next;
    this.rosterListeners.forEach((fn) => fn());
  };

  // -- reading -------------------------------------------------------------

  /** For `useSyncExternalStore`. Identity is stable between roster changes. */
  getSnapshot = (): Collaborator[] => this.roster;

  /** Subscribe to roster changes — joins, leaves, renames, idle, on/off canvas. */
  subscribe = (listener: () => void): Unsubscribe => {
    this.rosterListeners.add(listener);
    return () => this.rosterListeners.delete(listener);
  };

  /** The live list, positions included. Safe to read inside a frame callback. */
  live = (): Collaborator[] => this.roster;

  find = (clientId: number): Collaborator | undefined =>
    this.roster.find((c) => c.clientId === clientId);

  // -- the frame loop ------------------------------------------------------

  /**
   * Run `callback` once per frame, after interpolation has been stepped.
   *
   * The loop exists only while something is subscribed, so a room with the
   * radar collapsed and nobody else present does no per-frame work at all.
   */
  onFrame = (callback: (dtMs: number) => void): Unsubscribe => {
    this.frameListeners.add(callback);
    this.startLoop();
    return () => {
      this.frameListeners.delete(callback);
      if (this.frameListeners.size === 0) this.stopLoop();
    };
  };

  private startLoop() {
    if (this.frame) return;
    this.lastFrameAt = 0;
    this.frame = requestAnimationFrame(this.tick);
  }

  private stopLoop() {
    if (!this.frame) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    // A restart must not be handed the whole pause as one frame; that would
    // snap every cursor instead of easing it.
    this.lastFrameAt = 0;
  }

  private tick = (now: number) => {
    this.frame = requestAnimationFrame(this.tick);
    const dt = this.lastFrameAt ? now - this.lastFrameAt : 1000 / 60;
    this.lastFrameAt = now;

    this.advance(dt);
    this.frameListeners.forEach((fn) => fn(dt));
  };

  /**
   * Step every remote pointer toward its broadcast position.
   *
   * In **world** space, which is the whole reason this moved out of the cursor
   * component: interpolating screen positions meant your own pan dragged
   * everybody's pointer along behind the content for a fifth of a second.
   */
  private advance(dtMs: number) {
    const alpha = smoothingFactor(dtMs);
    if (alpha <= 0) return;

    for (const person of this.roster) {
      if (!person.cursor) continue;
      if (!person.smoothed) {
        person.smoothed = { ...person.cursor };
        continue;
      }
      person.smoothed.x += (person.cursor.x - person.smoothed.x) * alpha;
      person.smoothed.y += (person.cursor.y - person.smoothed.y) * alpha;
    }
  }

  /** Test/HMR hatch. Nothing in the app tears the singleton down. */
  destroy() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    provider.awareness?.off('change', this.read);
    this.stopLoop();
    this.rosterListeners.clear();
    this.frameListeners.clear();
    this.attached = false;
  }
}

export const collaboratorStore = new CollaboratorStore();
export type { Collaborator };
