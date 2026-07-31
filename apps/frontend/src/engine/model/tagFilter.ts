/**
 * Which tags are currently being filtered on.
 *
 * **Not in the CRDT, on purpose.** A filter is a way of looking, not a
 * property of the board: your colleague narrowing to `risk` must not empty
 * everyone else's canvas. It is also not persisted — a filter you left on
 * yesterday and forgot about is a board that looks broken when you come back
 * to it tomorrow.
 *
 * A store rather than component state because two surfaces read it — the
 * Layers panel that sets it, and the canvas that dims by it — and a filter
 * they disagree about is worse than no filter.
 */

const listeners = new Set<() => void>();
let active: Set<string> = new Set();
/** Stable empty snapshot, so `useSyncExternalStore` sees no phantom changes. */
const EMPTY: ReadonlySet<string> = new Set();

function emit() {
  listeners.forEach((fn) => fn());
}

export const tagFilter = {
  getSnapshot: (): ReadonlySet<string> => (active.size === 0 ? EMPTY : active),

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  isActive: (tag: string) => active.has(tag),

  toggle(tag: string) {
    const next = new Set(active);
    if (!next.delete(tag)) next.add(tag);
    active = next;
    emit();
  },

  clear() {
    if (active.size === 0) return;
    active = new Set();
    emit();
  },

  /**
   * Drop tags that no longer exist on any node.
   *
   * Without this, deleting the last note carrying a tag leaves that tag
   * selected and invisible — the board filters to nothing and the only clue is
   * a filter chip that is no longer in the list.
   */
  prune(existing: Iterable<string>) {
    if (active.size === 0) return;
    const live = new Set(existing);
    const next = new Set([...active].filter((tag) => live.has(tag)));
    if (next.size === active.size) return;
    active = next;
    emit();
  },
};
