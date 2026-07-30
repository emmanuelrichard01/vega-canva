import { engineEvents } from './EventBus';

export class CameraSystem {
  x: number = 0;
  y: number = 0;
  zoom: number = 1;
  
  width: number = 800;
  height: number = 600;

  private minZoom = 0.05;
  private maxZoom = 5;

  resize(w: number, h: number) {
    const safeW = w > 0 ? w : (typeof window !== 'undefined' ? window.innerWidth : 1920);
    const safeH = h > 0 ? h : (typeof window !== 'undefined' ? window.innerHeight : 1080);
    if (this.width !== safeW || this.height !== safeH) {
      this.width = safeW;
      this.height = safeH;
      this.emitChange();
    }
  }

  pan(dx: number, dy: number) {
    this.x -= dx;
    this.y -= dy;
    this.emitChange();
  }

  /** Pan by adding the delta (for drag-based panning where direction matches movement) */
  panBy(dx: number, dy: number) {
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
    const oldZoom = this.zoom;

    // World position currently under the anchor point.
    const pointerWorldX = (screenX - this.x) / oldZoom;
    const pointerWorldY = (screenY - this.y) / oldZoom;

    const newZoom = Math.max(this.minZoom, Math.min(oldZoom * factor, this.maxZoom));
    this.zoom = newZoom;

    // Re-anchor so that world point stays exactly under the same screen point.
    this.x = screenX - pointerWorldX * this.zoom;
    this.y = screenY - pointerWorldY * this.zoom;

    this.emitChange();
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
