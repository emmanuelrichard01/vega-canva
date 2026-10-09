import { paintColor } from '../../../engine/model/paint';
import { CSS_TEXT_TRANSFORM } from '../../../engine/model/textCase';
import type { Appearance, LineCap, LineJoin, Typography } from '../../../engine/model/schema';
import { isDottedPattern } from '../../../engine/model/strokeStyle';
import { fontStack } from '../../../engine/text/fontCatalogue';
import { castsShadow } from '../../../engine/model/dropShadow';

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
  if (typography.italic) parts.push('italic');
  /**
   * The weight as a number, not as the word "bold".
   *
   * ## What this was, and what it cost
   *
   * ```ts
   * if (typography.fontWeight >= 600) parts.push('bold');
   * ```
   *
   * Two outcomes for nine weights. Everything from Thin to Medium drew at 400
   * and everything from Semi Bold to Black drew at 700, so **seven of the nine
   * weights did not exist on the canvas** — the model stored them, the panel
   * (once it could ask for them) offered them, and the board drew one of two
   * things.
   *
   * It was also inconsistent with itself: `domTextStyle` below has always
   * passed `fontWeight` straight through, and that is what the editing overlay
   * uses. Text set in Light therefore *changed weight the moment you
   * double-clicked it* and changed back when you clicked away — a real
   * on-screen symptom that had nowhere to be reported, because nothing in the
   * panel could produce a Light in the first place.
   *
   * ## Why a number is safe here
   *
   * Konva composes its canvas font as `fontStyle + ' ' + fontVariant + ' ' +
   * size + 'px ' + family`, which lands in the CSS `font` shorthand. That
   * shorthand takes style, variant and weight **in any order** before the size,
   * so `600 normal 16px Inter` and `italic 600 normal 16px Inter` are both
   * valid and both mean what they say. The word "bold" was only ever one legal
   * value of the same slot.
   */
  parts.push(String(typography.fontWeight || 400));
  return parts.join(' ');
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

/**
 * The stored weight, exactly: 0.25 stays 0.25. Never negative, since a canvas
 * silently keeps its previous `lineWidth` when handed one, and the stroke would
 * draw at whatever the last object on the board happened to use.
 */
export function strokeWidth(appearance: Appearance | undefined): number {
  const width = appearance?.stroke?.width ?? 0;
  return Number.isFinite(width) && width > 0 ? width : 0;
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
 * Konva's own shadow props, for the one renderer that still casts natively.
 *
 * Text is drawn as a run of `<Text>` nodes whose glyphs never overlap, so a
 * shadow per run adds up to the shadow of the whole block: there is no fill
 * and stroke over the same pixels to cast twice. Everything with a fill *and*
 * a line — shapes, paths, pictures, connectors — casts from its whole
 * silhouette through `DropShadow` instead (see `ShapeEffects.tsx`).
 *
 * Returns nothing at all when there is no shadow: Konva treats
 * `shadowBlur: 0` as a shadow it still has to consider on every draw.
 *
 * `flipped` corrects a Konva quirk. It scales the offset by the node's
 * *decomposed* scale, and a mirrored node decomposes to a half turn with a
 * negative vertical scale, so its shadow would fall upwards. Every other
 * shadow on the board falls down, flipped or not.
 *
 * `shadowForStrokeEnabled: false` because the glyph fill is the silhouette; a
 * text outline is drawn as its own pass and must not cast a second shadow.
 */
export function shadowProps(appearance: Appearance | undefined, opts: { flipped?: boolean } = {}): Record<string, unknown> {
  const shadow = appearance?.shadow;
  if (!castsShadow(shadow)) return {};
  return {
    shadowColor: shadow.color,
    shadowBlur: Math.max(0, shadow.blur),
    shadowOffsetX: shadow.offsetX,
    shadowOffsetY: opts.flipped ? -shadow.offsetY : shadow.offsetY,
    shadowOpacity: shadow.opacity ?? 1,
    shadowForStrokeEnabled: false,
  };
}

/** Whether a node is mirrored an odd number of times, which flips Konva's shadow offset. */
export function isMirrored(node: { scaleX?: number; scaleY?: number }): boolean {
  return (node.scaleX ?? 1) * (node.scaleY ?? 1) < 0;
}

/**
 * The CSS `font-family` value for a family name.
 *
 * A one-line delegation to `fontCatalogue.fontStack`, which is the point. This
 * was a 26-case `switch` — a second font catalogue, kept in step with the
 * picker's by hand, and the failure mode was silent: a face added to the picker
 * and forgotten here rendered in the default with nothing to say it had
 * happened. One list now, and the renderer reads it.
 */
export function canvasFontFamily(name: string | undefined): string {
  return fontStack(name);
}

/** CSS font shorthand pieces for the DOM textareas used during editing. */
export function domTextStyle(typography: Typography): React.CSSProperties {
  return {
    fontFamily: canvasFontFamily(typography.fontFamily),
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
