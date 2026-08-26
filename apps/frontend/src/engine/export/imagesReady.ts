/**
 * Waiting for the pictures before reading the pixels.
 *
 * ## Why this is needed now and was not before
 *
 * `renderScope` mounts the objects an export needs even when the camera is
 * nowhere near them, which is what stops a large board exporting with its
 * off-screen half blank. But an image node does not become drawable when it
 * mounts: `use-image` constructs an `HTMLImageElement`, sets `src`, and the
 * picture arrives on a `load` event some time later.
 *
 * So the fix for one silent omission opens the door to a quieter one. An image
 * that was off screen used to be missing from the export because it was not on
 * the stage at all; now it is on the stage as an empty rectangle, which looks
 * far more like a deliberate blank. Mounting a photograph and photographing it
 * two frames later is a race, and the export is the side that loses.
 *
 * ## How this decides it is done
 *
 * By counting, not by listening. There is no event to subscribe to that covers
 * the interesting gap — before `use-image` has created the element there is
 * nothing on the stage to attach a listener to, so "every image node on the
 * stage is loaded" is trivially true at exactly the wrong moment. The document
 * knows how many images the export contains; the stage is asked until it can
 * draw that many.
 *
 * ## And why it gives up
 *
 * A `src` can 404, or point at an object store that is down, or be a data URI
 * a browser refuses. Waiting forever turns one broken image into an export
 * button that never returns, which is the worse failure of the two: a missing
 * picture is visible in the file, and a hang is not visible anywhere. The
 * deadline is generous enough that a slow network is waited for and short
 * enough that a dead one is not.
 */

/** The subset of a Konva node this needs. */
interface ImageNodeLike {
  image(): { complete?: boolean } | undefined | null;
  isVisible?(): boolean;
}

interface StageLike {
  find(selector: string): ImageNodeLike[];
}

/** How long to wait for the pictures before exporting without them. */
export const IMAGE_DEADLINE_MS = 6000;

/**
 * How many of the images this export needs cannot be drawn yet.
 *
 * Two things count as not ready, and the second is the one that matters:
 * a node whose element exists but has not finished loading, and an image the
 * document contains that has **no node on the stage at all** — because React
 * has not committed it, or `use-image` has not yet produced an element for it.
 * Only comparing against `expected` can see the second.
 */
export function pendingImages(stage: StageLike, expected: number): number {
  if (expected <= 0) return 0;

  let drawable = 0;
  for (const node of stage.find('Image')) {
    // An image hidden by `isolateObjects` is not part of this export and must
    // not be waited for -- it will never load if it is outside the selection
    // and off screen, and waiting would spend the whole deadline on it.
    if (node.isVisible && !node.isVisible()) continue;
    const element = node.image();
    // `complete` absent means it is not an `HTMLImageElement` -- a canvas, or
    // a video frame -- and those are drawable the moment they are set.
    if (element && element.complete !== false) drawable += 1;
  }

  return Math.max(0, expected - drawable);
}

/**
 * Resolve once every expected image is drawable, or the deadline passes.
 *
 * Polls on animation frames rather than a timer: the thing being waited for is
 * a React commit followed by a Konva layout, both of which happen on frames, so
 * a frame is the smallest interval at which the answer can change.
 *
 * Returns whether it finished rather than throwing. A missing picture is not a
 * reason to refuse the export — it is a reason for the caller to be able to say
 * so, which is a decision that belongs one level up.
 */
export function waitForImages(
  stage: StageLike,
  expected: number,
  deadlineMs = IMAGE_DEADLINE_MS,
  now: () => number = () => Date.now(),
  schedule: (fn: () => void) => void = (fn) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }
): Promise<boolean> {
  if (pendingImages(stage, expected) === 0) return Promise.resolve(true);

  const started = now();
  return new Promise((resolve) => {
    const poll = () => {
      if (pendingImages(stage, expected) === 0) return resolve(true);
      if (now() - started >= deadlineMs) return resolve(false);
      schedule(poll);
    };
    schedule(poll);
  });
}

/**
 * How many drawable images an export of these nodes should end up containing.
 *
 * Hidden nodes are not in an export at all, and a node with no source will
 * never produce an element — counting either would make the wait time out on
 * every export that had one.
 */
export function expectedImages(
  nodes: Iterable<{ type: string; hidden?: boolean; src?: string }>
): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'image' && !node.hidden && node.src) count += 1;
  }
  return count;
}
