import { engineEvents } from './EventBus';
import { cameraSystem } from './CameraSystem';
import { spatialIndex } from './SpatialIndex';

export class CanvasEngine {
  public visibleSet: Set<string> = new Set();
  
  // Performance tracking for the Developer HUD
  public metrics = {
    cameraTime: 0,
    spatialQueryTime: 0,
    renderTime: 0,
    physicsTime: 0,
    totalFrameTime: 0,
    visibleCount: 0,
    totalCount: 0,
    fps: 0,
    lastViewportBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } as any,
  };

  private frameId: number = 0;
  private lastTime: number = 0;
  private frameCount: number = 0;
  private fpsTimer: number = 0;

  constructor() {
    // Only flag for a spatial query when structurally necessary
    engineEvents.on('CameraChanged', this.requestSpatialQuery);
    engineEvents.on('ObjectMoved', this.requestSpatialQuery);
    engineEvents.on('ObjectAdded', this.onObjectAdded);
    engineEvents.on('ObjectRemoved', this.onObjectRemoved);
  }

  private needsSpatialQuery = true;
  private requestSpatialQuery = () => {
    this.needsSpatialQuery = true;
  };

  /**
   * Objects added but not yet seen coming back from the spatial query.
   *
   * The optimistic add below was already here, to avoid the one-frame flicker
   * where an object exists but is not drawn. It did not survive: the very next
   * spatial query builds a **fresh** set from the index and assigns it over the
   * top, so unless the index happened to have the node within that one frame,
   * the object was dropped straight back out of the visible set.
   *
   * On a board of one or two objects nothing showed, because `Canvas` has a
   * guard that renders everything when culling loses more than half the
   * document. Past three or four objects that guard stops firing, and a newly
   * created object could simply never appear — while the document, the layers
   * panel and the activity feed all agreed it existed.
   *
   * Holding the id until the query itself returns it closes the window
   * properly, rather than widening the guard and hoping.
   */
  private pendingIds = new Set<string>();

  /**
   * A node deleted before it was ever indexed would otherwise stay pinned
   * visible for the life of the session, because the query can never report an
   * id that no longer exists.
   */
  private onObjectRemoved = (node: any) => {
    this.needsSpatialQuery = true;
    if (node?.id) {
      this.pendingIds.delete(node.id);
      this.visibleSet.delete(node.id);
    }
  };

  private onObjectAdded = (node: any) => {
    this.needsSpatialQuery = true;
    if (node?.id) {
      this.pendingIds.add(node.id);
      this.visibleSet.add(node.id);
      engineEvents.emit('VisibleSetUpdated', Array.from(this.visibleSet));
    }
  };

  start() {
    if (!this.frameId) {
      this.lastTime = performance.now();
      this.fpsTimer = performance.now();
      this.frameId = requestAnimationFrame(this.loop);
    }
  }

  stop() {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
  }

  private loop = (time: number) => {
    const frameStart = performance.now();
    const dt = time - this.lastTime;
    this.lastTime = time;

    // 1. Input (Handled by event listeners pushing to CameraSystem)

    // 2. Camera Update (Inertia/Springs would step here)
    const tCameraStart = performance.now();
    this.metrics.cameraTime = performance.now() - tCameraStart;

    // 3. Physics Update
    const tPhysicsStart = performance.now();
    engineEvents.emit('PhysicsTick', dt);
    this.metrics.physicsTime = performance.now() - tPhysicsStart;

    // 4. Spatial Query & Visible Set Generation
    const tQueryStart = performance.now();
    if (this.needsSpatialQuery) {
      this.needsSpatialQuery = false;
      const bounds = cameraSystem.getViewportBounds(300); // 300px Overscan Virtualization Buffer
      this.metrics.lastViewportBounds = bounds;
      
      let visibleNodes;
      
      // Fallback: If camera bounds are invalid, render everything
      if (cameraSystem.width <= 0 || cameraSystem.height <= 0) {
        visibleNodes = (spatialIndex as any).tree.all().map((item: any) => item.node);
      } else {
        visibleNodes = spatialIndex.query(bounds);
      }
      
      // Very crude way to get total count from rbush for HUD
      const totalCount = (spatialIndex as any).tree.all().length;
      this.metrics.totalCount = totalCount;
      this.metrics.visibleCount = visibleNodes.length;
      
      // Fallback: Suspicious query
      // If we queried 0 nodes, but there are actually nodes in the document, keep the previous set
      // to avoid wiping the screen during transient resize/hydration bugs.
      if (visibleNodes.length === 0 && totalCount > 0) {
         // Bypass update, keep previous visibleSet
         this.metrics.spatialQueryTime = performance.now() - tQueryStart;
         // still render
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
         this.frameId = requestAnimationFrame(this.loop);
         return;
      }
      
      const newVisibleSet = new Set<string>(visibleNodes.map((n: any) => n.id));

      /**
       * Carry anything still waiting to be indexed.
       *
       * An id leaves `pendingIds` the moment the query reports it — at which
       * point the index is authoritative for it and normal culling applies, so
       * a new object placed off-screen is not pinned visible forever.
       */
      if (this.pendingIds.size > 0) {
        for (const id of this.pendingIds) {
          if (newVisibleSet.has(id)) this.pendingIds.delete(id);
          else newVisibleSet.add(id);
        }
      }
      
      // Fast Set equality check
      let hasChanged = false;
      if (newVisibleSet.size !== this.visibleSet.size) {
        hasChanged = true;
      } else {
        for (const id of newVisibleSet) {
          if (!this.visibleSet.has(id)) {
            hasChanged = true;
            break;
          }
        }
      }

      if (hasChanged) {
        this.visibleSet = newVisibleSet;
        engineEvents.emit('VisibleSetUpdated', Array.from(this.visibleSet));
      }
    }
    this.metrics.spatialQueryTime = performance.now() - tQueryStart;

    // 5. Render Phase 
    const tRenderStart = performance.now();
    engineEvents.emit('RenderTick', { camera: cameraSystem, visible: this.visibleSet });
    this.metrics.renderTime = performance.now() - tRenderStart;

    // 6. Performance Metics
    const frameEnd = performance.now();
    this.metrics.totalFrameTime = frameEnd - frameStart;
    
    this.frameCount++;
    if (frameEnd - this.fpsTimer >= 1000) {
      this.metrics.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTimer = frameEnd;
    }

    this.frameId = requestAnimationFrame(this.loop);
  };
}

export const canvasEngine = new CanvasEngine();
