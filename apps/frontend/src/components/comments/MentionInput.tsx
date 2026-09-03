import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { initialsFor } from '../../engine/presence/collaborators';
import {
  activeMentionQuery,
  rankMentions,
  toDisplayForm,
  toStoredForm,
  type MentionCandidate,
} from '../../engine/comments/threads';
import {
  activeEmojiQuery,
  pushRecentEmoji,
  readSkinTone,
  searchEmoji,
  withTone,
  type EmojiEntry,
} from '../../engine/comments/emoji';

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
  /**
   * A handle for putting text in at the caret, from outside.
   *
   * The emoji button sits in the composer's toolbar, next to Post — it is not
   * inside this component and cannot be, because it belongs to the row of
   * actions. But the caret does live here, and "insert at the caret" is the
   * only behaviour worth having: appending to the end means every emoji picked
   * mid-sentence has to be dragged back into place.
   *
   * A ref rather than a prop, because this is an *event* the parent causes
   * rather than state it owns. Modelling it as state would mean a value that
   * has to be cleared after it is consumed, which is the shape that produces
   * "it inserted twice".
   */
  insertRef?: React.MutableRefObject<((text: string) => void) | null>;
  'aria-label'?: string;
}

export const MentionInput: React.FC<MentionInputProps> = ({
  value,
  onChange,
  onSubmit,
  candidates,
  placeholder,
  rows = 2,
  autoFocus,
  onCancel,
  inputRef,
  insertRef,
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

  /**
   * Two triggers, one mechanism.
   *
   * `@` names a person and `:` names an emoji, and they are the same gesture:
   * a character, a partial word, a ranked list, Enter. `activeEmojiQuery`
   * returns the identical `{ from, to, query }` shape as `activeMentionQuery`
   * precisely so this component holds one picker rather than two — the caret
   * tracking, the dismissal rule and the keyboard handling below are hard
   * enough to get right once.
   */
  const mentionQuery = useMemo(() => {
    const found = activeMentionQuery(display, caret);
    if (!found) return null;
    if (dismissedAt !== null && found.from === dismissedAt) return null;
    return found;
  }, [display, caret, dismissedAt]);

  const emojiQuery = useMemo(() => {
    const found = activeEmojiQuery(display, caret);
    if (!found) return null;
    if (dismissedAt !== null && found.from === dismissedAt) return null;
    return found;
  }, [display, caret, dismissedAt]);

  /**
   * When both could fire, the one nearer the caret wins.
   *
   * `@dana :fi` has a live `@` behind it and a live `:` in front of it, and
   * the person is typing the second one. Taking the later `from` is what
   * "the one you are typing" means, and it needs no state to remember which
   * trigger opened — which matters, because the answer changes as the caret
   * moves back through the line.
   */
  const mode: 'mention' | 'emoji' | null =
    mentionQuery && emojiQuery
      ? mentionQuery.from > emojiQuery.from
        ? 'mention'
        : 'emoji'
      : mentionQuery
        ? 'mention'
        : emojiQuery
          ? 'emoji'
          : null;

  const query = mode === 'emoji' ? emojiQuery : mentionQuery;

  const matches = useMemo(
    () => (mode === 'mention' && mentionQuery ? rankMentions(candidates, mentionQuery.query) : []),
    [mode, mentionQuery, candidates]
  );

  // Eight is what fits the picker without scrolling, and a shortcode long
  // enough to be ambiguous past eight is long enough to finish typing.
  const emojiMatches = useMemo(
    () => (mode === 'emoji' && emojiQuery ? searchEmoji(emojiQuery.query, 8) : []),
    [mode, emojiQuery]
  );

  const count = mode === 'emoji' ? emojiMatches.length : matches.length;
  const open = !!query && count > 0;

  /**
   * Put text where the trigger was, and the caret after it.
   *
   * Shared by both triggers because the splice is identical — only what goes
   * in differs. The trailing space is part of it: a mention or an emoji is
   * almost never the last thing in a sentence, and typing the space yourself
   * after every one is the kind of friction nobody reports and everybody
   * feels.
   */
  const splice = useCallback(
    (token: string) => {
      if (!query) return;
      const next = `${display.slice(0, query.from)}${token} ${display.slice(query.to)}`;
      emit(next);
      setDismissedAt(null);
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

  const acceptEmoji = useCallback(
    (entry: EmojiEntry) => {
      const char = withTone(entry, readSkinTone());
      pushRecentEmoji(char);
      splice(char);
    },
    [splice]
  );

  const accept = useCallback(
    (candidate: MentionCandidate) => {
      if (!query) return;
      // The readable form goes in the box; the id goes in the map. Recorded
      // before `emit`, because the encode reads it.
      mentions.current.set(candidate.name, candidate.id);
      // The caret lands after the token rather than at the end of the message —
      // people mention someone mid-sentence and keep typing. `splice` owns that
      // now, and the emoji trigger gets it for free.
      splice(`@${candidate.name}`);
    },
    [query, splice]
  );

  /**
   * Insert text where the caret is, for a control outside this component.
   *
   * The selection is read off the **live element** rather than the `caret`
   * state, because the two can differ at exactly the moment this is called: the
   * emoji button prevents its own `mousedown` so the textarea keeps focus, but
   * nothing guarantees a `select` event fired for whatever the person did
   * immediately before reaching for it. The DOM is the authority on where the
   * caret is; the state is a copy kept for rendering.
   *
   * Falls back to the end of the text, which is where an insertion belongs
   * when there is no caret to speak of.
   */
  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (text: string) => {
      const el = ref.current;
      const at = el?.selectionStart ?? display.length;
      const to = el?.selectionEnd ?? at;
      const next = `${display.slice(0, at)}${text}${display.slice(to)}`;
      emit(next);
      const after = at + text.length;
      requestAnimationFrame(() => {
        const node = ref.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(after, after);
        setCaret(after);
      });
    };
    return () => {
      insertRef.current = null;
    };
  }, [insertRef, display, emit, ref]);

  /**
   * The box is the size of what is in it.
   *
   * It was a fixed three rows, which is 81px of empty field for the one-line
   * message most comments are — and still not enough for a long one, so the
   * number was wrong in both directions at once. Any fixed height is: a
   * composer is asked to hold anything from "yes" to a paragraph.
   *
   * So it starts at two rows and grows with the text, to a cap. The cap
   * matters as much as the growth: a composer that keeps growing pushes the
   * thread it belongs to off the screen, and past about six lines the right
   * answer is to scroll the field rather than the conversation.
   *
   * `height: auto` before reading `scrollHeight` is the whole trick — without
   * it the element reports its *current* height whenever the text shrinks, so
   * deleting a paragraph leaves the box the size the paragraph made it.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [display, ref]);

  const syncCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) =>
    setCaret(e.currentTarget.selectionStart ?? 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % count);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + count) % count);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const at = Math.min(highlight, count - 1);
        if (mode === 'emoji') acceptEmoji(emojiMatches[at]);
        else accept(matches[at]);
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
        <div
          className="mention-picker"
          role="listbox"
          aria-label={mode === 'emoji' ? 'Emoji' : 'People'}
        >
          {mode === 'emoji'
            ? emojiMatches.map((entry, index) => (
                <button
                  key={entry.name}
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  className="mention-option"
                  data-active={index === highlight}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    acceptEmoji(entry);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  {/* The character at reading size, then the shortcode that
                      found it — so the next time, the shortcode is typed
                      directly and the picker never opens. A picker that
                      teaches you not to need it is doing its job. */}
                  <span className="emoji-option__char">{withTone(entry, readSkinTone())}</span>
                  <span className="emoji-option__name">:{entry.name}</span>
                </button>
              ))
            : matches.map((candidate, index) => (
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
                  onMouseDown={(ev) => {
                    ev.preventDefault();
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
