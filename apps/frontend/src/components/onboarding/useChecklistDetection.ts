import { useEffect } from 'react';
import { useStore } from '../../hooks/useStore';
import { localAuthorId, whenDocumentReady } from '../../engine/document';
import { collaboratorStore } from '../../engine/presence/collaboratorStore';
import { getPlayingSignal, subscribePlayingSignal } from '../../engine/music/playingSignal';
import {
  checklistState,
  detectFromDocument,
  type ChecklistItemId,
} from '../../engine/learn/tourChecklist';

/** How long after a change the document is looked at. Drags and typing coalesce. */
const SCAN_DELAY_MS = 300;
/**
 * How long after the document is ready watching begins.
 *
 * A board opened from a template is seeded by this browser, stamped with your
 * author id, right after the document is ready. Taking the baseline after it
 * lands is what stops forty template nodes ticking three rows you never did.
 */
const SETTLE_MS = 1200;

const DOC_ITEMS: readonly ChecklistItemId[] = ['draw', 'sticky', 'connect'];

const has = (id: ChecklistItemId) => checklistState.getSnapshot().done.includes(id);

/**
 * Watch for the checklist's five moves while the checklist is live.
 *
 * Each source is watched only until its items are done, so a finished list
 * costs nothing: no store subscription, no roster subscription, no listener.
 *
 * - The document, debounced, and only nodes made after watching began.
 * - The roster: somebody arriving who was not here when watching began, and
 *   who is not you in another tab.
 * - Opening Share: a press on anything carrying the share hook.
 * - The record button actually playing.
 */
export function useChecklistDetection(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const stops: Array<() => void> = [];
    let cancelled = false;

    /* ------------------------------------------------------ the document */
    if (DOC_ITEMS.some((id) => !has(id))) {
      let timer: number | undefined;
      let baseline: Set<string> | null = null;
      let ready: number | undefined;

      const scan = () => {
        timer = undefined;
        if (!baseline) return;
        if (DOC_ITEMS.every(has)) return;
        checklistState.mark(detectFromDocument(useStore.getState().objects, baseline, localAuthorId()));
      };

      void whenDocumentReady().then(() => {
        if (cancelled) return;
        ready = window.setTimeout(() => {
          baseline = new Set(Object.keys(useStore.getState().objects));
          const unsubscribe = useStore.subscribe((s, prev) => {
            if (s.objects === prev.objects || timer !== undefined) return;
            if (DOC_ITEMS.every(has)) {
              unsubscribe();
              return;
            }
            timer = window.setTimeout(scan, SCAN_DELAY_MS);
          });
          stops.push(unsubscribe);
        }, SETTLE_MS);
      });

      stops.push(() => {
        window.clearTimeout(timer);
        window.clearTimeout(ready);
      });
    }

    /* ---------------------------------------------------------- invite */
    if (!has('invite')) {
      const me = localAuthorId();
      const present = new Set(collaboratorStore.getSnapshot().map((c) => c.clientId));
      const unsubscribe = collaboratorStore.subscribe(() => {
        const arrived = collaboratorStore
          .getSnapshot()
          .some((c) => !present.has(c.clientId) && c.id !== me);
        if (arrived) checklistState.mark(['invite']);
      });
      stops.push(unsubscribe);

      const onPress = (e: Event) => {
        const target = e.target as Element | null;
        if (target?.closest?.('[data-tour="share"]')) checklistState.mark(['invite']);
      };
      document.addEventListener('click', onPress, true);
      stops.push(() => document.removeEventListener('click', onPress, true));
    }

    /* ----------------------------------------------------------- music */
    if (!has('music')) {
      const check = () => {
        if (getPlayingSignal().playing) checklistState.mark(['music']);
      };
      check();
      stops.push(subscribePlayingSignal(check));
    }

    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
    };
  }, [active]);
}
