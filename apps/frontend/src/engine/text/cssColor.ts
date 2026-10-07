/**
 * Which strings are allowed to stand for a colour.
 *
 * Colours are read from the shared document and written straight into SVG
 * attributes, Konva and CSS. A field that accepts any string is a field a
 * collaborator can close the attribute in and follow with markup, so every colour is checked
 * here, at the boundary, against a grammar that cannot contain a quote, an
 * angle bracket, a semicolon or a URL.
 *
 * Accepted: hex (#rgb, #rgba, #rrggbb, #rrggbbaa), a bare keyword
 * (`transparent`, `red`, `currentColor`), a colour function whose arguments
 * are numbers, units, commas, slashes and spaces (`rgba(28,25,23,0.2)`,
 * `hsl(210 40% 50% / .5)`, `oklch(0.7 0.1 200)`), and `var(--token)`.
 */
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const KEYWORD = /^[a-z]{3,24}$/i;
const FUNCTION = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([0-9a-z.%+\-,/ ]{1,64}\)$/i;
const VARIABLE = /^var\(--[a-z0-9-]{1,48}\)$/i;

export function isCssColor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length === 0 || v.length > 72) return false;
  return HEX.test(v) || KEYWORD.test(v) || FUNCTION.test(v) || VARIABLE.test(v);
}

/** The colour if it is one, otherwise `fallback`. */
export function cssColorOr<T>(value: unknown, fallback: T): string | T {
  return isCssColor(value) ? value.trim() : fallback;
}
