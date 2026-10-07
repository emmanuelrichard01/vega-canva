/**
 * Stamps on a sticky note.
 *
 * A stamp is a reaction: stored by `engine/document/reactions.ts` as one
 * `emoji\0authorId` token per person per stamp in a single `Y.Array`, so two
 * people stamping at once both land, nobody can stamp the same thing twice,
 * and taking yours back never touches anyone else's. This module only names
 * the quick set and how each reads aloud.
 *
 * `+1` is the one stamp that is not an emoji. It is the brainstorm vote
 * FigJam made a habit of, stored under the literal key `+1` and drawn as a
 * mark rather than artwork.
 */

export const STAMP_PLUS_ONE = '+1';

/** One press each, in the hover tray: agree, vote, love, star, celebrate, fire. */
export const QUICK_STAMPS: readonly string[] = ['👍', STAMP_PLUS_ONE, '❤️', '⭐', '🎉', '🔥'];

const LABELS: Record<string, string> = {
  '👍': 'Thumbs up',
  [STAMP_PLUS_ONE]: '+1',
  '❤️': 'Love',
  '⭐': 'Star',
  '🎉': 'Celebrate',
  '🔥': 'Fire',
};

/** How a stamp is named in a tooltip: its word for the quick set, else the glyph itself. */
export function stampLabel(stamp: string): string {
  return LABELS[stamp] ?? stamp;
}

