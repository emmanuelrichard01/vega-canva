import React, { useEffect, useMemo, useState } from 'react';
import { SlidePlan } from './SlidePlan';
import type { AnyNode, FrameNode } from '../../engine/model/schema';
import { cachedThumbnail, slideThumbnail, slideVersion } from '../../engine/slides/slideRaster';

/**
 * A slide's picture.
 *
 * The real slide, captured by the board's renderer (`slideRaster`), once it
 * has been drawn; until then, and wherever there is no board to draw with, a
 * plan of the slide drawn from the document: the page in its own colour, text
 * as lines in its own ink, shapes as their fills. The plan is accurate enough
 * to tell slides apart at a glance, which is all a placeholder for a picture
 * has to do.
 */
export const SlideThumb: React.FC<{
  frame: FrameNode;
  objects: Record<string, AnyNode>;
  dark: boolean;
  /** Pixel width to capture at. */
  width?: number;
  /** Capture the real slide. Off in lists long enough that only the plan is worth drawing. */
  capture?: boolean;
  className?: string;
}> = ({ frame, objects, dark, width = 480, capture = true, className }) => {
  const version = useMemo(() => slideVersion(frame.id, objects, dark), [frame.id, objects, dark]);
  const [url, setUrl] = useState<string | null>(() => cachedThumbnail(frame.id));

  useEffect(() => {
    if (!capture) return;
    let live = true;
    // Captures queue behind each other; a short delay lets a burst of edits settle first.
    const timer = window.setTimeout(() => {
      void slideThumbnail(frame.id, version, width).then((next) => {
        if (live && next) setUrl(next);
      });
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [frame.id, version, width, capture]);

  return (
    <span className={`slide-thumb${className ? ` ${className}` : ''}`} style={{ aspectRatio: `${frame.width} / ${frame.height}` }}>
      {url ? <img src={url} alt="" draggable={false} /> : <SlidePlan frame={frame} objects={objects} />}
    </span>
  );
};
