import type { Tool, ToolContext } from './Tool';
import { isCoasting, isFlick, momentumStep, prefersReducedMotion } from '../cameraMotion';

export class HandTool implements Tool {
  id = 'hand';
  cursor = 'grab';

  private isDragging = false;
  private lastPos = { x: 0, y: 0 };
  private velocity = { x: 0, y: 0 };
  private lastTime = 0;
  private animationFrameId: number | null = null;

  onPointerDown(ctx: ToolContext, e: any) {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.isDragging = true;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (pos) {
      this.lastPos = { x: pos.x, y: pos.y };
      this.lastTime = performance.now();
      this.velocity = { x: 0, y: 0 };
    }
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (!this.isDragging) return;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    const now = performance.now();
    if (pos) {
      const dx = pos.x - this.lastPos.x;
      const dy = pos.y - this.lastPos.y;
      const dt = Math.max(1, now - this.lastTime);
      
      this.velocity = { x: dx / dt, y: dy / dt };
      
      ctx.camera.panBy(dx, dy);
      this.lastPos = { x: pos.x, y: pos.y };
      this.lastTime = now;
    }
  }

  // The open and closed hand need no code here: the native cursor switches
  // through `[data-cursor-mode="pan"]:active` in index.css, and the drawn one
  // carries both hands and chooses with `[data-pressed]`, which also covers
  // Space-pan.
  onPointerUp(ctx: ToolContext, _e: any) {
    this.isDragging = false;
    // A drag that paused before release has no speed left to carry.
    if (performance.now() - this.lastTime > 50) this.velocity = { x: 0, y: 0 };

    // Coasting is motion the person did not make; under reduced motion a pan
    // stops where the pointer let go.
    if (prefersReducedMotion() || !isFlick(this.velocity)) return;

    let lastFrame = performance.now();
    const coast = () => {
      if (this.isDragging) return;
      const now = performance.now();
      const step = momentumStep(this.velocity, (now - lastFrame) / 1000);
      lastFrame = now;
      this.velocity = step.velocity;
      if (isCoasting(this.velocity)) {
        ctx.camera.panBy(step.dx, step.dy);
        this.animationFrameId = requestAnimationFrame(coast);
      } else {
        this.animationFrameId = null;
      }
    };
    this.animationFrameId = requestAnimationFrame(coast);
  }

  onDeactivate() {
    // Switching tool stops any coasting, so the board does not drift under the next tool.
    this.isDragging = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.velocity = { x: 0, y: 0 };
  }
}
