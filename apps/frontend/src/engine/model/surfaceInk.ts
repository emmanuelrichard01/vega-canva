import { contrastInk, luminance } from './color';
import { DEFAULT_INK, type AnyNode } from './schema';

/**
 * Ink that follows the surface an object sits on.
 *
 * A board is light or dark, but an object often sits on something else: a
 * white frame on a dark board, a dark slide on a light one. Choosing ink from
 * the board alone puts pale chart labels on white paper. The ground is the
 * fill of the owning frame when it has a visible one (walking outward through
 * nested frames), and the board otherwise. Every viewer derives the same ink
 * from the same document, so this is derivation rather than theming.
 */

const MAX_DEPTH = 32;

/** Luminance above which a ground wants dark ink (the rule `labelInk` uses). */
const LIGHT_GROUND = 0.45;

/** The solid colour a frame paints behind its contents, if it paints one. */
function frameGround(frame: AnyNode): string | undefined {
  if (frame.type !== 'frame') return undefined;
  const first = frame.appearance?.fill?.[0];
  if (!first || first.type !== 'solid') return undefined;
  // A fill you can see through is not the surface the content sits on.
  if (typeof first.opacity === 'number' && first.opacity < 0.5) return undefined;
  return first.color;
}

/**
 * The colour behind `node`: the nearest owning frame with a visible solid
 * fill, or `null` when the node sits straight on the board.
 */
export function groundOf(node: AnyNode, objects: Readonly<Record<string, AnyNode>>): string | null {
  let id = node.frameId;
  const seen = new Set<string>();
  for (let depth = 0; id && depth < MAX_DEPTH && !seen.has(id); depth++) {
    seen.add(id);
    const frame = objects[id];
    if (!frame) return null;
    const ground = frameGround(frame);
    if (ground) return ground;
    id = frame.frameId;
  }
  return null;
}

/** Whether ink drawn on `ground` has to be light. */
export function isDarkGround(ground: string): boolean {
  const l = luminance(ground);
  return !Number.isNaN(l) && l <= LIGHT_GROUND;
}

/**
 * Whether content on this node's surface wants light ink: the owning frame's
 * fill when it has one, else the board.
 */
export function wantsLightInk(node: AnyNode, objects: Readonly<Record<string, AnyNode>>, boardDark: boolean): boolean {
  const ground = groundOf(node, objects);
  return ground ? isDarkGround(ground) : boardDark;
}

/** Near-black or white, whichever reads on `ground`. */
export function inkOn(ground: string): string {
  return contrastInk(ground);
}

/**
 * Text colour for a block on this surface. Only the untouched default ink is
 * derived: a colour somebody picked is an instruction and stays as stored.
 */
export function textInkOnSurface(
  color: string,
  node: AnyNode,
  objects: Readonly<Record<string, AnyNode>>,
  boardDark: boolean
): string {
  if (color !== DEFAULT_INK) return color;
  const ground = groundOf(node, objects);
  if (ground) return isDarkGround(ground) ? contrastInk(ground) : color;
  return boardDark ? '#F9FAFB' : color;
}

/** The ground a label's plate and ink are computed against. */
export function plateFor(
  node: AnyNode,
  objects: Readonly<Record<string, AnyNode>>,
  boardPlate: string
): string {
  return groundOf(node, objects) ?? boardPlate;
}
