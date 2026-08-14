/**
 * The surface colour for a small plate drawn *on the canvas* — a connector's
 * label, a port ring, anything that has to stay readable over whatever is
 * behind it.
 *
 * Taken as a parameter rather than read from the DOM so callers that already
 * subscribe to the theme reactively can pass what they have, and so this stays
 * a pure function. `ThemeService.getCanvasPlateFill()` is the DOM-reading
 * wrapper for callers that cannot use a hook.
 *
 * ## Why this exists at all
 *
 * Konva paints into a canvas, and a canvas fill is parsed by the 2D context,
 * not by CSS — it has no element to resolve a custom property against. A
 * `var(--surface-elevated)` handed to a Konva `fill` is simply an unparseable
 * colour string, and the spec says an unparseable fill leaves the previous
 * value in place, which in practice means the default: opaque black. So it
 * fails *silently and plausibly*, as a black plate rather than an error. Every
 * colour that reaches the canvas has to be a literal.
 */
export function canvasPlateFill(dark: boolean): string {
  return dark ? '#27272A' : '#FFFFFF';
}

export class ThemeService {
  /**
   * Returns true if the app is currently in Dark Mode.
   * This relies on the global 'dark-theme' class on the body, 
   * which is the standard way the app handles theme toggling.
   */
  static isDarkMode(): boolean {
    if (typeof document === 'undefined') return false;
    return document.body.classList.contains('dark-theme');
  }

  /**
   * Returns the ideal high-contrast text color based on the current theme.
   */
  static getDefaultTextColor(): string {
    return this.isDarkMode() ? '#F9FAFB' : '#1F2937';
  }

  /**
   * Default fill for a newly drawn shape.
   *
   * This used to return zinc-100 (`#F4F4F5`) in light mode — a near-white
   * fill, paired with a zinc-200 stroke, on a white canvas — so a freshly
   * drawn rectangle was all but invisible against the background, which reads
   * as "the shape tool didn't work". A new object has to be visible the
   * instant it is created; it can always be recoloured afterwards.
   */
  static getDefaultShapeFill(): string {
    return this.isDarkMode() ? '#3F3F46' : '#DBEAFE'; // zinc-700 / blue-100
  }

  /**
   * Default stroke, chosen to hold a clear edge against the fill above in
   * both themes.
   */
  static getDefaultStrokeColor(): string {
    return this.isDarkMode() ? '#A1A1AA' : '#3B82F6'; // zinc-400 / blue-500
  }

  /** See `canvasPlateFill`. */
  static getCanvasPlateFill(): string {
    return canvasPlateFill(this.isDarkMode());
  }
}
