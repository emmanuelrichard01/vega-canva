/**
 * The radar: the whole board at a glance, with everyone on it.
 *
 * A plain canvas-2d painter. It knows about the store, the camera and the
 * collaborator store; it knows nothing about React. The framing arithmetic —
 * the part that was actually broken — is pure and lives in `radarProjection`.
 *
 * What was wrong with the one this replaces, in the order you would notice:
 *
 * - **It re-fitted every frame.** Your own viewport is part of the bounds, so
 *   panning rescaled the whole map continuously and objects that had not moved
 *   appeared to swim. Now the frame is held until it is genuinely wrong and
 *   then eased (`shouldRefit`, `easeBox`).
 * - **It ignored device pixel ratio**, so on any HiDPI display — which is most
 *   of them — every edge on it was soft.
 * - **It drove presence interpolation for the entire app.** Collapsing the
 *   radar froze the smoothing the *cursors* depended on. The frame loop now
 *   belongs to `collaboratorStore`, and this is one of its subscribers.
 * - **You could not drag it, and clicking told you nothing.** A minimap you
 *   cannot scrub is a picture of a map.
 */

import { useStore } from '../../hooks/useStore';
import { connectorPoints } from '../model/connector';
import { cameraSystem } from '../CameraSystem';
import { smoothingFactor } from '../cursor/remoteCursor';
import { collaboratorStore } from './collaboratorStore';
import { phaseFor, type Collaborator } from './collaborators';
import { viewportCenter } from './PresenceTypes';
import {
  atLeast,
  boxOf,
  easeBox,
  fit,
  padBox,
  project,
  shouldRefit,
  unionBox,
  unproject,
  type Box,
  type RadarView,
} from './radarProjection';

// Duplicated (not imported) from StickyRenderer.tsx's THEMES on purpose — that
// file pulls in react-konva at module scope, which this plain canvas-2d engine
// has no other reason to depend on. Keep in sync if that palette changes.
const STICKY_THEME_COLORS: Record<string, string> = {
  yellow: '#FFE9A8',
  mint: '#BCEBD7',
  sky: '#C3E1FA',
  pink: '#FBD2E1',
  lavender: '#DDD5F8',
  peach: '#FDDBBF',
  white: '#FFFFFF',
  dark: '#2B303B',
};

/** Breathing room around the content, in world units. */
const CONTENT_PADDING = 400;
/** Never frame a world smaller than this; see `atLeast`. */
const MIN_WORLD_SPAN = 1800;
/** Click radius for a collaborator dot, in radar pixels. */
const HIT_RADIUS = 10;
const DOT_RADIUS = 4.5;

export interface RadarTheme {
  surface: string;
  object: string;
  viewportStroke: string;
  viewportFill: string;
  ring: string;
  label: string;
  labelInk: string;
}

const DEFAULT_THEME: RadarTheme = {
  surface: 'rgba(0,0,0,0.02)',
  object: '#9CA3AF',
  viewportStroke: '#111827',
  viewportFill: 'rgba(17,24,39,0.07)',
  ring: '#FFFFFF',
  label: 'rgba(20,23,30,0.94)',
  labelInk: '#FFFFFF',
};

interface Hit {
  clientId: number;
  x: number;
  y: number;
}

export class RadarEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  /** CSS pixels. The backing store is this times the device pixel ratio. */
  private width = 0;
  private height = 0;
  private dpr = 1;

  private view: RadarView;
  /** The frame we are easing toward. */
  private goal: Box;
  /** Recomputed when the document changes, not every frame. */
  private contentBox: Box | null = null;
  private lastObjects: unknown = null;

  private theme: RadarTheme = DEFAULT_THEME;
  private hits: Hit[] = [];
  private hovered: number | null = null;
  private dragging = false;

  private detachFrame: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /** Fly to a world point. Set by the component so navigation stays in one place. */
  public onNavigate: ((x: number, y: number, zoom?: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Radar: no 2D context');
    this.ctx = ctx;

    const initial: Box = {
      minX: -MIN_WORLD_SPAN / 2,
      minY: -MIN_WORLD_SPAN / 2,
      maxX: MIN_WORLD_SPAN / 2,
      maxY: MIN_WORLD_SPAN / 2,
    };
    this.goal = initial;
    this.view = fit(initial, 1, 1);

    this.measure();
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(canvas);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.refreshTheme();
    this.detachFrame = collaboratorStore.onFrame(this.tick);
  }

  // -- sizing --------------------------------------------------------------

  /**
   * Match the backing store to the element's real size in device pixels.
   *
   * The old engine set `width`/`height` attributes to the same numbers as its
   * CSS size, which means one canvas pixel per CSS pixel — a 25–100% loss of
   * resolution on every laptop screen sold in the last decade. Everything on
   * it, and particularly the 1px viewport rectangles, was soft.
   */
  private measure() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (width === this.width && height === this.height && dpr === this.dpr) return;

    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  /**
   * Resolve the design tokens once, rather than per draw.
   *
   * `getComputedStyle` is a layout read; doing it inside the paint loop is how
   * a 260px widget starts costing frames. The component calls this again when
   * the theme changes.
   */
  refreshTheme() {
    const styles = getComputedStyle(this.canvas);
    const read = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;

    this.theme = {
      surface: 'transparent',
      object: read('--text-tertiary', DEFAULT_THEME.object),
      viewportStroke: read('--text-primary', DEFAULT_THEME.viewportStroke),
      viewportFill: read('--surface-hover', DEFAULT_THEME.viewportFill),
      ring: read('--surface-elevated', DEFAULT_THEME.ring),
      label: read('--surface-inverse', DEFAULT_THEME.label),
      labelInk: read('--text-inverse', DEFAULT_THEME.labelInk),
    };
  }

  // -- framing -------------------------------------------------------------

  /**
   * The world box the radar should be showing.
   *
   * Content bounds are recomputed only when the objects record changes
   * identity — zustand replaces it on every document change, so this is an
   * `!==` rather than a walk of every node sixty times a second.
   */
  private desiredBox(collaborators: Collaborator[]): Box {
    const objects = useStore.getState().objects;
    if (objects !== this.lastObjects) {
      this.lastObjects = objects;
      let box: Box | null = null;
      for (const node of Object.values(objects)) {
        // A hidden object draws nowhere on the real canvas, so letting it pull
        // the radar's bounds out means reserving map space for empty world.
        if (node.hidden) continue;
        box = unionBox(box, boxOf(node));
      }
      this.contentBox = box;
    }

    let box = this.contentBox;

    // Everyone's viewport, so nobody can be off the map. Their *rectangles*,
    // not just their centres — a marker half off the edge is a marker you
    // cannot read.
    for (const person of collaborators) {
      if (!person.viewport) continue;
      const v = person.viewport;
      box = unionBox(box, {
        minX: v.x,
        minY: v.y,
        maxX: v.x + v.width / v.zoom,
        maxY: v.y + v.height / v.zoom,
      });
    }

    const bounds = cameraSystem.getViewportBounds(0);
    box = unionBox(box, {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
    });

    return atLeast(padBox(box ?? { minX: -1, minY: -1, maxX: 1, maxY: 1 }, CONTENT_PADDING), MIN_WORLD_SPAN);
  }

  // -- the loop ------------------------------------------------------------

  /** Paint one frame now. The frame loop calls this; so can a console. */
  draw(dtMs = 1000 / 60) {
    this.tick(dtMs);
  }

  private tick = (dtMs: number) => {
    if (this.width <= 0 || this.height <= 0) return;

    const collaborators = collaboratorStore.live();
    const desired = this.desiredBox(collaborators);
    if (shouldRefit(this.goal, desired)) this.goal = desired;

    // A slower half-life than the cursors use: a cursor is chasing a live
    // input and should feel immediate, whereas re-framing moves *everything*
    // on the map at once and needs to read as a deliberate camera move.
    this.view = fit(
      easeBox(this.view.box, this.goal, smoothingFactor(dtMs, 140)),
      this.width,
      this.height
    );

    this.paint(collaborators);
  };

  // -- painting ------------------------------------------------------------

  private paint(collaborators: Collaborator[]) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    this.paintObjects(ctx);
    this.paintRemoteViewports(ctx, collaborators);
    this.paintLocalViewport(ctx);
    this.paintPeople(ctx, collaborators);
  }

  private fillFor(node: any): string {
    if (node.type === 'sticky') return STICKY_THEME_COLORS[node.theme] || STICKY_THEME_COLORS.yellow;
    if (node.type === 'shape' || node.type === 'path') {
      const paint = node.appearance?.fill?.[0];
      if (paint?.color && paint.color !== 'transparent') return paint.color;
    }
    if (node.type === 'text') return node.typography?.color || this.theme.object;
    // A connector has no fill — its ink is its stroke.
    if (node.type === 'connector') return node.appearance?.stroke?.color || this.theme.object;
    return this.theme.object;
  }

  private paintObjects(ctx: CanvasRenderingContext2D) {
    // Read the canonical store, never the raw Y.Maps: reading the document
    // directly bypasses normalization, so this used to look for a sticky's
    // colour under the pre-v2 `appearance.theme` and show a stale colour after
    // every recolour.
    const objects = useStore.getState().objects;
    const scale = this.view.scale;

    ctx.globalAlpha = 0.55;
    for (const node of Object.values(objects)) {
      if (node.hidden) continue;

      /**
       * A connector is a line, and its box is the bounding box of its route.
       *
       * Painting every node as a filled rectangle turned each connector into a
       * solid block spanning the diagonal between the two objects it joined —
       * the box is *correct*, it is what culling and marquee selection read,
       * but it was never the shape.
       */
      if (node.type === 'connector') {
        const route = connectorPoints(node.from, node.to, node.routing, (id) => {
          const other = objects[id];
          if (!other) return null;
          return {
            x: other.x,
            y: other.y,
            width: other.width * Math.abs(other.scaleX || 1),
            height: other.height * Math.abs(other.scaleY || 1),
          };
        });
        if (route.length >= 4) {
          ctx.strokeStyle = this.fillFor(node);
          ctx.lineWidth = 1;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (let i = 0; i < route.length; i += 2) {
            const p = project(this.view, route[i], route[i + 1]);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
        continue;
      }

      const width = Math.max(2, node.width * Math.abs(node.scaleX || 1) * scale);
      const height = Math.max(2, node.height * Math.abs(node.scaleY || 1) * scale);
      const { x, y } = project(this.view, node.x, node.y);

      ctx.fillStyle = this.fillFor(node);
      if (node.type === 'shape' && node.geometry?.kind === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Rounded, matching the canvas, but only once there are enough pixels
        // for a radius to read as anything but a smudge.
        roundedRect(ctx, x, y, width, height, width > 6 && height > 6 ? 1.5 : 0);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private paintRemoteViewports(ctx: CanvasRenderingContext2D, collaborators: Collaborator[]) {
    for (const person of collaborators) {
      if (!person.viewport) continue;
      const v = person.viewport;
      const { x, y } = project(this.view, v.x, v.y);
      const w = (v.width / v.zoom) * this.view.scale;
      const h = (v.height / v.zoom) * this.view.scale;

      ctx.globalAlpha = person.away ? 0.25 : 0.5;
      ctx.strokeStyle = person.color;
      ctx.lineWidth = 1;
      roundedRect(ctx, x, y, Math.max(8, w), Math.max(8, h), 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private paintLocalViewport(ctx: CanvasRenderingContext2D) {
    const bounds = cameraSystem.getViewportBounds(0);
    const { x, y } = project(this.view, bounds.minX, bounds.minY);
    const w = (bounds.maxX - bounds.minX) * this.view.scale;
    const h = (bounds.maxY - bounds.minY) * this.view.scale;

    roundedRect(ctx, x, y, Math.max(10, w), Math.max(10, h), 3);
    ctx.fillStyle = this.theme.viewportFill;
    ctx.fill();
    ctx.strokeStyle = this.theme.viewportStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private paintPeople(ctx: CanvasRenderingContext2D, collaborators: Collaborator[]) {
    const now = performance.now();
    this.hits = [];

    for (const person of collaborators) {
      // Their pointer if we have it, otherwise the middle of what they are
      // looking at. Cursor is cleared the moment someone touches a panel, and
      // vanishing from the radar because you clicked a colour swatch is how
      // the old one lost people constantly.
      const world = person.cursor ?? (person.viewport ? viewportCenter(person.viewport) : null);
      if (!world) continue;

      const { x, y } = project(this.view, world.x, world.y);
      this.hits.push({ clientId: person.clientId, x, y });

      // Objects of theirs still in the air, drawn first so they sit under the
      // dot rather than over it.
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = person.color;
      for (const pose of person.throws) {
        const p = project(this.view, pose.x, pose.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (!person.away) {
        /**
         * A sonar ping on every live collaborator, not only busy ones.
         *
         * It used to fire only while someone had an `activity`, which is a
         * small fraction of the time — so most of the time the radar showed a
         * row of motionless dots, indistinguishable from a screenshot. The
         * point of the thing is to feel inhabited.
         *
         * Two intensities: a slow, faint ring when someone is simply present,
         * and a quicker, brighter one while they are doing something. That
         * keeps "there are four people here" and "someone is working over
         * there" as different signals rather than one on/off.
         */
        const busy = !!person.activity;
        const period = busy ? 1600 : 2800;
        const reach = busy ? 13 : 9;
        const peak = busy ? 0.5 : 0.26;

        // Each person's own phase, so a room does not pulse in unison — that
        // reads as one UI animation rather than as several people.
        const t = ((now + phaseFor(person.clientId) * period) % period) / period;

        // Cubic ease-out on the radius: the ring leaps outward and then
        // drifts, which is what makes it read as a ping rather than as a
        // balloon inflating at a constant rate.
        const eased = 1 - Math.pow(1 - t, 3);

        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS + eased * reach, 0, Math.PI * 2);
        ctx.strokeStyle = person.color;
        // Fades on the linear clock, not the eased one, so it is still faintly
        // visible while the ring is at its widest.
        ctx.globalAlpha = (1 - t) * peak;
        ctx.lineWidth = busy ? 1.5 : 1.1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const hovered = this.hovered === person.clientId;
      const radius = hovered ? DOT_RADIUS + 1.5 : DOT_RADIUS;

      // A ring in the panel's own colour, so the dot reads against a dark
      // object, a pale one, or the empty grid without changing colour itself.
      ctx.beginPath();
      ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = this.theme.ring;
      ctx.globalAlpha = person.away ? 0.5 : 1;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = person.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (this.hovered !== null) {
      const hit = this.hits.find((h) => h.clientId === this.hovered);
      const person = collaborators.find((c) => c.clientId === this.hovered);
      if (hit && person) this.paintLabel(ctx, hit.x, hit.y, person.name);
    }
  }

  private paintLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
    ctx.font = `600 11px ${getComputedStyle(this.canvas).fontFamily || 'sans-serif'}`;
    ctx.textBaseline = 'middle';
    const padding = 6;
    const width = ctx.measureText(text).width + padding * 2;
    const height = 18;

    // Flip to the other side rather than let the label run off the radar —
    // the same problem the cursor chips have, at a tenth of the size.
    let left = x + 10;
    if (left + width > this.width - 2) left = x - 10 - width;
    let top = y - height / 2;
    top = Math.max(2, Math.min(top, this.height - height - 2));

    roundedRect(ctx, left, top, width, height, 4);
    ctx.fillStyle = this.theme.label;
    ctx.fill();

    ctx.fillStyle = this.theme.labelInk;
    ctx.fillText(text, left + padding, top + height / 2 + 0.5);
  }

  // -- interaction ---------------------------------------------------------

  private localPoint(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private hitTest(x: number, y: number): number | null {
    let best: number | null = null;
    let bestDistance = HIT_RADIUS;
    for (const hit of this.hits) {
      const d = Math.hypot(hit.x - x, hit.y - y);
      if (d <= bestDistance) {
        bestDistance = d;
        best = hit.clientId;
      }
    }
    return best;
  }

  /** Put the world point under the radar cursor in the middle of the screen. */
  private centreOn(worldX: number, worldY: number) {
    const centre = cameraSystem.screenToWorld(cameraSystem.width / 2, cameraSystem.height / 2);
    cameraSystem.panBy(
      (centre.x - worldX) * cameraSystem.zoom,
      (centre.y - worldY) * cameraSystem.zoom
    );
  }

  private onPointerDown = (e: PointerEvent) => {
    const { x, y } = this.localPoint(e);

    const clientId = this.hitTest(x, y);
    if (clientId !== null) {
      // Landing on someone is a different intent from scrubbing the map, so it
      // gets the animated fly-to rather than a jump — the movement is what
      // tells you how far away they were.
      const person = collaboratorStore.find(clientId);
      if (person?.viewport) {
        const centre = viewportCenter(person.viewport);
        this.onNavigate?.(centre.x, centre.y, person.viewport.zoom || 1);
        return;
      }
    }

    // Dragging is direct, not animated: an eased camera cannot keep up with a
    // pointer and the map ends up feeling like it is on elastic.
    this.dragging = true;
    this.canvas.setPointerCapture(e.pointerId);
    const world = unproject(this.view, x, y);
    this.centreOn(world.x, world.y);
  };

  private onPointerMove = (e: PointerEvent) => {
    const { x, y } = this.localPoint(e);

    if (this.dragging) {
      const world = unproject(this.view, x, y);
      this.centreOn(world.x, world.y);
      return;
    }

    const hovered = this.hitTest(x, y);
    if (hovered !== this.hovered) {
      this.hovered = hovered;
      this.canvas.style.cursor = hovered !== null ? 'pointer' : 'grab';
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  };

  private onPointerLeave = () => {
    if (this.hovered !== null) {
      this.hovered = null;
      this.canvas.style.cursor = 'grab';
    }
  };

  /** Frame the whole document. */
  fitToContent() {
    const box = this.contentBox;
    if (!box) return;
    const centreX = (box.minX + box.maxX) / 2;
    const centreY = (box.minY + box.maxY) / 2;
    const zoom = Math.min(
      cameraSystem.width / Math.max(box.maxX - box.minX, 1),
      cameraSystem.height / Math.max(box.maxY - box.minY, 1)
    );
    this.onNavigate?.(centreX, centreY, Math.max(0.05, Math.min(zoom * 0.9, 1.5)));
  }

  destroy() {
    this.detachFrame?.();
    this.detachFrame = null;
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  if (r === 0) {
    ctx.rect(x, y, width, height);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
