import { BRAND_AMBER, BRAND_INK, markSvg } from './brand';
import { describeContents, type BoardCard, type CardItem, type CardPreview } from './cardData';
import { measure, textPath, wrap, type TextStyle } from './text';

/**
 * The pictures a link unfurls into: 1200×630, the size every major unfurler
 * crops to without cutting anything off.
 *
 * ## The composition
 *
 * Two halves, the way a board is two things. On the left, what it is called
 * and how much is on it, set large enough to read in a chat thread at the
 * size Slack and iMessage actually show a card. On the right, the board
 * itself on a sheet of paper over the canvas dot grid — the silhouette the
 * dashboard draws on the board's own cover, at share size. Someone scrolling
 * past sees whether this is the retro or the architecture diagram before they
 * read a word.
 *
 * Nothing on a board's card is invented. There are no cursors on it, because
 * a picture of two people editing implies two people are editing; the site's
 * own card, which is openly an illustration, is the only place they appear.
 */

export const CARD_W = 1200;
export const CARD_H = 630;

const GROUND = '#F6F5F2';
const DOTS = '#D8D5CD';
const SHEET_DOTS = '#E9E7E1';
const INK = BRAND_INK;
const SECONDARY = '#55555C';
const TERTIARY = '#8A8A92';

const LEFT = 72;
const COLUMN = 432;
const SHEET = { x: 560, y: 56, w: 584, h: 518, r: 22 };

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ------------------------------------------------------------------ frame

function defs(): string {
  return (
    '<defs>' +
    `<pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1.5" fill="${DOTS}"/></pattern>` +
    `<pattern id="sheetDots" x="${SHEET.x}" y="${SHEET.y}" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="1.3" fill="${SHEET_DOTS}"/></pattern>` +
    // The ground fades toward the left, so the words sit on quiet paper and
    // the grid gathers behind the sheet, where the board is.
    '<linearGradient id="calm" x1="0" y1="0" x2="1" y2="0">' +
    `<stop offset="0" stop-color="${GROUND}" stop-opacity="1"/>` +
    `<stop offset="0.42" stop-color="${GROUND}" stop-opacity="0.92"/>` +
    `<stop offset="0.7" stop-color="${GROUND}" stop-opacity="0"/>` +
    '</linearGradient>' +
    '<filter id="lift" x="-10%" y="-10%" width="120%" height="130%">' +
    '<feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#161616" flood-opacity="0.06"/>' +
    '<feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#161616" flood-opacity="0.11"/>' +
    '</filter>' +
    `<clipPath id="sheetClip"><rect x="${SHEET.x}" y="${SHEET.y}" width="${SHEET.w}" height="${SHEET.h}" rx="${SHEET.r}"/></clipPath>` +
    '</defs>'
  );
}

function ground(): string {
  return (
    `<rect width="${CARD_W}" height="${CARD_H}" fill="${GROUND}"/>` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="url(#dots)"/>` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="url(#calm)"/>`
  );
}

function sheet(inner: string): string {
  return (
    `<rect x="${SHEET.x}" y="${SHEET.y}" width="${SHEET.w}" height="${SHEET.h}" rx="${SHEET.r}" fill="#FFFFFF" filter="url(#lift)"/>` +
    `<g clip-path="url(#sheetClip)"><rect x="${SHEET.x}" y="${SHEET.y}" width="${SHEET.w}" height="${SHEET.h}" fill="url(#sheetDots)"/>${inner}</g>` +
    `<rect x="${SHEET.x + 0.5}" y="${SHEET.y + 0.5}" width="${SHEET.w - 1}" height="${SHEET.h - 1}" rx="${SHEET.r}" fill="none" stroke="#161616" stroke-opacity="0.08"/>`
  );
}

function lockup(): string {
  return (
    markSvg({ size: 48, x: LEFT, y: 68, radius: 10 }) +
    textPath('Vega Studio', LEFT + 64, 101, { size: 25, weight: 700, fill: INK, tracking: -0.01 })
  );
}

function eyebrow(label: string, y: number): string {
  return (
    `<rect x="${LEFT}" y="${y - 11}" width="10" height="10" rx="2.5" fill="${BRAND_AMBER}"/>` +
    textPath(label.toUpperCase(), LEFT + 20, y, { size: 15, weight: 600, fill: TERTIARY, tracking: 0.14 })
  );
}

/**
 * A title set as large as it can be and still fit.
 *
 * Three sizes, tried largest first: a short name fills the column at 64px, a
 * long one steps down rather than being cut, and only a name that will not fit
 * in three lines at the smallest size is ellipsised.
 */
function title(text: string, top: number): { svg: string; bottom: number } {
  for (const size of [64, 54, 46]) {
    const style: TextStyle = { size, weight: 700, tracking: -0.022 };
    const full = wrap(text, COLUMN, style, 99);
    if (full.length <= 3 || size === 46) {
      const lines = full.length <= 3 ? full : wrap(text, COLUMN, style, 3);
      const lineH = size * 1.08;
      const svg = lines.map((line, i) => textPath(line, LEFT, top + size * 0.92 + i * lineH, { ...style, fill: INK })).join('');
      return { svg, bottom: top + size * 0.92 + (lines.length - 1) * lineH };
    }
  }
  return { svg: '', bottom: top };
}

function paragraph(text: string, top: number, style: TextStyle & { fill: string }, maxLines: number, lineH: number): string {
  return wrap(text, COLUMN, style, maxLines)
    .map((line, i) => textPath(line, LEFT, top + i * lineH, style))
    .join('');
}

function footnote(text: string): string {
  return (
    `<rect x="${LEFT}" y="${CARD_H - 104}" width="36" height="4" rx="2" fill="${BRAND_AMBER}"/>` +
    textPath(text, LEFT, CARD_H - 68, { size: 20, weight: 400, fill: TERTIARY })
  );
}

function svgDocument(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">${defs()}${body}</svg>`;
}

// ---------------------------------------------------------------- preview

/**
 * The board's silhouette, fitted into a box.
 *
 * A port of `WorkspaceCover` in the frontend, drawn in the same 100-wide unit
 * space so every stroke weight and every rule about what a text node or a
 * frame looks like carries over exactly: a card and a cover of the same board
 * are the same drawing at two sizes. Kept in step by hand — the cover is a
 * React component and this runs where React does not — so a change to one is
 * a change to both.
 */
export function previewArt(preview: CardPreview, box: { x: number; y: number; w: number; h: number }): string {
  const VIEW_W = 100;
  const VIEW_H = (100 * box.h) / box.w;
  const scale = Math.min(VIEW_W / preview.ratio, VIEW_H) / VIEW_H;
  const drawW = VIEW_H * preview.ratio * scale;
  const drawH = VIEW_H * scale;
  const offX = (VIEW_W - drawW) / 2;
  const offY = (VIEW_H - drawH) / 2;

  const shapes = preview.items.map((item) => drawItem(item, offX, offY, drawW, drawH)).join('');
  return `<g transform="translate(${round(box.x)} ${round(box.y)}) scale(${round(box.w / VIEW_W)})">${shapes}</g>`;
}

export function polygonPoints(item: Pick<CardItem, 's' | 'p' | 'ir'>, x: number, y: number, w: number, h: number): Array<[number, number]> {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const count = Math.max(3, Math.round(item.p ?? 3));
  const isStar = item.s === 'star';
  const inner = isStar ? Math.min(0.95, Math.max(0.05, item.ir ?? 0.5)) : 1;
  const steps = isStar ? count * 2 : count;
  const out: Array<[number, number]> = [];
  for (let k = 0; k < steps; k += 1) {
    const angle = (k / steps) * Math.PI * 2 - Math.PI / 2;
    const r = isStar && k % 2 === 1 ? inner : 1;
    out.push([cx + Math.cos(angle) * (w / 2) * r, cy + Math.sin(angle) * (h / 2) * r]);
  }
  return out;
}

function drawItem(item: CardItem, offX: number, offY: number, drawW: number, drawH: number): string {
  const x = round(offX + item.x * drawW);
  const y = round(offY + item.y * drawH);
  const w = round(Math.max(0.6, item.w * drawW));
  const h = round(Math.max(0.6, item.h * drawH));
  const spin = item.rot ? ` transform="rotate(${item.rot} ${round(x + w / 2)} ${round(y + h / 2)})"` : '';
  const paint = item.no ? `fill="none" stroke="${item.c}" stroke-width="0.8"` : `fill="${item.c}"`;
  const polyline = (l: number[]) => {
    const pts: string[] = [];
    for (let k = 0; k + 1 < l.length; k += 2) pts.push(`${round(offX + l[k] * drawW)},${round(offY + l[k + 1] * drawH)}`);
    return pts.join(' ');
  };

  if (item.l && item.l.length >= 4 && item.s !== 'line') {
    return `<polyline points="${polyline(item.l)}" fill="none" stroke="${item.c}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (item.t) {
    const lineH = item.fs ? Math.max(0.9, item.fs * drawH * 1.35) : Math.max(0.9, h);
    const rules = Math.max(1, Math.min(6, Math.round(h / lineH)));
    const weight = Math.max(0.55, lineH * 0.42);
    let out = `<g fill="${item.c}" opacity="0.55"${spin}>`;
    for (let k = 0; k < rules; k++) {
      const rw = Math.max(0.8, k === rules - 1 && rules > 1 ? w * 0.62 : w);
      out += `<rect x="${x}" y="${round(y + k * lineH + (lineH - weight) / 2)}" width="${round(rw)}" height="${round(weight)}" rx="${round(weight / 2)}"/>`;
    }
    return `${out}</g>`;
  }
  if (item.k) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${item.r ? round(item.r * Math.min(w, h)) : 0}" fill="${item.c}" stroke="rgba(115,115,115,0.28)" stroke-width="0.4"${spin}/>`;
  }
  if (item.o) {
    return `<ellipse cx="${round(x + w / 2)}" cy="${round(y + h / 2)}" rx="${round(w / 2)}" ry="${round(h / 2)}" ${paint}${spin}/>`;
  }
  if (item.s === 'line') {
    const stroke = round(Math.max(0.5, Math.min(1.4, h || 1)));
    if (item.l && item.l.length >= 4) {
      return `<polyline points="${polyline(item.l)}"${spin} fill="none" stroke="${item.c}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return `<line x1="${x}" y1="${round(y + h / 2)}" x2="${round(x + w)}" y2="${round(y + h / 2)}"${spin} stroke="${item.c}" stroke-width="${stroke}" stroke-linecap="round"/>`;
  }
  if (item.s === 'polygon' || item.s === 'star') {
    const pts = polygonPoints(item, x, y, w, h).map(([px, py]) => `${round(px)},${round(py)}`).join(' ');
    return `<polygon points="${pts}" ${paint}${spin}/>`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${item.r ? round(item.r * Math.min(w, h)) : 0}" ${paint}${spin}/>`;
}

// -------------------------------------------------------- the sample board

const ruled = (x: number, y: number, w: number, lines: number, fill: string, gap = 12, weight = 5) =>
  Array.from({ length: lines }, (_, i) =>
    `<rect x="${x}" y="${y + i * gap}" width="${i === lines - 1 && lines > 1 ? w * 0.6 : w}" height="${weight}" rx="${weight / 2}" fill="${fill}"/>`
  ).join('');

const arrow = (x1: number, y1: number, x2: number, y2: number, color: string) => {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 8;
  const a1 = angle + Math.PI * 0.82;
  const a2 = angle - Math.PI * 0.82;
  return (
    `<line x1="${x1}" y1="${y1}" x2="${round(x2 - Math.cos(angle) * 3)}" y2="${round(y2 - Math.sin(angle) * 3)}" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M${x2} ${y2}L${round(x2 + Math.cos(a1) * head)} ${round(y2 + Math.sin(a1) * head)}L${round(x2 + Math.cos(a2) * head)} ${round(y2 + Math.sin(a2) * head)}Z" fill="${color}"/>`
  );
};

function cursor(x: number, y: number, name: string, color: string): string {
  const style: TextStyle = { size: 14, weight: 600 };
  const w = measure(name, style) + 18;
  return (
    `<g filter="url(#lift)"><path d="M${x} ${y}l0 19.5 5.2-4.6 3.5 7.9 3.4-1.5-3.5-7.8 6.9-0.4z" fill="${color}" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/></g>` +
    `<rect x="${x + 14}" y="${y + 20}" width="${round(w)}" height="24" rx="12" fill="${color}"/>` +
    textPath(name, x + 23, y + 37, { ...style, fill: '#FFFFFF' })
  );
}

/**
 * A made-up board, for the site's own card and for a board that has asked not
 * to be shown.
 *
 * Built from the product's real vocabulary — a frame, a flow of shapes and
 * connectors, stickies in their actual paper colours, a code block in the
 * Midnight theme, a chart — so the illustration is a fair picture of what a
 * board holds. `muted` turns it to pencil for the private case, where it
 * should read as "a board" and not as any particular one.
 */
export function sampleBoard(options: { cursors?: boolean; muted?: boolean } = {}): string {
  const ox = SHEET.x;
  const oy = SHEET.y;
  const m = options.muted;
  const tone = (color: string, grey: string) => (m ? grey : color);
  const g = (s: string) => `<g transform="translate(${ox} ${oy})"${m ? ' opacity="0.55"' : ''}>${s}</g>`;

  const frame =
    (m ? '' : textPath('Launch plan', 34, 42, { size: 13, weight: 600, fill: TERTIARY })) +
    `<rect x="32" y="52" width="316" height="224" rx="10" fill="#FFFFFF" stroke="#737373" stroke-opacity="0.3"/>`;

  const flow =
    `<rect x="58" y="92" width="100" height="56" rx="12" fill="${tone('#DBEAFE', '#EFEFEF')}" stroke="${tone('#3B82F6', '#B5B5B5')}" stroke-width="2"/>` +
    ruled(76, 110, 64, 2, tone('#1D4ED8', '#9A9A9A'), 12, 5) +
    arrow(158, 120, 196, 120, tone('#64748B', '#A3A3A3')) +
    `<path d="M242 82L288 120L242 158L196 120Z" fill="${tone('#FEF3C7', '#EFEFEF')}" stroke="${tone('#F59E0B', '#B5B5B5')}" stroke-width="2" stroke-linejoin="round"/>` +
    ruled(226, 116, 32, 1, tone('#92400E', '#9A9A9A'), 12, 5) +
    arrow(242, 158, 242, 196, tone('#64748B', '#A3A3A3')) +
    `<rect x="192" y="196" width="100" height="56" rx="12" fill="${tone('#DCFCE7', '#EFEFEF')}" stroke="${tone('#22C55E', '#B5B5B5')}" stroke-width="2"/>` +
    ruled(210, 214, 64, 2, tone('#15803D', '#9A9A9A'), 12, 5);

  const note = (x: number, y: number, size: number, rot: number, bg: string, ink: string) =>
    `<g transform="rotate(${rot} ${x + size / 2} ${y + size / 2})">` +
    `<rect x="${x}" y="${y + 3}" width="${size}" height="${size}" rx="6" fill="#000000" fill-opacity="0.08"/>` +
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="6" fill="${tone(bg, '#F1F1F1')}"/>` +
    ruled(x + 16, y + 24, size - 36, 3, tone(ink, '#A8A8A8'), 15, 6) +
    '</g>';
  const stickies =
    note(378, 44, 118, -4, '#FFE9A8', '#6B4E05') +
    note(462, 128, 96, 5, '#FBD2E1', '#7C2749') +
    note(376, 176, 84, 2, '#BCEBD7', '#0F5540');

  const tokens = [
    [['#C792EA', 34], ['#D6DEEB', 44], ['#89DDFF', 10], ['#82AAFF', 60]],
    [['#7F8C98', 150]],
    [['#C792EA', 26], ['#82AAFF', 58], ['#9AA7BD', 12], ['#F78C6C', 22]],
    [['#80CBC4', 40], ['#89DDFF', 10], ['#C3E88D', 96]],
    [['#C792EA', 44], ['#D6DEEB', 34], ['#9AA7BD', 10]],
  ] as const;
  let code =
    `<rect x="32" y="302" width="316" height="188" rx="14" fill="${tone('#0E1117', '#DADADA')}"/>` +
    `<path d="M46 302H334Q348 302 348 316V334H32V316Q32 302 46 302Z" fill="${tone('#161B24', '#CFCFCF')}"/>` +
    `<rect x="48" y="314" width="72" height="8" rx="4" fill="${tone('#8B95A7', '#B0B0B0')}"/>` +
    `<rect x="286" y="312" width="48" height="12" rx="6" fill="${tone('#262D3A', '#BDBDBD')}"/>`;
  tokens.forEach((line, row) => {
    const y = 352 + row * 26;
    code += `<rect x="48" y="${y}" width="10" height="7" rx="3" fill="${tone('#566074', '#BDBDBD')}"/>`;
    let x = 74;
    line.forEach(([color, width]) => {
      code += `<rect x="${x}" y="${y}" width="${width}" height="7" rx="3.5" fill="${tone(color, '#B8B8B8')}"/>`;
      x += width + 7;
    });
  });

  const bars = [0.42, 0.66, 0.52, 0.86, 0.74];
  let chart =
    `<rect x="376" y="286" width="178" height="130" rx="12" fill="#FFFFFF" stroke="#161616" stroke-opacity="0.08"/>` +
    `<line x1="394" y1="394" x2="538" y2="394" stroke="#161616" stroke-opacity="0.15" stroke-width="1.5"/>`;
  bars.forEach((v, i) => {
    const h = round(v * 84);
    const color = i === 3 ? BRAND_AMBER : '#161616';
    chart += `<rect x="${400 + i * 28}" y="${394 - h}" width="18" height="${h}" rx="4" fill="${tone(color, '#BDBDBD')}"${i === 3 ? '' : ' fill-opacity="0.82"'}/>`;
  });

  const link =
    `<rect x="376" y="434" width="178" height="56" rx="12" fill="#FFFFFF" stroke="#161616" stroke-opacity="0.08"/>` +
    `<rect x="390" y="448" width="28" height="28" rx="7" fill="${tone(BRAND_INK, '#C4C4C4')}"/>` +
    `<path d="M398 462h12M404 456v12" stroke="${tone(BRAND_AMBER, '#E5E5E5')}" stroke-width="2.4" stroke-linecap="round"/>` +
    ruled(430, 452, 104, 2, tone('#3F3F46', '#BDBDBD'), 14, 6);

  let people = '';
  if (options.cursors && !m) {
    people = cursor(316, 236, 'Maya', '#7C3AED') + cursor(512, 398, 'Theo', '#0284C7');
  }
  return g(frame + flow + stickies + code + chart + link + people);
}

// ------------------------------------------------------------------ cards

/** A board's own card: its name, what is on it, and its silhouette. */
export function boardCardSvg(card: BoardCard): string {
  if (card.hidden || !card.name) return privateCardSvg();

  const heading = title(card.name, 196);
  const meta = textPath(describeContents(card.preview), LEFT, heading.bottom + 52, { size: 23, weight: 400, fill: SECONDARY });

  let art: string;
  if (card.preview && card.preview.items.length > 0) {
    art = previewArt(card.preview, { x: SHEET.x + 44, y: SHEET.y + 44, w: SHEET.w - 88, h: SHEET.h - 88 });
  } else {
    const cx = SHEET.x + SHEET.w / 2;
    const cy = SHEET.y + SHEET.h / 2;
    art =
      `<rect x="${cx - 70}" y="${cy - 86}" width="140" height="140" rx="10" fill="none" stroke="#161616" stroke-opacity="0.18" stroke-width="2" stroke-dasharray="8 8" transform="rotate(-3 ${cx} ${cy - 16})"/>` +
      textPath('Nothing on it yet', cx, cy + 96, { size: 18, weight: 600, fill: TERTIARY, align: 'middle' });
  }

  return svgDocument(
    ground() +
      lockup() +
      eyebrow('Board', 170) +
      heading.svg +
      meta +
      footnote('Open it to work on it together, live.') +
      sheet(art)
  );
}

/**
 * The card for a board that cannot be shown: one that asked not to be, one
 * that has not described itself yet, or a link that no longer works. It says
 * as much as is true — this is a Vega board — and nothing about which one.
 */
export function privateCardSvg(): string {
  return svgDocument(
    ground() +
      lockup() +
      eyebrow('Board', 170) +
      title('A board on Vega Studio', 196).svg +
      paragraph('Open the link to see it, and to work on it together.', 404, { size: 23, weight: 400, fill: SECONDARY }, 2, 32) +
      footnote('Shared from Vega Studio.') +
      sheet(sampleBoard({ muted: true }))
  );
}

/** The site's own card, for the home page and anything without a better one. */
export function siteCardSvg(options: { domain?: string } = {}): string {
  const heading = title('Think it through together, on one infinite board.', 150);
  return svgDocument(
    ground() +
      lockup() +
      heading.svg +
      paragraph(
        'Diagrams, stickies, code and charts in one real-time whiteboard that keeps working offline.',
        heading.bottom + 56,
        { size: 23, weight: 400, fill: SECONDARY },
        3,
        33
      ) +
      footnote(options.domain ?? 'Free to start. No account needed.') +
      sheet(sampleBoard({ cursors: true }))
  );
}
