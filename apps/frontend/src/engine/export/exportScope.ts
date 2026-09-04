/**
 * What a copy or an export actually covers, and what to call it.
 *
 * ## Why this is a module rather than three inline ternaries
 *
 * "Copy as PNG" and "Copy as SVG" both read the selection, and both used to
 * decide for themselves what to do with it — inline, at the call site, twice:
 *
 * ```ts
 * selectedIds.length ? { selectedOnly: true, selectedIds } : {}
 * ```
 *
 * Two copies of one decision is the shape this codebase keeps finding bugs in.
 * It also meant every surface that mentioned a copy said the same words
 * regardless of what would happen — "Copy as PNG" on an empty board copies the
 * *whole board*, and the menu had no way to say so, because the menu did not
 * know. The label and the behaviour came from different places.
 *
 * So the decision is made once, here, and it returns both the ids the exporter
 * needs and the words the interface should use for them. Pure, no store, no
 * Konva: what lands in a file is exactly the kind of thing this project keeps
 * assertable in Node.
 */

import { descendantsOfFrame } from '../model/frames';
import type { AnyNode } from '../model/schema';

export interface ExportScope {
  /**
   * The ids to restrict the export to, or `null` for the whole board.
   *
   * `null` rather than "every id" so the caller can pass it straight through as
   * `selectedOnly`, and so the whole-board case keeps taking the path it always
   * took rather than a new one that merely looks equivalent.
   */
  ids: string[] | null;
  /** How many objects will be in the result. */
  count: number;
  /** The subject, for a sentence: "Copied **3 objects** as PNG". */
  subject: string;
  /** A filename stem, before `exportFilename` slugifies and stamps it. */
  filenameBase: string;
  /** True when nothing was selected and this fell back to the whole board. */
  wholeBoard: boolean;
}

/**
 * What each type is called when it has to be named in a sentence.
 *
 * Not `node.type` verbatim: "Copied sticky as PNG" reads like a variable name
 * escaping into the interface, which is what it would be.
 */
const TYPE_NAMES: Record<string, string> = {
  text: 'text',
  shape: 'shape',
  sticky: 'sticky note',
  image: 'image',
  audio: 'voice note',
  path: 'path',
  comment: 'comment',
  frame: 'frame',
  connector: 'connector',
  grid: 'table',
};

/** As much of a node's own words as fits in a label. */
function ownWords(node: AnyNode): string | null {
  const written =
    node.title ??
    (node.type === 'text' || node.type === 'sticky' ? (node as { text?: string }).text : undefined);
  const trimmed = written?.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.length > 28 ? `${trimmed.slice(0, 27)}…` : trimmed;
}

/**
 * The selection, plus anything a selected frame contains.
 *
 * A frame is a *region*: selecting one and exporting it and getting an empty
 * rectangle is not a defensible reading of the request, and it is not the one
 * `resolveExportTarget` already takes for the export dialog's per-frame option.
 * Two answers to "what is in this frame" is one chance for the dialog's export
 * of a frame and the right-click export of the same frame to differ.
 *
 * Frames only. A group's members are all selected already — selecting a group
 * *is* selecting its members — so there is nothing to expand.
 */
export function expandForExport(
  objects: Readonly<Record<string, AnyNode>>,
  ids: readonly string[]
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const all = Object.values(objects);

  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  for (const id of ids) {
    add(id);
    if (objects[id]?.type === 'frame') descendantsOfFrame(id, all).forEach(add);
  }
  return out;
}

/**
 * Resolve a selection into a scope.
 *
 * @param boardTitle the room's name, used when this falls back to the board.
 */
export function exportScope(
  objects: Readonly<Record<string, AnyNode>>,
  selectedIds: readonly string[],
  boardTitle: string
): ExportScope {
  // Ids that no longer resolve are dropped rather than carried: a selection can
  // outlive the objects in it when someone else deletes one, and an exporter
  // handed a dead id frames to a box that has nothing in it.
  const live = expandForExport(objects, selectedIds).filter((id) => Boolean(objects[id]));

  if (live.length === 0) {
    return {
      ids: null,
      count: Object.keys(objects).length,
      subject: 'the board',
      filenameBase: boardTitle,
      wholeBoard: true,
    };
  }

  if (live.length === 1) {
    const node = objects[live[0]];
    const name = ownWords(node);
    const kind = TYPE_NAMES[node.type] ?? 'object';
    return {
      ids: live,
      count: 1,
      // Its own words when it has any, because "Copied Sprint goals as PNG"
      // identifies which of nine sticky notes you copied and "Copied sticky
      // note as PNG" does not.
      subject: name ? `“${name}”` : `this ${kind}`,
      filenameBase: name ?? kind,
      wholeBoard: false,
    };
  }

  return {
    ids: live,
    count: live.length,
    subject: `${live.length} objects`,
    filenameBase: `${boardTitle} selection`,
    wholeBoard: false,
  };
}

/**
 * The scope as export options.
 *
 * `selectedOnly` and `selectedIds` are two fields carrying one fact, which is
 * how the raster path came to honour the second and ignore the first. Building
 * them together keeps a caller from setting one without the other.
 */
export function scopeOptions(scope: ExportScope): {
  selectedOnly?: boolean;
  selectedIds?: string[];
} {
  return scope.ids ? { selectedOnly: true, selectedIds: scope.ids } : {};
}

/**
 * The other half of `scopeOptions`: reading those two fields back.
 *
 * `scopeOptions` is the only place export options are *built* from a
 * selection, and it exists because two inline copies of that decision had
 * already drifted. This is the same argument applied to the read side, where
 * there were **four** copies of the predicate:
 *
 * ```ts
 * options.selectedOnly && options.selectedIds?.length   // isolate, mount
 * options.selectedOnly ? options.selectedIds : undefined // both bounds calls
 * ```
 *
 * Those are not the same test, and the difference is that **`[]` is truthy in
 * JavaScript**. Given `{ selectedOnly: true, selectedIds: [] }` the first
 * yields "everything" and the second yields "these zero objects" — so the
 * raster path would frame to `computeContentBounds`'s empty-list fallback, a
 * default 800×600 box at the world origin, while isolating nothing and
 * capturing whatever board content happened to overlap that box. Neither the
 * selection nor the board.
 *
 * That state is **not currently reachable**: `exportScope` returns
 * `ids: null` when nothing survives, precisely so an exporter is never handed
 * an empty list, and `PDFExporter` always includes the frame's own id. This
 * is therefore a latch on a door that is already shut — which is the point.
 * Invariant 7 asks for one source of truth *or* a test holding the copies
 * together, and four copies agreeing today by coincidence is neither.
 *
 * @returns the ids the export covers, or `null` for "the whole document".
 *   `null` is deliberately distinct from `[]`, and the reason is the bug
 *   above: callers must not be able to confuse "everything" with "nothing".
 */
export function exportIds(options: {
  selectedOnly?: boolean;
  selectedIds?: readonly string[];
}): string[] | null {
  if (!options.selectedOnly) return null;
  if (!options.selectedIds || options.selectedIds.length === 0) return null;
  return [...options.selectedIds];
}

/**
 * `exportIds` as a set, for the two callers that test membership.
 *
 * Built on `exportIds` rather than beside it, so there is one predicate and
 * not two — a set-shaped copy of the rule would be the fifth derivation this
 * function exists to remove.
 */
export function exportIdSet(options: {
  selectedOnly?: boolean;
  selectedIds?: readonly string[];
}): ReadonlySet<string> | null {
  const ids = exportIds(options);
  return ids ? new Set(ids) : null;
}

/**
 * What the menu item should say.
 *
 * ## Why the words come from here
 *
 * "Copy as PNG" is a lie on an empty selection — it copies the whole board —
 * and the menu had no way to know that, because the scope was decided at the
 * other end, in `Room`, from a different variable. Two places deciding one
 * thing, and the visible symptom was a label that could not be wrong because it
 * never said anything specific enough to be.
 *
 * Naming the count is not decoration. "Copy 12 objects as PNG" is a sentence
 * you can decline: it is the only warning that the marquee caught the frame
 * behind the three notes you meant.
 */
export function copyLabel(scope: ExportScope, format: 'PNG' | 'SVG'): string {
  if (scope.wholeBoard) return `Copy board as ${format}`;
  if (scope.count === 1) return `Copy as ${format}`;
  return `Copy ${scope.count} objects as ${format}`;
}

/** The same, for the dialog. Ellipsis because it opens rather than acts. */
export function exportLabel(scope: ExportScope): string {
  if (scope.wholeBoard) return 'Export board…';
  if (scope.count === 1) return 'Export this object…';
  return `Export ${scope.count} objects…`;
}
