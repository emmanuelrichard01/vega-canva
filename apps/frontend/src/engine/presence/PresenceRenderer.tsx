import React, { useEffect, useState } from 'react';
import { provider } from '../document';
import { cameraSystem } from '../CameraSystem';
import { engineEvents } from '../EventBus';
import { useStore } from '../../hooks/useStore';



// --- Remote Selection Outlines ---
// `cameraVersion` is intentionally unread: this component reads cameraSystem
// imperatively, so the prop exists purely as an invalidation key that makes
// React re-render the outline when the camera moves.
const RemoteSelection = ({ color, objectId }: { color: string, objectId: string, cameraVersion: number }) => {
  const obj = useStore(state => state.objects[objectId]);
  if (!obj) return null;

  // Size comes straight from the node now — every type stores it in the same
  // place, so there is nothing to disambiguate. Every object also rotates
  // about its centre, so there is no per-type "is this centerable" special
  // case either.
  const width = obj.width;
  const height = obj.height;
  const cx = width / 2;
  const cy = height / 2;

  // Calculate screen coordinates
  const screenX = (obj.x * cameraSystem.zoom) + cameraSystem.x;
  const screenY = (obj.y * cameraSystem.zoom) + cameraSystem.y;
  const screenW = width * cameraSystem.zoom;
  const screenH = height * cameraSystem.zoom;

  return (
    <div style={{
      position: 'absolute',
      left: screenX,
      top: screenY,
      width: screenW,
      height: screenH,
      border: `2px solid ${color}`,
      pointerEvents: 'none',
      zIndex: 999990, // Below cursors, above everything else
      transform: `rotate(${obj.rotation || 0}deg)`,
      transformOrigin: `${cx * cameraSystem.zoom}px ${cy * cameraSystem.zoom}px`
    }} />
  );
};

// --- Presence Engine Renderer ---
export const PresenceRenderer: React.FC = () => {
  const [awarenessStates, setAwarenessStates] = useState<Map<number, any>>(new Map());
  const [cameraVersion, setCameraVersion] = useState(0);

  useEffect(() => {
    const handleCamera = () => setCameraVersion(v => v + 1);
    engineEvents.on('CameraChanged', handleCamera);
    return () => { engineEvents.off('CameraChanged', handleCamera); };
  }, []);

  useEffect(() => {
    const handleAwareness = () => {
      if (provider.awareness) {
        setAwarenessStates(new Map(provider.awareness.getStates()));
      }
    };
    
    // Subscribe to raw awareness changes. Framer Motion handles rendering smoothness.
    provider.awareness?.on('change', handleAwareness);
    handleAwareness();
    return () => provider.awareness?.off('change', handleAwareness);
  }, []);

  const myId = provider.awareness?.clientID;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 999999 }}>
      {/* 1. Remote Selections */}
      {Array.from(awarenessStates.entries()).map(([clientId, state]) => {
        if (clientId === myId || !state.selection || !state.user) return null;
        return state.selection.map((objId: string) => (
          <RemoteSelection key={`${clientId}-${objId}`} color={state.user.color} objectId={objId} cameraVersion={cameraVersion} />
        ));
      })}

    </div>
  );
};
