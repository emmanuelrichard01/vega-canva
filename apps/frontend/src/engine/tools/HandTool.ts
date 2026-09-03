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

  // The grab/grabbing swap used to be done here, by writing
  // `container.style.cursor` on pointer down and up. That is an inline style
  // on the same element React owns, so the two fought on every re-render, and
  // it only covered a press that started on the stage.
  //
  // Both pointers now do it without being told, and neither needs a render:
  // the native one through `[data-cursor-mode="pan"]:active` in `index.css`,
  // the drawn one by carrying both hands and choosing with `[data-pressed]`.
  // That also catches Space-pan, which this never did — and it is why the
  // `grab` mode has no caller: the gesture lives in a ref, and a ref cannot
  // drive a render, so the closed hand had to be reachable without one.
  onPointerUp(ctx: ToolContext, _e: any) {
    this.isDragging = false;

    /**
     * Momentum, decayed by elapsed time rather than by frame.
     *
     * This applied a flat `velocity *= 0.92` once per frame and advanced the
     * camera by an assumed 16ms — so the decay was tied to the refresh rate,
     * not to time. On a 144Hz display the same flick received 2.4× as many
     * multiplications per second and died in roughly a third of the distance;
     * on a throttled tab it sailed. Two people flicking identically got
     * different results for no reason either could see.
     *
     * `RETAINED_PER_SECOND` is the fraction of speed surviving one second, so
     * `pow(retained, seconds)` gives the same curve at any frame rate. The
     * value matches what 0.92-per-frame felt like at 60Hz, so the tuning that
     * was already there is preserved.
     */
    const RETAINED_PER_SECOND = 0.0063;
    const STOP_BELOW = 0.05;
    let lastFrame = performance.now();

    const applyMomentum = () => {
      if (this.isDragging) return;

      const now = performance.now();
      // Clamped: a backgrounded tab returns with a gap of seconds, and an
      // unclamped step would teleport the camera on the frame it resumes.
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
      lastFrame = now;

      const decay = Math.pow(RETAINED_PER_SECOND, dt);
      this.velocity.x *= decay;
      this.velocity.y *= decay;

      if (Math.abs(this.velocity.x) > STOP_BELOW || Math.abs(this.velocity.y) > STOP_BELOW) {
        // Velocity is in px per ms, so the step is velocity × elapsed ms.
        ctx.camera.panBy(this.velocity.x * dt * 1000, this.velocity.y * dt * 1000);
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
