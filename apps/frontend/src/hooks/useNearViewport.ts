import { useEffect, useRef, useState } from 'react';

/**
 * Whether an element is on screen, or close enough to be about to be.
 *
 * ## Why a list of previews needs this
 *
 * The example browser draws each card by laying out a real chart. Measured:
 * sixty-three of them is **374ms** of blocked main thread, and a contour map
 * is ~35ms by itself. Nine of those cards are visible when the popover opens.
 * Paying for fifty-four that nobody has scrolled to is most of the cost of
 * opening it, and all of the reason it felt slow.
 *
 * ## Why it latches
 *
 * Once true it stays true. A card that has been rendered must not un-render
 * when it scrolls away: the work is already done and cached, so hiding it
 * would save nothing and cost a flash of skeleton on the way back. This
 * observes to *start* work, never to stop it.
 *
 * ## The margin
 *
 * Generous on purpose. A card that begins rendering when its top edge crosses
 * the viewport renders *while* you are looking at it, which is the flash the
 * skeleton was meant to avoid. Half a screen of warning is enough for a 35ms
 * layout to finish before it is looked at.
 */
export function useNearViewport<T extends Element>(
  options: { rootMargin?: string; enabled?: boolean } = {}
): [React.RefObject<T | null>, boolean] {
  const { rootMargin = '240px', enabled = true } = options;
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(!enabled);

  useEffect(() => {
    if (!enabled || near) return;
    const element = ref.current;
    if (!element) return;

    // No observer means no lazy rendering rather than no rendering: a browser
    // without it should be slower, never blank.
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, near, rootMargin]);

  return [ref, near];
}
