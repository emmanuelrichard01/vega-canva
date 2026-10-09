import { moveSlide, presentableFrames, presentationOrder } from '../model/frames';
import type { AnyNode, FrameNode } from '../model/schema';
import { slideFields } from './slideMeta';

/**
 * The deck: the board's slides as one ordered list, with sections and skips.
 *
 * A slide is a visible top-level frame, in `presentationOrder` (hand order
 * where somebody set one, reading order where not). Every surface that lists
 * slides reads this one function, so the slide view, the presenter, the
 * presenter view and the PDF can never disagree about what slide 4 is.
 */
export interface DeckSlide {
  frame: FrameNode;
  /** Position in the whole deck, skipped slides included. */
  index: number;
  /** The number it is shown as while presenting, or null when it is skipped. */
  number: number | null;
  hidden: boolean;
  /** Set on the slide that opens a section. */
  sectionStart?: string;
  /** The section this slide sits in, if any section precedes it. */
  section?: string;
}

export function deckOf(objects: Record<string, AnyNode> | readonly AnyNode[]): DeckSlide[] {
  const nodes = Array.isArray(objects) ? (objects as readonly AnyNode[]) : Object.values(objects as Record<string, AnyNode>);
  const frames = presentationOrder(presentableFrames(nodes) as FrameNode[]);
  let shown = 0;
  let section: string | undefined;
  return frames.map((frame, index) => {
    const meta = slideFields(frame);
    if (meta.slideSection) section = meta.slideSection;
    const hidden = meta.slideHidden === true;
    return {
      frame,
      index,
      number: hidden ? null : ++shown,
      hidden,
      sectionStart: meta.slideSection,
      section,
    };
  });
}

/** The ids a presentation plays, in order: every slide that is not skipped. */
export function playableIds(deck: readonly DeckSlide[]): string[] {
  return deck.filter((s) => !s.hidden).map((s) => s.frame.id);
}

/**
 * Move several slides together so they land, in their current relative order,
 * before the slide that is at `to` in the current order (or at the end when
 * `to` is the deck's length).
 *
 * The multi-select drag of the slide view. Indices are taken in the order
 * before the move, which is what the pointer was over when it let go.
 */
export function moveMany(order: readonly string[], moving: ReadonlySet<string>, to: number): string[] {
  if (moving.size === 0) return [...order];
  if (moving.size === 1) {
    const from = order.findIndex((id) => moving.has(id));
    if (from < 0) return [...order];
    // `moveSlide` takes the index after removal; a drop to the right of the
    // slide's own place lands one earlier once the slide is lifted out.
    return moveSlide(order, from, to > from ? to - 1 : to);
  }
  const anchor = order.slice(to).find((id) => !moving.has(id));
  const rest = order.filter((id) => !moving.has(id));
  const block = order.filter((id) => moving.has(id));
  const at = anchor === undefined ? rest.length : rest.indexOf(anchor);
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/** The slide after `id` among the playable ones, wrapping off the end as null. */
export function nextPlayable(deck: readonly DeckSlide[], id: string): DeckSlide | null {
  const at = deck.findIndex((s) => s.frame.id === id);
  for (let i = at + 1; i < deck.length; i++) if (!deck[i].hidden) return deck[i];
  return null;
}

/**
 * Where a new slide goes on the board, so it sits beside its neighbour and
 * clear of every frame already there.
 *
 * To the right of `after` on its row by default; past whatever already
 * occupies that spot otherwise. The deck's order is stated by `slideOrder`, so
 * the position only has to be tidy, not meaningful.
 */
export function placeSlide(
  after: { x: number; y: number; width: number; height: number } | null,
  size: { width: number; height: number },
  frames: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  gap = 160
): { x: number; y: number } {
  const overlaps = (x: number, y: number) =>
    frames.some((f) => x < f.x + f.width + gap / 2 && x + size.width + gap / 2 > f.x && y < f.y + f.height + gap / 2 && y + size.height + gap / 2 > f.y);
  if (!after) {
    if (frames.length === 0) return { x: 0, y: 0 };
    const right = Math.max(...frames.map((f) => f.x + f.width));
    const top = Math.min(...frames.map((f) => f.y));
    return { x: right + gap, y: top };
  }
  let x = after.x + after.width + gap;
  const y = after.y;
  for (let guard = 0; overlaps(x, y) && guard < 500; guard++) x += size.width + gap;
  return { x, y };
}
