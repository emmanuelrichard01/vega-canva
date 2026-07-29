import React, { useState } from 'react';
import { provider } from '../../engine/document';
import { useRoomState } from '../../hooks/useSync';

export const CollaborationLayer: React.FC = () => {
  const { awarenessUsers } = useRoomState();
  const [hoveredUser, setHoveredUser] = useState<number | null>(null);

  const users = Array.from(awarenessUsers.entries()).filter(([_, u]) => u.user);
  
  if (users.length === 0) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
      {(users as Array<[number, any]>).slice(0, 4).map(([clientId, u], i) => {
        const isHovered = hoveredUser === clientId;
        const isMe = clientId === provider.awareness?.clientID;

        // `editing.mode` is written by EditorAPI.setEditingMode, which is
        // never actually called anywhere — that field is permanently null,
        // so this always read as "Viewing" regardless of what someone was
        // doing. `activity` is the field presenceManager (and the canvas'
        // own per-object presence badges) actually keep live.
        const statusText = (u as any).activity || 'Viewing';

        return (
          <div 
            key={clientId}
            onMouseEnter={() => setHoveredUser(clientId)}
            onMouseLeave={() => setHoveredUser(null)}
            onClick={() => {
              // Jump to user's viewport
              if (clientId !== provider.awareness?.clientID && u.viewport) {
                window.dispatchEvent(new CustomEvent('navigateViewport', { detail: { x: u.viewport.x, y: u.viewport.y, zoom: u.viewport.zoom || 1 } }));
              }
            }}
            style={{
              position: 'relative',
              width: 32, 
              height: 32, 
              borderRadius: '50%', 
              backgroundColor: u.user.color, 
              color: 'white',
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              fontSize: 14, 
              fontWeight: 600,
              marginLeft: i === 0 ? 0 : -10, 
              border: '2px solid var(--surface-elevated)', 
              zIndex: isHovered ? 50 : 10 - i,
              cursor: isMe ? 'default' : 'pointer',
              transition: 'transform var(--motion-spring), box-shadow var(--motion-hover)',
              transform: isHovered ? 'translateY(-4px)' : 'none',
              boxShadow: isHovered ? 'var(--shadow-md)' : 'var(--shadow-sm)'
            }}
          >
            {u.user.name.charAt(0).toUpperCase()}
            
            {/* Ambient Popover (Shows when hovered) */}
            {isHovered && (
              <div 
                className="panel-surface"
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 8,
                  padding: '8px 12px',
                  width: 'max-content',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  pointerEvents: 'none', // purely informational
                  animation: 'fadeIn 0.2s ease'
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{u.user.name}{isMe ? ' (You)' : ''}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{statusText}</div>
                {!isMe && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>Click to follow</div>}
              </div>
            )}
          </div>
        );
      })}
      
      {users.length > 4 && (
        <div style={{
          width: 32, height: 32, borderRadius: '50%', backgroundColor: 'var(--surface-secondary)', color: 'var(--text-secondary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600,
          marginLeft: -10, border: '2px solid var(--surface-elevated)', zIndex: 1
        }}>
          +{users.length - 4}
        </div>
      )}
    </div>
  );
};
