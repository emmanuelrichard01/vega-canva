import React from 'react';

/**
 * Shape glyphs, defined once.
 *
 * Hand-authored geometry SVG primitives matching Figma/Illustrator standards.
 * They inherit `currentColor` and take their size from the caller.
 *
 * Where a shape's canvas geometry changed (cloud, callout, banner, shield,
 * badge, key, wallet, capsule), the icon was redrawn to match the new outline
 * so the flyout preview and the canvas shape are visually identical.
 */

import {
  heartAnchors,
  squircleAnchors,
  cloudAnchors,
  shieldAnchors,
  badgeAnchors,
} from '../../engine/model/shapeOutline';
import { fromAnchors, pathData } from '../../engine/model/pathGeometry';
import type { ShapePreset } from './shapePresetTypes';
import type { ShapeKind } from '../../engine/model/schema';

interface ShapeIconProps {
  /**
   * Any shape kind, not only the ones the toolbar offers.
   *
   * The two lists overlap without containing each other: the toolbar offers
   * `triangle`, `pentagon`, `hexagon` and `octagon`, which are all one
   * `polygon` kind at different side counts, and `polygon` itself is a kind
   * you can hold but not place. A panel showing the icon for the *selected*
   * shape is keyed by kind; the toolbar is keyed by preset. The table below
   * falls back to a rectangle for anything it has no drawing of, which it
   * always did -- the type just stopped pretending the gap was impossible.
   */
  kind: ShapePreset | ShapeKind;
  size?: number;
}

/** One stroke weight across the whole set, so no shape reads heavier than its neighbours. */
const STROKE = 2;

/** Helper: generate a pathData glyph from anchors, offset into a 24×24 viewbox. */
function anchorGlyph(
  anchors: Array<{ x: number; y: number; inX?: number; inY?: number; outX?: number; outY?: number }>,
  closed: boolean,
  offsetX = STROKE,
  offsetY = STROKE,
): string {
  return pathData(
    fromAnchors(
      anchors.map((a) => ({
        x: a.x + offsetX,
        y: a.y + offsetY,
        inX: (a.inX ?? a.x) + offsetX,
        inY: (a.inY ?? a.y) + offsetY,
        outX: (a.outX ?? a.x) + offsetX,
        outY: (a.outY ?? a.y) + offsetY,
      })),
      closed
    )
  );
}

const BOX = 24 - STROKE * 2;

/**
 * The heart glyph, from the same anchors the canvas draws.
 */
const heartGlyph = anchorGlyph(heartAnchors(BOX, BOX), true);

/**
 * The squircle glyph, from the same continuous-curvature anchors the canvas draws.
 */
const squircleGlyph = anchorGlyph(squircleAnchors(BOX, BOX), true);

/**
 * The cloud glyph, from the same asymmetric bumps the canvas draws.
 */
const cloudGlyph = anchorGlyph(cloudAnchors(BOX, BOX), true);

/**
 * The shield glyph, from the same curved-side anchors the canvas draws.
 */
const shieldGlyph = anchorGlyph(shieldAnchors(BOX, BOX), true);

/**
 * The badge/seal glyph, from the same smooth-scallop anchors the canvas draws.
 */
const badgeGlyph = anchorGlyph(
  badgeAnchors(BOX / 2 + STROKE, BOX / 2 + STROKE, 12, 0.9, BOX / 2, BOX / 2),
  true,
  0,
  0,
);

/** The regular polygon glyphs, generated so the set cannot drift by hand. */
function polygonGlyph(sides: number): React.ReactNode {
  const pts = Array.from({ length: sides }, (_, i) => {
    const a = (i * 2 * Math.PI) / sides - Math.PI / 2;
    return `${(12 + 10 * Math.cos(a)).toFixed(2)} ${(12 + 10 * Math.sin(a)).toFixed(2)}`;
  });
  return <polygon points={pts.join(' ')} />;
}

const PATHS: Partial<Record<ShapePreset | ShapeKind, React.ReactNode>> &
  Record<ShapePreset, React.ReactNode> = {
  rect: <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />,
  ellipse: <circle cx="12" cy="12" r="9" />,
  squircle: <path d={squircleGlyph} />,
  /* Clean stadium capsule — proper semicircular ends, no flat spots. */
  capsule: <rect x="3" y="6" width="18" height="12" rx="6" ry="6" />,
  diamond: <polygon points="12 3 21 12 12 21 3 12" />,
  triangle: polygonGlyph(3),
  cylinder: (
    <g>
      <ellipse cx="12" cy="6" rx="9" ry="3.2" />
      <path d="M 3 6 L 3 18 A 9 3.2 0 0 0 21 18 L 21 6" />
    </g>
  ),
  parallelogram: <polygon points="7 4 21 4 17 20 3 20" />,
  trapezoid: <polygon points="6 4 18 4 21 20 3 20" />,
  chevron: <polygon points="3 4 16 4 21 12 16 20 3 20 8 12" />,
  star: (
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  ),
  heart: <path d={heartGlyph} />,

  /* Cloud: organic asymmetric bumps matching the canvas cloud. */
  cloud: <path d={cloudGlyph} />,

  cross: <polygon points="9 3 15 3 15 9 21 9 21 15 15 15 15 21 9 21 9 15 3 15 3 9 9 9" />,

  /* Donut: updated inner radius to 0.55 to match canvas. */
  donut: (
    <g>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
    </g>
  ),

  /* Badge: smooth scalloped rosette from the same anchor generator. */
  badge: <path d={badgeGlyph} />,

  /* Callout: rounded-rect body with a curved tail (speech bubble). */
  callout: (
    <path d="M 4 3 C 2.9 3 2 3.9 2 5 V 15 C 2 16.1 2.9 17 4 17 H 7 L 5 21 L 11 17 H 20 C 21.1 17 22 16.1 22 15 V 5 C 22 3.9 21.1 3 20 3 Z" />
  ),

  /* Banner: folded ribbon with notched sides and tail folds. */
  banner: (
    <g>
      {/* Main ribbon body */}
      <polygon points="2 5 22 5 19 10 22 15 2 15 5 10" />
      {/* Left tail fold */}
      <polygon points="4 15 4 18 7 15" opacity="0.5" />
      {/* Right tail fold */}
      <polygon points="20 15 20 18 17 15" opacity="0.5" />
    </g>
  ),

  pentagon: polygonGlyph(5),
  hexagon: polygonGlyph(6),
  octagon: polygonGlyph(8),
  document: (
    <path d="M 4 3 H 20 V 17 C 17.5 19 14.5 15.5 12 17.5 C 9.5 19.5 6.5 16 4 17.5 Z" />
  ),
  predefined_process: (
    <g>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="7" y1="4" x2="7" y2="20" />
      <line x1="17" y1="4" x2="17" y2="20" />
    </g>
  ),
  summing_junction: (
    <g>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </g>
  ),
  or_gate: (
    <path d="M 4 4 C 11 5 16 8 20 12 C 16 16 11 19 4 20 C 7 15 7 9 4 4 Z" />
  ),
  and_gate: (
    <path d="M 4 4 H 12 A 8 8 0 0 1 12 20 H 4 Z" />
  ),
  internal_storage: (
    <g>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="8" x2="21" y2="8" />
      <line x1="8" y1="8" x2="8" y2="20" />
    </g>
  ),
  delay: (
    <path d="M 4 4 H 13 A 8 8 0 0 1 13 20 H 4 Z" />
  ),
  database: (
    <g>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M 4 5 V 12 C 4 13.7 7.6 15 12 15 C 16.4 15 20 13.7 20 12 V 5" />
      <path d="M 4 12 V 19 C 4 20.7 7.6 22 12 22 C 16.4 22 20 20.7 20 19 V 12" />
    </g>
  ),
  /* Server: stacked rounded rects with indicator LEDs and slots. */
  server: (
    <g>
      <rect x="3" y="3" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
      <circle cx="6.5" cy="6.5" r="1" fill="currentColor" />
      <circle cx="6.5" cy="17.5" r="1" fill="currentColor" />
      <line x1="12" y1="6.5" x2="17" y2="6.5" />
      <line x1="12" y1="17.5" x2="17" y2="17.5" />
    </g>
  ),
  /* CPU: clean IC package with fewer pins. */
  cpu: (
    <g>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="12" y1="1" x2="12" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="12" y1="20" x2="12" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="12" x2="4" y2="12" />
      <line x1="1" y1="15" x2="4" y2="15" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="12" x2="23" y2="12" />
      <line x1="20" y1="15" x2="23" y2="15" />
    </g>
  ),
  mobile: (
    <g>
      <rect x="6" y="2" width="12" height="20" rx="3" />
      <line x1="10" y1="5" x2="14" y2="5" />
      <line x1="10" y1="19" x2="14" y2="19" />
    </g>
  ),
  terminal: (
    <g>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <polyline points="7 10 10 13 7 16" />
      <line x1="13" y1="16" x2="17" y2="16" />
    </g>
  ),
  browser: (
    <g>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <circle cx="6" cy="6.5" r="0.75" fill="currentColor" />
      <circle cx="8.5" cy="6.5" r="0.75" fill="currentColor" />
      <rect x="11.5" y="5.5" width="7.5" height="2" rx="1" />
    </g>
  ),
  /* Shield: curved Bézier sides matching the canvas. */
  shield: <path d={shieldGlyph} />,

  /* Key: circular bow with toothed shaft. */
  key: (
    <g>
      <circle cx="7.5" cy="12" r="4.5" />
      <circle cx="7.5" cy="12" r="1.75" />
      <path d="M 12 11 H 18 V 15 H 16.5 V 13 H 15 V 15 H 13.5 V 13 H 12" />
      <line x1="18" y1="11" x2="21" y2="11" />
      <line x1="21" y1="11" x2="21" y2="15" />
      <line x1="21" y1="15" x2="18" y2="15" />
    </g>
  ),
  bolt: (
    <polygon points="13 2 4 13 11 13 9 22 20 10 13 10" />
  ),
  /* Package: isometric cube with internal crease lines. */
  package: (
    <g>
      <polygon points="12 2 21 7 21 17 12 22 3 17 3 7" />
      <polyline points="3 7 12 12 21 7" />
      <line x1="12" y1="12" x2="12" y2="22" />
    </g>
  ),
  mail: (
    <g>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <polyline points="3 7 12 13 21 7" />
    </g>
  ),
  user: (
    <g>
      <circle cx="12" cy="7" r="4" />
      <path d="M 5 21 C 5 16.5 8 14 12 14 C 16 14 19 16.5 19 21" />
    </g>
  ),
  gear: (
    <g>
      <circle cx="12" cy="12" r="3" />
      <path d="M 19.4 15 A 1.65 1.65 0 0 0 19.7 16.8 L 20 17.3 A 2 2 0 0 1 17.3 20 L 16.8 19.7 A 1.65 1.65 0 0 0 15 19.4 A 1.65 1.65 0 0 0 13.6 20.6 L 13.5 21.2 A 2 2 0 0 1 9.5 21.2 L 9.4 20.6 A 1.65 1.65 0 0 0 8 19.4 A 1.65 1.65 0 0 0 6.2 19.7 L 5.7 20 A 2 2 0 0 1 3 17.3 L 3.3 16.8 A 1.65 1.65 0 0 0 3 15 A 1.65 1.65 0 0 0 1.8 13.6 L 1.2 13.5 A 2 2 0 0 1 1.2 9.5 L 1.8 9.4 A 1.65 1.65 0 0 0 3 8 A 1.65 1.65 0 0 0 2.7 6.2 L 2.4 5.7 A 2 2 0 0 1 5.1 3 L 5.6 3.3 A 1.65 1.65 0 0 0 7.4 3 A 1.65 1.65 0 0 0 8.8 1.8 L 8.9 1.2 A 2 2 0 0 1 12.9 1.2 L 13 1.8 A 1.65 1.65 0 0 0 14.4 3 A 1.65 1.65 0 0 0 16.2 2.7 L 16.7 2.4 A 2 2 0 0 1 19.4 5.1 L 19.1 5.6 A 1.65 1.65 0 0 0 19.4 7.4 A 1.65 1.65 0 0 0 20.6 8.8 L 21.2 8.9 A 2 2 0 0 1 21.2 12.9 L 20.6 13 A 1.65 1.65 0 0 0 19.4 14.4 Z" />
    </g>
  ),
  /* Wallet: rounded body with clasp pocket bump. */
  wallet: (
    <g>
      <path d="M 3 6 C 3 4.9 3.9 4 5 4 H 19 C 20.1 4 21 4.9 21 6 V 8 H 17 C 15.3 8 14 9.3 14 11 C 14 12.7 15.3 14 17 14 H 21 V 18 C 21 19.1 20.1 20 19 20 H 5 C 3.9 20 3 19.1 3 18 Z" />
      <circle cx="17.5" cy="11" r="1" fill="currentColor" />
    </g>
  ),
  line: <path d="M4 20 L20 4" />,
  arrow: <path d="M4 20 L20 4 M20 4 L13 5 M20 4 L19 11" />,
};

export const ShapeIcon: React.FC<ShapeIconProps> = ({ kind, size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={STROKE}
    strokeLinejoin="round"
    strokeLinecap="round"
    aria-hidden="true"
    focusable="false"
  >
    {PATHS[kind] ?? PATHS.rect}
  </svg>
);
