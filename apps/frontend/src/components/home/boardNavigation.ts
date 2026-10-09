/* --------------------------------------------------- dashboard → board motion */

/**
 * The cover that travels into the board.
 *
 * Named only as the page is swapped out, and every name cleared when the page
 * is shown again, so exactly one element carries it however many times
 * somebody goes to a board and comes Back — a page restored from the back
 * cache would otherwise still carry the last cover's name, and two elements
 * with one name cancel the transition.
 */
let leavingCover: HTMLElement | null = null;
const SWAP_SUPPORTED = typeof window !== 'undefined' && 'onpageswap' in window;

if (typeof window !== 'undefined') {
  window.addEventListener('pageswap', (event) => {
    if ((event as Event & { viewTransition?: unknown }).viewTransition && leavingCover) {
      leavingCover.style.viewTransitionName = 'board-canvas';
    }
  });
  const clearNames = () => {
    document.querySelectorAll<HTMLElement>('.bcard__art, .gcard__art, .gshow__stage, .tpeek__art').forEach((el) => {
      if (el.style.viewTransitionName) el.style.viewTransitionName = '';
    });
    leavingCover = null;
  };
  window.addEventListener('pageshow', clearNames);
  window.addEventListener('pagereveal', clearNames);
}

export function armCover(cover: HTMLElement | null | undefined) {
  leavingCover = cover ?? null;
  // Without `pageswap` there is no later moment to name it in.
  if (cover && !SWAP_SUPPORTED) cover.style.viewTransitionName = 'board-canvas';
}

/** Set once a navigation is under way, so a double click or a held Enter cannot start a second one. */
let leaving = false;
if (typeof window !== 'undefined') window.addEventListener('pageshow', () => { leaving = false; });

export function goToBoard(url: string, cover?: HTMLElement | null) {
  if (leaving) return;
  leaving = true;
  armCover(cover);
  window.location.href = url;
}


/** Whether a navigation is already under way. */
export const isLeaving = () => leaving;

/** Clears the guard; for a test, which has no `pageshow` to do it. */
export function resetLeaving(): void {
  leaving = false;
  leavingCover = null;
}
