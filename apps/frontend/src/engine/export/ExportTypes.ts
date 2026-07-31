export type ExportFormat = "png" | "svg" | "json";

export interface ExportOptions {
  filename?: string;
  transparent?: boolean;
  scale?: number;
  stage?: any; // Konva Stage reference for PNG exports
  bounds?: { x: number; y: number; width: number; height: number }; // Export specific region
  selectedOnly?: boolean;
  selectedIds?: string[]; // Required for selectedOnly to actually filter anything
  /**
   * Export one frame instead of the whole document.
   *
   * Resolved by `resolveExportTarget`, which fills in `bounds` from the
   * frame's own rectangle and `selectedIds` from its contents — so the
   * exporters need no knowledge of frames at all, and the three formats
   * cannot disagree about what "this frame" means.
   */
  frameId?: string;
}

export interface Exporter {
  type: ExportFormat;
  export(options: ExportOptions): Promise<Blob | string>;
}
