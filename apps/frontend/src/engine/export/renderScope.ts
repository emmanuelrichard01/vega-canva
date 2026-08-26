/**
 * Making sure the objects an export needs are actually on the stage.
 *
 * ## The bug this exists for
 *
 * The canvas culls: `useVisibleSet` publishes the ids inside the viewport plus
 * 300px of overscan, and `Canvas` renders only those. That is what makes a
 * large board usable, and it is measured — a 500-object query costs about four
 * microseconds.
 *
 * A raster export captures the live Konva stage. It reframes the stage onto the
 * document's bounds and draws — but the *tree* is still the culled one, because
 * the reframe is imperative and synchronous and React never got a chance to
 * mount anything. So exporting a board larger than the window produced an image
 * of the right dimensions containing only what happened to be on screen, with
 * the rest of the board as empty paper.
 *
 * That is a worse failure than a crash: the file is the size you asked for, the
 * download succeeds, and the missing half of the board looks like a design
 * decision. And it disagrees with the SVG of the same board, which is built
 * from the document and has always contained everything.
 *
 * ## The shape of the fix
 *
 * Culling is a viewport optimisation; an export is not looking through the
 * viewport. So an export declares which ids it needs mounted, `Canvas` unions
 * that into what it renders, and the capture waits for one commit before it
 * reads pixels.
 *
 * `Canvas` already did exactly this for the current selection — `visibleSet`
 * has `selectedIds` added to it, so a selected object off screen stays mounted.
 * This is that same rule, made available to something other than selection,
 * rather than a second mechanism beside it.
 *
 * ## Not in the document, and not in awareness
 *
 * "This client is exporting" is not a property of the board and not something
 * anyone else needs to see. Same tier, and the same shape, as `cropMode`,
 * `pathEdit` and `booleanPreview`.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Ids that must stay mounted, or `null` when nothing is exporting.
 *
 * A snapshot with stable identity while nothing changes, because
 * `useSyncExternalStore` compares by identity and re-renders the whole canvas
 * when it differs.
 */
let required: ReadonlySet<string> | null = null;

/** Nested requirements, so two overlapping exports do not release each other's. */
let holders = 0;

export const renderScope = {
  /**
   * Ask for these ids to be mounted, and get back the release.
   *
   * Reference-counted rather than last-writer-wins: the export dialog renders a
   * preview on a debounce while the user may also press Export, and the first
   * of the two to finish would otherwise un-mount the board out from under the
   * second.
   */
  require(ids: Iterable<string>): () => void {
    const merged = new Set(required ?? []);
    for (const id of ids) merged.add(id);
    required = merged;
    holders += 1;
    listeners.forEach((fn) => fn());

    let released = false;
    return () => {
      if (released) return;
      released = true;
      holders -= 1;
      if (holders > 0) return;
      required = null;
      listeners.forEach((fn) => fn());
    };
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): ReadonlySet<string> | null {
    return required;
  },
};

/**
 * The ids the canvas should have mounted.
 *
 * Pure, and the reason this is a function rather than three lines inside a
 * `useMemo`: what an export contains is decided here, and it is assertable
 * without mounting React or Konva.
 *
 * An empty `visible` means the culler has not reported yet — at which point
 * everything renders, which is `Canvas`'s existing behaviour and the safe way
 * round: showing too much for one frame costs a frame, showing too little
 * costs an export.
 */
export function mountedSet(
  all: readonly string[],
  visible: readonly string[],
  selected: readonly string[],
  scope: ReadonlySet<string> | null
): ReadonlySet<string> | null {
  if (visible.length === 0) return null;
  const set = new Set(visible);
  for (const id of selected) set.add(id);
  if (scope) for (const id of all) if (scope.has(id)) set.add(id);
  return set;
}

/**
 * Wait for React to commit and Konva to lay out what was just required.
 *
 * Two frames, not one. The first `requestAnimationFrame` fires *before* the
 * paint that follows the state change; a capture there reads the tree as it was.
 * The second is after it.
 *
 * Deliberately not `await` inside the capture itself: `captureRaster` reframes
 * the stage and puts it back with no suspension point between, so the engine's
 * own rAF loop cannot re-apply the live camera mid-capture. Mounting is the
 * asynchronous part; capturing stays the synchronous one.
 */
export function nextCommit(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
