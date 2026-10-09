import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown, Check, Search, Upload, Laptop, AlertTriangle, Loader2, Share2, Trash2, X } from 'lucide-react';
import { canvasFontFamily } from '../canvas/renderers/shared';
import { ensureFontLoaded } from '../../engine/text/measure';
import { ensureFamilyStylesheet, fontEntry, weightsFor } from '../../engine/text/fontCatalogue';
import { boardFamilies, fontLibrary, localFamilies, loadFamilyForPicker, familyLoadState, type DynamicFamily } from '../../engine/text/fontLibrary';
import { localFontsStore, requestLocalFonts, restoreLocalFonts } from '../../engine/text/localFonts';
import { familyAvailability } from '../../engine/text/fontAvailability';
import { FONT_ACCEPT, FontFileError } from '../../engine/text/fontFile';
import { getRoomRole, subscribeRoomRole } from '../../engine/model/permissions';
import { readAllNodes } from '../../engine/document';
import { beginPreview, endPreview } from '../panel/grammar/previewSession';
import {
  ROW_H,
  buildSections,
  createPreview,
  layout,
  stepCursor,
  stepWeight,
  visibleItems,
  type PickerRow as Row,
} from '../fonts/pickerModel';
import { PORTAL_SURFACE_ATTR } from './portalSurface';
import { useOutsidePress } from './outsidePress';
import { storageGet, storageSet } from '../../utils/safeStorage';
import './fontPicker.css';

/**
 * Choosing a typeface.
 *
 * One list, in the order a person reaches for things: fonts **in this board**,
 * **recent**, **uploaded** (shared with everyone), **on this device**, then the
 * built-in catalogue by purpose. Typing replaces the sections with one ranked
 * list. The list is virtualised: only the rows near the viewport exist.
 *
 * Each row is set in its own face once that face has loaded; until then it is a
 * skeleton line, and a face that fails says so. Rows near the viewport load
 * through a small queue so a fast scroll cannot start sixty downloads.
 *
 * With `preview` on, hovering (or arrowing to) a row shows that face on the
 * selection without committing. The write goes through the panel's untracked
 * preview origin, so leaving the list or pressing Escape restores the original
 * and Enter or a click lands as one undo step.
 */

const RECENT_KEY = 'vega_recent_fonts';
const RECENT_MAX = 5;
const LIST_H = 320;
const MAX_LOADS = 4;

function readRecents(): string[] {
  try {
    const raw = JSON.parse(storageGet(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(family: string): string[] {
  const next = [family, ...readRecents().filter((f) => f !== family)].slice(0, RECENT_MAX);
  storageSet(RECENT_KEY, JSON.stringify(next));
  return next;
}

/** Families the board's own text is set in, most used first. */
function familiesInUse(): string[] {
  const seen = new Map<string, number>();
  try {
    for (const n of Object.values(readAllNodes())) {
      const t = n.typography as { fontFamily?: unknown } | undefined;
      if (t && typeof t.fontFamily === 'string') seen.set(t.fontFamily, (seen.get(t.fontFamily) ?? 0) + 1);
    }
  } catch {
    /* no document yet */
  }
  return [...seen].sort((a, b) => b[1] - a[1]).map(([f]) => f);
}

interface Props {
  value: string;
  /** `baseWeight` is the weight before any hover preview, for choosing the nearest one in the new face. */
  onChange: (val: string, baseWeight?: number) => void;
  className?: string;
  /** The selection disagrees: the trigger says Mixed, and no row is ticked. */
  mixed?: boolean;
  /**
   * Preview a face on hover. Only valid where `onChange` writes through the
   * panel's `writePatches`, so the preview stays out of undo history.
   */
  preview?: boolean;
  /** With these, Left/Right in an empty search steps the weight. */
  weight?: number;
  onWeightChange?: (weight: number) => void;
}

const dynamicRow = (f: DynamicFamily): Row => ({ family: f.family, source: f.source, styles: f.faces.length });

type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

// A small queue: at most MAX_LOADS faces in flight, the rest wait their turn.
const loadState = new Map<string, LoadState>();
const waiting: (() => void)[] = [];
let inFlight = 0;
function pump() {
  while (inFlight < MAX_LOADS && waiting.length) {
    inFlight++;
    waiting.shift()!();
  }
}
function loadFace(family: string, source: Row['source']): Promise<LoadState> {
  if (source === 'board') return loadFamilyForPicker(family);
  const known = loadState.get(family);
  if (known === 'ready' || known === 'failed') return Promise.resolve(known);
  return new Promise((resolve) => {
    waiting.push(() => {
      const done = (s: LoadState) => {
        loadState.set(family, s);
        inFlight--;
        resolve(s);
        pump();
      };
      ensureFontLoaded(family);
      const entry = fontEntry(family);
      if (!entry || entry.source === 'system' || entry.source === 'bundled' || typeof document === 'undefined' || !document.fonts) {
        done('ready');
        return;
      }
      ensureFamilyStylesheet(family)
        .then(() => document.fonts.load(`16px "${family}"`))
        .then((faces) => done(faces.length > 0 ? 'ready' : 'failed'))
        .catch(() => done('failed'));
    });
    pump();
  });
}

const FontRow: React.FC<{
  row: Row;
  top: number;
  selected: boolean;
  active: boolean;
  canShare: boolean;
  onPick: (family: string) => void;
  onHover: (family: string) => void;
  onShare?: (family: string) => void;
  sharing?: boolean;
  /** Offered on the board's own fonts, to editors. */
  onRemove?: (family: string) => void;
}> = ({ row, top, selected, active, canShare, onPick, onHover, onShare, sharing, onRemove }) => {
  const [state, setState] = useState<LoadState>(() =>
    row.source === 'board' ? familyLoadState(row.family) : (loadState.get(row.family) ?? 'idle'),
  );

  // Mounted means near the viewport (the list is virtualised), so load now.
  useEffect(() => {
    if (state === 'ready' || state === 'failed') return;
    let live = true;
    setState('loading');
    void loadFace(row.family, row.source).then((s) => live && setState(s));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.family, row.source]);

  const face = state === 'ready' ? { fontFamily: canvasFontFamily(row.family) } : undefined;
  return (
    <div
      className="font-row-wrap font-row-wrap--abs"
      style={{ top, height: ROW_H }}
      data-active={active || undefined}
      onMouseEnter={() => onHover(row.family)}
    >
      <button
        type="button"
        role="option"
        id={`font-opt-${row.family.replace(/\W+/g, '-')}`}
        aria-selected={selected}
        className="font-row"
        data-on={selected || undefined}
        data-active={active || undefined}
        onClick={() => onPick(row.family)}
      >
        {state === 'ready' || state === 'failed' ? (
          <span className="font-row__name" style={face}>
            {row.family}
          </span>
        ) : (
          <span className="font-row__name font-row__name--skeleton" aria-label={row.family}>
            <span className="font-row__bar" aria-hidden="true" />
          </span>
        )}
        {state === 'failed' ? (
          <span className="font-row__fail" title="This font could not be loaded. Text will use a substitute.">
            <AlertTriangle size={12} className="font-row__state font-row__state--warn" aria-hidden="true" />
            <span className="font-row__meta">Unavailable</span>
          </span>
        ) : state === 'ready' ? (
          <span className="font-row__spec" style={face} aria-hidden="true">
            Agn8
          </span>
        ) : (
          <Loader2 size={12} className="font-row__state font-row__state--spin" aria-label="Loading" />
        )}
        {row.source !== 'builtin' && row.styles > 1 && <span className="font-row__meta">{row.styles} styles</span>}
        {selected && <Check size={13} className="font-row__tick" aria-hidden="true" />}
      </button>
      {row.source === 'local' && canShare && onShare && (
        <button
          type="button"
          className="font-row__action"
          onClick={() => onShare(row.family)}
          disabled={sharing}
          aria-label={`Share ${row.family} with the board`}
          title="Share with the board so everyone sees this font"
        >
          {sharing ? <Loader2 size={13} className="font-row__state--spin" aria-hidden="true" /> : <Share2 size={13} aria-hidden="true" />}
        </button>
      )}
      {row.source === 'board' && onRemove && (
        <button
          type="button"
          className="font-row__action font-row__action--remove"
          onClick={() => onRemove(row.family)}
          aria-label={`Remove ${row.family} from the board`}
          data-tooltip="Remove from board"
          data-tooltip-desc="Text set in it falls back for everyone"
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

interface UploadNote {
  id: number;
  name: string;
  status: 'uploading' | 'done' | 'error';
  message?: string;
}

let noteSeq = 0;

export const FontSelector: React.FC<Props> = ({
  value,
  onChange,
  className = '',
  mixed = false,
  preview = false,
  weight,
  onWeightChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const [inUse, setInUse] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [notes, setNotes] = useState<UploadNote[]>([]);
  const [sharing, setSharing] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hoverTimer = useRef<number>(0);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  useSyncExternalStore(fontLibrary.subscribe, fontLibrary.getSnapshot);
  const local = useSyncExternalStore(localFontsStore.subscribe, localFontsStore.getSnapshot);
  const role = useSyncExternalStore(subscribeRoomRole, getRoomRole);
  const canEdit = role === 'editor';

  // The latest onChange, so the preview controller below is made once.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const baseWeightRef = useRef(weight);
  const previewer = useMemo(
    () => createPreview({ begin: beginPreview, end: endPreview, apply: (f) => onChangeRef.current(f, baseWeightRef.current) }),
    [],
  );
  // While a face is previewed `value` is the preview; the picker keeps reading the original.
  const baseRef = useRef(value);
  if (!previewer.active) {
    baseRef.current = value;
    baseWeightRef.current = weight;
  }
  const displayFont = (previewer.active ? baseRef.current : value) || 'Inter';
  const availability = familyAvailability(displayFont);
  const missing = availability === 'missing';

  const restorePreview = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    previewer.restore();
  }, [previewer]);
  const showPreview = useCallback(
    (family: string) => {
      if (!preview) return;
      window.clearTimeout(hoverTimer.current);
      if (family === displayFont) {
        previewer.restore();
        return;
      }
      hoverTimer.current = window.setTimeout(() => {
        ensureFontLoaded(family);
        previewer.show(family);
      }, 90);
    },
    [preview, displayFont, previewer],
  );

  const sections = useMemo(
    () =>
      buildSections({
        query,
        recents,
        inUse,
        uploaded: boardFamilies().map(dynamicRow),
        device: localFamilies().map(dynamicRow),
      }),
    // The library version is read through useSyncExternalStore above; recompute on every render it causes.
    [query, recents, inUse, local, isOpen], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const lay = useMemo(
    () => layout(sections, (s) => !query.trim() && (s.key === 'board' || s.key === 'device')),
    [sections, query],
  );
  const flat = lay.rows;
  const visible = visibleItems(lay.items, scrollTop, LIST_H);

  const selectFont = useCallback(
    (font: string) => {
      ensureFontLoaded(font);
      setRecents(pushRecent(font));
      window.clearTimeout(hoverTimer.current);
      if (preview) previewer.commit(font);
      else onChange(font, weight);
      setIsOpen(false);
      setQuery('');
      triggerRef.current?.focus();
    },
    [onChange, preview, previewer],
  );

  const close = useCallback(
    (refocus = true) => {
      restorePreview();
      setIsOpen(false);
      if (refocus) triggerRef.current?.focus();
    },
    [restorePreview],
  );

  // Never leave a preview behind: unmounting mid-hover restores the original.
  useEffect(() => () => previewer.restore(), [previewer]);

  const place = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const width = Math.max(288, trigger.width);
    const height = popoverRef.current?.offsetHeight ?? 420;
    const margin = 8;
    let top = trigger.bottom + 4;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, trigger.top - height - 4);
    let left = trigger.left;
    if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - width - margin);
    setPosition({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    place();
    const onScroll = (e: Event) => {
      // The list scrolls inside the popover; only an outer scroll moves the anchor.
      if (listRef.current && e.target instanceof Node && listRef.current.contains(e.target)) return;
      place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [isOpen, place]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setRecents(readRecents());
    setInUse(familiesInUse());
    ensureFontLoaded(displayFont);
    void restoreLocalFonts();
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [isOpen, displayFont]);

  // Open on the selected row; typing returns to the top of the results.
  const openedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      openedRef.current = false;
      return;
    }
    const i = query.trim() ? 0 : flat.findIndex((f) => f.row.family === displayFont);
    setCursor(i >= 0 ? i : 0);
    if (!openedRef.current && flat.length) {
      openedRef.current = true;
      const row = flat[i >= 0 ? i : 0];
      window.setTimeout(() => {
        const el = listRef.current;
        if (el && row) el.scrollTop = Math.max(0, row.top - LIST_H / 2 + ROW_H / 2);
      }, 0);
    }
  }, [isOpen, flat, displayFont, query]);

  // Keep the keyboard row on screen.
  const reveal = useCallback(
    (index: number) => {
      const el = listRef.current;
      const row = flat[index];
      if (!el || !row) return;
      if (row.top < el.scrollTop + 28) el.scrollTop = Math.max(0, row.top - 28);
      else if (row.top + ROW_H > el.scrollTop + LIST_H) el.scrollTop = row.top + ROW_H - LIST_H;
    },
    [flat],
  );

  // The trigger toggles, so a press on it is left to its click. A press in the
  // panel or rail popover this sits in is outside and closes the list.
  useOutsidePress({ open: isOpen, surfaces: [popoverRef], triggers: triggerRef, onOutside: () => close(false) });

  const moveTo = (next: number) => {
    setCursor(next);
    reveal(next);
    const f = flat[next]?.row.family;
    if (f) showPreview(f);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.target !== searchRef.current) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      moveTo(stepCursor(cursor, e.key === 'ArrowDown' ? 1 : -1, flat.length));
      return;
    }
    if ((e.key === 'PageDown' || e.key === 'PageUp') && flat.length) {
      e.preventDefault();
      const jump = Math.floor(LIST_H / ROW_H) - 1;
      moveTo(Math.min(flat.length - 1, Math.max(0, cursor + (e.key === 'PageDown' ? jump : -jump))));
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !query && onWeightChange && weight != null) {
      e.preventDefault();
      const family = flat[cursor]?.row.family ?? displayFont;
      const next = stepWeight(weightsFor(family), weight, e.key === 'ArrowRight' ? 1 : -1);
      if (next !== weight) onWeightChange(next);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = flat[cursor];
      if (pick) selectFont(pick.row.family);
    }
  };

  const upload = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const { uploadFontFile } = await import('../../engine/text/fontUpload');
    let lastFamily: string | null = null;
    for (const file of Array.from(files)) {
      const id = ++noteSeq;
      setNotes((n) => [...n, { id, name: file.name, status: 'uploading' }]);
      try {
        const { font } = await uploadFontFile(file);
        lastFamily = font.family;
        setNotes((n) => n.map((x) => (x.id === id ? { ...x, status: 'done', message: `Added ${font.family} ${font.style}` } : x)));
      } catch (err) {
        const message = err instanceof FontFileError ? err.message : `${file.name} could not be uploaded.`;
        setNotes((n) => n.map((x) => (x.id === id ? { ...x, status: 'error', message } : x)));
      }
    }
    if (fileRef.current) fileRef.current.value = '';
    // Done notes fade on their own; errors stay until dismissed.
    window.setTimeout(() => setNotes((n) => n.filter((x) => x.status !== 'done')), 4000);
    if (lastFamily && missing && lastFamily === displayFont) ensureFontLoaded(lastFamily);
  };

  const share = async (family: string) => {
    setSharing(family);
    const id = ++noteSeq;
    setNotes((n) => [...n, { id, name: family, status: 'uploading' }]);
    try {
      const { shareLocalFamily } = await import('../../engine/text/fontUpload');
      const { uploaded, errors } = await shareLocalFamily(family);
      setNotes((n) =>
        n.map((x) =>
          x.id === id
            ? errors.length && !uploaded
              ? { ...x, status: 'error', message: errors[0] }
              : { ...x, status: 'done', message: `${family}: ${uploaded} ${uploaded === 1 ? 'style' : 'styles'} shared` }
            : x,
        ),
      );
    } finally {
      setSharing(null);
      window.setTimeout(() => setNotes((n) => n.filter((x) => x.status !== 'done')), 4000);
    }
  };

  /** Take every face of a board font off the board. Editors only; text set in it falls back. */
  const removeFromBoard = async (family: string) => {
    if (!canEdit) return;
    const { readBoardFonts, removeBoardFont } = await import('../../engine/document');
    const removed = readBoardFonts()
      .filter((f) => f.family === family)
      .reduce((count, f) => count + (removeBoardFont(f.id) ? 1 : 0), 0);
    const id = ++noteSeq;
    setNotes((n) => [
      ...n,
      removed > 0
        ? { id, name: family, status: 'done', message: `Removed ${family} from the board` }
        : { id, name: family, status: 'error', message: `${family} could not be removed.` },
    ]);
    window.setTimeout(() => setNotes((n) => n.filter((x) => x.status !== 'done')), 4000);
  };

  const deviceAction = () => {
    if (local.status === 'unsupported') {
      return (
        <p className="font-menu__note">
          This browser can't list installed fonts. {canEdit ? 'Upload a font file instead.' : 'Use Chrome or Edge to see them.'}
        </p>
      );
    }
    if (local.status === 'denied') {
      return <p className="font-menu__note">Access to this device's fonts was declined. Allow it in the site settings to use them here.</p>;
    }
    if (local.status === 'error') return <p className="font-menu__note">{local.message}</p>;
    if (local.status === 'granted') {
      return local.families.length === 0 ? <p className="font-menu__note">No fonts beyond the built-in ones were found.</p> : null;
    }
    return (
      <button type="button" className="font-menu__action" onClick={() => void requestLocalFonts()} disabled={local.status === 'requesting'}>
        {local.status === 'requesting' ? <Loader2 size={14} className="font-row__state--spin" aria-hidden="true" /> : <Laptop size={14} aria-hidden="true" />}
        <span className="font-menu__action-text">
          <span>Use fonts on this device</span>
          <span className="font-menu__action-sub">Your browser asks for permission first.</span>
        </span>
      </button>
    );
  };

  const activeKey = flat[cursor]?.key;
  const hasFontFile = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  return (
    <div className={`font-select ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className="font-trigger"
        onClick={() => (isOpen ? close(false) : setIsOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={mixed ? 'Font: Mixed' : missing ? `Font: ${displayFont}, not available on this device` : `Font: ${displayFont}`}
      >
        {mixed ? (
          <span className="font-trigger__name" data-mixed>
            Mixed
          </span>
        ) : (
          <span className="font-trigger__name" style={{ fontFamily: canvasFontFamily(displayFont) }}>
            {displayFont}
          </span>
        )}
        {missing && !mixed && (
          <span className="font-trigger__missing" title="Not on this device. Text is shown in a substitute.">
            <AlertTriangle size={12} aria-hidden="true" />
          </span>
        )}
        <ChevronDown size={14} aria-hidden="true" className="font-trigger__chev" />
      </button>

      {isOpen &&
        position &&
        ReactDOM.createPortal(
          <div
            ref={popoverRef}
            {...{ [PORTAL_SURFACE_ATTR]: 'true' }}
            className="font-menu panel-surface"
            data-dragging={dragging || undefined}
            style={{ top: position.top, left: position.left, width: position.width }}
            onKeyDown={onKey}
            onMouseLeave={restorePreview}
            onDragOver={(e) => {
              if (!canEdit || !hasFontFile(e)) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(e) => {
              if (!canEdit || !hasFontFile(e)) return;
              e.preventDefault();
              setDragging(false);
              void upload(e.dataTransfer.files);
            }}
          >
            <div className="font-menu__search">
              <Search size={13} aria-hidden="true" />
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls="font-listbox"
                value={query}
                onChange={(e) => {
                  restorePreview();
                  setQuery(e.target.value);
                  setScrollTop(0);
                  if (listRef.current) listRef.current.scrollTop = 0;
                }}
                placeholder="Search fonts, or what they are for"
                aria-label="Search fonts"
                aria-activedescendant={flat[cursor] ? `font-opt-${flat[cursor].row.family.replace(/\W+/g, '-')}` : undefined}
                spellCheck={false}
              />
              {canEdit && (
                <button
                  type="button"
                  className="font-menu__icon-btn"
                  onClick={() => fileRef.current?.click()}
                  aria-label="Upload a font to this board"
                  title="Upload a font (WOFF2, WOFF, TTF, OTF), or drop one here"
                >
                  <Upload size={14} aria-hidden="true" />
                </button>
              )}
              <input ref={fileRef} type="file" accept={FONT_ACCEPT} multiple hidden onChange={(e) => void upload(e.target.files)} />
            </div>

            {dragging && (
              <div className="font-menu__drop" aria-hidden="true">
                <Upload size={18} />
                <span>Drop a font to add it to this board</span>
              </div>
            )}

            {missing && !mixed && (
              <div className="font-menu__banner" role="status">
                <AlertTriangle size={14} aria-hidden="true" />
                <div>
                  <p>
                    <strong>{displayFont}</strong> isn't on this device, so text is shown in a substitute.
                  </p>
                  {canEdit ? (
                    <button type="button" className="font-menu__link" onClick={() => fileRef.current?.click()}>
                      Upload this font to share it
                    </button>
                  ) : (
                    <p className="font-menu__banner-sub">An editor can upload it to the board so everyone sees it.</p>
                  )}
                </div>
              </div>
            )}

            {notes.length > 0 && (
              <ul className="font-menu__notes" aria-live="polite">
                {notes.map((n) => (
                  <li key={n.id} className="font-note" data-status={n.status}>
                    {n.status === 'uploading' && <Loader2 size={12} className="font-row__state--spin" aria-hidden="true" />}
                    {n.status === 'done' && <Check size={12} aria-hidden="true" />}
                    {n.status === 'error' && <AlertTriangle size={12} aria-hidden="true" />}
                    <span className="font-note__text">{n.status === 'uploading' ? `Uploading ${n.name}…` : n.message}</span>
                    {n.status === 'error' && (
                      <button
                        type="button"
                        className="font-note__dismiss"
                        aria-label="Dismiss"
                        onClick={() => setNotes((all) => all.filter((x) => x.id !== n.id))}
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div
              ref={listRef}
              id="font-listbox"
              className="font-menu__list font-menu__list--virtual custom-scrollbar"
              role="listbox"
              aria-label="Fonts"
              style={{ height: LIST_H }}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
              {flat.length === 0 && query.trim() && (
                <p className="font-menu__empty">Nothing matches “{query.trim()}”. Try a category: narrow, mono, slab, hand.</p>
              )}
              <div className="font-menu__canvas" style={{ height: lay.height }}>
                {visible.map((it) => {
                  if (it.kind === 'header') {
                    const s = it.section;
                    const emptyBoard = s.key === 'board' && s.rows.length === 0;
                    const isDevice = s.key === 'device';
                    return (
                      <div key={it.key} className="font-menu__label font-menu__label--abs" style={{ top: it.top, height: it.height }} role="presentation">
                        {s.label}
                        {s.hint && <span className="font-menu__hint">{s.hint}</span>}
                        {(emptyBoard || (isDevice && s.rows.length === 0)) && (
                          <span className="font-menu__hint font-menu__hint--note">
                            {emptyBoard ? (canEdit ? 'Drop a font here' : 'None yet') : ''}
                          </span>
                        )}
                      </div>
                    );
                  }
                  return (
                    <FontRow
                      key={it.key}
                      row={it.row}
                      top={it.top}
                      selected={!mixed && it.row.family === displayFont}
                      active={activeKey === it.key}
                      canShare={canEdit}
                      onPick={selectFont}
                      onHover={(family) => {
                        setCursor(it.index);
                        showPreview(family);
                      }}
                      onShare={share}
                      sharing={sharing === it.row.family}
                      onRemove={it.section.key === 'board' && canEdit ? (family) => void removeFromBoard(family) : undefined}
                    />
                  );
                })}
              </div>
            </div>
            {!query.trim() && sections.some((s) => s.key === 'device') && (
              <div className="font-menu__foot">{deviceAction()}</div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
};
