import React, { useEffect, useState } from 'react';
import { cameraSystem } from '../CameraSystem';
import { engineEvents } from '../EventBus';
import { useStore } from '../../hooks/useStore';
import { relativeLuminance } from '../cursor/remoteCursor';
import { useCollaborators } from './useCollaborators';

/**
 * What other people have selected, outlined on the canvas.
 *
 * It reads the shared `collaboratorStore` like every other presence surface.
 * It used to hold its own awareness subscription that rebuilt a `Map` of every
 * client's entire state and re-rendered this whole tree on **every** broadcast
 * — which, before the viewport writer was fixed, was once per frame per peer,
 * to redraw a rectangle that had not moved.
 */

// `cameraVersion` is intentionally unread: this component reads `cameraSystem`
// imperatively, so the prop exists purely as an invalidation key that makes
// React re-render the outline when the camera moves.
const RemoteSelection = ({
  color,
  name,
  objectId,
}: {
  color: string;
  /** Set on the first object of a selection only — see `PresenceRenderer`. */
  name: string | null;
  objectId: string;
  cameraVersion: number;
}) => {
  const obj = useStore((state) => state.objects[objectId]);
  if (!obj) return null;

  // Size comes straight from the node — every type stores it in the same
  // place, so there is nothing to disambiguate. Every object also rotates
  // about its centre, so there is no per-type special case either.
  const width = obj.width;
  const height = obj.height;

  const screenX = obj.x * cameraSystem.zoom + cameraSystem.x;
  const screenY = obj.y * cameraSystem.zoom + cameraSystem.y;

  return (
    <div
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        width: width * cameraSystem.zoom,
        height: height * cameraSystem.zoom,
        border: `2px solid ${color}`,
        pointerEvents: 'none',
        zIndex: 999990, // Below cursors, above everything else
        transform: `rotate(${obj.rotation || 0}deg)`,
        transformOrigin: `${(width / 2) * cameraSystem.zoom}px ${(height / 2) * cameraSystem.zoom}px`,
      }}
    >
      {/* Whose selection this is, tagged on the outline itself.

          The app had a component for this already — `ObjectPresenceIndicator`,
          mounted on every object — but it keyed off an awareness field called
          `editing` that **nothing has ever written**, so it had never rendered
          once. Hanging the name off the outline that is already being drawn is
          both less code and the answer every other tool of this kind arrived
          at: one mark per claimed object, not a badge floating above it. */}
      {name && (
        <span
          style={{
            position: 'absolute',
            left: -2,
            bottom: '100%',
            marginBottom: 2,
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: '1px 5px',
            borderRadius: '3px 3px 3px 0',
            background: color,
            // The outline is drawn in the raw identity colour and cannot move,
            // so the tag matches it and picks its ink for contrast instead.
            color: relativeLuminance(color) > 0.42 ? '#141821' : '#FFFFFF',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-2xs)',
            fontWeight: 'var(--weight-semibold)',
            lineHeight: 1.5,
            letterSpacing: '0.01em',
          }}
        >
          {name}
        </span>
      )}
    </div>
  );
};

export const PresenceRenderer: React.FC = () => {
  const collaborators = useCollaborators();
  const [cameraVersion, setCameraVersion] = useState(0);

  useEffect(() => {
    const handleCamera = () => setCameraVersion((v) => v + 1);
    engineEvents.on('CameraChanged', handleCamera);
    return () => {
      engineEvents.off('CameraChanged', handleCamera);
    };
  }, []);

  return (
    <div
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 999999 }}
    >
      {collaborators.map((person) =>
        person.selection.map((objId, index) => (
          <RemoteSelection
            key={`${person.clientId}-${objId}`}
            color={person.color}
            // One tag per person, not per object. Someone who selects twenty
            // things should not stamp their name across the board twenty
            // times; the outlines already say which objects are theirs.
            name={index === 0 ? person.name : null}
            objectId={objId}
            cameraVersion={cameraVersion}
          />
        ))
      )}
    </div>
  );
};
