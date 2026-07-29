export type ExportFormat = "png" | "svg" | "json";

export interface ExportOptions {
  filename?: string;
  transparent?: boolean;
  scale?: number;
  stage?: any; // Konva Stage reference for PNG exports
  bounds?: { x: number; y: number; width: number; height: number }; // Export specific region
  selectedOnly?: boolean;
  selectedIds?: string[]; // Required for selectedOnly to actually filter anything
}

export interface Exporter {
  type: ExportFormat;
  export(options: ExportOptions): Promise<Blob | string>;
}
