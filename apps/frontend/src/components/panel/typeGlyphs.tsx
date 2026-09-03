import React from 'react';

/**
 * Marks drawn for the type controls, where the icon set has nothing that means
 * the right thing.
 *
 * The rule this file exists under: an icon may be borrowed only if it depicts
 * *this* concept, not merely a related one. Lucide's `AlignStartVertical` and
 * its siblings show several objects distributed along an axis — they are the
 * marks for aligning a **selection of shapes to each other**, which is a
 * different operation this app also has. Using them for "where the text sits
 * inside its box" says the wrong thing twice: it fails to describe vertical
 * alignment, and it claims a meaning already spoken for.
 *
 * What the concept actually looks like is a box with type in part of it, which
 * is what Figma and Illustrator both draw, and it takes eleven lines of SVG.
 */

/**
 * A box with two lines of type sitting at the top, the middle, or the bottom.
 *
 * The box is the thing being aligned *within*, so it is drawn as a frame at low
 * contrast — present, but not competing with the bars that carry the meaning.
 * The bars are the type. Two of them rather than one, because a single bar in
 * the middle of a box is a hamburger icon and a single bar at the top is a
 * heading.
 */
export const VerticalAlignGlyph: React.FC<{ where: 'top' | 'middle' | 'bottom' }> = ({ where }) => {
  // Two bars, 1.5 tall with 1.5 between them: a 4.5-unit block inside a
  // 14-unit box, positioned so top and bottom keep the same 2 units of margin
  // the frame gives them and middle is centred on 8.
  const y = where === 'top' ? 3 : where === 'middle' ? 5.75 : 8.5;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect
        x="1.75"
        y="1.75"
        width="12.5"
        height="12.5"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.35"
      />
      <rect x="4.25" y={y} width="7.5" height="1.5" rx="0.75" fill="currentColor" />
      <rect x="4.25" y={y + 3} width="5" height="1.5" rx="0.75" fill="currentColor" />
    </svg>
  );
};

/**
 * A specimen of what an effect does, drawn with the effect on it.
 *
 * ## Why a swatch and not a label
 *
 * "Glow" is a word for a thing you are trying to *see*, and the section's whole
 * subject is appearance. Every control here was a name plus a switch, so the
 * only way to find out what a setting did was to turn it on, look at the board,
 * and turn it off again — with the panel covering part of what you were
 * looking at.
 *
 * The effects happen to be exactly the ones CSS can draw natively:
 * `background` for the highlight plate, `-webkit-text-stroke` for the outline,
 * `text-shadow` for the glow. So the specimen is not an illustration of the
 * effect, it *is* the effect, from the same numbers the canvas uses — a colour
 * change or a wider stroke moves it immediately, and there is no second
 * rendering to keep in step.
 */
export const EffectSpecimen: React.FC<{
  text?: string;
  color?: string;
  highlight?: { color: string; radius: number } | null;
  outline?: { color: string; width: number } | null;
  glow?: { color: string; blur: number } | null;
  cycle?: string[] | null;
}> = ({ text = 'Ag', color, highlight, outline, glow, cycle }) => {
  const style: React.CSSProperties = {
    color,
    // Scaled down from the board's numbers rather than passed through: a 20px
    // glow around a 13px specimen is a coloured square, and an 8px stroke is a
    // blob. A third keeps the *ratio* recognisable, which is what a preview is
    // for, at a size that fits a row.
    ...(outline
      ? ({ WebkitTextStroke: `${Math.min(outline.width / 3, 1.2)}px ${outline.color}` } as React.CSSProperties)
      : null),
    ...(glow ? { textShadow: `0 0 ${Math.min(glow.blur / 3, 8)}px ${glow.color}` } : null),
    ...(highlight
      ? {
          background: highlight.color,
          borderRadius: Math.min(highlight.radius / 2, 6),
          padding: '1px 5px',
        }
      : null),
  };

  return (
    <span className="fx-specimen" style={style} aria-hidden="true">
      {cycle && cycle.length
        ? // One colour per character, the way the board spreads a ramp, so the
          // specimen shows the ramp rather than its first stop.
          [...text].map((ch, i) => (
            <span key={i} style={{ color: cycle[i % cycle.length] }}>
              {ch}
            </span>
          ))
        : text}
    </span>
  );
};
