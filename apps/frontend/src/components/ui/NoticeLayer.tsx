import React, { useSyncExternalStore } from 'react';
import { AlertTriangle, Check, Info, X, XCircle } from 'lucide-react';
import { notices$, type Notice, type NoticeTone } from '../../engine/ui/notices';

/**
 * Everything the application says, drawn once at the document root.
 *
 * The same arrangement `TooltipLayer` uses and for the same reason: one element
 * in one place, fed by a store, rather than a surface per caller. Three of them
 * had grown here — a toast above the dock, a receipt below the header, and an
 * offline banner in inline styles — with three geometries, three dismissal
 * rules and two different sentences for being offline.
 *
 * ## Why the bottom, and why not the corner
 *
 * Above the tool dock, centred, which is where the transient toast already was
 * and where the eye already is: the dock is what you were reaching for when the
 * thing you did happened. The top of this application belongs to the board's
 * name and the room's people, and a receipt landing under the header sat over
 * the canvas at exactly the height a frame's title occupies.
 *
 * A corner is the other convention and it is wrong *here* — the right-hand
 * corners are the properties panel and the radar, the bottom-left is the zoom
 * control, and the top-left is the header. There is no free corner on this
 * screen, which is a fact about the layout rather than a matter of taste.
 *
 * ## Why the stack grows upward
 *
 * The newest is nearest the dock, so a message never moves once it is on
 * screen: a second notice pushes the first *up* rather than displacing it
 * downward into where the reader's eye already was. The alternative reorders
 * the thing you were mid-way through reading.
 */

const ICON: Record<NoticeTone, React.ReactNode> = {
  info: <Info size={15} />,
  success: <Check size={15} />,
  warning: <AlertTriangle size={15} />,
  error: <XCircle size={15} />,
};

/**
 * The politeness of the announcement follows the tone.
 *
 * An error interrupts, because it is the one case where waiting for a pause
 * means the person carries on working on the assumption that it went well.
 * Everything else waits its turn — a screen reader narrating "Copied" over the
 * top of what someone is reading is worse than silence.
 */
const LIVENESS: Record<NoticeTone, 'polite' | 'assertive'> = {
  info: 'polite',
  success: 'polite',
  warning: 'polite',
  error: 'assertive',
};

const NoticeRow: React.FC<{ notice: Notice }> = ({ notice }) => (
  <div
    className={`notice notice--${notice.tone}`}
    role={notice.tone === 'error' ? 'alert' : 'status'}
    aria-live={LIVENESS[notice.tone]}
  >
    <span className="notice__icon" aria-hidden>
      {ICON[notice.tone]}
    </span>

    <span className="notice__text">
      {notice.message}
      {/* The count, not a second row. A repeat is the same fact happening
          again, and the useful part is that it kept happening. */}
      {notice.repeats > 1 && <span className="notice__count">×{notice.repeats}</span>}
    </span>

    {notice.action && (
      <button
        type="button"
        className="notice__action"
        onClick={() => {
          notice.action?.run();
          notices$.dismiss(notice.id);
        }}
      >
        {notice.action.label}
      </button>
    )}

    {/**
     * Dismissal is offered only where it is needed.
     *
     * A notice on a timer is already leaving, and a close button on it is a
     * control whose whole job is to save two seconds — while costing a target
     * that has to be aimed at and a piece of chrome on every confirmation. One
     * that stays until it is read has no other way out, so it gets the button.
     */}
    {notice.expiresAt === null && (
      <button
        type="button"
        className="notice__close"
        onClick={() => notices$.dismiss(notice.id)}
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    )}
  </div>
);

export const NoticeLayer: React.FC = () => {
  const notices = useSyncExternalStore(notices$.subscribe, notices$.getSnapshot, notices$.getSnapshot);
  if (notices.length === 0) return null;

  return (
    <div className="notice-layer">
      {/* Oldest at the top, so the newest sits nearest the dock and nothing
          that is already on screen moves down into the reader's eye line. */}
      {notices.map((notice) => (
        <NoticeRow key={notice.id} notice={notice} />
      ))}
    </div>
  );
};
