import React from 'react';
import { Search, Smile } from 'lucide-react';
import {
  EMOJI,
  EMOJI_CATEGORIES,
  SKIN_TONES,
  pushRecentEmoji,
  readRecentEmoji,
  readSkinTone,
  searchEmoji,
  withTone,
  writeSkinTone,
  type EmojiEntry,
  type SkinTone,
} from '../../engine/comments/emoji';

/**
 * The browse path, for when you do not know the name.
 *
 * ## Why this exists alongside `:shortcode`
 *
 * Typing `:fi` and pressing Enter is faster than any picker, and it is the path
 * this feature is really built around — the shortcode is shown beside every
 * result there so the picker teaches you out of needing it. But a shortcode
 * only helps once you know it exists, and "the one with the little chart going
 * up" has no name you can guess. A grid answers that; a text trigger cannot.
 *
 * So: two ways in, one catalogue, and the picker is the discoverable one
 * rather than the primary one. It is a 26px button beside the composer, not a
 * permanent panel.
 *
 * ## Recents first, and why they are stored as characters
 *
 * The list holds the **rendered** character, tone already applied, rather than
 * a shortcode. Somebody who has set a tone wants their recents in it, and a
 * name plus a tone recombined at read time is two facts to keep in step for no
 * benefit — the character is what was inserted and what goes back in.
 */
export const EmojiPicker: React.FC<{
  onPick: (char: string) => void;
  /** Which way the panel opens, since the composer sits at either end of a thread. */
  placement?: 'up' | 'down';
}> = ({ onPick, placement = 'up' }) => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [tone, setTone] = React.useState<SkinTone>('');
  const [recents, setRecents] = React.useState<string[]>([]);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setTone(readSkinTone());
    setRecents(readRecentEmoji());
    window.setTimeout(() => searchRef.current?.focus(), 0);

    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Stops here. The composer's own Escape closes the whole draft, and
      // dismissing a picker must never throw away the message behind it —
      // the same rule the mention picker follows.
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const pick = (entry: EmojiEntry | string) => {
    const char = typeof entry === 'string' ? entry : withTone(entry, tone);
    setRecents(pushRecentEmoji(char));
    onPick(char);
    setOpen(false);
  };

  const results = query.trim() ? searchEmoji(query, 64) : null;

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="emoji-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Insert emoji"
        data-tooltip="Emoji  ·  or type : to search"
        // `mousedown` is prevented so the textarea keeps focus while the panel
        // opens: the caret position is where the emoji is going, and a blur
        // would move it to the end of the message.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <Smile size={15} aria-hidden="true" />
      </button>

      {open && (
        <div
          className="emoji-panel panel-surface"
          role="dialog"
          aria-label="Emoji"
          style={placement === 'up' ? { bottom: 32, right: 0 } : { top: 32, right: 0 }}
        >
          <div className="emoji-panel__search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search — try done, bug, ship"
              aria-label="Search emoji"
              spellCheck={false}
            />
          </div>

          <div className="emoji-panel__body custom-scrollbar">
            {results ? (
              results.length ? (
                <div className="emoji-grid">
                  {results.map((entry) => (
                    <button
                      key={entry.name}
                      type="button"
                      className="emoji-cell"
                      title={`:${entry.name}`}
                      aria-label={entry.name}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(entry)}
                    >
                      {withTone(entry, tone)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="emoji-panel__label" style={{ textTransform: 'none', letterSpacing: 0 }}>
                  Nothing matches “{query.trim()}”.
                </p>
              )
            ) : (
              <>
                {recents.length > 0 && (
                  <>
                    <div className="emoji-panel__label">Recent</div>
                    <div className="emoji-grid">
                      {recents.map((char) => (
                        <button
                          key={char}
                          type="button"
                          className="emoji-cell"
                          aria-label={`Recently used ${char}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pick(char)}
                        >
                          {char}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {EMOJI_CATEGORIES.map((cat) => {
                  const items = EMOJI.filter((x) => x.category === cat.id);
                  if (!items.length) return null;
                  return (
                    <React.Fragment key={cat.id}>
                      <div className="emoji-panel__label">{cat.label}</div>
                      <div className="emoji-grid">
                        {items.map((entry) => (
                          <button
                            key={entry.name}
                            type="button"
                            className="emoji-cell"
                            title={`:${entry.name}`}
                            aria-label={entry.name}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pick(entry)}
                          >
                            {withTone(entry, tone)}
                          </button>
                        ))}
                      </div>
                    </React.Fragment>
                  );
                })}
              </>
            )}
          </div>

          {/*
            The tone strip, set once.

            Deliberately at the foot rather than the head: it is a preference
            you touch on your first day and never again, and putting it above
            the search field would make every visit start by scanning past it.
            The chosen tone is written to `localStorage` immediately, so it is
            already right the next time the panel opens or a `:shortcode` is
            accepted — the two paths read the same preference.
          */}
          <div className="emoji-panel__foot">
            <span className="emoji-panel__foot-label">Skin tone</span>
            {SKIN_TONES.map((t) => (
              <button
                key={t || 'none'}
                type="button"
                className="emoji-tone"
                data-on={t === tone || undefined}
                aria-pressed={t === tone}
                aria-label={t ? `Skin tone ${SKIN_TONES.indexOf(t)}` : 'Default skin tone'}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setTone(t);
                  // Written here rather than on close: a panel dismissed by
                  // clicking away has no close handler to run.
                  writeSkinTone(t);
                }}
              >
                {`✋${t}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
