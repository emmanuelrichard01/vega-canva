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
 *
 * ## Why the two axes are the same shape
 *
 * The first version was flat — `{ columns, gutter, margin }` — which reads
 * well until rows arrive and there is nowhere symmetrical to put them:
 * `rowGutter` and `rowMargin` beside a bare `gutter` makes one axis the
 * default and the other an afterthought, and every reader then has to know
 * which of the two spellings it is looking at.
 *
 * A guide is two optional axes of identical shape. Columns divide the width,
 * rows divide the height, and every function below takes one axis and one
 * extent — so the arithmetic is written once and the caller says which way it
 * is pointing.
 */

/** One axis of a measure: how many tracks, and the space around and between them. */
export interface LayoutAxis {
  /**
   * How many tracks this axis divides into.
   *
   * Twelve is the usual answer for columns, and it is twelve because of what
   * it *factors into*: halves, thirds, quarters and sixths all land on a track
   * boundary, which is why the web settled on twelve rather than on ten.
   */
  count: number;
  /** Space between tracks, in world units. */
  gutter: number;
  /** Inset from the two edges this axis runs between. */
  margin: number;
}

export interface LayoutGuide {
  /** Vertical tracks, dividing the frame's width. */
  columns?: LayoutAxis;
  /** Horizontal tracks, dividing its height. */
  rows?: LayoutAxis;
}

export const DEFAULT_COLUMNS: LayoutAxis = { count: 12, gutter: 24, margin: 48 };

/**
 * Rows default to fewer tracks and no margin, and both are deliberate.
 *
 * A horizontal measure is almost always a *baseline rhythm* rather than a
 * division into equal bands — you are spacing headings and paragraphs down a
 * page, not filling eight stacked boxes. So it starts at eight rather than
 * twelve, and at no margin, because a top and bottom inset is what the frame's
 * safe area already says and repeating it here would draw two guides along the
 * same two edges.
 */
export const DEFAULT_ROWS: LayoutAxis = { count: 8, gutter: 24, margin: 0 };

/** The measures worth one click. Short, for the reason every list here is. */
export const LAYOUT_GUIDE_PRESETS: { id: string; label: string; guide: LayoutGuide }[] = [
  { id: '12', label: '12 column', guide: { columns: { count: 12, gutter: 24, margin: 48 } } },
  { id: '8', label: '8 column', guide: { columns: { count: 8, gutter: 20, margin: 40 } } },
  { id: '4', label: '4 column', guide: { columns: { count: 4, gutter: 16, margin: 24 } } },
  {
    id: '12x8',
    label: '12 × 8',
    guide: { columns: { count: 12, gutter: 24, margin: 48 }, rows: { count: 8, gutter: 24, margin: 0 } },
  },
];

export interface Band {
  /** Start, along this axis, relative to the frame's own origin. */
  start: number;
  size: number;
}

/**
 * The tracks of one axis, in the frame's own coordinates.
 *
 * Takes an extent rather than a frame, so the same function divides a width
 * into columns and a height into rows. Writing it once is the whole reason the
 * two axes have the same shape.
 *
 * Empty when the measure cannot be drawn, which is the honest answer for three
 * separate cases rather than three special cases at every reader:
 *
 * - **No tracks.** Zero or fewer is not a measure.
 * - **The margins have eaten the frame.** Two 400-unit margins on a 600-wide
 *   frame leave nothing, and a negative size drawn as a rectangle is an
 *   inside-out band that reads as a rendering fault.
 * - **The gutters have eaten what was left.** Twelve tracks with a 100-unit
 *   gutter needs 1100 units of gap before a single track exists.
 *
 * A caller gets a list to draw and a list to snap to, and an empty one means
 * "there is nothing here" in both — so neither has to know why.
 */
export function axisBands(extent: number, axis: LayoutAxis | undefined): Band[] {
  if (!axis) return [];

  const count = Math.floor(axis.count);
  if (count < 1) return [];

  const margin = Math.max(0, axis.margin);
  const gutter = Math.max(0, axis.gutter);

  const usable = extent - margin * 2;
  const gaps = gutter * (count - 1);
  const size = (usable - gaps) / count;
  if (!(size > 0)) return [];

  const bands: Band[] = [];
  for (let i = 0; i < count; i += 1) {
    bands.push({ start: margin + i * (size + gutter), size });
  }
  return bands;
}

/**
 * Every coordinate a dragged edge could sensibly land on, in **world** space.
 *
 * Both sides of every track, because content is placed against a track's
 * leading edge as often as it is stretched to its trailing one — and a
 * multi-track block ends on some other track's trailing edge, which is already
 * in this list.
 *
 * The margins are the first and last of these by construction: the first track
 * starts at the leading margin and the last ends at the trailing one. That is
 * worth knowing rather than adding separately, because adding them would put
 * duplicate candidates in the snap set and make a margin twice as sticky as
 * the tracks beside it.
 */
export function guideEdges(
  frame: { x: number; y: number; width: number; height: number },
  guide: LayoutGuide | undefined,
): { x: number[]; y: number[] } {
  const edge = (origin: number, bands: Band[]) => {
    const out: number[] = [];
    for (const band of bands) out.push(origin + band.start, origin + band.start + band.size);
    return out;
  };
  return {
    x: edge(frame.x, axisBands(frame.width, guide?.columns)),
    y: edge(frame.y, axisBands(frame.height, guide?.rows)),
  };
}

/** Whether a guide would draw anything at all. */
export function guideDraws(
  frame: { width: number; height: number },
  guide: LayoutGuide | undefined,
): boolean {
  if (!guide) return false;
  return (
    axisBands(frame.width, guide.columns).length > 0 ||
    axisBands(frame.height, guide.rows).length > 0
  );
}
