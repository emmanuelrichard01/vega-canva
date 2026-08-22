/**
 * Programmatic viewport navigation helper.
 * Dispatches a CustomEvent caught by the Canvas navigation listener.
 */
export const navigateToViewport = (x: number, y: number, zoom: number, immediate: boolean = false) => {
  window.dispatchEvent(new CustomEvent('navigateViewport', { detail: { x, y, zoom, immediate } }));
};
