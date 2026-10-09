/**
 * The phone's tool bar, as data.
 *
 * Six seats and More. The six are what a thumb reaches for on a board: pick
 * and move, draw, a note, a shape, words and a connector. The second seat is
 * Draw, and wears Hand while Hand is armed from More, so panning by tool is
 * one tap away from where drawing was without costing a seat (two fingers pan
 * whatever is armed). Everything, the six included, is listed once in More,
 * grouped the way the desktop's All tools groups them.
 */

export type PhoneGlyph =
  | 'select' | 'direct-select' | 'hand' | 'pen' | 'marker' | 'highlighter' | 'eraser' | 'bezier-pen'
  | 'sticky' | 'shape' | 'line' | 'text' | 'connector' | 'frame'
  | 'table' | 'chart' | 'grid' | 'image' | 'audio' | 'link' | 'code' | 'comment';

export interface PhoneTool {
  /** Unique within the bar and the sheet. */
  id: string;
  label: string;
  /** What `legacy_tool_change` arms. */
  tool: string;
  /** The brush to set before arming the pen, for the three pens that share it. */
  brush?: 'pen' | 'marker' | 'highlighter';
  glyph: PhoneGlyph;
}

export interface PhoneToolGroup {
  label: string;
  tools: PhoneTool[];
}

const T = (id: string, label: string, tool: string, glyph: PhoneGlyph, brush?: PhoneTool['brush']): PhoneTool =>
  brush ? { id, label, tool, glyph, brush } : { id, label, tool, glyph };

export const PHONE_TOOLS = {
  select: T('select', 'Select', 'select', 'select'),
  directSelect: T('direct-select', 'Direct select', 'direct-select', 'direct-select'),
  hand: T('hand', 'Hand', 'hand', 'hand'),
  draw: T('draw', 'Draw', 'pen', 'pen'),
  pen: T('pen', 'Pen', 'pen', 'pen', 'pen'),
  marker: T('marker', 'Marker', 'pen', 'marker', 'marker'),
  highlighter: T('highlighter', 'Highlighter', 'pen', 'highlighter', 'highlighter'),
  eraser: T('eraser', 'Eraser', 'eraser', 'eraser'),
  vectorPen: T('bezier-pen', 'Vector pen', 'bezier-pen', 'bezier-pen'),
  sticky: T('sticky', 'Note', 'sticky', 'sticky'),
  shape: T('shape', 'Shape', 'shape-rect', 'shape'),
  line: T('line', 'Line', 'shape-arrow', 'line'),
  text: T('text', 'Text', 'text', 'text'),
  connector: T('connector', 'Connect', 'connector', 'connector'),
  frame: T('frame', 'Frame', 'frame', 'frame'),
  table: T('table', 'Table', 'table', 'table'),
  chart: T('chart', 'Chart', 'chart', 'chart'),
  grid: T('grid', 'Layout grid', 'grid', 'grid'),
  image: T('image', 'Image', 'image', 'image'),
  audio: T('audio', 'Voice note', 'audio', 'audio'),
  link: T('link', 'Link card', 'link', 'link'),
  code: T('code', 'Code block', 'code', 'code'),
  comment: T('comment', 'Comment', 'comment', 'comment'),
} as const;

/** The six seats, in order. The second is `draw` or `hand`; see `phonePrimary`. */
export const PHONE_PRIMARY_IDS = ['select', 'draw', 'sticky', 'shape', 'text', 'connector'] as const;

/** Every tool, for the More sheet. Each appears once. */
export const PHONE_TOOL_GROUPS: PhoneToolGroup[] = [
  { label: 'Select and move', tools: [PHONE_TOOLS.select, PHONE_TOOLS.directSelect, PHONE_TOOLS.hand] },
  {
    label: 'Create',
    tools: [PHONE_TOOLS.text, PHONE_TOOLS.sticky, PHONE_TOOLS.shape, PHONE_TOOLS.line, PHONE_TOOLS.connector, PHONE_TOOLS.frame],
  },
  {
    label: 'Draw',
    tools: [PHONE_TOOLS.pen, PHONE_TOOLS.marker, PHONE_TOOLS.highlighter, PHONE_TOOLS.eraser, PHONE_TOOLS.vectorPen],
  },
  { label: 'Data', tools: [PHONE_TOOLS.table, PHONE_TOOLS.chart, PHONE_TOOLS.grid] },
  { label: 'Insert', tools: [PHONE_TOOLS.image, PHONE_TOOLS.audio, PHONE_TOOLS.link, PHONE_TOOLS.code] },
  { label: 'Collaborate', tools: [PHONE_TOOLS.comment] },
];

const isShapeTool = (id: string) => id.startsWith('shape') && !isLineTool(id);
const isLineTool = (id: string) => id === 'shape-line' || id === 'shape-arrow';
const isFrameTool = (id: string) => id === 'frame' || id.startsWith('frame-');
const isDrawTool = (id: string) => id === 'pen' || id === 'bezier-pen' || id === 'eraser';

/** The six seats for what is armed now. */
export function phonePrimary(activeToolId: string): PhoneTool[] {
  return PHONE_PRIMARY_IDS.map((id) =>
    id === 'draw' && activeToolId === 'hand' ? PHONE_TOOLS.hand : PHONE_TOOLS[id]
  );
}

/**
 * Whether a tool's seat or row shows as armed. A seat stands for a family
 * (Select covers Direct select, Draw every pen and the eraser, Shape every
 * shape preset); a row in More is armed only for its own tool, with the pens
 * told apart by `brush`.
 */
export function isPhoneToolActive(
  tool: PhoneTool,
  activeToolId: string,
  opts: { seat?: boolean; brush?: string } = {}
): boolean {
  const { seat = false, brush } = opts;
  switch (tool.id) {
    case 'select':
      return activeToolId === 'select' || (seat && activeToolId === 'direct-select');
    case 'draw':
      return isDrawTool(activeToolId);
    case 'shape':
      return isShapeTool(activeToolId);
    case 'line':
      return isLineTool(activeToolId);
    case 'frame':
      return isFrameTool(activeToolId);
    case 'pen':
    case 'marker':
    case 'highlighter':
      return activeToolId === 'pen' && (brush ?? 'pen') === tool.brush;
    default:
      return activeToolId === tool.tool;
  }
}

/** Whether what is armed has a seat on the bar, so More need not look armed. */
export function armedOnBar(activeToolId: string): boolean {
  return phonePrimary(activeToolId).some((t) => isPhoneToolActive(t, activeToolId, { seat: true }));
}
