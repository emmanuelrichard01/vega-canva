import React from 'react';
import { LocateFixed } from 'lucide-react';
import { provider } from '../engine/document';

interface OffScreenPresenceProps {
  stageScale: number;
  stagePos: { x: number; y: number };
  dimensions: { width: number; height: number };
  onFlyTo: (x: number, y: number) => void;
}

export const OffScreenPresence: React.FC<OffScreenPresenceProps> = ({
  stageScale,
  stagePos,
  dimensions,
  onFlyTo,
}) => {
  const states = provider.awareness?.getStates();
  const myClientId = provider.awareness?.clientID;

  // Viewport bounds in world coordinates
  const viewMinX = -stagePos.x / stageScale;
  const viewMinY = -stagePos.y / stageScale;
  const viewMaxX = viewMinX + dimensions.width / stageScale;
  const viewMaxY = viewMinY + dimensions.height / stageScale;

  const offScreenUsers: Array<{
    clientId: number;
    name: string;
    color: string;
    worldX: number;
    worldY: number;
    edgeX: number;
    edgeY: number;
    distancePx: number;
  }> = [];

  (states || new Map()).forEach((state: any, clientId: number) => {
    if (clientId === myClientId || !state.user || !state.viewport) return;

    const targetX = state.viewport.x;
    const targetY = state.viewport.y;

    // Check if target is outside visible viewport
    const isOffScreen =
      targetX < viewMinX || targetX > viewMaxX || targetY < viewMinY || targetY > viewMaxY;

    if (isOffScreen) {
      // Calculate screen position clamped to edge
      const screenX = targetX * stageScale + stagePos.x;
      const screenY = targetY * stageScale + stagePos.y;

      const edgeMargin = 40;
      const clampedX = Math.max(edgeMargin, Math.min(dimensions.width - edgeMargin, screenX));
      const clampedY = Math.max(edgeMargin, Math.min(dimensions.height - edgeMargin, screenY));

      const dx = targetX - (viewMinX + (viewMaxX - viewMinX) / 2);
      const dy = targetY - (viewMinY + (viewMaxY - viewMinY) / 2);
      const distancePx = Math.round(Math.hypot(dx, dy));

      offScreenUsers.push({
        clientId,
        name: state.user.name || 'Teammate',
        color: state.user.color || '#EC4899',
        worldX: targetX,
        worldY: targetY,
        edgeX: clampedX,
        edgeY: clampedY,
        distancePx,
      });
    }
  });

  if (offScreenUsers.length === 0) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 80 }}>
      {offScreenUsers.map(u => (
        <button
          key={u.clientId}
          onClick={() => onFlyTo(u.worldX, u.worldY)}
          style={{
            position: 'absolute',
            left: u.edgeX,
            top: u.edgeY,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'auto',
            background: 'rgba(20, 23, 30, 0.94)',
            backdropFilter: 'blur(12px)',
            border: `1.5px solid ${u.color}`,
            borderRadius: 20,
            padding: '4px 10px',
            color: 'white',
            fontSize: 11,
            fontFamily: 'Inter, sans-serif',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: `0 4px 16px ${u.color}40`,
            cursor: 'pointer',
            transition: 'transform 0.15s ease',
          }}
          title={`Click to fly to ${u.name}'s position`}
        >
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: u.color }} />
          <span style={{ fontWeight: 600 }}>{u.name}</span>
          <span style={{ color: '#9CA3AF' }}>• {u.distancePx.toLocaleString()}px</span>
          <LocateFixed size={12} color={u.color} />
        </button>
      ))}
    </div>
  );
};
