import type { StickyNode } from '../model/schema';
import type { SketchLevel } from '../model/rough';
import {
  contrastRatio,
  faceStops,
  flapStops,
  paperOf,
  paperShadows,
  STICKY_PADDING,
  STICKY_RADIUS,
  type Paper,
  type PaperShadow,
  type Stops,
} from '../model/stickyThemes';
import { FORMAT_SPECS, resolveBackground, type ExportBackground } from './ExportTypes';
import { flapPath, flapPlacement, foldedPaperPath, foldSize } from '../model/stickyFold';
import { roughStickyPaper } from '../model/roughNodes';
import { authorWidth, FOOTER_BAND, FOOTER_ROW, layoutFooter, PIN_INSET, textBox } from '../model/stickyFooter';
import { CHECK_BOX, CHECK_GAP } from '../model/stickyRich';
import { STICKY_LINE_HEIGHT } from '../model/stickyText';
import { STAMP_PLUS_ONE } from '../model/stickyStamps';
import { isEmojiLike } from '../emoji/emojiText';
import { emojiSvgElement } from '../emoji/emojiSvg';
import { initialsFor } from '../presence/collaborators';
import { stickyText } from '../../components/canvas/renderers/stickyRichLayout';
import { STICKY_FONT_FAMILY, STICKY_FONT_WEIGHT } from '../../components/canvas/renderers/stickyFit';
import { attr, escapeXml, num } from './markup';

/**
 * A sticky note as SVG, drawn the way `StickyRenderer` draws it at rest.
 *
 * The same paper (`paperOf`), the same cut corner and flap (`stickyFold`), the
 * same two-layer shadow (`paperShadows`), the same writing layout
 * (`stickyText`) and the same footer layout (`layoutFooter`), so a note in a
 * file is the note on the board rather than a coloured box with text near it.
 *
 * ## Shadows point down the page
 *
 * The canvas offsets a shadow on the screen's axes whatever the note's
 * rotation, as a light above the board would. SVG filters work in the user
 * space of the element they are on, so each shadow's filter goes on a group
 * *outside* the note's rotation: the silhouette turns, its shadow still falls
 * straight down. The flap's shadow, a unit or two of offset, turns with the
 * note; drawing it outside would mean drawing the flap there too.
 *
 * Konva's `shadowBlur` is a canvas blur radius, about twice a Gaussian
 * deviation, so the filters use half of it.
 *
 * Hover-only furniture (the add-stamp button, the trays, tooltips) and the
 * grain, which is invisible at any size a file is read at, are not drawn.
 */
export interface StickySvgOptions {
  /** The sketch level, when the note is drawn by hand. */
  sketch?: SketchLevel;
  /** Draw the dark-board paper, for a file whose background is dark. */
  darkBoard?: boolean;
  /** The note's rotation/flip transform attribute (` transform="…"`), about its centre in world space. */
  transform: string;
}

/**
 * Whether an export's background is dark enough to want the dark-board paper.
 *
 * Resolved the way the file's own background is (`resolveBackground`), so
 * "ink" and a dark custom colour both count and transparent does not.
 */
export function isDarkExportBackground(background: ExportBackground | undefined): boolean {
  const resolved = resolveBackground(background, FORMAT_SPECS.svg);
  if (!resolved || !/^#[0-9a-f]{6}$/i.test(resolved)) return false;
  return contrastRatio(resolved, '#FFFFFF') > contrastRatio(resolved, '#000000');
}

/** Ids are per note; node ids are nanoids, but nothing here trusts that. */
const safeId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');

function gradient(id: string, stops: Stops, from: { x: number; y: number }, to: { x: number; y: number }): string {
  return (
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(from.x)}" y1="${num(from.y)}" x2="${num(to.x)}" y2="${num(to.y)}">` +
    stops.map(([at, colour]) => `<stop offset="${num(at)}" stop-color="${attr(colour)}" />`).join('') +
    `</linearGradient>`
  );
}

/** One canvas-style shadow as a filter primitive chain; `result` names its output. */
function shadowPrimitives(s: PaperShadow & { offsetX?: number }, result: string): string {
  return (
    `<feGaussianBlur in="SourceAlpha" stdDeviation="${num(s.blur / 2)}" />` +
    `<feOffset dx="${num(s.offsetX ?? 0)}" dy="${num(s.offsetY)}" result="${result}o" />` +
    `<feFlood flood-color="#000" flood-opacity="${num(s.opacity)}" />` +
    `<feComposite in2="${result}o" operator="in" result="${result}" />`
  );
}

/** A filter drawing only the shadows, not the shape: the shape is drawn on top, separately. */
function shadowFilter(id: string, layers: Array<PaperShadow & { offsetX?: number }>): string {
  const parts = layers.map((s, i) => shadowPrimitives(s, `s${i}`)).join('');
  const merge = layers.map((_, i) => `<feMergeNode in="s${i}" />`).join('');
  return `<filter id="${id}" x="-30%" y="-30%" width="160%" height="170%" color-interpolation-filters="sRGB">${parts}<feMerge>${merge}</feMerge></filter>`;
}

function stampFace(stamp: string, x: number, y: number, size: number, ink: string): string {
  if (stamp === STAMP_PLUS_ONE) {
    return `<text x="${num(x + size / 2)}" y="${num(y + size / 2)}" text-anchor="middle" dominant-baseline="central" font-family="Inter" font-weight="700" font-size="${num(size * 0.72)}" fill="${attr(ink)}">+1</text>`;
  }
  return emojiSvgElement(stamp, x, y, size) ?? `<text x="${num(x)}" y="${num(y + size * 0.85)}" font-size="${num(size * 0.86)}">${escapeXml(stamp)}</text>`;
}

/** The writing, laid out as the canvas lays it out, in the note's own space. */
function writingMarkup(node: StickyNode, paper: Paper): string {
  const box = textBox(node.width, node.height, STICKY_PADDING, node.tags.length > 0);
  const writing = stickyText(node.text, box, {
    fixedSize: node.textSizing === 'fixed' ? node.fontSize : undefined,
    checklist: node.checklist,
  });
  const { layout, fontSize } = writing;
  const top = box.y + (writing.overflows ? 0 : Math.max(0, (box.height - layout.height) / 2));
  const rowH = fontSize * STICKY_LINE_HEIGHT;
  const out: string[] = [];
  for (const line of layout.lines) {
    const y = top + line.y;
    // Lines past the box are clipped on the canvas; here they are not drawn.
    if (y + rowH > box.y + box.height + 0.5 && writing.overflows) break;
    if (line.check) {
      const s = fontSize * CHECK_BOX;
      const cx = box.x + line.x - fontSize * (CHECK_BOX + CHECK_GAP);
      const cy = y + (rowH - s) / 2;
      const done = line.check === 'done';
      out.push(
        `<rect x="${num(cx)}" y="${num(cy)}" width="${num(s)}" height="${num(s)}" rx="${num(fontSize * 0.14)}" fill="${done ? attr(paper.ink) : 'none'}" stroke="${attr(paper.ink)}" stroke-width="${num(Math.max(1.2, fontSize * 0.06))}" />`
      );
      if (done) {
        out.push(
          `<path d="M5 12.5l4.2 4.2L19 7" transform="translate(${num(cx)} ${num(cy)}) scale(${num(s / 24)})" fill="none" stroke="${attr(paper.bg)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`
        );
      }
    }
    for (const run of line.runs) {
      const weight = run.bold ? '700' : STICKY_FONT_WEIGHT;
      const deco = run.href ? ' text-decoration="underline"' : line.done ? ' text-decoration="line-through"' : '';
      const text =
        `<text x="${num(box.x + line.x + run.x)}" y="${num(y + rowH / 2)}" dominant-baseline="central" xml:space="preserve"` +
        ` font-family="${attr(STICKY_FONT_FAMILY)}" font-size="${num(fontSize)}" font-weight="${weight}"${run.italic ? ' font-style="italic"' : ''}` +
        ` fill="${attr(paper.ink)}"${line.done ? ' opacity="0.55"' : ''}${deco}>${escapeXml(run.text)}</text>`;
      out.push(run.href ? `<a href="${attr(run.href)}">${text}</a>` : text);
    }
  }
  if (writing.overflows) {
    out.push(
      `<text x="${num(box.x + box.width)}" y="${num(node.height - FOOTER_BAND - 18 + 13)}" text-anchor="end" font-family="Inter" font-weight="700" font-size="18" fill="${attr(paper.secondaryInk)}">…</text>`
    );
  }
  return out.join('');
}

/** Tags along the top, the author along the bottom, the stamps beside them, and the pin. */
function furnitureMarkup(node: StickyNode, paper: Paper, fold: number): string {
  const out: string[] = [];
  if (node.tags.length > 0) {
    let x = STICKY_PADDING;
    const limit = node.width - PIN_INSET;
    for (const tag of node.tags.slice(0, 2)) {
      const w = Math.min(74, 12 + tag.length * 5.4);
      if (x + w > limit) break;
      out.push(
        `<rect x="${num(x)}" y="10" width="${num(w)}" height="15" rx="7.5" fill="none" stroke="${attr(paper.secondaryInk)}" stroke-opacity="0.5" />` +
          `<text x="${num(x + w / 2)}" y="17.5" text-anchor="middle" dominant-baseline="central" font-family="Inter" font-weight="600" font-size="9" fill="${attr(paper.secondaryInk)}">${escapeXml(tag)}</text>`
      );
      x += w + 4;
    }
  }

  const showAuthor = node.showAuthor !== false;
  const initials = initialsFor(node.author.name);
  const chip = showAuthor ? authorWidth(initials) : 0;
  const rowY = node.height - FOOTER_BAND;
  if (showAuthor) {
    out.push(
      `<circle cx="${num(STICKY_PADDING + 3.5)}" cy="${num(rowY + FOOTER_ROW / 2)}" r="3.5" fill="${attr(node.author.color)}" />` +
        `<text x="${num(STICKY_PADDING + 12)}" y="${num(rowY + FOOTER_ROW / 2)}" dominant-baseline="central" font-family="Inter" font-weight="600" font-size="10" fill="${attr(paper.secondaryInk)}">${escapeXml(initials)}</text>`
    );
  }

  if (node.showStamps !== false) {
    const reactions = Object.entries(node.reactions ?? {}).filter(
      ([key, ids]) => ids.length > 0 && (key === STAMP_PLUS_ONE || isEmojiLike(key))
    );
    const startX = STICKY_PADDING + chip;
    const footer = layoutFooter(reactions, Math.max(0, node.width - startX - Math.max(10, fold + 6) - 24));
    for (const { emoji, ids, width, offset } of footer.visible) {
      const x = startX + offset;
      out.push(
        `<rect x="${num(x)}" y="${num(rowY)}" width="${num(width)}" height="${FOOTER_ROW}" rx="${FOOTER_ROW / 2}" fill="${attr(paper.sheen)}" stroke="${attr(paper.edge)}" />`
      );
      out.push(stampFace(emoji, x + (ids.length > 1 ? 6 : (width - 14) / 2), rowY + 3, 14, paper.ink));
      if (ids.length > 1) {
        out.push(
          `<text x="${num(x + 22)}" y="${num(rowY + FOOTER_ROW / 2)}" dominant-baseline="central" font-family="Inter" font-weight="600" font-size="10" fill="${attr(paper.ink)}">${ids.length}</text>`
        );
      }
    }
    if (footer.overflow.length > 0) {
      const x = startX + footer.overflowOffset;
      out.push(
        `<rect x="${num(x)}" y="${num(rowY)}" width="24" height="${FOOTER_ROW}" rx="${FOOTER_ROW / 2}" fill="${attr(paper.sheen)}" stroke="${attr(paper.edge)}" />` +
          `<text x="${num(x + 12)}" y="${num(rowY + FOOTER_ROW / 2)}" text-anchor="middle" dominant-baseline="central" font-family="Inter" font-weight="600" font-size="10" fill="${attr(paper.ink)}">+${footer.overflow.length}</text>`
      );
    }
  }

  if (node.pinned) {
    out.push(
      `<g transform="translate(${num(node.width - PIN_INSET)} 16) rotate(32)">` +
        `<circle cx="2" cy="3" r="5" fill="#000" fill-opacity="0.11" />` +
        `<line x1="0" y1="2" x2="0" y2="13" stroke="#94A3B8" stroke-width="1.8" stroke-linecap="round" />` +
        `<circle r="5.2" fill="${attr(paper.ink)}" fill-opacity="0.92" />` +
        `<circle cx="-1.6" cy="-1.6" r="1.8" fill="#FFFFFF" fill-opacity="0.45" />` +
        `</g>`
    );
  }
  return out.join('');
}

export function stickyToSvg(node: StickyNode, options: StickySvgOptions): string {
  const { sketch, darkBoard = false, transform } = options;
  const paper = paperOf(node.theme, darkBoard);
  const fold = foldSize(node.width, node.height);
  const shadows = paperShadows(darkBoard, false, fold);
  const rough = sketch ? roughStickyPaper(node, sketch) : null;
  const sheet = rough ? rough.silhouette : foldedPaperPath(node.width, node.height, STICKY_RADIUS, fold);
  const place = flapPlacement(node.width, node.height, fold);
  const flapFrame = `translate(${num(place.x)} ${num(place.y)}) rotate(${place.rotation})`;
  const flapD = rough ? rough.flap.silhouette : flapPath(place.half);

  const id = `st-${safeId(node.id)}`;
  const at = `translate(${num(node.x)} ${num(node.y)})`;
  // Both layers when the note is opaque, as on the canvas; a translucent note
  // keeps one, or the second would show through the sheet.
  const sheetShadows = (node.opacity ?? 1) >= 1 ? [shadows.ambient, shadows.contact] : [shadows.ambient];

  const defs =
    `<defs>` +
    gradient(`${id}-face`, faceStops(paper), { x: 0, y: 0 }, { x: 0, y: node.height }) +
    (fold > 0 && !rough ? gradient(`${id}-flap`, flapStops(paper), { x: 0, y: 0 }, { x: 0, y: place.half }) : '') +
    shadowFilter(`${id}-shadow`, sheetShadows) +
    (fold > 0 ? shadowFilter(`${id}-flapshadow`, [shadows.flap]) : '') +
    `</defs>`;

  // The flap in its own frame (crisp) or in the note's space (hand-cut).
  const flapShape = (fill: string, extra = '') =>
    rough
      ? `<path d="${flapD}" fill="${fill}"${extra} />`
      : `<path d="${flapD}" transform="${flapFrame}" fill="${fill}"${extra} />`;

  const parts: string[] = [defs];
  // The shadows, outside the rotation so they fall down the page.
  parts.push(`<g filter="url(#${id}-shadow)"><g${transform}><path d="${sheet}" transform="${at}" fill="${attr(paper.bg)}" /></g></g>`);

  const body: string[] = [];
  body.push(`<path d="${sheet}" fill="url(#${id}-face)" />`);
  body.push(
    rough
      ? `<path d="${rough.outline}" fill="none" stroke="${attr(paper.edge)}" stroke-width="${rough.edgeWidth}" stroke-linecap="round" stroke-linejoin="round" />`
      : `<path d="${sheet}" fill="none" stroke="${attr(paper.edge)}" stroke-width="1" />`
  );
  if (fold > 0) {
    body.push(`<g filter="url(#${id}-flapshadow)">${flapShape(attr(paper.back))}</g>`);
    body.push(
      rough
        ? flapShape(attr(paper.back)) +
            `<path d="${rough.flap.outline}" fill="none" stroke="${attr(paper.edge)}" stroke-width="${rough.edgeWidth}" stroke-linecap="round" stroke-linejoin="round" />`
        : flapShape(`url(#${id}-flap)`, ` stroke="${attr(paper.edge)}" stroke-width="0.75" stroke-linejoin="round"`)
    );
  }
  body.push(writingMarkup(node, paper));
  body.push(furnitureMarkup(node, paper, fold));

  parts.push(`<g${transform}><g transform="${at}">${body.join('')}</g></g>`);
  return parts.join('');
}
