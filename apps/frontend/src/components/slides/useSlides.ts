import { useMemo, useSyncExternalStore } from 'react';
import { useStore } from '../../hooks/useStore';
import type { AnyNode } from '../../engine/model/schema';
import { deckOf, type DeckSlide } from '../../engine/slides/deck';
import { cameraSystem } from '../../engine/CameraSystem';
import { slidePose } from '../../engine/model/frames';
import { nodeBounds } from '../../engine/model/selection';

/** Whether the app is wearing its dark theme, kept current as it is switched. */
export function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribeTheme, isDark, () => false);
}

const isDark = () => typeof document !== 'undefined' && document.body.classList.contains('dark-theme');

function subscribeTheme(listener: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(listener);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** The board's objects and the deck made of them. */
export function useDeck(): { objects: Record<string, AnyNode>; deck: DeckSlide[] } {
  const objects = useStore((s) => s.objects) as Record<string, AnyNode>;
  const deck = useMemo(() => deckOf(objects), [objects]);
  return { objects, deck };
}

/** Open the slide view, optionally with a slide selected. */
export function openSlideView(focusId?: string): void {
  window.dispatchEvent(new CustomEvent('vega:open-slide-view', { detail: { focusId } }));
}

export interface PresentRequest {
  startId?: string;
  /** Invite everyone in the room to follow. */
  everyone?: boolean;
  /** Open the presenter view as well: in a second window, or over this screen. */
  presenterView?: 'window' | 'split';
}

/** Start presenting. The presenter on the board answers. */
export function startPresenting(request: PresentRequest = {}): void {
  window.dispatchEvent(new CustomEvent('presentFrames', { detail: request }));
}

/** Fly the camera to a slide and select it, as a double-click in the slide view does. */
export function goToSlide(frameId: string): void {
  const frame = useStore.getState().objects[frameId];
  if (!frame) return;
  window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: [frameId] } }));
  const pose = slidePose(nodeBounds(frame), { width: cameraSystem.width, height: cameraSystem.height }, 96);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  cameraSystem.animateTo(pose.x, pose.y, pose.zoom, { duration: reduce ? 0 : 420 });
}

/** Whether keys pressed now are typing into something: a field, or editable text. */
export function isTypingTarget(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color'].includes(type);
  }
  return (el as HTMLElement).isContentEditable === true;
}
