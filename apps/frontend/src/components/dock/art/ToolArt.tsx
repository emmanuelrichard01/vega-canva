import React, { useId } from 'react';
import './toolArt.css';

/**
 * The drawing tray's physical tools, drawn as layered SVG.
 *
 * Original art for vega-canva. Each tool stands upright with its tip at the
 * top of a 32 × 96 box, one unit to the pixel, and the tray hides the lower
 * part of the barrel behind its front lip.
 *
 * Every tool follows one recipe:
 * - a capsule barrel with a horizontal cylindrical gradient, from the shadow
 *   edge through a specular highlight to the mid tone;
 * - a soft inner shadow under the collar, where the barrel meets the tip;
 * - a felt or chisel tip darker than the ink;
 * - the ink itself bound to CSS custom properties (`--ink`, `--hl`, `--note`),
 *   so recolouring is a style change and never a re-render of the art.
 *
 * The shading layers carry `class="shade"`, so increased contrast drops them
 * and leaves flat colour with a solid edge (see `toolArt.css`).
 *
 * The components take no props and are memoised: the tray re-renders when the
 * ink changes, the art does not.
 */

export type TrayToolArt = 'pen' | 'marker' | 'highlighter' | 'eraser' | 'vector' | 'sticky';

const VIEW = '0 0 32 96';

/**
 * The shared gradients, prefixed per instance. Ids are unique per instance
 * because a gradient referenced from inside a hidden subtree (the focus-mode
 * dock is mounted twice) stops painting in Chromium.
 */
function Defs({ id }: { id: string }) {
  return (
    <defs>
      {/* The cylinder: shadow edge, specular stripe, mid tone, far shadow. */}
      <linearGradient id={`${id}-cyl`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#000" stopOpacity="0.42" />
        <stop offset="0.12" stopColor="#000" stopOpacity="0.1" />
        <stop offset="0.27" stopColor="#fff" stopOpacity="0.62" />
        <stop offset="0.38" stopColor="#fff" stopOpacity="0.14" />
        <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        <stop offset="0.86" stopColor="#000" stopOpacity="0.16" />
        <stop offset="1" stopColor="#000" stopOpacity="0.46" />
      </linearGradient>
      {/* A flat-sided body: a narrower highlight and softer edges. */}
      <linearGradient id={`${id}-flat`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#000" stopOpacity="0.3" />
        <stop offset="0.08" stopColor="#000" stopOpacity="0.04" />
        <stop offset="0.18" stopColor="#fff" stopOpacity="0.5" />
        <stop offset="0.3" stopColor="#fff" stopOpacity="0.08" />
        <stop offset="0.82" stopColor="#000" stopOpacity="0.04" />
        <stop offset="1" stopColor="#000" stopOpacity="0.3" />
      </linearGradient>
      {/* Brushed steel, for ferrules and the vector pen's nib. */}
      <linearGradient id={`${id}-metal`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#5f646c" />
        <stop offset="0.28" stopColor="#f5f6f8" />
        <stop offset="0.48" stopColor="#c3c7cd" />
        <stop offset="0.74" stopColor="#8b9098" />
        <stop offset="1" stopColor="#575b62" />
      </linearGradient>
      {/* The inner shadow under a collar: dark at the seam, gone by 9 units. */}
      <linearGradient id={`${id}-seam`} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#000" stopOpacity="0.34" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </linearGradient>
      {/* Felt catches light along the chisel face. */}
      <linearGradient id={`${id}-felt`} x1="0" x2="1" y1="1" y2="0">
        <stop offset="0" stopColor="#000" stopOpacity="0.18" />
        <stop offset="0.55" stopColor="#fff" stopOpacity="0.2" />
        <stop offset="1" stopColor="#000" stopOpacity="0.12" />
      </linearGradient>
    </defs>
  );
}

function Svg({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <svg className="tool-art" viewBox={VIEW} width="32" height="96" aria-hidden="true" focusable="false">
      <Defs id={id} />
      {children}
    </svg>
  );
}

/** A fine-liner: slim barrel in the ink, a moulded cone, a steel sleeve, an ink point. */
export const PenArt = React.memo(function PenArt() {
  const id = `ta${useId().replace(/:/g, '')}`;
  return (
    <Svg id={id}>
      <rect className="part" x="10" y="30" width="12" height="70" rx="2.5" fill="var(--ink)" />
      <rect className="shade" x="10" y="30" width="12" height="70" rx="2.5" fill={`url(#${id}-cyl)`} />
      <rect className="shade" x="10" y="30.5" width="12" height="9" fill={`url(#${id}-seam)`} />
      <path className="part" d="M11 27 L14.2 11.2 H17.8 L21 27 Z" fill="var(--art-plastic)" />
      <path className="shade" d="M11 27 L14.2 11.2 H17.8 L21 27 Z" fill={`url(#${id}-cyl)`} />
      <rect className="part" x="9.4" y="26.4" width="13.2" height="4.6" rx="1.2" fill={`url(#${id}-metal)`} />
      <rect className="part" x="14.5" y="6.2" width="3" height="5.6" rx="0.7" fill={`url(#${id}-metal)`} />
      <path className="ink-tip" d="M15 6.6 L15.55 3.1 Q16 2.2 16.45 3.1 L17 6.6 Z" fill="var(--ink-tip)" />
    </Svg>
  );
});

/** A felt marker: a chunky barrel in the ink, a printed band, a chisel felt tip. */
export const MarkerArt = React.memo(function MarkerArt() {
  const id = `ta${useId().replace(/:/g, '')}`;
  return (
    <Svg id={id}>
      <rect className="part" x="7" y="33" width="18" height="67" rx="3.5" fill="var(--ink)" />
      <rect className="part" x="7" y="47" width="18" height="11" fill="var(--art-label)" />
      <rect className="shade" x="7" y="33" width="18" height="67" rx="3.5" fill={`url(#${id}-cyl)`} />
      <rect className="shade" x="7" y="33.5" width="18" height="9" fill={`url(#${id}-seam)`} />
      <path className="part" d="M8.6 30.5 L12.2 19.4 H19.8 L23.4 30.5 Z" fill="var(--art-plastic)" />
      <path className="shade" d="M8.6 30.5 L12.2 19.4 H19.8 L23.4 30.5 Z" fill={`url(#${id}-cyl)`} />
      <rect className="part" x="6.6" y="29.6" width="18.8" height="4.4" rx="1.4" fill="var(--ink-deep)" />
      <rect className="shade" x="6.6" y="29.6" width="18.8" height="4.4" rx="1.4" fill={`url(#${id}-cyl)`} />
      <path className="ink-tip" d="M12.8 19.6 L13.05 11.6 L19.1 7.3 Q19.75 6.9 19.75 7.7 L19.3 19.6 Z" fill="var(--ink-tip)" />
      <path className="shade" d="M12.8 19.6 L13.05 11.6 L19.1 7.3 Q19.75 6.9 19.75 7.7 L19.3 19.6 Z" fill={`url(#${id}-felt)`} />
    </Svg>
  );
});

/** A highlighter: a wide flat body in the highlight colour, a broad chisel tip. */
export const HighlighterArt = React.memo(function HighlighterArt() {
  const id = `ta${useId().replace(/:/g, '')}`;
  return (
    <Svg id={id}>
      <rect className="part" x="5.5" y="31" width="21" height="69" rx="4.5" fill="var(--hl)" />
      <rect className="shade" x="13" y="40" width="6" height="44" rx="3" fill="#fff" fillOpacity="0.3" />
      <rect className="shade" x="5.5" y="31" width="21" height="69" rx="4.5" fill={`url(#${id}-flat)`} />
      <rect className="shade" x="5.5" y="31.5" width="21" height="9" fill={`url(#${id}-seam)`} />
      <path className="part" d="M7.6 31.5 L10.6 21 H21.4 L24.4 31.5 Z" fill="var(--hl-cap)" />
      <path className="shade" d="M7.6 31.5 L10.6 21 H21.4 L24.4 31.5 Z" fill={`url(#${id}-flat)`} />
      <path className="ink-tip" d="M11 21.2 V14.8 L21 9.4 V21.2 Z" fill="var(--hl-tip)" />
      <path className="shade" d="M11 21.2 V14.8 L21 9.4 V21.2 Z" fill={`url(#${id}-felt)`} />
    </Svg>
  );
});

/** A block eraser: worn rubber at the top, a printed paper sleeve below. */
export const EraserArt = React.memo(function EraserArt() {
  const id = `ta${useId().replace(/:/g, '')}`;
  const rubber = 'M5.5 40 V19.5 Q5.5 11.4 12.6 10.6 L21.6 9.7 Q26.5 9.3 26.5 14.4 V40 Z';
  return (
    <Svg id={id}>
      <path className="part" d={rubber} fill="var(--art-rubber)" />
      <path className="shade" d={rubber} fill={`url(#${id}-flat)`} />
      {/* The worn corner, where it has done most of its work. */}
      <path className="shade" d="M7.4 18.6 Q8 13.2 12.8 12.6" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.1" strokeLinecap="round" />
      <rect className="part" x="5" y="36" width="22" height="64" rx="1.8" fill="var(--art-sleeve)" />
      <rect className="shade" x="5" y="43.5" width="22" height="2.4" fill="#fff" fillOpacity="0.78" />
      <rect className="shade" x="5" y="36" width="22" height="64" rx="1.8" fill={`url(#${id}-flat)`} />
    </Svg>
  );
});

/** A vector pen: a steel nib with its slit and breather hole, on a lacquered barrel. */
export const VectorPenArt = React.memo(function VectorPenArt() {
  const id = `ta${useId().replace(/:/g, '')}`;
  const nib = 'M11.8 31 L12.4 22.4 Q13.2 13.6 16 4.6 Q18.8 13.6 19.6 22.4 L20.2 31 Z';
  return (
    <Svg id={id}>
      <rect className="part" x="9.5" y="43" width="13" height="57" rx="3" fill="var(--art-lacquer)" />
      <rect className="shade" x="9.5" y="43" width="13" height="57" rx="3" fill={`url(#${id}-cyl)`} />
      <path className="part" d="M10.4 40 L11.8 30.4 H20.2 L21.6 40 Z" fill="var(--art-grip)" />
      <path className="shade" d="M10.4 40 L11.8 30.4 H20.2 L21.6 40 Z" fill={`url(#${id}-cyl)`} />
      <rect className="part" x="9" y="39.6" width="14" height="3.8" rx="1.1" fill={`url(#${id}-metal)`} />
      <path className="part" d={nib} fill={`url(#${id}-metal)`} />
      <path className="nib-line" d="M16 6.8 V19.6" fill="none" strokeWidth="0.8" strokeLinecap="round" />
      <circle className="nib-hole" cx="16" cy="21.4" r="1.35" />
      <path className="shade" d="M12.7 26.6 Q16 24.8 19.3 26.6" fill="none" stroke="#000" strokeOpacity="0.28" strokeWidth="0.7" />
    </Svg>
  );
});

/**
 * A pad of notes in the current note colour: three square sheets fanned a few
 * degrees from the base, the top one tinted by `--note` with its corner curling
 * up.
 *
 * A sticky note is square and wider than any pen, so the pad has a box of its
 * own, 40 units across where the barrels share 32, and its sides lean in a
 * touch towards the top, as a square standing upright and tipped back does.
 * Only the top shows above the tray's lip, so that part reads as a whole note.
 *
 * Lit as the rest of the tray is, from the upper left: a sheen down the sheet,
 * the family's flat-body gradient across it, and the top sheet's soft shadow on
 * the two below. The curl shows the paper's underside, shaded at the crease and
 * lit at the tip, over a small occlusion shadow where it leaves the sheet.
 *
 * The top sheet, its shadow and its curl are groups of their own
 * (`pad-top`, `pad-shadow`, `pad-curl`) so the tray can lift the top note off
 * the pad on hover while the sheets under it stay put (`toolArt.css`).
 */
export const StickyPadArt = React.memo(function StickyPadArt() {
  const id = `ta${useId().replace(/:/g, '')}`;
  // The sheet under the top one, and the top one with its corner cut along the crease.
  const sheet = 'M5.4 11 H34.6 Q35.8 11 35.9 12.2 L37.2 104 H2.8 L4.1 12.2 Q4.2 11 5.4 11 Z';
  const top = 'M5.4 11 H27 L35.9 19.6 L37.2 104 H2.8 L4.1 12.2 Q4.2 11 5.4 11 Z';
  return (
    <svg className="tool-art tool-art--pad" viewBox="0 0 40 96" width="40" height="96" aria-hidden="true" focusable="false">
      <Defs id={id} />
      <defs>
        <linearGradient id={`${id}-sheet`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.46" />
          <stop offset="0.2" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.1" />
        </linearGradient>
        {/* Crease (top right) to tip (lower left). */}
        <linearGradient id={`${id}-curl`} x1="1" y1="0" x2="0.1" y2="0.9">
          <stop className="curl-crease" offset="0" />
          <stop className="curl-mid" offset="0.32" />
          <stop className="curl-tip" offset="1" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
      </defs>
      {/* The two sheets under the top one, fanned from the base, deeper ones darker. */}
      <path className="part" d={sheet} transform="translate(0 1) rotate(2.4 20 104)" fill="var(--note-paper)" />
      <path className="shade" d={sheet} transform="translate(0 1) rotate(2.4 20 104)" fill="#000" fillOpacity="0.13" />
      <path className="part" d={sheet} transform="translate(0 0.5) rotate(-1.8 20 104)" fill="var(--note-paper)" />
      <path className="shade" d={sheet} transform="translate(0 0.5) rotate(-1.8 20 104)" fill="#000" fillOpacity="0.06" />
      {/* The top sheet's shadow on them; it stays on the pad when the sheet lifts. */}
      <path className="shade pad-shadow" d={top} transform="translate(0.6 1.1)" fill="#000" fillOpacity="0.2" filter={`url(#${id}-soft)`} />
      <g className="pad-top">
        <path className="part" d={top} fill="var(--note-paper)" />
        <path className="shade" d={top} fill={`url(#${id}-sheet)`} />
        <path className="shade" d={top} fill={`url(#${id}-flat)`} opacity="0.35" />
        {/* Where the adhesive strip ends. */}
        <path className="shade" d="M4.4 17.4 H26" stroke="#000" strokeOpacity="0.07" strokeWidth="0.6" />
        {/* The curl, over the shadow it lifts off the sheet. */}
        <g className="pad-curl">
          <path className="shade" d="M27 11 L35.9 19.6 L29.8 21.4 Q25.6 18.9 27 11 Z" fill="#000" fillOpacity="0.3" filter={`url(#${id}-soft)`} />
          <path className="part curl" d="M27 11 Q26.4 16 28.8 18.1 Q31 20.3 35.9 19.6 Z" fill={`url(#${id}-curl)`} />
          <path className="shade" d="M27.4 11.4 L35.5 19.2" stroke="#fff" strokeOpacity="0.5" strokeWidth="0.5" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
});

export const TOOL_ART: Record<TrayToolArt, React.ComponentType> = {
  pen: PenArt,
  marker: MarkerArt,
  highlighter: HighlighterArt,
  eraser: EraserArt,
  vector: VectorPenArt,
  sticky: StickyPadArt,
};
