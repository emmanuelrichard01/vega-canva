import { applyNodePatches, createNode, doc, readNode } from '../document';
import type { NewNodeInput } from '../document/mutations';
import { canEditObjects } from '../model/permissions';
import { descendantsOfFrame, slideOrderPatches } from '../model/frames';
import type { AnyNode, FrameNode } from '../model/schema';
import { pasteNodes, writeClipboard } from '../clipboard/clipboard';
import { deleteNodesWithFrames } from '../interaction/frameMembership';
import { useStore } from '../../hooks/useStore';
import { deckOf, moveMany, placeSlide } from './deck';
import { normalizeNotes, normalizeSection, type SlideTransition, type TransitionDirection, type TransitionEase } from './slideMeta';
import { themePatches, type DeckTheme } from './themes';

/**
 * The deck's edits: every write the slide view, the panel and the presenter
 * view make to slides.
 *
 * Each is one transaction, so one gesture is one undo step and one broadcast,
 * and each refuses outright for anyone who is not an editor: viewers can open
 * the slide view and present, but a viewer's write would be dropped by the
 * server and stall their copy of the board.
 */

const objects = () => useStore.getState().objects as Record<string, AnyNode>;

/** Write `order` as the deck's order, touching only the slides whose number changes. */
export function writeDeckOrder(order: readonly string[]): boolean {
  if (!canEditObjects()) return false;
  const current = new Map(order.map((id) => [id, readNode(id)?.slideOrder as number | undefined]));
  const patches = slideOrderPatches(order, current);
  if (patches.length === 0) return false;
  applyNodePatches(patches);
  return true;
}

/** Move the slides in `ids` to land before the slide now at `to`. */
export function moveSlides(ids: ReadonlySet<string>, to: number): boolean {
  const order = deckOf(objects()).map((s) => s.frame.id);
  const next = moveMany(order, ids, to);
  if (next.every((id, i) => id === order[i])) return false;
  return writeDeckOrder(next);
}

/** The frame and everything it holds, in stacking order. */
function slideMembers(frameId: string, all: Record<string, AnyNode>): AnyNode[] {
  const list = Object.values(all);
  const ids = new Set([frameId, ...descendantsOfFrame(frameId, list)]);
  return list.filter((n) => ids.has(n.id)).sort((a, b) => a.zIndex - b.zIndex || (a.id < b.id ? -1 : 1));
}

/**
 * Duplicate slides, each copy placed beside its original on the board and
 * straight after it in the deck. Returns the copies' frame ids.
 */
export function duplicateSlides(ids: readonly string[]): string[] {
  if (!canEditObjects() || ids.length === 0) return [];
  const all = objects();
  const deck = deckOf(all);
  const order = deck.map((s) => s.frame.id);
  const wanted = new Set(ids);
  const frames: Array<{ x: number; y: number; width: number; height: number }> = deck.map((s) => s.frame);
  const groups = useStore.getState().groups;
  const made = new Map<string, string>();

  doc.transact(() => {
    for (const slide of deck) {
      if (!wanted.has(slide.frame.id)) continue;
      const payload = writeClipboard(slideMembers(slide.frame.id, all));
      if (!payload) continue;
      const at = placeSlide(slide.frame, slide.frame, frames, 160);
      // Measured against the frame's corner, which is the payload's origin
      // only when nothing hangs over its top-left edge.
      const target = { x: at.x + (payload.origin.x - slide.frame.x), y: at.y + (payload.origin.y - slide.frame.y) };
      const { nodes } = pasteNodes(payload, target, groups);
      const copy = nodes.find((n) => n.type === 'frame' && n.x === at.x && n.y === at.y) ?? nodes.find((n) => n.type === 'frame');
      if (!copy) continue;
      // The frame first, so what it holds joins it on creation.
      createNode(copy as NewNodeInput);
      nodes.forEach((n) => n !== copy && createNode(n as NewNodeInput));
      made.set(slide.frame.id, String(copy.id));
      frames.push({ x: at.x, y: at.y, width: slide.frame.width, height: slide.frame.height });
    }
    const next = order.flatMap((id) => (made.has(id) ? [id, made.get(id)!] : [id]));
    const current = new Map<string, number | undefined>(next.map((id) => [id, readNode(id)?.slideOrder as number | undefined]));
    applyNodePatches(slideOrderPatches(next, current));
  });
  return [...made.values()];
}

/** Delete slides and everything on them. */
export function deleteSlides(ids: readonly string[]): void {
  if (!canEditObjects() || ids.length === 0) return;
  deleteNodesWithFrames([...ids]);
}

/** Skip or restore slides. */
export function setSlidesHidden(ids: readonly string[], hidden: boolean): void {
  if (!canEditObjects()) return;
  applyNodePatches(ids.map((id) => ({ id, changes: { slideHidden: hidden ? true : undefined } })));
}

/** Start a section at a slide, rename it, or (with an empty name) remove it. */
export function setSlideSection(id: string, name: string): void {
  if (!canEditObjects()) return;
  applyNodePatches([{ id, changes: { slideSection: normalizeSection(name) } }]);
}

export function setSlideTransition(ids: readonly string[], transition: SlideTransition | 'glide'): void {
  if (!canEditObjects()) return;
  applyNodePatches(ids.map((id) => ({ id, changes: { transition: transition === 'glide' ? undefined : transition } })));
}

/** Tune the transition into slides: its direction, length or curve. An `undefined` value puts one back to its default. */
export function tuneSlideTransition(
  ids: readonly string[],
  changes: { transitionDir?: TransitionDirection; transitionMs?: number; transitionEase?: TransitionEase }
): void {
  if (!canEditObjects() || ids.length === 0) return;
  applyNodePatches(ids.map((id) => ({ id, changes: { ...changes } })));
}

export function setSlideNotes(id: string, notes: string): void {
  if (!canEditObjects()) return;
  const next = normalizeNotes(notes);
  if ((readNode(id)?.notes ?? undefined) === next) return;
  applyNodePatches([{ id, changes: { notes: next } }]);
}

/** Dress slides in a theme: page, type and colours, one undo step. */
export function applyDeckTheme(theme: DeckTheme, frameIds: readonly string[]): number {
  if (!canEditObjects() || frameIds.length === 0) return 0;
  const all = objects();
  const patches = frameIds.flatMap((id) => {
    const frame = all[id];
    if (!frame || frame.type !== 'frame') return [];
    return themePatches(theme, frame as FrameNode, slideMembers(id, all));
  });
  applyNodePatches(patches);
  return frameIds.length;
}
