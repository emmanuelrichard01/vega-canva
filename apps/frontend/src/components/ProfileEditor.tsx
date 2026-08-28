import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { Avatar } from './ui/Avatar';
import { useAuth } from '../hooks/useAuth';
import { useRoomState } from '../hooks/useSync';
import { provider } from '../engine/document';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Your name, edited where you already look to check it.
 *
 * ## Why there is no picture to build
 *
 * This used to be a face builder: six dimensions with a cycler each, a shuffle
 * button, and a preview at four sizes. See the note in `ui/Avatar.tsx` for why
 * it went — briefly, a cartoon assembled from six lists is not what identifies
 * anyone on this board, the presence colour already is, and nobody had a face
 * until they came here and made one, so the roster had two appearances for one
 * kind of person.
 *
 * What is left is the one field that was always doing the work. A name is not
 * decoration: it is what the cursor label, the comment byline and the mention
 * list all read, and it is the only thing here that other people have to
 * recognise you by.
 *
 * ## Why the colour is shown but not chosen
 *
 * Presence colour is not a preference, it is an *allocation*: it is the only
 * thing that says who somebody is on a cursor, a selection ring or a radar
 * ping, and two people holding the same one are two people merged into one
 * everywhere at once. `resolvePresenceColor` hands it out against whoever else
 * is in the room, so offering a picker here would offer a choice the room is
 * entitled to overrule — a control that sometimes silently does nothing is
 * worse than no control. It is shown, named, and explained instead.
 */
export const ProfileEditor: React.FC<Props> = ({ open, onClose }) => {
  const { user, updateProfile } = useAuth();
  const { awarenessUsers } = useRoomState();
  const [name, setName] = useState(user?.name ?? '');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !user) return;
    setName(user.name);
  }, [open, user]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !user) return null;

  /**
   * The colour actually in use on this board, not the stored preference.
   *
   * They differ whenever somebody else got here first with the same hash —
   * which is the entire reason `resolvePresenceColor` exists. Showing the
   * preference beside a note explaining that the room decides would be the
   * panel contradicting itself in adjacent lines, and the swatch is the one
   * thing here a person can compare against their own cursor.
   */
  const mine = provider.awareness?.clientID;
  const liveColor =
    (mine !== undefined ? awarenessUsers.get(mine)?.user?.color : undefined) ?? user.color;

  const trimmed = name.trim();

  const save = () => {
    // An empty field is a slip, not an instruction to become nameless.
    updateProfile({ name: trimmed || user.name });
    onClose();
  };

  /**
   * Portaled to `<body>`, not rendered where it is mounted.
   *
   * This is opened from the avatar row, which lives in the header — and the
   * header carries a `backdrop-filter`, which makes it a containing block for
   * `position: fixed`. So the scrim, which is fixed and expects the viewport,
   * sized itself to the 52px header and hung the panel off the top of the
   * screen. `CommentsOverlay` documents the same trap for the same reason: a
   * fixed overlay has to escape any ancestor that has been given a transform,
   * a filter, or a backdrop.
   */
  return createPortal(
    <div className="export-scrim" onPointerDown={onClose} role="presentation">
      <div
        ref={panelRef}
        className="profile-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="profile-editor__head">
          <h2 id="profile-title">Your profile</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="profile-editor__body">
          <div className="profile-editor__preview">
            {/* Live: the disc is initials in the room's colour, so it changes
                as the field is typed and shows the edit before it is saved. */}
            <Avatar name={trimmed || user.name} color={liveColor} size={96} />
          </div>

          <div className="profile-editor__fields">
            <label className="profile-editor__field">
              <span>Display Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={user.name}
                maxLength={40}
                autoFocus
              />
            </label>

            {/* Shown and explained rather than offered. See the note above. */}
            <div className="profile-editor__colour">
              <span className="profile-editor__swatch" style={{ background: liveColor }} />
              <p>
                Each board gives you a colour no one else in the room is using.
                It is how people tell your cursor from everyone else's.
              </p>
            </div>
          </div>
        </div>

        <footer className="profile-editor__foot">
          <button className="export__ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="export__primary" onClick={save}>
            <Check size={14} aria-hidden /> Save changes
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
};
