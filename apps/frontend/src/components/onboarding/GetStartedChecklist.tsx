import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, ChevronDown, Play, X } from 'lucide-react';
import { CHECKLIST, checklistState, type ChecklistItem, type ChecklistItemId } from '../../engine/learn/tourChecklist';
import { tourState } from '../../engine/learn/tourState';
import { TOOL_SHORTCUTS } from '../../engine/tools/shortcuts';
import { musicSlot } from '../workspace/musicSlot';
import { useChecklistDetection } from './useChecklistDetection';
import './onboarding.css';

/** How long a freshly ticked row keeps its highlight. */
const FRESH_MS = 1400;

/** What pressing a row does: arm its tool, or open the control that does it. */
function perform(item: ChecklistItem) {
  if (item.tool) {
    window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: item.tool }));
    return;
  }
  if (item.id === 'invite') {
    const share = Array.from(document.querySelectorAll<HTMLElement>('[data-tour="share"]')).find(
      (el) => el.getBoundingClientRect().width > 0
    );
    share?.click();
    return;
  }
  if (item.id === 'music') musicSlot.request();
}

/** The progress ring the card folds into, and the count beside the title. */
const Ring: React.FC<{ done: number; total: number; size: number }> = ({ done, total, size }) => {
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="gs-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="gs-ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
      <circle
        className="gs-ring__value"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - done / total)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
};

/** A tick that draws itself on when the row is first done. */
const Check: React.FC<{ done: boolean }> = ({ done }) => (
  <span className="gs-check" data-done={done || undefined} aria-hidden="true">
    <svg viewBox="0 0 16 16">
      <path className="gs-check__tick" pathLength={1} d="M4.6 8.3l2.3 2.3 4.6-4.9" />
    </svg>
  </span>
);

interface Props {
  /** The board's chrome is on screen. */
  visible: boolean;
}

/**
 * "Get started · 0/5": five first moves, ticked by doing them.
 *
 * Non-modal and out of the way: it sits above the dock's band on the right,
 * never takes focus on its own, folds to a progress ring, and closes for good.
 * Each row is a way to do the thing (it arms the tool or opens the control),
 * and only the board ticks it.
 */
export const GetStartedChecklist: React.FC<Props> = ({ visible }) => {
  const { done, dismissed, collapsed } = useSyncExternalStore(
    checklistState.subscribe,
    checklistState.getSnapshot,
    checklistState.getSnapshot
  );
  const tour = useSyncExternalStore(tourState.subscribe, tourState.getSnapshot, tourState.getSnapshot);
  const complete = done.length === CHECKLIST.length;
  const live = visible && !dismissed;

  useChecklistDetection(live && !complete);

  /** Rows ticked this session, held briefly for the check micro-moment. */
  const [fresh, setFresh] = useState<ReadonlySet<ChecklistItemId>>(new Set());
  const [announce, setAnnounce] = useState('');
  const seen = useRef<ReadonlySet<ChecklistItemId>>(new Set(done));

  useEffect(() => {
    const added = done.filter((id) => !seen.current.has(id));
    seen.current = new Set(done);
    if (added.length === 0) return;
    setFresh(new Set(added));
    const labels = added.map((id) => CHECKLIST.find((i) => i.id === id)?.label).join(', ');
    setAnnounce(
      done.length === CHECKLIST.length
        ? `${labels} done. Getting started is complete.`
        : `${labels} done. ${done.length} of ${CHECKLIST.length}.`
    );
    const t = window.setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => window.clearTimeout(t);
  }, [done]);

  /** Presenting the checklist is the tour's offer, so the offer counts as made. */
  useEffect(() => {
    if (live) tourState.decline();
  }, [live]);

  const titleId = useId();
  const ringRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  /** Keep focus with the control that replaced the one just pressed. */
  const fold = () => {
    checklistState.collapse();
    requestAnimationFrame(() => ringRef.current?.focus());
  };
  const unfold = () => {
    checklistState.expand();
    requestAnimationFrame(() => cardRef.current?.querySelector<HTMLElement>('.gs__fold')?.focus());
  };

  if (!live) return null;

  const count = `${done.length}/${CHECKLIST.length}`;
  const resumable = tourState.canResume();

  return (
    // Hidden rather than unmounted while the tour runs, so the button that
    // started it is still there to take focus back when it ends.
    <div className="gs" data-collapsed={collapsed || undefined} hidden={tour.step !== null}>
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>

      {collapsed ? (
        <button
          ref={ringRef}
          type="button"
          className="gs__pill"
          onClick={unfold}
          aria-label={`Get started, ${done.length} of ${CHECKLIST.length} done. Show the checklist`}
          data-tooltip="Get started"
          data-tooltip-pos="left"
        >
          <Ring done={done.length} total={CHECKLIST.length} size={28} />
          <span className="gs__pill-count">{count}</span>
        </button>
      ) : (
        <section ref={cardRef} className="gs__card" aria-labelledby={titleId}>
          <header className="gs__head">
            <h2 id={titleId} className="gs__title">
              {complete ? 'You’re all set' : 'Get started'}
            </h2>
            <span className="gs__count" aria-hidden="true">
              {count}
            </span>
            <button type="button" className="gs__icon gs__fold" onClick={fold} aria-label="Fold the checklist" data-tooltip="Fold">
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="gs__icon"
              onClick={() => checklistState.dismiss()}
              aria-label="Close the checklist. Help brings it back"
              data-tooltip="Close"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>

          <div
            className="gs__bar"
            role="progressbar"
            aria-label="Getting started"
            aria-valuemin={0}
            aria-valuemax={CHECKLIST.length}
            aria-valuenow={done.length}
          >
            <span style={{ '--gs-progress': done.length / CHECKLIST.length } as React.CSSProperties} />
          </div>

          {complete ? (
            <p className="gs__done">
              Every tool is in the dock, and <kbd>?</kbd> has the rest whenever you want it.
            </p>
          ) : (
            <ul className="gs__list">
              {CHECKLIST.map((item) => {
                const isDone = done.includes(item.id);
                const key = item.tool ? TOOL_SHORTCUTS[item.tool] : undefined;
                return (
                  <li key={item.id} className="gs__item" data-done={isDone || undefined} data-fresh={fresh.has(item.id) || undefined}>
                    {isDone ? (
                      <span className="gs__row">
                        <Check done />
                        <span className="gs__label">{item.label}</span>
                        <span className="sr-only">, done</span>
                      </span>
                    ) : (
                      <button type="button" className="gs__row" onClick={() => perform(item)} aria-describedby={`${titleId}-${item.id}`}>
                        <Check done={false} />
                        <span className="gs__label">{item.label}</span>
                        {key ? <kbd className="gs__key">{key}</kbd> : <ArrowRight className="gs__go" size={14} aria-hidden="true" />}
                        <span id={`${titleId}-${item.id}`} className="sr-only">
                          {item.action}
                        </span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <footer className="gs__foot">
            {complete ? (
              <button type="button" className="gs__tour" onClick={() => checklistState.dismiss()}>
                Close
              </button>
            ) : (
              <button type="button" className="gs__tour" onClick={() => tourState.start()}>
                <Play size={13} aria-hidden="true" />
                {resumable ? 'Resume the tour' : 'Take the 60-second tour'}
              </button>
            )}
          </footer>
        </section>
      )}
    </div>
  );
};
