import * as Y from 'yjs';
import { SCHEMA_VERSION } from '../model/schema';
import { isCanonical, normalizeNode } from './normalize';

/**
 * The schema migration, parameterised over the document it operates on.
 *
 * Deliberately free of any dependency on the document singletons in `./doc` —
 * those construct a websocket provider and IndexedDB persistence at module
 * scope, which cannot (and should not) be reached from a test runner. Keeping
 * the algorithm here means it can be exercised against a plain `Y.Doc`.
 *
 * Design constraints:
 *
 *  - **Idempotent.** Two clients may run it concurrently. Writing identical
 *    values from both converges; nodes already canonical are skipped entirely.
 *  - **Single transaction.** Peers observe one atomic change rather than a
 *    storm of per-field updates, and undo treats it as one step.
 *  - **Only after sync.** Migrating before the server state arrives would
 *    rewrite a partial document and then merge against the real one.
 */
export function migrateDoc(
  target: Y.Doc,
  nodes: Y.Map<Y.Map<unknown>>,
  metadata: Y.Map<string>
): { migrated: number; skipped: number } {
  let migrated = 0;
  let skipped = 0;

  target.transact(() => {
    nodes.forEach((ymap, id) => {
      const raw = ymap.toJSON() as Record<string, unknown>;

      if (isCanonical(raw)) {
        skipped++;
        return;
      }

      const canonical = normalizeNode(raw, id) as unknown as Record<string, unknown>;

      Object.entries(canonical).forEach(([key, value]) => {
        if (value === undefined) {
          if (ymap.has(key)) ymap.delete(key);
        } else {
          ymap.set(key, value);
        }
      });

      // Remove every field the canonical node does not define.
      //
      // This was a hand-maintained deny-list of known pre-v2 names, which is
      // the wrong shape for the problem: it silently missed anything not on
      // it. A sticky, for instance, kept its old `appearance.theme` alongside
      // the new top-level `theme`, so `isCanonical` never became true and the
      // migration re-ran on every single page load, forever. Deriving the set
      // from the canonical node instead means an unrecognised field cannot
      // survive, whatever it is called.
      Object.keys(raw).forEach((key) => {
        if (!(key in canonical)) ymap.delete(key);
      });

      migrated++;
    });

    metadata.set('schemaVersion', String(SCHEMA_VERSION));
  }, 'schema-migration');

  return { migrated, skipped };
}
