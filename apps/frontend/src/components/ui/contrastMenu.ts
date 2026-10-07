import { toggleContrast } from '../../engine/ui/contrast';
import type { MenuItemEntry } from '../menu/menuModel';

/**
 * The same setting as a menu row, for the View submenu. A checkbox row, so it
 * reads as one switch: checked means increased contrast is in effect, whatever
 * put it there. Selecting it pins the opposite of what is showing.
 */
export function contrastMenuItem(enhanced: boolean): MenuItemEntry {
  return {
    kind: 'item',
    id: 'view-increase-contrast',
    label: 'Increase contrast',
    detail: 'Stronger text, borders and focus rings',
    shortcut: 'Mod+Alt+C',
    checked: enhanced,
    keepOpen: true,
    onSelect: toggleContrast,
  };
}
