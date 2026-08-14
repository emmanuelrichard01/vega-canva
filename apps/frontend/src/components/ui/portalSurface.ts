/**
 * "This click is still inside my UI, even though the DOM disagrees."
 *
 * Popovers that must escape a clipping ancestor are rendered through a portal
 * onto `document.body`. That solves the clipping and breaks every
 * outside-click handler above them at the same time: `container.contains(e.target)`
 * is false for a portalled panel, so the parent decides the user clicked away
 * and closes — taking the portal with it, mid-interaction.
 *
 * That is exactly what made the colour picker feel broken. Opening it from the
 * fill editor and clicking a swatch, the hue strip or the hex field dismissed
 * the fill editor, which unmounted the picker before the click finished. The
 * control appeared to ignore every input it was given.
 *
 * The fix is a marker on the portalled surface and one shared question, so a
 * future portal cannot quietly reintroduce the same bug by forgetting it.
 */

export const PORTAL_SURFACE_ATTR = 'data-portal-surface';

/**
 * True when the event target sits inside a portalled surface that belongs to
 * the UI — so an outside-click handler should leave it alone.
 */
export function isInsidePortalSurface(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest(`[${PORTAL_SURFACE_ATTR}]`));
}
