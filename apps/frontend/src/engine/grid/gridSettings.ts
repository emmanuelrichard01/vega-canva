/**
 * A deliberate request to see a grid's full settings.
 *
 * Selecting a grid shows only the contextual rail; the right panel is never
 * opened for it. This is the way in on purpose: the rail's "Grid settings"
 * button dispatches it, and the room opens the properties panel and brings the
 * grid section into view.
 */
export const GRID_SETTINGS_EVENT = 'requestGridSettings';

export function requestGridSettings(id: string): void {
  window.dispatchEvent(new CustomEvent(GRID_SETTINGS_EVENT, { detail: { id } }));
}
