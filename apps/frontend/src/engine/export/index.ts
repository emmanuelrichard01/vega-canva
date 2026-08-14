import { ExportRegistry } from './ExportRegistry';
import { JSONExporter } from './JSONExporter';
import { SVGExporter } from './SVGExporter';
import { RasterExporter } from './RasterExporter';
import { PDFExporter } from './PDFExporter';

// Pre-register all built-in exporters. The three raster formats share one
// implementation and differ only by mime type — see RasterExporter.
ExportRegistry.register(new JSONExporter());
ExportRegistry.register(new SVGExporter());
ExportRegistry.register(new RasterExporter('png'));
ExportRegistry.register(new RasterExporter('jpeg'));
ExportRegistry.register(new RasterExporter('webp'));
ExportRegistry.register(new PDFExporter());

export { ExportService, exportFilename, slugify } from './ExportService';
export {
  EXPORT_FORMAT_IDS,
  FORMAT_SPECS,
  resolveBackground,
  type ExportBackground,
  type ExportFormat,
  type ExportOptions,
  type FormatSpec,
} from './ExportTypes';
