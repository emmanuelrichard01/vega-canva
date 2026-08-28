export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'svg' | 'pdf' | 'json';

/**
 * What sits behind the artwork.
 *
 * `transparent` is a real answer for PNG and WebP and an impossible one for
 * JPEG, which has no alpha channel at all. Rather than letting the two
 * disagree, `resolveBackground` collapses transparent to the paper colour for
 * formats that cannot express it, and the UI says so instead of producing a
 * silently black-backed image — which is what an unhandled transparent JPEG
 * looks like.
 */
export type ExportBackground = 'transparent' | 'paper' | 'ink' | string;

export interface ExportOptions {
  filename?: string;
  scale?: number;
  /** 0..1, for the lossy formats. Ignored by PNG, SVG and JSON. */
  quality?: number;
  background?: ExportBackground;
  /** World units of breathing room around the content. Frames ignore this. */
  padding?: number;
  stage?: any; // Konva Stage reference for raster exports
  bounds?: { x: number; y: number; width: number; height: number };
  selectedOnly?: boolean;
  selectedIds?: string[];
  /**
   * Export one frame instead of the whole document.
   *
   * Resolved by `resolveExportTarget`, which fills in `bounds` from the
   * frame's own rectangle and `selectedIds` from its contents — so the
   * exporters need no knowledge of frames at all, and the formats cannot
   * disagree about what "this frame" means.
   */
  frameId?: string;
}

export interface Exporter {
  type: ExportFormat;
  export(options: ExportOptions): Promise<Blob | string>;
}

/** Everything a caller needs to describe a format without a switch statement. */
export interface FormatSpec {
  id: ExportFormat;
  label: string;
  /** What it is good for, in one line. */
  blurb: string;
  extension: string;
  mime: string;
  /** Pixels, so scale applies and dimensions are meaningful. */
  raster: boolean;
  /** Lossy, so a quality control is real rather than decorative. */
  lossy: boolean;
  /** Can express an alpha channel. */
  alpha: boolean;
}

/**
 * The formats, described once.
 *
 * The modal used to carry its own hand-written list of three, with the
 * "which controls apply" logic spelled out as `format === 'png'` at each
 * control. Adding a format meant finding every one of those; missing one is
 * how you end up offering a quality slider for PNG.
 */
export const FORMAT_SPECS: Record<ExportFormat, FormatSpec> = {
  png: {
    id: 'png',
    label: 'PNG',
    blurb: 'Lossless pixels with transparency. The safe default for sharing.',
    extension: 'png',
    mime: 'image/png',
    raster: true,
    lossy: false,
    alpha: true,
  },
  jpeg: {
    id: 'jpeg',
    label: 'JPEG',
    blurb: 'Much smaller for photographic work. No transparency.',
    extension: 'jpg',
    mime: 'image/jpeg',
    raster: true,
    lossy: true,
    alpha: false,
  },
  webp: {
    id: 'webp',
    label: 'WebP',
    blurb: 'Smaller than PNG at the same quality, and keeps transparency.',
    extension: 'webp',
    mime: 'image/webp',
    raster: true,
    lossy: true,
    alpha: true,
  },
  svg: {
    id: 'svg',
    label: 'SVG',
    blurb: 'Vector shapes that stay sharp at any size. Opens in Illustrator or Figma.',
    extension: 'svg',
    mime: 'image/svg+xml',
    raster: false,
    lossy: false,
    alpha: true,
  },
  pdf: {
    id: 'pdf',
    label: 'PDF',
    blurb: 'A page at real dimensions, for printing or sending on.',
    extension: 'pdf',
    mime: 'application/pdf',
    raster: true,
    lossy: true,
    alpha: false,
  },
  json: {
    id: 'json',
    label: 'JSON',
    blurb: 'The document itself: every object, editable and restorable.',
    extension: 'json',
    mime: 'application/json',
    raster: false,
    lossy: false,
    alpha: true,
  },
};

export const EXPORT_FORMAT_IDS: ExportFormat[] = ['png', 'jpeg', 'webp', 'svg', 'pdf', 'json'];

/** Paper and ink, resolved to literal colours a canvas can actually paint. */
const PAPER = '#FFFFFF';
const INK = '#161616';

/**
 * The colour to paint behind the artwork, or `null` to leave it clear.
 *
 * A format with no alpha channel can never be left clear: asking a JPEG for
 * transparency does not produce a transparent JPEG, it produces whatever
 * happened to be in the buffer — usually black. So the request is honoured
 * where it is possible and quietly resolved to paper where it is not, which is
 * the answer everyone actually wants from a transparent JPEG.
 */
export function resolveBackground(
  background: ExportBackground | undefined,
  spec: FormatSpec
): string | null {
  const wanted = background ?? 'transparent';
  if (wanted === 'transparent') return spec.alpha ? null : PAPER;
  if (wanted === 'paper') return PAPER;
  if (wanted === 'ink') return INK;
  return wanted;
}
