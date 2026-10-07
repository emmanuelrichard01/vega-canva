import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { whenDocumentReady } from '../../engine/document';
import { tourState } from '../../engine/learn/tourState';
import { checklistState, takeStartIntent, type StartIntent } from '../../engine/learn/tourChecklist';
import { stepsFor } from '../../engine/learn/tour';
import { GetStartedChecklist } from './GetStartedChecklist';
import './onboarding.css';

/** How long after the board is ready an offer or a guided tour appears. */
const SETTLE_MS = 900;

/**
 * The dashboard's request, held between taking it from storage and acting on
 * it. Development mounts every effect twice, and the first mount's cleanup
 * would otherwise throw the request away before the second could use it.
 */
let held: StartIntent | null = null;

/**
 * The tour's offer for somebody who cannot edit.
 *
 * Viewers and commenters get no checklist (they cannot draw, stick or connect),
 * so the offer is a small card of its own. Made once; declining is final.
 */
const TourOfferCard: React.FC = () => {
  const { role } = useRoomPermissions();
  const stops = stepsFor(role).length;
  return (
    <aside className="tour-offer" aria-label="Take a tour">
      <div className="tour-offer__body">
        <p className="tour-offer__title">New to this board?</p>
        <p className="tour-offer__text">A quick look round, {stops} stops.</p>
      </div>
      <div className="tour-offer__actions">
        <button type="button" className="tour-offer__ghost" onClick={() => tourState.decline()}>
          Not now
        </button>
        <button type="button" className="tour-offer__primary" onClick={() => tourState.start()}>
          Show me
        </button>
      </div>
    </aside>
  );
};

/**
 * Everything a first visit to a board gets, in one place.
 *
 * - Editors: the getting-started checklist, which carries the tour's offer.
 * - Viewers and commenters: the tour's offer on its own, once.
 * - A board opened from the dashboard's "Make your first board": the checklist
 *   open and the tour started, because that is what was asked for.
 *
 * Nothing here blocks the board: every surface is non-modal, and none of them
 * takes focus unless the person asked for the tour.
 */
export const OnboardingLayer: React.FC<{ visible: boolean }> = ({ visible }) => {
  const { canEdit } = useRoomPermissions();
  const { seen, step } = useSyncExternalStore(tourState.subscribe, tourState.getSnapshot, tourState.getSnapshot);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    // Read at mount: a guided start belongs to the board it opened.
    held = takeStartIntent() ?? held;
    void whenDocumentReady().then(() => {
      if (!live) return;
      timer = window.setTimeout(() => {
        setSettled(true);
        if (held === 'guided') {
          held = null;
          checklistState.reopen();
          tourState.restart();
        }
      }, SETTLE_MS);
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, []);

  if (!visible || !settled) return null;

  if (canEdit) return <GetStartedChecklist visible />;
  return !seen && step === null ? <TourOfferCard /> : null;
};
