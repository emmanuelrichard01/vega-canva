import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Shuffle, X } from 'lucide-react';
import { Avatar } from './ui/Avatar';
import { useAuth } from '../hooks/useAuth';
import { useRoomState } from '../hooks/useSync';
import { provider } from '../engine/document';
import {
  ACCESSORY_COUNT,
  BACKDROPS,
  FACE_COUNT,
  HAIR_COLORS,
  HAIR_COUNT,
  SKINS,
  avatarFromId,
  cycle,
  decodeAvatar,
  encodeAvatar,
  randomAvatar,
  type AvatarSpec,
} from '../engine/presence/avatar';

/** The six dimensions, in the order they read as a face being built. */
const DIMENSIONS: Array<{ key: keyof AvatarSpec; label: string; count: number }> = [
  { key: 'skin', label: 'Skin', count: SKINS.length },
  { key: 'hair', label: 'Hair', count: HAIR_COUNT },
  { key: 'hairColor', label: 'Hair colour', count: HAIR_COLORS.length },
  { key: 'face', label: 'Expression', count: FACE_COUNT },
  { key: 'accessory', label: 'Details', count: ACCESSORY_COUNT },
  { key: 'bg', label: 'Backdrop', count: BACKDROPS.length },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Your name and your face, edited where you already look to check them.
 *
 * ## Why a face is built rather than uploaded
 *
 * The obvious feature is "upload a photo", and it is the wrong one here for a
 * reason that is structural rather than aesthetic. An avatar has to reach
 * every other person in the room, and the channel it reaches them on is
 * awareness — the ephemeral state that also carries a cursor and is therefore
 * rebroadcast many times a second to every peer. A picture on that channel is
 * a photograph on the wire at pointer frequency. See
 * `engine/presence/avatar.ts`: what travels is eleven characters, and the
 * drawing is a pure function of them, which also means it is crisp at the 20px
 * comment pin and the 96px tile here rather than one bitmap stretched twice.
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
  const [spec, setSpec] = useState<AvatarSpec | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * The face to open on: theirs if they have one, otherwise the one seeded
   * from their id.
   *
   * Seeded rather than random, so opening this twice offers the same starting
   * face and "keep it" is a real answer. A random face on every open means the
   * only path forward is to build one from scratch. See `avatarFromId`.
   */
  const starting = useMemo(
    () => (user ? (decodeAvatar(user.avatar) ?? avatarFromId(user.id)) : null),
    [user]
  );

  useEffect(() => {
    if (!open || !user) return;
    setName(user.name);
    setSpec(starting);
  }, [open, user, starting]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !user || !spec) return null;

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
    updateProfile({
      // An empty field is a slip, not an instruction to become nameless.
      name: trimmed || user.name,
      avatar: encodeAvatar(spec),
    });
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
            {/* The face at the size it is being made, and again at the size it
                will actually be seen — a 96px tile says nothing about whether
                the glasses read on a cursor chip. */}
            <Avatar name={trimmed || user.name} color={liveColor} avatar={spec} size={112} />
            <div className="profile-editor__sizes" aria-hidden="true">
              <Avatar name={trimmed || user.name} color={liveColor} avatar={spec} size={32} />
              <Avatar name={trimmed || user.name} color={liveColor} avatar={spec} size={24} />
              <Avatar name={trimmed || user.name} color={liveColor} avatar={spec} size={20} />
            </div>
            <button
              type="button"
              className="profile-editor__shuffle"
              onClick={() => setSpec(randomAvatar())}
            >
              <Shuffle size={14} aria-hidden /> Surprise me
            </button>
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

            <div className="profile-editor__dims" role="group" aria-label="Face">
              {DIMENSIONS.map(({ key, label, count }) => (
                <div key={key} className="profile-dim">
                  <span className="profile-dim__label">{label}</span>
                  <div className="profile-dim__control">
                    <button
                      type="button"
                      onClick={() => setSpec(cycle(spec, key, -1))}
                      aria-label={`Previous ${label.toLowerCase()}`}
                    >
                      <ChevronLeft size={14} />
                    </button>
                    {/* The position in the list, so cycling has a sense of
                        extent — otherwise there is no way to know whether you
                        have seen them all. */}
                    <span className="profile-dim__count">
                      {spec[key] + 1}/{count}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSpec(cycle(spec, key, 1))}
                      aria-label={`Next ${label.toLowerCase()}`}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

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
