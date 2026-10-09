import React, { Suspense, lazy, useEffect, useState } from 'react';
import { installPlaceholders } from '../../engine/slides/placeholders';
import { isPresenting } from '../../engine/tools/presenting';
import { AudienceBar } from './Reactions';
import { isTypingTarget } from './useSlides';

const SlideView = lazy(() => import('./SlideView'));

/** The slide view's key: Mod+Alt+S. */
export const SLIDE_VIEW_SHORTCUT = 'Mod+Alt+S';

/**
 * Everything about slides that is always on the board, kept small: the slide
 * view (loaded the first time it is opened), the placeholder behaviour, and
 * the reactions bar a follower sees during someone else's presentation.
 *
 * The slide view opens on `vega:open-slide-view` (see `openSlideView`), from
 * the frame rail and the panel, and on Mod+Alt+S.
 */
export const SlidesHost: React.FC = () => {
  const [view, setView] = useState<{ focusId?: string } | null>(null);

  useEffect(() => installPlaceholders(), []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      if (isPresenting()) return;
      setView({ focusId: (e as CustomEvent<{ focusId?: string }>).detail?.focusId });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isPresenting() || isTypingTarget(document.activeElement)) return;
      if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setView((v) => (v ? null : {}));
      }
    };
    window.addEventListener('vega:open-slide-view', onOpen);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('vega:open-slide-view', onOpen);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  return (
    <>
      <AudienceBar />
      {view && (
        <Suspense fallback={null}>
          <SlideView focusId={view.focusId} onClose={() => setView(null)} />
        </Suspense>
      )}
    </>
  );
};
