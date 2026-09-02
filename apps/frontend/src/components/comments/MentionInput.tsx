import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { initialsFor } from '../../engine/presence/collaborators';
import {
  activeMentionQuery,
  rankMentions,
  toDisplayForm,
  toStoredForm,
  type MentionCandidate,
} from '../../engine/comments/threads';

/**
 * A comment composer that can name people.
 *
 * Typing `@` opens a picker; arrows move, Enter or Tab accepts, Escape closes
 * it *without* closing the composer behind it. That last part is the detail
 * people notice: a picker that swallows nothing and a composer that vanishes
 * when you dismiss a suggestion are both maddening, and the two are one
 * keystroke apart.
 *
 * ## The textarea shows `@Dana Ito`, and the props stay the stored form
 *
 * This component used to put the **stored** form straight into the textarea,
 * so picking a name from the picker replaced what you had typed with
 * `@[Dana Ito](1873456102)` and left it sitting there while you finished the
 * sentence. The justification was that rendering the pretty form needs a
 * contenteditable rich-text layer, which is a far larger and buggier surface
 * than this feature justifies — true, and it skips the third option: keep the
 * textarea plain, show the *display* form in it, and carry the ids in a map
 * beside the text instead of inline in it.
 *
 * So the conversion lives here and the boundary does not move. `value` and
 * `onChange` are still the stored form, which is what the document holds and
 * what every caller already passes; only what a person looks at changed.
 *
 * The map is seeded from `value` on the way in, so **editing an existing
 * message** shows real names too — that path handed the raw markup back into
 * the box as well.
 */

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter without Shift. Returns nothing; the parent decides what to commit. */
  onSubmit: () => void;
  candidates: MentionCandidate[];
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  /** Escape when no picker is open — usually "close the composer". */
  onCancel?: () => void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  'aria-label'?: string;
}

export const MentionInput: React.FC<MentionInputProps> = ({
  value,
  onChange,
  onSubmit,
  candidates,
  placeholder,
  rows = 3,
  autoFocus,
  onCancel,
  inputRef,
  'aria-label': ariaLabel,
}) => {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;

  /**
   * What is in the box, and the ids for the names in it.
   *
   * Held here rather than derived from `value` on every render, because the
   * mapping is one-way: display text plus ids gives the stored form, and the
   * stored form gives display text — but a re-derivation on each keystroke
   * would drop the ids of any mention the person has since typed *around*.
   */
  const [display, setDisplay] = useState(() => toDisplayForm(value).text);
  const mentions = useRef(toDisplayForm(value).mentions);

  /** The last stored string this component sent up. See the effect below. */
  const lastEmitted = useRef(value);

  /**
   * Adopt a `value` this component did not produce.
   *
   * The parent clears the box after a submit and loads a different message
   * when an edit starts, and both must replace what is on screen. An ordinary
   * keystroke must not: it arrives back as the same string that was just sent
   * up, and re-deriving the display text from it would reset the caret to the
   * end mid-sentence.
   *
   * Comparing against what was last emitted distinguishes the two exactly, and
   * without reading `display` — so the effect depends on `value` alone and
   * says what it means, rather than depending on state it must not react to.
   */
  useEffect(() => {
    if (lastEmitted.current === value) return;
    const next = toDisplayForm(value);
    mentions.current = next.mentions;
    lastEmitted.current = value;
    setDisplay(next.text);
  }, [value]);

  const emit = useCallback(
    (nextDisplay: string) => {
      const stored = toStoredForm(nextDisplay, mentions.current);
      lastEmitted.current = stored;
      setDisplay(nextDisplay);
      onChange(stored);
    },
    [onChange]
  );

  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  // Dismissing the picker must not immediately reopen it on the next keystroke
  // that happens to leave the caret in the same `@word`.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const query = useMemo(() => {
    const found = activeMentionQuery(display, caret);
    if (!found) return null;
    if (dismissedAt !== null && found.from === dismissedAt) return null;
    return found;
  }, [display, caret, dismissedAt]);

  const matches = useMemo(
    () => (query ? rankMentions(candidates, query.query) : []),
    [query, candidates]
  );

  const open = !!query && matches.length > 0;

  const accept = useCallback(
    (candidate: MentionCandidate) => {
      if (!query) return;
      // The readable form goes in the box; the id goes in the map. Recorded
      // before `emit`, because the encode reads it.
      mentions.current.set(candidate.name, candidate.id);
      const token = `@${candidate.name}`;
      const next = `${display.slice(0, query.from)}${token} ${display.slice(query.to)}`;
      emit(next);
      setDismissedAt(null);

      // Put the caret after the inserted token, not at the end of the message —
      // people mention someone mid-sentence and keep typing.
      const at = query.from + token.length + 1;
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(at, at);
        setCaret(at);
      });
    },
    [query, display, emit, ref]
  );

  const syncCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) =>
    setCaret(e.currentTarget.selectionStart ?? 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        accept(matches[Math.min(highlight, matches.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        // Stops here. The composer's own Escape handler must not also fire, or
        // dismissing a suggestion throws away the message you were writing.
        e.preventDefault();
        e.stopPropagation();
        setDismissedAt(query?.from ?? null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key === 'Escape' && onCancel) {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={ref}
        value={display}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => {
          emit(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
          setHighlight(0);
          setDismissedAt(null);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onSelect={syncCaret}
        className="comment-composer"
      />

      {open && (
        <div className="mention-picker" role="listbox" aria-label="People">
          {matches.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              aria-selected={index === highlight}
              className="mention-option"
              data-active={index === highlight}
              // `mousedown` rather than `click`: the textarea loses focus on
              // mousedown, and a blur handler that closes the picker would
              // otherwise unmount this button before its click ever lands.
              onMouseDown={(e) => {
                e.preventDefault();
                accept(candidate);
              }}
              onMouseEnter={() => setHighlight(index)}
            >
              <span className="mention-avatar" style={{ background: candidate.color }}>
                {initialsFor(candidate.name)}
              </span>
              {candidate.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
