import type { LinkDisplay, ResolvedLinkDisplay } from './linkTypes';

/**
 * How a link card is laid out, from its box.
 *
 * ## The card follows its shape
 *
 * A link can be shown four ways — a compact chip, a horizontal card, a vertical
 * card, a live embed — and on a board the shape of the box is itself a choice.
 * Left on `auto`, the card reads the box: a short strip is a chip, a wide one
 * is a horizontal card, anything taller is a vertical one. Resizing a card
 * therefore changes how it presents, the way a responsive layout does, and
 * choosing a display explicitly pins it.
 *
 * Pure, and in world units, so the renderer, the exporter and the embed overlay
 * all agree where the media area is.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LinkCardLayout {
  display: ResolvedLinkDisplay;
  radius: number;
  /** The preview picture, or the provider-tinted panel standing in for one. */
  media: Rect | null;
  /** The favicon tile, and where the site name sits beside it. */
  icon: { x: number; y: number; size: number };
  site: Rect;
  title: Rect & { fontSize: number; lines: number };
  description: (Rect & { fontSize: number; lines: number }) | null;
  /** The "open" affordance, top-right for chips and embed headers. */
  action: { x: number; y: number; size: number } | null;
}

export const TITLE_LINE = 1.28;
export const DESC_LINE = 1.4;

export function resolveDisplay(display: LinkDisplay, width: number, height: number, canEmbed: boolean): ResolvedLinkDisplay {
  if (display === 'embed') return canEmbed ? 'embed' : 'vertical';
  if (display !== 'auto') return display;
  if (height <= 96) return 'compact';
  return width / height >= 2.1 ? 'horizontal' : 'vertical';
}

/** The size a card is placed at, or snaps to when its display is chosen. */
export function naturalLinkSize(display: ResolvedLinkDisplay, embedAspect = 16 / 9): { width: number; height: number } {
  switch (display) {
    case 'compact':
      return { width: 340, height: 64 };
    case 'horizontal':
      return { width: 520, height: 144 };
    case 'vertical':
      return { width: 340, height: 330 };
    case 'embed': {
      const width = embedAspect < 1 ? 320 : 560;
      return { width, height: Math.round(EMBED_HEADER + width / embedAspect) };
    }
  }
}

export const EMBED_HEADER = 44;
const PAD = 16;

const lines = (room: number, fontSize: number, lineHeight: number, max: number) =>
  Math.max(0, Math.min(max, Math.floor(room / (fontSize * lineHeight))));

export function layoutLinkCard(
  display: ResolvedLinkDisplay,
  width: number,
  height: number,
  hasImage: boolean,
  hasDescription: boolean
): LinkCardLayout {
  const radius = 12;

  if (display === 'compact') {
    const size = Math.min(36, height - 20);
    const textX = PAD + size + 12;
    const textW = Math.max(0, width - textX - PAD - 24);
    const mid = height / 2;
    return {
      display,
      radius,
      media: null,
      icon: { x: PAD, y: mid - size / 2, size },
      site: { x: textX, y: mid + 2, width: textW, height: 16 },
      title: { x: textX, y: mid - 19, width: textW, height: 19, fontSize: 14, lines: 1 },
      description: null,
      action: { x: width - PAD - 14, y: mid - 7, size: 14 },
    };
  }

  if (display === 'embed') {
    return {
      display,
      radius,
      media: { x: 0, y: EMBED_HEADER, width, height: Math.max(0, height - EMBED_HEADER) },
      icon: { x: 14, y: (EMBED_HEADER - 18) / 2, size: 18 },
      site: { x: 0, y: 0, width: 0, height: 0 },
      title: { x: 42, y: (EMBED_HEADER - 18) / 2, width: Math.max(0, width - 42 - 44), height: 18, fontSize: 13, lines: 1 },
      description: null,
      action: { x: width - 14 - 14, y: (EMBED_HEADER - 14) / 2, size: 14 },
    };
  }

  if (display === 'horizontal') {
    const mediaW = hasImage ? Math.min(Math.round(height * 1.45), Math.round(width * 0.4)) : 0;
    const x = mediaW + PAD;
    const w = Math.max(0, width - x - PAD);
    const titleY = PAD + 22;
    const titleLines = lines(height - titleY - PAD, 15, TITLE_LINE, 2);
    const titleH = Math.max(1, titleLines) * 15 * TITLE_LINE;
    const descY = titleY + titleH + 6;
    const descLines = hasDescription ? lines(height - descY - PAD, 12.5, DESC_LINE, 3) : 0;
    return {
      display,
      radius,
      media: mediaW > 0 ? { x: 0, y: 0, width: mediaW, height } : null,
      icon: { x, y: PAD, size: 16 },
      site: { x: x + 22, y: PAD, width: Math.max(0, w - 22), height: 16 },
      title: { x, y: titleY, width: w, height: titleH, fontSize: 15, lines: Math.max(1, titleLines) },
      description: descLines > 0 ? { x, y: descY, width: w, height: descLines * 12.5 * DESC_LINE, fontSize: 12.5, lines: descLines } : null,
      action: null,
    };
  }

  // Vertical.
  const mediaH = hasImage ? Math.min(Math.round(width / 1.91), Math.round(height * 0.58)) : 0;
  const top = mediaH + PAD;
  const w = Math.max(0, width - PAD * 2);
  const titleY = top + 24;
  const titleLines = lines(height - titleY - PAD, 16, TITLE_LINE, 3);
  const titleH = Math.max(1, titleLines) * 16 * TITLE_LINE;
  const descY = titleY + titleH + 6;
  const descLines = hasDescription ? lines(height - descY - PAD, 13, DESC_LINE, 4) : 0;
  return {
    display,
    radius,
    media: mediaH > 0 ? { x: 0, y: 0, width, height: mediaH } : null,
    icon: { x: PAD, y: top, size: 16 },
    site: { x: PAD + 22, y: top, width: Math.max(0, w - 22), height: 16 },
    title: { x: PAD, y: titleY, width: w, height: titleH, fontSize: 16, lines: Math.max(1, titleLines) },
    description: descLines > 0 ? { x: PAD, y: descY, width: w, height: descLines * 13 * DESC_LINE, fontSize: 13, lines: descLines } : null,
    action: null,
  };
}

/** Cover-fit a picture into a box: the crop rectangle in the picture's own pixels. */
export function coverCrop(imageW: number, imageH: number, boxW: number, boxH: number): Rect {
  if (!(imageW > 0 && imageH > 0 && boxW > 0 && boxH > 0)) return { x: 0, y: 0, width: imageW, height: imageH };
  const scale = Math.max(boxW / imageW, boxH / imageH);
  const width = boxW / scale;
  const height = boxH / scale;
  return { x: (imageW - width) / 2, y: (imageH - height) / 2, width, height };
}
