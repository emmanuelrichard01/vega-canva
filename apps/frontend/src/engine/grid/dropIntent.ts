/**
 * Whether the person dropping something wants it kept out of a grid.
 *
 * Holding Ctrl (or ⌘ on a Mac) while dragging is the board's "do the
 * opposite" for snapping, and adoption into a grid module follows the same
 * rule: a drop with the key held lands where it was dropped, free. Tracked
 * here rather than read off the drag event because adoption is decided after
 * the drag has ended, by code that never sees the event.
 */
let held = false;
let installed = false;

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const sync = (e: KeyboardEvent | PointerEvent | MouseEvent) => {
    held = e.ctrlKey || e.metaKey;
  };
  window.addEventListener('keydown', sync, true);
  window.addEventListener('keyup', sync, true);
  window.addEventListener('pointermove', sync, true);
  window.addEventListener('pointerup', sync, true);
  window.addEventListener('blur', () => {
    held = false;
  });
}

install();

/** True while Ctrl or ⌘ is held. */
export function adoptionSuppressed(): boolean {
  return held;
}
