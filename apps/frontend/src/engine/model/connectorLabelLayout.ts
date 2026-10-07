/**
 * Where a connector's words sit, and the small amount of state for typing one.
 *
 * A label is placed by its `t` (how far along the run, 0 to 1) and `dn` (how
 * far across it). A label with no `t` is placed by the board-wide arrangement
 * in `connectorLabelStore`, so labels nobody has moved stay clear of each
 * other; one somebody dragged stays where they put it.
 */

import type { ConnectorLabel, ConnectorNode } from './schema';
import { pointAlong } from './connectorLabels';

export interface Pt {
  x: number;
  y: number;
}

/** The labels a connector draws, folding in the single-word form. */
export function labelsOf(node: Pick<ConnectorNode, 'labels' | 'label'>): ConnectorLabel[] {
  if (node.labels && node.labels.length > 0) return node.labels;
  if (node.label && node.label.trim()) return [{ id: 'l0', text: node.label }];
  return [];
}

/** Label size follows the stroke: S 12, M 14, L 18 world units. */
export function labelFontSize(strokeWidth: number): number {
  if (strokeWidth <= 2) return 12;
  if (strokeWidth <= 4) return 14;
  return 18;
}

/** The unit tangent of a route at `t`, from a short chord either side. */
export function tangentAt(flat: readonly number[], t: number): Pt {
  const a = pointAlong(flat, Math.max(0, t - 0.01));
  const b = pointAlong(flat, Math.min(1, t + 0.01));
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return len === 0 ? { x: 1, y: 0 } : { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/** The point a label at `t`, offset `dn` across the run, is centred on. */
export function labelAnchor(flat: readonly number[], t: number, dn = 0): Pt {
  const p = pointAlong(flat, t);
  if (!dn) return p;
  const tan = tangentAt(flat, t);
  return { x: p.x - tan.y * dn, y: p.y + tan.x * dn };
}

/**
 * The nearest point on a route to `p`: where along it (`t`) and how far
 * across it (`dn`, signed, positive to the left of travel).
 */
export function projectOnRoute(flat: readonly number[], p: Pt): { t: number; dn: number } {
  const n = Math.floor(flat.length / 2);
  if (n < 2) return { t: 0, dn: 0 };
  let total = 0;
  const lengths: number[] = [];
  for (let i = 0; i + 1 < n; i += 1) {
    const d = Math.hypot(flat[i * 2 + 2] - flat[i * 2], flat[i * 2 + 3] - flat[i * 2 + 1]);
    lengths.push(d);
    total += d;
  }
  if (total === 0) return { t: 0, dn: 0 };
  let best = { dist: Infinity, along: 0, dn: 0 };
  let walked = 0;
  for (let i = 0; i + 1 < n; i += 1) {
    const ax = flat[i * 2];
    const ay = flat[i * 2 + 1];
    const bx = flat[i * 2 + 2];
    const by = flat[i * 2 + 3];
    const len = lengths[i];
    const u = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / (len * len)));
    const qx = ax + (bx - ax) * u;
    const qy = ay + (by - ay) * u;
    const dist = Math.hypot(p.x - qx, p.y - qy);
    if (dist < best.dist) {
      const cross = len === 0 ? 0 : ((bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax)) / len;
      best = { dist, along: walked + u * len, dn: cross };
    }
    walked += len;
  }
  return { t: best.along / total, dn: best.dn };
}

/** A label being typed: either an existing one, or a new one not yet written. */
export interface LabelDraft {
  connectorId: string;
  labelId: string;
  t: number;
  isNew: boolean;
}

type Listener = () => void;
let draft: LabelDraft | null = null;
const listeners = new Set<Listener>();

export const labelEditStore = {
  get: (): LabelDraft | null => draft,
  set(next: LabelDraft | null) {
    draft = next;
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/** Resample a polyline to `count` points evenly spaced along its length. */
export function resample(flat: readonly number[], count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = pointAlong(flat, count === 1 ? 0 : i / (count - 1));
    out.push(p.x, p.y);
  }
  return out;
}
