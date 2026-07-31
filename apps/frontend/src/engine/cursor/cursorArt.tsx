import React from 'react';
import type { CursorMode } from './toolCursor';

/**
 * The pointer, drawn.
 *
 * One shape language across every tool: a solid pointer with a small tool badge
 * tucked into its tail, or a crosshair where the job is to hit a point rather
 * than to indicate a direction.
 *
 * ## Why the colours are fixed and not tokens
 *
 * The first version of this drew itself in `--surface-primary` on
 * `--text-primary` so it would adapt to the theme. That is wrong, and looking
 * at it made the reason obvious: **a cursor sits over content, not over the
 * background.** In dark mode a `--surface-primary` fill is near-black, and the
 * pointer vanished into the canvas — it read as a hollow outline. It would have
 * done the same over any dark sticky in light mode.
 *
 * White fill with a near-black outline and a soft shadow is legible over every
 * colour in both themes, which is why every operating system and every canvas
 * tool converges on it. It is not a failure to adapt; it is the thing that
 * actually works.
 */

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

const PAPER = '#FFFFFF';
const INK = '#141821';

/** Offset and blur. A zero-offset halo is decoration; this is separation. */
const LIFT = 'drop-shadow(0 1.5px 2.5px rgba(0,0,0,0.45))';

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg
    width={SIZE}
    height={SIZE}
    viewBox={`0 0 ${SIZE} ${SIZE}`}
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'block', filter: LIFT, overflow: 'visible' }}
    aria-hidden="true"
  >
    {children}
  </svg>
);

/**
 * The arrow. Same geometry as the remote-cursor pointer in `RemoteCursors`, so
 * your pointer and everyone else's are unmistakably the same object — theirs
 * just carries their colour instead of white.
 */
export const ARROW_D =
  'M5.65376 21.2183L2.36881 2.50576C2.17937 1.42629 3.32766 0.584311 4.30138 1.08742L21.2335 9.83549C22.2599 10.366 22.1802 11.8315 21.1011 12.2612L13.8821 15.1363C13.5604 15.2644 13.3082 15.5146 13.1782 15.8361L10.2828 23.0132C9.84996 24.0864 8.38466 24.1565 7.86311 23.1239L5.65376 21.2183Z';

const Arrow = () => (
  <g transform={`scale(${ARROW_SCALE})`}>
    <path d={ARROW_D} fill={PAPER} stroke={INK} strokeWidth={1.7} strokeLinejoin="round" />
  </g>
);

/**
 * One glyph per tool, authored in a 24-unit box.
 *
 * Shared by both cursors on purpose. Your pointer wears a pen badge when you
 * pick up the pen; a collaborator's pointer wears the *same* pen badge in
 * their colour when they pick up theirs. That is the whole reason a
 * collaborator's tool is legible without a legend — it is a shape you have
 * already learned from your own hand.
 *
 * `pan`, `draw`, `text` and `aim` replace your entire local cursor rather than
 * badging it, so those glyphs are only ever drawn on remote pointers. They are
 * defined here anyway so the vocabulary has no holes.
 *
 * **Two or three strokes, and no small features.** The glyph is drawn into a
 * 9-unit disc at `strokeWidth: 5` in its own 24-unit box, which is a very
 * heavy line — a lucide-weight pencil turned into a diagonal slash and an
 * outlined hand into a blob when they were first rendered at size. Anything
 * with an internal detail smaller than about a fifth of the box will close up.
 * Draw these, look at them at 4×, and only then keep them.
 */
export const TOOL_GLYPHS: Record<CursorMode, React.ReactNode | null> = {
  // A plain arrow. Selecting is the default state, and badging the default
  // means every pointer in the room carries a decoration that says nothing.
  pointer: null,
  // Also nothing. Panning changes only what *they* can see; there is no
  // outcome for anyone else to anticipate, and the badge would be noise on the
  // one activity that never touches the document. A hand at this size was also
  // illegible, but that is not why it is gone.
  pan: null,
  // A single confident mark, not a pencil: a drawing implement dissolves at
  // this size. It has to be a *curve* — the first version was near enough to
  // straight that a diagonal bar inside a disc read as a prohibition sign.
  draw: <path d="M4 18C6.5 9.5 13 5.5 20 5.5" />,
  text: <path d="M4 7V4h16v3M12 4v16M9 20h6" />,
  aim: (
    <>
      <circle cx="12" cy="12" r="5.5" />
      <path d="M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5" />
    </>
  ),
  erase: (
    <>
      <path d="m7 20-3.3-3.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l4.6 4.6a2 2 0 0 1 0 2.8L13 20" />
      <path d="M20 20H7" />
    </>
  ),
  note: (
    <>
      <path d="M4 4h16v10l-6 6H4z" />
      <path d="M20 14h-6v6" />
    </>
  ),
  comment: <path d="M21 14a2 2 0 0 1-2 2H8l-5 5V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  place: <path d="M12 4v16M4 12h16" />,
};

/**
 * Glyph overrides keyed by **tool id** rather than by cursor mode.
 *
 * The badge answers a finer question than the cursor does. `image` and `audio`
 * share the `place` cursor because both drop something where you click — but
 * "Priya is placing a thing" and "Priya has a live microphone" are not the
 * same news, and a `+` badge for a recording says nothing at all. Modes stay
 * as coarse as the pointer needs; the badge gets to be specific.
 */
const GLYPH_BY_TOOL: Record<string, React.ReactNode> = {
  // Shapes and the pen share the `draw` cursor because both drag out a region
  // with a crosshair. As a badge that conflates them for no reason: a square
  // says "a box is coming", and it is the single most legible glyph available
  // at this size.
  shape: <path d="M4 4h16v16H4z" />,
  'shape-rect': <path d="M4 4h16v16H4z" />,
  'shape-ellipse': <circle cx="12" cy="12" r="8.5" />,
  'shape-triangle': <path d="M12 3.5 21 20H3z" />,
  'shape-hexagon': <path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z" />,
  'shape-star': <path d="M12 3l2.7 6.2 6.3.5-4.8 4.2 1.5 6.1L12 16.8 6.3 20l1.5-6.1L3 9.7l6.3-.5z" />,
  audio: (
    <>
      {/* Capsule and cradle. The stem below the cradle is dropped — at this
          stroke weight it merges into the arc and reads as a smudge. */}
      <path d="M12 2.5a3.5 3.5 0 0 1 3.5 3.5v5a3.5 3.5 0 0 1-7 0V6A3.5 3.5 0 0 1 12 2.5z" />
      <path d="M5 11a7 7 0 0 0 14 0" />
    </>
  ),
  image: (
    <>
      <path d="M3 5h18v14H3z" />
      <path d="M3 16l5-5 5 5 3-3 5 5" />
    </>
  ),
};

/** The glyph a tool wears in a badge: its own, or its cursor mode's. */
export function glyphForTool(toolId: string | undefined, mode: CursorMode): React.ReactNode | null {
  if (toolId && GLYPH_BY_TOOL[toolId]) return GLYPH_BY_TOOL[toolId];
  return TOOL_GLYPHS[mode];
}

/**
 * The badge in the arrow's tail, in whatever colours the caller needs.
 *
 * Small and set back on purpose. The first attempt made it two thirds the size
 * of the arrow, which read as two icons colliding rather than as one pointer
 * that knows what it is holding. The arrow never changes shape, so the hotspot
 * never appears to move when a tool changes.
 */
export const ToolBadge = ({
  mode,
  tool,
  fill,
  ink,
  ring,
}: {
  mode: CursorMode;
  /** Optional: lets a tool override its mode's glyph. See `GLYPH_BY_TOOL`. */
  tool?: string;
  fill: string;
  ink: string;
  ring: string;
}) => {
  const glyph = glyphForTool(tool, mode);
  if (!glyph) return null;
  return (
    <g transform="translate(20 20)">
      <circle cx="0" cy="0" r="7.4" fill={fill} />
      <circle cx="0" cy="0" r="7.4" fill="none" stroke={ring} strokeWidth={1.6} />
      <g
        transform="translate(-4.6 -4.6) scale(0.383)"
        stroke={ink}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {glyph}
      </g>
    </g>
  );
};

/** Your own badge: dark disc, white glyph, white ring. */
const Badge = ({ mode }: { mode: CursorMode }) => (
  <ToolBadge mode={mode} fill={INK} ink={PAPER} ring={PAPER} />
);

/** Crosshair for the modes that need a point, not a direction. */
const Cross = ({ gap = 3.4, arm = 7 }: { gap?: number; arm?: number }) => {
  const c = SIZE / 2;
  const d = `M${c} ${c - gap - arm}v${arm}M${c} ${c + gap}v${arm}M${c - gap - arm} ${c}h${arm}M${c + gap} ${c}h${arm}`;
  return (
    <g>
      <path d={d} stroke={PAPER} strokeWidth={3.6} />
      <path d={d} stroke={INK} strokeWidth={1.5} />
      <circle cx={c} cy={c} r={1.5} fill={INK} stroke={PAPER} strokeWidth={1.1} />
    </g>
  );
};

const centred = { offsetX: -SIZE / 2, offsetY: -SIZE / 2 };
/** The arrow's tip, in the scaled path's own coordinates. */
const tip = { offsetX: -2, offsetY: -1 };

export const CURSOR_ART: Record<CursorMode, CursorArtSpec> = {
  pointer: { ...tip, render: () => <Svg><Arrow /></Svg> },

  pan: {
    ...centred,
    render: () => {
      // Drawn as one closed silhouette rather than as separate finger strokes.
      // The stroke-based version turned to mush below about 20px, because four
      // outlined fingers two pixels apart stop being four of anything.
      const hand =
        'M8 13.5V8a2 2 0 0 1 4 0v4.2V6a2 2 0 0 1 4 0v6.2V7.6a2 2 0 0 1 4 0V17a8 8 0 0 1-8 8h-1a6 6 0 0 1-4.6-2.2l-3.9-4.7a2 2 0 0 1 2.9-2.7z';
      return (
        <Svg>
          <path d={hand} fill={PAPER} stroke={PAPER} strokeWidth={4.4} strokeLinejoin="round" />
          <path d={hand} fill={PAPER} stroke={INK} strokeWidth={1.7} strokeLinejoin="round" />
          {/* Knuckle lines, so the silhouette still reads as a hand. */}
          <path d="M12 13.4V9.2M16 13.4V8.4" stroke={INK} strokeWidth={1.3} opacity={0.55} />
        </Svg>
      );
    },
  },

  draw: { ...centred, render: () => <Svg><Cross /></Svg> },

  text: {
    ...centred,
    render: () => {
      const d = 'M14 5v18M10.6 5h6.8M10.6 23h6.8';
      return (
        <Svg>
          <path d={d} stroke={PAPER} strokeWidth={4.4} />
          <path d={d} stroke={INK} strokeWidth={1.8} />
        </Svg>
      );
    },
  },

  aim: {
    ...centred,
    // A reticle, not a target. The force tools already draw a field ring on the
    // canvas at the real radius, so the cursor's job is only to mark the centre
    // precisely. The first version used a fine dashed circle, which at 28px
    // stopped resolving as dashes and read as a wireframe globe.
    render: () => (
      <Svg>
        <circle cx={14} cy={14} r={4.6} stroke={PAPER} strokeWidth={3.4} />
        <circle cx={14} cy={14} r={4.6} stroke={INK} strokeWidth={1.5} />
        <Cross gap={6.4} arm={5} />
      </Svg>
    ),
  },

  erase: { ...tip, render: () => <Svg><Arrow /><Badge mode="erase" /></Svg> },
  note: { ...tip, render: () => <Svg><Arrow /><Badge mode="note" /></Svg> },
  comment: { ...tip, render: () => <Svg><Arrow /><Badge mode="comment" /></Svg> },
  place: { ...tip, render: () => <Svg><Arrow /><Badge mode="place" /></Svg> },
};
