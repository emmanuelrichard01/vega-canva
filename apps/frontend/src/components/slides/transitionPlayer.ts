import Konva from 'konva';
import type { AnyNode, FrameNode } from '../../engine/model/schema';
import { descendantsOfFrame } from '../../engine/model/frames';
import { nodeBounds } from '../../engine/model/selection';
import { useStore } from '../../hooks/useStore';
import { isPlaceholder } from '../../engine/slides/placeholderText';
import { matchSlides, sameProportion, type MoveNode, type MovePlan } from '../../engine/slides/smartMove';
import type { TransitionSpec } from '../../engine/slides/slideMeta';
import {
  CSS_EASINGS,
  handle,
  konvaEasing,
  lerpPose,
  paneFrame,
  travellerStart,
  zoomPhase,
  DIVE_SHARE,
  type Pose,
  type TransitionHandle,
} from '../../engine/slides/transitionMath';

/**
 * Playing a transition on the live board.
 *
 * The presentation is the board itself, seen through a letterbox, so each
 * transition is played where the slides are rather than on a copy:
 *
 * - **Dissolve** pictures what is on screen and fades the picture away over
 *   the new slide.
 * - **Push** and **Slide** picture both slides and move the pictures with the
 *   Web Animations API, which the compositor runs at the display's own rate.
 * - **Smart move** happens on the stage: the new slide's travellers are put
 *   back where they stood on the old one, at its size, turn, opacity and
 *   colour, and Konva tweens carry them home, while a picture of the old
 *   slide's other contents fades between the new page and its objects.
 * - **Zoom** drives the camera: it dives into the matching object on the old
 *   slide and comes out on the new one, or the reverse on the way back.
 *
 * Nothing is React state per frame. Every transition returns a handle whose
 * `finish` jumps to the last frame and tidies up, which is how a fast key
 * press lands cleanly on the next slide. Loaded on demand.
 */

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TransitionRequest {
  spec: TransitionSpec;
  fromId: string;
  toId: string;
  /** Where the outgoing slide is on screen now. */
  from: ScreenRect;
  /** Where the incoming slide will be once the camera is on it. */
  to: ScreenRect;
  /** The whole stage on screen, for a zoom's close-up. */
  screen: ScreenRect;
  host: HTMLElement;
  /** Put the camera on the incoming slide, at once. */
  cut: () => void;
  /** For a zoom: the camera now, at the incoming slide, and a way to set it. */
  poses?: { from: Pose; to: Pose; stage: { width: number; height: number }; fit: (box: { x: number; y: number; width: number; height: number }) => Pose; set: (p: Pose) => void };
  /** Leaving a slide that was zoomed into: zoom back out. */
  back?: boolean;
}

type StageLike = Konva.Stage;

const stage = (): StageLike | null => ((window as unknown as { _konva_stage?: StageLike })._konva_stage ?? null);
const objects = () => useStore.getState().objects as Record<string, AnyNode>;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** The board's content under `rect`, as a picture: the stage's first layer only, never its chrome. */
function pictureOfScreen(rect: ScreenRect): HTMLCanvasElement | null {
  const content = document.querySelector('.konvajs-content');
  if (!content) return null;
  const dpr = window.devicePixelRatio || 1;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(rect.width * dpr));
  out.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  const box = content.getBoundingClientRect();
  const layer = content.querySelector<HTMLCanvasElement>('canvas');
  if (!layer) return null;
  const scale = layer.width / Math.max(1, layer.clientWidth || box.width);
  ctx.drawImage(layer, (rect.left - box.left) * scale, (rect.top - box.top) * scale, rect.width * scale, rect.height * scale, 0, 0, out.width, out.height);
  return out;
}

/** A positioned element over the board for a transition's pictures. */
function overlay<T extends HTMLElement>(host: HTMLElement, rect: ScreenRect, el: T): T {
  el.classList.add('fp-transition');
  Object.assign(el.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  host.append(el);
  return el;
}

function slideMembers(frameId: string): string[] {
  const all = objects();
  return [frameId, ...descendantsOfFrame(frameId, Object.values(all))];
}

/**
 * Wait until the board has mounted the nodes with these ids (the camera has
 * just moved to them, so they arrive with the next render), then one more
 * frame so they are drawn. Gives up after a few frames: a transition that
 * waited longer would read as the app hesitating.
 */
async function nodesDrawn(ids: string[], frames = 10): Promise<void> {
  const s = stage();
  for (let i = 0; i < frames; i++) {
    await nextFrame();
    if (!s || ids.every((id) => s.findOne(`#${id}`))) break;
  }
  await nextFrame();
}

// ---------------------------------------------------------------------------
// Dissolve
// ---------------------------------------------------------------------------

function dissolve(req: TransitionRequest, rect = req.from, picture = pictureOfScreen(req.from)): TransitionHandle {
  let anim: Animation | null = null;
  let el: HTMLCanvasElement | null = null;
  const h = handle(() => {
    anim?.cancel();
    el?.remove();
  });
  req.cut();
  if (!picture || req.spec.ms <= 0) {
    h.complete();
    return h;
  }
  el = overlay(req.host, rect, picture);
  anim = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: req.spec.ms, easing: CSS_EASINGS[req.spec.ease], fill: 'forwards' });
  anim.finished.then(h.complete, h.complete);
  return h;
}

// ---------------------------------------------------------------------------
// Push and slide
// ---------------------------------------------------------------------------

function pane(req: TransitionRequest, kind: 'push' | 'slide'): TransitionHandle {
  const anims: Animation[] = [];
  let box: HTMLDivElement | null = null;
  const h = handle(() => {
    anims.forEach((x) => x.cancel());
    box?.remove();
    req.cut();
  });

  const fromPic = pictureOfScreen(req.from);
  if (!fromPic) return dissolve(req);

  // Hold the old slide on screen while the camera cuts underneath.
  box = overlay(req.host, req.to, document.createElement('div'));
  box.classList.add('fp-transition--panes');
  const a = fromPic;
  box.append(a);
  req.cut();

  void (async () => {
    await nodesDrawn([req.toId]);
    if (h.settled() || !box) return;
    const toPic = pictureOfScreen(req.to);
    if (!toPic || !box.isConnected) return h.complete();
    box.append(toPic);
    const pose = (p: { x: number; y: number; opacity: number; scale: number }) => ({
      transform: `translate(${p.x * 100}%, ${p.y * 100}%) scale(${p.scale})`,
      opacity: p.opacity,
    });
    const start = paneFrame(kind, req.spec.direction, 0);
    const end = paneFrame(kind, req.spec.direction, 1);
    const timing: KeyframeAnimationOptions = { duration: req.spec.ms, easing: CSS_EASINGS[req.spec.ease], fill: 'forwards' };
    anims.push(a.animate([pose(start.from), pose(end.from)], timing), toPic.animate([pose(start.to), pose(end.to)], timing));
    await Promise.all(anims.map((x) => x.finished)).catch(() => undefined);
    h.complete();
  })();
  return h;
}

// ---------------------------------------------------------------------------
// Smart move, on the stage
// ---------------------------------------------------------------------------

function membersForMatch(frameId: string, all: Record<string, AnyNode>): MoveNode[] {
  const ids = new Set(descendantsOfFrame(frameId, Object.values(all)));
  return Object.values(all).filter((n) => ids.has(n.id) && !n.hidden && n.type !== 'frame' && !isPlaceholder(n as never)) as unknown as MoveNode[];
}

/** The plan for a smart move between two slides, or null when it should dissolve instead. */
export function planSmartMove(fromId: string, toId: string, all: Record<string, AnyNode>): MovePlan | null {
  const a = all[fromId] as FrameNode | undefined;
  const b = all[toId] as FrameNode | undefined;
  if (!a || !b || !sameProportion(a, b)) return null;
  const plan = matchSlides(a, membersForMatch(fromId, all), b, membersForMatch(toId, all));
  return plan.pairs.length > 0 ? plan : null;
}

/** The first drawn shape inside a node's group that carries a solid fill. */
function paintOf(group: Konva.Node): Konva.Shape | null {
  if (group instanceof Konva.Shape) return typeof group.fill() === 'string' ? group : null;
  if (!(group instanceof Konva.Container)) return null;
  return (group.findOne((n: Konva.Node) => n instanceof Konva.Shape && typeof (n as Konva.Shape).fill() === 'string' && !!(n as Konva.Shape).fill()) as Konva.Shape | undefined) ?? null;
}

const solid = (n: MoveNode) => n.appearance?.fill?.find((p) => p.type === 'solid')?.color;

function smart(req: TransitionRequest): TransitionHandle {
  const all = objects();
  const plan = planSmartMove(req.fromId, req.toId, all);
  const s = stage();
  if (!plan || !s) return dissolve(req);

  const tweens: Konva.Tween[] = [];
  let ghost: Konva.Image | null = null;
  let cover: HTMLCanvasElement | null = null;
  const h = handle(() => {
    // Finishing a tween puts the node exactly where it rests.
    tweens.forEach((t) => {
      t.finish();
      t.destroy();
    });
    ghost?.destroy();
    cover?.remove();
    s.batchDraw();
    req.cut();
  });
  const find = (id: string) => s.findOne(`#${id}`) as Konva.Node | undefined;

  // The old slide as it is, to cover the cut, and without its travellers,
  // which will be drawn live on the move.
  const whole = pictureOfScreen(req.from);
  const hidden = plan.pairs.map((p) => find(p.a.id)).filter((n): n is Konva.Node => !!n && n.visible());
  hidden.forEach((n) => n.visible(false));
  s.draw();
  const rest = pictureOfScreen(req.from);
  hidden.forEach((n) => n.visible(true));
  if (whole) cover = overlay(req.host, req.from, whole);
  req.cut();

  void (async () => {
    // The new slide's objects mount as the camera reaches them.
    await nodesDrawn([req.toId, ...plan.pairs.map((p) => p.b.id)]);
    if (h.settled()) return;

    const fb = all[req.toId];
    const frameNode = find(req.toId);
    if (!rest || !frameNode) return h.complete();
    const seconds = req.spec.ms / 1000;
    const easing = konvaEasing(req.spec.ease);

    // The old slide's other contents, between the new page and its objects, fading.
    const parent = frameNode.getParent();
    if (parent instanceof Konva.Container) {
      const box = nodeBounds(fb);
      ghost = new Konva.Image({ image: rest, x: box.x, y: box.y, width: box.width, height: box.height, listening: false });
      parent.add(ghost);
      ghost.zIndex(Math.min(parent.getChildren().length - 1, frameNode.zIndex() + 1));
      tweens.push(new Konva.Tween({ node: ghost, duration: seconds * 0.7, easing, opacity: 0 }));
    }

    const moving = new Set(plan.pairs.map((p) => p.b.id));
    for (const n of plan.entering) {
      const node = find(n.id);
      if (!node || moving.has(n.id)) continue;
      const opacity = node.opacity();
      node.opacity(0);
      tweens.push(new Konva.Tween({ node, duration: seconds, easing, opacity }));
    }

    // Wires are drawn from where their ends rest, not where they are on the
    // way, so the new slide's wires arrive once the objects have.
    const late = (t: number, b: number, c: number, d: number) => b + c * Math.max(0, (t / d - 0.6) / 0.4);
    const toMembers = new Set(slideMembers(req.toId));
    for (const n of Object.values(all)) {
      if (n.type !== 'connector') continue;
      const ends = n as AnyNode & { from?: { nodeId?: string }; to?: { nodeId?: string } };
      if (!toMembers.has(ends.from?.nodeId ?? '') && !toMembers.has(ends.to?.nodeId ?? '')) continue;
      const node = find(n.id);
      if (!node) continue;
      const opacity = node.opacity();
      node.opacity(0);
      tweens.push(new Konva.Tween({ node, duration: seconds, easing: late, opacity }));
    }

    const fbox = nodeBounds(fb);
    for (const pair of plan.pairs) {
      const node = find(pair.b.id);
      if (!node) continue;
      const restBox = { x: pair.b.x, y: pair.b.y, width: pair.b.width, height: pair.b.height };
      const from = pair.from;
      const startBox = { x: fbox.x + from.x * fbox.width, y: fbox.y + from.y * fbox.height, width: from.width * fbox.width, height: from.height * fbox.height };
      const now = { x: node.x(), y: node.y(), scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation() };
      const begin = travellerStart(now, restBox, startBox, now.rotation + ((pair.a.rotation ?? 0) - (pair.b.rotation ?? 0)));
      const opacity = node.opacity();
      node.setAttrs({ ...begin, opacity: pair.a.opacity ?? opacity });
      tweens.push(new Konva.Tween({ node, duration: seconds, easing, ...now, opacity }));
      // A colour that changed between the slides changes on the way.
      const fa = solid(pair.a);
      const fbFill = solid(pair.b);
      const paint = fa && fbFill && fa.toUpperCase() !== fbFill.toUpperCase() ? paintOf(node) : null;
      if (paint) {
        const to = paint.fill() as string;
        paint.fill(fa!);
        tweens.push(new Konva.Tween({ node: paint, duration: seconds, easing, fill: to }));
      }
    }
    tweens.forEach((t) => t.play());
    // The travellers are in their starting places on the stage now; the cover can go.
    s.draw();
    cover?.remove();
    cover = null;
    window.setTimeout(h.complete, req.spec.ms + 34);
  })();
  return h;
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/** What on `slideId` a zoom dives into: the object named like the other slide, a frame inside it, or its middle. */
function portalOn(slideId: string, otherName: string | undefined): { x: number; y: number; width: number; height: number } {
  const all = objects();
  const frame = all[slideId];
  const ids = new Set(descendantsOfFrame(slideId, Object.values(all)));
  const members = Object.values(all).filter((n) => ids.has(n.id) && !n.hidden);
  const name = otherName?.trim().toLowerCase();
  const named = name ? members.find((n) => n.title?.trim().toLowerCase() === name) : undefined;
  const nested = members.find((n) => n.type === 'frame');
  const target = named ?? nested;
  if (target) return nodeBounds(target);
  const box = nodeBounds(frame);
  return { x: box.x + box.width * 0.35, y: box.y + box.height * 0.35, width: box.width * 0.3, height: box.height * 0.3 };
}

function zoom(req: TransitionRequest): TransitionHandle {
  const p = req.poses;
  if (!p) return dissolve(req);
  const all = objects();
  let raf = 0;
  let el: HTMLCanvasElement | null = null;
  let anim: Animation | null = null;
  const h = handle(() => {
    cancelAnimationFrame(raf);
    anim?.cancel();
    el?.remove();
    p.set(p.to);
  });

  const forward = !req.back;
  // Forward: the portal is on the slide being left, named like the slide arriving.
  // Back: it is on the slide arriving, named like the slide being left.
  const portalSlide = forward ? req.fromId : req.toId;
  const otherName = (all[forward ? req.toId : req.fromId] as FrameNode | undefined)?.title;
  const portal = p.fit(portalOn(portalSlide, otherName));
  const start = performance.now();
  const ms = req.spec.ms;

  if (forward) {
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const { dive } = zoomPhase(t, req.spec.ease);
      if (t < DIVE_SHARE) {
        p.set(lerpPose(p.from, portal, p.stage, dive));
        raf = requestAnimationFrame(step);
        return;
      }
      // At the bottom of the dive: the close-up dissolves into the new slide.
      p.set(portal);
      el = overlay(req.host, req.screen, pictureOfScreen(req.screen) ?? document.createElement('canvas'));
      p.set(p.to);
      anim = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * (1 - DIVE_SHARE), easing: CSS_EASINGS.standard, fill: 'forwards' });
      anim.finished.then(h.complete, h.complete);
    };
    raf = requestAnimationFrame(step);
    return h;
  }

  // Back out: the slide being left fades over the close-up, then the camera rises.
  const leaving = pictureOfScreen(req.from);
  p.set(portal);
  if (leaving) {
    el = overlay(req.host, req.from, leaving);
    anim = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * (1 - DIVE_SHARE), easing: CSS_EASINGS.standard, fill: 'forwards' });
  }
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const { dive } = zoomPhase(1 - t, req.spec.ease);
    p.set(lerpPose(p.to, portal, p.stage, dive));
    if (t < 1) raf = requestAnimationFrame(step);
    else h.complete();
  };
  raf = requestAnimationFrame(step);
  return h;
}

/** Play `req.spec` from one slide to the next. Returns at once; the handle says when it is over. */
export function playTransition(req: TransitionRequest): TransitionHandle {
  switch (req.spec.kind) {
    case 'smart':
      return smart(req);
    case 'push':
    case 'slide':
      return pane(req, req.spec.kind);
    case 'zoom':
      return zoom(req);
    default:
      return dissolve(req);
  }
}
