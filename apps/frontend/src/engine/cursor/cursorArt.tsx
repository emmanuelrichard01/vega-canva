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
const SIZE = 28;

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
const ARROW_D =
  'M5.65376 21.2183L2.36881 2.50576C2.17937 1.42629 3.32766 0.584311 4.30138 1.08742L21.2335 9.83549C22.2599 10.366 22.1802 11.8315 21.1011 12.2612L13.8821 15.1363C13.5604 15.2644 13.3082 15.5146 13.1782 15.8361L10.2828 23.0132C9.84996 24.0864 8.38466 24.1565 7.86311 23.1239L5.65376 21.2183Z';

const Arrow = () => (
  <g transform="scale(0.82)">
    <path d={ARROW_D} fill={PAPER} stroke={INK} strokeWidth={1.7} strokeLinejoin="round" />
  </g>
);

/**
 * A tool glyph in the arrow's tail.
 *
 * Small and set back on purpose. The first attempt made it two thirds the size
 * of the arrow, which read as two icons colliding rather than as one pointer
 * that knows what it is holding. The arrow itself never changes shape, so the
 * hotspot never appears to move when you switch tools.
 */
const Badge = ({ children }: { children: React.ReactNode }) => (
  <g transform="translate(20 20)">
    <circle cx="0" cy="0" r="7.4" fill={INK} />
    <circle cx="0" cy="0" r="7.4" fill="none" stroke={PAPER} strokeWidth={1.6} />
    <g
      transform="translate(-4.6 -4.6) scale(0.383)"
      stroke={PAPER}
      strokeWidth={5}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </g>
  </g>
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

  erase: {
    ...tip,
    render: () => (
      <Svg>
        <Arrow />
        <Badge>
          <path d="m7 20-3.3-3.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l4.6 4.6a2 2 0 0 1 0 2.8L13 20" />
          <path d="M20 20H7" />
        </Badge>
      </Svg>
    ),
  },

  note: {
    ...tip,
    render: () => (
      <Svg>
        <Arrow />
        <Badge>
          <path d="M4 4h16v10l-6 6H4z" />
          <path d="M20 14h-6v6" />
        </Badge>
      </Svg>
    ),
  },

  comment: {
    ...tip,
    render: () => (
      <Svg>
        <Arrow />
        <Badge>
          <path d="M21 14a2 2 0 0 1-2 2H8l-5 5V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </Badge>
      </Svg>
    ),
  },

  place: {
    ...tip,
    render: () => (
      <Svg>
        <Arrow />
        <Badge>
          <path d="M12 4v16M4 12h16" />
        </Badge>
      </Svg>
    ),
  },
};
