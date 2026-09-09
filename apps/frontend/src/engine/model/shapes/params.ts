/**
 * A shape's parametric value, from the one table that describes it.
 *
 * ## Why a geometry function may not carry its own default
 *
 * `SHAPE_PARAMS` already says what a trapezoid's inset is, what its bounds
 * are, and what it draws when the document is silent. Every geometry function
 * that also wrote a `= 0.2` in its signature was a second answer to a question
 * that had one, and three of them had already stopped agreeing with the first:
 *
 *   - an untouched donut drew a 55% hole while its control read 50%;
 *   - an untouched seal drew a 90% scallop while its control read 82%;
 *   - a chip made by swapping a shape got six pins where a chip made by
 *     drawing one got three.
 *
 * None of those was reachable from the code that looked wrong. The control
 * was right, the geometry was right, and the number between them was two
 * numbers.
 *
 * So a contour asks for its parameters and never states them. The value is
 * clamped on the way out, which means a document that has drifted outside the
 * bounds — from an older build, or from a client that clamped differently —
 * still draws something legal rather than something degenerate.
 */

import { SHAPE_PARAMS, clampParam, type ShapeParamField } from '../shapeParams';
import type { ShapeGeometry } from '../schema';

/**
 * What `geometry` says this field is, or what the table says it is when the
 * document is silent.
 *
 * A field the kind does not declare returns `0`, which no caller here can
 * reach: `shapeParamCoverage.test.ts` walks every contour's requests against
 * the table and fails if one is missing. That is the check, rather than a
 * throw, because the failure belongs at build time and not on somebody's
 * board.
 */
export function param(geometry: Pick<ShapeGeometry, 'kind'>, field: ShapeParamField): number {
  const declared = SHAPE_PARAMS[geometry.kind]?.params.find((p) => p.field === field);
  if (!declared) return 0;
  const raw = (geometry as Record<string, unknown>)[field];
  return clampParam(declared, typeof raw === 'number' && Number.isFinite(raw) ? raw : declared.fallback);
}

/** The table's own answer, with no document in hand. What a fresh shape draws. */
export function paramFallback(kind: ShapeGeometry['kind'], field: ShapeParamField): number {
  return SHAPE_PARAMS[kind]?.params.find((p) => p.field === field)?.fallback ?? 0;
}
