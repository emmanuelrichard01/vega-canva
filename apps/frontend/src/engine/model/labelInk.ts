import { contrastInk, luminance } from './color';
import { DEFAULT_INK, type AnyNode } from './schema';

/**
 * What colour a shape's own label should be drawn in.
 *
 * ## The problem
 *
 * `DEFAULT_TYPOGRAPHY.color` is `DEFAULT_INK`, a near-black, and
 * `ShapeRenderer` drew `node.typography.color` exactly as stored. Type into a
 * shape you have filled dark and the words are near-black on near-black. The
 * text is there, it syncs, it exports; it simply cannot be read.
 *
 * ## Why this resolves from the fill and not from the theme
 *
 * `DEFAULT_INK` carries a deliberate note: it is a **document** value, not a
 * `--token`, because content cannot resolve per viewer or two people looking
 * at one board would see two different drawings. That reasoning is right and
 * this does not break it. The fill is part of the same document, so every
 * viewer computes the same ink from the same input — this is derivation, not
 * theming. `ThemeService.getDefaultTextColor()` is the correct tool for a
 * *new* node's stored colour, and the wrong one here.
 *
 * ## Why only the untouched default is overridden
 *
 * A colour the user picked is an instruction, including a bad one: someone
 * choosing grey-on-grey has chosen it, and silently correcting them would make
 * the colour control appear broken. Only `DEFAULT_INK` — the value nobody
 * chose — is treated as "unset and free to derive".
 */
export function labelInk(node: AnyNode): string | undefined {
  const typography = 'typography' in node ? node.typography : undefined;
  if (!typography) return undefined;
  if (typography.color !== DEFAULT_INK) return typography.color;

  const fill = solidFillOf(node);
  if (!fill) return typography.color;

  // A light fill keeps the default ink rather than snapping to pure black:
  // the two are close, and the default is the one the rest of the board uses.
  return luminance(fill) > 0.45 ? typography.color : contrastInk(fill);
}

/** The first solid fill on a node, if it has one. Gradients have no one colour. */
export function solidFillOf(node: AnyNode): string | undefined {
  const appearance = 'appearance' in node ? node.appearance : undefined;
  const first = appearance?.fill?.[0];
  if (!first || first.type !== 'solid') return undefined;
  // A fill you can see through is not the surface the text sits on.
  if (typeof first.opacity === 'number' && first.opacity < 0.5) return undefined;
  return first.color;
}
