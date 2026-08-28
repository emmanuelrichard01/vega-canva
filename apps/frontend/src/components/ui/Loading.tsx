import React from 'react';
import { useDelayed } from '../../hooks/useDelayed';

/**
 * Waiting, shown honestly.
 *
 * ## The rule these all follow
 *
 * A loader that appears for eighty milliseconds and vanishes does not tell
 * anybody anything. It reads as a flicker, and a flicker reads as jank -- so
 * the spinner meant to reassure somebody that the app is working is the thing
 * that makes it feel broken. On a warm connection almost every wait in this
 * app is under a tenth of a second.
 *
 * So nothing here appears immediately. Each of these waits out a threshold
 * first, and on a fast load the correct amount of loading UI is none at all.
 *
 * The threshold itself, and the reasoning behind the numbers, live in
 * `useDelayed`.
 */

/**
 * The mark itself: the brand tile, breathing.
 *
 * Deliberately the same shape, colour and rhythm as the boot shell in
 * `index.html`. That one is inert markup painted before any of our JavaScript
 * runs and this one is React, but they are the same wait as far as anybody
 * watching is concerned, and a handover between them should be invisible.
 */
export const LoadingMark: React.FC<{ size?: number }> = ({ size = 26 }) => (
  <span
    className="loadmark"
    style={{ width: size, height: size, borderRadius: Math.round(size * 0.27) }}
    aria-hidden="true"
  />
);

/**
 * A whole route, on its way.
 *
 * Takes the full viewport because that is what it is standing in for. No
 * wording: "Loading" is a word for a state the mark already describes, and it
 * would be the one untranslated string on the screen.
 */
export const RouteLoader: React.FC = () => {
  const show = useDelayed(true, 320);
  return (
    <div className="routeload" role="status" aria-live="polite" aria-label="Loading">
      {show && <LoadingMark size={30} />}
    </div>
  );
};

/**
 * A dialog, on its way.
 *
 * The scrim comes up on the first frame and the mark only if the wait runs
 * long. That split is the whole point: the click needs acknowledging
 * immediately, which the scrim does, and the *wait* needs describing only if
 * there turns out to be one. Most of the time the dialog itself lands inside
 * the threshold and the mark never renders.
 */
export const ModalLoader: React.FC = () => {
  const show = useDelayed(true, 260);
  return (
    <div className="modalload" role="status" aria-live="polite" aria-label="Opening">
      {show && <LoadingMark size={24} />}
    </div>
  );
};
