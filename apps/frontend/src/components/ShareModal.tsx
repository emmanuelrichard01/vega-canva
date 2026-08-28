import React, { useState } from 'react';
import { AlertCircle, Check, Copy, Hash, Link as LinkIcon, X } from 'lucide-react';
import { formatRoomCode, roomCodeFor } from '../engine/room/roomCode';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ShareModalProps {
  onClose: () => void;
}

/**
 * The invitation, which on this product is the entire permission model.
 *
 * ## What it was
 *
 * A title, a sentence, and a link in a box — every rule of it written inline,
 * which is why the copy button had no hover state and why its "copied" style
 * painted `--amber-500` with white text. That is a raw palette primitive
 * rather than the accent role, and white on it measures 2.13:1: the button
 * became unreadable at the exact moment it was confirming success.
 *
 * ## What it says now
 *
 * The same three things, said accurately. The link is rebuilt from the room
 * id rather than echoed from `location.href`, which carried whatever query or
 * hash happened to be in the address bar into an invitation meant to last.
 * The board is called a board, which is what the rest of the product calls
 * it. And the consequence of sending it is stated plainly rather than
 * softened: there are no accounts and no roles here, so a link is not an
 * invitation to *view* — it is full access, permanently, to anyone who ends
 * up holding it.
 *
 * A copy that fails now says so. It used to log to the console and leave the
 * button reading "Copy", which is indistinguishable from not having pressed
 * it — and on an insecure origin or with the permission denied, that is the
 * common case rather than the rare one.
 */
type Copied = 'link' | 'code' | null;

export const ShareModal: React.FC<ShareModalProps> = ({ onClose }) => {
  const [copied, setCopied] = useState<Copied>(null);
  const [failed, setFailed] = useState(false);
  const dialogRef = useFocusTrap(true, onClose);

  /**
   * Built, not echoed.
   *
   * `window.location.href` carries the current query string and hash — a
   * pending template, a deep link to a comment, anything the app put there —
   * into a URL someone will paste into a chat and other people will open
   * months later.
   */
  const roomId = window.location.pathname.split('/room/')[1]?.split(/[/?#]/)[0] ?? '';
  const link = `${window.location.origin}/room/${roomId}`;

  /**
   * The same board, in a form somebody can read to a room.
   *
   * Not a shortened alias -- there is nowhere to keep one, and a short alias
   * would be a weaker way into a board than the link it stands for. It is this
   * board's id written in Crockford's Base32, carrying every bit and adding a
   * check symbol. See `engine/room/roomCode.ts`.
   *
   * `null` for a board whose id this cannot encode, which means a hand-edited
   * link or a much older build. Those boards are fine and their links work;
   * there is simply nothing honest to print here, so the row is not drawn.
   */
  const code = roomCodeFor(roomId);

  const copy = (what: 'link' | 'code', text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setFailed(false);
        setCopied(what);
        window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 2200);
      },
      () => setFailed(true)
    );
  };

  return (
    <div className="share" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        aria-describedby="share-desc"
        className="share__panel panel-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="share__head">
          <div>
            <h2 id="share-title" className="share__title">Invite people to this board</h2>
            <p id="share-desc" className="share__lede">
              Whoever opens this link is in. No account, nothing to accept.
            </p>
          </div>
          <button className="share__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="share__field">
          <LinkIcon size={15} aria-hidden="true" />
          <input
            type="text"
            readOnly
            value={link}
            aria-label="Link to this board"
            // Selecting on focus as well as on click, so the keyboard path
            // reaches the same state the pointer one does.
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
          />
          <button
            className={`share__copy${copied === 'link' ? ' is-copied' : ''}`}
            onClick={() => copy('link', link)}
            aria-live="polite"
          >
            {copied === 'link' ? <Check size={14} /> : <Copy size={14} />}
            {copied === 'link' ? 'Copied' : 'Copy'}
          </button>
        </div>

        {/* For the times a link cannot be clicked: read out on a call, typed
            off a screen, written on a wall. Set in the same tabular face the
            rest of the app counts in, and grouped, because a wall of thirteen
            characters is read back wrong. */}
        {code && (
          <div className="share__field share__field--code">
            <Hash size={15} aria-hidden="true" />
            <input
              type="text"
              readOnly
              value={formatRoomCode(code)}
              aria-label="Room code for this board"
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
            />
            <button
              className={`share__copy${copied === 'code' ? ' is-copied' : ''}`}
              onClick={() => copy('code', formatRoomCode(code))}
              aria-live="polite"
            >
              {copied === 'code' ? <Check size={14} /> : <Copy size={14} />}
              {copied === 'code' ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}

        {code && (
          <p className="share__hint">
            Either one opens the board. The code can be typed into the box on
            the boards screen, in any case and with or without the dashes.
          </p>
        )}

        {failed && (
          <p className="share__failed" role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            The browser would not let us copy that. Select it above and copy
            it yourself.
          </p>
        )}

        {/* The thing a share sheet usually implies and this product cannot
            provide. Said here rather than discovered later. */}
        <p className="share__caveat">
          There are no permissions on this board. Anyone holding the link or
          the code can edit it, rename it, and delete what is on it, so send
          either one the way you would send a key rather than a newsletter.
        </p>
      </div>
    </div>
  );
};
