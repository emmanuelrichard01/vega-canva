import { ExportRegistry } from './ExportRegistry';
import { frameExportBounds } from './bounds';
import { descendantsOfFrame } from '../model/frames';
import { useStore } from '../../hooks/useStore';
import type { ExportFormat, ExportOptions } from './ExportTypes';

/**
 * Turn `frameId` into the `bounds` and `selectedIds` the exporters understand.
 *
 * Done once, here, rather than in each exporter: PNG frames by `bounds`, SVG
 * and JSON filter by `selectedIds`, and three separate implementations of
 * "which objects are in this frame" is three chances for the PNG and the SVG
 * of the same frame to contain different things.
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

class ExportServiceClass {
  async export(type: ExportFormat, options: ExportOptions = {}): Promise<void> {
    const exporter = ExportRegistry.get(type);
    if (!exporter) {
      throw new Error(`No exporter found for type: ${type}`);
    }

    const data = await exporter.export(resolveExportTarget(options));
    
    // Trigger download
    const blob = typeof data === 'string' 
      ? new Blob([data], { type: type === 'svg' ? 'image/svg+xml' : 'application/json' }) 
      : data;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = options.filename || `export-${Date.now()}.${type}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export const ExportService = new ExportServiceClass();
