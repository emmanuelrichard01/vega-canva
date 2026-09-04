/**
 * What every tool is called, in the order the dock shows them.
 *
 * The *keys* are not written here — they come from `TOOL_SHORTCUTS`, which is
 * what `Room` actually binds and what the dock badges render. A help screen
 * that hard-codes its own copy of the shortcuts is the worst version of this
 * document: it is the one place a person goes when they are already unsure,
 * and it is the place least likely to be updated when a binding changes.
 * Anything advertised here is bound, by construction.
 *
 * That guarantee only ever covered this one section, and the rest of the file
 * drifted exactly as predicted. Four rows below advertised keys that nothing
 * listened for — `Cmd+A`, plain `Arrows` and `Shift+Arrows`, and `Cmd+0` for
 * a reset bound to bare `0` — while `\`, restacking, `Cmd+B/I/U`, the minimap
 * and the replay bar were all bound and undocumented. Three of the four have
 * since been bound rather than deleted; the fourth was simply wrong.
 *
 * `TOOL_NAMES` is checked against `TOOL_SHORTCUTS` in the tests, because the
 * `?? id` fallback below fails quietly: a new tool would appear on this screen
 * under its internal id, which is worse than not appearing at all.
 */
export const TOOL_NAMES: Record<string, string> = {
  select: 'Select and move',
  'direct-select': 'Direct select: anchors and handles',
  hand: 'Pan the board',
  pen: 'Pencil: freehand',
  'bezier-pen': 'Pen: anchors and curves',
  eraser: 'Eraser',
  text: 'Text',
  shape: 'Shape',
  'shape-line': 'Line / Arrow: press again to switch',
  frame: 'Frame',
  grid: 'Grid: lay out a composition',
  chart: 'Chart: bars, lines, pies',
  connector: 'Connector',
  sticky: 'Sticky note',
  comment: 'Comment',
  image: 'Place an image',
  audio: 'Record a voice note',
};
