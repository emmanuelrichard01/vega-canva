import { NODE_TYPES } from '../model/schema';

/**
 * Reading a JSON export back in.
 *
 * ## Why this exists
 *
 * The JSON exporter has always described itself, in the export dialog, as
 * "best for backups and version control". Nothing in the app could read one
 * back. A backup you cannot restore is not a backup — it is a file — and the
 * gap was invisible because exporting one *looks* like it worked.
 *
 * ## Why parsing is separated from applying
 *
 * Everything here is pure: it takes text and returns either a described failure
 * or a list of nodes ready to write. Restoring is destructive and irreversible
 * from the user's side, so the one thing that must not happen is discovering
 * halfway through the write that the file was truncated, or from a future
 * version, or not one of ours at all. Validate completely, then commit in a
 * single transaction, or do nothing.
 */

export interface ImportedDocument {
  nodes: Record<string, Record<string, unknown>>;
  comments: unknown[];
  exportedAt: string | null;
  /** Envelope (file format) version the file was written with. */
  version: number;
  /**
   * Node schema version, when the file records one.
   *
   * `null` for anything written before the field existed, which is every
   * export up to now — and that is the honest answer rather than assuming the
   * current one, since a file that does not say cannot be presumed to be new.
   */
  schemaVersion: number | null;
}

export type ImportResult =
  | { ok: true; document: ImportedDocument; warnings: string[] }
  | { ok: false; error: string };

/**
 * The envelope version this build writes, and the highest it can read.
 *
 * One constant rather than a literal in the exporter and a second in the
 * importer: the pair that must agree is exactly the pair most likely to be
 * edited apart, and a writer that outruns its own reader produces files the
 * app refuses to open.
 */
export const EXPORT_ENVELOPE_VERSION = 1;
export const SUPPORTED_IMPORT_VERSION = EXPORT_ENVELOPE_VERSION;

/**
 * Validate a JSON export and return what it contains.
 *
 * Rejects with a sentence a person can act on, rather than a parser error. The
 * three failures people actually hit are: picking the wrong file entirely,
 * picking a *raster* export by mistake, and picking a file from a newer build.
 */
export function parseDocumentExport(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON. Pick a .json export from Vega Studio.' };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'That file does not contain a document.' };
  }

  const doc = raw as Record<string, unknown>;

  if (typeof doc.objects !== 'object' || doc.objects === null || Array.isArray(doc.objects)) {
    return {
      ok: false,
      error: 'That JSON file is not a Vega Studio export — it has no objects in it.',
    };
  }

  const version = typeof doc.version === 'number' ? doc.version : 1;
  if (version > SUPPORTED_IMPORT_VERSION) {
    // Refused rather than attempted. A newer file may use fields this build
    // would silently drop, and a restore that quietly loses half the document
    // is worse than one that declines.
    return {
      ok: false,
      error: `This file was exported by a newer version of Vega Studio (v${version}). Update, then restore it.`,
    };
  }

  const warnings: string[] = [];
  const nodes: Record<string, Record<string, unknown>> = {};

  for (const [id, value] of Object.entries(doc.objects as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      warnings.push(`Skipped "${id}" — not an object.`);
      continue;
    }
    const node = value as Record<string, unknown>;
    const type = typeof node.type === 'string' ? node.type : null;

    if (!type || !(NODE_TYPES as readonly string[]).includes(type)) {
      // Named rather than counted: "3 objects skipped" tells you nothing about
      // whether the thing you cared about survived.
      warnings.push(`Skipped "${id}" — unknown object type "${type ?? 'none'}".`);
      continue;
    }

    // Geometry is checked but not repaired. `normalize` runs at the CRDT
    // boundary and is the one place allowed to decide what a malformed node
    // becomes; duplicating its defaults here is how the two drift apart.
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      warnings.push(`Skipped "${id}" — it has no usable position.`);
      continue;
    }

    nodes[id] = node;
  }

  if (Object.keys(nodes).length === 0) {
    return {
      ok: false,
      error: 'That export contains no objects this version can restore.',
    };
  }

  return {
    ok: true,
    warnings,
    document: {
      nodes,
      comments: Array.isArray(doc.comments) ? doc.comments : [],
      exportedAt: typeof doc.exportedAt === 'string' ? doc.exportedAt : null,
      version,
      schemaVersion: typeof doc.schemaVersion === 'number' ? doc.schemaVersion : null,
    },
  };
}

/** A short, human description of what a validated file holds. */
export function describeImport(document: ImportedDocument): string {
  const count = Object.keys(document.nodes).length;
  // Threads are named because they are now actually restored. While they were
  // silently dropped, counting them here would have been a promise the restore
  // did not keep.
  const threads = document.comments.length;
  const objects =
    `${count} object${count === 1 ? '' : 's'}` +
    (threads > 0 ? ` and ${threads} comment thread${threads === 1 ? '' : 's'}` : '');
  if (!document.exportedAt) return objects;

  const when = new Date(document.exportedAt);
  if (Number.isNaN(when.getTime())) return objects;
  return `${objects}, exported ${when.toLocaleDateString()} at ${when.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}
