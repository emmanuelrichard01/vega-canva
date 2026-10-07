/**
 * Whether a key press belongs to whatever has focus rather than to the canvas.
 *
 * One guard for every canvas shortcut, so Delete cannot remove the selection
 * while someone is choosing from a `<select>` or editing a contentEditable,
 * and Enter cannot be swallowed while a button has focus.
 *
 * - Anything that takes text or a choice owns every key.
 * - Anything inside a dialog owns every key: the board is behind it.
 * - A focused button, link or menu item owns the keys that activate it
 *   (Enter, Space). Other keys still reach the board, because clicking a
 *   toolbar button focuses it and Delete must keep working afterwards.
 */
const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'spinbutton', 'slider', 'menu', 'menubar']);
const ACTIVATABLE_ROLES = new Set(['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'tab', 'checkbox', 'radio', 'switch']);

export function keyBelongsToFocus(
  key: string,
  el: Element | null = typeof document !== 'undefined' ? document.activeElement : null
): boolean {
  if (!el || el === document.body || el === document.documentElement) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable || el.closest('[contenteditable=""], [contenteditable="true"]')) return true;
  const role = el.getAttribute('role');
  if (role && TEXT_ROLES.has(role)) return true;
  if (el.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .layers-panel')) return true;
  if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true;
    if (role && ACTIVATABLE_ROLES.has(role)) return true;
  }
  return false;
}
