/**
 * Everything on the rail that takes a press: its own buttons, plus the fill and
 * colour swatches, which are shared controls with classes of their own.
 */
export const RAIL_CONTROL_SELECTOR = '.ctx-btn, .fill-swatch, .cp-trigger';

/** Popup surfaces hung off the rail, whose contents are not rail controls. */
export const RAIL_POPUPS = '.ctx-popover, .cpx-popover';

/** The rail's own controls, in order, leaving out anything inside an open popover. */
export function railControls(rail: HTMLElement): HTMLElement[] {
  return Array.from(rail.querySelectorAll<HTMLElement>(RAIL_CONTROL_SELECTOR)).filter(
    (el) => !el.closest(RAIL_POPUPS) && !(el as HTMLButtonElement).disabled
  );
}
