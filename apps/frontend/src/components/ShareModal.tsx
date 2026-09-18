import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Clock, Copy, Hash, Info, Link as LinkIcon, QrCode, Share2, X, MessageSquare, Edit3, Eye } from 'lucide-react';
import { formatRoomCode, roomCodeFor } from '../engine/room/roomCode';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { inviteMintUrl } from '../utils/endpoints';
import { metadataMap, roomId as currentRoomId } from '../engine/document/doc';
import { useRoomState } from '../hooks/useSync';
import { copyLink, shareLink, shareSheetWorthwhile } from '../engine/share/copyLink';
import type { RoomRole } from '../engine/model/permissions';
import { LinkPreview } from './share/LinkPreview';
import { ShareQr } from './share/ShareQr';

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

/**
 * "7 days" as the day it actually stops working.
 *
 * A duration is what you choose; a date is what you need afterwards. "Expires
 * in 30 days" told from the moment of choosing is a fact about a moment
 * nobody will remember, and it is the wrong half of the sentence to keep —
 * the question people come back with is "is that link still good", and
 * "Tuesday 14 October" answers it where "30 days" does not.
 */
function expiryDate(seconds: number): string | null {
  if (!seconds) return null;
  const when = new Date(Date.now() + seconds * 1000);
  const sameYear = when.getFullYear() === new Date().getFullYear();
  return when.toLocaleDateString(undefined, {
    weekday: seconds <= 7 * 24 * 60 * 60 ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  });
}

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
  const [showQr, setShowQr] = useState(false);
  const dialogRef = useFocusTrap(true, onClose);
  const modesRef = useRef<HTMLDivElement>(null);
  const { awarenessUsers } = useRoomState();
  // The board's name travels with a copied link, so that pasting into Slack or
  // a document gives its title rather than an opaque address. See `copyLink`.
  const boardName = metadataMap.get('name')?.toString().trim() || 'Untitled Workspace';
  const here = Array.from(awarenessUsers.values()).filter((u: { user?: unknown }) => u?.user).length;

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

  const confirm = (what: 'link' | 'code') => {
    setFailed(false);
    setCopied(what);
    window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 2200);
  };

  /**
   * The link, as a titled link where that is understood and a plain URL
   * everywhere else. The room code stays plain text, because it is a code —
   * there is nothing for a title to attach to.
   */
  const copy = async (what: 'link' | 'code', text: string) => {
    const outcome = what === 'link' ? await copyLink(text, boardName) : await plainCopy(text);
    if (outcome === 'failed') setFailed(true);
    else confirm(what);
  };

  const plainCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return 'plain' as const;
    } catch {
      return 'failed' as const;
    }
  };

  const mode = MODES.find((m) => m.id === selectedRole)!;
  const linkReady = !needsToken || mint.kind === 'ready';
  const expiresOn = needsToken ? expiryDate(expiry.seconds) : null;

  /**
   * Arrow keys across the three modes.
   *
   * They are one choice with three answers, which is a radio group, and a
   * radio group is arrow-navigable everywhere else in every application a
   * person has ever used. Three adjacent buttons that each need their own Tab
   * stop is the version of this that passes an automated check and fails a
   * person using the keyboard.
   */
  const onModeKeys = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = MODES.findIndex((m) => m.id === selectedRole);
    const next = MODES[(index + step + MODES.length) % MODES.length];
    setSelectedRole(next.id);
    modesRef.current?.querySelector<HTMLButtonElement>(`[data-role="${next.id}"]`)?.focus();
  };

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
          <div>
            <h2 id="share-title" className="share__title">Share this board</h2>
            {/*
              * Who is already here.
              *
              * Sharing is a social act and this dialog was the one place in the
              * app that did not know it: you could send an edit link to four
              * people while four people were already drawing on the board, and
              * nothing here said so. It is also the honest framing for the
              * warning at the foot — "the link is the key" means rather more
              * when the room is not empty.
              */}
            {here > 1 && (
              <p className="share__present">
                <span className="share__present-dot" aria-hidden="true" />
                {here} people are on this board right now
              </p>
            )}
          </div>
          <button className="share__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* The choice and its explanation are one unit: the panel's own flex
            gap sets the rhythm between sections, and these two are a section. */}
        <div className="share__choice">
        {/* A radio group, because it is one choice with three answers. The
            roving tab stop keeps it to a single Tab stop and makes the arrow
            keys work, which is what every other radio group in every
            application already does. */}
        <div
          ref={modesRef}
          className="share__modes"
          role="radiogroup"
          aria-label="What the link allows"
          onKeyDown={onModeKeys}
        >
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              data-role={id}
              // `aria-checked` alone drives the lit state, in CSS. A parallel
              // `is-active` class would be a second copy of the same fact.
              aria-checked={selectedRole === id}
              tabIndex={selectedRole === id ? 0 : -1}
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
          {/* The code beside the link, not in a menu: handing a board to a
              phone or a room screen is the second most common way this dialog
              is used, and it is the one that cannot be done by copying. */}
          <button
            type="button"
            className="share__qr-toggle"
            aria-pressed={showQr}
            aria-label={showQr ? 'Hide the QR code' : 'Show a QR code for this link'}
            disabled={!linkReady}
            onClick={() => setShowQr((on) => !on)}
            title="Open on a phone"
          >
            <QrCode size={15} aria-hidden="true" />
          </button>
          <button
            className={`share__copy${copied === 'link' ? ' is-copied' : ''}`}
            onClick={() => void copy('link', link)}
            disabled={!linkReady}
            aria-live="polite"
          >
            {copied === 'link' ? <Check size={14} /> : <Copy size={14} />}
            {copied === 'link' ? 'Copied' : 'Copy'}
          </button>
        </div>

        {showQr && linkReady && (
          <div className="share__qr">
            <ShareQr url={link} label={mode.label.toLowerCase()} />
            <p className="share__qr-note">
              Point a phone camera at this to open the board — it carries the
              same {mode.label.toLowerCase()} access as the link above.
            </p>
          </div>
        )}

        {/* Only where it beats the copy button that is already here: on a
            phone, sharing means picking a thread, and the operating system is
            much better at that than a dialog is. */}
        {shareSheetWorthwhile() && linkReady && (
          <button
            type="button"
            className="share__system"
            onClick={() => void shareLink(link, boardName)}
          >
            <Share2 size={14} aria-hidden="true" />
            Share with an app
          </button>
        )}

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
            {/* The date, not the duration. "30 days" is the choice; "14
                October" is the thing anybody will need to know later. */}
            {expiresOn && <span className="share__expiry-date">until {expiresOn}</span>}
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
                onClick={() => void copy('code', formatRoomCode(code))}
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

        <LinkPreview role={selectedRole} />

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
