/**
 * The diagnostic HUD, in a module of its own.
 *
 * It is separate from `PerformanceOverlay` for one reason: importing it pulls
 * `CanvasEngine`, `CameraSystem` and `SpatialIndex`, and through the last of
 * those, rbush. Naming it in a static import made all of that a dependency of
 * the app's entry chunk -- which is to say, of the dashboard, a screen with no
 * canvas on it -- to serve a panel that is invisible until somebody presses
 * Ctrl+Shift+P. The keystroke lives next door; this arrives when it is struck.
 */
import React, { useState, useEffect } from 'react';
import { canvasEngine } from '../engine/CanvasEngine';
import { cameraSystem } from '../engine/CameraSystem';
import './performanceHud.css';

export const PerformanceHud: React.FC = () => {
  const [metrics, setMetrics] = useState({ ...canvasEngine.metrics });

  useEffect(() => {
    const id = setInterval(() => setMetrics({ ...canvasEngine.metrics }), 100);
    return () => clearInterval(id);
  }, []);

  const slow = metrics.totalFrameTime > 16;

  return (
    <div className="perf-hud" role="status" aria-label="Canvas performance">
      <div className="perf-hud__head">
        <span className="perf-hud__title">Canvas engine</span>
        <span className="perf-hud__fps" data-bad={metrics.fps < 55 || undefined}>{metrics.fps} FPS</span>
      </div>

      <dl className="perf-hud__rows">
        <div><dt>Total frame</dt><dd data-bad={slow || undefined}>{metrics.totalFrameTime.toFixed(2)} ms</dd></div>
        <div><dt>Spatial query</dt><dd>{metrics.spatialQueryTime.toFixed(2)} ms</dd></div>
        <div><dt>Render pipeline</dt><dd>{metrics.renderTime.toFixed(2)} ms</dd></div>
      </dl>

      <dl className="perf-hud__rows perf-hud__rows--ruled">
        <div><dt>Visible nodes</dt><dd>{metrics.visibleCount}</dd></div>
        <div><dt>Total nodes</dt><dd>{metrics.totalCount}</dd></div>
        <div><dt>Camera zoom</dt><dd>{cameraSystem.zoom.toFixed(2)}x</dd></div>
      </dl>
    </div>
  );
};
