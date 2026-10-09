import React, { useEffect, useRef, useSyncExternalStore } from 'react';
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

const NoticeRow: React.FC<{ notice: Notice }> = ({ notice }) => (
  <div
    className={`notice notice--${notice.tone}`}
    /* The politeness follows the tone. An error interrupts (an alert is
       assertive), because waiting for a pause means the person carries on as
       if it went well. Everything else is read by the layer's polite region
       in its turn: "Copied" narrated over what someone is reading is worse
       than silence. */
    role={notice.tone === 'error' ? 'alert' : undefined}
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
  /**
   * Why the clock is held: the pointer is over the stack, or focus is in it.
   * Either one holds it; it runs again only when both have gone, so tabbing
   * to Undo and then moving the mouse away does not start the countdown under
   * a focused button.
   */
  const reasons = useRef({ pointer: false, focus: false });
  const update = (key: 'pointer' | 'focus', on: boolean) => {
    reasons.current[key] = on;
    if (reasons.current.pointer || reasons.current.focus) notices$.hold();
    else notices$.release();
  };
  // The store drops a hold when the stack empties; the reasons go with it.
  useEffect(() => {
    if (notices.length === 0) reasons.current = { pointer: false, focus: false };
  }, [notices.length]);

  /**
   * Always mounted, and the polite live region itself.
   *
   * A live region that is inserted already holding its text is announced
   * unreliably, and that is exactly what a layer that rendered nothing until
   * the first notice did. Mounted empty from the start, each row added to it
   * is announced. Errors carry `role="alert"` on the row, which is assertive
   * on insertion by definition.
   */
  return (
    <div
      className="notice-layer"
      aria-live="polite"
      aria-relevant="additions text"
      onPointerEnter={() => update('pointer', true)}
      onPointerLeave={() => update('pointer', false)}
      onFocus={() => update('focus', true)}
      onBlur={(e) => {
        // Focus moving between the stack's own buttons is still focus in it.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        update('focus', false);
      }}
    >
      {/* Oldest at the top, so the newest sits nearest the dock and nothing
          that is already on screen moves down into the reader's eye line. */}
      {notices.map((notice) => (
        <NoticeRow key={notice.id} notice={notice} />
      ))}
    </div>
  );
};
