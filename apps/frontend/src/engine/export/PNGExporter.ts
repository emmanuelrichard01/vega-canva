import type { Exporter, ExportOptions, ExportFormat } from './ExportTypes';
import { computeContentBounds } from './bounds';
import { hideExportChrome } from './chrome';

/**
 * Browsers cap canvas dimensions (and total area). Exceeding the cap yields a
 * blank image rather than an error, so the scale is reduced to fit instead.
 */
const MAX_CANVAS_EDGE = 8192;

export class PNGExporter implements Exporter {
  type: ExportFormat = 'png';

  async export(options: ExportOptions): Promise<Blob> {
    const stage = options.stage;
    if (!stage) {
      throw new Error('PNGExporter requires a Konva Stage reference in ExportOptions');
    }

    // The document, not the viewport.
    //
    // This used to be a bare `stage.toDataURL()`, which captures the stage at
    // its current camera position and size — i.e. a screenshot of whatever the
    // user happened to be looking at. On an infinite canvas that silently
    // cropped the export to the current view, and if the user had panned away
    // from their work it produced an empty image. SVG and JSON already
    // exported the whole document, so the three formats disagreed about what
    // "export" meant.
    const bounds =
      options.bounds ??
      computeContentBounds(undefined, options.selectedOnly ? options.selectedIds : undefined);

    const requested = options.scale ?? 2;
    const scale = Math.min(
      requested,
      MAX_CANVAS_EDGE / Math.max(bounds.width, 1),
      MAX_CANVAS_EDGE / Math.max(bounds.height, 1)
    );

    // Snapshot the live camera transform so it can be restored exactly.
    const previous = {
      x: stage.x(),
      y: stage.y(),
      scaleX: stage.scaleX(),
      scaleY: stage.scaleY(),
      width: stage.width(),
      height: stage.height(),
    };

    // Selection handles, hover outlines, the crop overlay, the tool preview and
    // the frames' name labels are all on the stage and would all be captured.
    const restoreChrome = hideExportChrome(stage);

    let dataUrl: string;
    try {
      // Reframe the stage onto the content box. This block is synchronous, so
      // the engine's requestAnimationFrame loop cannot re-apply the camera
      // mid-capture; the restore runs before any await.
      stage.scale({ x: scale, y: scale });
      stage.position({ x: -bounds.x * scale, y: -bounds.y * scale });
      stage.size({
        width: Math.max(1, Math.round(bounds.width * scale)),
        height: Math.max(1, Math.round(bounds.height * scale)),
      });
      stage.draw();

      dataUrl = stage.toDataURL({ pixelRatio: 1, mimeType: 'image/png' });
    } finally {
      restoreChrome();
      stage.size({ width: previous.width, height: previous.height });
      stage.position({ x: previous.x, y: previous.y });
      stage.scale({ x: previous.scaleX, y: previous.scaleY });
      stage.draw();
    }

    const res = await fetch(dataUrl);
    return await res.blob();
  }
}
