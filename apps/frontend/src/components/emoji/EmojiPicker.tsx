import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Apple, Clock3, Flag, Hand, Heart, Lightbulb, PawPrint, Plane, Search, Smile, Trophy, X } from 'lucide-react';
import {
  emojiIndexNow,
  loadEmojiIndex,
  shortcodeOf,
  subscribeEmojiIndex,
  type EmojiEntry,
} from '../../engine/emoji/emojiIndex';
import {
  pushRecentEmoji,
  recentEmoji,
  setSkinTone,
  skinTone,
  SKIN_TONE_SWATCHES,
  subscribeEmojiPrefs,
  withTone,
  type SkinTone,
} from '../../engine/emoji/emojiPrefs';
import { buildRows, CELL, COLUMNS, HEADER, rowAt, verticalStep, type PickerRow } from './pickerRows';
import { Emoji } from './Emoji';
import './emoji.css';

export interface EmojiPickerProps {
  /** Called with the native glyph (toned if a tone is chosen). */
  onPick: (native: string) => void;
  /** Shows a "Remove" control, for a slot that already holds an emoji. */
  onRemove?: () => void;
  removeLabel?: string;
  /** The emoji currently in the slot, marked in the grid. */
  current?: string;
  autoFocus?: boolean;
}

const VIEW_HEIGHT = 288;
const OVERSCAN = 3 * CELL;

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  recent: <Clock3 size={15} />,
  smileys: <Smile size={15} />,
  people: <Hand size={15} />,
  animals: <PawPrint size={15} />,
  food: <Apple size={15} />,
  travel: <Plane size={15} />,
  activities: <Trophy size={15} />,
  objects: <Lightbulb size={15} />,
  symbols: <Heart size={15} />,
  flags: <Flag size={15} />,
};

/** The heading of a section, for the pinned label at the top of the grid. */
function sectionLabel(rows: readonly PickerRow[], section: string): string {
  for (const r of rows) if (r.kind === 'header' && r.section === section) return r.label;
  return '';
}

const subscribeAll = (fn: () => void) => {
  const a = subscribeEmojiIndex(fn);
  const b = subscribeEmojiPrefs(fn);
  return () => {
    a();
    b();
  };
};

/**
 * The emoji picker: search, categories, recents, skin tone, keyboard.
 *
 * Laid out like Notion's and Slack's, because that is the picker people
 * already know: a search field that has focus from the start, a row of
 * category tabs that both jump and follow the scroll, a grid, and a footer
 * naming the emoji under the pointer or the keyboard.
 *
 * The grid is virtualised — only the rows in view (plus a few either side)
 * are in the DOM — so the full set of nearly two thousand costs about ninety
 * images at any moment. Focus never leaves the search field: the arrow keys
 * move an active cell announced through `aria-activedescendant`, Enter picks
 * it, so searching and choosing are one continuous gesture.
 */
export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onPick, onRemove, removeLabel = 'Remove', current, autoFocus = true }) => {
  const baseId = useId();
  const index = useSyncExternalStore(subscribeEmojiIndex, emojiIndexNow, emojiIndexNow);
  useSyncExternalStore(subscribeAll, () => `${skinTone()}|${recentEmoji().join('')}`, () => '');
  const tone = skinTone();
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<EmojiEntry | null>(null);
  const [toneOpen, setToneOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Recents are frozen while the picker is open, so picking does not reshuffle the grid under the pointer. */
  const [recents] = useState(() => recentEmoji());

  const load = useCallback(() => {
    setError(false);
    loadEmojiIndex().catch(() => setError(true));
  }, []);
  useEffect(() => {
    if (!index) load();
  }, [index, load]);

  useEffect(() => {
    if (autoFocus) input.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const rows = useMemo<PickerRow[]>(() => (index ? buildRows(index, query, recents, COLUMNS) : []), [index, query, recents]);
  const flat = useMemo(() => rows.flatMap((r) => (r.kind === 'cells' ? r.entries : [])), [rows]);
  const total = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height : 0;

  // A new query starts the keyboard at the first result, at the top.
  useEffect(() => {
    setActive(0);
    scroller.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [query]);

  const activeEntry = flat[Math.min(active, flat.length - 1)];
  const shown = hovered ?? activeEntry ?? null;

  const pick = (entry: EmojiEntry) => {
    const { native } = withTone(entry, tone);
    pushRecentEmoji(native);
    onPick(native);
  };

  /** Scroll so the active cell is fully in view, without moving if it already is. */
  const reveal = (i: number) => {
    const el = scroller.current;
    const at = rowAt(rows, i);
    if (!el || !at) return;
    const top = at.top;
    const bottom = top + CELL;
    // The section header is sticky, so the visible band starts below it.
    if (top - HEADER < el.scrollTop) el.scrollTop = Math.max(0, top - HEADER);
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  };

  const move = (delta: number | 'up' | 'down') => {
    if (flat.length === 0) return;
    const target = delta === 'up' ? verticalStep(rows, active, -1) : delta === 'down' ? verticalStep(rows, active, 1) : active + delta;
    const next = Math.max(0, Math.min(flat.length - 1, target));
    setActive(next);
    setHovered(null);
    reveal(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case 'ArrowRight':
        // Inside the text, the arrows still move the caret.
        if (query && input.current && input.current.selectionStart !== query.length) return;
        move(1);
        break;
      case 'ArrowLeft':
        if (query && input.current && (input.current.selectionStart ?? 0) > 0) return;
        move(-1);
        break;
      case 'ArrowDown':
        move('down');
        break;
      case 'ArrowUp':
        move('up');
        break;
      case 'Enter':
        if (activeEntry) pick(activeEntry);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const jumpTo = (sectionId: string) => {
    const row = rows.find((r) => r.kind === 'header' && r.id === sectionId);
    if (row && scroller.current) scroller.current.scrollTop = row.top;
  };

  // Which section the top of the viewport is in, for the tab row.
  const currentSection = useMemo(() => {
    let id = rows[0]?.section ?? '';
    for (const r of rows) {
      if (r.top > scrollTop + 4) break;
      id = r.section;
    }
    return id;
  }, [rows, scrollTop]);

  const tabs = useMemo(() => {
    if (!index) return [];
    const list = index.categories.map((c) => ({ id: c.id, label: c.label }));
    return recents.length ? [{ id: 'recent', label: 'Recently used' }, ...list] : list;
  }, [index, recents]);

  const listboxId = `${baseId}-grid`;
  const cellId = (i: number) => `${baseId}-c${i}`;
  const toneSwatch = SKIN_TONE_SWATCHES[tone];

  // Keep the scroller's height stable whether results are many or few.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && el.scrollTop > Math.max(0, total - el.clientHeight)) el.scrollTop = Math.max(0, total - el.clientHeight);
  }, [total]);

  let body: React.ReactNode;
  if (error) {
    body = (
      <div className="emoji-picker__state" role="alert">
        <p>Emoji couldn't load. Check your connection, then try again.</p>
        <button type="button" className="emoji-picker__retry" onClick={load}>
          Try again
        </button>
      </div>
    );
  } else if (!index) {
    // Recents are stored as glyphs, so they paint before the catalogue
    // arrives: the emoji people reach for most are there on the first frame.
    const early = query ? [] : recents;
    const earlyRows = Math.ceil(early.length / COLUMNS);
    body = (
      <>
        {earlyRows > 0 && (
          <div className="emoji-picker__space" style={{ height: HEADER + earlyRows * CELL }}>
            <div className="emoji-picker__heading" style={{ top: 0 }}>
              Recently used
            </div>
            {Array.from({ length: earlyRows }, (_, r) => (
              <div key={r} className="emoji-picker__row" style={{ top: HEADER + r * CELL }} role="presentation">
                {early.slice(r * COLUMNS, (r + 1) * COLUMNS).map((native) => (
                  <button
                    key={native}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={false}
                    aria-label={native}
                    className="emoji-picker__cell"
                    data-current={current === native ? true : undefined}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      pushRecentEmoji(native);
                      onPick(native);
                    }}
                  >
                    <Emoji native={native} size={24} loading="eager" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="emoji-picker__skeleton" aria-busy="true" aria-label="Loading emoji">
          {Array.from({ length: Math.max(8, 40 - earlyRows * COLUMNS) }, (_, i) => (
            <span key={i} className="emoji-picker__bone" />
          ))}
        </div>
      </>
    );
  } else if (query && flat.length === 0) {
    body = (
      <div className="emoji-picker__state" role="status">
        <p>No emoji match “{query}”.</p>
        <p className="emoji-picker__hint">Try a broader word, like “happy” or “check”.</p>
      </div>
    );
  } else {
    const from = scrollTop - OVERSCAN;
    const to = scrollTop + VIEW_HEIGHT + OVERSCAN;
    body = (
      <div className="emoji-picker__space" style={{ height: total }}>
        {rows
          .filter((r) => r.top + r.height >= from && r.top <= to)
          .map((r) =>
            r.kind === 'header' ? (
              <div key={`h-${r.id}`} className="emoji-picker__heading" style={{ top: r.top }}>
                {r.label}
              </div>
            ) : (
              <div key={`r-${r.top}`} className="emoji-picker__row" style={{ top: r.top }} role="presentation">
                {r.entries.map((entry, j) => {
                  const i = r.first + j;
                  const { code, native } = withTone(entry, tone);
                  const isActive = i === active;
                  return (
                    <button
                      key={code}
                      id={cellId(i)}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={isActive}
                      aria-label={entry.n}
                      className="emoji-picker__cell"
                      data-active={isActive || undefined}
                      data-current={current && (current === native || current === entry.u) ? true : undefined}
                      onMouseEnter={() => setHovered(entry)}
                      onMouseLeave={() => setHovered((h) => (h === entry ? null : h))}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setActive(i);
                        pick(entry);
                      }}
                    >
                      <Emoji code={code} native={native} size={24} loading="eager" />
                    </button>
                  );
                })}
              </div>
            )
          )}
      </div>
    );
  }

  return (
    <div className="emoji-picker" onKeyDown={onKeyDown}>
      <div className="emoji-picker__top">
        <label className="emoji-picker__search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={index && activeEntry ? cellId(active) : undefined}
            aria-label="Search emoji"
            placeholder="Search emoji"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="emoji-picker__clear" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </label>
        <div className="emoji-picker__tone">
          <button
            type="button"
            className="emoji-picker__tone-trigger"
            aria-label={`Skin tone: ${toneSwatch.label}`}
            aria-expanded={toneOpen}
            data-tooltip="Skin tone"
            onClick={() => setToneOpen((o) => !o)}
          >
            <span className="emoji-picker__swatch" style={{ background: toneSwatch.color }} />
          </button>
          {toneOpen && (
            <div className="emoji-picker__tones" role="radiogroup" aria-label="Skin tone">
              {SKIN_TONE_SWATCHES.map((s) => (
                <button
                  key={s.tone}
                  type="button"
                  role="radio"
                  aria-checked={s.tone === tone}
                  aria-label={s.label}
                  className="emoji-picker__tone-option"
                  onClick={() => {
                    setSkinTone(s.tone as SkinTone);
                    setToneOpen(false);
                    input.current?.focus({ preventScroll: true });
                  }}
                >
                  <span className="emoji-picker__swatch" style={{ background: s.color }} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!query && tabs.length > 0 && (
        <div className="emoji-picker__tabs" role="tablist" aria-label="Emoji categories">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={currentSection === t.id}
              aria-label={t.label}
              data-tooltip={t.label}
              className="emoji-picker__tab"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => jumpTo(t.id)}
            >
              {CATEGORY_ICONS[t.id] ?? <Smile size={15} />}
            </button>
          ))}
        </div>
      )}

      <div
        ref={scroller}
        id={listboxId}
        role="listbox"
        aria-label={query ? `Results for ${query}` : 'Emoji'}
        className="emoji-picker__scroller"
        style={{ height: VIEW_HEIGHT }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {index && !error && flat.length > 0 && (
          <div className="emoji-picker__pin" aria-hidden="true">
            {sectionLabel(rows, currentSection)}
          </div>
        )}
        {body}
      </div>

      <div className="emoji-picker__foot">
        {shown ? (
          <>
            <Emoji code={withTone(shown, tone).code} native={withTone(shown, tone).native} size={28} />
            <span className="emoji-picker__name">
              <span className="emoji-picker__title">{shown.n}</span>
              <span className="emoji-picker__code">:{shortcodeOf(shown)}:</span>
            </span>
          </>
        ) : (
          <span className="emoji-picker__hint">{index ? 'Pick an emoji' : ' '}</span>
        )}
        {onRemove && (
          <button type="button" className="emoji-picker__remove" onClick={onRemove}>
            {removeLabel}
          </button>
        )}
      </div>
    </div>
  );
};
