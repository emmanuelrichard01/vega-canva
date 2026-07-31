import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Radar as RadarIcon, Minus, Plus, Maximize2, ChevronDown } from 'lucide-react';
import { RadarEngine } from '../engine/presence/RadarEngine';
import { useCollaborators } from '../engine/presence/useCollaborators';
import { useStore } from '../hooks/useStore';
import { cameraSystem } from '../engine/CameraSystem';
import { engineEvents } from '../engine/EventBus';

/**
 * The Radar — the whole board at a glance, with everyone on it.
 *
 * The shell only. Everything that draws or reacts to a pointer is in
 * `RadarEngine`; this owns the panel, the collapsed state and the zoom row.
 *
 * Two decisions worth keeping:
 *
 * - **Collapsed, it still shows who is here.** Putting the radar away used to
 *   cost you the only ambient answer to "is anyone else in this room?", which
 *   made collapsing it feel like leaving.
 * - **The zoom control lives here.** Until now the app had no visible zoom
 *   indicator anywhere: the only ways to change zoom were the wheel, a pinch,
 *   and a command-palette entry, and the only way to know what zoom you were
 *   at was to guess. This is the surface that is already about "where am I".
 */

const COLLAPSED_KEY = 'vega_radar_collapsed';

export const Minimap: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<RadarEngine | null>(null);

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const collaborators = useCollaborators();
  const darkTheme = useStore((s) => s.darkTheme);

  // The zoom readout is the one thing here that has to re-render, and it does
  // so at camera rate — so it is rounded to a whole percent first, which turns
  // a stream of continuous pinch deltas into a handful of state updates.
  const [zoomPercent, setZoomPercent] = useState(() => Math.round(cameraSystem.zoom * 100));
  useEffect(() => {
    const sync = () => setZoomPercent((prev) => {
      const next = Math.round(cameraSystem.zoom * 100);
      return next === prev ? prev : next;
    });
    sync();
    engineEvents.on('CameraChanged', sync);
    return () => engineEvents.off('CameraChanged', sync);
  }, []);

  const navigate = useCallback((x: number, y: number, zoom?: number) => {
    window.dispatchEvent(
      new CustomEvent('navigateViewport', { detail: { x, y, zoom: zoom ?? cameraSystem.zoom } })
    );
  }, []);

  useEffect(() => {
    if (collapsed || !canvasRef.current) return;
    const engine = new RadarEngine(canvasRef.current);
    engine.onNavigate = navigate;
    engineRef.current = engine;
    // Debug hatch, in the same spirit as `window.__physics` and
    // `window.objectsMap`. The radar only paints from `requestAnimationFrame`,
    // which never fires in an offscreen automation tab — `__radar.draw()`
    // makes it paint one frame on demand so the drawing can be looked at.
    (window as any).__radar = engine;
    return () => {
      engine.destroy();
      if ((window as any).__radar === engine) (window as any).__radar = null;
      engineRef.current = null;
    };
  }, [collapsed, navigate]);

  // Tokens are resolved once and cached in the engine, so a theme switch has
  // to tell it to look again.
  useEffect(() => {
    engineRef.current?.refreshTheme();
  }, [darkTheme]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* private mode; the panel just forgets between sessions */
    }
  }, [collapsed]);

  const zoomBy = (factor: number) =>
    cameraSystem.zoomBy(factor, cameraSystem.width / 2, cameraSystem.height / 2);

  const resetZoom = () => {
    const centre = cameraSystem.screenToWorld(cameraSystem.width / 2, cameraSystem.height / 2);
    navigate(centre.x, centre.y, 1);
  };

  const faces = collaborators.slice(0, 3);

  if (collapsed) {
    return (
      <div className="radar-dock">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="panel-surface radar-toggle"
          aria-label={
            collaborators.length > 0
              ? `Open Radar. ${collaborators.length} other ${
                  collaborators.length === 1 ? 'person' : 'people'
                } in this workspace.`
              : 'Open Radar'
          }
        >
          <RadarIcon size={16} />
          {collaborators.length > 0 ? (
            <span className="radar-faces">
              {faces.map((person) => (
                <span
                  key={person.clientId}
                  className="radar-face"
                  style={{ background: person.color }}
                  title={person.name}
                >
                  {person.initials}
                </span>
              ))}
              {collaborators.length > faces.length && (
                <span
                  className="radar-face"
                  style={{ background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}
                >
                  +{collaborators.length - faces.length}
                </span>
              )}
            </span>
          ) : (
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>Radar</span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="radar-dock">
      <div className="panel-surface radar-panel">
        <div className="radar-head">
          <span className="radar-title">
            <RadarIcon size={13} color="var(--text-primary)" aria-hidden="true" />
            Radar
            {collaborators.length > 0 && (
              <span className="radar-count">
                <span
                  aria-hidden="true"
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: 'var(--status-online)',
                  }}
                />
                {collaborators.length}
              </span>
            )}
          </span>

          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              type="button"
              className="btn-icon"
              style={{ padding: 5 }}
              onClick={() => engineRef.current?.fitToContent()}
              aria-label="Fit everything on screen"
              data-tooltip="Fit to content"
            >
              <Maximize2 size={13} />
            </button>
            <button
              type="button"
              className="btn-icon"
              style={{ padding: 5 }}
              onClick={() => setCollapsed(true)}
              aria-label="Collapse Radar"
            >
              <ChevronDown size={14} />
            </button>
          </span>
        </div>

        <canvas ref={canvasRef} className="radar-canvas" aria-hidden="true" />

        <div className="radar-foot">
          <button
            type="button"
            className="btn-icon"
            style={{ padding: 5 }}
            onClick={() => zoomBy(1 / 1.25)}
            aria-label="Zoom out"
          >
            <Minus size={13} />
          </button>
          <button
            type="button"
            className="radar-zoom"
            onClick={resetZoom}
            aria-label={`Zoom ${zoomPercent} percent. Reset to 100 percent.`}
            data-tooltip="Reset zoom"
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            className="btn-icon"
            style={{ padding: 5 }}
            onClick={() => zoomBy(1.25)}
            aria-label="Zoom in"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
