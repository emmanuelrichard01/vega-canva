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
    engineEvents.on('ObjectRemoved', this.requestSpatialQuery);
  }

  private needsSpatialQuery = true;
  private requestSpatialQuery = () => {
    this.needsSpatialQuery = true;
  };

  // When an object is added, immediately make it visible without waiting for the full spatial
  // query cycle. This prevents the one-frame flicker where an object exists but isn't shown.
  private onObjectAdded = (node: any) => {
    this.needsSpatialQuery = true;
    if (node?.id) {
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
