import {
  alignTo,
  distributeSelection,
  distributeSpacing,
  measureSpacing,
  type AlignEdge,
  type DistributeAxis,
} from '../model/align';
import { isOpenShape, type AnyNode, type Appearance } from '../model/schema';
import { kindNoun } from '../model/selectMatching';
import { selectionBounds, type Box, type NodePatch } from '../model/selection';
import { layoutRows, tidySelection } from './tidy';
import { arrangeUnits, expandPatches, landedBoxes, unitProxy, type ArrangeUnit } from './units';
import type { GroupRecord } from '../model/groupTree';

/**
 * Arrangement plans for a selection's units: what would move where, and why
 * a plan cannot be made. Pure; the rail applies the patches as one write, and
 * the board draws `landed` while a control is pointed at.
 */

export type AlignTarget = 'selection' | 'key' | 'frame';

export type Plan = { patches: NodePatch[]; landed: Box[]; reference?: Box } | { reason: string };

export const isPlan = (p: Plan): p is Extract<Plan, { patches: NodePatch[] }> => 'patches' in p;

/** The unit an Illustrator-style key defaults to: the largest, which is what people align to. */
export function defaultKey(units: readonly ArrangeUnit[]): string | null {
  let best: ArrangeUnit | null = null;
  for (const u of units) {
    const area = u.box.width * u.box.height;
    if (!best || area > best.box.width * best.box.height) best = u;
  }
  return best?.key ?? null;
}

/** The frame every unit sits in, as a box, or why there is none. */
export function sharedFrame(
  units: readonly ArrangeUnit[],
  objects: Readonly<Record<string, AnyNode>>
): { id: string; box: Box } | { reason: string } {
  if (units.length === 0) return { reason: 'Nothing here can move.' };
  const id = units[0].frameId;
  if (!id || units.some((u) => u.frameId !== id)) {
    return { reason: units.length === 1 ? 'Not inside a frame.' : 'These are not all inside one frame.' };
  }
  const frame = objects[id];
  if (!frame) return { reason: 'Not inside a frame.' };
  return { id, box: { x: frame.x, y: frame.y, width: frame.width, height: frame.height } };
}

export interface AlignContext {
  units: readonly ArrangeUnit[];
  target: AlignTarget;
  /** The key unit, for `target: 'key'`. */
  keyKey?: string | null;
  /** The shared frame, for `target: 'frame'`. */
  frame?: { id: string; box: Box } | { reason: string };
}

/** The box everything lines up against, and the unit that holds still, for a target. */
export function alignReference(ctx: AlignContext): { reference: Box; skip?: string } | { reason: string } {
  const { units, target } = ctx;
  if (target === 'frame') {
    if (!ctx.frame) return { reason: 'Not inside a frame.' };
    return 'reason' in ctx.frame ? ctx.frame : { reference: ctx.frame.box };
  }
  if (units.length < 2) {
    return {
      reason:
        units.length === 1 && units[0].group
          ? 'A group moves as one. Align it to its frame, or select more objects.'
          : 'Select two or more objects to line them up.',
    };
  }
  if (target === 'key') {
    const key = units.find((u) => u.key === ctx.keyKey) ?? units.find((u) => u.key === defaultKey(units));
    if (!key) return { reason: 'Choose a key object first.' };
    return { reference: key.box, skip: key.key };
  }
  const reference = selectionBounds(units.map(unitProxy));
  return reference ? { reference } : { reason: 'Nothing here can move.' };
}

export function planAlign(ctx: AlignContext, edge: AlignEdge): Plan {
  const ref = alignReference(ctx);
  if ('reason' in ref) return ref;
  const proxies = ctx.units.map(unitProxy);
  const raw = alignTo(proxies, edge, ref.reference, ref.skip);
  return { patches: expandPatches(ctx.units, raw), landed: landedBoxes(ctx.units, raw), reference: ref.reference };
}

/**
 * Align for a caller that holds nodes rather than units (the context menu, a
 * shortcut): the same group-aware answer the rail gives, against the selection.
 */
export function alignSelectionPatches(
  nodes: readonly AnyNode[],
  objects: Readonly<Record<string, AnyNode>>,
  groups: Readonly<Record<string, GroupRecord>>,
  edge: AlignEdge
): NodePatch[] {
  const plan = planAlign({ units: arrangeUnits(nodes, objects, groups).units, target: 'selection' }, edge);
  return isPlan(plan) ? plan.patches : [];
}

/** Distribute for a caller that holds nodes, group-aware. */
export function distributeSelectionPatches(
  nodes: readonly AnyNode[],
  objects: Readonly<Record<string, AnyNode>>,
  groups: Readonly<Record<string, GroupRecord>>,
  axis: DistributeAxis
): NodePatch[] {
  const plan = planDistribute(arrangeUnits(nodes, objects, groups).units, axis);
  return isPlan(plan) ? plan.patches : [];
}

/** Even gaps between the outermost two, which hold still. */
export function planDistribute(units: readonly ArrangeUnit[], axis: DistributeAxis): Plan {
  if (units.length < 3) return { reason: 'Needs three or more objects.' };
  const raw = distributeSelection(units.map(unitProxy), axis);
  return { patches: expandPatches(units, raw), landed: landedBoxes(units, raw) };
}

/** One exact gap, laid out from the anchor. */
export function planSpacing(
  units: readonly ArrangeUnit[],
  axis: DistributeAxis,
  gap: number,
  anchorKey?: string | null
): Plan {
  if (units.length < 2) return { reason: 'Needs two or more objects.' };
  const raw = distributeSpacing(units.map(unitProxy), axis, gap, anchorKey ?? undefined);
  return { patches: expandPatches(units, raw), landed: landedBoxes(units, raw) };
}

/** The gap the units already share along an axis, or null when it differs. */
export function currentSpacing(units: readonly ArrangeUnit[], axis: DistributeAxis): number | null {
  return measureSpacing(units.map(unitProxy), axis);
}

export type TidyShape = { kind: 'row' } | { kind: 'column' } | { kind: 'grid'; rows: number; columns: number };

/** What Tidy reads the selection as: the arrangement it is already trying to be. */
export function tidyShape(units: readonly ArrangeUnit[]): TidyShape {
  const { rows, spanners } = layoutRows(units.map(unitProxy));
  if (rows.length === 1 && spanners.length === 0) return { kind: 'row' };
  if (rows.every((r) => r.length === 1) && spanners.length === 0) return { kind: 'column' };
  return { kind: 'grid', rows: rows.length, columns: Math.max(...rows.map((r) => r.length)) };
}

export function describeTidyShape(shape: TidyShape): string {
  if (shape.kind === 'row') return 'Tidy into a row';
  if (shape.kind === 'column') return 'Tidy into a column';
  return `Tidy into ${shape.rows} rows`;
}

export function planTidy(units: readonly ArrangeUnit[]): Plan {
  if (units.length < 2) return { reason: 'Needs two or more objects.' };
  const raw = tidySelection(units.map(unitProxy));
  return { patches: expandPatches(units, raw), landed: landedBoxes(units, raw) };
}

// --------------------------------------------------------------- match size

export type MatchDimension = 'width' | 'height' | 'both';

/** Lines and arrows take their extent from their points, so a box size would bend them. */
const resizable = (n: AnyNode) =>
  n.type !== 'connector' &&
  n.type !== 'comment' &&
  n.type !== 'audio' &&
  !(n.type === 'shape' && isOpenShape(n.geometry.kind));

/** The single objects Match size can resize: not groups, not lines. */
export function matchable(units: readonly ArrangeUnit[]): AnyNode[] {
  return units.filter((u) => !u.group && u.members.length === 1 && resizable(u.members[0])).map((u) => u.members[0]);
}

const drawnW = (n: AnyNode) => n.width * Math.abs(n.scaleX || 1);
const drawnH = (n: AnyNode) => n.height * Math.abs(n.scaleY || 1);

/**
 * Every object to the size of the largest, or of the key when one is chosen.
 *
 * Measured on the drawn size (box times scale) and written back through the
 * scale, so a flipped or scaled object comes out the size you see. Each keeps
 * its top-left corner, the way Figma's resize from the panel does.
 */
export function planMatchSize(units: readonly ArrangeUnit[], dim: MatchDimension, keyKey?: string | null): Plan {
  const nodes = matchable(units);
  if (nodes.length < 2) {
    return { reason: units.some((u) => u.group) ? 'Groups keep their own size. Select single objects.' : 'Needs two or more objects that can be resized.' };
  }
  const key = keyKey ? nodes.find((n) => n.id === keyKey) : undefined;
  const width = key ? drawnW(key) : Math.max(...nodes.map(drawnW));
  const height = key ? drawnH(key) : Math.max(...nodes.map(drawnH));
  const patches: NodePatch[] = [];
  const landed: Box[] = [];
  for (const n of nodes) {
    const changes: Record<string, unknown> = {};
    if (dim !== 'height' && Math.abs(drawnW(n) - width) > 1e-6) changes.width = width / Math.abs(n.scaleX || 1);
    if (dim !== 'width' && Math.abs(drawnH(n) - height) > 1e-6) changes.height = height / Math.abs(n.scaleY || 1);
    if (Object.keys(changes).length > 0) patches.push({ id: n.id, changes });
    landed.push({
      x: n.x,
      y: n.y,
      width: dim !== 'height' ? width : drawnW(n),
      height: dim !== 'width' ? height : drawnH(n),
    });
  }
  return { patches, landed };
}

// ------------------------------------------------------------------ combine

/** Whether Combine belongs on the rail, and the sentence for why it cannot run when it is shown off. */
export function combineAvailability(nodes: readonly AnyNode[]): { offer: boolean; reason: string | null } {
  const vector = nodes.filter((n) => n.type === 'shape' || (n.type === 'path' && n.geometry.kind !== 'freehand'));
  if (vector.length < 2) return { offer: false, reason: null };
  const others = nodes.filter((n) => !vector.includes(n));
  if (others.length === 0) return { offer: true, reason: null };
  const first = others[0];
  const sameKind = others.every((n) => n.type === first.type);
  const who =
    !sameKind ? 'Some of these' : others.length === 1 ? `The ${kindNoun(first, false)}` : capitalise(kindNoun(first, true));
  return { offer: true, reason: `${who} can't be combined. Select only shapes and paths.` };
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------ style summary

export type SummaryState = 'one' | 'mixed' | 'none' | 'na';

export interface StyleSummary {
  fill: { state: SummaryState; color?: string; gradient?: boolean };
  stroke: { state: SummaryState; color?: string; width?: number };
  opacity: { state: 'one' | 'mixed'; value?: number };
}

const FILLED = new Set(['shape', 'path', 'frame']);
const STROKED = new Set(['shape', 'path', 'frame', 'connector']);

const appearanceOf = (n: AnyNode) => (n as { appearance?: Appearance }).appearance;

/**
 * Fill, stroke and opacity across a selection, said honestly: one value when
 * every object that has the property agrees, Mixed when they do not, None when
 * they agree on nothing, and not applicable when none of them has it.
 */
export function summarizeStyle(nodes: readonly AnyNode[]): StyleSummary {
  const fills = nodes.filter((n) => FILLED.has(n.type)).map((n) => appearanceOf(n)?.fill?.[0] ?? null);
  const fillKeys = new Set(fills.map((p) => (p ? JSON.stringify(p) : 'none')));
  const fill: StyleSummary['fill'] =
    fills.length === 0
      ? { state: 'na' }
      : fillKeys.size > 1
        ? { state: 'mixed' }
        : fills[0] === null
          ? { state: 'none' }
          : fills[0].type === 'solid'
            ? { state: 'one', color: fills[0].color }
            : { state: 'one', gradient: true, color: fills[0].stops?.[0]?.color };

  const strokes = nodes
    .filter((n) => STROKED.has(n.type))
    .map((n) => {
      const s = appearanceOf(n)?.stroke;
      return s && s.width > 0 ? { color: s.color, width: s.width } : null;
    });
  const strokeKeys = new Set(strokes.map((s) => (s ? `${s.color}|${s.width}` : 'none')));
  const stroke: StyleSummary['stroke'] =
    strokes.length === 0
      ? { state: 'na' }
      : strokeKeys.size > 1
        ? { state: 'mixed' }
        : strokes[0] === null
          ? { state: 'none' }
          : { state: 'one', ...strokes[0] };

  const opacities = new Set(nodes.map((n) => Math.round((n.opacity ?? 1) * 100)));
  const opacity: StyleSummary['opacity'] =
    opacities.size === 1 ? { state: 'one', value: [...opacities][0] } : { state: 'mixed' };

  return { fill, stroke, opacity };
}
