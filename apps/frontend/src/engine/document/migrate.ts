import { SCHEMA_VERSION } from '../model/schema';
import { DERIVED_ORIGIN, doc, groupsMap, metadataMap, objectsMap } from './doc';
import { repairGroupRecords } from './upkeep';
import { migrateGridGroups } from '../grid/gridMigrate';
import { migrateDoc } from './migrateDoc';
import { canEditObjects } from '../model/permissions';

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
 * Run the migration once the server's state has arrived.
 *
 * Never before: migrating the IndexedDB copy alone would write stale values
 * concurrently with the server's, and last-writer-wins could let them revert
 * other people's edits. An offline session simply does not migrate; reads are
 * normalised at the store boundary either way. Only an editor migrates, since
 * a viewer's writes are dropped by the server.
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
    if (done || !canEditObjects()) return;
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

    /**
     * Flat groups get group records, also outside the version gate and for
     * the same reason: a flat group is a shape, not a version. Readers already
     * see these records (the store canonicalises on read); this makes the
     * stored document agree, so nesting one writes onto a record that exists.
     * Deterministic, so editors joining together write the same values.
     */
    const groupFixes = repairGroupRecords(DERIVED_ORIGIN);
    if (groupFixes > 0) console.info(`[schema] wrote ${groupFixes} record(s) for flat groups`);

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
  return () => provider.off('synced', run);
}
