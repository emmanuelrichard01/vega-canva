import React from 'react';
import { HAND_OPEN } from '../../engine/cursor/cursorVisual';

/**
 * The dock's glyph set.
 *
 * Hand-authored on one grid so a row of them reads as one family:
 * - a 24-unit box with a 2-unit margin, so the live area is 20;
 * - a 1.75 stroke, round caps and round joins throughout;
 * - corners of 2 on rectangles, and terminals that end square to the stroke;
 * - optical sizes: a square glyph sits in 16, a round or diagonal one reaches
 *   for 18–19, so a table and a pencil look the same size beside each other.
 *
 * The seats draw them at 20px (see `.dock-btn svg`), which puts the stroke at
 * about 1.5 device pixels on a standard display and 3 on a dense one.
 *
 * These are crisp single-weight marks on purpose. The physical, shaded art
 * belongs to the drawing tray alone (`art/ToolArt.tsx`).
 */

export const GLYPH_STROKE = 1.75;

interface GlyphProps {
  size?: number;
  children: React.ReactNode;
}

function Glyph({ size = 20, children }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={GLYPH_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

type Sized = { size?: number };

/** The pointer: picks whole objects. */
export const SelectGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M6.2 4.2 L18.6 11.1 L12.9 12.6 L10 18.2 Z" />
  </Glyph>
);

/** The pointer and an anchor: picks the points inside an object. */
export const DirectSelectGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M5.2 3.6 L15.4 9.3 L10.8 10.5 L8.4 15.1 Z" />
    <rect x="15.2" y="15.2" width="4.6" height="4.6" rx="0.6" />
  </Glyph>
);

/** The open hand, the same drawing the pan cursor uses. */
export const HandGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d={HAND_OPEN} />
  </Glyph>
);

/**
 * A pencil, point down-left.
 *
 * `tip` paints the point in the current ink: the Draw seat's one concession
 * to colour, so the dock says what colour the next stroke is without opening
 * anything.
 */
export const PencilGlyph: React.FC<Sized & { tip?: string }> = ({ size, tip }) => (
  <Glyph size={size}>
    <path d="M15.3 4.9 a2.1 2.1 0 0 1 3 0 l0.8 0.8 a2.1 2.1 0 0 1 0 3 L8.7 19.1 L4.2 19.8 L4.9 15.3 Z" />
    <path d="M13.4 6.8 L17.2 10.6" />
    {tip && <path d="M4.2 19.8 L4.55 17.55 L6.45 19.45 Z" fill={tip} stroke={tip} strokeWidth={1.2} />}
  </Glyph>
);

/** A chisel marker, for the marker brush. */
export const MarkerGlyph: React.FC<Sized & { tip?: string }> = ({ size, tip }) => (
  <Glyph size={size}>
    <path d="M14.2 5.8 L18.2 9.8 L10.6 17.4 L6.6 13.4 Z" />
    <path d="M18.2 9.8 L19.6 8.4 a1.6 1.6 0 0 0 0 -2.3 L17.9 4.4 a1.6 1.6 0 0 0 -2.3 0 L14.2 5.8" />
    <path d="M6.6 13.4 L4.6 18.2 L5.8 19.4 L10.6 17.4" fill={tip ?? 'none'} stroke={tip ? tip : 'currentColor'} />
  </Glyph>
);

/** A broad highlighter laying down a band. */
export const HighlighterGlyph: React.FC<Sized & { tip?: string }> = ({ size, tip }) => (
  <Glyph size={size}>
    <path d="M15.4 3.8 L20.2 8.6 L12.4 16.4 L7.6 11.6 Z" />
    <path d="M7.6 11.6 L5.8 16.2 L7.8 18.2 L12.4 16.4" />
    <path d="M4 20.2 H11" stroke={tip ?? 'currentColor'} strokeWidth={tip ? 2.4 : GLYPH_STROKE} />
  </Glyph>
);

/** A vector pen's nib, with its slit and breather hole. */
export const VectorPenGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M12 3 L17.4 10.6 Q16.8 14.6 15 17.6 H9 Q7.2 14.6 6.6 10.6 Z" />
    <path d="M12 3 V9.6" />
    <circle cx="12" cy="11.6" r="1.3" />
    <path d="M8.6 20.8 H15.4" />
  </Glyph>
);

/** A block eraser, angled, on the line it is clearing. */
export const EraserGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M13.7 4.8 a1.7 1.7 0 0 1 2.4 0 l3.3 3.3 a1.7 1.7 0 0 1 0 2.4 L11 18.9 H7 L4.8 16.7 a1.7 1.7 0 0 1 0 -2.4 Z" />
    <path d="M9.1 9.4 L14.8 15.1" />
    <path d="M11 18.9 H19.4" />
  </Glyph>
);

/** A capital T with feet: the text tool. */
export const TypeGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M5.5 7 V5 H18.5 V7" />
    <path d="M12 5 V19" />
    <path d="M9.5 19 H14.5" />
  </Glyph>
);

/** The frame mark: two rules each way, the board's own grid. */
export const FrameGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M8.5 4 V20 M15.5 4 V20 M4 8.5 H20 M4 15.5 H20" />
  </Glyph>
);

/** An elbow connector between two ends. */
export const ConnectorGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <circle cx="5.8" cy="18.2" r="1.8" />
    <circle cx="18.2" cy="5.8" r="1.8" />
    <path d="M7.6 18.2 H10.5 a1.5 1.5 0 0 0 1.5 -1.5 V7.3 a1.5 1.5 0 0 1 1.5 -1.5 H16.4" />
  </Glyph>
);

/** A note with its corner turned. */
export const StickyGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M14.2 20 H6 a2 2 0 0 1 -2 -2 V6 a2 2 0 0 1 2 -2 H18 a2 2 0 0 1 2 2 V14.2 Z" />
    <path d="M14.2 20 V15.6 a1.4 1.4 0 0 1 1.4 -1.4 H20" />
  </Glyph>
);

/** A table: a header row and a key column. */
export const TableGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <path d="M4 10 H20 M10 10 V19" />
  </Glyph>
);

/** A picture: the sun and a ridge. */
export const ImageGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <circle cx="9.2" cy="9.8" r="1.5" />
    <path d="M20 15.2 L15.6 10.8 L6.4 19" />
  </Glyph>
);

/** A microphone, for a voice note. */
export const MicGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <rect x="9" y="3.5" width="6" height="10.5" rx="3" />
    <path d="M6 11 a6 6 0 0 0 12 0" />
    <path d="M12 17 V20.5" />
  </Glyph>
);

/** Two links of a chain. */
export const LinkGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M10.4 13.6 a3.6 3.6 0 0 0 5.1 0 l3 -3 a3.6 3.6 0 0 0 -5.1 -5.1 l-1 1" />
    <path d="M13.6 10.4 a3.6 3.6 0 0 0 -5.1 0 l-3 3 a3.6 3.6 0 0 0 5.1 5.1 l1 -1" />
  </Glyph>
);

/** Angle brackets: a code block. */
export const CodeGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M8.6 7.4 L4 12 L8.6 16.6" />
    <path d="M15.4 7.4 L20 12 L15.4 16.6" />
    <path d="M13.3 5.6 L10.7 18.4" />
  </Glyph>
);

/** Two boxes and the step between them: a diagram written as code. */
export const DiagramGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <rect x="4" y="4" width="7" height="5.5" rx="1.5" />
    <rect x="13" y="14.5" width="7" height="5.5" rx="1.5" />
    <path d="M7.5 9.5 V12 a1.5 1.5 0 0 0 1.5 1.5 H15 a1.5 1.5 0 0 1 1.5 1" />
  </Glyph>
);

/** Ruled lines: a paragraph of text. */
export const ParagraphGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M5 7 H19 M5 11 H19 M5 15 H19 M5 19 H13" />
  </Glyph>
);

/** A speech bubble with its tail at the lower left. */
export const CommentGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M6 5 H18 a2 2 0 0 1 2 2 V14.5 a2 2 0 0 1 -2 2 H11 L7 19.8 V16.5 H6 a2 2 0 0 1 -2 -2 V7 a2 2 0 0 1 2 -2 Z" />
  </Glyph>
);

/** A horseshoe magnet: forces that push, pull and drop. */
export const ForcesGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M6 4.5 V12 a6 6 0 0 0 12 0 V4.5 H14.6 V12 a2.6 2.6 0 0 1 -5.2 0 V4.5 Z" />
    <path d="M6 8 H9.4 M14.6 8 H18" />
  </Glyph>
);

/** Three dots, for the drawer. Filled, because a stroked dot at this size is a ring. */
export const MoreGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <circle cx="12" cy="6" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none" />
  </Glyph>
);

/** Sliders, for a tool's settings. */
export const SettingsGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M4 7 H11 M15 7 H20 M4 17 H8 M12 17 H20" />
    <circle cx="13" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Glyph>
);

/** A plus in a rounded square: the Insert library. */
export const InsertGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M12 8.5 V15.5 M8.5 12 H15.5" />
  </Glyph>
);

/** Four tiles: every tool. */
export const AllToolsGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <rect x="4.5" y="4.5" width="6" height="6" rx="1.6" />
    <rect x="13.5" y="4.5" width="6" height="6" rx="1.6" />
    <rect x="4.5" y="13.5" width="6" height="6" rx="1.6" />
    <rect x="13.5" y="13.5" width="6" height="6" rx="1.6" />
  </Glyph>
);

/** A line with an arrowhead: the line and arrow tool, for lists. */
export const LineGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M5 19 L19 5" />
    <path d="M12.5 5 H19 V11.5" />
  </Glyph>
);

/** A rectangle and a circle overlapping: the shape tool, for lists. */
export const ShapeGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <rect x="4" y="4" width="10" height="10" rx="1.5" />
    <circle cx="15.5" cy="15.5" r="4.5" />
  </Glyph>
);

/** Bars on a baseline: a chart, for lists. */
export const ChartGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d="M4 20 H20" />
    <path d="M7 16.5 V11 M12 16.5 V6 M17 16.5 V9" />
  </Glyph>
);

/** Columns on a page: a layout grid, for lists. */
export const GridGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9.3 4 V20 M14.7 4 V20" />
  </Glyph>
);
