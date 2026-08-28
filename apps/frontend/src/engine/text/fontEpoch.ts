/**
 * One answer to "have the webfonts actually landed yet".
 *
 * ## The bug this exists to kill
 *
 * Canvas text measurement uses whatever face is resolvable *at that moment*.
 * Our display faces come from Google Fonts, so a board that measures its text
 * before they arrive wraps against fallback metrics, fits the wrong size into
 * a sticky, and then keeps that answer, because the result is memoised and
 * nothing re-renders when the real face turns up. Notes and labels look subtly
 * wrong on a cold load and correct on a warm one, which is the worst way for a
 * bug to present: it does not reproduce for the person who has just been
 * looking at it.
 *
 * So: an epoch that moves when the font situation changes. Caches key off it,
 * probes are dropped, and renderers subscribe so they re-measure.
 *
 * ## Why `document.fonts.ready` is not enough on its own
 *
 * `ready` resolves when nothing is *currently* pending, which on a cold start
 * is true well before a face we care about has been asked for. Canvas
 * measurement does trigger a load in Blink, but asynchronously and only at the
 * first measurement, so whether `ready` waits for it is a race against how
 * fast the board's contents arrive over the network. Losing that race spent
 * the one epoch bump on nothing and left the fallback measurement cached for
 * the life of the page. That is precisely the "reload fixes it" report: a
 * second load finds the face in cache, where it resolves without a pending
 * load to lose the race to.
 *
 * The fix is to stop inferring and start asking. `requestFont` names the face
 * we want, and the epoch moves when *that* resolves. `ready` and `loadingdone`
 * stay as backstops for faces somebody else pulled in.
 */

let value = 0;
const subscribers = new Set<() => void>();
const invalidators = new Set<() => void>();

export const fontEpoch = {
  get: (): number => value,
  subscribe: (listener: () => void) => {
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  },
};

/**
 * Work to run when the epoch moves, before subscribers are told: clearing a
 * memo table, dropping a measurement probe. Registered once at module scope,
 * never unregistered.
 */
export function onFontsChanged(fn: () => void): void {
  invalidators.add(fn);
}

function bump(): void {
  value += 1;
  invalidators.forEach((fn) => fn());
  subscribers.forEach((fn) => fn());
}

/**
 * Faces already asked for, so we ask once.
 *
 * Two reasons. `FontSelector` calls this on every hover, and re-entering the
 * loading path per mouse movement is waste. More importantly a bump re-renders
 * whoever subscribed, and a renderer that requests a font while rendering
 * would then request it again on the render the bump caused; deduping here
 * means that loop cannot be written by accident.
 */
const asked = new Set<string>();

/**
 * Ask for a face by CSS font shorthand (`"600 16px Caveat"`), and move the
 * epoch when it arrives.
 */
export function requestFont(spec: string): void {
  if (asked.has(spec)) return;
  asked.add(spec);
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  document.fonts
    .load(spec)
    .then((faces) => {
      // Nothing matched: a generic family, or a face we do not actually load.
      // The fallback is already what is drawn, so there is nothing to redo.
      if (faces.length > 0) bump();
    })
    .catch(() => {
      // An unloadable face, or a shorthand the parser rejected. Either way the
      // fallback stands and the measurements against it are correct.
    });
}

if (typeof document !== 'undefined' && document.fonts) {
  // Backstops, for faces requested by the DOM rather than through us. Neither
  // can loop: a bump starts no loads, and `requestFont` is deduped.
  document.fonts.ready.then(bump).catch(() => {});
  document.fonts.addEventListener?.('loadingdone', bump);
}
