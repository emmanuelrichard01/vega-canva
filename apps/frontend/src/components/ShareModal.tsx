import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Clock, Copy, Hash, Info, Link as LinkIcon, X, MessageSquare, Edit3, Eye } from 'lucide-react';
import { formatRoomCode, roomCodeFor } from '../engine/room/roomCode';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { inviteMintUrl } from '../utils/endpoints';
import { roomId as currentRoomId } from '../engine/document/doc';
import type { RoomRole } from '../engine/model/permissions';

interface ShareModalProps {
  onClose: () => void;
}

type Copied = 'link' | 'code' | null;

/** Declared once so the three buttons cannot drift apart in styling or order. */
const MODES: ReadonlyArray<{ id: RoomRole; label: string; Icon: typeof Edit3; blurb: string }> = [
  {
    id: 'editor',
    label: 'Edit',
    Icon: Edit3,
    blurb: 'Full access: draw, move, delete, and share it onward.',
  },
  {
    id: 'commenter',
    label: 'Comment',
    Icon: MessageSquare,
    blurb: 'Read the board and leave comments. The drawing tools stay away.',
  },
  {
    id: 'viewer',
    label: 'View',
    Icon: Eye,
    blurb: 'Read and export only. Edits are refused by the server, not just hidden.',
  },
];

/** How long a link may live. `0` is the default and means it does not expire. */
const EXPIRIES: ReadonlyArray<{ id: string; label: string; seconds: number }> = [
  { id: 'never', label: 'No expiry', seconds: 0 },
  { id: '24h', label: '24 hours', seconds: 24 * 60 * 60 },
  { id: '7d', label: '7 days', seconds: 7 * 24 * 60 * 60 },
  { id: '30d', label: '30 days', seconds: 30 * 24 * 60 * 60 },
];

type MintState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'ready'; url: string }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

export const ShareModal: React.FC<ShareModalProps> = ({ onClose }) => {
  const [selectedRole, setSelectedRole] = useState<RoomRole>('editor');
  const [expiry, setExpiry] = useState(EXPIRIES[0]);
  const [mint, setMint] = useState<MintState>({ kind: 'idle' });
  const [copied, setCopied] = useState<Copied>(null);
  const [failed, setFailed] = useState(false);
  const dialogRef = useFocusTrap(true, onClose);

  const roomId = currentRoomId;
  const fullAccessLink = `${window.location.origin}/room/${roomId}`;
  const code = roomCodeFor(roomId);

  /**
   * An edit link needs no minting.
   *
   * A signed token for `editor` grants exactly what the plain room link
   * already grants, so asking the server for one would add a round trip, a
   * failure mode and an expiry to a link that is the room's own address. The
   * restricted roles are the ones that have to be signed, because a role only
   * means something when somebody else decided it.
   */
  const needsToken = selectedRole !== 'editor';
  const link = needsToken && mint.kind === 'ready' ? mint.url : fullAccessLink;

  const requestLink = useCallback(async () => {
    if (!needsToken) {
      setMint({ kind: 'idle' });
      return;
    }
    setMint({ kind: 'working' });
    try {
      const res = await fetch(inviteMintUrl(roomId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole, ttlSeconds: expiry.seconds }),
      });

      if (res.status === 501) {
        // A specific state, not a failure: the deployment has no signing key,
        // so a restricted link is something it cannot honestly offer.
        setMint({ kind: 'unavailable' });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setMint({ kind: 'error', message: body?.error ?? 'The link could not be created.' });
        return;
      }

      const { token } = await res.json();
      setMint({ kind: 'ready', url: `${window.location.origin}/i/${token}` });
    } catch {
      setMint({ kind: 'error', message: 'The server could not be reached.' });
    }
  }, [needsToken, roomId, selectedRole, expiry.seconds]);

  // A new link whenever the terms of it change. Minting is cheap and the
  // alternative is a stale link sitting under a role it no longer matches.
  useEffect(() => {
    void requestLink();
  }, [requestLink]);

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

  const mode = MODES.find((m) => m.id === selectedRole)!;
  const linkReady = !needsToken || mint.kind === 'ready';

  return (
    <div className="share" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        className="share__panel panel-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="share__head">
          <h2 id="share-title" className="share__title">Share this board</h2>
          <button className="share__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* The choice and its explanation are one unit: the panel's own flex
            gap sets the rhythm between sections, and these two are a section. */}
        <div className="share__choice">
        <div className="share__modes" role="group" aria-label="What the link allows">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              // `aria-pressed` alone drives the lit state, in CSS. A parallel
              // `is-active` class would be a second copy of the same fact.
              aria-pressed={selectedRole === id}
              className="share__mode"
              onClick={() => setSelectedRole(id)}
            >
              <Icon size={13} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <p className="share__blurb">{mode.blurb}</p>
        </div>

        <div className="share__field">
          <LinkIcon size={15} aria-hidden="true" />
          <input
            type="text"
            readOnly
            value={
              mint.kind === 'working' && needsToken
                ? 'Creating a link…'
                : mint.kind === 'unavailable' && needsToken
                  ? 'Restricted links are not enabled on this server'
                  : link
            }
            aria-label={`Link that opens this board in ${mode.label.toLowerCase()} mode`}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
          />
          <button
            className={`share__copy${copied === 'link' ? ' is-copied' : ''}`}
            onClick={() => copy('link', link)}
            disabled={!linkReady}
            aria-live="polite"
          >
            {copied === 'link' ? <Check size={14} /> : <Copy size={14} />}
            {copied === 'link' ? 'Copied' : 'Copy'}
          </button>
        </div>

        {/* Only a signed link can carry an expiry, so the control appears
            exactly where it means something. */}
        {needsToken && mint.kind !== 'unavailable' && (
          <div className="share__expiry">
            <Clock size={13} aria-hidden="true" />
            <label htmlFor="share-expiry">Expires</label>
            <select
              id="share-expiry"
              value={expiry.id}
              onChange={(e) =>
                setExpiry(EXPIRIES.find((x) => x.id === e.target.value) ?? EXPIRIES[0])
              }
            >
              {EXPIRIES.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
        )}

        {mint.kind === 'error' && (
          <p className="share__failed" role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            {mint.message}
          </p>
        )}

        {/*
          * The code is the board's own address, so it is *full access* --
          * which is exactly why it cannot sit under a View link. Offering
          * both at once would hand back everything the restricted link
          * withholds, in a smaller font.
          */}
        {code && !needsToken && (
          /* The code and the sentence explaining it are one unit, like the
             choice and its blurb above. The panel's gap is for sections. */
          <div className="share__choice">
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
            <p className="share__hint">
              The same board, for when a link is awkward to pass along — read it
              out, and it carries the same full access.
            </p>
          </div>
        )}

        {failed && (
          <p className="share__failed" role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            The browser would not let us copy that. Select it above and copy it
            yourself.
          </p>
        )}

        <p className="share__caveat">
          <Info size={13} aria-hidden="true" />
          <span>
            {mint.kind === 'unavailable'
              ? 'This server has no signing key, so it can only make full-access links. Set SHARE_SECRET to enable Comment and View.'
              : needsToken
                ? 'The role is signed, so this link cannot be edited into an edit link. Anyone who already knows the board’s address still has full access.'
                : 'There are no accounts on this board: the link is the key. Anyone who has it can edit, and a link cannot be taken back once it is out.'}
          </span>
        </p>
      </div>
    </div>
  );
};
