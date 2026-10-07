import { cursorCss } from './cursorCss';
import {
  cursorVisual,
  moveVisual,
  portVisual,
  stateVisual,
  type PointerState,
} from './cursorVisual';

/**
 * The accent the art is drawn with, read where the design system keeps it.
 *
 * Handles claim cursors without knowing the theme, so the one accent dot on a
 * pointer is read at claim time, exactly as `LocalCursor` reads it.
 */
export function currentAccent(): string {
  if (typeof document === 'undefined') return '#2563EB';
  return getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#2563EB';
}

/**
 * Cursor values a component hands to `claimCursor`, in our art with a keyword
 * fallback — so a claim is the same family as the tool pointers, not the OS
 * arrow it would otherwise be.
 */
export const claimable = {
  /** Over something that cannot be moved or edited. */
  notAllowed: () => cursorCss(stateVisual('not-allowed'), 'not-allowed'),
  /** A state badge on the arrow. */
  state: (state: PointerState) => cursorCss(stateVisual(state), state === 'busy' ? 'progress' : 'default'),
  /** Alt held on a drag that duplicates. */
  duplicate: () => cursorCss(cursorVisual('pointer', 'alt-duplicate', currentAccent()), 'copy'),
  /** Over a hovered object that a drag will move. */
  move: () => cursorCss(moveVisual(), 'move'),
  /** The connector tool over a port it will snap to. */
  port: () => cursorCss(portVisual(currentAccent()), 'crosshair'),
};
