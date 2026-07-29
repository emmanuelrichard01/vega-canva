import React, { useState, useEffect } from 'react';
import { canvasEngine } from '../engine/CanvasEngine';
import { cameraSystem } from '../engine/CameraSystem';

export const PerformanceOverlay: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [metrics, setMetrics] = useState({ ...canvasEngine.metrics });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle HUD with Ctrl+Shift+P
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') {
        setVisible(v => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    let intervalId: any;
    if (visible) {
      intervalId = setInterval(() => {
        setMetrics({ ...canvasEngine.metrics });
      }, 100);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearInterval(intervalId);
    };
  }, [visible]);

  if (!visible) return null;

  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between' };
  const label: React.CSSProperties = { color: '#6B7280' };
  const divider = '1px solid #374151';

  return (
    <div style={{
      position: 'absolute', top: 80, right: 24, zIndex: 9999,
      background: 'rgba(17,24,39,0.9)', backdropFilter: 'blur(8px)', border: divider, borderRadius: 12,
      padding: 16, fontSize: 11, fontFamily: 'monospace', color: '#D1D5DB',
      boxShadow: '0 20px 40px rgba(0,0,0,0.3)', pointerEvents: 'none', width: 256, userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: divider, paddingBottom: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 700, color: '#FFFFFF', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Canvas Engine</span>
        <span style={{ fontWeight: 700, color: metrics.fps >= 55 ? 'var(--text-secondary)' : '#EF4444' }}>{metrics.fps} FPS</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={row}>
          <span style={label}>Total Frame</span>
          <span style={{ color: metrics.totalFrameTime > 16 ? '#EF4444' : '#D1D5DB' }}>{metrics.totalFrameTime.toFixed(2)} ms</span>
        </div>
        <div style={row}>
          <span style={label}>Camera Update</span>
          <span>{metrics.cameraTime.toFixed(2)} ms</span>
        </div>
        <div style={row}>
          <span style={label}>Physics Update</span>
          <span>{metrics.physicsTime.toFixed(2)} ms</span>
        </div>
        <div style={row}>
          <span style={label}>Spatial Query</span>
          <span>{metrics.spatialQueryTime.toFixed(2)} ms</span>
        </div>
        <div style={row}>
          <span style={label}>Render Pipeline</span>
          <span>{metrics.renderTime.toFixed(2)} ms</span>
        </div>
      </div>

      <div style={{ borderTop: divider, paddingTop: 8, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={row}>
          <span style={label}>Visible Nodes</span>
          <span style={{ color: '#FFFFFF', fontWeight: 700 }}>{metrics.visibleCount}</span>
        </div>
        <div style={row}>
          <span style={label}>Total Nodes</span>
          <span>{metrics.totalCount}</span>
        </div>
        <div style={{ ...row, marginTop: 4, paddingTop: 4, borderTop: '1px solid rgba(55,65,81,0.5)' }}>
          <span style={label}>Camera Zoom</span>
          <span>{cameraSystem.zoom.toFixed(2)}x</span>
        </div>
      </div>
    </div>
  );
};
