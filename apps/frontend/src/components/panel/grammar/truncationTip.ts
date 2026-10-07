/**
 * A tooltip that appears only when text is cut short.
 *
 * The panel truncates rather than widening a row, so a long value (a font
 * name, a column type, an object's name) can end in an ellipsis. On pointer
 * over or focus, this measures `text` and, when it overflows, puts the full
 * text on `host` as its `data-tooltip`; when it fits, it takes it off again.
 * The app's tooltip layer reads the attribute on the same pointerover, after
 * React's handlers have run.
 *
 * `keep` is a tooltip the host has for another reason (why it is disabled);
 * it always wins.
 */
export function showTipIfTruncated(host: HTMLElement, text: HTMLElement | null, keep?: string): void {
  if (keep) {
    host.setAttribute('data-tooltip', keep);
    return;
  }
  const full = text?.textContent?.trim() ?? '';
  if (text && full && text.scrollWidth > text.clientWidth + 1) host.setAttribute('data-tooltip', full);
  else host.removeAttribute('data-tooltip');
}
