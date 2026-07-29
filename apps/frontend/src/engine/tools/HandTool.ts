import type { Tool, ToolContext } from './Tool';

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
      const container = stage.container();
      if (container) container.style.cursor = 'grabbing';
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

  onPointerUp(ctx: ToolContext, e: any) {
    this.isDragging = false;
    const stage = e.target?.getStage?.();
    if (stage) {
      const container = stage.container();
      if (container) container.style.cursor = 'grab';
    }

    const applyMomentum = () => {
      if (this.isDragging) return;

      const friction = 0.92;
      this.velocity.x *= friction;
      this.velocity.y *= friction;

      if (Math.abs(this.velocity.x) > 0.05 || Math.abs(this.velocity.y) > 0.05) {
        // Assume dt of 16ms for animation frame
        ctx.camera.panBy(this.velocity.x * 16, this.velocity.y * 16);
        this.animationFrameId = requestAnimationFrame(applyMomentum);
      } else {
        this.animationFrameId = null;
      }
    };

    if (Math.abs(this.velocity.x) > 0.1 || Math.abs(this.velocity.y) > 0.1) {
      this.animationFrameId = requestAnimationFrame(applyMomentum);
    }
  }

  onDeactivate() {
    // A flick-pan's inertia keeps calling camera.panBy() every frame via
    // requestAnimationFrame regardless of which tool is active — switching
    // to another tool (e.g. a keyboard shortcut) right after a flick didn't
    // stop it, so the canvas kept visibly drifting out from under whatever
    // tool you'd just switched to until the momentum decayed on its own.
    this.isDragging = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.velocity = { x: 0, y: 0 };
  }
}
