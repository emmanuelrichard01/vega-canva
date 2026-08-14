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
  /** Schema version the file was written with. */
  version: number;
}

export type ImportResult =
  | { ok: true; document: ImportedDocument; warnings: string[] }
  | { ok: false; error: string };

/** The highest export version this build knows how to read. */
export const SUPPORTED_IMPORT_VERSION = 1;

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
    },
  };
}

/** A short, human description of what a validated file holds. */
export function describeImport(document: ImportedDocument): string {
  const count = Object.keys(document.nodes).length;
  const objects = `${count} object${count === 1 ? '' : 's'}`;
  if (!document.exportedAt) return objects;

  const when = new Date(document.exportedAt);
  if (Number.isNaN(when.getTime())) return objects;
  return `${objects}, exported ${when.toLocaleDateString()} at ${when.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}
