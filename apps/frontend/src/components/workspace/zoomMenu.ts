import type { MenuEntry } from '../menu/menuModel';
import { SHORTCUTS } from '../menu/shortcuts';

/**
 * The zoom control's menu and its typed value, kept apart from the component
 * so what a keystroke means can be asserted without a camera.
 */

/** The fixed stops the menu offers, in percent. */
export const ZOOM_PRESETS = [50, 100, 200] as const;

/**
 * A typed zoom, as a camera factor, or `null` for something that is not one.
 *
 * Takes what people type into a zoom field in other tools: `150`, `150%`,
 * `1.5x`. A bare number is always a percentage, because that is the unit the
 * field displays. Clamped to the camera's limits rather than refused, so
 * typing `1000` lands on the ceiling instead of doing nothing.
 */
export function parseZoomInput(text: string, limits: { minZoom: number; maxZoom: number }): number | null {
  // A comma is a decimal point in much of the world: 1,5x is 1.5x.
  const cleaned = text.trim().toLowerCase().replace(/\s+/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const times = /^(\d+(?:\.\d+)?|\.\d+)x$/.exec(cleaned);
  const percent = /^(\d+(?:\.\d+)?|\.\d+)%?$/.exec(cleaned);
  let factor: number;
  if (times) factor = Number(times[1]);
  else if (percent) factor = Number(percent[1]) / 100;
  else return null;
  if (!Number.isFinite(factor) || factor <= 0) return null;
  return Math.min(limits.maxZoom, Math.max(limits.minZoom, factor));
}

export interface ZoomMenuActions {
  zoomIn: () => void;
  zoomOut: () => void;
  fitAll: () => void;
  zoomToSelection: () => void;
  setZoom: (factor: number) => void;
}

/** The rows, given whether anything is selected and the zoom shown now (percent). */
export function zoomMenuEntries(
  state: {
    hasSelection: boolean;
    percent: number;
    /** False on an empty board, where there is nothing to fit. Defaults to true. */
    hasContent?: boolean;
    /** At the zoom limits, the step that cannot go further is off, with the reason. */
    atMin?: boolean;
    atMax?: boolean;
  },
  actions: ZoomMenuActions
): MenuEntry[] {
  return [
    { kind: 'item', id: 'zoom-in', label: 'Zoom in', shortcut: SHORTCUTS.zoomIn, keepOpen: true, disabled: state.atMax || undefined, disabledReason: state.atMax ? 'Already at the closest zoom' : undefined, onSelect: actions.zoomIn },
    { kind: 'item', id: 'zoom-out', label: 'Zoom out', shortcut: SHORTCUTS.zoomOut, keepOpen: true, disabled: state.atMin || undefined, disabledReason: state.atMin ? 'Already at the farthest zoom' : undefined, onSelect: actions.zoomOut },
    { kind: 'separator', id: 's1' },
    {
      kind: 'item',
      id: 'zoom-fit',
      label: 'Fit all',
      shortcut: SHORTCUTS.zoomFit,
      disabled: state.hasContent === false || undefined,
      disabledReason: state.hasContent === false ? 'Nothing on the board yet' : undefined,
      onSelect: actions.fitAll,
    },
    {
      kind: 'item',
      id: 'zoom-selection',
      label: 'Zoom to selection',
      shortcut: SHORTCUTS.zoomSelection,
      disabled: !state.hasSelection,
      disabledReason: state.hasSelection ? undefined : 'Select something first',
      onSelect: actions.zoomToSelection,
    },
    { kind: 'separator', id: 's2' },
    ...ZOOM_PRESETS.map((p): MenuEntry => ({
      kind: 'item',
      id: `zoom-${p}`,
      label: `${p}%`,
      shortcut: p === 100 ? SHORTCUTS.zoomReset : undefined,
      checked: state.percent === p ? true : undefined,
      onSelect: () => actions.setZoom(p / 100),
    })),
  ];
}
