import React, { useCallback, useMemo, useRef, useState } from 'react';
import { initialsFor } from '../../engine/presence/collaborators';
import {
  activeMentionQuery,
  encodeMention,
  rankMentions,
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
 * The value is the **stored** form — `@[Dana Ito](user_7)` — not what is on
 * screen. Rendering the pretty form inside a `<textarea>` is not possible
 * without a contenteditable rich-text layer, and that is a much larger and
 * much buggier surface than this feature justifies. The trade is that a
 * half-typed mention looks like markup for the moment before it is picked;
 * once picked, the token is atomic to backspace because it deletes as a run of
 * characters, which is the same thing every plain-text mention field does.
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

  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  // Dismissing the picker must not immediately reopen it on the next keystroke
  // that happens to leave the caret in the same `@word`.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const query = useMemo(() => {
    const found = activeMentionQuery(value, caret);
    if (!found) return null;
    if (dismissedAt !== null && found.from === dismissedAt) return null;
    return found;
  }, [value, caret, dismissedAt]);

  const matches = useMemo(
    () => (query ? rankMentions(candidates, query.query) : []),
    [query, candidates]
  );

  const open = !!query && matches.length > 0;

  const accept = useCallback(
    (candidate: MentionCandidate) => {
      if (!query) return;
      const token = encodeMention(candidate.name, candidate.id);
      const next = `${value.slice(0, query.from)}${token} ${value.slice(query.to)}`;
      onChange(next);
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
    [query, value, onChange, ref]
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
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => {
          onChange(e.target.value);
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
