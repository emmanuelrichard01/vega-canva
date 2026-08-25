import { SCHEMA_VERSION } from '../model/schema';
import { doc, groupsMap, metadataMap, objectsMap } from './doc';
import { migrateGridGroups } from '../grid/gridMigrate';
import { migrateDoc } from './migrateDoc';

export { migrateDoc } from './migrateDoc';

/**
 * Rewrite the stored document into the canonical schema, once.
 *
 * Reading is already safe without this — `normalizeNode` runs at the store
 * boundary, so a legacy document renders correctly either way. The migration
 * exists so the *stored* document converges too, and so peers joining later
 * do not each pay the normalization cost forever.
 */
export function migrateDocument(): { migrated: number; skipped: number } {
  return migrateDoc(doc, objectsMap, metadataMap);
}

/**
 * Run the migration once the document has finished syncing.
 *
 * Returns a disposer. Safe to call repeatedly (StrictMode double-invokes).
 */
export function scheduleMigration(provider: {
  isSynced: boolean;
  on: (event: string, cb: () => void) => void;
  off: (event: string, cb: () => void) => void;
}): () => void {
  let done = false;

  const run = () => {
    if (done) return;
    done = true;

    /**
     * Grids first, and unconditionally.
     *
     * Outside the `schemaVersion` gate below on purpose: that gate skips the
     * whole migration when a peer has already stamped the current version,
     * which is right for field-level normalisation and wrong here. A board
     * carrying grids-as-groups is already at the current schema version --
     * the group model was never a different *version*, it was a different
     * *shape* -- so a gated conversion would never run on the boards that need
     * it. It is cheap when there is nothing to do: one pass over a map that is
     * usually empty.
     */
    const grids = migrateGridGroups(doc, objectsMap, groupsMap as never);
    if (grids > 0) console.info(`[schema] folded ${grids} grid group(s) into grid nodes`);

    const storedVersion = Number(metadataMap.get('schemaVersion') ?? 0);
    // A newer peer may already have migrated this document.
    if (storedVersion >= SCHEMA_VERSION && objectsMap.size > 0) return;

    const { migrated, skipped } = migrateDocument();
    if (migrated > 0) {
      console.info(
        `[schema] migrated ${migrated} node(s) to v${SCHEMA_VERSION} (${skipped} already canonical)`
      );
    }
  };

  if (provider.isSynced) {
    run();
    return () => {};
  }

  provider.on('synced', run);
  // An offline start never fires `synced`; IndexedDB still has a document to
  // migrate, so don't block on the network indefinitely.
  const timer = setTimeout(run, 4000);

  return () => {
    provider.off('synced', run);
    clearTimeout(timer);
  };
}
