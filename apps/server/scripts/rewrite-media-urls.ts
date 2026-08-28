/**
 * One-time rewrite: media URLs that point straight at object storage.
 *
 * ## Why this is needed
 *
 * Uploads used to be handed back as a direct, public object-store URL, and the
 * client wrote that address into the document. Making the bucket private --
 * which is what routes media through the API's own hardened proxy instead --
 * turns every one of those stored addresses into a 403.
 *
 * The URL lives inside the Yjs document, not in a column, so there is no
 * `UPDATE` that fixes it. Each room's snapshot has to be loaded, walked, and
 * written back.
 *
 * ## Running it
 *
 *   npx tsx scripts/rewrite-media-urls.ts            # report only, changes nothing
 *   npx tsx scripts/rewrite-media-urls.ts --apply    # write the changes
 *
 * Take a database backup first. This rewrites the canonical state of every
 * board, and while it only touches `src` fields that match the old shape, that
 * is a promise about a regular expression rather than a guarantee.
 *
 * ## What it does not do
 *
 * `room_updates` is left alone. Those rows feed Time Travel's scrubber, so an
 * old picture will show as missing while scrubbing back through history even
 * though it is correct on the live board. Rewriting deltas is not safely
 * possible -- they are structural, not textual -- and the retention window
 * ages them out within a session anyway.
 */

import { Pool } from 'pg';
import * as Y from 'yjs';

const apply = process.argv.includes('--apply');

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'canva_user',
  password: process.env.POSTGRES_PASSWORD || 'canva_password',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'vega_canva',
});

const BUCKET = process.env.S3_BUCKET || 'vega-canva-media';

/**
 * Where media should be served from now. Required, because the whole point is
 * to point these URLs at this deployment's API rather than at its object store.
 */
const API = (process.env.PUBLIC_API_URL || '').replace(/\/+$/, '');

/**
 * Any absolute URL whose path contains `/<bucket>/<room>/<object>`.
 *
 * Matched on the bucket segment rather than on a host, because the host in
 * these stored URLs is whatever `PUBLIC_S3_URL` was, or whatever `Host` header
 * happened to carry the upload -- which is exactly the unreliability that
 * motivated the change.
 */
const OLD_URL = new RegExp(
  `^https?://[^/]+/${BUCKET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([A-Za-z0-9_-]+)/([A-Za-z0-9_.-]+)$`
);

function rewritten(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = OLD_URL.exec(value);
  if (!match) return null;
  const [, roomId, objectName] = match;
  return `${API}/rooms/${roomId}/media/${objectName}`;
}

async function main() {
  if (!API) {
    console.error('PUBLIC_API_URL must be set: it is the address these URLs are being pointed at.');
    process.exit(1);
  }

  const { rows } = await pool.query<{ room_id: string; state: Buffer | null }>(
    'SELECT room_id, state FROM room_snapshots WHERE state IS NOT NULL'
  );

  let roomsChanged = 0;
  let fieldsChanged = 0;

  for (const row of rows) {
    if (!row.state) continue;

    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, new Uint8Array(row.state));
    } catch (err) {
      console.error(`  ${row.room_id}: snapshot unreadable, skipped (${(err as Error).message})`);
      doc.destroy();
      continue;
    }

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    let changedHere = 0;

    doc.transact(() => {
      objects.forEach((node) => {
        if (!(node instanceof Y.Map)) return;
        // `src` on images and audio; nothing else in the schema holds a media
        // address. Checked by field name rather than by scanning every value,
        // so a sticky note whose *text* happens to be such a URL is untouched.
        for (const field of ['src', 'audioSrc', 'posterSrc']) {
          const next = rewritten(node.get(field));
          if (next) {
            node.set(field, next);
            changedHere += 1;
          }
        }
      });
    });

    if (changedHere > 0) {
      roomsChanged += 1;
      fieldsChanged += changedHere;
      console.log(`  ${row.room_id}: ${changedHere} URL(s)`);
      if (apply) {
        await pool.query(
          'UPDATE room_snapshots SET state = $2, updated_at = NOW() WHERE room_id = $1',
          [row.room_id, Buffer.from(Y.encodeStateAsUpdate(doc))]
        );
      }
    }

    doc.destroy();
  }

  console.log(
    `\n${apply ? 'Rewrote' : 'Would rewrite'} ${fieldsChanged} URL(s) across ${roomsChanged} of ${rows.length} room(s).`
  );
  if (!apply && fieldsChanged > 0) console.log('Re-run with --apply to write these changes.');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
