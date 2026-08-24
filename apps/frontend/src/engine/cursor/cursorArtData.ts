import React from 'react';
import type { CursorMode } from './toolCursor';

/** Where the art's active point sits, so the wrapper can be placed on the pointer. */
export interface CursorArtSpec {
  /** Offset from the hotspot to the art's top-left corner, in px. */
  offsetX: number;
  offsetY: number;
  render: () => React.ReactNode;
}

/** Rendered 1:1 with the viewBox, so every coordinate below is also a pixel. */
export const CURSOR_SIZE = 28;
const SIZE = CURSOR_SIZE;

/** The arrow's tip inside the box. Both cursors position themselves by it. */
export const ARROW_TIP = { x: 2, y: 1 };
/** Keeps the arrow clear of the badge in its tail. */
export const ARROW_SCALE = 0.82;

export const PAPER = '#FFFFFF';
export const INK = '#141821';

/** Offset and blur. A zero-offset halo is decoration; this is separation. */
const LIFT = 'drop-shadow(0 1.5px 2.5px rgba(0,0,0,0.45))';

export const Svg = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    'svg',
    {
      width: SIZE,
      height: SIZE,
      viewBox: `0 0 ${SIZE} ${SIZE}`,
      fill: 'none',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      style: { display: 'block', filter: LIFT, overflow: 'visible' },
      'aria-hidden': 'true',
    },
    children
  );

/**
 * The arrow. Same geometry as the remote-cursor pointer in `RemoteCursors`.
 */
export const ARROW_D =
  'M5.65376 21.2183L2.36881 2.50576C2.17937 1.42629 3.32766 0.584311 4.30138 1.08742L21.2335 9.83549C22.2599 10.366 22.1802 11.8315 21.1011 12.2612L13.8821 15.1363C13.5604 15.2644 13.3082 15.5146 13.1782 15.8361L10.2828 23.0132C9.84996 24.0864 8.38466 24.1565 7.86311 23.1239L5.65376 21.2183Z';

export const Arrow = () =>
  React.createElement(
    'g',
    { transform: `scale(${ARROW_SCALE})` },
    React.createElement('path', {
      d: ARROW_D,
      fill: PAPER,
      stroke: INK,
      strokeWidth: 1.7,
      strokeLinejoin: 'round',
    })
  );

export const TOOL_GLYPHS: Record<CursorMode, React.ReactNode | null> = {
  pointer: null,
  pan: null,
  grab: null,
  draw: React.createElement('path', { d: 'M4 18C6.5 9.5 13 5.5 20 5.5' }),
  text: React.createElement('path', { d: 'M4 7V4h16v3M12 4v16M9 20h6' }),
  aim: React.createElement(
    React.Fragment,
    null,
    React.createElement('circle', { cx: 12, cy: 12, r: 5.5 }),
    React.createElement('path', { d: 'M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5' })
  ),
  erase: React.createElement(
    React.Fragment,
    null,
    React.createElement('path', { d: 'M18 4L4 18' }),
    React.createElement('path', { d: 'M9 4L4 9' }),
    React.createElement('path', { d: 'M20 15L15 20' })
  ),
  note: React.createElement(
    React.Fragment,
    null,
    React.createElement('path', { d: 'M4 4h16v11l-5 5H4z' }),
    React.createElement('path', { d: 'M15 15h5M15 15v5' })
  ),
  comment: React.createElement('path', {
    d: 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V5z',
  }),
  place: React.createElement(
    React.Fragment,
    null,
    React.createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }),
    React.createElement('path', { d: 'M12 7v10M7 12h10' })
  ),
};

export const GLYPH_BY_TOOL: Record<string, React.ReactNode> = {
  shape: React.createElement('path', { d: 'M4 4h16v16H4z' }),
  'shape-rect': React.createElement('path', { d: 'M4 4h16v16H4z' }),
  'shape-ellipse': React.createElement('circle', { cx: 12, cy: 12, r: 8.5 }),
  'shape-triangle': React.createElement('path', { d: 'M12 3.5 21 20H3z' }),
  'shape-hexagon': React.createElement('path', { d: 'M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z' }),
  'shape-star': React.createElement('path', {
    d: 'M12 3l2.7 6.2 6.3.5-4.8 4.2 1.5 6.1L12 16.8 6.3 20l1.5-6.1L3 9.7l6.3-.5z',
  }),
  audio: React.createElement(
    React.Fragment,
    null,
    React.createElement('path', {
      d: 'M12 2.5a3.5 3.5 0 0 1 3.5 3.5v5a3.5 3.5 0 0 1-7 0V6A3.5 3.5 0 0 1 12 2.5z',
    }),
    React.createElement('path', { d: 'M5 11a7 7 0 0 0 14 0' })
  ),
  image: React.createElement(
    React.Fragment,
    null,
    React.createElement('path', { d: 'M3 5h18v14H3z' }),
    React.createElement('path', { d: 'M3 16l5-5 5 5 3-3 5 5' })
  ),
  'direct-select': React.createElement(
    React.Fragment,
    null,
    React.createElement('path', { d: 'M4 18 C 5 10, 11 8, 19 5' }),
    React.createElement('circle', { cx: 4, cy: 18, r: 2.5 }),
    React.createElement('circle', { cx: 19, cy: 5, r: 2.5 })
  ),
};

/** The glyph a tool wears in a badge: its own, or its cursor mode's. */
export function glyphForTool(toolId: string | undefined, mode: CursorMode): React.ReactNode | null {
  if (toolId && GLYPH_BY_TOOL[toolId]) return GLYPH_BY_TOOL[toolId];
  return TOOL_GLYPHS[mode];
}

export const Cross = ({ gap = 3.4, arm = 7 }: { gap?: number; arm?: number }) => {
  const c = SIZE / 2;
  const d = `M${c} ${c - gap - arm}v${arm}M${c} ${c + gap}v${arm}M${c - gap - arm} ${c}h${arm}M${c + gap} ${c}h${arm}`;
  return React.createElement(
    'g',
    null,
    React.createElement('path', { d, stroke: PAPER, strokeWidth: 3.6 }),
    React.createElement('path', { d, stroke: INK, strokeWidth: 1.5 }),
    React.createElement('circle', {
      cx: c,
      cy: c,
      r: 1.5,
      fill: INK,
      stroke: PAPER,
      strokeWidth: 1.1,
    })
  );
};

export const centred = { offsetX: -SIZE / 2, offsetY: -SIZE / 2 };
export const tip = { offsetX: -2, offsetY: -1 };

export const OPEN_HAND =
  'M8 13.5V8a2 2 0 0 1 4 0v4.2V6a2 2 0 0 1 4 0v6.2V7.6a2 2 0 0 1 4 0V17a8 8 0 0 1-8 8h-1a6 6 0 0 1-4.6-2.2l-3.9-4.7a2 2 0 0 1 2.9-2.7z';

export const CLOSED_HAND =
  'M8 14.6v-1.5a2 2 0 0 1 4 0v-1.2a2 2 0 0 1 4 0v.6a2 2 0 0 1 4 0V17a8 8 0 0 1-8 8h-1a6 6 0 0 1-4.6-2.2l-3.9-4.7a2 2 0 0 1 2.9-2.7z';

const Badge = ({ mode }: { mode: CursorMode }) => {
  const glyph = glyphForTool(undefined, mode);
  if (!glyph) return null;
  return React.createElement(
    'g',
    { transform: 'translate(20 20)' },
    React.createElement('circle', { cx: '0', cy: '0', r: '7.4', fill: INK }),
    React.createElement('circle', { cx: '0', cy: '0', r: '7.4', fill: 'none', stroke: PAPER, strokeWidth: 1.6 }),
    React.createElement(
      'g',
      {
        transform: 'translate(-4.6 -4.6) scale(0.383)',
        stroke: PAPER,
        strokeWidth: 5,
        fill: 'none',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      glyph
    )
  );
};

export const CURSOR_ART: Record<CursorMode, CursorArtSpec> = {
  pointer: { ...tip, render: () => React.createElement(Svg, null, React.createElement(Arrow, null)) },
  pan: {
    ...centred,
    render: () =>
      React.createElement(
        Svg,
        null,
        React.createElement('path', { d: OPEN_HAND, fill: PAPER, stroke: PAPER, strokeWidth: 4.4, strokeLinejoin: 'round' }),
        React.createElement('path', { d: OPEN_HAND, fill: PAPER, stroke: INK, strokeWidth: 1.7, strokeLinejoin: 'round' }),
        React.createElement('path', { d: 'M12 13.4V9.2M16 13.4V8.4', stroke: INK, strokeWidth: 1.3, opacity: 0.55 })
      ),
  },
  grab: {
    ...centred,
    render: () =>
      React.createElement(
        Svg,
        null,
        React.createElement('path', { d: CLOSED_HAND, fill: PAPER, stroke: PAPER, strokeWidth: 4.4, strokeLinejoin: 'round' }),
        React.createElement('path', { d: CLOSED_HAND, fill: PAPER, stroke: INK, strokeWidth: 1.7, strokeLinejoin: 'round' }),
        React.createElement('path', {
          d: 'M10.5 15.2v-2.1M14 14.9v-2.4M17.5 15.1v-2.1',
          stroke: INK,
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          opacity: 0.55,
        })
      ),
  },
  draw: { ...tip, render: () => React.createElement(Svg, null, React.createElement(Arrow, null), React.createElement(Badge, { mode: 'draw' })) },
  text: { ...tip, render: () => React.createElement(Svg, null, React.createElement(Arrow, null), React.createElement(Badge, { mode: 'text' })) },
  aim: { ...centred, render: () => React.createElement(Svg, null, React.createElement(Cross, null)) },
  erase: { ...centred, render: () => React.createElement(Svg, null, React.createElement(Cross, { gap: 4.5, arm: 5 })) },
  note: { ...tip, render: () => React.createElement(Svg, null, React.createElement(Arrow, null), React.createElement(Badge, { mode: 'note' })) },
  comment: { ...tip, render: () => React.createElement(Svg, null, React.createElement(Arrow, null), React.createElement(Badge, { mode: 'comment' })) },
  place: { ...tip, render: () => React.createElement(Svg, null, React.createElement(Arrow, null), React.createElement(Badge, { mode: 'place' })) },
};
