import { useStore } from '../../hooks/useStore';

/** World-space grid pitch. Matches the canvas dot pattern in index.css. */
export const GRID_SIZE = 20;

/**
 * Grid-snap state.
 *
 * Snapping used to be hardcoded into every object's `dragBoundFunc`, applied
 * unconditionally, which made precise placement impossible and quantised
 * physics throws onto grid intersections.
 *
 * The modifier is tracked here with a single pair of window listeners rather
 * than per-object subscriptions — with 100+ objects on the canvas, one
 * listener each would be 100 listeners firing on every keypress.
 *
 * Ctrl/Cmd is the modifier because Shift and Alt are already claimed during a
 * drag by the attract/repel physics gestures.
 */
class GridSnapController {
  private modifierHeld = false;
  private installed = false;

  install() {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;

    const sync = (e: KeyboardEvent) => {
      this.modifierHeld = e.ctrlKey || e.metaKey;
    };
    // Releasing the modifier outside the window (alt-tab) would otherwise
    // leave it stuck on.
    const clear = () => {
      this.modifierHeld = false;
    };

    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
  }

  get isModifierHeld() {
    return this.modifierHeld;
  }

  /**
   * The modifier *inverts* the current setting rather than only enabling
   * snapping, so it can be used to temporarily break out of the grid when
   * snapping is switched on — the convention in Figma and Illustrator.
   */
  shouldSnap(): boolean {
    return useStore.getState().snapToGrid !== this.modifierHeld;
  }

  snapPoint(x: number, y: number) {
    return {
      x: Math.round(x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(y / GRID_SIZE) * GRID_SIZE,
    };
  }
}

export const gridSnap = new GridSnapController();
gridSnap.install();
