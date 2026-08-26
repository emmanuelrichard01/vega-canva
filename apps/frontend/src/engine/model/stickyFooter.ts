/**
 * The bottom band of a sticky note: who wrote it, and who reacted.
 *
 * ## Why the band is a constant height
 *
 * It was reserved only when the note had reactions — twenty-six pixels with,
 * eighteen without — and the text was fitted into whatever was left. So the
 * first person to react to a note **made its handwriting smaller**: the box
 * lost eight pixels, `stickyFit` searched again, found a size a step down, and
 * every line re-wrapped and re-centred. Taking the reaction away gave the space
 * back and moved it all again.
 *
 * A note's text must not resize because somebody liked it. The author's chip is
 * drawn in that band whether or not anyone has reacted, so the band is always
 * occupied and is now always reserved. The reactions sit beside the chip in
 * space that was never the text's to begin with.
 *
 * That also fixes the quieter half of the same bug: the reaction row appears on
 * *hover* as well, and on a note with no reactions the text had been laid out
 * with no band at all — so pointing at a note dropped a row of chips on top of
 * its last line.
 */

/** The band along the bottom, holding the author chip and any reactions. */
export const FOOTER_BAND = 26;

/** The strip along the top that tags occupy, when a note has any. */
export const TAG_BAND = 16;

/** How far in from the right the pin sits, and so how much the tags must leave it. */
export const PIN_INSET = 24;

export interface ReactionChip {
  emoji: string;
  ids: string[];
  /** Chip width: wider when it carries a count as well as the emoji. */
  width: number;
  /** Where it starts, relative to the run of chips. */
  offset: number;
}

export interface FooterLayout {
  visible: ReactionChip[];
  /** Reactions that did not fit, reachable through the overflow badge. */
  overflow: Array<[string, string[]]>;
  /** Where the overflow badge goes, when there is one. */
  overflowOffset: number;
  /** Where the add button goes, after everything else. */
  addOffset: number;
}

const CHIP_GAP = 4;
const CHIP_SOLO = 28;
const CHIP_COUNTED = 40;
const OVERFLOW_WIDTH = 24;

/**
 * Which reaction chips fit along the bottom of a note this wide.
 *
 * ## The rule
 *
 * Chips are laid left to right until one would not fit. Everything from that
 * one on goes to the overflow badge — including chips that *would* have fitted
 * later, because reordering them would mean the same note showed its reactions
 * in a different order as it was resized.
 *
 * A chip is only placed if the badge that may be needed after it also fits.
 * Otherwise the last chip takes the space the badge needed and the badge lands
 * outside the note. The exception is the final chip, which cannot be followed
 * by a badge because there is nothing left to overflow.
 *
 * The version this replaces computed that reservation into a variable and then
 * re-derived it inline at the point of use, so the variable's own branch was
 * dead code — the kind of thing that reads as considered and is not.
 *
 * @param available  the room between the author's chip and the add button.
 */
export function layoutFooter(
  reactions: ReadonlyArray<readonly [string, readonly string[]]>,
  available: number
): FooterLayout {
  const visible: ReactionChip[] = [];
  const overflow: Array<[string, string[]]> = [];
  let used = 0;

  for (let i = 0; i < reactions.length; i++) {
    const [emoji, ids] = reactions[i];
    const width = ids.length > 1 ? CHIP_COUNTED : CHIP_SOLO;
    const isLast = i === reactions.length - 1;
    // Room for this chip, plus the badge it would push everything else into --
    // unless it is the last, in which case there is nothing to overflow.
    const needed = width + CHIP_GAP + (isLast ? 0 : OVERFLOW_WIDTH + CHIP_GAP);

    if (used + needed > available) {
      for (let j = i; j < reactions.length; j++) {
        overflow.push([reactions[j][0], [...reactions[j][1]]]);
      }
      break;
    }

    visible.push({ emoji, ids: [...ids], width, offset: used });
    used += width + CHIP_GAP;
  }

  return {
    visible,
    overflow,
    overflowOffset: used,
    addOffset: used + (overflow.length > 0 ? OVERFLOW_WIDTH + CHIP_GAP : 0),
  };
}

/**
 * The box the note's own text gets, once the bands are taken out.
 *
 * One function so the fit and the `<Text>` that draws it cannot disagree about
 * where the words go — they used to compute this separately from the same
 * fields, which is how the two ended up using different definitions of whether
 * there was a footer at all.
 */
export function textBox(
  width: number,
  height: number,
  padding: number,
  hasTags: boolean
): { x: number; y: number; width: number; height: number } {
  const top = padding + (hasTags ? TAG_BAND : 0);
  return {
    x: padding,
    y: top,
    width: width - padding * 2,
    // Floored, so a note dragged smaller than its own furniture still hands the
    // fitter a box it can search rather than a negative one.
    height: Math.max(1, height - top - padding - FOOTER_BAND),
  };
}
