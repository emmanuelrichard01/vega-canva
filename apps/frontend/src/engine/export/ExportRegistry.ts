import type { Exporter, ExportFormat } from './ExportTypes';

class ExportRegistryClass {
  private exporters = new Map<ExportFormat, Exporter>();

  register(exporter: Exporter) {
    this.exporters.set(exporter.type, exporter);
  }

  get(type: ExportFormat): Exporter | undefined {
    return this.exporters.get(type);
  }
}

export const ExportRegistry = new ExportRegistryClass();
