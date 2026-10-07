import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Edit3,
  Eye,
  FileText,
  Hash,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageSquare,
  PenTool,
  QrCode,
  Radio,
  RotateCw,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { formatRoomCode, roomCodeFor } from '../engine/room/roomCode';
import { API_BASE, inviteMintUrl, roomRequestHeaders } from '../utils/endpoints';
import { metadataMap, provider, roomId as currentRoomId } from '../engine/document/doc';
import { useRoomState } from '../hooks/useSync';
import { copyLink, shareLink, shareSheetWorthwhile } from '../engine/share/copyLink';
import { getRoomRole, type RoomRole } from '../engine/model/permissions';
import { readCollaborators } from '../engine/presence/collaborators';
import type { ExportFormat } from '../engine/export/ExportTypes';
import { menuShortcut, SHORTCUTS } from './menu/shortcuts';
import { Dialog, DialogBody, DialogHeader } from './ui/Dialog';
import { AvatarStack } from './ui/Avatar';
import { tooltipProps } from './ui/Tooltip';
import { Switch } from './ui/Switch';
import { LinkPreview } from './share/LinkPreview';
import { ShareQr } from './share/ShareQr';
import {
  ROLE_RANK,
  expiryDate,
  linkNeedsToken,
  linkToShow,
  mintRecovery,
  presentLink,
  readEnforcement,
  readMintResponse,
  roleBlockedReason,
  roleBlurb,
  securityNote,
  wasShortened,
  type Enforcement,
  type MintState,
} from './share/shareModel';
import './ui/shareDialog.css';

interface ShareModalProps {
  onClose: () => void;
  /** Hand over to the export dialog in this format. Without it there is no Export tab. */
  onExport?: (format: ExportFormat) => void;
}

/**
 * The ways work leaves the board. Each opens the export dialog already set to
 * its format, where the area, scale and background are chosen with a preview.
 */
const EXPORTS: ReadonlyArray<{ format: ExportFormat; label: string; detail: string; Icon: typeof FileText }> = [
  { format: 'png', label: 'Image', detail: 'PNG for slides, chat and documents', Icon: ImageIcon },
  { format: 'svg', label: 'Vector', detail: 'SVG that stays sharp and opens in Figma or Illustrator', Icon: PenTool },
  { format: 'pdf', label: 'Document', detail: 'PDF for printing and handing over, a page per frame', Icon: FileText },
  { format: 'json', label: 'Backup', detail: 'Everything on the board, to restore later', Icon: Archive },
];

/** The three answers to "what can someone with this link do", in plain words. */
const ROLES: ReadonlyArray<{ id: RoomRole; label: string; Icon: typeof Edit3 }> = [
  { id: 'editor', label: 'Can edit', Icon: Edit3 },
  { id: 'commenter', label: 'Can comment', Icon: MessageSquare },
  { id: 'viewer', label: 'Can view', Icon: Eye },
];

/** How long a signed link lives. `0` means it does not expire. */
const EXPIRIES: ReadonlyArray<{ id: string; label: string; seconds: number }> = [
  { id: 'never', label: 'Never', seconds: 0 },
  { id: '24h', label: 'In 24 hours', seconds: 24 * 60 * 60 },
  { id: '7d', label: 'In 7 days', seconds: 7 * 24 * 60 * 60 },
  { id: '30d', label: 'In 30 days', seconds: 30 * 24 * 60 * 60 },
];

const ROLE_SHORT: Record<RoomRole, string> = { editor: 'can edit', commenter: 'can comment', viewer: 'can view' };

export const ShareModal: React.FC<ShareModalProps> = ({ onClose, onExport }) => {
  return (
    <Dialog onClose={onClose} size="md" className="sh">
      <ShareBody onExport={onExport} />
    </Dialog>
  );
};

const ShareBody: React.FC<{ onExport?: (format: ExportFormat) => void }> = ({ onExport }) => {
  /** This tab's own role. A link it hands out can carry no more than this. */
  const ownRole = getRoomRole();
  const [tab, setTab] = useState<'invite' | 'export'>('invite');
  const [role, setRole] = useState<RoomRole>(ownRole);
  const [expiry, setExpiry] = useState(EXPIRIES[0]);
  const [mint, setMint] = useState<MintState>({ kind: 'idle' });
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [present, setPresent] = useState(false);
  const [enforcement, setEnforcement] = useState<Enforcement>('unknown');
  const rolesRef = useRef<HTMLDivElement>(null);
  const { awarenessUsers } = useRoomState();

  const boardName = metadataMap.get('name')?.toString().trim() || 'Untitled Workspace';
  const roomId = currentRoomId;
  const fullAccessLink = `${window.location.origin}/room/${roomId}`;
  const code = roomCodeFor(roomId);

  const myId = provider.awareness?.clientID;
  const me = myId !== undefined ? awarenessUsers.get(myId)?.user : undefined;
  const others = readCollaborators(awarenessUsers, myId);

  /**
   * An edit link needs no minting: a signed `editor` token grants exactly what
   * the board's own address already grants. The restricted roles are signed,
   * because a role only means something when somebody else decided it.
   */
  const needsToken = linkNeedsToken(role, enforcement);
  const myAuthorId = typeof me?.id === 'string' && me.id ? me.id : undefined;
  const link = presentLink(linkToShow(role, fullAccessLink, mint, needsToken), myAuthorId, present);

  // Whether the server only opens boards with a signed link decides what the
  // dialog may promise, so ask it once. Until it answers, nothing is promised.
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${API_BASE}/api/rooms/status?ids=${encodeURIComponent(roomId)}`, { signal: controller.signal })
      .then(async (res) => setEnforcement(readEnforcement(res.status, await res.json().catch(() => null))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [roomId]);

  /** Which request is current, so a slow answer for an earlier choice is dropped. */
  const requestSeq = useRef(0);

  const requestLink = useCallback(async () => {
    const seq = ++requestSeq.current;
    if (!needsToken) {
      setMint({ kind: 'idle' });
      return;
    }
    setMint({ kind: 'working' });
    const settle = (next: MintState) => {
      if (seq === requestSeq.current) setMint(next);
    };
    try {
      const res = await fetch(inviteMintUrl(roomId), {
        method: 'POST',
        // The tab's own invite, if it came through one: the server will not
        // mint a link above the role that invite carries.
        headers: roomRequestHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ role, ttlSeconds: expiry.seconds }),
      });
      const body = await res.json().catch(() => null);
      settle(readMintResponse(res.status, body, { origin: window.location.origin, role, requestedTtl: expiry.seconds }));
    } catch {
      settle({ kind: 'error', message: 'The server could not be reached.' });
    }
  }, [needsToken, roomId, role, expiry.seconds]);

  // A new link whenever its terms change, so a link never sits under a role it
  // no longer matches.
  useEffect(() => {
    void requestLink();
  }, [requestLink]);

  const confirm = (what: 'link' | 'code') => {
    setCopyFailed(false);
    setCopied(what);
    window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 2200);
  };

  /** The link as a titled link where that is understood, and the code as plain text. */
  const copy = async (what: 'link' | 'code', text: string) => {
    let outcome: 'rich' | 'plain' | 'failed';
    if (what === 'link') outcome = await copyLink(text, boardName);
    else {
      try {
        await navigator.clipboard.writeText(text);
        outcome = 'plain';
      } catch {
        outcome = 'failed';
      }
    }
    if (outcome === 'failed') setCopyFailed(true);
    else confirm(what);
  };

  const ready = mint.kind === 'ready' && link !== null;
  const expiresOn = needsToken && ready ? expiryDate(mint.ttlSeconds) : null;
  const shortened = needsToken && ready && wasShortened(expiry.seconds, mint.ttlSeconds);

  /**
   * Arrows move through the roles this tab may hand out, as in any radio group.
   * The ones it may not are skipped, and say why on their own row.
   */
  const onRoleKeys = (event: React.KeyboardEvent) => {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const allowed = ROLES.filter((r) => ROLE_RANK[r.id] <= ROLE_RANK[ownRole]);
    const at = allowed.findIndex((r) => r.id === role);
    const next = allowed[(at + step + allowed.length) % allowed.length];
    setRole(next.id);
    rolesRef.current?.querySelector<HTMLElement>(`[data-role="${next.id}"]`)?.focus();
  };

  const people = (
    <div className="sh-people">
      {(me || others.length > 0) && (
        <AvatarStack
          className="sh-people__faces"
          size={24}
          max={5}
          people={[
            ...(me ? [{ key: 'me', name: String(me.name ?? 'You'), color: String(me.color ?? '#6B7280'), you: true }] : []),
            ...others.map((p) => ({ key: p.clientId, name: p.name, color: p.color })),
          ]}
        />
      )}
      <p className="sh-people__text">
        {others.length === 0
          ? 'Only you are here right now.'
          : others.length === 1
            ? `You and ${others[0].name} are here now.`
            : `You and ${others.length} others are here now.`}{' '}
        <span className="sh-people__role">You {ROLE_SHORT[ownRole]}.</span>
      </p>
    </div>
  );

  return (
    <>
      <DialogHeader title="Share this board" description={people} />

      {onExport && (
        <div className="sh-tabs" role="tablist" aria-label="Share or export">
          {(['invite', 'export'] as const).map((id) => (
            <button
              key={id}
              id={`sh-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`sh-pane-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className="sh-tabs__tab"
              onClick={() => setTab(id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                const other = id === 'invite' ? 'export' : 'invite';
                setTab(other);
                e.currentTarget.parentElement?.querySelector<HTMLElement>(`#sh-tab-${other}`)?.focus();
              }}
            >
              {id === 'invite' ? 'Invite' : 'Export'}
            </button>
          ))}
        </div>
      )}

      <DialogBody className="sh__body">
        {tab === 'export' && onExport ? (
          <div id="sh-pane-export" role="tabpanel" aria-labelledby="sh-tab-export" className="sh-exports">
            {EXPORTS.map(({ format, label, detail, Icon }) => (
              <button key={format} type="button" className="sh-export" onClick={() => onExport(format)}>
                <span className="sh-export__icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className="sh-export__text">
                  <span className="sh-export__label">{label}</span>
                  <span className="sh-export__detail">{detail}</span>
                </span>
                <ChevronRight size={15} className="sh-export__go" aria-hidden="true" />
              </button>
            ))}
            <p className="sh-hint">
              Each opens the export settings with a preview, where you choose the area, scale and background.{' '}
              {menuShortcut(SHORTCUTS.export)} opens them from anywhere on the board.
            </p>
          </div>
        ) : (
          <div
            id="sh-pane-invite"
            role={onExport ? 'tabpanel' : undefined}
            aria-labelledby={onExport ? 'sh-tab-invite' : undefined}
            className="sh-invite"
          >
            <section className="sh-section" aria-labelledby="sh-access-title">
              <h3 id="sh-access-title" className="sh-section__title">
                Anyone with the link
              </h3>
              <div
                ref={rolesRef}
                className="sh-roles"
                role="radiogroup"
                aria-labelledby="sh-access-title"
                aria-describedby={ownRole !== 'editor' ? 'sh-role-limit' : undefined}
                onKeyDown={onRoleKeys}
              >
                {ROLES.map(({ id, label, Icon }) => {
                  const reason = roleBlockedReason(id, ownRole);
                  const checked = role === id;
                  return (
                    <div
                      key={id}
                      role="radio"
                      data-role={id}
                      aria-checked={checked}
                      aria-disabled={reason ? true : undefined}
                      aria-describedby={`sh-role-${id}-why`}
                      // Disabled roles stay focusable by Tab from the group's
                      // own stop, so their reason can be reached; arrows skip them.
                      tabIndex={checked ? 0 : -1}
                      className="sh-role"
                      onClick={() => {
                        if (!reason) setRole(id);
                      }}
                      onKeyDown={(e) => {
                        if ((e.key === ' ' || e.key === 'Enter') && !reason) {
                          e.preventDefault();
                          setRole(id);
                        }
                      }}
                    >
                      <span className="sh-role__icon" aria-hidden="true">
                        {reason ? <Lock size={14} /> : <Icon size={14} />}
                      </span>
                      <span className="sh-role__text">
                        <span className="sh-role__label">{label}</span>
                        <span id={`sh-role-${id}-why`} className="sh-role__blurb">
                          {reason ?? roleBlurb(id, enforcement)}
                        </span>
                      </span>
                      <span className="sh-role__check" aria-hidden="true">
                        {checked && <Check size={15} />}
                      </span>
                    </div>
                  );
                })}
              </div>
              {ownRole !== 'editor' && (
                <p className="sh-hint" id="sh-role-limit">
                  The server caps a link at the access of the person making it. You opened this board with a{' '}
                  {ownRole === 'viewer' ? 'view' : 'comment'} link, so the links you make can carry no more than that.
                </p>
              )}
            </section>

            <section className="sh-section" aria-label="The link">
              <div className="sh-field" data-state={mint.kind}>
                {mint.kind === 'working' ? (
                  <Loader2 size={15} className="dlg-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck size={15} aria-hidden="true" data-signed={needsToken || undefined} />
                )}
                <input
                  type="text"
                  readOnly
                  value={
                    link ??
                    (mint.kind === 'unavailable'
                      ? 'This server cannot sign restricted links'
                      : mint.kind === 'error'
                        ? 'No link yet'
                        : 'Creating a signed link…')
                  }
                  aria-label={`Link that opens this board for people who ${ROLE_SHORT[role]}`}
                  aria-busy={mint.kind === 'working' || undefined}
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  className="sh-field__icon"
                  aria-pressed={showQr}
                  aria-label={showQr ? 'Hide the QR code' : 'Show a QR code for this link'}
                  disabled={!link}
                  onClick={() => setShowQr((on) => !on)}
                  {...tooltipProps({ label: 'Open on a phone', side: 'top' })}
                >
                  <QrCode size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="dlg-btn dlg-btn--primary sh-field__copy"
                  data-autofocus
                  data-copied={copied === 'link' || undefined}
                  onClick={() => {
                    if (link) void copy('link', link);
                  }}
                  disabled={!link}
                >
                  {copied === 'link' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  <span aria-live="polite">{copied === 'link' ? 'Copied' : 'Copy link'}</span>
                </button>
              </div>

              {needsToken && mint.kind !== 'unavailable' && (
                <div className="sh-expiry">
                  <Clock size={13} aria-hidden="true" />
                  <label htmlFor="sh-expiry">Expires</label>
                  <select
                    id="sh-expiry"
                    value={expiry.id}
                    onChange={(e) => setExpiry(EXPIRIES.find((x) => x.id === e.target.value) ?? EXPIRIES[0])}
                  >
                    {EXPIRIES.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {expiresOn && (
                    <span className="sh-expiry__date">
                      Works until {expiresOn}
                      {shortened ? ', when your own link runs out' : ''}
                    </span>
                  )}
                </div>
              )}

              {mint.kind === 'error' && (
                <div className="sh-alert" role="alert">
                  <AlertCircle size={15} aria-hidden="true" />
                  <span className="sh-alert__text">
                    {mint.message}
                    {mintRecovery(mint) && <span className="sh-alert__then"> {mintRecovery(mint)}</span>}
                  </span>
                  <button type="button" className="dlg-btn sh-alert__retry" onClick={() => void requestLink()}>
                    <RotateCw size={13} aria-hidden="true" /> Try again
                  </button>
                </div>
              )}

              {copyFailed && (
                <div className="sh-alert" role="alert">
                  <AlertCircle size={15} aria-hidden="true" />
                  <span className="sh-alert__text">
                    The browser would not let us copy that. Select the link above and copy it yourself.
                  </span>
                </div>
              )}

              {/* Signed-link awareness: say what kind of link this is and what it cannot do. */}
              <p className="sh-hint sh-hint--trust">{securityNote(role, enforcement, mint.kind !== 'unavailable')}</p>

              {myAuthorId && (
                <div className="sh-present">
                  <Switch
                    block
                    checked={present}
                    onChange={setPresent}
                    label="Open in follow mode"
                    tooltip="The link opens straight onto your screen"
                  />
                  <p className="sh-hint">
                    <Radio size={12} aria-hidden="true" />{' '}
                    {present
                      ? 'People who open this follow your view while you are on the board. Moving the canvas takes it back.'
                      : 'For presenting: the link opens already following you.'}
                  </p>
                </div>
              )}

              {showQr && link && (
                <div className="sh-qr">
                  <ShareQr url={link} label={ROLE_SHORT[role]} />
                  <p className="sh-hint">
                    Point a phone camera at this to open the board. It carries the same access as the link.
                  </p>
                </div>
              )}

              {shareSheetWorthwhile() && link && (
                <button type="button" className="dlg-btn dlg-btn--outline sh-system" onClick={() => void shareLink(link, boardName)}>
                  <Share2 size={14} aria-hidden="true" />
                  Share with an app
                </button>
              )}
            </section>

            {/* The code is the board's own address, so it is full access, which
                is why it never sits under a comment or view link. */}
            {code && !needsToken && (
              <section className="sh-section" aria-labelledby="sh-code-title">
                <h3 id="sh-code-title" className="sh-section__title">
                  Room code
                </h3>
                <div className="sh-field sh-field--code">
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
                    type="button"
                    className="dlg-btn dlg-btn--outline sh-field__copy"
                    data-copied={copied === 'code' || undefined}
                    onClick={() => void copy('code', formatRoomCode(code))}
                  >
                    {copied === 'code' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    <span aria-live="polite">{copied === 'code' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <p className="sh-hint">For reading out in a meeting. It opens the same board with full access.</p>
              </section>
            )}

            <LinkPreview role={role} />
          </div>
        )}
      </DialogBody>
    </>
  );
};
