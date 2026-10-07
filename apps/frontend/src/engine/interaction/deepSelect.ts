/**
 * The "deep" modifier: reach through groups when clicking, and skip group
 * expansion when dragging a marquee.
 *
 * Command on a Mac, Control elsewhere. On a Mac a Control+click is the
 * system's right-click, so Control cannot also mean "deep" there; Control is
 * left free on Windows and Linux for Ctrl+drag, which is the "do not snap"
 * and "do not adopt into a grid" modifier during a move.
 */
export interface DeepModifierState {
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const claimed =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    '';
  return /Mac|iPhone|iPad|iPod/i.test(claimed);
}

export function isDeepSelect(mods: DeepModifierState | null | undefined, mac: boolean = isMacPlatform()): boolean {
  return Boolean(mac ? mods?.metaKey : mods?.ctrlKey);
}
