import { applyNodePatches, createNode, doc, readNode } from '../document';
import { canEditObjects } from '../model/permissions';
import { slideOrderPatches } from '../model/frames';
import type { AnyNode } from '../model/schema';
import { useStore } from '../../hooks/useStore';
import { deckOf, placeSlide } from './deck';
import { layoutSlide, type LayoutContent, type LayoutId } from './layouts';
import type { DeckTheme } from './themes';

/**
 * Adding a slide from a layout. Apart from the deck's other edits because it
 * is the one that needs the layout builders, which only the slide view loads.
 */

const objects = () => useStore.getState().objects as Record<string, AnyNode>;

/**
 * Insert a new slide from a layout, after `afterId` in the deck (or at the
 * end), placed beside it on the board. Returns the new frame's id.
 */
export function insertLayoutSlide(
  layout: LayoutId,
  theme: DeckTheme,
  afterId: string | null,
  name: string,
  content: LayoutContent = {},
  size: { width: number; height: number } = { width: 1920, height: 1080 }
): string | null {
  if (!canEditObjects()) return null;
  const deck = deckOf(objects());
  const after = (afterId ? deck.find((s) => s.frame.id === afterId) : deck[deck.length - 1])?.frame ?? null;
  const at = placeSlide(after, size, deck.map((s) => s.frame), 160);
  const nodes = layoutSlide(layout, { ...at, ...size }, theme, name, content);
  const frameId = String(nodes[0].id);
  doc.transact(() => {
    nodes.forEach((n) => createNode(n));
    const order = deck.map((s) => s.frame.id);
    const at2 = after ? order.indexOf(after.id) + 1 : order.length;
    const next = [...order.slice(0, at2), frameId, ...order.slice(at2)];
    const current = new Map<string, number | undefined>(next.map((id) => [id, readNode(id)?.slideOrder as number | undefined]));
    applyNodePatches(slideOrderPatches(next, current));
  });
  return frameId;
}

