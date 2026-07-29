import React, { useEffect, useRef, useState } from 'react';
import { cursorManager } from './CursorManager';
import { CursorIcon } from './CursorIcons';
import { CursorMotion } from './CursorMotion';
import { provider } from '../document';
import { cameraSystem } from '../CameraSystem';
import { presenceManager } from '../presence/PresenceManager';
import ReactDOM from 'react-dom';

// Per-remote interpolation state, keyed by awareness clientId. Presence
// broadcasts land at ~30fps at best (often less, over the network); rendering
// them at the raw update rate looks like a series of jumps. Lerping every
// remote cursor toward its latest broadcast position — the same technique
// already used for the local cursor below — renders at a full 60fps and
// reads as smooth motion regardless of how choppy the network updates are.
const remoteCursorPositions = new Map<number, { x: number; y: number }>();

export const CursorRenderer = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  // We use React state only for mounting/unmounting remote cursors.
  // The actual position updates happen purely in DOM for 60fps tracking.
  const [remoteUsers, setRemoteUsers] = useState<any[]>([]);

  useEffect(() => {
    // 1. Setup Local Cursor Tracking (Bypass React state)
    let animationFrameId: number;

    // Physics state for smooth interpolation
    let currentX = cursorManager.x;
    let currentY = cursorManager.y;
    let currentScale = 1;
    let currentRotation = 0;

    const renderLoop = () => {
      // Linear Interpolation (Lerp) towards target
      const dx = cursorManager.x - currentX;
      const dy = cursorManager.y - currentY;

      currentX += dx * CursorMotion.LocalLerp;
      currentY += dy * CursorMotion.LocalLerp;

      // Calculate dragging rotation (if moving fast, lean into it)
      const speed = Math.sqrt(dx * dx + dy * dy);
      const targetRotation = speed > 5 ? (dx > 0 ? CursorMotion.DragRotation : -CursorMotion.DragRotation) : 0;
      currentRotation += (targetRotation - currentRotation) * 0.2;

      // Scale (Hover/Click)
      const targetScale = cursorManager.state === 'hover' ? CursorMotion.HoverScale
                        : cursorManager.state === 'drag' ? CursorMotion.ClickScale : 1;
      currentScale += (targetScale - currentScale) * 0.3;

      if (containerRef.current) {
        const localCursor = containerRef.current.querySelector('#local-cursor') as HTMLElement;
        if (localCursor) {
          localCursor.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) scale(${currentScale}) rotate(${currentRotation}deg)`;
          localCursor.style.opacity = cursorManager.visible ? '1' : '0';
        }

        // Update Remote Cursors — lerp each one toward its latest broadcast world position.
        const states = provider.awareness?.getStates();
        if (states) {
          states.forEach((state: any, clientId: number) => {
            if (clientId === provider.awareness?.clientID || !state.cursor || !state.user) return;

            const targetX = state.cursor.x * cameraSystem.zoom + cameraSystem.x;
            const targetY = state.cursor.y * cameraSystem.zoom + cameraSystem.y;

            let pos = remoteCursorPositions.get(clientId);
            if (!pos) {
              pos = { x: targetX, y: targetY };
              remoteCursorPositions.set(clientId, pos);
            } else {
              pos.x += (targetX - pos.x) * CursorMotion.RemoteLerp;
              pos.y += (targetY - pos.y) * CursorMotion.RemoteLerp;
            }

            const el = document.getElementById(`remote-cursor-${clientId}`);
            if (el) {
              el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
            }
          });
        }
      }
      animationFrameId = requestAnimationFrame(renderLoop);
    };

    animationFrameId = requestAnimationFrame(renderLoop);

    // 2. Event Listeners for Local Mouse Input
    const handleMouseMove = (e: MouseEvent) => {
      cursorManager.updatePosition(e.clientX, e.clientY);
      cursorManager.setVisibility(true);

      // Update Presence
      const worldX = (e.clientX - cameraSystem.x) / cameraSystem.zoom;
      const worldY = (e.clientY - cameraSystem.y) / cameraSystem.zoom;
      presenceManager.updateCursor(worldX, worldY);
    };

    const handleMouseLeave = () => cursorManager.setVisibility(false);
    const handleMouseEnter = () => cursorManager.setVisibility(true);

    // Mousedown/up for drag state
    const handleMouseDown = () => {
       if (cursorManager.state === 'idle') cursorManager.setState('drag');
    };
    const handleMouseUp = () => {
       if (cursorManager.state === 'drag') cursorManager.setState('idle');
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('mouseenter', handleMouseEnter);

    // 3. Awareness listener for mapping remote user DOM elements
    const handleAwarenessChange = () => {
      const states = provider.awareness?.getStates();
      if (!states) return;

      const activeRemotes: any[] = [];
      const liveClientIds = new Set<number>();
      states.forEach((state: any, clientId: number) => {
        if (clientId !== provider.awareness?.clientID && state.user && state.cursor) {
          activeRemotes.push({ clientId, user: state.user, activity: state.activity, away: state.status === 'away' });
          liveClientIds.add(clientId);
        }
      });
      setRemoteUsers(activeRemotes);

      // Drop interpolation state for anyone who disconnected, so a
      // reconnecting client with the same id doesn't inherit a stale position.
      for (const clientId of remoteCursorPositions.keys()) {
        if (!liveClientIds.has(clientId)) remoteCursorPositions.delete(clientId);
      }
    };

    provider.awareness?.on('change', handleAwarenessChange);
    // Canvas cursor hiding only (don't break UI panels)
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `.konvajs-content { cursor: none !important; }`;
    document.head.appendChild(styleEl);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('mouseenter', handleMouseEnter);
      provider.awareness?.off('change', handleAwarenessChange);
      document.head.removeChild(styleEl);
    };
  }, []);

  return ReactDOM.createPortal(
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 999999999, overflow: 'hidden' }}>

      {/* LOCAL CURSOR */}
      <div id="local-cursor" style={{ position: 'absolute', top: 0, left: 0, transformOrigin: 'top left', opacity: 0, willChange: 'transform' }}>
        <CursorIcon state={cursorManager.state} />
      </div>

      {/* REMOTE CURSORS */}
      {remoteUsers.map(remote => (
        <div
          key={remote.clientId}
          id={`remote-cursor-${remote.clientId}`}
          style={{
            position: 'absolute', top: 0, left: 0,
            willChange: 'transform',
            opacity: remote.away ? 0.4 : 1,
            transition: 'opacity 200ms ease',
          }}
        >
          <CursorIcon fill={remote.user.color} state="idle" />

          {/* Profile Bubble */}
          <div style={{ position: 'absolute', top: 24, left: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: remote.user.color,
              fontFamily: 'Inter', fontSize: '12px', fontWeight: 600,
              padding: '4px 10px', borderRadius: '20px',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
              color: 'white', whiteSpace: 'nowrap'
            }}>
              {remote.user.name}
              {remote.away && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.85)' }} />
              )}
            </div>

            {/* Activity Badge — "Away" takes priority over whatever they were last doing. */}
            {(remote.away || remote.activity) && (
              <div style={{
                background: 'rgba(31,41,55,0.94)', backdropFilter: 'blur(8px)',
                fontFamily: 'Inter', fontSize: '11px', fontWeight: 500,
                padding: '4px 8px', borderRadius: '6px', color: 'white', marginTop: '4px',
                border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                whiteSpace: 'nowrap'
              }}>
                {remote.away ? 'Away' : remote.activity}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>,
    document.body
  );
};
