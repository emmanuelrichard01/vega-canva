import type { Appearance, Typography } from '../../../engine/model/schema';

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
