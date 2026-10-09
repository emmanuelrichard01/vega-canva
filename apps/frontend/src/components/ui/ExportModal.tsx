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
  Link2,
  Loader2,
  PenTool,
  RotateCw,
  UploadCloud,
} from 'lucide-react';
import { ExportService, FORMAT_SPECS, exportFilename, type ExportBackground, type ExportFormat, type ExportOptions } from '../../engine/export';
import { Slider } from './Slider';
import { SegmentedControl } from './SegmentedControl';
import { Dialog, DialogBody, DialogFooter, DialogHeader, useDialog } from './Dialog';
import { WorkspaceCover } from '../WorkspaceCover';
import { parseDocumentExport, describeImport, describeOrigin, isSameRoom } from '../../engine/export/DocumentImport';
import { restoreDocument } from '../../engine/export/restoreDocument';
import { computeContentBounds, viewportBounds } from '../../engine/export/bounds';
import { exportScope, scopeOptions } from '../../engine/export/exportScope';
import { canTile, plannedScale } from '../../engine/export/rasterLimits';
import { abortError, isAbortError } from '../../engine/export/abort';
import { deckPages, exportDeckPdf } from '../../engine/export/slideDeckPdf';
import { familiesInNodes, usesLocalFonts } from '../../engine/text/fontEmbed';
import { buildPreview } from '../../engine/model/boardPreview';
import { previewColorOf, previewPointsOf } from '../../engine/model/previewPaint';
import { descendantsOfFrame } from '../../engine/model/frames';
import { roomId } from '../../engine/document';
import { useStore } from '../../hooks/useStore';
import { storageGetJson, storageSet } from '../../utils/safeStorage';
import { frameLink } from '../export/frameLink';
import {
  BACKGROUNDS,
  FORMAT_CARDS,
  PADDINGS,
  SCALES,
  cardFor,
  estimateBytes,
  explainError,
  exportLabel,
  fontCostLabel,
  formatBytes,
  pixelSize,
  prefsKey,
  previewFormat,
  sanitizePrefs,
  type Area,
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
  /** Open on the slide deck, as the slide view's Export asks. Falls back to the board when there is no deck or the format is not PDF. */
  initialArea?: 'slides';
}

/** Sentinel for "each frame, as its own file (or page)". */
const EVERY_FRAME = '__frames__';
/** Sentinel for "the selected frames, each its own file (or page)". */
const SELECTED_FRAMES = '__selected__';

const CARD_ICON: Record<FormatCardId, typeof ImageIcon> = {
  image: ImageIcon,
  svg: PenTool,
  pdf: FileText,
  json: Archive,
};

/** Frames drawn as thumbnails, at most; a board with more lists the rest by name. */
const THUMBS = 24;

type StageLike = Parameters<typeof viewportBounds>[0];
const stageOf = () => (window as unknown as { _konva_stage?: StageLike })._konva_stage;

export const ExportModal: React.FC<Props> = (props) => (
  <Dialog onClose={props.onClose} size="lg" className="ex">
    <ExportBody {...props} />
  </Dialog>
);

const ExportBody: React.FC<Props> = ({ title, selectionIds = [], startWithSelection = false, initialFormat, initialArea }) => {
  const { close } = useDialog();
  const saved = useMemo<ExportPrefs>(() => sanitizePrefs(storageGetJson(prefsKey(roomId), null)), []);

  const [format, setFormat] = useState<ExportFormat>(initialFormat ?? saved.format);
  const [scale, setScale] = useState(saved.scale);
  const [quality, setQuality] = useState(saved.quality);
  const [background, setBackground] = useState<ExportBackground>(saved.background);
  const [padding, setPadding] = useState(saved.padding);
  const [embedLocalFonts, setEmbedLocalFonts] = useState(saved.embedLocalFonts);
  const [embedFonts, setEmbedFonts] = useState(saved.embedFonts);
  const [outlineText, setOutlineText] = useState(saved.outlineText);
  const [includeComments, setIncludeComments] = useState(saved.includeComments);
  const [area, setArea] = useState<Area>(initialArea ?? (startWithSelection && selectionIds.length > 0 ? 'selection' : 'board'));
  const [frameChoice, setFrameChoice] = useState<string>(EVERY_FRAME);

  const [busy, setBusy] = useState<null | 'export' | 'copy'>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; retry?: () => void } | null>(null);
  const [preview, setPreview] = useState<{ url: string; bytes: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [fonts, setFonts] = useState<{ bytes: number; missing: string[] } | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{
    summary: string;
    origin: string | null;
    sameRoom: boolean;
    warnings: string[];
  } | null>(null);
  const pendingDocRef = useRef<ReturnType<typeof parseDocumentExport> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runRef = useRef<AbortController | null>(null);

  // Closing the dialog stops a long export between its steps.
  useEffect(() => () => runRef.current?.abort(), []);

  const spec = FORMAT_SPECS[format];
  const card = cardFor(format);
  const objects = useStore((s) => s.objects);
  const stage = stageOf();

  const frames = useMemo(() => {
    const all = Object.values(objects);
    return all
      .filter((n) => n.type === 'frame' && !n.hidden)
      .map((f) => ({ id: f.id, label: f.title?.trim() || 'Frame', width: f.width, height: f.height }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [objects]);

  /** The deck as it is presented: skipped slides out, nested frames part of their slide. */
  const deck = useMemo(() => deckPages(objects), [objects]);

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

  /** Frames among the selection, offered as their own batch. */
  const selectedFrames = useMemo(() => {
    const picked = new Set(selectionIds);
    return frames.filter((f) => picked.has(f.id));
  }, [frames, selectionIds]);

  // The frame picked, or every frame when the one picked has gone.
  useEffect(() => {
    const gone =
      (frameChoice === SELECTED_FRAMES && selectedFrames.length < 2) ||
      (frameChoice !== EVERY_FRAME && frameChoice !== SELECTED_FRAMES && !frames.some((f) => f.id === frameChoice));
    if (gone) setFrameChoice(EVERY_FRAME);
    if (area === 'frame' && frames.length === 0) setArea('board');
    if (area === 'slides' && (format !== 'pdf' || deck.length === 0)) setArea('board');
  }, [frames, frameChoice, selectedFrames.length, area, format, deck.length]);

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

  const batchFrames =
    area === 'frame' ? (frameChoice === EVERY_FRAME ? frames : frameChoice === SELECTED_FRAMES ? selectedFrames : []) : [];
  const isBatch = batchFrames.length > 0;
  const isSlides = area === 'slides' && format === 'pdf' && deck.length > 0;
  const activeFrame = area === 'frame' && !isBatch ? frames.find((f) => f.id === frameChoice) : undefined;
  const isSelection = area === 'selection' && hasSelection;
  const isView = area === 'view' && Boolean(stage);

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
  const hasComments = useMemo(() => Object.values(objects).some((n) => n.type === 'comment' && !n.hidden), [objects]);

  const baseOptions = (): ExportOptions => ({
    scale,
    quality,
    background: bg,
    padding,
    embedLocalFonts: offerFontEmbed && embedLocalFonts,
    embedFonts: format === 'svg' && embedFonts,
    outlineText: format === 'svg' && outlineText,
    includeComments: hasComments && includeComments,
    // The deck's preview is its first slide.
    frameId: activeFrame ? activeFrame.id : isSlides ? deck[0].frameId : undefined,
    // Both halves or neither: `selectedOnly` without `selectedIds` is the shape
    // that captured everything else inside the frame.
    ...(isSelection ? scopeOptions(scope) : {}),
    ...(isView && stage ? { bounds: viewportBounds(stage) } : {}),
    stage,
  });

  /**
   * The preview, rendered through the export path itself at 1×.
   *
   * Debounced so dragging the quality slider does not render the board on
   * every pixel, and superseded on each change so a slow render cannot land
   * after a newer one. Each render takes and gives back its own `renderScope`
   * hold inside the exporter; the dialog never holds one, so an export pressed
   * while a preview is in flight cannot be un-mounted by it. An SVG preview
   * is rendered with the app's fonts embedded, which is how the dialog learns
   * what embedding costs before anyone ticks the box.
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
        let blob: Blob;
        let bytes: number;
        if (shownAs === 'svg') {
          const report = await ExportService.renderSvgReport({ ...baseOptions(), outlineText: false, embedFonts: true, scale: 1 });
          if (cancelled) return;
          setFonts({ bytes: report.fontBytes, missing: report.unembedded });
          blob = report.blob;
          bytes = embedFonts ? report.blob.size : report.blob.size - report.fontBytes;
        } else {
          blob = await ExportService.render(shownAs, { ...baseOptions(), scale: 1 });
          bytes = blob.size;
        }
        if (cancelled) return;
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { url: URL.createObjectURL(blob), bytes };
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
  }, [shownAs, area, frameChoice, quality, bg, padding, isBatch, isSelection, scopeKey, embedLocalFonts, offerFontEmbed, embedFonts, includeComments]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  /** The box the size readout describes, measured as the exporter will measure it. */
  const slide = isSlides ? deck[0] : undefined;
  const exportBox = activeFrame
    ? { width: activeFrame.width, height: activeFrame.height }
    : slide
      ? { width: slide.width, height: slide.height }
      : isView && stage
        ? viewportBounds(stage)
        : computeContentBounds(objects, isSelection ? scope.ids ?? undefined : undefined, padding);
  const plan = spec.raster
    ? plannedScale(exportBox.width, exportBox.height, scale, format === 'png' && canTile())
    : { scale: 1, tiled: false };
  const effectiveScale = isSlides ? 1 : plan.scale;
  const scaleClamped = spec.raster && !isSlides && effectiveScale < scale - 1e-6;
  const estimate = isSlides ? null : estimateBytes(format, preview?.bytes ?? null, effectiveScale);

  const remember = () => {
    storageSet(
      prefsKey(roomId),
      JSON.stringify({
        format,
        scale,
        background,
        padding,
        quality,
        embedLocalFonts,
        embedFonts,
        outlineText,
        includeComments,
      } satisfies ExportPrefs)
    );
  };

  const handleExport = async () => {
    if (busy) return;
    const controller = new AbortController();
    runRef.current = controller;
    const run = { signal: controller.signal, onProgress: (p: { done: number; total: number }) => setProgress(p) };
    setBusy('export');
    setStatus(null);
    setError(null);
    setProgress(null);
    try {
      if (isSlides) {
        // The deck as presented, through the slides' own writer.
        const blob = await exportDeckPdf(title, run.onProgress);
        if (controller.signal.aborted) throw abortError();
        ExportService.save(blob, exportFilename(`${title} slides`, 'pdf'));
        setStatus(`Saved a ${deck.length}-slide PDF`);
      } else if (isBatch && format === 'pdf') {
        // One document of N pages, not N documents.
        await ExportService.export(format, {
          ...baseOptions(),
          ...run,
          frameId: undefined,
          frameIds: batchFrames.map((f) => f.id),
          filename: exportFilename(title, format, scale),
        });
        setStatus(`Saved a ${batchFrames.length}-page PDF`);
      } else if (isBatch) {
        // One file per frame, named from its title, in a single ZIP.
        const result = await ExportService.exportFiles(
          batchFrames.map((frame) => ({
            format,
            options: { ...baseOptions(), frameId: frame.id },
            filename: exportFilename(frame.label, format, scale),
          })),
          { archiveName: `${exportFilename(`${title} frames`, 'svg').replace(/\.svg$/, '')}`, ...run }
        );
        setStatus(result.archive ? `Saved ${result.files} files in one ZIP` : 'Saved');
      } else {
        const base = activeFrame?.label ?? (isSelection ? scope.filenameBase : isView ? `${title} view` : title);
        await ExportService.export(format, { ...baseOptions(), ...run, filename: exportFilename(base, format, scale) });
        setStatus('Saved');
      }
      remember();
      window.setTimeout(close, 900);
    } catch (e) {
      if (isAbortError(e)) setStatus('Export cancelled');
      else setError({ message: explainError(e), retry: () => void handleExport() });
    } finally {
      runRef.current = null;
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

  /** A link that opens this board on the chosen frame. */
  const handleCopyLink = async () => {
    if (!activeFrame) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(frameLink(window.location.origin, roomId, activeFrame.id));
      setStatus('Link to this frame copied');
    } catch {
      setError({ message: 'The clipboard is blocked here. Allow clipboard access for this site, then try again.', retry: () => void handleCopyLink() });
    }
  };

  // Ctrl+Enter (⌘ on a Mac) exports from anywhere in the dialog.
  const exportRef = useRef(handleExport);
  exportRef.current = handleExport;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !pendingDocRef.current) {
        e.preventDefault();
        void exportRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  const batchLabel = (n: number) => (format === 'pdf' ? `${n}, one PDF` : `${n}, in one ZIP`);

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
                    {`One document, ${batchFrames.length} pages, a frame on each.`}
                  </>
                ) : (
                  <>
                    <Layers size={22} aria-hidden="true" />
                    {`${batchFrames.length} files in one ZIP, each named after its frame.`}
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
                : isSlides
                  ? `${deck.length} ${deck.length === 1 ? 'slide' : 'slides'}, ${pixelSize(exportBox, 1)} px`
                  : spec.raster && !isBatch
                    ? `${pixelSize(exportBox, effectiveScale)} px`
                    : isBatch
                      ? `${batchFrames.length} frames`
                      : 'Vector, any size'}
            </span>
            {estimate !== null && !isBatch && <span>About {formatBytes(estimate)}</span>}
          </div>
          {plan.tiled && !isBatch && !isSlides && (
            <p className="ex-hint ex-hint--tight">Drawn in tiles to reach {scale}×, so it takes a few seconds.</p>
          )}
          {scaleClamped && (
            <p className="ex-warn">
              <AlertTriangle size={13} aria-hidden="true" />
              Too large for {scale}× in a browser. It will export at {effectiveScale.toFixed(2)}×; SVG has no size limit.
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
                    // The dialog opens on the chosen format, not the first card.
                    data-autofocus={checked ? '' : undefined}
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
                  { value: 'board', label: 'Board', hint: 'Everything, cut to the content' },
                  ...(hasSelection ? [{ value: 'selection', label: scope.count === 1 ? 'Selection' : `Selection (${scope.count})` }] : []),
                  ...(frames.length > 0 ? [{ value: 'frame', label: frames.length === 1 ? 'Frame' : 'Frames' }] : []),
                  ...(stage ? [{ value: 'view', label: 'View', hint: 'What is on screen now' }] : []),
                  ...(format === 'pdf' && deck.length > 0 ? [{ value: 'slides', label: 'Slides', hint: 'The deck in presentation order' }] : []),
                ]}
              />
              {area === 'frame' && frames.length > 0 && (
                <div className="ex-frames" role="radiogroup" aria-label="Which frame">
                  <FrameTile
                    checked={frameChoice === EVERY_FRAME}
                    onPick={() => setFrameChoice(EVERY_FRAME)}
                    label={`All ${batchLabel(frames.length)}`}
                    every
                  />
                  {selectedFrames.length > 1 && (
                    <FrameTile
                      checked={frameChoice === SELECTED_FRAMES}
                      onPick={() => setFrameChoice(SELECTED_FRAMES)}
                      label={`Selected ${batchLabel(selectedFrames.length)}`}
                      every
                    />
                  )}
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
              {isSlides && (
                <p className="ex-hint">In presentation order. Skipped slides are left out.</p>
              )}
            </fieldset>
          )}

          {spec.raster && !isSlides && (
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

          {format !== 'json' && !isSlides && (
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
          {format !== 'json' && !spec.alpha && !isSlides && (
            <p className="ex-hint ex-hint--tight">{spec.label} has no transparency, so the background is always painted.</p>
          )}

          {format !== 'json' && !activeFrame && !isBatch && !isView && !isSlides && (
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

          {format === 'svg' && (
            <>
              <label className="ex-check">
                <input type="checkbox" checked={embedFonts} onChange={(e) => setEmbedFonts(e.target.checked)} />
                <span>
                  <span className="ex-check__label">Embed fonts</span>
                  <span className="ex-check__hint">
                    Carries the board’s typefaces inside the file, so it looks the same where they are not installed.{' '}
                    {fontCostLabel(fonts ? fonts.bytes : null)}
                    {fonts && fonts.missing.length > 0 && ` ${fonts.missing.join(', ')} could not be read and stays named only.`}
                  </span>
                </span>
              </label>
              <label className="ex-check">
                <input type="checkbox" checked={outlineText} onChange={(e) => setOutlineText(e.target.checked)} />
                <span>
                  <span className="ex-check__label">Outline text</span>
                  <span className="ex-check__hint">
                    Text objects become shapes: exact anywhere, no longer editable as text. Labels in shapes and notes stay text.
                  </span>
                </span>
              </label>
            </>
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

          {format !== 'json' && !isSlides && hasComments && (
            <label className="ex-check">
              <input type="checkbox" checked={includeComments} onChange={(e) => setIncludeComments(e.target.checked)} />
              <span>
                <span className="ex-check__label">Include comments</span>
                <span className="ex-check__hint">Draws each thread’s pin and first line where it was left.</span>
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
        <button type="button" className="dlg-btn" onClick={() => fileInputRef.current?.click()} disabled={busy !== null}>
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
          ) : progress && progress.total > 1 ? (
            <span className="ex-said__progress">
              <span className="ex-said__text">
                Exporting {Math.min(progress.done + 1, progress.total)} of {progress.total}
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

        {busy === 'export' ? (
          <button type="button" className="dlg-btn dlg-btn--lg" onClick={() => runRef.current?.abort()}>
            Cancel
          </button>
        ) : (
          <>
            {activeFrame && (
              <button type="button" className="dlg-btn dlg-btn--lg" onClick={() => void handleCopyLink()} disabled={busy !== null}>
                <Link2 size={15} aria-hidden="true" /> Copy link
              </button>
            )}
            {canCopy && (
              <button type="button" className="dlg-btn dlg-btn--lg" onClick={() => void handleCopy()} disabled={busy !== null}>
                {busy === 'copy' ? <Loader2 size={15} className="dlg-spin" aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                {format === 'svg' ? 'Copy SVG' : 'Copy image'}
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="dlg-btn dlg-btn--lg dlg-btn--primary"
          onClick={() => void handleExport()}
          disabled={busy !== null}
          aria-keyshortcuts="Control+Enter Meta+Enter"
        >
          {busy === 'export' ? (
            <Loader2 size={15} className="dlg-spin" aria-hidden="true" />
          ) : isBatch ? (
            <Layers size={15} aria-hidden="true" />
          ) : (
            <Download size={15} aria-hidden="true" />
          )}
          {busy === 'export'
            ? 'Exporting…'
            : isSlides
              ? `Export ${deck.length}-slide PDF`
              : exportLabel(format, isBatch ? { frames: batchFrames.length } : null)}
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
