import { useEffect, useState } from 'react';
import {
  getConnectionStatus,
  metadataMap,
  onStatusChange,
  onSyncedChange,
  provider,
  roomId,
  type ConnectionStatus,
} from '../engine/document';

/**
 * React binding over the document layer.
 *
 * This module used to *be* the document layer: it constructed the Y.Doc and
 * provider, exported the maps, and ran its own `observeDeep` bridge into the
 * scene graph. All of that now lives in `engine/document`; what remains here
 * is the React-facing subscription. Import document primitives from
 * `engine/document` directly rather than through this hook module.
 */
export function useRoomState() {
  const [synced, setSynced] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>(getConnectionStatus);
  const [awarenessUsers, setAwarenessUsers] = useState<Map<number, any>>(new Map());
  const [metadata, setMetadata] = useState<Record<string, string>>({});

  useEffect(() => {
    const offSynced = onSyncedChange(setSynced);
    const offStatus = onStatusChange(setStatus);

    setSynced(provider.isSynced);
    setStatus(getConnectionStatus());

    const updateMetadataState = () => setMetadata(metadataMap.toJSON());
    metadataMap.observe(updateMetadataState);
    updateMetadataState();

    // Awareness fires on every cursor move (15Hz per peer). Re-rendering the
    // whole roster that often is wasteful, so only publish a new Map when the
    // roster itself — ids and user identities — actually differs.
    let lastRosterHash = '';
    const handleAwarenessChange = () => {
      const states = provider.awareness?.getStates() ?? new Map();
      const roster = Array.from(states.entries())
        .map(([id, state]: [number, any]) => ({ id, user: state.user }))
        .filter((entry) => entry.user);

      const hash = JSON.stringify(roster);
      if (hash !== lastRosterHash) {
        lastRosterHash = hash;
        setAwarenessUsers(new Map(states));
      }
    };
    provider.awareness?.on('change', handleAwarenessChange);
    handleAwarenessChange();

    return () => {
      offSynced();
      offStatus();
      metadataMap.unobserve(updateMetadataState);
      provider.awareness?.off('change', handleAwarenessChange);
    };
  }, []);

  return { synced, status, roomId, awarenessUsers, metadata };
}
