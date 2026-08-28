import React, { useState } from 'react';
import { AlertCircle, Check, Copy, Link as LinkIcon, X } from 'lucide-react';
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
export const ShareModal: React.FC<ShareModalProps> = ({ onClose }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
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

  const copy = () => {
    navigator.clipboard.writeText(link).then(
      () => {
        setState('copied');
        window.setTimeout(() => setState('idle'), 2200);
      },
      () => setState('failed')
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
            className={`share__copy${state === 'copied' ? ' is-copied' : ''}`}
            onClick={copy}
            aria-live="polite"
          >
            {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
            {state === 'copied' ? 'Copied' : 'Copy'}
          </button>
        </div>

        {state === 'failed' && (
          <p className="share__failed" role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            The browser would not let us copy it. Select the link above and
            copy it yourself.
          </p>
        )}

        {/* The thing a share sheet usually implies and this product cannot
            provide. Said here rather than discovered later. */}
        <p className="share__caveat">
          There are no permissions on this board. Anyone holding the link can
          edit it, rename it, and delete what is on it, so send it the way you
          would send a key rather than a newsletter.
        </p>
      </div>
    </div>
  );
};
