import { engineEvents } from './EventBus';
import { cameraSystem } from './CameraSystem';
import { spatialIndex } from './SpatialIndex';
import { sceneGraph } from './SceneGraph';
import type { AnyNode } from './model/schema';

/** World-space overscan around the viewport, so a short pan never shows a gap. */
const OVERSCAN = 300;

/** Frames with nothing to do before the loop parks itself. */
const IDLE_FRAMES_BEFORE_PARK = 2;

function intersects(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * The frame loop: viewport culling and the per-frame camera push.
 *
 * It runs only while something needs a frame — a camera move, a scene change,
 * or a caller holding it awake (`hold`) — and parks otherwise, so an idle board
 * costs nothing.
 *
 * Culling is authoritative from the spatial index. The index is updated
 * synchronously by the same `ObjectAdded`/`ObjectMoved` events this listens
 * to (it subscribes first, because this module imports it), so the next query
 * always sees a new node. Between the add and that query the node is added to
 * the visible set directly when it lands inside the viewport, which keeps a
 * freshly created object from missing a frame without pinning off-screen ones.
 */
export class CanvasEngine {
  public visibleSet: Set<string> = new Set();
  /** Whether a spatial query has run, so an empty set means "nothing in view". */
  public hasReported = false;
  /** Bumped each time a changed visible set is published. */
  public visibleVersion = 0;

  // Performance tracking for the Developer HUD.
  public metrics = {
    cameraTime: 0,
    spatialQueryTime: 0,
    renderTime: 0,
    physicsTime: 0,
    totalFrameTime: 0,
    /** Objects the culler currently has mounted. */
    visibleCount: 0,
    totalCount: 0,
    fps: 0,
    lastViewportBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };

  private frameId = 0;
  private running = false;
  private frameCount = 0;
  private fpsTimer = 0;
  private idleFrames = 0;
  private needsSpatialQuery = true;
  /** A visible-set change waiting to be published once, at the end of the frame. */
  private visibleDirty = false;
  private holders = new Set<symbol>();

  constructor() {
    engineEvents.on('CameraChanged', this.onSceneChanged);
    engineEvents.on('ObjectMoved', this.onSceneChanged);
    engineEvents.on('ObjectAdded', this.onObjectAdded);
    engineEvents.on('ObjectRemoved', this.onObjectRemoved);
  }

  private onSceneChanged = () => {
    this.needsSpatialQuery = true;
    this.wake();
  };

  private onObjectRemoved = (node: AnyNode) => {
    this.needsSpatialQuery = true;
    if (node?.id && this.visibleSet.delete(node.id)) this.visibleDirty = true;
    this.wake();
  };

  private onObjectAdded = (node: AnyNode) => {
    this.needsSpatialQuery = true;
    if (node?.id && this.cameraIsValid()) {
      const view = cameraSystem.getViewportBounds(OVERSCAN);
      if (intersects(sceneGraph.getNodeBounds(node), view) && !this.visibleSet.has(node.id)) {
        this.visibleSet.add(node.id);
        this.visibleDirty = true;
      }
    }
    this.wake();
  };

  private cameraIsValid(): boolean {
    return cameraSystem.width > 0 && cameraSystem.height > 0;
  }

  /**
   * Keep the loop running until the returned release is called — for callers
   * that redraw on `RenderTick` every frame (a force ring that follows the
   * pointer, a pulsing latched field).
   */
  hold(): () => void {
    const token = Symbol('engine-hold');
    this.holders.add(token);
    this.wake();
    return () => {
      this.holders.delete(token);
    };
  }

  /** Ask for at least one more frame. */
  wake() {
    this.idleFrames = 0;
    if (this.running && !this.frameId && typeof requestAnimationFrame === 'function') {
      this.frameId = requestAnimationFrame(this.loop);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.fpsTimer = performance.now();
    this.needsSpatialQuery = true;
    this.wake();
  }

  stop() {
    this.running = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
  }

  /**
   * Re-query the viewport and publish the result if it changed. Public so tests
   * (and anything that needs the set settled synchronously) can run one pass.
   */
  updateVisibleSet() {
    this.needsSpatialQuery = false;
    if (!this.hasReported) {
      this.hasReported = true;
      this.visibleDirty = true;
    }
    const tQueryStart = performance.now();

    let next: Set<string>;
    if (!this.cameraIsValid()) {
      // No viewport to cull against yet: mount everything.
      next = new Set(sceneGraph.nodes.keys());
    } else {
      const bounds = cameraSystem.getViewportBounds(OVERSCAN);
      this.metrics.lastViewportBounds = bounds;
      next = new Set(spatialIndex.query(bounds).map((n) => n.id));
    }

    let changed = next.size !== this.visibleSet.size;
    if (!changed) {
      for (const id of next) {
        if (!this.visibleSet.has(id)) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      this.visibleSet = next;
      this.visibleDirty = true;
    }

    this.metrics.totalCount = spatialIndex.size;
    this.metrics.visibleCount = this.visibleSet.size;
    this.metrics.spatialQueryTime = performance.now() - tQueryStart;
    this.flushVisible();
  }

  private flushVisible() {
    if (!this.visibleDirty) return;
    this.visibleDirty = false;
    this.visibleVersion++;
    this.metrics.visibleCount = this.visibleSet.size;
    engineEvents.emit('VisibleSetUpdated', Array.from(this.visibleSet));
  }

  private loop = () => {
    this.frameId = 0;
    if (!this.running) return;
    const frameStart = performance.now();

    const hadWork = this.needsSpatialQuery || this.visibleDirty || this.holders.size > 0;
    if (this.needsSpatialQuery) this.updateVisibleSet();
    else this.flushVisible();

    const tRenderStart = performance.now();
    engineEvents.emit('RenderTick', { camera: cameraSystem, visible: this.visibleSet });
    this.metrics.renderTime = performance.now() - tRenderStart;

    const frameEnd = performance.now();
    this.metrics.totalFrameTime = frameEnd - frameStart;
    this.frameCount++;
    if (frameEnd - this.fpsTimer >= 1000) {
      this.metrics.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTimer = frameEnd;
    }

    this.idleFrames = hadWork ? 0 : this.idleFrames + 1;
    if (this.idleFrames < IDLE_FRAMES_BEFORE_PARK) {
      this.frameId = requestAnimationFrame(this.loop);
    } else {
      // Parked: the FPS counter restarts from the next wake rather than
      // averaging idle time in.
      this.frameCount = 0;
      this.fpsTimer = performance.now();
    }
  };
}

export const canvasEngine = new CanvasEngine();
