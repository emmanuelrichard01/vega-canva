/**
 * The widths everything that rises from the dock is built on.
 *
 * Three steps, published as `--flyout-w-sm/md/lg` in `dock.css` (a test keeps
 * the two in step). Each is an outer, border-box width: the panel's own 8px
 * inset is inside it, on both sides.
 *
 * - **sm, 240:** a list of rows, a name and a key each (Select, Text, editing
 *   the dock).
 * - **md, 408:** a library or a sheet (Shapes, Frames, Insert, All tools,
 *   Data, and Grid, Chart and Table on seats of their own). 392 inside, which
 *   is nine 40px shape tiles on a 2px gap with 8px either side.
 * - **lg, 480:** the drawing tray, whose width is its rack of tools plus the
 *   ink well (see `trayLayout`).
 *
 * A panel takes its step and keeps it: a seat menu's row and the sheet that
 * opens above it share one width, so More grows the panel upward only, and the
 * tray is one width whichever tool is in hand.
 */
export const FLYOUT_WIDTHS = { sm: 240, md: 408, lg: 480 } as const;

export type FlyoutSize = keyof typeof FLYOUT_WIDTHS;

/** The inset inside every flyout panel and the tray, on each side. */
export const FLYOUT_INSET = 8;

/** The menus the dock opens, as `ToolWorkspace` names them. */
export type DockMenuId =
  | 'select'
  | 'pen'
  | 'shape'
  | 'frame'
  | 'grid'
  | 'chart'
  | 'table'
  | 'data'
  | 'media'
  | 'block'
  | 'more'
  | 'editing';

/** Which step each menu takes. `pen` is the drawing tray. */
export const MENU_FLYOUT_SIZE: Record<DockMenuId, FlyoutSize> = {
  select: 'sm',
  block: 'sm',
  editing: 'sm',
  shape: 'md',
  frame: 'md',
  grid: 'md',
  chart: 'md',
  table: 'md',
  data: 'md',
  media: 'md',
  more: 'md',
  pen: 'lg',
};

/** The width a sheet inside a panel of `size` has to fill: the panel less its two insets. */
export function sheetWidth(size: FlyoutSize): number {
  return FLYOUT_WIDTHS[size] - 2 * FLYOUT_INSET;
}

/**
 * The seat sheets' tile grids: Chart, Grid and Table, on the md step.
 *
 * Each grid is laid out for the panel it sits in, as the shape library is (see
 * `LIBRARY_LAYOUT`): fixed tiles on a 2px gap, the scroll reaching through the
 * panel's padding to its edges with the scrollbar's gutter reserved on both
 * sides, and the grid centred in what is left. So the insets are equal with an
 * overlay scrollbar, a thin one, or a classic one up to `MAX_SCROLLBAR`.
 *
 * Before this the sheets stretched their tiles to whatever the panel was
 * (`minmax(0, 1fr)`): on the md step that made 94-129px cards around 24px
 * glyphs, and a scrollbar on one side only left the grid 8px from one edge and
 * 18px from the other.
 *
 * - **chart, grid:** four 92px cards, a 44px-tall picture over its name: room
 *   for the 56 x 42 illustrated tiles the chart and grid kinds wear.
 * - **table:** three 124px cards, a finished table in miniature over its name:
 *   a table is recognised by its header row, which needs the width.
 */
export interface SheetLayout {
  cols: number;
  tile: number;
  gap: number;
  /** The picture's box inside a card. */
  pic: { width: number; height: number };
}

export const SHEET_LAYOUT = {
  chart: { cols: 4, tile: 92, gap: 2, pic: { width: 72, height: 44 } },
  grid: { cols: 4, tile: 92, gap: 2, pic: { width: 72, height: 44 } },
  table: { cols: 3, tile: 124, gap: 2, pic: { width: 96, height: 56 } },
} as const satisfies Record<string, SheetLayout>;

/** The widest classic scrollbar the sheets leave room for, on both sides. */
export const MAX_SCROLLBAR = 13;

/** A sheet's grid width: its tiles and the gaps between them. */
export function sheetGrid(layout: SheetLayout): number {
  return layout.cols * layout.tile + (layout.cols - 1) * layout.gap;
}

/**
 * The drawing tray's geometry, one per breakpoint.
 *
 * Its top row is the rack of six tools, a rule, and the ink well; the well
 * takes what the rack leaves, so the last swatch ends exactly one inset from
 * the right edge, as the first tool starts one inset from the left. Under the
 * row, the options for the tool in hand sit in a row of fixed height, so
 * nothing the tool changes can move an edge.
 *
 * - `art` (wider than 900px): the tools as objects, 36px apiece, in a
 *   sunken rack with 4px of padding; lg.
 * - `glyph` (900px and narrower): the same tools as 32px icon buttons, and
 *   26px swatches; md.
 */
export type TrayMode = 'art' | 'glyph';

export interface TrayLayout {
  size: FlyoutSize;
  width: number;
  inset: number;
  rack: number;
  /** A pen's slot in the rack. */
  tool: number;
  /**
   * The sticky pad's slot: wider than a pen's with the art, because the pad
   * is a square of paper drawn in a 40-unit box where a pen is 32, and in a
   * pen's 36px slot it ran into the gap and the rack's padding. With glyphs
   * every slot is the same icon button.
   */
  stickyTool: number;
  /** Space either side of the rule between the rack and the well. */
  ruleMargin: number;
  well: number;
  /** Ink swatch buttons, square. */
  swatch: number;
  /** The fewest pixels between two swatches. */
  minSwatchGap: number;
  /** Swatch slots the well is built for: the theme ink and five more. */
  slots: number;
  /** The options row under the tools. */
  optionsHeight: number;
  /** The rack's height, which is the top row's. */
  rowHeight: number;
}

const TOOLS = 6;
const TOOL_GAP = 2;
const RULE = 1;

export function trayLayout(mode: TrayMode): TrayLayout {
  const size: FlyoutSize = mode === 'art' ? 'lg' : 'md';
  const width = FLYOUT_WIDTHS[size];
  const tool = mode === 'art' ? 36 : 32;
  const stickyTool = mode === 'art' ? 44 : tool;
  const rackPad = mode === 'art' ? 4 : 0;
  // Five pens and the pad.
  const rack = (TOOLS - 1) * tool + stickyTool + (TOOLS - 1) * TOOL_GAP + 2 * rackPad;
  const ruleMargin = mode === 'art' ? 12 : 8;
  const well = width - 2 * FLYOUT_INSET - rack - 2 * ruleMargin - RULE;
  return {
    size,
    width,
    inset: FLYOUT_INSET,
    rack,
    tool,
    stickyTool,
    ruleMargin,
    well,
    // 26 in the narrower tray: still past the 24px target floor.
    swatch: mode === 'art' ? 28 : 26,
    minSwatchGap: 2,
    slots: 6,
    optionsHeight: 32,
    rowHeight: mode === 'art' ? 66 : 32,
  };
}

/** The layout as the custom properties `dock.css` reads. */
export function trayVars(layout: TrayLayout): Record<string, string> {
  return {
    '--tray-w': `${layout.width}px`,
    '--tray-rack-w': `${layout.rack}px`,
    '--tray-tool-w': `${layout.tool}px`,
    '--tray-sticky-w': `${layout.stickyTool}px`,
    '--tray-rule-margin': `${layout.ruleMargin}px`,
    '--tray-well-w': `${layout.well}px`,
    '--tray-swatch': `${layout.swatch}px`,
    '--tray-options-h': `${layout.optionsHeight}px`,
  };
}
