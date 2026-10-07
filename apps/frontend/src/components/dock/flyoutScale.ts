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
  const rackPad = mode === 'art' ? 4 : 0;
  const rack = TOOLS * tool + (TOOLS - 1) * TOOL_GAP + 2 * rackPad;
  const ruleMargin = mode === 'art' ? 12 : 8;
  const well = width - 2 * FLYOUT_INSET - rack - 2 * ruleMargin - RULE;
  return {
    size,
    width,
    inset: FLYOUT_INSET,
    rack,
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
    '--tray-rule-margin': `${layout.ruleMargin}px`,
    '--tray-well-w': `${layout.well}px`,
    '--tray-swatch': `${layout.swatch}px`,
    '--tray-options-h': `${layout.optionsHeight}px`,
  };
}
