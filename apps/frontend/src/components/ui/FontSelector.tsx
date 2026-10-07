import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown, Check, Search, Upload, Laptop, AlertTriangle, Loader2, Share2, X } from 'lucide-react';
import { canvasFontFamily } from '../canvas/renderers/shared';
import { ensureFontLoaded } from '../../engine/text/measure';
import { CATEGORIES, FONTS, searchFonts, type FontEntry } from '../../engine/text/fontCatalogue';
import { boardFamilies, fontLibrary, localFamilies, loadFamilyForPicker, familyLoadState, type DynamicFamily } from '../../engine/text/fontLibrary';
import { localFontsStore, requestLocalFonts, restoreLocalFonts } from '../../engine/text/localFonts';
import { familyAvailability } from '../../engine/text/fontAvailability';
import { FONT_ACCEPT, FontFileError } from '../../engine/text/fontFile';
import { getRoomRole, subscribeRoomRole } from '../../engine/model/permissions';
import { PORTAL_SURFACE_ATTR, isInsidePortalSurface } from './portalSurface';
import { storageGet, storageSet } from '../../utils/safeStorage';
import './fontPicker.css';

/**
 * Choosing a typeface.
 *
 * Four sources, in the order a person reaches for them:
 *
 * - **On this board**: fonts uploaded to the board. Every collaborator has
 *   them, so they come first.
 * - **Recent**: what this device used last.
 * - **On this device**: installed fonts, through the Local Font Access API,
 *   after the person asks. Each can be shared with the board, which uploads
 *   it so collaborators see the real face instead of a substitute.
 * - **Built-in**: the catalogue, grouped by what each face is for.
 *
 * Each row is set in its own face and loads that face when it scrolls into
 * view. Search matches names and what a face is for ("narrow", "code").
 */

const RECENT_KEY = 'vega_recent_fonts';
const RECENT_MAX = 5;

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

interface Props {
  value: string;
  onChange: (val: string) => void;
  className?: string;
}

/** One row of the list: a built-in entry, or a board or device family. */
interface Row {
  family: string;
  source: 'builtin' | 'board' | 'local';
  styles: number;
}

const builtinRow = (f: FontEntry): Row => ({ family: f.family, source: 'builtin', styles: f.weights.length * (f.italic ? 2 : 1) });
const dynamicRow = (f: DynamicFamily): Row => ({ family: f.family, source: f.source, styles: f.faces.length });

const matches = (family: string, q: string) => !q || family.toLowerCase().includes(q);

const FontRow: React.FC<{
  row: Row;
  selected: boolean;
  active: boolean;
  canShare: boolean;
  onPick: (family: string) => void;
  onHover: () => void;
  onShare?: (family: string) => void;
  sharing?: boolean;
}> = ({ row, selected, active, canShare, onPick, onHover, onShare, sharing }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>(() =>
    row.source === 'board' ? familyLoadState(row.family) : 'idle'
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (row.source === 'board') {
          setState('loading');
          void loadFamilyForPicker(row.family).then(setState);
        } else {
          ensureFontLoaded(row.family);
        }
      },
      { root: el.closest('[role="listbox"]'), rootMargin: '120px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [row.family, row.source]);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const face = { fontFamily: canvasFontFamily(row.family) };
  return (
    <div
      ref={ref}
      className="font-row-wrap"
      data-active={active || undefined}
      onMouseEnter={onHover}
    >
      <button
        type="button"
        role="option"
        aria-selected={selected}
        className="font-row"
        data-on={selected || undefined}
        data-active={active || undefined}
        onClick={() => onPick(row.family)}
      >
        <span className="font-row__name" style={face}>
          {row.family}
        </span>
        {state === 'loading' ? (
          <Loader2 size={12} className="font-row__state font-row__state--spin" aria-label="Loading" />
        ) : state === 'failed' ? (
          <AlertTriangle size={12} className="font-row__state font-row__state--warn" aria-label="Could not load" />
        ) : (
          <span className="font-row__spec" style={face} aria-hidden="true">
            Agn8
          </span>
        )}
        {row.source !== 'builtin' && row.styles > 1 && (
          <span className="font-row__meta">{row.styles} styles</span>
        )}
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

export const FontSelector: React.FC<Props> = ({ value, onChange, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [notes, setNotes] = useState<UploadNote[]>([]);
  const [sharing, setSharing] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  useSyncExternalStore(fontLibrary.subscribe, fontLibrary.getSnapshot);
  const local = useSyncExternalStore(localFontsStore.subscribe, localFontsStore.getSnapshot);
  const role = useSyncExternalStore(subscribeRoomRole, getRoomRole);
  const canEdit = role === 'editor';

  const displayFont = value || 'Inter';
  const availability = familyAvailability(displayFont);
  const missing = availability === 'missing';

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups: { key: string; label: string; hint?: string; rows: Row[] }[] = [];

    const board = boardFamilies().filter((f) => matches(f.family, q)).map(dynamicRow);
    groups.push({ key: 'board', label: 'On this board', hint: 'Shared with everyone', rows: board });

    if (!q && recents.length) {
      const recentRows = recents
        .map((family): Row | null => {
          const b = boardFamilies().find((f) => f.family === family) ?? localFamilies().find((f) => f.family === family);
          if (b) return dynamicRow(b);
          const entry = FONTS.find((x) => x.family === family);
          return entry ? builtinRow(entry) : null;
        })
        .filter((r): r is Row => !!r);
      if (recentRows.length) groups.push({ key: 'recent', label: 'Recent', rows: recentRows });
    }

    const device = localFamilies().filter((f) => matches(f.family, q)).map(dynamicRow);
    groups.push({ key: 'device', label: 'On this device', hint: 'Private until you share one', rows: device });

    const builtin = searchFonts(query);
    for (const c of CATEGORIES) {
      const fonts = builtin.filter((f) => f.category === c.id).map(builtinRow);
      if (fonts.length) groups.push({ key: c.id, label: c.label, hint: c.hint, rows: fonts });
    }
    return groups;
    // The library version is read through useSyncExternalStore above; recompute on every render it causes.
  }, [query, recents, local, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const flat = useMemo(() => rows.flatMap((g) => g.rows.map((r) => ({ ...r, key: `${g.key}:${r.family}` }))), [rows]);

  const selectFont = useCallback(
    (font: string) => {
      ensureFontLoaded(font);
      setRecents(pushRecent(font));
      onChange(font);
      setIsOpen(false);
      setQuery('');
      triggerRef.current?.focus();
    },
    [onChange],
  );

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
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [isOpen, place]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setRecents(readRecents());
    ensureFontLoaded(displayFont);
    void restoreLocalFonts();
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [isOpen, displayFont]);

  useEffect(() => {
    const i = flat.findIndex((f) => f.family === displayFont);
    setCursor(i >= 0 ? i : 0);
  }, [flat, displayFont]);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target) || isInsidePortalSurface(target)) return;
      setIsOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.target !== searchRef.current) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setCursor((c) => (c + step + flat.length) % flat.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = flat[cursor];
      if (pick) selectFont(pick.family);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const { uploadFontFile } = await import('../../engine/text/fontUpload');
    let lastFamily: string | null = null;
    for (const file of Array.from(files)) {
      const id = ++noteSeq;
      setNotes((n) => [...n, { id, name: file.name, status: 'uploading' }]);
      try {
        const { font } = await uploadFontFile(file);
        lastFamily = font.family;
        setNotes((n) => n.map((x) => (x.id === id ? { ...x, status: 'done', message: `${font.family} ${font.style}` } : x)));
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
            : x
        )
      );
    } finally {
      setSharing(null);
      window.setTimeout(() => setNotes((n) => n.filter((x) => x.status !== 'done')), 4000);
    }
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
      <button
        type="button"
        className="font-menu__action"
        onClick={() => void requestLocalFonts()}
        disabled={local.status === 'requesting'}
      >
        {local.status === 'requesting' ? <Loader2 size={14} className="font-row__state--spin" aria-hidden="true" /> : <Laptop size={14} aria-hidden="true" />}
        <span className="font-menu__action-text">
          <span>Use fonts on this device</span>
          <span className="font-menu__action-sub">Your browser asks for permission first.</span>
        </span>
      </button>
    );
  };

  return (
    <div className={`font-select ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className="font-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={missing ? `Font: ${displayFont}, not available on this device` : `Font: ${displayFont}`}
      >
        <span className="font-trigger__name" style={{ fontFamily: canvasFontFamily(displayFont) }}>
          {displayFont}
        </span>
        {missing && (
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
            style={{ top: position.top, left: position.left, width: position.width }}
            onKeyDown={onKey}
          >
            <div className="font-menu__search">
              <Search size={13} aria-hidden="true" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search fonts, or what they are for"
                aria-label="Search fonts"
                aria-activedescendant={undefined}
                spellCheck={false}
              />
              {canEdit && (
                <button
                  type="button"
                  className="font-menu__icon-btn"
                  onClick={() => fileRef.current?.click()}
                  aria-label="Upload a font to this board"
                  title="Upload a font (WOFF2, WOFF, TTF, OTF)"
                >
                  <Upload size={14} aria-hidden="true" />
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept={FONT_ACCEPT}
                multiple
                hidden
                onChange={(e) => void upload(e.target.files)}
              />
            </div>

            {missing && (
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
                    <span className="font-note__text">
                      {n.status === 'uploading' ? `Uploading ${n.name}…` : n.status === 'done' ? `Added ${n.message}` : n.message}
                    </span>
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

            <div className="font-menu__list custom-scrollbar" role="listbox" aria-label="Fonts">
              {flat.length === 0 && query.trim() && (
                <p className="font-menu__empty">
                  Nothing matches “{query.trim()}”. Try a category: narrow, mono, slab, hand.
                </p>
              )}
              {rows.map((group) => {
                const showEmptyBoard = group.key === 'board' && group.rows.length === 0 && !query.trim();
                const showDevice = group.key === 'device' && !query.trim();
                if (!group.rows.length && !showEmptyBoard && !showDevice) return null;
                return (
                  <div key={group.key} className="font-menu__group" role="group" aria-label={group.label}>
                    <div className="font-menu__label">
                      {group.label}
                      {group.hint && <span className="font-menu__hint">{group.hint}</span>}
                    </div>
                    {showEmptyBoard && (
                      <p className="font-menu__note">
                        {canEdit
                          ? 'Upload a brand font and everyone on the board can use it.'
                          : 'No fonts have been uploaded to this board.'}
                      </p>
                    )}
                    {group.key === 'device' && deviceAction()}
                    {group.rows.map((row) => {
                      const key = `${group.key}:${row.family}`;
                      return (
                        <FontRow
                          key={key}
                          row={row}
                          selected={row.family === displayFont}
                          active={flat[cursor]?.key === key}
                          canShare={canEdit}
                          onPick={selectFont}
                          onHover={() => {
                            if (row.source !== 'board') ensureFontLoaded(row.family);
                          }}
                          onShare={share}
                          sharing={sharing === row.family}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
