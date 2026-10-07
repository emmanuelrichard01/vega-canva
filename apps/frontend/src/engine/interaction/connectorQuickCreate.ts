/**
 * Quick-create: grow a diagram from the object you are on.
 *
 * A selected shape or note offers a magnet on each side. Clicking one makes a
 * copy of the object on that side, in the nearest free space, joined to it by
 * a connector drawn the way the connector shelf says. Tab does the same in
 * the direction the diagram is already flowing (away from whatever leads into
 * this object, or to the right when nothing does), and Shift+Tab steps back
 * to the object that leads in. Pressing Tab repeatedly builds a chain.
 *
 * The placement is pure and tested; the action writes through the editor, so
 * it is one create per object like any tool's, and refused for anyone who
 * cannot edit.
 */

import { nanoid } from 'nanoid';
import { editor } from '../api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import { ThemeService } from '../ThemeService';
import { nodeBounds } from '../SceneGraph';
import { canEditObjects } from '../model/permissions';
import { isOpenShape, type AnyNode, type ConnectorNode } from '../model/schema';
import { blocksRoutes } from '../model/connectorRouter/obstacles';
import { intersects, inflate, type Rect } from '../model/connectorRouter/geometry';
import { connectorDefaults } from '../tools/connectorDefaults';

export type QuickSide = 'right' | 'bottom' | 'left' | 'top';

export const QUICK_SIDES: readonly QuickSide[] = ['right', 'bottom', 'left', 'top'];

/** Space between the object and the copy, in world units. */
export const QUICK_GAP = 80;
/** Clearance a copy keeps from anything already on the board. */
const CLEARANCE = 16;

/** Whether an object offers quick-create: a closed shape or a note someone may edit. */
export function offersQuickCreate(node: AnyNode | undefined | null): node is AnyNode {
  if (!node || node.hidden || node.locked) return false;
  if (node.type === 'sticky') return true;
  if (node.type !== 'shape') return false;
  const kind = (node as { geometry?: { kind?: string } }).geometry?.kind;
  return !(kind && isOpenShape(kind as never));
}

/**
 * Where a `width` × `height` copy goes on `side` of `source`: `gap` away and
 * centred on it, or the nearest free spot. Candidates slide sideways in
 * alternating steps (one copy-width and a margin at a time), then move a ring
 * further out, so a crowded side still gets a tidy, aligned spot. Returns the
 * top-left corner.
 */
export function quickCreatePlacement(
  source: Rect,
  side: QuickSide,
  width: number,
  height: number,
  blockers: readonly Rect[],
  gap = QUICK_GAP
): { x: number; y: number } {
  const cx = (source.minX + source.maxX) / 2;
  const cy = (source.minY + source.maxY) / 2;
  const horizontal = side === 'left' || side === 'right';
  const along = horizontal ? width : height;
  const across = horizontal ? height : width;
  const stepAcross = across + CLEARANCE * 1.5;

  const at = (ring: number, slide: number) => {
    const reach = gap + ring * (along + gap);
    let x: number;
    let y: number;
    if (side === 'right') x = source.maxX + reach;
    else if (side === 'left') x = source.minX - reach - width;
    else x = cx - width / 2;
    if (side === 'bottom') y = source.maxY + reach;
    else if (side === 'top') y = source.minY - reach - height;
    else y = cy - height / 2;
    if (horizontal) y += slide;
    else x += slide;
    return { x, y };
  };

  const free = (p: { x: number; y: number }) => {
    const box = inflate({ minX: p.x, minY: p.y, maxX: p.x + width, maxY: p.y + height }, CLEARANCE);
    return !blockers.some((b) => intersects(box, b));
  };

  for (let ring = 0; ring < 3; ring += 1) {
    for (let k = 0; k < 9; k += 1) {
      // 0, +1, -1, +2, -2 … steps across.
      const n = Math.ceil(k / 2) * (k % 2 === 1 ? 1 : -1);
      const p = at(ring, n * stepAcross);
      if (free(p)) return p;
    }
  }
  return at(0, 0);
}

/** The connector that leads into an object, if one does: the lowest id among them. */
function incoming(objects: Record<string, AnyNode>, id: string): ConnectorNode | null {
  let best: ConnectorNode | null = null;
  for (const node of Object.values(objects)) {
    if (node.type !== 'connector') continue;
    const c = node as ConnectorNode;
    if (c.to.nodeId !== id || !c.from.nodeId || !objects[c.from.nodeId]) continue;
    if (!best || c.id < best.id) best = c;
  }
  return best;
}

/** The side a chain keeps growing toward from `id`: away from what leads in, else right. */
export function flowSide(objects: Record<string, AnyNode>, id: string): QuickSide {
  const lead = incoming(objects, id);
  const node = objects[id];
  if (!lead || !node) return 'right';
  const from = nodeBounds(objects[lead.from.nodeId!]);
  const to = nodeBounds(node);
  const dx = (to.minX + to.maxX) / 2 - (from.minX + from.maxX) / 2;
  const dy = (to.minY + to.maxY) / 2 - (from.minY + from.maxY) / 2;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** The object one step back along the chain, for Shift+Tab. */
export function previousInChain(objects: Record<string, AnyNode>, id: string): string | null {
  return incoming(objects, id)?.from.nodeId ?? null;
}

/** The fields a copy keeps: what the object looks like, not who or where it is. */
function copyOf(node: AnyNode): Record<string, unknown> {
  const {
    id: _id,
    x: _x,
    y: _y,
    zIndex: _z,
    createdAt: _ca,
    updatedAt: _ua,
    createdBy: _cb,
    parentId: _p,
    locked: _l,
    hidden: _h,
    text: _t,
    tags: _tags,
    ...rest
  } = node as AnyNode & Record<string, unknown>;
  return { ...rest, text: '' };
}

/** Where a copy would land, for the hover preview. */
export function quickCreateTarget(sourceId: string, side: QuickSide): { x: number; y: number; width: number; height: number } | null {
  const objects = useStore.getState().objects;
  const source = objects[sourceId];
  if (!offersQuickCreate(source)) return null;
  const width = source.width * Math.abs(source.scaleX || 1);
  const height = source.height * Math.abs(source.scaleY || 1);
  const blockers: Rect[] = [];
  for (const node of Object.values(objects)) {
    if (node.id === sourceId || !blocksRoutes(node)) continue;
    blockers.push(nodeBounds(node));
  }
  const at = quickCreatePlacement(nodeBounds(source), side, width, height, blockers);
  return { ...at, width, height };
}

/**
 * Make the copy and the connector, and select the copy. Returns its id, or
 * null when nothing was made.
 */
export function quickCreate(sourceId: string, side: QuickSide): string | null {
  if (!canEditObjects()) return null;
  const objects = useStore.getState().objects;
  const source = objects[sourceId];
  const target = quickCreateTarget(sourceId, side);
  if (!source || !target) return null;

  const id = nanoid();
  editor.createNode({
    ...copyOf(source),
    id,
    type: source.type,
    x: target.x,
    y: target.y,
    width: source.width,
    height: source.height,
  } as never);

  const defaults = connectorDefaults.getSnapshot();
  const sb = nodeBounds(source);
  const minX = Math.min(sb.minX, target.x);
  const minY = Math.min(sb.minY, target.y);
  editor.createNode({
    id: nanoid(),
    type: 'connector',
    x: minX,
    y: minY,
    width: Math.max(1, Math.max(sb.maxX, target.x + target.width) - minX),
    height: Math.max(1, Math.max(sb.maxY, target.y + target.height) - minY),
    from: { nodeId: sourceId, port: 'auto' },
    to: { nodeId: id, port: 'auto' },
    routing: defaults.routing,
    endStart: defaults.endStart,
    endEnd: defaults.endEnd,
    ...(defaults.avoid && defaults.routing !== 'straight' ? { avoid: true } : null),
    appearance: {
      stroke: {
        color: useStore.getState().connectorColor || ThemeService.getDefaultStrokeColor(),
        width: 2,
        cap: 'round',
      },
    },
  } as never);

  editor.select(id);
  return id;
}

/** What decides whether Tab is quick-create's or the page's. */
export interface TabContext {
  /** `document.activeElement`. */
  active: Element | null;
  /** Whether that element is the stage's container, the canvas, or inside them. */
  activeInBoard: boolean;
  /** Whether the last press landed on the board (see `trackBoardFocus`). */
  boardFocused: boolean;
  /** `document.body`, which holds focus after a click on anything not focusable. */
  body: Element | null;
  canEdit: boolean;
  /** Typing in a field, or a modal dialog is open. */
  busy: boolean;
}

/**
 * Whether Tab drives quick-create rather than moving focus.
 *
 * Only for an editor, and only when the board has focus: the stage itself or
 * the canvas, or the body when the last press was on the board. Focus left
 * on the body after clicking a toolbar, a panel or any other chrome keeps
 * Tab for the page, so keyboard users are never trapped.
 */
export function quickCreateTabAllowed(ctx: TabContext): boolean {
  if (!ctx.canEdit || ctx.busy) return false;
  if (ctx.activeInBoard) return true;
  const onBody = ctx.active === null || ctx.active === ctx.body;
  return onBody && ctx.boardFocused;
}

/**
 * Track whether the board has focus: set by a press on the board, cleared by
 * a press anywhere else or by focus moving to an element off the board.
 * Listens in the capture phase so a handler that stops propagation cannot
 * hide a press. Returns the reading and a disposer.
 */
export function trackBoardFocus(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  onBoard: (node: EventTarget | null) => boolean,
  body: () => EventTarget | null
): { focused: () => boolean; dispose: () => void } {
  let focused = false;
  const press = (e: Event) => {
    focused = onBoard(e.target);
  };
  const focus = (e: Event) => {
    if (e.target !== body() && !onBoard(e.target)) focused = false;
  };
  target.addEventListener('pointerdown', press, true);
  target.addEventListener('focusin', focus, true);
  return {
    focused: () => focused,
    dispose: () => {
      target.removeEventListener('pointerdown', press, true);
      target.removeEventListener('focusin', focus, true);
    },
  };
}
