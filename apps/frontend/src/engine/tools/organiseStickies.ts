import { STICKY_THEMES, type StickyNode, type StickyTheme } from '../model/schema';
import { applyNodePatches } from '../document';

/**
 * Organise a selection of sticky notes into groups.
 *
 * The move a facilitator makes after a brainstorm: pull the notes apart by
 * colour, or by who wrote them, so the board can be read in clusters. Each
 * group becomes a compact block of rows, and blocks sit side by side in a
 * stable order, starting where the selection's top-left corner was.
 *
 * Positions only. Nothing is created or restyled, so one Undo puts every
 * note back where it was.
 */

export type OrganiseBy = 'theme' | 'author';

/** Gap between notes inside a group. */
export const NOTE_GAP = 24;
/** Gap between neighbouring groups; wide enough to read as a separation. */
export const GROUP_GAP = 96;

export interface OrganisePatch {
  id: string;
  changes: { x: number; y: number };
}

export interface OrganiseGroup {
  key: string;
  label: string;
  ids: string[];
}

function readingOrder(a: StickyNode, b: StickyNode): number {
  // Rows first, with half a note of tolerance so a slightly ragged row still
  // reads left to right.
  const rowTolerance = Math.min(a.height, b.height) / 2;
  if (Math.abs(a.y - b.y) > rowTolerance) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The groups a selection splits into, in display order. */
export function groupStickies(notes: readonly StickyNode[], by: OrganiseBy): OrganiseGroup[] {
  const buckets = new Map<string, { label: string; notes: StickyNode[] }>();
  for (const note of notes) {
    const key = by === 'theme' ? note.theme : note.author?.id || 'unknown';
    const label = by === 'theme' ? note.theme : note.author?.name || 'Unknown';
    const bucket = buckets.get(key) ?? { label, notes: [] };
    bucket.notes.push(note);
    buckets.set(key, bucket);
  }

  const themeRank = (key: string) => {
    const i = STICKY_THEMES.indexOf(key as StickyTheme);
    return i === -1 ? STICKY_THEMES.length : i;
  };

  return [...buckets.entries()]
    .sort(([ka, a], [kb, b]) =>
      by === 'theme'
        ? themeRank(ka) - themeRank(kb)
        : // Largest contribution first, then by name, so the order is stable.
          b.notes.length - a.notes.length || a.label.localeCompare(b.label) || (ka < kb ? -1 : 1)
    )
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      ids: [...bucket.notes].sort(readingOrder).map((n) => n.id),
    }));
}

/** The position every note takes. Pure. */
export function organiseStickies(notes: readonly StickyNode[], by: OrganiseBy): OrganisePatch[] {
  if (notes.length < 2) return [];

  const byId = new Map(notes.map((n) => [n.id, n]));
  const cellW = Math.max(...notes.map((n) => n.width));
  const cellH = Math.max(...notes.map((n) => n.height));
  const originX = Math.min(...notes.map((n) => n.x));
  const originY = Math.min(...notes.map((n) => n.y));

  const patches: OrganisePatch[] = [];
  let cursorX = originX;

  for (const group of groupStickies(notes, by)) {
    // Roughly square blocks read best, capped so a large group stays a column
    // block rather than a long ribbon.
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(group.ids.length))));
    group.ids.forEach((id, index) => {
      const note = byId.get(id)!;
      const col = index % cols;
      const row = Math.floor(index / cols);
      patches.push({
        id,
        changes: {
          // Centred in its cell, so mixed sizes still line up on their middles.
          x: Math.round(cursorX + col * (cellW + NOTE_GAP) + (cellW - note.width) / 2),
          y: Math.round(originY + row * (cellH + NOTE_GAP) + (cellH - note.height) / 2),
        },
      });
    });
    cursorX += cols * cellW + (cols - 1) * NOTE_GAP + GROUP_GAP;
  }

  return patches;
}

/** Organise the stickies among `nodes` as one undoable step. Returns how many moved. */
export function applyOrganiseStickies(nodes: readonly { type: string }[], by: OrganiseBy): number {
  const notes = nodes.filter((n): n is StickyNode => n.type === 'sticky');
  const patches = organiseStickies(notes, by);
  applyNodePatches(patches);
  return patches.length;
}
