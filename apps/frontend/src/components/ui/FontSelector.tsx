import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown, Check, Search } from 'lucide-react';
import { canvasFontFamily } from '../canvas/renderers/shared';
import { ensureFontLoaded } from '../../engine/text/measure';
import { CATEGORIES, FONTS, searchFonts, type FontEntry } from '../../engine/text/fontCatalogue';
import { PORTAL_SURFACE_ATTR, isInsidePortalSurface } from './portalSurface';

/**
 * Choosing a typeface.
 *
 * ## What changed, and why it had to
 *
 * The list was thirteen families held in this file, and five of them were
 * downloaded by every visitor on every visit whether they opened this control
 * or not. That arrangement caps the catalogue: every face added is paid for by
 * everybody, including the people who never look.
 *
 * The catalogue moved to `engine/text/fontCatalogue.ts` and became lazy, so the
 * list can be as long as it is useful. This file's job is now the part that
 * length makes hard — **finding one**.
 *
 * Three things do that work:
 *
 * - **Search over the job, not only the name.** Typing "narrow" finds the
 *   condensed group and "code" finds the monospaces. Somebody looking for a
 *   font usually knows what they need it to do; the name is the thing they are
 *   trying to arrive at, not the thing they start from.
 * - **Recents first.** Almost every board uses two or three faces and returns
 *   to them constantly. A list that always starts at Inter makes people scroll
 *   past thirty faces to reach the one they used a minute ago.
 * - **Each row is set in its own face**, which is the only preview that
 *   answers the question being asked. It is also why loading is tied to
 *   visibility: a row that is on screen fetches its face, and a row forty
 *   places down does not.
 */

/** Where the recent list lives. Per device, like everything else on this app. */
const RECENT_KEY = 'vega_recent_fonts';
const RECENT_MAX = 5;

function readRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(family: string): string[] {
  const next = [family, ...readRecents().filter((f) => f !== family)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* a full or blocked store is not worth a message about a font list */
  }
  return next;
}

interface Props {
  value: string;
  onChange: (val: string) => void;
  className?: string;
}

/**
 * One row, which fetches its own face when it comes into view.
 *
 * The observer is per row rather than one shared instance because a row's
 * whole obligation is "load me if I am seen", and that is the smallest thing
 * that can own it. Forty observers on a list that exists for a few seconds is
 * cheaper than the forty stylesheet requests the alternative makes.
 */
const FontRow: React.FC<{
  entry: FontEntry;
  selected: boolean;
  active: boolean;
  onPick: (family: string) => void;
  onHover: () => void;
}> = ({ entry, selected, active, onPick, onHover }) => {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          ensureFontLoaded(entry.family);
          io.disconnect();
        }
      },
      // A margin, so a row loads just before it is read rather than as it
      // arrives — scrolling a list of faces that pop in one at a time is worse
      // than waiting a moment for the ones you are about to reach.
      { root: el.closest('[role="listbox"]'), rootMargin: '120px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [entry.family]);

  // Scrolled to rather than focused, so the keyboard can walk the list while
  // the caret stays in the search field.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      className="font-row"
      data-on={selected || undefined}
      data-active={active || undefined}
      onClick={() => onPick(entry.family)}
      onMouseEnter={onHover}
    >
      <span className="font-row__name" style={{ fontFamily: canvasFontFamily(entry.family) }}>
        {entry.family}
      </span>
      {/*
        The specimen, not a second copy of the name.

        A name set in its own face tells you the shape of eight letters that
        happen to spell it. These four tell you what the face does with a
        capital, a round lower case, an ascender and a figure — which is what
        somebody is actually looking at a font list to find out.
      */}
      <span className="font-row__spec" style={{ fontFamily: canvasFontFamily(entry.family) }} aria-hidden="true">
        Agn8
      </span>
      {selected && <Check size={13} className="font-row__tick" aria-hidden="true" />}
    </button>
  );
};

export const FontSelector: React.FC<Props> = ({ value, onChange, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const displayFont = value || 'Inter';

  /**
   * The list, grouped, with recents on top.
   *
   * Recents are suppressed while searching: a query is a person naming what
   * they want, and answering it with "here is what you used yesterday" first
   * puts the wrong thing under the caret when they press Enter.
   */
  const groups = useMemo(() => {
    const matches = searchFonts(query);
    const out: { label: string; hint?: string; fonts: FontEntry[] }[] = [];

    if (!query.trim() && recents.length) {
      const entries = recents
        .map((f) => FONTS.find((x) => x.family === f))
        .filter((f): f is FontEntry => !!f);
      if (entries.length) out.push({ label: 'Recent', fonts: entries });
    }

    for (const c of CATEGORIES) {
      const fonts = matches.filter((f) => f.category === c.id);
      if (fonts.length) out.push({ label: c.label, hint: c.hint, fonts });
    }
    return out;
  }, [query, recents]);

  /** The list as one sequence, which is what the arrow keys actually walk. */
  const flat = useMemo(() => groups.flatMap((g) => g.fonts), [groups]);

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
    const width = Math.max(260, trigger.width);
    const height = popoverRef.current?.offsetHeight ?? 360;
    const margin = 8;

    let top = trigger.bottom + 4;
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, trigger.top - height - 4);
    }
    let left = trigger.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
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

  // Opening starts on the current font and with the caret in the search field,
  // so the two ways through the list — type a name, or walk it — are both one
  // action away rather than one of them needing a click first.
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setRecents(readRecents());
    ensureFontLoaded(displayFont);
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
      if (
        popoverRef.current?.contains(target) ||
        triggerRef.current?.contains(target) ||
        isInsidePortalSurface(target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      // Wraps, because a list this long is walked in both directions and
      // stopping dead at the end is a worse answer than the top.
      setCursor((c) => (c + step + flat.length) % flat.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = flat[cursor];
      if (pick) selectFont(pick.family);
    }
  };

  return (
    <div className={className} style={{ position: 'relative', width: '100%', minWidth: 120 }}>
      <button
        ref={triggerRef}
        type="button"
        className="font-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Font: ${displayFont}`}
      >
        <span className="font-trigger__name" style={{ fontFamily: canvasFontFamily(displayFont) }}>
          {displayFont}
        </span>
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
                spellCheck={false}
              />
            </div>

            <div className="font-menu__list custom-scrollbar" role="listbox" aria-label="Fonts">
              {groups.length === 0 && (
                <p className="font-menu__empty">
                  Nothing matches “{query.trim()}”. Try a category — narrow, mono, slab, hand.
                </p>
              )}
              {groups.map((group) => (
                <div key={group.label} className="font-menu__group">
                  <div className="font-menu__label">
                    {group.label}
                    {group.hint && <span className="font-menu__hint">{group.hint}</span>}
                  </div>
                  {group.fonts.map((entry) => (
                    <FontRow
                      key={`${group.label}:${entry.family}`}
                      entry={entry}
                      selected={entry.family === displayFont}
                      active={flat[cursor]?.family === entry.family}
                      onPick={selectFont}
                      onHover={() => ensureFontLoaded(entry.family)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
