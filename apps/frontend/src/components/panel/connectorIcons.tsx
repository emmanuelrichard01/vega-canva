import React from 'react';
import { endCapShape, type EndCapKind } from '../../engine/model/connectorEnds';
import type { Routing } from '../../engine/model/connector';

/**
 * Specimens for the connector controls, drawn from the geometry the canvas uses.
 *
 * `EndCapIcon` lived inside `PropertiesPanel.tsx` as a local const, which was
 * fine while the panel was the only surface offering ends. The contextual
 * toolbar offers them now, and a second hand-drawn set of arrowheads would be
 * two answers to "what does a triangle cap look like" — the exact drift
 * `sketchIcons` exists to avoid. Same reasoning, same folder.
 *
 * `currentColor` throughout, so a specimen dims with its own segment rather
 * than sitting at full strength on an inactive one.
 */

const polygonPoints = (flat: number[]): string => {
  const pairs: string[] = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push(`${flat[i]},${flat[i + 1]}`);
  return pairs.join(' ');
};

/**
 * A specimen of the connector end, drawn from the same geometry the canvas
 * uses — so the swatch cannot drift from what the line actually gets.
 */
export const EndCapIcon: React.FC<{ kind: EndCapKind; flip?: boolean }> = ({ kind, flip }) => {
  const tip = { x: flip ? 4 : 16, y: 6 };
  const shape = endCapShape(kind, tip, flip ? Math.PI : 0, 7);
  return (
    <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" focusable="false">
      <line
        x1={flip ? 6 : 3} y1="6" x2={flip ? 17 : 14} y2="6"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      />
      {shape?.circle && (
        <circle cx={shape.circle.x} cy={shape.circle.y} r={shape.circle.radius} fill="currentColor" />
      )}
      {shape?.points && (
        <polygon
          points={polygonPoints(shape.points)}
          fill={shape.filled ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
};

/**
 * A specimen of the route, drawn as the shape it makes between two boxes.
 *
 * The generic icons this replaces — a dash for straight, a corner glyph for
 * orthogonal, a spline for curved — described the *segments* rather than the
 * journey, and the corner glyph in particular reads as "indent" everywhere
 * else in a toolbar. Two small terminals with a run between them says what
 * the choice does in the one place the choice is made.
 */
export const RouteIcon: React.FC<{ routing: Routing }> = ({ routing }) => {
  const path =
    routing === 'straight'
      ? 'M4 12 L16 4'
      : routing === 'curved'
        ? 'M4 12 C 10 12, 10 4, 16 4'
        : 'M4 12 H10 V4 H16';
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true" focusable="false">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4" cy="12" r="1.75" fill="currentColor" />
      <circle cx="16" cy="4" r="1.75" fill="currentColor" />
    </svg>
  );
};
