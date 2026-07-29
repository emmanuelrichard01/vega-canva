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
}
