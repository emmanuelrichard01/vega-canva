import { paintColor } from '../../../engine/model/paint';
import { CSS_TEXT_TRANSFORM } from '../../../engine/model/textCase';
import type { Appearance, LineCap, LineJoin, Typography } from '../../../engine/model/schema';
import { isDottedPattern } from '../../../engine/model/strokeStyle';

/**
 * Compose Konva's single `fontStyle` string from the orthogonal weight and
 * slant fields the model stores.
 *
 * Konva has no `fontWeight` prop — weight and slant are both encoded into
 * `fontStyle` ("normal" | "bold" | "italic" | "bold italic"). Forwarding the
 * model's `fontStyle` directly is what made the Bold control (and Cmd+B) do
 * nothing: the UI wrote a numeric weight the renderer never looked at. This is
 * the one place that translation happens.
 */
export function konvaFontStyle(typography: Typography | undefined): string {
  if (!typography) return 'normal';
  const parts: string[] = [];
  if (typography.fontWeight >= 600) parts.push('bold');
  if (typography.italic) parts.push('italic');
  return parts.length ? parts.join(' ') : 'normal';
}

/**
 * Konva's `textDecoration` string.
 *
 * Space-separated, and it takes both at once — which is why `underline` and
 * `strikethrough` are two booleans on the model rather than one enum. A single
 * field would have made them mutually exclusive for no reason but its own
 * shape.
 */
export function konvaTextDecoration(typography: Typography | undefined): string {
  const parts: string[] = [];
  if (typography?.underline) parts.push('underline');
  if (typography?.strikethrough) parts.push('line-through');
  return parts.join(' ');
}

/**
 * One colour standing for the first fill.
 *
 * For the places that can only take a colour — a DOM overlay, an SVG
 * attribute, a swatch. A gradient answers with its first stop; see
 * `paintColor`. Anything that can paint properly should use `useFillProps`
 * instead, which returns the gradient itself.
 */
export function fillColor(appearance: Appearance | undefined, fallback: string): string {
  return paintColor(appearance?.fill?.[0], fallback);
}

export function fillOpacity(appearance: Appearance | undefined): number {
  return appearance?.fill?.[0]?.opacity ?? 1;
}

export function strokeColor(appearance: Appearance | undefined): string | undefined {
  const color = appearance?.stroke?.color;
  return color && color !== 'transparent' ? color : undefined;
}

export function strokeWidth(appearance: Appearance | undefined): number {
  return appearance?.stroke?.width ?? 0;
}

/**
 * The dash-pattern props Konva wants, spread onto any stroked shape.
 *
 * Returned as one object rather than two accessors because the two travel
 * together: a dotted pattern is `[0, gap]`, which draws nothing at all without
 * the round cap that gives each zero-length segment its extent. Splitting them
 * across two call sites is how one of them ends up forgotten on a renderer.
 *
 * Konva reads `undefined` as "no dash" and "default cap", so the absent case
 * needs no branch at the call site.
 */
export function strokeDashProps(
  appearance: Appearance | undefined,
  fallbackCap?: LineCap
): { dash?: number[]; lineCap?: LineCap; lineJoin?: LineJoin; miterLimit?: number } {
  const stroke = appearance?.stroke;
  return {
    dash: stroke?.dash,
    // A dotted pattern is zero-length segments, which only become visible dots
    // because of the round cap at each end — with any other cap the line draws
    // as nothing at all. That is a fact about drawing rather than a stored
    // preference, so it is applied here and the document keeps the cap the
    // user actually chose.
    lineCap: isDottedPattern(stroke?.dash) ? 'round' : (stroke?.cap ?? fallbackCap),
    // The join travels here too, for the same reason the cap does: it is the
    // other half of how a stroke terminates, and a renderer that spread the
    // dash without it would draw the corner Konva defaults to rather than the
    // one the document asked for.
    lineJoin: stroke?.join,
    // Konva reads `undefined` as its own default of 10, which is the same
    // number `DEFAULT_MITER_LIMIT` is, so an untouched stroke needs no value.
    miterLimit: stroke?.miterLimit,
  };
}

/**
 * The Konva shadow props for a node, spread onto the shape that casts it.
 *
 * `Appearance.shadow` was on the schema from the first commit, read and
 * written by the normalizer, and declared as a capability by five object
 * types — and no renderer ever looked at it. Every shadow on the canvas was a
 * hardcoded constant. This is the translation that was missing.
 *
 * Returns nothing at all when there is no shadow. Konva treats
 * `shadowBlur: 0` as a shadow it still has to consider on every draw, and a
 * board is mostly objects with no shadow.
 *
 * `spread` is absent from this object on purpose: Konva has no equivalent, and
 * growing the silhouette needs a second draw of the shape. See
 * `shadowSpreadProps`.
 */
export function shadowProps(appearance: Appearance | undefined): Record<string, unknown> {
  const shadow = appearance?.shadow;
  if (!shadow) return {};
  return {
    shadowColor: shadow.color,
    shadowBlur: Math.max(0, shadow.blur),
    shadowOffsetX: shadow.offsetX,
    shadowOffsetY: shadow.offsetY,
    shadowOpacity: shadow.opacity ?? 1,
    // The shadow must not scale with a non-uniformly stretched polygon, for
    // the same reason its stroke must not: a widened hexagon would cast a
    // shadow blurred further horizontally than vertically.
    shadowForStrokeEnabled: false,
  };
}

/**
 * Props for the shadow-only copy of a shape drawn behind it, or null.
 *
 * Spread grows the shadow's silhouette before the blur, and Konva has no such
 * property. Stroking the same path with a line of `2 * spread` expands its
 * silhouette by exactly `spread` in every direction, whatever the path is —
 * which is why this works for a star and a bezier as well as a rectangle, and
 * why it is one prop rather than per-shape geometry.
 *
 * The copy carries the shadow and the real shape carries none, so the shadow
 * is cast by the grown silhouette rather than by the shape itself.
 */
export function shadowSpreadProps(appearance: Appearance | undefined): Record<string, unknown> | null {
  const shadow = appearance?.shadow;
  if (!shadow || !shadow.spread || shadow.spread <= 0) return null;
  return {
    ...shadowProps(appearance),
    // The silhouette is all that matters — it is about to be blurred and
    // offset, and only its shape contributes. Painting it in the shadow's own
    // colour means the ring left visible at zero offset, which is what spread
    // looks like in CSS too, is the right colour.
    fill: shadow.color,
    fillPriority: 'color',
    stroke: shadow.color,
    strokeWidth: shadow.spread * 2,
    strokeScaleEnabled: false,
    dash: undefined,
    listening: false,
    perfectDrawEnabled: false,
    // Konva skips a stroke's shadow by default, and here the stroke *is* the
    // silhouette being cast.
    shadowForStrokeEnabled: true,
  };
}

/** CSS font shorthand pieces for the DOM textareas used during editing. */
export function domTextStyle(typography: Typography): React.CSSProperties {
  return {
    fontFamily: typography.fontFamily,
    fontSize: `${typography.fontSize}px`,
    fontWeight: typography.fontWeight,
    fontStyle: typography.italic ? 'italic' : 'normal',
    // Both, when both are set. The CSS shorthand takes a space-separated list
    // exactly as Konva's does, so the two stay in step by construction.
    textDecoration:
      [typography.underline && 'underline', typography.strikethrough && 'line-through']
        .filter(Boolean)
        .join(' ') || 'none',
    textAlign: typography.align,
    lineHeight: typography.lineHeight,
    letterSpacing: `${typography.letterSpacing}px`,
    color: typography.color,
    // The editor shows the transformed case, so the words do not change shape
    // the instant you stop typing. The stored string is untouched either way.
    textTransform: CSS_TEXT_TRANSFORM[typography.textCase ?? 'none'] as React.CSSProperties['textTransform'],
  };
}
