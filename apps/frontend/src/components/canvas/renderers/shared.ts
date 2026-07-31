import type { Appearance, LineCap, Typography } from '../../../engine/model/schema';

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

export function konvaTextDecoration(typography: Typography | undefined): string {
  return typography?.underline ? 'underline' : '';
}

/** First solid fill, or a fallback. */
export function fillColor(appearance: Appearance | undefined, fallback: string): string {
  return appearance?.fill?.[0]?.color ?? fallback;
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
): { dash?: number[]; lineCap?: LineCap } {
  const stroke = appearance?.stroke;
  return {
    dash: stroke?.dash,
    lineCap: stroke?.cap ?? fallbackCap,
  };
}

/** CSS font shorthand pieces for the DOM textareas used during editing. */
export function domTextStyle(typography: Typography): React.CSSProperties {
  return {
    fontFamily: typography.fontFamily,
    fontSize: `${typography.fontSize}px`,
    fontWeight: typography.fontWeight,
    fontStyle: typography.italic ? 'italic' : 'normal',
    textDecoration: typography.underline ? 'underline' : 'none',
    textAlign: typography.align,
    lineHeight: typography.lineHeight,
    letterSpacing: `${typography.letterSpacing}px`,
    color: typography.color,
  };
}
