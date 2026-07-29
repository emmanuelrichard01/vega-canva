import React, { useState, useRef, useEffect } from 'react';
import { provider } from '../engine/document';
import { Map, Minimize2 } from 'lucide-react';
import { MinimapEngine } from '../utils/MinimapEngine';

export const Minimap: React.FC = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<MinimapEngine | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    
    engineRef.current = new MinimapEngine(canvasRef.current);
    
    // Wire up the click handler to emit navigateViewport event
    engineRef.current.onClick = (worldX: number, worldY: number) => {
      // Find current stageScale from our local viewport if available, else default to 1
      const currentScale = engineRef.current?.localViewport?.zoom || 1;
      window.dispatchEvent(new CustomEvent('navigateViewport', { 
        detail: { x: worldX, y: worldY, zoom: currentScale } 
      }));
    };

    // Listen to local viewport changes to update the engine
    const handleAwareness = () => {
      const localState = provider.awareness?.getLocalState();
      if (localState?.viewport && engineRef.current) {
        engineRef.current.localViewport = localState.viewport as any;
      }
    };
    provider.awareness?.on('change', handleAwareness);
    handleAwareness(); // initial call

    return () => {
      provider.awareness?.off('change', handleAwareness);
      engineRef.current?.destroy();
    };
  }, []);

  return (
    <div style={{ position: 'absolute', bottom: '24px', left: '16px', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', pointerEvents: 'auto' }}>
      {/* Map Content */}
      {!isCollapsed && (
        <div className="panel-surface" style={{ width: 260, height: 180, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'all 300ms', borderRadius: '12px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border-divider)', backgroundColor: 'var(--surface-elevated)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              <Map size={14} color="var(--text-primary)" /> Radar
            </div>
            <button 
              onClick={() => setIsCollapsed(true)}
              className="btn-icon"
              style={{ padding: 4 }}
            >
              <Minimize2 size={12} />
            </button>
          </div>
          
          {/* Canvas Minimap Engine */}
          <canvas
            ref={canvasRef}
            width={260}
            height={145}
            style={{ width: 260, height: 145, cursor: 'crosshair', flex: 1, backgroundColor: 'transparent' }}
          />
        </div>
      )}

      {/* Collapsed Toggle Button */}
      {isCollapsed && (
        <button
          onClick={() => setIsCollapsed(false)}
          className="panel-surface btn-icon"
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Open Radar"
        >
          <Map size={16} />
        </button>
      )}
    </div>
  );
};
