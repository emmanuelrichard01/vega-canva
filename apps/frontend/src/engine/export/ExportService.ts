import { ExportRegistry } from './ExportRegistry';
import { frameExportBounds } from './bounds';
import { descendantsOfFrame } from '../model/frames';
import { useStore } from '../../hooks/useStore';
import { FORMAT_SPECS, type ExportFormat, type ExportOptions } from './ExportTypes';

// Filenames live in their own module so they can be asserted without the
// document store this one depends on. Re-exported to keep one import site.
export { slugify, exportFilename } from './filenames';

/**
 * Turn `frameId` into the `bounds` and `selectedIds` the exporters understand.
 *
 * Done once, here, rather than in each exporter: raster formats frame by
 * `bounds`, SVG and JSON filter by `selectedIds`, and separate implementations
 * of "which objects are in this frame" is one chance per format for the PNG and
 * the SVG of the same frame to contain different things.
 *
 * The frame itself is included in the id list, because its own fill is the
 * export's background.
 */
export function resolveExportTarget(options: ExportOptions): ExportOptions {
  if (!options.frameId) return options;

  const objects = useStore.getState().objects;
  const frame = objects[options.frameId];
  if (!frame || frame.type !== 'frame') return options;

  return {
    ...options,
    bounds: options.bounds ?? frameExportBounds(frame),
    selectedOnly: true,
    selectedIds: [frame.id, ...descendantsOfFrame(frame.id, Object.values(objects))],
  };
}

/** Turn whatever an exporter returned into a Blob of the right mime type. */
function toBlob(data: Blob | string, type: ExportFormat): Blob {
  if (data instanceof Blob) return data;
  return new Blob([data], { type: FORMAT_SPECS[type].mime });
}


class ExportServiceClass {
  /**
   * Produce the bytes without doing anything with them.
   *
   * Split out from `export` because three separate features need the result
   * rather than a download: the modal's live preview, copy-to-clipboard, and
   * batch export — which needs one blob per frame before it saves any of them.
   * Previously the only way to get bytes was to trigger a download.
   */
  async render(type: ExportFormat, options: ExportOptions = {}): Promise<Blob> {
    const exporter = ExportRegistry.get(type);
    if (!exporter) throw new Error(`No exporter found for type: ${type}`);
    return toBlob(await exporter.export(resolveExportTarget(options)), type);
  }

  /** Render and hand it to the browser to save. */
  async export(type: ExportFormat, options: ExportOptions = {}): Promise<void> {
    const blob = await this.render(type, options);
    this.save(blob, options.filename || `export-${Date.now()}.${FORMAT_SPECS[type].extension}`);
  }

  /**
   * Save a blob under a name.
   *
   * The object URL is revoked on the next frame rather than immediately.
   * Revoking it synchronously after `click()` is a race some browsers lose —
   * the navigation to the blob has been *queued* but not yet started, and
   * pulling the URL out from under it produces a download that silently fails.
   */
  save(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }

  /**
   * Put the export on the clipboard instead of on disk.
   *
   * The single most common thing anyone does with an exported image is paste it
   * into a message, a doc or a ticket — and every one of those journeys used to
   * go via the downloads folder and a file picker.
   *
   * PNG only, and not because of us: the async clipboard API accepts a narrow
   * set of types and `image/png` is the one with universal support. The caller
   * checks `canCopy` rather than finding out by failing.
   */
  async copyToClipboard(options: ExportOptions = {}): Promise<void> {
    /**
     * The blob is handed over as a **promise**, not awaited first.
     *
     * Safari ties clipboard writes to the user gesture that started them, and
     * an `await` before `clipboard.write` ends that gesture — so rendering the
     * PNG and then writing it failed there with a bare NotAllowedError while
     * working perfectly in Chrome. `ClipboardItem` accepts a `Promise<Blob>`
     * for exactly this: the item is constructed synchronously inside the
     * gesture and resolves afterwards. Chrome and Firefox accept the same
     * form, so this is one path rather than a branch per engine.
     */
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': this.render('png', options) }),
    ]);
  }

  get canCopy(): boolean {
    return typeof ClipboardItem !== 'undefined' && Boolean(navigator.clipboard?.write);
  }
}

export const ExportService = new ExportServiceClass();
