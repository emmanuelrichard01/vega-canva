import { ExportRegistry } from './ExportRegistry';
import type { ExportFormat, ExportOptions } from './ExportTypes';

class ExportServiceClass {
  async export(type: ExportFormat, options: ExportOptions = {}): Promise<void> {
    const exporter = ExportRegistry.get(type);
    if (!exporter) {
      throw new Error(`No exporter found for type: ${type}`);
    }

    const data = await exporter.export(options);
    
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
