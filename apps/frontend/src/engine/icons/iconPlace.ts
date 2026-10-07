import { nanoid } from 'nanoid';
import { editor } from '../api/EditorAPI';
import { nextZIndex } from '../document';
import { canEditObjects } from '../model/permissions';
import { rememberIcon } from './iconStore';
import type { IconEntry } from './iconTypes';

/** The longest side of a newly placed icon, in world units. */
export const ICON_PLACE_SIZE = 64;

/** The size an icon is placed at: its aspect, longest side `ICON_PLACE_SIZE`. */
export function placedSize(entry: Pick<IconEntry, 'v'> | undefined): { width: number; height: number } {
  if (!entry) return { width: ICON_PLACE_SIZE, height: ICON_PLACE_SIZE };
  const [w, h] = entry.v;
  const k = ICON_PLACE_SIZE / Math.max(w, h);
  return { width: Math.max(8, Math.round(w * k)), height: Math.max(8, Math.round(h * k)) };
}

/**
 * Put an icon on the board, centred on `at` (world units), and select it.
 * Returns the new id, or `null` when this person cannot edit.
 */
export function placeIcon(
  ref: { pack: string; iconId: string },
  at: { x: number; y: number },
  entry?: Pick<IconEntry, 'v'>,
  options: { select?: boolean } = {},
): string | null {
  if (!canEditObjects()) return null;
  const size = placedSize(entry);
  const id = nanoid();
  editor.createNode({
    id,
    type: 'icon',
    pack: ref.pack,
    iconId: ref.iconId,
    x: Math.round(at.x - size.width / 2),
    y: Math.round(at.y - size.height / 2),
    ...size,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: nextZIndex(),
  } as never);
  rememberIcon(ref);
  if (options.select !== false) {
    window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: [id] } }));
  }
  return id;
}
