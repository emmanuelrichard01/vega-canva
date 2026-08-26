/**
 * Restricting a screen capture to the objects that were actually selected.
 *
 * ## The bug this exists for
 *
 * `ExportOptions` carries `selectedOnly` and `selectedIds`, and the two vector
 * formats honoured them: `SVGExporter` and `JSONExporter` both filter the
 * document down to those ids before they serialise anything. The raster path
 * did not. It passed `selectedIds` to `computeContentBounds` — so it *framed*
 * to the selection — and then captured the live stage inside that frame, with
 * everything else still on it.
 *
 * So "Copy as PNG" and "Copy as SVG", run on the same selection, one after the
 * other, produced **different pictures**: the SVG had the one sticky note you
 * selected, and the PNG had the sticky note plus the frame behind it, plus the
 * two notes overlapping its corners, cropped to its box. One request, two
 * answers, and the only way to find out which you had was to open the file.
 *
 * That is the codebase's recurring failure shape — two derivations of one
 * question — wearing an export's clothes. The fix is not to teach the raster
 * path the same filter a second time, but to make the stage *contain* the
 * answer the vector path computes: hide everything outside the set, capture,
 * put it back.
 *
 * ## Why by name rather than by id
 *
 * Konva's `findOne('#id')` walks the whole tree in this version, so asking for
 * each of nine hundred ids in turn is nine hundred full traversals. Every
 * object group carries the {@link OBJECT_NODE} name, so one `find` collects
 * them all and the set membership test is a hash lookup.
 */

/**
 * The name every object's top-level Konva group carries.
 *
 * Alongside whatever else it has: Konva's names are space-separated, which is
 * how {@link import('./chrome').EXPORT_CHROME} already coexists with them.
 */
export const OBJECT_NODE = 'canvas-object';

const OBJECT_SELECTOR = `.${OBJECT_NODE}`;

interface IsolatableNode {
  id(): string;
  visible(): boolean;
  visible(value: boolean): unknown;
}

interface StageLike {
  find(selector: string): IsolatableNode[];
}

/**
 * Hide every object outside `keep` for the duration of a capture.
 *
 * Returns the restore function rather than taking a callback, so the caller can
 * unwind it in the same `finally` as the camera and the chrome — one unwind
 * path, in an order the caller controls.
 *
 * Only nodes that were **visible to begin with** are recorded, so restoring
 * cannot reveal an object somebody hid from the Layers panel. That is the same
 * rule `hideExportChrome` follows, for the same reason, and getting it wrong
 * here would be worse: it would edit what the user sees, not just what the file
 * contains.
 *
 * @param keep `null` for "everything", which is the whole-board export and is a
 *   no-op rather than a walk of the tree.
 */
export function isolateObjects(stage: StageLike, keep: ReadonlySet<string> | null): () => void {
  if (!keep) return () => {};

  const hidden = stage
    .find(OBJECT_SELECTOR)
    .filter((node) => node.visible() && !keep.has(node.id()));

  hidden.forEach((node) => node.visible(false));
  return () => hidden.forEach((node) => node.visible(true));
}
