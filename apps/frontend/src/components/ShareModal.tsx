import React, { useState } from 'react';
import { AlertCircle, Check, Copy, Hash, Info, Link as LinkIcon, X, MessageSquare, Edit3, Eye } from 'lucide-react';
import { formatRoomCode, roomCodeFor } from '../engine/room/roomCode';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { RoomRole } from '../engine/model/permissions';

interface ShareModalProps {
  onClose: () => void;
}

type Copied = 'link' | 'code' | null;

/** Declared once so the three buttons cannot drift apart in styling or order. */
const MODES: ReadonlyArray<{ id: RoomRole; label: string; Icon: typeof Edit3 }> = [
  { id: 'editor', label: 'Edit', Icon: Edit3 },
  { id: 'commenter', label: 'Comment', Icon: MessageSquare },
  { id: 'viewer', label: 'View', Icon: Eye },
];

export const ShareModal: React.FC<ShareModalProps> = ({ onClose }) => {
  const [selectedRole, setSelectedRole] = useState<RoomRole>('editor');
  const [copied, setCopied] = useState<Copied>(null);
  const [failed, setFailed] = useState(false);
  const dialogRef = useFocusTrap(true, onClose);

  const roomId = window.location.pathname.split('/room/')[1]?.split(/[/?#]/)[0] ?? '';
  const baseLink = `${window.location.origin}/room/${roomId}`;
  const roleQuery = selectedRole === 'editor' ? '' : `?role=${selectedRole}`;
  const link = `${baseLink}${roleQuery}`;

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
              Anyone with this link can open and edit the board.
            </p>
          </div>
          <button className="share__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/*
          * A mode, not a permission. See `engine/model/permissions.ts`.
          *
          * The buttons were three copies of the same twenty inline style
          * properties, with their own hex fallbacks (#6366f1, #333, #888) for
          * tokens this project already defines -- so the one control in the
          * app that did not follow the theme was the one people would send to
          * strangers. It is a class and a modifier now, and the palette is
          * the palette.
          */}
        <div className="share__modes" role="group" aria-label="Open the link in">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              // `aria-pressed` alone drives the lit state, in CSS. A parallel
              // `is-active` class would be a second copy of the same fact,
              // and the one that goes stale is always the accessible one.
              aria-pressed={selectedRole === id}
              className="share__mode"
              onClick={() => setSelectedRole(id)}
            >
              <Icon size={13} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <div className="share__field">
          <LinkIcon size={15} aria-hidden="true" />
          <input
            type="text"
            readOnly
            value={link}
            aria-label="Link to this board"
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
            The short code opens the same board from the join bar, for when a
            link is awkward to pass along — read it out, and it carries the
            same full access the link does.
          </p>
        )}

        {failed && (
          <p className="share__failed" role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            The browser would not let us copy that. Select it above and copy
            it yourself.
          </p>
        )}

        <p className="share__caveat">
          <Info size={13} aria-hidden="true" />
          <span>
            {selectedRole === 'editor'
              ? 'There are no accounts on this board: the link is the key. Anyone who has it can edit, and a link cannot be taken back once it is out.'
              : selectedRole === 'commenter'
              ? 'This opens the board with the drawing tools put away, which is a convenience for the person opening it — not a restriction. They can switch to editing at any time.'
              : 'This opens the board read-only, which is a convenience for the person opening it — not a restriction. They can switch to editing at any time.'}
          </span>
        </p>
      </div>
    </div>
  );
};
