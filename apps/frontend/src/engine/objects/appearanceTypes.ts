/**
 * The node types that carry an `appearance` block.
 *
 * A list rather than `'appearance' in node`, which asks whether the key is
 * *present* — and on a type where the field is optional it is absent until
 * something writes it. Text is exactly that case, so the key check meant a
 * text node could never be given its first shadow: the Appearance section
 * would not render until the value it sets already existed.
 *
 * It lived inside `PropertiesPanel` and `connector` was missing from it. The
 * registry declares `supportsStroke` and `supportsShadow` on connectors and
 * the panel asks for both — but every one of those sections is *also* gated
 * on `appearance` being non-null, so the omission switched all of them off.
 * Selecting an arrow gave you a panel with no way to change the one thing an
 * arrow is made of, while the controls sat in the source looking present.
 *
 * Two sources of truth for one question is the bug, so it lives out here
 * where `appearanceTypes.test.ts` can hold it against the registry. Declare a
 * paint capability on a type and the suite fails until this list agrees.
 */
export const APPEARANCE_TYPES: ReadonlySet<string> = new Set([
  'shape',
  'path',
  'image',
  'frame',
  'text',
  'connector',
  /**
   * A chart carries an `appearance` for exactly one thing -- the sketch block
   * -- and `ChartRenderer` honours it, drawing bars with `roughLoop` and runs
   * with `roughPolyline`. It is the first type to declare `supportsEdgeEffects`
   * without also declaring a fill or a stroke, which is how it found that the
   * test's list of appearance-gated capabilities was one short.
   */
  'chart',
]);
