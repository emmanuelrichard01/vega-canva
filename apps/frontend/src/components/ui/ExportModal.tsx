import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  PenTool,
  RotateCw,
  UploadCloud,
} from 'lucide-react';
import { ExportService, FORMAT_SPECS, exportFilename, type ExportBackground, type ExportFormat } from '../../engine/export';
import { Slider } from './Slider';
import { SegmentedControl } from './SegmentedControl';
import { Dialog, DialogBody, DialogFooter, DialogHeader, useDialog } from './Dialog';
import { WorkspaceCover } from '../WorkspaceCover';
import { parseDocumentExport, describeImport, describeOrigin, isSameRoom } from '../../engine/export/DocumentImport';
import { restoreDocument } from '../../engine/export/restoreDocument';
import { computeContentBounds } from '../../engine/export/bounds';
import { exportScope, scopeOptions } from '../../engine/export/exportScope';
import { fitScale } from '../../engine/export/rasterLimits';
import { familiesInNodes, usesLocalFonts } from '../../engine/text/fontEmbed';
import { buildPreview } from '../../engine/model/boardPreview';
import { previewColorOf, previewPointsOf } from '../../engine/model/previewPaint';
import { descendantsOfFrame } from '../../engine/model/frames';
import { roomId } from '../../engine/document';
import { useStore } from '../../hooks/useStore';
import { storageGetJson, storageSet } from '../../utils/safeStorage';
import {
  BACKGROUNDS,
  FORMAT_CARDS,
  PADDINGS,
  SCALES,
  cardFor,
  estimateBytes,
  exportLabel,
  formatBytes,
  pixelSize,
  prefsKey,
  previewFormat,
  sanitizePrefs,
  type ExportPrefs,
  type FormatCardId,
} from './exportModel';
import './exportDialog.css';

interface Props {
  onClose: () => void;
  title: string;
  /** The format to open on, when the dialog was asked for a particular one. Otherwise the board's last. */
  initialFormat?: ExportFormat;
  /** What is selected on the canvas, offered as an area. */
  selectionIds?: string[];
  /**
   * Whether to open on that selection. The right-click entry and
   * Ctrl+Shift+E ask about the selection; the header's Export asks about the
   * board even when something happens to be selected.
   */
  startWithSelection?: boolean;
}

type Area = 'board' | 'selection' | 'frame';

/** Sentinel for "each frame, as its own file (or page)". */
const EVERY_FRAME = '__frames__';

const CARD_ICON: Record<FormatCardId, typeof ImageIcon> = {
  image: ImageIcon,
  svg: PenTool,
  pdf: FileText,
  json: Archive,
};

/** Frames drawn as thumbnails, at most; a board with more lists the rest by name. */
const THUMBS = 24;

export const ExportModal: React.FC<Props> = (props) => (
  <Dialog onClose={props.onClose} size="lg" className="ex">
    <ExportBody {...props} />
  </Dialog>
);

const ExportBody: React.FC<Props> = ({ title, selectionIds = [], startWithSelection = false, initialFormat }) => {
  const { close } = useDialog();
  const saved = useMemo<ExportPrefs>(() => sanitizePrefs(storageGetJson(prefsKey(roomId), null)), []);

  const [format, setFormat] = useState<ExportFormat>(initialFormat ?? saved.format);
  const [scale, setScale] = useState(saved.scale);
  const [quality, setQuality] = useState(saved.quality);
  const [background, setBackground] = useState<ExportBackground>(saved.background);
  const [padding, setPadding] = useState(saved.padding);
  const [embedLocalFonts, setEmbedLocalFonts] = useState(saved.embedLocalFonts);
  const [area, setArea] = useState<Area>(startWithSelection && selectionIds.length > 0 ? 'selection' : 'board');
  const [frameChoice, setFrameChoice] = useState<string>(EVERY_FRAME);

  const [busy, setBusy] = useState<null | 'export' | 'copy'>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; retry?: () => void } | null>(null);
  const [preview, setPreview] = useState<{ url: string; bytes: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<{
    summary: string;
    origin: string | null;
    sameRoom: boolean;
    warnings: string[];
  } | null>(null);
  const pendingDocRef = useRef<ReturnType<typeof parseDocumentExport> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const spec = FORMAT_SPECS[format];
  const card = cardFor(format);
  const objects = useStore((s) => s.objects);

  const frames = useMemo(() => {
    const all = Object.values(objects);
    return all
      .filter((n) => n.type === 'frame' && !n.hidden)
      .map((f) => ({ id: f.id, label: f.title?.trim() || 'Frame', width: f.width, height: f.height }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [objects]);

  /** Each frame's picture, drawn from the same summary the board cards use. */
  const thumbs = useMemo(() => {
    const all = Object.values(objects);
    const out = new Map<string, ReturnType<typeof buildPreview>>();
    for (const f of frames.slice(0, THUMBS)) {
      const ids = new Set([f.id, ...descendantsOfFrame(f.id, all)]);
      const nodes = all.filter((n) => ids.has(n.id));
      out.set(f.id, buildPreview(nodes, previewColorOf, (node) => previewPointsOf(node, objects)));
    }
    return out;
  }, [frames, objects]);

  // The frame picked, or every frame when the one picked has gone.
  useEffect(() => {
    if (frameChoice !== EVERY_FRAME && !frames.some((f) => f.id === frameChoice)) setFrameChoice(EVERY_FRAME);
    if (area === 'frame' && frames.length === 0) setArea('board');
  }, [frames, frameChoice, area]);

  /**
   * The selection, resolved the way the right-click copy resolves it, so a
   * selected frame exports its contents here as it does there.
   */
  const scope = useMemo(() => exportScope(objects, selectionIds, title), [objects, selectionIds, title]);
  const hasSelection = !scope.wholeBoard;

  // A selection that empties while the dialog is open (someone deletes it)
  // falls back to the board rather than exporting an empty box.
  useEffect(() => {
    if (area === 'selection' && !hasSelection) setArea('board');
  }, [area, hasSelection]);

  const isBatch = area === 'frame' && frameChoice === EVERY_FRAME && frames.length > 0;
  const activeFrame = area === 'frame' ? frames.find((f) => f.id === frameChoice) : undefined;
  const isSelection = area === 'selection' && hasSelection;

  /** A format with no alpha channel cannot be left clear; it is honestly white. */
  const bg: ExportBackground = background === 'transparent' && !spec.alpha ? 'paper' : background;

  /** Fonts only this device has, among what is being exported. Only SVG can carry them. */
  const scopeNodes = useMemo(() => {
    if (isSelection && scope.ids) return scope.ids.map((id) => objects[id]).filter(Boolean);
    if (activeFrame) {
      const all = Object.values(objects);
      const ids = new Set([activeFrame.id, ...descendantsOfFrame(activeFrame.id, all)]);
      return all.filter((n) => ids.has(n.id));
    }
    return Object.values(objects);
  }, [objects, isSelection, scope.ids, activeFrame]);
  const localFonts = useMemo(() => usesLocalFonts(familiesInNodes(scopeNodes)), [scopeNodes]);
  const offerFontEmbed = format === 'svg' && localFonts;

  const baseOptions = () => ({
    scale,
    quality,
    background: bg,
    padding,
    embedLocalFonts: offerFontEmbed && embedLocalFonts,
    frameId: activeFrame ? activeFrame.id : undefined,
    // Both halves or neither: `selectedOnly` without `selectedIds` is the shape
    // that captured everything else inside the frame.
    ...(isSelection ? scopeOptions(scope) : {}),
    stage: (window as unknown as { _konva_stage?: unknown })._konva_stage,
  });

  /**
   * The preview, rendered through the export path itself at 1×.
   *
   * Debounced so dragging the quality slider does not render the board on
   * every pixel, and superseded on each change so a slow render cannot land
   * after a newer one. Each render takes and gives back its own `renderScope`
   * hold inside the exporter; the dialog never holds one, so an export pressed
   * while a preview is in flight cannot be un-mounted by it.
   */
  const shownAs = previewFormat(format);
  const scopeKey = scope.ids?.join(',');
  useEffect(() => {
    if (!shownAs || isBatch) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = window.setTimeout(async () => {
      try {
        const blob = await ExportService.render(shownAs, { ...baseOptions(), scale: 1 });
        if (cancelled) return;
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { url: URL.createObjectURL(blob), bytes: blob.size };
        });
      } catch {
        // A preview that cannot be made is not worth interrupting for; Export
        // reports the real failure if there is one.
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
  }, [shownAs, area, frameChoice, quality, bg, padding, isBatch, isSelection, scopeKey, embedLocalFonts, offerFontEmbed]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  /** The box the size readout describes, measured as the exporter will measure it. */
  const exportBox = activeFrame
    ? { width: activeFrame.width, height: activeFrame.height }
    : computeContentBounds(objects, isSelection ? scope.ids ?? undefined : undefined, padding);
  const effectiveScale = spec.raster ? fitScale(exportBox.width, exportBox.height, scale) : 1;
  const scaleClamped = spec.raster && effectiveScale < scale - 1e-6;
  const estimate = estimateBytes(format, preview?.bytes ?? null, scale);

  const remember = () => {
    storageSet(prefsKey(roomId), JSON.stringify({ format, scale, background, padding, quality, embedLocalFonts } satisfies ExportPrefs));
  };

  const handleExport = async () => {
    setBusy('export');
    setStatus(null);
    setError(null);
    setProgress(null);
    try {
      if (isBatch && format === 'pdf') {
        // One document of N pages, not N documents: the PDF exporter makes a
        // page of each frame.
        await ExportService.export(format, { ...baseOptions(), frameId: undefined, filename: exportFilename(title, format, scale) });
        setStatus(`Saved a ${frames.length}-page PDF`);
      } else if (isBatch) {
        // One file per frame, saved as each is made, so a long run shows
        // progress and a failure keeps what was already saved.
        setProgress({ done: 0, total: frames.length });
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          const blob = await ExportService.render(format, { ...baseOptions(), frameId: frame.id });
          ExportService.save(blob, exportFilename(frame.label, format, scale));
          setProgress({ done: i + 1, total: frames.length });
        }
        setStatus(`Saved ${frames.length} files`);
      } else {
        const base = activeFrame?.label ?? (isSelection ? scope.filenameBase : title);
        await ExportService.export(format, { ...baseOptions(), filename: exportFilename(base, format, scale) });
        setStatus('Saved');
      }
      remember();
      window.setTimeout(close, 900);
    } catch (e) {
      setError({
        message: e instanceof Error && e.message ? e.message : 'The export did not finish.',
        retry: () => void handleExport(),
      });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  /** Copy, in whichever clipboard format matches the choice: SVG as SVG, everything else as an image. */
  const handleCopy = async () => {
    setBusy('copy');
    setError(null);
    setStatus(null);
    try {
      const result = await ExportService.copy(format === 'svg' ? 'svg' : 'png', baseOptions());
      if (result.ok) {
        setStatus(format === 'svg' ? 'SVG copied' : 'Image copied');
        remember();
      } else setError({ message: result.message ?? 'Could not copy to the clipboard.', retry: () => void handleCopy() });
    } finally {
      setBusy(null);
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    const result = parseDocumentExport(await file.text());
    if (!result.ok) {
      setError({ message: result.error });
      return;
    }
    // Held, not applied: replacing a board is described first and confirmed
    // second. `roomId` from the document layer, because an invite opens
    // `/i/<token>` where the path holds no room id.
    setPendingRestore({
      summary: describeImport(result.document),
      origin: describeOrigin(result.document),
      sameRoom: isSameRoom(result.document, roomId),
      warnings: result.warnings,
    });
    pendingDocRef.current = result;
  };

  const confirmRestore = (mode: 'replace' | 'merge') => {
    const result = pendingDocRef.current;
    if (!result || !result.ok) return;
    const summary = restoreDocument(result.document, mode);
    setPendingRestore(null);
    pendingDocRef.current = null;
    const threads =
      summary.comments > 0 ? ` and ${summary.comments} comment thread${summary.comments === 1 ? '' : 's'}` : '';
    setStatus(mode === 'replace' ? `Restored ${summary.added} objects${threads}` : `Added ${summary.added} objects${threads}`);
    window.setTimeout(close, 900);
  };

  const pickCard = (id: FormatCardId) => {
    if (id === card.id) return;
    const next = FORMAT_CARDS.find((c) => c.id === id)!;
    setFormat(next.formats[0]);
  };

  const canCopy = (spec.raster || format === 'svg') && format !== 'pdf' && !isBatch && ExportService.canCopy;
  const checker = bg === 'transparent' && shownAs !== null;
  const objectCount = Object.keys(objects).length;

  return (
    <>
      <DialogHeader title="Export" description="A copy to share, or a backup you can restore." />

      <DialogBody className="ex__body">
        {/* What you will get, rendered through the export path itself. */}
        <div className="ex-preview">
          <div className={`ex-preview__canvas ex-preview__canvas--${checker ? 'checker' : bg === 'ink' ? 'ink' : shownAs ? 'paper' : 'flat'}`}>
            {shownAs && !isBatch ? (
              preview ? (
                <img src={preview.url} alt="Preview of the export" />
              ) : (
                <span className="ex-preview__empty">{previewing ? 'Rendering…' : 'No preview for this area'}</span>
              )
            ) : (
              <span className="ex-preview__empty">
                {format === 'json' ? (
                  <>
                    <Archive size={22} aria-hidden="true" />
                    {`Every object on the board, ${objectCount.toLocaleString()} in all, as a file only this app reads.`}
                  </>
                ) : format === 'pdf' ? (
                  <>
                    <Layers size={22} aria-hidden="true" />
                    {`One document, ${frames.length} pages, a frame on each.`}
                  </>
                ) : (
                  <>
                    <Layers size={22} aria-hidden="true" />
                    {`${frames.length} files, one for each frame.`}
                  </>
                )}
              </span>
            )}
            {previewing && preview && (
              <span className="ex-preview__busy" aria-hidden="true">
                <Loader2 size={14} className="dlg-spin" />
              </span>
            )}
          </div>
          <div className="ex-preview__meta" aria-live="polite">
            <span>
              {format === 'json'
                ? 'Backup file'
                : spec.raster && !isBatch
                  ? `${pixelSize(exportBox, effectiveScale)} px`
                  : isBatch
                    ? `${frames.length} frames`
                    : 'Vector, any size'}
            </span>
            {estimate !== null && !isBatch && <span>About {formatBytes(estimate)}</span>}
          </div>
          {scaleClamped && (
            <p className="ex-warn">
              <AlertTriangle size={13} aria-hidden="true" />
              Too large for {scale}× in a browser. It will export at {effectiveScale.toFixed(2)}×.
            </p>
          )}
        </div>

        {/* The settings, and only the ones this format has. */}
        <div className="ex-controls">
          <fieldset className="ex-field">
            <legend className="ex-label">Format</legend>
            <div className="ex-cards" role="radiogroup" aria-label="Format">
              {FORMAT_CARDS.map((c, i) => {
                const Icon = CARD_ICON[c.id];
                const checked = card.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    className="ex-card"
                    onClick={() => pickCard(c.id)}
                    onKeyDown={(e) => {
                      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                      if (!step) return;
                      e.preventDefault();
                      const next = FORMAT_CARDS[(i + step + FORMAT_CARDS.length) % FORMAT_CARDS.length];
                      pickCard(next.id);
                      (e.currentTarget.parentElement?.children[FORMAT_CARDS.indexOf(next)] as HTMLElement | undefined)?.focus();
                    }}
                  >
                    <span className="ex-card__head">
                      <Icon size={15} aria-hidden="true" />
                      <span className="ex-card__label">{c.label}</span>
                      {checked && <Check size={14} className="ex-card__check" aria-hidden="true" />}
                    </span>
                    <span className="ex-card__detail">{c.detail}</span>
                  </button>
                );
              })}
            </div>
            {card.id === 'image' && (
              <div className="ex-row">
                <span className="ex-row__label" id="ex-encoding">
                  Encoding
                </span>
                <SegmentedControl
                  ariaLabel="Image encoding"
                  value={format}
                  onChange={(v) => setFormat(v as ExportFormat)}
                  segments={card.formats.map((f) => ({ value: f, label: FORMAT_SPECS[f].label, hint: FORMAT_SPECS[f].blurb }))}
                />
              </div>
            )}
            {card.id === 'image' && <p className="ex-hint">{spec.blurb}</p>}
            {format !== 'json' && objectCount > 4 && (
              <p className="ex-hint">
                Only a{' '}
                <button type="button" className="ex-link" onClick={() => setFormat('json')}>
                  backup
                </button>{' '}
                can be restored into a board. Use one if this copy is for safekeeping.
              </p>
            )}
          </fieldset>

          {format !== 'json' && (
            <fieldset className="ex-field">
              <legend className="ex-label">Area</legend>
              <SegmentedControl
                ariaLabel="What to export"
                fill
                value={area}
                onChange={(v) => setArea(v as Area)}
                segments={[
                  { value: 'board', label: 'Whole board' },
                  ...(hasSelection ? [{ value: 'selection', label: scope.count === 1 ? 'Selection' : `Selection (${scope.count})` }] : []),
                  ...(frames.length > 0 ? [{ value: 'frame', label: frames.length === 1 ? 'Frame' : 'Frames' }] : []),
                ]}
              />
              {area === 'frame' && frames.length > 0 && (
                <div className="ex-frames" role="radiogroup" aria-label="Which frame">
                  <FrameTile
                    checked={frameChoice === EVERY_FRAME}
                    onPick={() => setFrameChoice(EVERY_FRAME)}
                    label={format === 'pdf' ? `All ${frames.length}, one PDF` : `All ${frames.length}, a file each`}
                    every
                  />
                  {frames.map((f) => (
                    <FrameTile
                      key={f.id}
                      checked={frameChoice === f.id}
                      onPick={() => setFrameChoice(f.id)}
                      label={f.label}
                      size={`${Math.round(f.width)} × ${Math.round(f.height)}`}
                      id={f.id}
                      preview={thumbs.get(f.id)}
                    />
                  ))}
                </div>
              )}
            </fieldset>
          )}

          {spec.raster && (
            <div className="ex-row">
              <span className="ex-row__label">Scale</span>
              <SegmentedControl
                ariaLabel="Scale"
                value={String(scale)}
                onChange={(v) => setScale(Number(v))}
                segments={SCALES.map((s) => ({ value: String(s), label: `${s}×` }))}
              />
            </div>
          )}

          {format !== 'json' && (
            <div className="ex-row">
              <span className="ex-row__label">Background</span>
              <SegmentedControl
                ariaLabel="Background"
                value={String(bg)}
                onChange={(v) => setBackground(v as ExportBackground)}
                segments={BACKGROUNDS.filter((b) => b.id !== 'transparent' || spec.alpha).map((b) => ({ value: String(b.id), label: b.label }))}
              />
            </div>
          )}
          {format !== 'json' && !spec.alpha && <p className="ex-hint ex-hint--tight">{spec.label} has no transparency, so the background is always painted.</p>}

          {format !== 'json' && !activeFrame && !isBatch && (
            <div className="ex-row">
              <span className="ex-row__label">Padding</span>
              <SegmentedControl
                ariaLabel="Padding around the content"
                value={String(padding)}
                onChange={(v) => setPadding(Number(v))}
                segments={PADDINGS.map((p) => ({ value: String(p.value), label: p.label }))}
              />
            </div>
          )}

          {spec.lossy && format !== 'pdf' && (
            <div className="ex-field">
              <Slider
                label="Quality"
                value={quality}
                min={0.3}
                max={1}
                step={0.01}
                ticks={[0.6, 0.8]}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={setQuality}
                hint="Lower makes a smaller file with softer detail."
              />
            </div>
          )}

          {offerFontEmbed && (
            <label className="ex-check">
              <input type="checkbox" checked={embedLocalFonts} onChange={(e) => setEmbedLocalFonts(e.target.checked)} />
              <span>
                <span className="ex-check__label">Embed fonts from this device</span>
                <span className="ex-check__hint">
                  Some text uses fonts installed on this computer. Embedding them makes the SVG look right anywhere. Check the
                  font’s licence before sharing it.
                </span>
              </span>
            </label>
          )}
        </div>
      </DialogBody>

      <DialogFooter className="ex__foot">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        <button type="button" className="dlg-btn" onClick={() => fileInputRef.current?.click()}>
          <UploadCloud size={15} aria-hidden="true" /> Restore a backup…
        </button>

        <span className="ex-said" role="status" aria-live={error ? 'assertive' : 'polite'}>
          {error ? (
            <span className="ex-said__bad">
              <AlertTriangle size={13} aria-hidden="true" />
              <span className="ex-said__text">{error.message}</span>
              {error.retry && (
                <button type="button" className="dlg-btn ex-said__retry" onClick={error.retry}>
                  <RotateCw size={13} aria-hidden="true" /> Try again
                </button>
              )}
            </span>
          ) : progress ? (
            <span className="ex-said__progress">
              <span className="ex-said__text">
                Exporting {progress.done + (progress.done < progress.total ? 1 : 0)} of {progress.total}
              </span>
              <span className="ex-bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${progress.done / Math.max(1, progress.total)})` }} />
              </span>
            </span>
          ) : status ? (
            <span className="ex-said__ok">
              <CheckCircle2 size={13} aria-hidden="true" />
              <span className="ex-said__text">{status}</span>
            </span>
          ) : null}
        </span>

        {canCopy && (
          <button type="button" className="dlg-btn dlg-btn--lg" onClick={() => void handleCopy()} disabled={busy !== null}>
            {busy === 'copy' ? <Loader2 size={15} className="dlg-spin" aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            {format === 'svg' ? 'Copy SVG' : 'Copy image'}
          </button>
        )}
        <button type="button" className="dlg-btn dlg-btn--lg dlg-btn--primary" onClick={() => void handleExport()} disabled={busy !== null}>
          {busy === 'export' ? (
            <Loader2 size={15} className="dlg-spin" aria-hidden="true" />
          ) : isBatch ? (
            <Layers size={15} aria-hidden="true" />
          ) : (
            <Download size={15} aria-hidden="true" />
          )}
          {busy === 'export' ? 'Exporting…' : exportLabel(format, isBatch ? { frames: frames.length } : null)}
        </button>
      </DialogFooter>

      {/* Replacing a board cannot be undone from here, so it is its own question. */}
      {pendingRestore && (
        <Dialog
          role="alertdialog"
          size="sm"
          className="ex-confirm"
          onClose={() => {
            setPendingRestore(null);
            pendingDocRef.current = null;
          }}
        >
          <RestoreQuestion pending={pendingRestore} onAnswer={confirmRestore} />
        </Dialog>
      )}
    </>
  );
};

const FrameTile: React.FC<{
  checked: boolean;
  onPick: () => void;
  label: string;
  size?: string;
  id?: string;
  preview?: ReturnType<typeof buildPreview>;
  every?: boolean;
}> = ({ checked, onPick, label, size, id, preview, every }) => (
  <button
    type="button"
    role="radio"
    aria-checked={checked}
    className="ex-frame"
    onClick={onPick}
    aria-label={size ? `${label}, ${size}` : label}
  >
    <span className="ex-frame__pic" aria-hidden="true">
      {every ? <Layers size={18} /> : <WorkspaceCover workspaceId={`export-frame:${id}`} name={label} preview={preview ?? null} />}
    </span>
    <span className="ex-frame__label">{label}</span>
    {size && <span className="ex-frame__size">{size}</span>}
  </button>
);

const RestoreQuestion: React.FC<{
  pending: { summary: string; origin: string | null; sameRoom: boolean; warnings: string[] };
  onAnswer: (mode: 'replace' | 'merge') => void;
}> = ({ pending, onAnswer }) => {
  const { close } = useDialog();
  return (
    <>
      <DialogHeader
        title={pending.origin ?? 'This backup'}
        description={`${pending.summary}${pending.origin ? (pending.sameRoom ? ', a backup of this board' : ', from a different board') : ''}`}
      />
      <DialogBody>
        <p className="ex-confirm__text">
          Replacing clears this board first. Adding keeps everything here and places the backup alongside it.
        </p>
        {pending.warnings.length > 0 && (
          <details className="ex-skipped">
            <summary>
              {pending.warnings.length === 1
                ? '1 item in this file cannot be restored'
                : `${pending.warnings.length} items in this file cannot be restored`}
            </summary>
            <ul>
              {pending.warnings.slice(0, 12).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {pending.warnings.length > 12 && <li>and {pending.warnings.length - 12} more.</li>}
            </ul>
          </details>
        )}
      </DialogBody>
      <DialogFooter>
        <button type="button" className="dlg-btn" onClick={close}>
          Cancel
        </button>
        <span className="ex-spacer" />
        <button type="button" className="dlg-btn dlg-btn--outline" onClick={() => onAnswer('merge')}>
          Add alongside
        </button>
        <button type="button" className="dlg-btn dlg-btn--danger" onClick={() => onAnswer('replace')}>
          Replace board
        </button>
      </DialogFooter>
    </>
  );
};
