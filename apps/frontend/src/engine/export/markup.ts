/**
 * Escaping for string-built SVG and HTML.
 *
 * Every value interpolated into markup goes through one of these, whether or
 * not it "should" be safe already. Colours are validated when the document is
 * read (`text/cssColor.ts`), but the exporters do not rely on that: escaping
 * here is what makes a missed validator a wrong colour rather than a script.
 */
const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text content or a quoted attribute value. */
export function escapeXml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]);
}

/** Alias that reads better at an attribute site: `fill="${attr(c)}"`. */
export const attr = escapeXml;

/**
 * A number for an attribute. Non-finite values become 0 so a NaN never reaches
 * a coordinate, and the result never needs escaping.
 */
export function num(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? String(n) : '0';
}
