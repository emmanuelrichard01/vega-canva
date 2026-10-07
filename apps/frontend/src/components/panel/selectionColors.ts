import { normalizeHex } from '../../engine/model/color';
import type { AnyNode, Appearance, Paint, Typography } from '../../engine/model/schema';

/**
 * The colours a set of objects is painted with, and rewriting one of them.
 *
 * Pure, so "Selection colours" and the Board section can be tested without a
 * document: the panel turns the patches into one `applyNodePatches` call,
 * which makes a recolour one undo step however many objects it touches.
 */

export type ColorRole = 'fill' | 'stroke' | 'text';

export interface ColorUse {
  /** Upper-case `#RRGGBB`. */
  color: string;
  count: number;
  roles: ColorRole[];
  ids: string[];
}

const key = (color: string | undefined): string | null => {
  if (!color || color === 'transparent') return null;
  const hex = normalizeHex(color);
  return hex ? hex.toUpperCase() : null;
};

function appearanceOf(node: AnyNode): Appearance | undefined {
  return (node as { appearance?: Appearance }).appearance;
}

function typographyOf(node: AnyNode): Typography | undefined {
  const t = (node as { typography?: Typography }).typography;
  if (!t) return undefined;
  if (node.type === 'text') return t;
  return (node as { text?: string }).text ? t : undefined;
}

function visit(node: AnyNode, fn: (color: string, role: ColorRole) => void): void {
  const a = appearanceOf(node);
  for (const paint of a?.fill ?? []) {
    if (paint.type === 'solid') {
      if ((paint.opacity ?? 1) > 0) fn(paint.color, 'fill');
    } else {
      paint.stops.forEach((s) => fn(s.color, 'fill'));
    }
  }
  if (a?.stroke && a.stroke.width > 0) fn(a.stroke.color, 'stroke');
  const t = typographyOf(node);
  if (t?.color) fn(t.color, 'text');
}

/** Unique colours across `nodes`, most used first. */
export function colorUses(nodes: readonly AnyNode[], limit = 24): ColorUse[] {
  const uses = new Map<string, { count: number; roles: Set<ColorRole>; ids: Set<string> }>();
  for (const node of nodes) {
    visit(node, (color, role) => {
      const k = key(color);
      if (!k) return;
      const u = uses.get(k) ?? { count: 0, roles: new Set<ColorRole>(), ids: new Set<string>() };
      u.count += 1;
      u.roles.add(role);
      u.ids.add(node.id);
      uses.set(k, u);
    });
  }
  return [...uses.entries()]
    .map(([color, u]) => ({ color, count: u.count, roles: [...u.roles], ids: [...u.ids] }))
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color))
    .slice(0, limit);
}

/**
 * Patches that repaint every use of `from` in `nodes` with `to`: solid fills,
 * gradient stops, strokes and text. Objects that do not use `from` get no
 * patch at all.
 */
export function recolorPatches(
  nodes: readonly AnyNode[],
  from: string,
  to: string
): Array<{ id: string; changes: Record<string, unknown> }> {
  const target = key(from);
  if (!target) return [];
  const same = (c: string | undefined) => key(c) === target;
  const patches: Array<{ id: string; changes: Record<string, unknown> }> = [];

  for (const node of nodes) {
    const changes: Record<string, unknown> = {};
    const a = appearanceOf(node);
    if (a) {
      let touched = false;
      const fill = a.fill?.map((paint): Paint => {
        if (paint.type === 'solid') {
          if (same(paint.color)) {
            touched = true;
            return { ...paint, color: to };
          }
          return paint;
        }
        if (paint.stops.some((s) => same(s.color))) {
          touched = true;
          return { ...paint, stops: paint.stops.map((s) => (same(s.color) ? { ...s, color: to } : s)) };
        }
        return paint;
      });
      const stroke = a.stroke && same(a.stroke.color) ? { ...a.stroke, color: to } : a.stroke;
      if (stroke !== a.stroke) touched = true;
      if (touched) changes.appearance = { ...a, fill, stroke };
    }
    const t = typographyOf(node);
    if (t && same(t.color)) changes.typography = { ...t, color: to };
    if (Object.keys(changes).length > 0) patches.push({ id: node.id, changes });
  }
  return patches;
}

export interface TextStyleUse {
  family: string;
  size: number;
  weight: number;
  count: number;
  ids: string[];
}

/** The font, size and weight combinations on a board, most used first. */
export function textStyles(nodes: readonly AnyNode[], limit = 8): TextStyleUse[] {
  const styles = new Map<string, TextStyleUse>();
  for (const node of nodes) {
    const t = typographyOf(node);
    if (!t) continue;
    const weight = t.fontWeight ?? 400;
    const size = Math.round(t.fontSize);
    const k = `${t.fontFamily}|${size}|${weight}`;
    const s = styles.get(k) ?? { family: t.fontFamily, size, weight, count: 0, ids: [] };
    s.count += 1;
    s.ids.push(node.id);
    styles.set(k, s);
  }
  return [...styles.values()]
    .sort((a, b) => b.count - a.count || b.size - a.size || a.family.localeCompare(b.family))
    .slice(0, limit);
}
