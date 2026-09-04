/**
 * The shared board every connector's label is arranged on.
 *
 * ## Why a registry rather than a selector
 *
 * `placeConnectorLabels` needs every route at once, and the routes are the one
 * thing no central place has. A connector's path depends on the live positions
 * of the two objects it joins, on their outlines, on their rotations, and --
 * mid-gesture -- on `liveTransformStore` rather than on the document at all.
 * `ConnectorRenderer` already resolves all of that to draw itself. Working it
 * out a second time somewhere else would mean a second copy of the hardest
 * code in the connector system, kept in step by hand.
 *
 * So the routes come from the renderers that already have them. Each connector
 * publishes its own; the pass runs over the collection; each reads back its
 * own answer.
 *
 * ## Why this cannot loop
 *
 * Publishing happens in an effect, after render, and returns early unless the
 * route or the text actually changed. The pass is deferred to a microtask, so
 * a burst of publishes during one commit produces one pass. Subscribers are
 * only notified when a placement *moved* -- a recomputation that lands in the
 * same places is silent. A connector re-rendering because its label moved
 * therefore publishes the same route, changes nothing, and notifies nobody.
 *
 * ## Why the fallback is the old behaviour
 *
 * Until the first pass has run -- the frame a connector first appears on --
 * `slotFor` answers `null` and the renderer falls back to the fixed point it
 * always used. A label in its old place for one frame is not worth a flash of
 * no label at all.
 */

import { placeConnectorLabels, type Placed } from './connectorLabels';

interface Entry {
  text: string;
  /** The route in **world** space, which is the space placement works in. */
  points: number[];
}

const entries = new Map<string, Entry>();
let placements = new Map<string, Placed>();
const listeners = new Set<() => void>();
let scheduled = false;

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    // A sub-tenth-of-a-unit change cannot move a label anywhere a person can
    // see, and treating it as a change would rerun the pass on every frame of
    // every drag of anything either end is attached to.
    if (Math.abs(a[i] - b[i]) > 0.1) return false;
  }
  return true;
}

function samePlacements(a: Map<string, Placed>, b: Map<string, Placed>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, p] of a) {
    const q = b.get(id);
    if (!q || Math.abs(p.x - q.x) > 0.1 || Math.abs(p.y - q.y) > 0.1) return false;
  }
  return true;
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const next = placeConnectorLabels(
      Array.from(entries, ([id, entry]) => ({ id, text: entry.text, points: entry.points }))
    );
    // Silent when nothing moved: this is what stops a notify from becoming a
    // render from becoming a publish.
    if (samePlacements(next, placements)) return;
    placements = next;
    for (const listener of listeners) listener();
  });
}

/** A connector offering its route to the arrangement. */
export function publishConnectorLabel(id: string, text: string, points: readonly number[]): void {
  const prev = entries.get(id);
  if (prev && prev.text === text && sameNumbers(prev.points, points)) return;
  entries.set(id, { text, points: Array.from(points) });
  schedule();
}

/** A connector that has lost its label, or left the board. */
export function retractConnectorLabel(id: string): void {
  if (entries.delete(id)) schedule();
}

/**
 * Where this connector's label goes, or `null` before the first pass.
 *
 * The identity is stable between passes, which is what `useSyncExternalStore`
 * requires of a snapshot: it hands back the same object until placements are
 * genuinely replaced.
 */
export function slotFor(id: string): Placed | null {
  return placements.get(id) ?? null;
}

export function subscribeConnectorLabels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For tests, which must not inherit an arrangement from the last one. */
export function resetConnectorLabels(): void {
  entries.clear();
  placements = new Map();
}
