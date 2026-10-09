import type { Template } from '../../engine/templates/templates';
import { BAKED_COVERS } from './bakedCovers';

/**
 * Pictures of templates, drawn once each and kept for the life of the page.
 *
 * Two kinds, for two jobs:
 *
 * - **Covers** are small and many. Each is an SVG file behind an object URL,
 *   shown through `<img>`, so forty of them cost forty decoded images rather
 *   than forty thousand live DOM nodes, and their ids cannot collide.
 * - **Boards** are large and few (the showcase and the peek). They are inline
 *   markup, so they set in the page's own Inter and stay sharp at any zoom.
 *
 * Covers are baked by the build (`coverRender.ts`, `vite.config.ts`) and
 * served as immutable files, so in production a cover is just an image
 * request. What follows draws a cover in the browser only when it was not
 * baked: in dev, or for a template the build could not draw.
 *
 * The renderer is loaded on first use, so the chart, table and connector
 * engines it composes stay out of the dashboard's first paint. Covers are
 * drawn one at a time in idle moments, nearest-first as cards scroll into
 * view, so a page of them never janks the scroll that revealed them.
 */

const loadCoverRenderer = () => import('./coverRender');
const loadRenderer = () => import('./boardSvg');

const covers = new Map<string, Promise<string>>();
/** Covers already drawn, so a card that remounts shows its picture on its first render. */
const drawn = new Map<string, string>();
const boards = new Map<string, Promise<BoardPicture>>();

type Job = () => Promise<void>;
const queue: Job[] = [];
let draining = false;

const idle = (): Promise<void> =>
  new Promise((resolve) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 250 });
    else window.setTimeout(resolve, 16);
  });

const breathe = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      await idle();
      const job = queue.shift();
      if (job) await job();
    }
  } finally {
    draining = false;
  }
}

function schedule<T>(work: () => Promise<T>, urgent: boolean): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: Job = () => work().then(resolve, reject);
    if (urgent) queue.unshift(job);
    else queue.push(job);
    void drain();
  });
}

/**
 * An object URL for a template's cover.
 *
 * `urgent` puts it at the front of the queue: a card already on screen is
 * worth more than one that will be scrolled to.
 */
export function coverUrl(template: Template, urgent = false): Promise<string> {
  const baked = BAKED_COVERS[template.id];
  if (baked) return Promise.resolve(baked);
  let cover = covers.get(template.id);
  if (!cover) {
    cover = schedule(async () => {
      const { renderCoverSvg } = await loadCoverRenderer();
      // Give the frame that asked a breath before the synchronous build starts.
      await breathe();
      const svg = await renderCoverSvg(template);
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      drawn.set(template.id, url);
      return url;
    }, urgent);
    // A failure is not cached: the next card to ask tries again.
    cover.catch(() => covers.delete(template.id));
    covers.set(template.id, cover);
  }
  return cover;
}

/** The URL of a cover already drawn, for a synchronous first render. */
export function drawnCover(template: Template): string | undefined {
  return BAKED_COVERS[template.id] ?? drawn.get(template.id);
}

/** A cover drawn or being drawn. */
export function cachedCover(template: Template): Promise<string> | undefined {
  const baked = BAKED_COVERS[template.id];
  return baked ? Promise.resolve(baked) : covers.get(template.id);
}

export interface BoardPicture {
  svg: string;
  bounds: { x: number; y: number; width: number; height: number };
  objectCount: number;
}

/**
 * Inline markup for the whole board, at full size.
 *
 * `slot` names where it is shown ("hero", "peek"), so two pictures of one
 * board on screen at once each own their ids.
 */
export function boardPicture(template: Template, slot: string, displayWidth = 720): Promise<BoardPicture> {
  const key = `${slot}:${template.id}`;
  let picture = boards.get(key);
  if (!picture) {
    picture = schedule(async () => {
      const { renderBoardSvg } = await loadRenderer();
      return renderBoardSvg(template.build(), { idPrefix: `${slot}${template.id}-`, displayWidth, ground: null, maxSamples: 600 });
    }, true);
    picture.catch(() => boards.delete(key));
    boards.set(key, picture);
  }
  return picture;
}

/** Start drawing a board picture ahead of need, such as the next one in the showcase. */
export function prefetchBoard(template: Template, slot: string, displayWidth?: number): void {
  void boardPicture(template, slot, displayWidth).catch(() => undefined);
}
