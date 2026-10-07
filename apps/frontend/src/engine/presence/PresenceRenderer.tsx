import React, { useEffect, useMemo, useState } from 'react';
import { cameraSystem } from '../CameraSystem';
import { engineEvents } from '../EventBus';
import { useStore } from '../../hooks/useStore';
import { chipColorsFor, type ChipColors } from '../cursor/remoteCursor';
import { canvasChromeContrast, useContrast } from '../ui/contrast';
import { useCollaborators } from './useCollaborators';
import './presence.css';

/**
 * What other people have selected, outlined on the canvas in their colour.
 *
 * Reads the shared `collaboratorStore` like every other presence surface. The
 * outline turns with the object about its centre, which is where
 * `ObjectRenderer` puts the origin, and the first object of each person's
 * selection carries their name on a tag in the same readable pair their cursor
 * tag uses. Under increased contrast the outline thickens and gains a halo in
 * the surface colour, so it separates from whatever it crosses.
 */

// `cameraVersion` is intentionally unread: the outline reads `cameraSystem`
// imperatively, and the prop is the invalidation key that re-renders it when
// the camera moves.
const RemoteSelection = ({
  colors,
  name,
  objectId,
  weight,
  halo,
}: {
  colors: ChipColors;
  /** Set on the first object of a selection only. */
  name: string | null;
  objectId: string;
  cameraVersion: number;
  weight: number;
  halo: boolean;
}) => {
  const obj = useStore((state) => state.objects[objectId]);
  if (!obj) return null;

  // Scale folded in as an absolute value, matching how ObjectRenderer paints
  // the node and how SelectionTransformer frames it.
  const zoom = cameraSystem.zoom;
  const width = obj.width * Math.abs(obj.scaleX || 1) * zoom;
  const height = obj.height * Math.abs(obj.scaleY || 1) * zoom;

  return (
    <div
      className="rs"
      data-halo={halo ? '1' : '0'}
      style={
        {
          left: obj.x * zoom + cameraSystem.x,
          top: obj.y * zoom + cameraSystem.y,
          width,
          height,
          transform: `rotate(${obj.rotation || 0}deg)`,
          transformOrigin: `${width / 2}px ${height / 2}px`,
          '--who': colors.outline,
          '--who-fill': colors.fill,
          '--who-ink': colors.ink,
          '--rs-weight': weight,
        } as React.CSSProperties
      }
    >
      {name && <span className="rs__tag">{name}</span>}
    </div>
  );
};

export const PresenceRenderer: React.FC = () => {
  const collaborators = useCollaborators();
  const [cameraVersion, setCameraVersion] = useState(0);
  const { enhanced } = useContrast();
  const { strokeScale, halo } = canvasChromeContrast(enhanced);

  useEffect(() => {
    const handleCamera = () => setCameraVersion((v) => v + 1);
    engineEvents.on('CameraChanged', handleCamera);
    return () => {
      engineEvents.off('CameraChanged', handleCamera);
    };
  }, []);

  const palettes = useMemo(
    () => new Map(collaborators.map((c) => [c.clientId, chipColorsFor(c.color)])),
    [collaborators]
  );

  return (
    <div className="rs-layer">
      {collaborators.map((person) =>
        person.selection.map((objId, index) => (
          <RemoteSelection
            key={`${person.clientId}-${objId}`}
            colors={palettes.get(person.clientId)!}
            name={index === 0 ? person.name : null}
            objectId={objId}
            cameraVersion={cameraVersion}
            weight={strokeScale}
            halo={halo}
          />
        ))
      )}
    </div>
  );
};
