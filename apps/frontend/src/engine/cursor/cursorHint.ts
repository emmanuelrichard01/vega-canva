/**
 * A state that takes the board's pointer from whatever tool is armed.
 *
 * A claim (`cursorOverride`) is for a handle under the pointer and is cleared
 * whenever a press ends. A hint is for something the *application* is doing —
 * a voice note being recorded, work in progress — which outlives any press, so
 * it is its own tiny store rather than a claim that the falsifiers would
 * erase. The owner of the activity sets it and clears it; `LocalCursor` reads
 * it and writes the pointer.
 */
export type CursorHint = 'idle' | 'busy' | 'recording';

type Listener = () => void;

let current: CursorHint = 'idle';
const listeners = new Set<Listener>();

export const cursorHint = {
  get: (): CursorHint => current,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(next: CursorHint): void {
    if (next === current) return;
    current = next;
    listeners.forEach((fn) => fn());
  },
};
