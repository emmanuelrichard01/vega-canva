import React, { useEffect, useId, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { emojiIndexNow, loadEmojiIndex, searchEmoji, shortcodeOf, subscribeEmojiIndex, type EmojiEntry } from '../../engine/emoji/emojiIndex';
import { pushRecentEmoji, skinTone, withTone } from '../../engine/emoji/emojiPrefs';
import { applyShortcode, shortcodeAt, type ShortcodeQuery } from '../../engine/emoji/shortcode';
import { PORTAL_SURFACE_ATTR } from '../ui/portalSurface';
import { Emoji } from './Emoji';
import './emoji.css';

type Field = HTMLInputElement | HTMLTextAreaElement;

const MAX_SUGGESTIONS = 6;

export interface EmojiAutocomplete {
  /** Run first in the field's own keydown; returns true when it handled the key. */
  onKeyDown: (e: React.KeyboardEvent<Field>) => boolean;
  /** Call from the field's change and select handlers. */
  sync: () => void;
  /** Close without inserting, e.g. on blur. */
  dismiss: () => void;
  /** The suggestion list, portalled beside the field. Render it anywhere. */
  menu: React.ReactNode;
  /** ARIA wiring to spread onto the field. */
  fieldProps: { 'aria-autocomplete': 'list'; 'aria-controls'?: string; 'aria-activedescendant'?: string; 'aria-expanded': boolean };
}

/**
 * `:smile` → 😄 in any text field where emoji are allowed.
 *
 * Typing a colon and two letters opens a short list under the field;
 * arrows move, Enter or Tab inserts, Escape closes and leaves the text alone.
 * The catalogue is fetched the first time a query is typed, so a field that
 * never sees a colon costs nothing.
 *
 * The field stays controlled by its owner: insertion goes through `setValue`
 * and the caret is restored after React has written the new value.
 */
export function useEmojiAutocomplete(
  ref: React.RefObject<Field | null>,
  setValue: (next: string) => void
): EmojiAutocomplete {
  const id = useId();
  const index = useSyncExternalStore(subscribeEmojiIndex, emojiIndexNow, emojiIndexNow);
  const [query, setQuery] = useState<ShortcodeQuery | null>(null);
  const [active, setActive] = useState(0);
  const [caretAfter, setCaretAfter] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const results = useMemo<EmojiEntry[]>(
    () => (index && query ? searchEmoji(index, query.query, MAX_SUGGESTIONS) : []),
    [index, query]
  );

  useEffect(() => {
    if (query && !index) loadEmojiIndex().catch(() => setQuery(null));
  }, [query, index]);

  useLayoutEffect(() => {
    if (caretAfter === null) return;
    ref.current?.setSelectionRange(caretAfter, caretAfter);
    setCaretAfter(null);
  }, [caretAfter, ref]);

  const sync = () => {
    const el = ref.current;
    if (!el) return;
    const q = shortcodeAt(el.value, el.selectionStart ?? el.value.length);
    setQuery((prev) => (prev?.start === q?.start && prev?.query === q?.query ? prev : q));
    if (q) setRect(el.getBoundingClientRect());
    if (!q || q.query !== query?.query) setActive(0);
  };

  const insert = (entry: EmojiEntry) => {
    const el = ref.current;
    if (!el || !query) return;
    const { native } = withTone(entry, skinTone());
    const next = applyShortcode(el.value, query, native);
    pushRecentEmoji(native);
    setValue(next.text);
    setCaretAfter(next.caret);
    setQuery(null);
  };

  const open = Boolean(query && results.length > 0);

  const onKeyDown = (e: React.KeyboardEvent<Field>): boolean => {
    if (!open || e.nativeEvent.isComposing) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + results.length) % results.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      insert(results[Math.min(active, results.length - 1)]);
    } else if (e.key === 'Escape') {
      setQuery(null);
    } else {
      return false;
    }
    e.preventDefault();
    e.stopPropagation();
    return true;
  };

  const listId = `${id}-emoji`;
  const optionId = (i: number) => `${id}-emoji-${i}`;

  const menu =
    open && rect && typeof document !== 'undefined'
      ? createPortal(
          <ul
            id={listId}
            role="listbox"
            aria-label="Emoji suggestions"
            className="emoji-suggest"
            {...{ [PORTAL_SURFACE_ATTR]: '' }}
            style={{ left: rect.left, top: rect.bottom + 4, minWidth: Math.min(rect.width, 260) }}
          >
            {results.map((entry, i) => {
              const toned = withTone(entry, skinTone());
              return (
                <li
                  key={entry.c}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className="emoji-suggest__item"
                  onMouseDown={(e) => {
                    // Keep focus in the field, so the caret survives the insert.
                    e.preventDefault();
                    insert(entry);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <Emoji code={toned.code} native={toned.native} size={18} />
                  <span className="emoji-suggest__code">:{shortcodeOf(entry)}:</span>
                </li>
              );
            })}
          </ul>,
          document.body
        )
      : null;

  return {
    onKeyDown,
    sync,
    dismiss: () => setQuery(null),
    menu,
    fieldProps: {
      'aria-autocomplete': 'list',
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open ? optionId(Math.min(active, results.length - 1)) : undefined,
      'aria-expanded': open,
    },
  };
}
