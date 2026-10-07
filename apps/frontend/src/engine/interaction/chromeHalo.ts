/**
 * The board surface colour, for drawing a halo under canvas chrome.
 *
 * Konva cannot read CSS custom properties, so the value is read from the
 * element that carries the theme class (`body`, see App.tsx). Read at render,
 * so a theme change is picked up on the next draw.
 */
export function chromeSurfaceColor(): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return '#FFFFFF';
  try {
    const value = getComputedStyle(document.body).getPropertyValue('--surface-primary').trim();
    return value || (document.body.classList.contains('dark-theme') ? '#18181B' : '#FFFFFF');
  } catch {
    return '#FFFFFF';
  }
}

/** Halo width in screen pixels on each side of the line it sits under. */
export const HALO_PX = 2;
