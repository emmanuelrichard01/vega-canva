import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Template } from '../../engine/templates/templates';
import { WorkspaceCover } from '../WorkspaceCover';
import { templateCover } from './templateCover';
import { cachedCover, coverUrl, drawnCover } from './templatePicture';

/**
 * One observer for every cover on the page, rather than one each.
 *
 * Covers are asked for a little before they scroll in, so a steady scroll
 * finds them drawn; the ones already on screen jump the queue.
 */
type Seen = (onScreen: boolean) => void;
const watchers = new Map<Element, Seen>();
let observer: IntersectionObserver | null = null;

function watch(el: Element, seen: Seen): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    // Asynchronously, as an observer would, so the caller has its `stop` first.
    let live = true;
    queueMicrotask(() => { if (live) seen(true); });
    return () => { live = false; };
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const onScreen = entry.intersectionRect.height > 0 && entry.boundingClientRect.top < window.innerHeight;
        watchers.get(entry.target)?.(onScreen);
      }
    },
    { rootMargin: '320px 0px' }
  );
  watchers.set(el, seen);
  observer.observe(el);
  return () => {
    watchers.delete(el);
    observer?.unobserve(el);
  };
}

interface Props {
  template: Template;
}

/**
 * A template's cover: the real board, drawn small.
 *
 * Waits on a quiet placeholder of the board's own ground until the picture is
 * drawn, and falls back to the silhouette summary if drawing fails, so a card
 * is never an empty box.
 */
export const LiveCover: React.FC<Props> = ({ template }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(() => drawnCover(template) ?? null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    // A cover that is already drawn is kept on screen rather than blanked and refilled.
    const known = drawnCover(template) ?? null;
    setUrl(known);
    setFailed(false);
    setLoaded(false);
    const take = (pending: Promise<string>) =>
      pending.then((u) => { if (live) setUrl(u); }, () => { if (live) setFailed(true); });

    const ready = cachedCover(template);
    if (ready) {
      void take(ready);
      return () => { live = false; };
    }
    const el = ref.current;
    if (!el) return () => { live = false; };
    const stop = watch(el, (onScreen) => {
      stop();
      void take(coverUrl(template, onScreen));
    });
    return () => {
      live = false;
      stop();
    };
  }, [template]);

  // Only computed when the real picture could not be drawn.
  const fallback = useMemo(() => (failed ? templateCover(template) : null), [failed, template]);

  return (
    <span className="gcover" ref={ref} data-state={failed ? 'failed' : url && loaded ? 'ready' : 'waiting'}>
      {failed ? (
        <WorkspaceCover workspaceId={template.id} name={template.name} preview={fallback} />
      ) : url ? (
        <img
          className="gcover__img"
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
};
