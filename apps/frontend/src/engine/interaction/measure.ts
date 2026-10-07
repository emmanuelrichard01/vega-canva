/**
 * Distances between the selection and another object, shown while Alt is held
 * (Figma's measure). Pure: world boxes in, segments out.
 *
 * - **Apart:** one segment per axis the boxes are separated on, from the
 *   nearer edges, drawn through the middle of their overlap on the other axis
 *   (or from the selection's centre when they do not overlap there either).
 * - **Nested:** when one box contains the other, the four insets between them.
 * - **Overlapping** without containment: the distance between matching edges
 *   on each axis where they differ.
 */
export interface MeasureBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MeasureSegment {
  /** `horizontal` measures along x; `vertical` measures along y. */
  orientation: 'horizontal' | 'vertical';
  /** The fixed coordinate the line runs along (y for horizontal, x for vertical). */
  position: number;
  from: number;
  to: number;
  /** The distance, in world units. */
  value: number;
}

const right = (b: MeasureBox) => b.x + b.width;
const bottom = (b: MeasureBox) => b.y + b.height;

function overlapMid(a0: number, a1: number, b0: number, b1: number, fallback: number): number {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  return lo <= hi ? (lo + hi) / 2 : fallback;
}

function contains(outer: MeasureBox, inner: MeasureBox): boolean {
  return outer.x <= inner.x && outer.y <= inner.y && right(outer) >= right(inner) && bottom(outer) >= bottom(inner);
}

function seg(orientation: MeasureSegment['orientation'], position: number, a: number, b: number): MeasureSegment | null {
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  const value = to - from;
  return value > 0.0001 ? { orientation, position, from, to, value } : null;
}

export function measureBetween(sel: MeasureBox, other: MeasureBox): MeasureSegment[] {
  const out: (MeasureSegment | null)[] = [];
  const cx = sel.x + sel.width / 2;
  const cy = sel.y + sel.height / 2;

  if (contains(other, sel) || contains(sel, other)) {
    const inner = contains(other, sel) ? sel : other;
    const outer = inner === sel ? other : sel;
    const icx = inner.x + inner.width / 2;
    const icy = inner.y + inner.height / 2;
    out.push(seg('horizontal', icy, outer.x, inner.x));
    out.push(seg('horizontal', icy, right(inner), right(outer)));
    out.push(seg('vertical', icx, outer.y, inner.y));
    out.push(seg('vertical', icx, bottom(inner), bottom(outer)));
    return out.filter((s): s is MeasureSegment => s !== null);
  }

  const apartX = right(sel) < other.x || right(other) < sel.x;
  const apartY = bottom(sel) < other.y || bottom(other) < sel.y;

  if (apartX) {
    const y = overlapMid(sel.y, bottom(sel), other.y, bottom(other), cy);
    out.push(right(sel) < other.x ? seg('horizontal', y, right(sel), other.x) : seg('horizontal', y, right(other), sel.x));
  }
  if (apartY) {
    const x = overlapMid(sel.x, right(sel), other.x, right(other), cx);
    out.push(bottom(sel) < other.y ? seg('vertical', x, bottom(sel), other.y) : seg('vertical', x, bottom(other), sel.y));
  }
  if (!apartX && !apartY) {
    // Overlapping, neither inside the other: how far each edge is from its twin.
    out.push(seg('horizontal', cy, sel.x, other.x));
    out.push(seg('horizontal', cy, right(sel), right(other)));
    out.push(seg('vertical', cx, sel.y, other.y));
    out.push(seg('vertical', cx, bottom(sel), bottom(other)));
  }
  return out.filter((s): s is MeasureSegment => s !== null);
}

/** A distance as a label: whole units, or one decimal below ten. */
export function formatDistance(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  return abs < 10 && abs % 1 !== 0 ? abs.toFixed(1) : String(Math.round(abs));
}
