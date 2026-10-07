import React from 'react';
import type { FillStyle, ShadingDensity, SketchLevel } from '../../engine/model/rough';
import './sections/sketch.css';

/**
 * The sketch controls' glyphs.
 *
 * Authored on the dock's grid (`components/dock/glyphs.tsx`) so they sit in
 * the same family as every other icon in the chrome:
 * - a 24-unit box with a 2-unit margin, so the live area is 20;
 * - a 1.75 stroke with round caps and joins for every outline;
 * - corners of 2 on rectangles.
 *
 * Interior marks (hatching, dots) take a lighter 1.25 so a tile reads as a
 * frame with a texture inside it, not as a grid of equal lines.
 *
 * Each set varies one thing only. The look pair is a ruled box against a
 * drawn one; the roughness trio is one wave drawn by a steadier or looser
 * hand; the fill styles share a frame and differ only inside it.
 *
 * `currentColor` throughout, so a glyph dims with its own segment.
 */

const STROKE = 1.75;
const MARK = 1.25;

interface GlyphProps {
  size?: number;
  children: React.ReactNode;
}

function Glyph({ size = 20, children }: GlyphProps) {
  return (
    <svg
      className="sketch-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type Sized = { size?: number };

/** A box drawn by hand: four strokes, each running past its corner. */
const DRAWN_BOX =
  'M3.6 5.3 C8.5 4.7 14.5 4.9 20.3 4.5 ' +
  'M19.4 3.7 C19.9 9 19.6 14 19.9 20.2 ' +
  'M20.6 19.3 C14.8 19.8 9.4 19.5 3.8 19.9 ' +
  'M4.7 20.6 C4.3 15 4.6 9.6 4.2 3.8';

/** Clean: the object is drawn with ruled lines. */
export const CleanLookGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="2" />
  </Glyph>
);

/** Sketch: the object is drawn by hand. Also the board's sketch-mode glyph. */
export const SketchLookGlyph: React.FC<Sized> = ({ size }) => (
  <Glyph size={size}>
    <path d={DRAWN_BOX} />
  </Glyph>
);

/**
 * One wave per lap. `off` is the ruled wave (the pencil's smooth nib uses it
 * too); Neat is one lap by hand, a little uneven and gone over at the start;
 * Sketchy goes round twice; Wild goes round twice, wanders further, and runs
 * past both ends.
 */
const LEVEL_LAPS: Record<SketchLevel | 'off', string[]> = {
  off: ['M4 15 C7.2 8.6 10.4 8.6 12 12 C13.6 15.4 16.8 15.4 20 9'],
  light: [
    'M3.6 15.6 C6.8 8.4 10.6 8 12.1 12.1 C13.5 15.9 17.2 15.6 20.4 8.4',
    'M5.4 17.2 C6 15.6 6.7 14 7.6 12.6',
  ],
  medium: [
    'M3.7 14.6 C6.9 7.6 10.5 7.6 12.1 11.6 C13.7 15.6 17.2 15.4 20.3 8',
    'M4.5 17.4 C7.5 10.6 10.3 9.8 11.9 13.4 C13.5 17 16.7 17.4 19.7 10.6',
  ],
  heavy: [
    'M2.9 13.6 C6.4 5.4 10.8 6.2 12.3 11.2 C13.8 16.2 18 17 21.2 6.6',
    'M5.4 18.6 C7.6 11.2 9.6 9.2 11.5 14 C13.1 18.2 15.8 19.2 18.9 12.2',
  ],
};

/** A roughness level, as one wave drawn by that hand; `off` is the ruled wave. */
export const SketchLevelIcon: React.FC<{ level: SketchLevel | 'off' } & Sized> = ({ level, size }) => (
  <Glyph size={size}>
    {LEVEL_LAPS[level].map((d, i) => (
      <path key={i} d={d} />
    ))}
  </Glyph>
);

/**
 * Either look as one glyph, for a trigger that shows the current state:
 * the ruled box when crisp, the level's wave when sketched.
 */
export const SketchStateIcon: React.FC<{ level: SketchLevel | undefined } & Sized> = ({ level, size }) =>
  level ? <SketchLevelIcon level={level} size={size} /> : <CleanLookGlyph size={size} />;

// ----------------------------------------------------------------- fills

/** The frame every fill tile shares, and the square its marks are kept inside. */
const FRAME = { x: 4, y: 4, size: 16 };
const INNER = { lo: 6.5, hi: 17.5 };

/**
 * A segment of the line `x + y = c` ("/") or `x - y = c` ("\") clipped to the
 * inner square, or null when the line misses it.
 */
function diagonal(c: number, dir: 'up' | 'down'): string | null {
  const { lo, hi } = INNER;
  if (dir === 'up') {
    const x0 = Math.max(lo, c - hi);
    const x1 = Math.min(hi, c - lo);
    if (x1 - x0 < 0.5) return null;
    return `M${x0.toFixed(2)} ${(c - x0).toFixed(2)} L${x1.toFixed(2)} ${(c - x1).toFixed(2)}`;
  }
  const x0 = Math.max(lo, lo + c);
  const x1 = Math.min(hi, hi + c);
  if (x1 - x0 < 0.5) return null;
  return `M${x0.toFixed(2)} ${(x0 - c).toFixed(2)} L${x1.toFixed(2)} ${(x1 - c).toFixed(2)}`;
}

/** Parallel strokes through the inner square's centre, at these offsets from it. */
function hatch(offsets: readonly number[], dir: 'up' | 'down'): string {
  const centre = dir === 'up' ? INNER.lo + INNER.hi : 0;
  return offsets
    .map((o) => diagonal(centre + o, dir))
    .filter(Boolean)
    .join(' ');
}

const HACHURE = hatch([-8.25, -2.75, 2.75, 8.25], 'up');
const CROSSHATCH = `${hatch([-7, 0, 7], 'up')} ${hatch([-7, 0, 7], 'down')}`;
const SCRIBBLE = 'M7 8.4 L17 7 L7 12.6 L17 11.2 L7 16.8 L17 15.4';
const DOTS: ReadonlyArray<readonly [number, number]> = [
  [8.5, 8.5], [12, 8.5], [15.5, 8.5],
  [10.25, 12], [13.75, 12],
  [8.5, 15.5], [12, 15.5], [15.5, 15.5],
];

const Frame: React.FC = () => <rect x={FRAME.x} y={FRAME.y} width={FRAME.size} height={FRAME.size} rx="2" />;

/** Solid is the frame with its inside filled, inset like the other tiles' marks so it is not a heavier glyph. */
const SOLID_INSET = 2.75;

/** A fill style, as the frame with that shading inside it. */
export const FillStyleIcon: React.FC<{ style: FillStyle } & Sized> = ({ style, size }) => (
  <Glyph size={size}>
    <Frame />
    {style === 'solid' && (
      <rect
        x={FRAME.x + SOLID_INSET}
        y={FRAME.y + SOLID_INSET}
        width={FRAME.size - SOLID_INSET * 2}
        height={FRAME.size - SOLID_INSET * 2}
        rx="0.75"
        fill="currentColor"
        stroke="none"
      />
    )}
    {style === 'hachure' && <path d={HACHURE} strokeWidth={MARK} />}
    {style === 'crosshatch' && <path d={CROSSHATCH} strokeWidth={MARK} />}
    {style === 'zigzag' && <path d={SCRIBBLE} strokeWidth={MARK} />}
    {style === 'dots' && (
      <g fill="currentColor" stroke="none">
        {DOTS.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.15" />
        ))}
      </g>
    )}
  </Glyph>
);

const DENSITY_OFFSETS: Record<ShadingDensity, readonly number[]> = {
  light: [-6, 0, 6],
  medium: [-8.25, -2.75, 2.75, 8.25],
  dense: [-9, -6, -3, 0, 3, 6, 9],
};

/** How closely the strokes are laid: the hachure tile at three spacings. */
export const ShadingDensityIcon: React.FC<{ density: ShadingDensity } & Sized> = ({ density, size }) => (
  <Glyph size={size}>
    <Frame />
    <path d={hatch(DENSITY_OFFSETS[density], 'up')} strokeWidth={density === 'dense' ? 1 : MARK} />
  </Glyph>
);

/**
 * The hatch angle, drawn at the angle.
 *
 * An angle is the one number in the sketch panel you cannot picture from the
 * digits, so three short parallel strokes turn to match. The CSS rotation is
 * clockwise while the shading's convention is anticlockwise from horizontal,
 * so the sign is flipped here, the one place the two conventions meet.
 */
export const HatchAngleGlyph: React.FC<{ degrees: number }> = ({ degrees }) => (
  <svg
    className="sketch-angle-glyph"
    width="13"
    height="13"
    viewBox="0 0 14 14"
    aria-hidden="true"
    focusable="false"
    style={{ '--sketch-angle': `${-degrees}deg` } as React.CSSProperties}
  >
    <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <line x1="1.5" y1="7" x2="12.5" y2="7" />
      <line x1="3.5" y1="3" x2="10.5" y2="3" />
      <line x1="3.5" y1="11" x2="10.5" y2="11" />
    </g>
  </svg>
);
