/**
 * The parts of the canvas that are interface rather than document.
 *
 * PNG export works by re-framing the live Konva stage and capturing it, which
 * means it captures *everything on the stage* — including the selection
 * handles, the hover outline, the crop overlay, the force ring, the tool's
 * size preview and the frames' name labels. Exporting with something selected
 * baked the blue transformer into the image, and there was no way to tell from
 * the export dialog that this would happen.
 *
 * SVG and JSON never had the problem: they are built from the document, which
 * contains none of this. So the rule is stated once here and applied by the
 * one exporter that reads pixels off the screen.
 *
 * Konva matches `name` by `.selector`, and names are space-separated, so a
 * node can carry this alongside whatever other name it already uses.
 */
export const EXPORT_CHROME = 'export-chrome';

/** Konva selector form of {@link EXPORT_CHROME}. */
const CHROME_SELECTOR = `.${EXPORT_CHROME}`;

interface HideableNode {
  visible(): boolean;
  visible(value: boolean): unknown;
}

interface StageLike {
  find(selector: string): HideableNode[];
}

/**
 * Hide the interface for the duration of a capture.
 *
 * Returns the restore function rather than taking a callback so the caller can
 * put it in a `finally` alongside the camera restore it already does — one
 * unwind path, in the order the caller controls.
 *
 * Only nodes that were actually visible are recorded, so restoring cannot turn
 * on a transformer that was already hidden (the crop overlay hides it) or
 * reveal an object the user has hidden from the Layers panel.
 */
export function hideExportChrome(stage: StageLike): () => void {
  const hidden = stage.find(CHROME_SELECTOR).filter((node) => node.visible());
  hidden.forEach((node) => node.visible(false));
  return () => hidden.forEach((node) => node.visible(true));
}
