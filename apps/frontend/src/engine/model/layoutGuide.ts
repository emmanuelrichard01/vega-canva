/**
 * The other meaning of "grid": a measure you place things against.
 *
 * ## Two things called grid, and why they are different features
 *
 * `engine/grid/` builds a grid **as objects** — real rectangles you can select,
 * colour and break apart. That is the right tool for a bento wall or a
 * contact sheet, and its own defaults say so: `columns` starts at four rather
 * than twelve, because twelve tracks drawn as objects is twelve tall slivers
 * rather than the four broad columns anyone picturing a column layout has in
 * mind.
 *
 * A **layout guide** is the opposite. It draws nothing that exists: it is
 * chrome over a frame, it never exports, it cannot be selected, and its only
 * job is to give edges for other things to line up against. Twelve columns is
 * completely ordinary here, because nothing is drawn — you are placing content
 * on a measure, not filling modules.
 *
 * The two are not a duplication; they are the two halves of the word, and
 * conflating them is what makes column layout awkward in tools that only ship
 * one of them.
 *
 * ## Why it lives on the frame
 *
 * A measure is a property of the page it measures. Storing it anywhere else —
 * a separate node, a board-level setting — puts it a step away from the thing
 * it belongs to, so moving or resizing a frame would leave its own guide
 * behind, and two frames could not carry different measures.
 */

export interface LayoutGuide {
  /**
   * How many columns the measure divides into.
   *
   * Twelve is the usual answer, and it is twelve because of what it *factors
   * into*: halves, thirds, quarters and sixths all land on a column boundary,
   * which is why the web settled on twelve rather than on ten.
   */
  columns: number;
  /** Space between columns, in world units. */
  gutter: number;
  /** Inset from the frame's left and right edges. */
  margin: number;
}

export const DEFAULT_LAYOUT_GUIDE: LayoutGuide = { columns: 12, gutter: 24, margin: 48 };

/** The measures worth one click. Short, for the reason every list here is. */
export const LAYOUT_GUIDE_PRESETS: { id: string; label: string; guide: LayoutGuide }[] = [
  { id: '12', label: '12 column', guide: { columns: 12, gutter: 24, margin: 48 } },
  { id: '8', label: '8 column', guide: { columns: 8, gutter: 20, margin: 40 } },
  { id: '4', label: '4 column', guide: { columns: 4, gutter: 16, margin: 24 } },
];

export interface Band {
  /** Left edge, relative to the frame's own origin. */
  x: number;
  width: number;
}

/**
 * The columns, in the frame's own coordinates.
 *
 * Empty when the measure cannot be drawn, which is the honest answer for three
 * separate cases rather than three special cases at every reader:
 *
 * - **No columns.** Zero or fewer is not a measure.
 * - **The margins have eaten the frame.** Two 400-unit margins on a 600-wide
 *   frame leave nothing, and a negative width drawn as a rectangle is an
 *   inside-out band that reads as a rendering fault.
 * - **The gutters have eaten what was left.** Twelve columns with a 100-unit
 *   gutter needs 1100 units of gap before a single column exists.
 *
 * A caller gets a list to draw and a list to snap to, and an empty one means
 * "there is nothing here" in both — so neither has to know why.
 */
export function columnBands(frameWidth: number, guide: LayoutGuide | undefined): Band[] {
  if (!guide) return [];

  const columns = Math.floor(guide.columns);
  if (columns < 1) return [];

  const margin = Math.max(0, guide.margin);
  const gutter = Math.max(0, guide.gutter);

  const usable = frameWidth - margin * 2;
  const gaps = gutter * (columns - 1);
  const columnWidth = (usable - gaps) / columns;
  if (!(columnWidth > 0)) return [];

  const bands: Band[] = [];
  for (let i = 0; i < columns; i += 1) {
    bands.push({ x: margin + i * (columnWidth + gutter), width: columnWidth });
  }
  return bands;
}

/**
 * Every x a dragged edge could sensibly land on, in **world** coordinates.
 *
 * Both sides of every column, because content is placed against a column's
 * left edge as often as it is stretched to a column's right one — and a
 * multi-column block ends on some other column's right edge, which is already
 * in this list.
 *
 * The frame's own margins are the first and last of these by construction: the
 * first column starts at the left margin and the last ends at the right one.
 * That is worth knowing rather than adding separately, because adding them
 * would put duplicate candidates in the snap set and make a margin twice as
 * sticky as the columns beside it.
 */
export function columnEdges(
  frame: { x: number; width: number },
  guide: LayoutGuide | undefined,
): number[] {
  const bands = columnBands(frame.width, guide);
  const edges: number[] = [];
  for (const band of bands) {
    edges.push(frame.x + band.x, frame.x + band.x + band.width);
  }
  return edges;
}
