/**
 * Ruler guides: the lines you pull out of a ruler and align things to.
 *
 * ## These live in the document, unlike the *smart* guides
 *
 * A smart guide appears during your drag, explains one snap and disappears; it
 * is a fact about a gesture and rides on ephemeral state. A ruler guide is
 * something a person deliberately placed and expects to find again — and
 * expects their collaborators to see, because "line it up with the guide" is a
 * thing people say to each other. So it is document state, and it undoes.
 *
 * ## A root type, so two clients cannot each create it
 *
 * `doc.getArray('rulerGuides')` on a root name is idempotent: every client
 * resolves the same shared type. That matters more here than it looks — a
 * container created lazily on first use is the bug this codebase has already
 * hit twice, where two people acting at once each build their own `Y.Map` and
 * one is silently discarded.
 *
 * A `Y.Array` rather than a map keyed by id, because a guide has no identity
 * worth preserving: it is a number and an axis, you move it or you delete it,
 * and nothing else ever refers to one. An array also makes "delete this guide"
 * converge sensibly — two people deleting the same guide leaves it deleted.
 */

import { doc } from './doc';

export type GuideAxis = 'x' | 'y';

export interface RulerGuide {
  axis: GuideAxis;
  /** World coordinate: an `x` guide is a vertical line at this x. */
  position: number;
}

export const rulerGuidesArray = doc.getArray<RulerGuide>('rulerGuides');

/** Only what a canvas can draw: a finite number on a known axis. */
function isValid(guide: unknown): guide is RulerGuide {
  if (!guide || typeof guide !== 'object') return false;
  const g = guide as Partial<RulerGuide>;
  return (g.axis === 'x' || g.axis === 'y') && typeof g.position === 'number' && Number.isFinite(g.position);
}

/**
 * Every guide, filtered to the ones that can be drawn.
 *
 * Validated on read rather than trusted, for the same reason `normalize` runs
 * at the CRDT boundary: a document can be hand-edited, written by an older
 * build, or half-applied during an interrupted sync, and a `NaN` here would
 * put a line at an undrawable coordinate on everybody's board.
 */
export function readGuides(): RulerGuide[] {
  return rulerGuidesArray.toArray().filter(isValid);
}

/** Round to a tenth of a world unit: sub-tenth precision nobody asked for. */
const round = (n: number) => Math.round(n * 10) / 10;

export function addGuide(axis: GuideAxis, position: number): void {
  if (!Number.isFinite(position)) return;
  rulerGuidesArray.push([{ axis, position: round(position) }]);
}

/**
 * Move one guide.
 *
 * Delete-then-insert at the same index, because `Y.Array` has no in-place
 * update. That is also why guides are dragged with a live preview and only
 * committed on release: doing this on every pointer move would put one entry
 * per frame into the update log, and therefore one step per frame into Time
 * Travel.
 */
export function moveGuide(index: number, position: number): void {
  const guides = rulerGuidesArray.toArray();
  const existing = guides[index];
  if (!existing || !isValid(existing) || !Number.isFinite(position)) return;

  doc.transact(() => {
    rulerGuidesArray.delete(index, 1);
    rulerGuidesArray.insert(index, [{ axis: existing.axis, position: round(position) }]);
  });
}

export function removeGuide(index: number): void {
  if (index < 0 || index >= rulerGuidesArray.length) return;
  rulerGuidesArray.delete(index, 1);
}
