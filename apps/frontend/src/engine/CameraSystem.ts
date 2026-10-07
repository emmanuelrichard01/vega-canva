import { engineEvents } from './EventBus';
import { clampZoom, prefersReducedMotion, rubberZoom } from './cameraMotion';
import { fitPose, type FitBounds, type FitOptions } from './cameraFit';

export class CameraSystem {
  x: number = 0;
  y: number = 0;
  zoom: number = 1;
  
  width: number = 800;
  height: number = 600;

  /**
   * Whether the canvas has ever reported its real size.
   *
   * `width`/`height` start at 800x600, which is a plausible viewport rather
   * than an obviously-absent one — so anything that frames content has no way
   * to tell "not measured yet" from "a small window", and framing against the
   * placeholder puts the board somewhere nobody chose. The opening fit waits
   * on this.
   */
  measured: boolean = false;

  private minZoom = 0.05;
  private maxZoom = 5;

  /**
   * The zoom range, for callers that compute a pose before assigning one.
   *
   * Follow mode fits someone else's viewport into this window, and has to
   * clamp the result itself — a target it cannot reach would otherwise leave
   * the easing chasing a zoom the camera silently refuses, never arriving and
   * never settling.
   */
  get zoomLimits(): { minZoom: number; maxZoom: number } {
    return { minZoom: this.minZoom, maxZoom: this.maxZoom };
  }

  private animFrameId: number | null = null;

  /**
   * Immediately abort any active camera animation.
   * Called on any manual user camera interaction (pan, zoom, wheel, setPose)
   * so the user never fights an ongoing programmatic transition.
   */
  cancelAnimation() {
    if (this.animFrameId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this.animFrameId);
      } else if (typeof window !== 'undefined' && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(this.animFrameId);
      } else {
        clearTimeout(this.animFrameId);
      }
      this.animFrameId = null;
    }
  }

  isAnimating(): boolean {
    return this.animFrameId !== null;
  }

  /**
   * Smoothly ease the camera to the target pose using a quartic ease-out deceleration curve.
   * Cancels automatically if any manual camera movement occurs.
   */
  animateTo(
    targetX: number,
    targetY: number,
    targetZoom: number,
    options?: {
      duration?: number;
      easing?: (t: number) => number;
      onComplete?: () => void;
    }
  ): () => void {
    this.cancelAnimation();

    if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || !Number.isFinite(targetZoom)) {
      return () => {};
    }

    const clampedZoom = Math.max(this.minZoom, Math.min(targetZoom, this.maxZoom));
    const duration = options?.duration ?? 450;
    const easeFn = options?.easing ?? ((t: number) => 1 - Math.pow(1 - t, 4));
    const onComplete = options?.onComplete;

    if (duration <= 0) {
      this.setPose(targetX, targetY, clampedZoom);
      onComplete?.();
      return () => {};
    }

    const startX = this.x;
    const startY = this.y;
    const startZoom = this.zoom;
    const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    const scheduleFrame = (cb: (time: number) => void): number => {
      if (typeof requestAnimationFrame !== 'undefined') return requestAnimationFrame(cb);
      if (typeof window !== 'undefined' && window.requestAnimationFrame) return window.requestAnimationFrame(cb);
      return setTimeout(() => cb((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()), 16) as unknown as number;
    };

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, Math.max(0, elapsed / duration));
      const ease = easeFn(progress);

      this.x = startX + (targetX - startX) * ease;
      this.y = startY + (targetY - startY) * ease;
      this.zoom = startZoom + (clampedZoom - startZoom) * ease;
      this.emitChange();

      if (progress < 1) {
        this.animFrameId = scheduleFrame(tick);
      } else {
        this.animFrameId = null;
        onComplete?.();
      }
    };

    this.animFrameId = scheduleFrame(tick);
    return () => this.cancelAnimation();
  }

  /**
   * Assign a pose directly, clamped, emitting one change.
   *
   * Follow mode writes the camera every frame while it is active. Doing that
   * through `pan` and `zoomBy` would emit two `CameraChanged` events per frame
   * and route a fitted zoom through an anchor-preserving path that exists to
   * keep a point under the pointer — which is not what "show me what they see"
   * means.
   */
  setPose(x: number, y: number, zoom: number) {
    this.cancelAnimation();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return;
    this.x = x;
    this.y = y;
    this.zoom = Math.max(this.minZoom, Math.min(zoom, this.maxZoom));
    this.emitChange();
  }

  resize(w: number, h: number) {
    const safeW = w > 0 ? w : (typeof window !== 'undefined' ? window.innerWidth : 1920);
    const safeH = h > 0 ? h : (typeof window !== 'undefined' ? window.innerHeight : 1080);
    if (this.width !== safeW || this.height !== safeH) {
      this.width = safeW;
      this.height = safeH;
      this.measured = true;
      this.emitChange();
    }
    // Set even when the size is unchanged: a window that happens to be exactly
    // 800x600 would otherwise never be reported as measured at all.
    this.measured = true;
  }

  pan(dx: number, dy: number) {
    this.cancelAnimation();
    this.x -= dx;
    this.y -= dy;
    this.emitChange();
  }

  /** Pan by adding the delta (for drag-based panning where direction matches movement) */
  panBy(dx: number, dy: number) {
    this.cancelAnimation();
    this.x += dx;
    this.y += dy;
    this.emitChange();
  }

  /**
   * Step the zoom by one notch. **Positive zooms in.**
   *
   * The sign used to mean the opposite of what every caller assumed: positive
   * divided by the zoom factor, i.e. zoomed *out*. The wheel handler computed
   * `+1` for "the user wants to zoom in" and got the reverse, so pinching
   * outward on a trackpad shrank the canvas.
   */
  zoomAt(direction: number, screenX: number, screenY: number) {
    const ZOOM_STEP = 1.1;
    this.zoomBy(direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, screenX, screenY);
  }

  /**
   * Zoom from a raw wheel/pinch delta, continuously.
   *
   * A trackpad pinch is not a notch — it streams many small deltas — so
   * quantising it to fixed 1.1x steps makes a smooth gesture arrive as a
   * staircase. Mapping the delta through an exponential keeps the gesture
   * proportional and, because zoom is multiplicative, makes it symmetric:
   * pinching out and back returns to exactly the zoom you started from.
   *
   * Negative `deltaY` means zoom in, which is what both trackpad pinch-out and
   * ctrl+scroll-up produce on every platform.
   */
  zoomByWheel(deltaY: number, screenX: number, screenY: number) {
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    const SENSITIVITY = 0.0125;
    // Clamped so one violent wheel notch (some mice report deltas in the
    // hundreds) cannot leap several zoom levels in a single event.
    const factor = Math.min(2, Math.max(0.5, Math.exp(-deltaY * SENSITIVITY)));
    this.zoomBy(factor, screenX, screenY);
  }

  /**
   * Multiply the zoom by an arbitrary factor, keeping the world point under
   * (screenX, screenY) pinned.
   *
   * Discrete wheel notches can use `zoomAt`, but a pinch gesture produces a
   * continuous ratio between finger distances and needs to apply it directly —
   * quantising a pinch to 1.1x steps feels broken on a trackpad or tablet.
   */
  zoomBy(factor: number, screenX: number, screenY: number) {
    this.cancelAnimation();
    const oldZoom = this.zoom;

    // World position currently under the anchor point.
    const pointerWorldX = (screenX - this.x) / oldZoom;
    const pointerWorldY = (screenY - this.y) / oldZoom;

    const newZoom = rubberZoom(oldZoom, oldZoom * factor, this.minZoom, this.maxZoom);
    this.zoom = newZoom;

    // Re-anchor so that world point stays exactly under the same screen point.
    this.x = screenX - pointerWorldX * this.zoom;
    this.y = screenY - pointerWorldY * this.zoom;

    this.emitChange();
    this.scheduleSettle(screenX, screenY);
  }

  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Ease back inside the zoom range once a gesture that stretched past it stops.
   *
   * `zoomBy` lets a pinch or wheel run a little past the limits with
   * resistance (`rubberZoom`); this returns it, keeping the point under the
   * gesture pinned. Immediate under reduced motion.
   */
  private scheduleSettle(screenX: number, screenY: number) {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    if (this.zoom >= this.minZoom && this.zoom <= this.maxZoom) {
      this.settleTimer = null;
      return;
    }
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      const target = clampZoom(this.zoom, this.minZoom, this.maxZoom);
      if (target === this.zoom) return;
      const worldX = (screenX - this.x) / this.zoom;
      const worldY = (screenY - this.y) / this.zoom;
      const x = screenX - worldX * target;
      const y = screenY - worldY * target;
      if (prefersReducedMotion()) this.setPose(x, y, target);
      else this.animateTo(x, y, target, { duration: 220 });
    }, 160);
  }

  /** The camera pose that frames `bounds`, or `null` for an empty box. */
  poseFor(bounds: FitBounds, options: FitOptions = {}) {
    return fitPose(bounds, this.width, this.height, { ...this.zoomLimits, ...options });
  }

  /**
   * Fly to a world box: the shared implementation behind Fit all, Zoom to
   * selection and jump-to-frame. Instant under reduced motion.
   */
  flyToBounds(
    bounds: FitBounds,
    options: FitOptions & { duration?: number; onComplete?: () => void } = {}
  ): boolean {
    const { duration, onComplete, ...fit } = options;
    const pose = this.poseFor(bounds, fit);
    if (!pose) return false;
    const ms = prefersReducedMotion() ? 0 : duration ?? 420;
    this.animateTo(pose.x, pose.y, pose.zoom, { duration: ms, onComplete });
    return true;
  }

  /**
   * Zoom to an exact level about a screen point (the viewport centre by
   * default): 50%, 100%, 200% in the zoom menu. Animated unless reduced motion.
   */
  zoomToLevel(level: number, screenX = this.width / 2, screenY = this.height / 2, duration = 260) {
    if (!Number.isFinite(level) || level <= 0) return;
    const target = clampZoom(level, this.minZoom, this.maxZoom);
    const worldX = (screenX - this.x) / this.zoom;
    const worldY = (screenY - this.y) / this.zoom;
    const x = screenX - worldX * target;
    const y = screenY - worldY * target;
    this.animateTo(x, y, target, { duration: prefersReducedMotion() ? 0 : duration });
  }

  /**
   * Translates a screen coordinate (e.g. mouse click) into the infinite world space.
   */
  screenToWorld(screenX: number, screenY: number) {
    return {
      x: (screenX - this.x) / this.zoom,
      y: (screenY - this.y) / this.zoom
    };
  }

  /**
   * Gets the exact world bounds currently visible on screen.
   * @param margin An optional overscan margin (Virtualization Buffer) to prevent pop-in
   */
  getViewportBounds(margin: number = 300) {
    const minX = -this.x / this.zoom - margin;
    const minY = -this.y / this.zoom - margin;
    const maxX = (this.width - this.x) / this.zoom + margin;
    const maxY = (this.height - this.y) / this.zoom + margin;
    
    return { minX, minY, maxX, maxY };
  }

  private emitChange() {
    engineEvents.emit('CameraChanged', this);
  }
}

// Global Singleton
export const cameraSystem = new CameraSystem();
