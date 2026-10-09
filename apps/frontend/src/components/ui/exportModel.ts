import { FORMAT_SPECS, type ExportBackground, type ExportFormat } from '../../engine/export/ExportTypes';

/**
 * The export dialog's decisions, apart from its drawing.
 *
 * Imports only `ExportTypes` from the export engine, which is on the shared
 * list in `exportChunking.test.ts`; everything heavy stays behind the dialog's
 * own lazy chunk.
 */

export type FormatCardId = 'image' | 'svg' | 'pdf' | 'json';

export interface FormatCard {
  id: FormatCardId;
  label: string;
  /** What it is good for and what it is not, in one honest line. */
  detail: string;
  /** The encodings under this card. The first is its default. */
  formats: readonly ExportFormat[];
}

export const FORMAT_CARDS: readonly FormatCard[] = [
  { id: 'image', label: 'Image', detail: 'Pixels for slides, chat and documents. Text is not editable.', formats: ['png', 'jpeg', 'webp'] },
  { id: 'svg', label: 'SVG', detail: 'Vector shapes, sharp at any size. Opens in Figma and Illustrator.', formats: ['svg'] },
  { id: 'pdf', label: 'PDF', detail: 'Pages at real size for printing. Each frame can be a page.', formats: ['pdf'] },
  { id: 'json', label: 'Backup', detail: 'The board itself, every object, to restore here later. Not an image.', formats: ['json'] },
];

export function cardFor(format: ExportFormat): FormatCard {
  return FORMAT_CARDS.find((c) => c.formats.includes(format)) ?? FORMAT_CARDS[0];
}

export const SCALES = [1, 2, 3, 4] as const;

export const PADDINGS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'None' },
  { value: 16, label: 'Small' },
  { value: 40, label: 'Medium' },
  { value: 96, label: 'Large' },
];

export const BACKGROUNDS: ReadonlyArray<{ id: ExportBackground; label: string }> = [
  { id: 'transparent', label: 'None' },
  { id: 'paper', label: 'White' },
  { id: 'ink', label: 'Dark' },
];

/** The settings remembered per board, so the next export starts where this one ended. */
export interface ExportPrefs {
  format: ExportFormat;
  scale: number;
  background: ExportBackground;
  padding: number;
  quality: number;
  embedLocalFonts: boolean;
  /** SVG: carry the app's own typefaces inside the file. */
  embedFonts: boolean;
  /** SVG: text objects as outlines. */
  outlineText: boolean;
  /** Draw comment pins. Off by default: comments are conversation, not content. */
  includeComments: boolean;
}

export const DEFAULT_PREFS: ExportPrefs = {
  format: 'png',
  scale: 2,
  background: 'transparent',
  padding: 40,
  quality: 0.92,
  embedLocalFonts: false,
  embedFonts: false,
  outlineText: false,
  includeComments: false,
};

export const prefsKey = (roomId: string) => `vega:export-prefs:${roomId || 'local'}`;

/**
 * Stored settings, checked field by field.
 *
 * Storage outlives builds: a value written by an older dialog (4×, a format
 * that has since gone) must fall back to the default rather than reach the
 * exporter.
 */
export function sanitizePrefs(raw: unknown): ExportPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const format = typeof r.format === 'string' && r.format in FORMAT_SPECS ? (r.format as ExportFormat) : DEFAULT_PREFS.format;
  const scale = (SCALES as readonly number[]).includes(r.scale as number) ? (r.scale as number) : DEFAULT_PREFS.scale;
  const background = BACKGROUNDS.some((b) => b.id === r.background) ? (r.background as ExportBackground) : DEFAULT_PREFS.background;
  const padding = PADDINGS.some((p) => p.value === r.padding) ? (r.padding as number) : DEFAULT_PREFS.padding;
  const quality =
    typeof r.quality === 'number' && Number.isFinite(r.quality) ? Math.min(1, Math.max(0.3, r.quality)) : DEFAULT_PREFS.quality;
  const embedLocalFonts = r.embedLocalFonts === true;
  return {
    format,
    scale,
    background,
    padding,
    quality,
    embedLocalFonts,
    embedFonts: r.embedFonts === true,
    outlineText: r.outlineText === true,
    includeComments: r.includeComments === true,
  };
}

/** Bytes as something a person reads without counting digits. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The file's likely size, from a preview rendered at 1×.
 *
 * Pixel formats grow with the square of the scale. A lossy encoder does not
 * grow exactly that way, so this is shown as an estimate. PDF and the backup
 * have no honest estimate from an image preview and say nothing.
 */
export function estimateBytes(format: ExportFormat, previewBytes: number | null, scale: number): number | null {
  if (previewBytes === null) return null;
  if (format === 'pdf' || format === 'json') return null;
  return FORMAT_SPECS[format].raster ? previewBytes * scale * scale : previewBytes;
}

/** The pixel size of the file, as "2400 × 1600". */
export function pixelSize(box: { width: number; height: number }, scale: number): string {
  return `${Math.round(box.width * scale).toLocaleString()} × ${Math.round(box.height * scale).toLocaleString()}`;
}

/**
 * What the preview is rendered as. PDF is drawn through the same capture as
 * PNG, and an image element cannot show a PDF, so its picture is the PNG.
 */
export function previewFormat(format: ExportFormat): ExportFormat | null {
  if (format === 'json') return null;
  return format === 'pdf' ? 'png' : format;
}

/** Label for the main button: says what will be saved. */
export function exportLabel(format: ExportFormat, batch: { frames: number } | null): string {
  if (!batch) return `Export ${FORMAT_SPECS[format].label}`;
  if (format === 'pdf') return `Export ${batch.frames}-page PDF`;
  return `Export ${batch.frames} ${FORMAT_SPECS[format].label} files`;
}

/** What `Area` can be. `view` is the visible area; `slides` is the deck, PDF only. */
export type Area = 'board' | 'selection' | 'frame' | 'view' | 'slides';

/** An error worth showing, rewritten as the fix where the cause is one we know. */
export function explainError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/quota|memory|allocation/i.test(message)) {
    return 'The browser ran out of memory for an image this large. Try a smaller scale, an area of the board, or SVG.';
  }
  if (/tainted|insecure|SecurityError/i.test(message)) {
    return 'An image on the board comes from a site that does not allow copying it. Remove or re-upload that image, or export as SVG.';
  }
  if (/timed? ?out/i.test(message)) return 'The export took too long. Try a smaller scale or fewer frames at a time.';
  return message || 'The export did not finish. Try again, or try a smaller scale.';
}

/** The size the fonts add, as words for the checkbox's hint. */
export function fontCostLabel(bytes: number | null): string {
  if (bytes === null) return 'Measuring the fonts…';
  if (bytes === 0) return 'This text uses no app fonts that need embedding.';
  return `Adds about ${formatBytes(bytes)} to the file.`;
}
