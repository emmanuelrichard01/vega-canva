import { nodeBounds } from '../SceneGraph';
import type { AnyNode } from '../model/schema';

export interface MarqueeBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type Point = { x: number; y: number };

/** A node's four corners as drawn: rotated (and sheared) about its centre. */
function corners(node: AnyNode): Point[] {
  const w = (node.width || 0) * Math.abs(node.scaleX || 1);
  const h = (node.height || 0) * Math.abs(node.scaleY || 1);
  const cx = node.x + w / 2;
  const cy = node.y + h / 2;
  const rad = ((node.rotation || 0) * Math.PI) / 180;
  const kx = Math.tan(((node.skewX || 0) * Math.PI) / 180);
  const ky = Math.tan(((node.skewY || 0) * Math.PI) / 180);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([ox, oy]) => {
    const sx = ox + kx * oy;
    const sy = oy + ky * ox;
    return { x: cx + sx * cos - sy * sin, y: cy + sx * sin + sy * cos };
  });
}

/** Separating-axis test between a convex quad and an axis-aligned box. */
function quadMeetsBox(quad: Point[], box: MarqueeBox): boolean {
  const boxPts: Point[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  const axes: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    axes.push({ x: -(b.y - a.y), y: b.x - a.x });
  }
  for (const axis of axes) {
    if (axis.x === 0 && axis.y === 0) continue;
    let qMin = Infinity, qMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (const p of quad) {
      const d = p.x * axis.x + p.y * axis.y;
      qMin = Math.min(qMin, d);
      qMax = Math.max(qMax, d);
    }
    for (const p of boxPts) {
      const d = p.x * axis.x + p.y * axis.y;
      bMin = Math.min(bMin, d);
      bMax = Math.max(bMax, d);
    }
    if (qMax < bMin || bMax < qMin) return false;
  }
  return true;
}

/**
 * The selectable nodes a marquee touches, judged by their outline as drawn.
 *
 * Testing the stored `x/y/width/height` box ignores rotation: a long bar turned
 * on end is picked up by a drag beside where it would lie flat, and missed by
 * one across where it actually is.
 */
export function marqueeHits(nodes: Iterable<AnyNode>, box: MarqueeBox): string[] {
  const hits: string[] = [];
  for (const node of nodes) {
    if (!node || node.locked || (node as { hidden?: boolean }).hidden) continue;
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
    const b = nodeBounds(node);
    if (b.maxX < box.minX || b.minX > box.maxX || b.maxY < box.minY || b.minY > box.maxY) continue;
    if (!node.rotation && !node.skewX && !node.skewY) {
      hits.push(node.id);
      continue;
    }
    if (quadMeetsBox(corners(node), box)) hits.push(node.id);
  }
  return hits;
}

/**
 * What a marquee does with what it catches.
 *
 * - `replace`: the catch becomes the selection.
 * - `add`: Shift keeps what was selected and adds the catch.
 * - `subtract`: Alt removes the catch from the selection.
 * - `intersect`: Shift+Alt keeps only what was selected *and* caught.
 *
 * The deep modifier (see `deepSelect`) is not a mode: it changes what counts
 * as caught, by skipping `expandToUnits`, and combines with any of these.
 */
export type MarqueeMode = 'replace' | 'add' | 'subtract' | 'intersect';

/**
 * Whether a marquee is being dragged. Other Alt-driven overlays (the measure
 * lines) read this to stay out of the way, since Alt means "subtract" here.
 */
const marqueeListeners = new Set<() => void>();
let marqueeOn = false;
export const marqueeActivity = {
  subscribe(listener: () => void) {
    marqueeListeners.add(listener);
    return () => {
      marqueeListeners.delete(listener);
    };
  },
  get: () => marqueeOn,
  set(next: boolean) {
    if (marqueeOn === next) return;
    marqueeOn = next;
    marqueeListeners.forEach((l) => l());
  },
};

export interface ModifierState {
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function marqueeModeFor(mods: ModifierState | null | undefined): MarqueeMode {
  const add = Boolean(mods?.shiftKey);
  const alt = Boolean(mods?.altKey);
  if (alt && add) return 'intersect';
  if (alt) return 'subtract';
  if (add) return 'add';
  return 'replace';
}

/** Combine the current selection with a marquee's catch. Keeps the selection's order. */
export function applyMarquee(
  previous: readonly string[],
  caught: readonly string[],
  mode: MarqueeMode
): string[] {
  const hit = new Set(caught);
  switch (mode) {
    case 'replace':
      return Array.from(new Set(caught));
    case 'add':
      return Array.from(new Set([...previous, ...caught]));
    case 'subtract':
      return previous.filter((id) => !hit.has(id));
    case 'intersect':
      return previous.filter((id) => hit.has(id));
  }
}

/**
 * Widen raw hits to whole selection units.
 *
 * A marquee that touches one member of a group catches the group, the same way
 * a click on that member does; `unitOf` is that click rule (`selectionWithin`).
 */
export function expandToUnits(hits: readonly string[], unitOf: (id: string) => readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of hits) for (const member of unitOf(id)) out.add(member);
  return Array.from(out);
}
