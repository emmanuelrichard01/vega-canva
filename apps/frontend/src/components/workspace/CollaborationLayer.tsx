import React, { useState, useSyncExternalStore } from 'react';
import { provider } from '../../engine/document';
import { useRoomState } from '../../hooks/useSync';
import { followMode } from '../../engine/presence/followMode';
import type { ActivityKind } from '../../engine/presence/collaborators';

/** Every activity gets a word here — see the note at the call site. */
const ROSTER_ACTIVITY: Record<ActivityKind, string> = {
  typing: 'Typing',
  recording: 'Recording',
  drawing: 'Drawing',
  moving: 'Moving objects',
};

export const CollaborationLayer: React.FC = () => {
  const { awarenessUsers } = useRoomState();
  const [hoveredUser, setHoveredUser] = useState<number | null>(null);
  const followingId = useSyncExternalStore(
    followMode.subscribe,
    followMode.getSnapshot,
    followMode.getSnapshot
  );

  const users = Array.from(awarenessUsers.entries()).filter(([_, u]) => u.user);

  if (users.length === 0) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
      {(users as Array<[number, any]>).slice(0, 4).map(([clientId, u], i) => {
        const isHovered = hoveredUser === clientId;
        const isMe = clientId === provider.awareness?.clientID;
        const isFollowed = followingId === clientId;

        // `editing.mode` is written by EditorAPI.setEditingMode, which is
        // never actually called anywhere — that field is permanently null, so
        // this always read as "Viewing" regardless of what someone was doing.
        // `activity` is what presenceManager actually keeps live.
        //
        // Unlike the cursor chip, this row *does* name every activity: you
        // came here to ask what someone is up to, so "Drawing" is the answer
        // rather than clutter. `ACTIVITY_LABEL` only covers the two that are
        // worth interrupting the canvas for, hence the second lookup.
        const activity = (u as any).activity as ActivityKind | null | undefined;
        const statusText = activity ? ROSTER_ACTIVITY[activity] : 'Viewing';

        return (
          <div
            key={clientId}
            onMouseEnter={() => setHoveredUser(clientId)}
            onMouseLeave={() => setHoveredUser(null)}
            /* This is a control, so it has to be reachable and announced as
               one. It was a bare `div` with an onClick: no tab stop, no role,
               no keyboard path to a feature whose only entry point it is. */
            role={isMe ? undefined : 'button'}
            tabIndex={isMe ? undefined : 0}
            aria-pressed={isMe ? undefined : isFollowed}
            aria-label={isMe ? undefined : `${isFollowed ? 'Stop following' : 'Follow'} ${u.user.name}`}
            onKeyDown={(e) => {
              if (isMe) return;
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              followMode.toggle(clientId);
            }}
            onClick={() => {
              // Follow, rather than jump once. The tooltip has always said
              // "Click to follow" and clicking performed a single pan, because
              // the state behind the feature was declared without a setter and
              // was permanently null — so the control that named the feature
              // did something else instead.
              if (!isMe) followMode.toggle(clientId);
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
              /* The followed avatar is ringed in the page surface it sits on,
                 one step thicker. Elevation is already spoken for by hover, and
                 a second colour here would compete with the identity colour
                 that is the whole point of the disc. */
              border: `${isFollowed ? 3 : 2}px solid var(--surface-elevated)`,
              outline: isFollowed ? `2px solid ${u.user.color}` : 'none',
              zIndex: isHovered || isFollowed ? 50 : 10 - i,
              cursor: isMe ? 'default' : 'pointer',
              transition: 'transform var(--motion-settle), box-shadow var(--motion-hover)',
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
                {!isMe && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {isFollowed ? 'Click to stop following' : 'Click to follow'}
                  </div>
                )}
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
