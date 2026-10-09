/**
 * Smart move: objects that appear on two consecutive slides travel between
 * them, as Keynote's Magic Move and Figma Slides' Smart animate do.
 *
 * ## Which objects are "the same"
 *
 * Three tiers, strongest first, each only among what the earlier tiers left:
 *
 * 1. **The same layer name.** Renaming two objects alike is how somebody says
 *    "these are one thing" on purpose, and layouts name their parts (Title,
 *    Subtitle, Number), so a title glides to wherever the next slide keeps it.
 * 2. **The same words, or the same picture.** A duplicated slide keeps every
 *    label and image, so editing a copy moves what stayed and cross-fades
 *    what changed.
 * 3. **The same look.** Unlabelled shapes of one kind and one colour, for the
 *    drawn pieces of a diagram that is rearranged from slide to slide.
 *
 * When a key is shared by several objects on both slides they are paired in
 * reading order, so three bullets become three bullets rather than a shuffle.
 * Anything left over leaves with the old slide or arrives with the new one.
 *
 * Boxes are compared in each slide's own units (0 to 1 across the page), so a
 * slide can sit anywhere on the board. Slides of different proportions do not
 * smart-move; they dissolve.
 */

export interface MoveNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  title?: string;
  text?: unknown;
  src?: unknown;
  geometry?: { kind?: string };
  appearance?: { fill?: ReadonlyArray<{ type: string; color?: string }> };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MovePair {
  a: MoveNode;
  b: MoveNode;
  /** Each end's box in its slide's units, 0..1. */
  from: Rect;
  to: Rect;
}

export interface MovePlan {
  pairs: MovePair[];
  /** On the old slide only: fades out. */
  leaving: MoveNode[];
  /** On the new slide only: fades in. */
  entering: MoveNode[];
}

/** Total length of the move, inside the 300–500ms a transition can take without dragging. */
export const SMART_MOVE_MS = 460;
export const DISSOLVE_MS = 360;
/** A cut softened just enough to read as a change of slide, for reduced motion. */
export const REDUCED_DISSOLVE_MS = 160;

const words = (text: unknown) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().toLowerCase() : '');

function keyFor(tier: 0 | 1 | 2, node: MoveNode): string | null {
  if (tier === 0) return node.title?.trim() ? `name:${node.type}:${node.title.trim().toLowerCase()}` : null;
  if (tier === 1) {
    const w = words(node.text);
    if (w) return `text:${node.type}:${w}`;
    return typeof node.src === 'string' && node.src ? `src:${node.src}` : null;
  }
  // Words that differ are different objects; only wordless pieces match by look.
  if (node.type === 'connector' || node.type === 'frame' || node.type === 'text' || words(node.text)) return null;
  const fill = node.appearance?.fill?.find((p) => p.type === 'solid')?.color?.toLowerCase() ?? '';
  return `look:${node.type}:${node.geometry?.kind ?? ''}:${fill}`;
}

const readingOrder = (a: MoveNode, b: MoveNode) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1);

/** `node`'s box in the units of the slide `frame`, 0..1 across. */
export function relativeBox(node: Rect, frame: Rect): Rect {
  const w = Math.max(1, frame.width);
  const h = Math.max(1, frame.height);
  return { x: (node.x - frame.x) / w, y: (node.y - frame.y) / h, width: node.width / w, height: node.height / h };
}

/** Whether two slides are the same shape, so one's units mean the same as the other's. */
export function sameProportion(a: Rect, b: Rect): boolean {
  const ra = a.width / Math.max(1, a.height);
  const rb = b.width / Math.max(1, b.height);
  return Math.abs(ra - rb) / Math.max(ra, rb) < 0.01;
}

/**
 * Pair the objects of slide `a` (in frame `fa`) with those of slide `b`.
 *
 * Connectors are left out: they are drawn from the objects they join, so they
 * belong to whichever slide is showing rather than travelling themselves.
 */
export function matchSlides(fa: Rect, a: readonly MoveNode[], fb: Rect, b: readonly MoveNode[]): MovePlan {
  const left = new Set(a.filter((n) => n.type !== 'connector'));
  const right = new Set(b.filter((n) => n.type !== 'connector'));
  const pairs: MovePair[] = [];

  for (const tier of [0, 1, 2] as const) {
    const byKey = (set: Set<MoveNode>) => {
      const map = new Map<string, MoveNode[]>();
      for (const n of set) {
        const k = keyFor(tier, n);
        if (!k) continue;
        const list = map.get(k);
        if (list) list.push(n);
        else map.set(k, [n]);
      }
      return map;
    };
    const ka = byKey(left);
    const kb = byKey(right);
    for (const [k, as] of ka) {
      const bs = kb.get(k);
      if (!bs) continue;
      as.sort(readingOrder);
      bs.sort(readingOrder);
      const count = Math.min(as.length, bs.length);
      for (let i = 0; i < count; i++) {
        pairs.push({ a: as[i], b: bs[i], from: relativeBox(as[i], fa), to: relativeBox(bs[i], fb) });
        left.delete(as[i]);
        right.delete(bs[i]);
      }
    }
  }

  return { pairs, leaving: [...left], entering: [...right] };
}

/** Slow in and out: a move that starts and lands softly reads as one object travelling. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** The fade the old and new slide make: quick out of the old, settling into the new. */
export function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), width: lerp(a.width, b.width, t), height: lerp(a.height, b.height, t) };
}

/**
 * One frame of a smart move at progress `t` (0..1).
 *
 * Travellers move on the eased curve and swap their old look for their new
 * one across the middle of the move, so a heading whose words changed reads
 * as one heading rewriting itself rather than two overlapping. Everything
 * else cross-fades with the pages behind it.
 */
export function smartMoveFrame(plan: MovePlan, t: number): {
  page: { from: number; to: number };
  sprites: Array<{ pair: MovePair; box: Rect; from: number; to: number }>;
} {
  const e = easeInOut(t);
  const swap = Math.min(1, Math.max(0, (t - 0.25) / 0.5));
  return {
    page: { from: 1 - easeOut(t), to: easeOut(t) },
    sprites: plan.pairs.map((pair) => ({
      pair,
      box: lerpRect(pair.from, pair.to, e),
      from: 1 - swap,
      to: swap,
    })),
  };
}
