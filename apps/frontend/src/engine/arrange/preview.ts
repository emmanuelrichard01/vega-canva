import type { Box } from '../model/selection';
import type { AlignTarget } from './plans';

/**
 * Local, transient state the arrangement controls share with the board.
 *
 * None of it is the document: which control the pointer is on, which object
 * is the key, are facts about one person's screen. Writing them to the board
 * would flicker on everyone else's and land in the undo history. Same rule as
 * `booleanPreview`.
 */

type Listener = () => void;

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: (): T => value,
    set(next: T): void {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((fn) => fn());
    },
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** Where a plan would put things, drawn as outlines while its control is pointed at. */
export interface ArrangeGhost {
  boxes: Box[];
  /** The edge or box being aligned to, drawn as a guide. */
  reference?: Box;
}

export const arrangeGhost = store<ArrangeGhost | null>(null);

/**
 * The key object: the one the others align to, Illustrator's "key".
 *
 * `units` is what can be picked while the Align panel is open, so the board
 * can put a target over each one; null when nothing is being picked.
 */
export interface AlignKeyState {
  key: string | null;
  target: AlignTarget;
  picking: { key: string; box: Box }[] | null;
}

export const alignKey = store<AlignKeyState>({ key: null, target: 'selection', picking: null });

export function setAlignKey(patch: Partial<AlignKeyState>): void {
  const current = alignKey.get();
  const next = { ...current, ...patch };
  if (next.key === current.key && next.target === current.target && next.picking === current.picking) return;
  alignKey.set(next);
}
