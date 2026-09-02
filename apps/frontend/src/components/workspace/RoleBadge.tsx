import React, { useEffect, useRef, useState } from 'react';
import { Eye, MessageSquare } from 'lucide-react';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';

/**
 * What this person is allowed to do, said out loud.
 *
 * ## The problem it solves
 *
 * Roles were enforced and never announced. Somebody opening a view link found
 * the drawing tools gone, objects that would not drag, and a keyboard that did
 * nothing — with no statement anywhere on the screen that any of this was on
 * purpose. Every one of those is indistinguishable from a broken application,
 * and the person's most reasonable conclusion is that the board is broken.
 *
 * That is invariant 6 running backwards. The usual failure is a capability
 * declared and never honoured; this is a capability **honoured and never
 * declared**, which is just as confusing and rather more alarming, because the
 * interface is actively taking things away without saying so.
 *
 * ## Why a standing chip and not a toast
 *
 * A toast says it once. The constraint is permanent, so the question ("why
 * can't I draw?") outlives any message that expires — and it is asked most
 * often twenty minutes in, not on arrival. This is the same reasoning the sync
 * pip records in reverse: *that* one folds its label away because "Saved" is
 * the resting assumption and needs no standing chrome, and this one keeps its
 * label because a restricted role is precisely **not** what anybody assumes.
 *
 * ## Nothing at all for an editor
 *
 * Full access is the default and the overwhelmingly common case, so it gets no
 * chrome. A badge reading "Can edit" on every board would be a permanent label
 * for the state everyone already assumes — chrome that costs space and teaches
 * nobody anything.
 *
 * ## No "Request access" button
 *
 * The obvious next control is the one this product cannot honestly offer.
 * There are no accounts here, so there is nobody to send a request *to* and no
 * inbox for it to land in — a button would either do nothing or send a message
 * into a void, which is worse than its absence. What the panel does instead is
 * tell the truth about the mechanism: access travels as links, so the person
 * who sent this one can send a different one.
 */

const COPY = {
  viewer: {
    Icon: Eye,
    label: 'View only',
    title: 'You are viewing this board',
    can: ['Move around, zoom, and read everything', 'Export what you can see'],
    cannot: ['Add, move, edit or delete anything', 'Leave comments'],
    /**
     * The one sentence that answers "why". It names the *reason* rather than
     * the symptom, because somebody who knows the link is the cause stops
     * looking for a bug.
     */
    why: 'The link you opened is a view link. Edits are refused by the server, not just hidden here — so nothing you do can affect the board by accident.',
  },
  commenter: {
    Icon: MessageSquare,
    label: 'Comment only',
    title: 'You can comment on this board',
    can: ['Move around, zoom, and read everything', 'Leave and reply to comments', 'Export what you can see'],
    cannot: ['Add, move, edit or delete objects'],
    why: 'The link you opened is a comment link. Your comments are real edits to the board and everyone will see them; the drawing tools are the part that is held back.',
  },
} as const;

export const RoleBadge: React.FC = () => {
  const { role } = useRoomPermissions();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Same dismissal contract as the View menu beside it: a click anywhere else,
  // or Escape. Registered only while open so a closed badge costs no listeners.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (role === 'editor') return null;

  const copy = COPY[role];
  const { Icon } = copy;

  return (
    <div style={{ position: 'relative' }} ref={wrapRef}>
      <button
        type="button"
        className={`role-chip${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tooltip="What you can do on this board"
        data-tooltip-pos="bottom"
      >
        <Icon size={13} aria-hidden />
        <span>{copy.label}</span>
      </button>

      {open && (
        <div
          className="ctx-popover role-pop"
          role="dialog"
          aria-label={copy.title}
          style={{ top: 'calc(100% + 8px)', right: 0, minWidth: 288 }}
        >
          <p className="role-pop__title">{copy.title}</p>
          <p className="role-pop__why">{copy.why}</p>

          <p className="hdr-view__legend">You can</p>
          <ul className="role-pop__list role-pop__list--can">
            {copy.can.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <p className="hdr-view__legend">You cannot</p>
          <ul className="role-pop__list role-pop__list--cannot">
            {copy.cannot.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <p className="role-pop__foot">
            Access travels as links here — there are no accounts. Whoever sent
            you this one can send an edit link instead.
          </p>
        </div>
      )}
    </div>
  );
};
