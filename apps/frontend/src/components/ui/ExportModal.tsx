import React, { useEffect, useRef, useState } from 'react';
import {
  X, Download, CheckCircle2, Loader2, Copy, Layers, UploadCloud, AlertTriangle,
} from 'lucide-react';
import {
  ExportService,
  EXPORT_FORMAT_IDS,
  FORMAT_SPECS,
  exportFilename,
  type ExportBackground,
  type ExportFormat,
} from '../../engine/export';
import { parseDocumentExport, describeImport } from '../../engine/export/DocumentImport';
import { restoreDocument } from '../../engine/export/restoreDocument';
import { computeContentBounds } from '../../engine/export/bounds';
import { fitScale } from '../../engine/export/rasterLimits';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useStore } from '../../hooks/useStore';

interface Props {
  onClose: () => void;
  title: string;
}

/** Sentinel for "not a frame". An empty string would collide with a real id. */
const WHOLE_DOCUMENT = '__document__';
/** Sentinel for "each frame, as its own file". */
const EVERY_FRAME = '__frames__';

const SCALES = [1, 2, 3, 4];

const BACKGROUNDS: Array<{ id: ExportBackground; label: string }> = [
  { id: 'transparent', label: 'None' },
  { id: 'paper', label: 'White' },
  { id: 'ink', label: 'Dark' },
];

/** Bytes as something a person reads without counting digits. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Export, and the restore that makes it a backup.
 *
 * ## What changed
 *
 * Three formats became six, the settings became format-aware rather than a
 * hardcoded `format === 'png'` at each control, and two things were added that
 * the dialog had been implying without providing:
 *
 *  - **A preview.** Export was previously an act of faith: you picked options,
 *    pressed the button, and found out what you got by opening the file. The
 *    preview is rendered through the same path the export uses, so what you see
 *    is the export, not an approximation of it.
 *  - **Restore.** The JSON option described itself as "best for backups", and
 *    nothing in the app could read one back. A backup you cannot restore is not
 *    a backup, and the gap was invisible because exporting looked like it
 *    worked.
 *
 * Copy-to-clipboard is here for the same reason: the commonest thing anyone
 * does with an exported image is paste it somewhere, and every one of those
 * journeys used to detour through the downloads folder.
 */
export const ExportModal: React.FC<Props> = ({ onClose, title }) => {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string>(WHOLE_DOCUMENT);
  const [scale, setScale] = useState(2);
  const [quality, setQuality] = useState(0.92);
  const [background, setBackground] = useState<ExportBackground>('transparent');
  const [preview, setPreview] = useState<{ url: string; bytes: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  /** A validated file waiting for the user to say replace or add. */
  const [pendingRestore, setPendingRestore] = useState<{ summary: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useFocusTrap(true, onClose);
  const spec = FORMAT_SPECS[format];

  /**
   * Which formats the browser can show back to you.
   *
   * This was `spec.raster`, which left **SVG** — the one vector format, and the
   * one most likely to surprise you, since it is rebuilt from the document
   * rather than captured from the screen — as the only visual format with no
   * preview. An image element renders an SVG blob perfectly well; there was
   * never a technical reason, only the assumption that "previewable" and "made
   * of pixels" were the same question.
   */
  const previewable = spec.raster || format === 'svg';

  /**
   * A background is meaningful for anything that draws, which is everything
   * except the document dump. Gated on `spec.raster` before, so SVG offered no
   * background control at all — and now that the SVG exporter honours the
   * setting, hiding the control would leave it permanently transparent.
   */
  const paintsBackground = format !== 'json';

  const objects = useStore((s) => s.objects);
  const frameList = React.useMemo(
    () =>
      Object.values(objects)
        .filter((n) => n.type === 'frame')
        .map((f) => ({ id: f.id, label: f.title ?? 'Frame', width: f.width, height: f.height }))
        // Sorted by name rather than by z-index: this is a list you find a name in.
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    [objects]
  );
  const activeFrame = frameList.find((f) => f.id === target);
  const isBatch = target === EVERY_FRAME;

  /** The document's own extent, for the size readout and the clamp warning. */
  const contentBounds = React.useMemo(() => computeContentBounds(objects), [objects]);

  const baseOptions = () => ({
    scale,
    quality,
    background,
    frameId: activeFrame ? target : undefined,
    stage: (window as any)._konva_stage,
  });

  /**
   * Render a preview whenever the settings change.
   *
   * Debounced, because dragging the quality slider would otherwise re-render
   * the whole document on every pixel of travel. Cancelled on unmount and
   * superseded on each change, so a slow export cannot land after a newer one
   * and show a stale image.
   */
  useEffect(() => {
    if (!previewable || isBatch) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = window.setTimeout(async () => {
      try {
        const blob = await ExportService.render(format, { ...baseOptions(), scale: 1 });
        if (cancelled) return;
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { url: URL.createObjectURL(blob), bytes: blob.size };
        });
      } catch {
        // A preview that cannot be produced is not an error worth interrupting
        // for — the export button will report it properly if it is real.
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, target, quality, background, previewable, isBatch]);

  // The object URL outlives React's own cleanup unless it is revoked by hand.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  /**
   * The preview is rendered at 1×; the file is not.
   *
   * A lossy encoder's output does not scale linearly with pixel count, but it
   * is close enough over this range that the estimate is useful — and it is
   * labelled as an estimate rather than presented as the answer.
   */
  const estimatedBytes = preview ? preview.bytes * (spec.raster ? scale * scale : 1) : null;

  /**
   * Whether the browser will actually honour the chosen density.
   *
   * `captureRaster` silently reduces the scale when the canvas would exceed
   * what the browser can allocate, which is right — a smaller image beats a
   * blank one — but it happened invisibly, so picking 4× on a large board
   * produced a file quietly smaller than the label promised. Asking the same
   * function the export asks means the warning cannot disagree with what is
   * about to happen.
   */
  const exportBox = activeFrame
    ? { width: activeFrame.width, height: activeFrame.height }
    : contentBounds;
  const effectiveScale = spec.raster
    ? fitScale(exportBox.width, exportBox.height, scale)
    : scale;
  const scaleClamped = spec.raster && effectiveScale < scale - 1e-6;

  const handleExport = async () => {
    setIsExporting(true);
    setStatus(null);
    setError(null);
    try {
      if (isBatch && format === 'pdf') {
        /**
         * PDF is one document, not a folder of them.
         *
         * Every other format has to save a file per frame because there is no
         * such thing as a multi-frame PNG. A PDF has pages, and the exporter
         * turns each frame into one — so looping here would produce N
         * single-page documents where the format's own answer is one document
         * of N pages.
         */
        await ExportService.export(format, {
          ...baseOptions(),
          frameId: undefined,
          filename: exportFilename(title, format, scale),
        });
        setStatus(`Saved ${frameList.length} pages`);
      } else if (isBatch) {
        // Saved one at a time rather than zipped: a ZIP would mean shipping a
        // compression library to bundle files the browser is perfectly willing
        // to save individually.
        for (const frame of frameList) {
          const blob = await ExportService.render(format, { ...baseOptions(), frameId: frame.id });
          ExportService.save(blob, exportFilename(frame.label, format, scale));
        }
        setStatus(`Saved ${frameList.length} files`);
      } else {
        const base = activeFrame?.label ?? title;
        await ExportService.export(format, {
          ...baseOptions(),
          filename: exportFilename(base, format, scale),
        });
        setStatus('Saved');
      }
      setTimeout(onClose, 1000);
    } catch (e) {
      // A blocking `alert()` here stole focus out of the dialog, could not be
      // read in context, and told the user nothing about what went wrong.
      setError(e instanceof Error ? e.message : 'Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopy = async () => {
    setError(null);
    try {
      await ExportService.copyToClipboard(baseOptions());
      setStatus('Copied to clipboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not copy to the clipboard.');
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    const result = parseDocumentExport(await file.text());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Held rather than applied. Replacing the board is irreversible from the
    // user's side, so it is described first and confirmed second.
    setPendingRestore({ summary: describeImport(result.document) });
    pendingDocRef.current = result;
  };

  const pendingDocRef = useRef<ReturnType<typeof parseDocumentExport> | null>(null);

  const confirmRestore = (mode: 'replace' | 'merge') => {
    const result = pendingDocRef.current;
    if (!result || !result.ok) return;
    const summary = restoreDocument(result.document, mode);
    setPendingRestore(null);
    pendingDocRef.current = null;
    // Threads are counted separately because they are restored separately —
    // and because saying "12 objects" for a board that also regained its
    // comment threads under-reports what just happened.
    const threads = summary.comments > 0
      ? ` and ${summary.comments} comment thread${summary.comments === 1 ? '' : 's'}`
      : '';
    setStatus(
      mode === 'replace'
        ? `Restored ${summary.added} objects${threads}`
        : `Added ${summary.added} objects${threads}`
    );
    setTimeout(onClose, 900);
  };

  return (
    <div className="export-scrim">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="export-title" className="export panel-surface">
        <header className="export__head">
          <div>
            <h2 id="export-title" className="export__title">Export</h2>
            <p className="export__subtitle">
              A copy you can share — or a backup you can restore.
            </p>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="export__body">
          {/* Left: what you will get. Rendered through the export path itself,
              so the preview is the export rather than a likeness of it. */}
          <div className="export__preview">
            {previewable && !isBatch ? (
              <>
                <div className={`export__canvas export__canvas--${background === 'ink' ? 'ink' : background === 'paper' ? 'paper' : 'checker'}`}>
                  {preview
                    ? <img src={preview.url} alt="Export preview" />
                    : <span className="export__preview-empty">{previewing ? 'Rendering…' : 'No preview'}</span>}
                  {previewing && <span className="export__preview-busy"><Loader2 size={14} /></span>}
                </div>
                <div className="export__meta">
                  <span>{spec.raster
                    ? `${Math.round(exportBox.width * effectiveScale)} × ${Math.round(exportBox.height * effectiveScale)}`
                    : 'Fits content'}</span>
                  {estimatedBytes !== null && <span>~{formatBytes(estimatedBytes)}</span>}
                </div>
                {scaleClamped && (
                  <p className="export__hint export__hint--warn">
                    <AlertTriangle size={12} aria-hidden="true" />
                    {` This board is too large for ${scale}× in a browser — it will export at ${effectiveScale.toFixed(2)}×.`}
                  </p>
                )}
              </>
            ) : (
              <div className="export__canvas export__canvas--flat">
                <span className="export__preview-empty">
                  {isBatch
                    ? format === 'pdf'
                      ? `One document, ${frameList.length} pages — a frame each`
                      : `${frameList.length} files, one per frame`
                    : `${spec.label} has no image preview`}
                </span>
              </div>
            )}
          </div>

          {/* Right: the settings, and only the ones this format actually has. */}
          <div className="export__controls">
            <div className="export__field">
              <span className="export__label">Format</span>
              <div className="export__formats" role="radiogroup" aria-label="Export format">
                {EXPORT_FORMAT_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={format === id}
                    className={`export__format ${format === id ? 'is-active' : ''}`}
                    onClick={() => setFormat(id)}
                    data-tooltip={FORMAT_SPECS[id].blurb}
                  >
                    {FORMAT_SPECS[id].label}
                  </button>
                ))}
              </div>
              <p className="export__hint">{spec.blurb}</p>
            </div>

            {frameList.length > 0 && (
              <label className="export__field">
                <span className="export__label">Region</span>
                <select className="export__select" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value={WHOLE_DOCUMENT}>Whole canvas</option>
                  <option value={EVERY_FRAME}>
                    {format === 'pdf'
                      ? `Every frame — ${frameList.length} pages, one document`
                      : `Every frame — ${frameList.length} files`}
                  </option>
                  {frameList.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label} — {Math.round(f.width)} × {Math.round(f.height)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {spec.raster && (
              <div className="export__field">
                <span className="export__label">Size</span>
                <div className="export__segmented" role="radiogroup" aria-label="Export scale">
                  {SCALES.map((s) => (
                    <button
                      key={s} type="button" role="radio" aria-checked={scale === s}
                      className={`export__segment ${scale === s ? 'is-active' : ''}`}
                      onClick={() => setScale(s)}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Shown for every format that can express one — and for JPEG and
                PDF, which cannot, "None" is honestly labelled as unavailable
                rather than silently producing a black backing. */}
            {paintsBackground && (
              <div className="export__field">
                <span className="export__label">Background</span>
                <div className="export__segmented" role="radiogroup" aria-label="Background">
                  {BACKGROUNDS.map((b) => {
                    const impossible = b.id === 'transparent' && !spec.alpha;
                    return (
                      <button
                        key={String(b.id)} type="button" role="radio"
                        aria-checked={background === b.id && !impossible}
                        disabled={impossible}
                        className={`export__segment ${background === b.id && !impossible ? 'is-active' : ''}`}
                        onClick={() => setBackground(b.id)}
                        data-tooltip={impossible ? `${spec.label} has no transparency` : undefined}
                      >
                        {b.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {spec.lossy && (
              <label className="export__field">
                <span className="export__label">
                  Quality <span className="export__value">{Math.round(quality * 100)}%</span>
                </span>
                <input
                  type="range" min={0.3} max={1} step={0.01} value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  aria-label="Quality"
                />
              </label>
            )}
          </div>
        </div>

        {/* The advisory. Shown once there is enough on the board to be worth
            losing, and phrased as what to do rather than as a warning. */}
        {Object.keys(objects).length > 4 && format !== 'json' && (
          <p className="export__advice">
            <AlertTriangle size={13} />
            Keeping a copy? Export as <button type="button" className="export__link" onClick={() => setFormat('json')}>JSON</button> — it is the only format that can be restored back into a board.
          </p>
        )}

        {error && <div role="alert" className="export__error">{error}</div>}
        {status && !error && <div className="export__status"><CheckCircle2 size={14} /> {status}</div>}

        {pendingRestore && (
          <div className="export__restore" role="group" aria-label="Restore options">
            <p className="export__restore-text">
              <strong>{pendingRestore.summary}</strong> — replace everything on this board, or add it alongside?
            </p>
            <div className="export__restore-actions">
              <button type="button" className="export__ghost" onClick={() => { setPendingRestore(null); pendingDocRef.current = null; }}>Cancel</button>
              <button type="button" className="export__ghost" onClick={() => confirmRestore('merge')}>Add alongside</button>
              <button type="button" className="export__danger" onClick={() => confirmRestore('replace')}>Replace board</button>
            </div>
          </div>
        )}

        <footer className="export__foot">
          <input
            ref={fileInputRef} type="file" accept="application/json,.json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
          />
          <button type="button" className="export__ghost" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud size={15} /> Restore…
          </button>

          <span className="export__spacer" />

          {spec.raster && !isBatch && ExportService.canCopy && (
            <button type="button" className="export__ghost" onClick={handleCopy}>
              <Copy size={15} /> Copy
            </button>
          )}
          <button type="button" className="export__primary" onClick={handleExport} disabled={isExporting}>
            {isExporting ? <Loader2 size={16} className="export__spin" /> : isBatch ? <Layers size={16} /> : <Download size={16} />}
            {isExporting ? 'Exporting…' : isBatch ? `Export ${frameList.length} files` : `Export ${spec.label}`}
          </button>
        </footer>
      </div>
    </div>
  );
};
