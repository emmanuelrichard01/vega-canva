import React from 'react';

/**
 * A 16px record: disc, two grooves, a label and a spindle hole, drawn so it
 * stays crisp at 1×. The disc takes the text colour and the grooves and label
 * are cut from the surface colour, so it reads as a record in light, dark and
 * increased contrast alike. Spinning is a CSS animation at 33⅓ rpm, transform
 * only, and still under reduced motion.
 *
 * The colours are resolved on the glyph itself (not on :root), so they follow
 * the theme class wherever it is set.
 */
export const VinylGlyph: React.FC<{ spinning: boolean; size?: number }> = ({ spinning, size = 16 }) => (
  <svg className={`vinyl-glyph${spinning ? ' is-spinning' : ''}`} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
    <circle cx={8} cy={8} r={7.25} fill="currentColor" />
    <circle cx={8} cy={8} r={5.7} fill="none" className="vinyl-glyph__groove" strokeWidth={0.8} />
    <circle cx={8} cy={8} r={4.3} fill="none" className="vinyl-glyph__groove" strokeWidth={0.6} />
    <circle cx={8} cy={8} r={2.6} className="vinyl-glyph__label" />
    {/* The label's mark: the one asymmetric detail, so the turn is visible. */}
    <rect x={7.45} y={5.55} width={1.1} height={1.3} rx={0.3} fill="currentColor" />
    <circle cx={8} cy={8} r={0.75} fill="currentColor" />
  </svg>
);
