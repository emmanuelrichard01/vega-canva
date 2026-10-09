import { ExportRegistry } from './ExportRegistry';
import { frameExportBounds } from './bounds';
import { descendantsOfFrame } from '../model/frames';
import { useStore } from '../../hooks/useStore';
import { FORMAT_SPECS, type ExportFormat, type ExportOptions } from './ExportTypes';
import { canCopyImage, copyImage, copyVector, type ClipboardResult } from './clipboard';
import { computeContentBounds } from './bounds';
import { clipboardScale } from './rasterLimits';
import { renderSvg, type SvgReport } from './SVGExporter';
import { zipBlob } from './zipWriter';
import { uniqueFilenames } from './filenames';
import { throwIfAborted } from './abort';

// Filenames live in their own module so they can be asserted without the
// document store this one depends on. Re-exported to keep one import site.
export { slugify, exportFilename } from './filenames';

/** One file of a multi-file export. */
export interface ExportJob {
  format: ExportFormat;
  options: ExportOptions;
  filename: string;
}

export interface ExportFilesResult {
  /** How many files were written. */
  files: number;
  /** True when they went out as one ZIP rather than as a single file. */
  archive: boolean;
}

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

  /**
   * An SVG and what went into it: the bytes embedded fonts add, the families
   * that could not be carried, and the text left live because its face could
   * not be outlined. The dialog shows these beside the preview.
   */
  async renderSvgReport(options: ExportOptions = {}): Promise<SvgReport & { blob: Blob }> {
    const report = await renderSvg(resolveExportTarget(options));
    return { ...report, blob: new Blob([report.svg], { type: FORMAT_SPECS.svg.mime }) };
  }

  /**
   * Several files at once: one frame per file, or one object in several
   * presets. Rendered one after another (so a long run reports progress and
   * can be cancelled between files), then saved as the file itself when
   * there is only one, or as a single ZIP named `archiveName` when there are
   * more. Names are made distinct within the archive.
   */
  async exportFiles(
    jobs: readonly ExportJob[],
    run: { archiveName: string; signal?: AbortSignal; onProgress?: (p: { done: number; total: number }) => void }
  ): Promise<ExportFilesResult> {
    if (jobs.length === 0) throw new Error('There is nothing to export. Select a frame or an object first.');
    const names = uniqueFilenames(jobs.map((j) => j.filename));
    const files: Array<{ name: string; data: Uint8Array }> = [];
    for (let i = 0; i < jobs.length; i++) {
      throwIfAborted(run.signal);
      const job = jobs[i];
      const blob = await this.render(job.format, { ...job.options, signal: run.signal });
      if (jobs.length === 1) {
        this.save(blob, names[0]);
        run.onProgress?.({ done: 1, total: 1 });
        return { files: 1, archive: false };
      }
      files.push({ name: names[i], data: new Uint8Array(await blob.arrayBuffer()) });
      run.onProgress?.({ done: i + 1, total: jobs.length });
    }
    throwIfAborted(run.signal);
    this.save(zipBlob(files), run.archiveName.endsWith('.zip') ? run.archiveName : `${run.archiveName}.zip`);
    return { files: files.length, archive: true };
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
   * Throws on failure, because the export dialog's Copy button has a place to
   * put an error message. The menu items go through {@link copy}, which returns
   * the outcome instead — a right-click menu closes on click and has nowhere to
   * fail into.
   */
  async copyToClipboard(options: ExportOptions = {}): Promise<void> {
    const result = await copyImage(() => this.render('png', options));
    if (!result.ok) throw new Error(result.message);
  }

  /**
   * Copy in a chosen format, at a density chosen for the subject.
   *
   * ## What this replaces
   *
   * Two call sites, each with its own idea of the same three decisions: what
   * the copy covers (`selectedIds.length ? … : {}`, written out twice), how
   * densely to render it (the exporter's default 2×, whatever the subject),
   * and what to do when it fails (nothing, in both).
   *
   * The density is the interesting one. 2× is right for exactly one subject
   * size: it put a 180-unit sticky note on the clipboard as a 360px image and
   * asked for 8000px of a large board. `clipboardScale` holds the *result*
   * steady instead of the multiplier — see its own note.
   *
   * A caller that has already decided on a scale keeps it; this only fills in
   * the blank.
   */
  async copy(format: 'png' | 'svg', options: ExportOptions = {}): Promise<ClipboardResult> {
    const resolved = resolveExportTarget(options);

    if (format === 'svg') {
      try {
        const blob = await this.render('svg', resolved);
        // SVG goes on as vector *and* as text: see `clipboard.ts`. It used to
        // go on as text alone, so pasting into Illustrator gave a paragraph
        // beginning `<svg` rather than shapes.
        return await copyVector(await blob.text());
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'Could not copy the SVG.' };
      }
    }

    const scaled = { ...resolved, scale: resolved.scale ?? this.copyScale(resolved) };
    return copyImage(() => this.render('png', scaled));
  }

  /** The density {@link copy} will use, so a caller can say so before it runs. */
  copyScale(options: ExportOptions): number {
    const bounds =
      options.bounds ??
      computeContentBounds(
        useStore.getState().objects,
        options.selectedOnly ? options.selectedIds : undefined,
        options.padding
      );
    return clipboardScale(bounds.width, bounds.height);
  }

  get canCopy(): boolean {
    return canCopyImage();
  }
}

export const ExportService = new ExportServiceClass();
