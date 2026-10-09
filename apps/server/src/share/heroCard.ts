import { BRAND_AMBER, BRAND_INK } from './brand';
import { CARD_H, CARD_PAPER, CARD_W, cardDefs, cardGround, cardLockup, lockupWidth } from './cardSvg';
import type { Pt } from './sketch';
import { measure, textPath, type TextStyle } from './text';

/**
 * The site's own link card: what Vega Studio is, in one sentence and one
 * glance at a board.
 *
 * ## The composition
 *
 * A link card is seen at 300–500px wide in a chat thread. The left half is the
 * message — the mark, the wordmark and a three-line headline set at 72px, so
 * it still reads when the whole card is shrunk to a third. The right half is a
 * small, honest board: a frame with a routed flow, a sticky with a stamp, a
 * table feeding a chart, a strip of slides and two people working. Few pieces,
 * each drawn the way the app draws it, so the card looks like the product
 * rather than like an illustration of "a whiteboard".
 *
 * ## The rules it keeps
 *
 * - One elevation. Every object sits on the same soft shadow, as on a board.
 * - One accent. Amber appears in the mark and once on the board — the week the
 *   chart is pointing at. Everything else is ink on warm paper.
 * - One hand. A single Caveat aside and its sketched arrow, the product's
 *   sketch mode used as a note, not as a pattern.
 * - Safe for every crop. Everything sits inside the central 1100×570; X,
 *   LinkedIn, Slack and Discord show it whole, and a centred square crop
 *   (WhatsApp, iMessage thumbnails) keeps the headline's run and the frame.
 *
 * Nothing here pretends to be a real board, so the collaborator cursors are
 * fair: the card is openly an illustration. The `art-vega-hero` template in the
 * frontend catalogue is the earlier, sketched card, kept as a template.
 */

const W = CARD_W;
const H = CARD_H;

const INK = BRAND_INK;
const INK_2 = '#3A3A42';
const SECONDARY = '#55555C';
const TERTIARY = '#8A8A92';
const HAIRLINE = 'rgba(22,22,22,0.10)';
const STROKE = '#2E2E36';

const LEFT = 80;

const ui = (size: number, weight: 400 | 600 | 700 = 600): TextStyle => ({ size, weight, tracking: size >= 20 ? -0.01 : 0 });

function label(text: string, x: number, y: number, style: TextStyle, fill: string, align: 'start' | 'middle' | 'end' = 'start'): string {
  return textPath(text, x, y, { ...style, fill, align });
}

/** A card on the board: white, hairline, the one shadow. */
function card(x: number, y: number, w: number, h: number, r = 10, fill = '#FFFFFF'): string {
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" filter="url(#lift)"/>` +
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${r - 0.5}" fill="none" stroke="${HAIRLINE}"/>`
  );
}

/** A filled arrowhead at `tip`, pointing along `angle` (radians). */
function head(tip: Pt, angle: number, color: string, size = 9): string {
  const a1 = angle + Math.PI * 0.84;
  const a2 = angle - Math.PI * 0.84;
  const p = (a: number): string => `${(tip[0] + Math.cos(a) * size).toFixed(2)} ${(tip[1] + Math.sin(a) * size).toFixed(2)}`;
  return `<path d="M${tip[0]} ${tip[1]}L${p(a1)}L${p(a2)}Z" fill="${color}"/>`;
}

/**
 * An orthogonal connector through `pts`, corners rounded the way the router
 * draws them, with an arrowhead on the last segment.
 */
function elbow(pts: Pt[], color = STROKE, radius = 10): string {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const ax = cx - ((cx - px) / inLen) * r;
    const ay = cy - ((cy - py) / inLen) * r;
    const bx = cx + ((nx - cx) / outLen) * r;
    const by = cy + ((ny - cy) / outLen) * r;
    d += `L${ax} ${ay}Q${cx} ${cy} ${bx} ${by}`;
  }
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const angle = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
  // Stop the line short of the tip so the head is crisp.
  const stop: Pt = [end[0] - Math.cos(angle) * 6, end[1] - Math.sin(angle) * 6];
  d += `L${stop[0]} ${stop[1]}`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` + head(end, angle, color);
}

// ------------------------------------------------------------------ left

function message(): string {
  const style: TextStyle = { size: 68, weight: 700, tracking: -0.032 };
  const lines = ['Think it through', 'together, on one', 'infinite board.'];
  const first = 262;
  const lineH = 74;
  const headline = lines.map((line, i) => textPath(line, LEFT - 3, first + i * lineH, { ...style, fill: INK })).join('');
  const subTop = first + (lines.length - 1) * lineH + 60;
  const sub =
    textPath('Diagrams, notes, code and live data on one', LEFT, subTop, { size: 24, weight: 400, fill: SECONDARY, tracking: -0.005 }) +
    textPath('real-time board — even offline.', LEFT, subTop + 34, { size: 24, weight: 400, fill: SECONDARY, tracking: -0.005 });
  return cardLockup(LEFT, 104, 60) + headline + sub;
}

// ----------------------------------------------------------------- right

/** A frame holding a three-step flow, routed with right angles. */
function frame(): string {
  const fx = 640;
  const fy = 92;
  const fw = 316;
  const fh = 228;
  let out = label('Launch flow', fx + 2, fy - 12, ui(14), TERTIARY) + card(fx, fy, fw, fh, 8);

  const node = (cx: number, cy: number, text: string, filled = false) => {
    const w = 112;
    const h = 46;
    return (
      `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="10" fill="${filled ? INK : '#FFFFFF'}" stroke="${filled ? INK : STROKE}" stroke-width="2"/>` +
      label(text, cx, cy + 6, ui(16), filled ? '#FFFFFF' : INK, 'middle')
    );
  };

  const a: Pt = [fx + 82, fy + 50]; // Idea
  const d: Pt = [fx + 232, fy + 114]; // Review?
  const c: Pt = [fx + 82, fy + 178]; // Ship
  const dw = 60;
  const dh = 34;

  out += node(a[0], a[1], 'Idea');
  out +=
    `<path d="M${d[0]} ${d[1] - dh}L${d[0] + dw} ${d[1]}L${d[0]} ${d[1] + dh}L${d[0] - dw} ${d[1]}Z" fill="#FFFFFF" stroke="${STROKE}" stroke-width="2" stroke-linejoin="round"/>` +
    label('Review', d[0], d[1] + 6, ui(16), INK, 'middle');
  out += node(c[0], c[1], 'Ship', true);

  out += elbow([[a[0] + 56, a[1]], [d[0], a[1]], [d[0], d[1] - dh]]);
  out += elbow([[d[0], d[1] + dh], [d[0], c[1]], [c[0] + 56, c[1]]]);

  // The branch label sits on the line, on a patch of the frame's white.
  const yes = ui(13);
    out += label('yes', d[0] + 10, d[1] + dh + 24, yes, TERTIARY);
  return out;
}

/** A sticky with a dog-ear and a stamp, overlapping the frame's corner. */
function sticky(): string {
  const x = 940;
  const y = 70;
  const s = 152;
  const fold = 26;
  const paper = '#FFE9A8';
  const crease = '#EDD07E';
  const body = `M${x} ${y}H${x + s}V${y + s - fold}L${x + s - fold} ${y + s}H${x}Z`;
  const ear = `M${x + s} ${y + s - fold}L${x + s - fold} ${y + s}L${x + s - fold + 3} ${y + s - fold + 3}Z`;
  const text = { size: 21, weight: 600 as const, tracking: -0.01 };
  const stamp = 44;
  return (
    `<g transform="rotate(4 ${x + s / 2} ${y + s / 2})">` +
    `<path d="${body}" fill="${paper}" filter="url(#lift)"/>` +
    `<path d="${ear}" fill="${crease}"/>` +
    label('Ship it by', x + 20, y + 62, text, '#5C4204') +
    label('Friday', x + 20, y + 90, text, '#5C4204') +
    `<rect x="${x + 20}" y="${y + 112}" width="64" height="6" rx="3" fill="#5C4204" fill-opacity="0.28"/>` +
    // The stamp: an emoji on a white disc, pinned over the top-right corner.
    `<circle cx="${x + s - 8}" cy="${y + 10}" r="${stamp / 2}" fill="#FFFFFF" filter="url(#lift)"/>` +
    `<g transform="translate(${x + s - 8 - 14} ${y + 10 - 14}) scale(0.875)">${ROCKET}</g>` +
    '</g>'
  );
}

/** The Fluent rocket, as the emoji picker draws it (`public/emoji/1f680.svg`). */
const ROCKET =
  '<path d="M29.2 2.95c-.95-.95-2.7-1-3.82-.42-.91.31-1.87.66-2.85 1.06l.01.01c-2.58 1.09-6.43 3.04-9.51 5.9-2.17 2.01-3.41 3.56-4.24 4.96l-5.3 1.95c-.68.26-.87 1.13-.36 1.65 3.72 3.71 7.43 7.43 11.14 11.14.52.51 1.39.32 1.65-.36l2.2-5.99c1.61-.96 3.22-2.16 4.91-3.85 2.39-2.39 4.36-6.56 5.51-9.36l.01.01c.4-.99.76-1.96 1.07-2.88.58-1.12.74-2.66-.42-3.82Z" fill="#ca0b4a"/>' +
  '<path d="M23.3 4.36c-2.52 1.04-6.48 2.98-9.59 5.87-2.02 1.87-3.17 3.3-3.94 4.55-.77 1.26-1.18 2.38-1.66 3.74l-.01.01c-.17.47-.35.98-.55 1.51L12.1 24.6c3.6-1.48 6.74-2.83 10.22-6.31 2.35-2.35 4.34-6.64 5.46-9.42L23.3 4.36Z" fill="#f4f4f4"/>' +
  '<path d="M24.53 11.25c0 1.79-1.46 3.25-3.25 3.25-1.8 0-3.25-1.46-3.25-3.25C18.03 9.46 19.48 8 21.28 8c1.79 0 3.25 1.46 3.25 3.25Z" fill="#9b9b9b"/>' +
  '<path d="M23.53 11.25c0 1.24-1.01 2.25-2.25 2.25-1.24 0-2.25-1.01-2.25-2.25 0-1.24 1.01-2.25 2.25-2.25 1.24 0 2.25 1.01 2.25 2.25Z" fill="#83cbff"/>' +
  '<path d="M2.45 29.61C1.74 28.9 2.03 24 4.53 23c0 0 2.5-1 4.11.6 1.61 1.6.89 3.4.89 3.4-.71 2.12-3.72 2.96-4.07 2.61-.2-.19.15-.55 0-.71-.16-.15-.4.03-1.06.36-.48.23-1.67.63-1.95.35Z" fill="#ff8257"/>' +
  '<path d="M6.09 21.06c.58-.59 1.53-.59 2.12 0l3.54 3.54c.58.58.58 1.53 0 2.12-.59.58-1.54.58-2.13 0L6.09 23.18c-.59-.58-.59-1.53 0-2.12Z" fill="#533566"/>' +
  '<path d="M15.54 18.72c.44-1.2-.73-2.37-1.93-1.92L6.49 19.41c-.68.26-.87 1.13-.36 1.65l5.14 5.14c.52.51 1.39.32 1.65-.36l2.62-7.12Z" fill="#f92f60"/>';

const WEEKS: Array<[string, number]> = [
  ['W1', 120],
  ['W2', 168],
  ['W3', 214],
  ['W4', 306],
];

/** A table, linked to the chart it feeds. */
function data(): { svg: string; bar: Pt } {
  // The table.
  const tx = 640;
  const ty = 372;
  const colW = [72, 112];
  const rowH = 30;
  const tw = colW[0] + colW[1];
  const th = rowH * (WEEKS.length + 1);
  let out = card(tx, ty, tw, th, 10);
  out += `<path d="M${tx + 1} ${ty + rowH}V${ty + 10}Q${tx + 1} ${ty + 1} ${tx + 10} ${ty + 1}H${tx + tw - 10}Q${tx + tw - 1} ${ty + 1} ${tx + tw - 1} ${ty + 10}V${ty + rowH}Z" fill="#F3F1EC"/>`;
  for (let r = 1; r <= WEEKS.length; r++) out += `<line x1="${tx}" y1="${ty + r * rowH}" x2="${tx + tw}" y2="${ty + r * rowH}" stroke="${HAIRLINE}"/>`;
  out += `<line x1="${tx + colW[0]}" y1="${ty}" x2="${tx + colW[0]}" y2="${ty + th}" stroke="${HAIRLINE}"/>`;
  const head = ui(13);
  const cell = { size: 14, weight: 400 as const };
  out += label('Week', tx + 14, ty + 20, head, SECONDARY) + label('Signups', tx + tw - 14, ty + 20, head, SECONDARY, 'end');
  WEEKS.forEach(([week, n], i) => {
    const y = ty + (i + 1) * rowH + 20;
    out += label(week, tx + 14, y, cell, INK_2) + label(String(n), tx + tw - 14, y, { ...cell, weight: i === WEEKS.length - 1 ? 600 : 400 }, INK, 'end');
  });

  // The chart.
  const cx = 892;
  const cy = 360;
  const cw = 236;
  const ch = 174;
  out += card(cx, cy, cw, ch, 12);
  out += label('Signups per week', cx + 16, cy + 28, ui(14), INK);
  const baseY = cy + ch - 22;
  const plotTop = cy + 52;
  const max = 330;
  const barW = 30;
  const gap = (cw - 32 - WEEKS.length * barW) / (WEEKS.length - 1);
  let bar: Pt = [0, 0];
  WEEKS.forEach(([, n], i) => {
    const h = ((baseY - plotTop) * n) / max;
    const bx = cx + 16 + i * (barW + gap);
    const last = i === WEEKS.length - 1;
    out += `<path d="M${bx} ${baseY}V${baseY - h + 5}Q${bx} ${baseY - h} ${bx + 5} ${baseY - h}H${bx + barW - 5}Q${bx + barW} ${baseY - h} ${bx + barW} ${baseY - h + 5}V${baseY}Z" fill="${last ? BRAND_AMBER : '#3A3A42'}"${last ? '' : ' fill-opacity="0.82"'}/>`;
    if (last) bar = [bx + barW / 2, baseY - h];
  });
  out += `<line x1="${cx + 12}" y1="${baseY + 0.5}" x2="${cx + cw - 12}" y2="${baseY + 0.5}" stroke="${INK}" stroke-opacity="0.18" stroke-width="1.5"/>`;

  // The data link: a dashed lead from the table's edge into the chart.
  const from: Pt = [tx + tw, ty + th / 2];
  const to: Pt = [cx, cy + ch / 2];
  const mid = (from[0] + to[0]) / 2;
  out +=
    `<path d="M${from[0]} ${from[1]}H${mid - 8}Q${mid} ${from[1]} ${mid} ${from[1] + Math.sign(to[1] - from[1]) * 8}V${to[1] - Math.sign(to[1] - from[1]) * 8}Q${mid} ${to[1]} ${mid + 8} ${to[1]}H${to[0]}" fill="none" stroke="${SECONDARY}" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round"/>` +
    `<circle cx="${from[0]}" cy="${from[1]}" r="4.5" fill="#FFFFFF" stroke="${SECONDARY}" stroke-width="2"/>` +
    `<circle cx="${to[0]}" cy="${to[1]}" r="4.5" fill="#FFFFFF" stroke="${SECONDARY}" stroke-width="2"/>`;
  return { svg: out, bar };
}

/**
 * A strip of slides under the chart: the chart, already a slide, active and
 * ringed; two more after it. The board presents what it holds.
 */
function slides(): string {
  const x = 892;
  const y = 552;
  const w = 56;
  const h = 34;
  const gap = 8;
  const start = x + 54;
  let out = label('Slides', x, y + 22, ui(13), SECONDARY);
  for (let i = 0; i < 3; i++) {
    const sx = start + i * (w + gap);
    out += card(sx, y, w, h, 5);
    if (i === 0) {
      // The chart, as its slide.
      [8, 11, 14, 20].forEach((bh, k) => {
        out += `<rect x="${sx + 10 + k * 10}" y="${y + h - 7 - bh}" width="6" height="${bh}" rx="1.5" fill="${k === 3 ? BRAND_AMBER : '#3A3A42'}"${k === 3 ? '' : ' fill-opacity="0.7"'}/>`;
      });
    } else {
      out += `<rect x="${sx + 8}" y="${y + 8}" width="${i === 1 ? 30 : 24}" height="4" rx="2" fill="${INK}" fill-opacity="0.6"/>`;
      out += `<rect x="${sx + 8}" y="${y + 17}" width="${i === 1 ? 38 : 18}" height="3" rx="1.5" fill="${INK}" fill-opacity="0.25"/>`;
      out +=
        i === 1
          ? `<rect x="${sx + 8}" y="${y + 24}" width="26" height="3" rx="1.5" fill="${INK}" fill-opacity="0.25"/>`
          : `<rect x="${sx + 32}" y="${y + 14}" width="16" height="13" rx="2" fill="${INK}" fill-opacity="0.16"/>`;
    }
  }
  out += `<rect x="${start - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="7.5" fill="none" stroke="${INK}" stroke-width="2"/>`;
  return out;
}

/** A collaborator's pointer and name tag, as the board draws them. */
function cursor(x: number, y: number, name: string, color: string): string {
  const style: TextStyle = { size: 14, weight: 600 };
  const w = measure(name, style) + 20;
  return (
    `<g filter="url(#lift)"><path d="M${x} ${y}l0 21 5.6-5 3.8 8.5 3.7-1.6-3.8-8.4 7.4-0.5z" fill="${color}" stroke="#FFFFFF" stroke-width="1.75" stroke-linejoin="round"/></g>` +
    `<rect x="${x + 15}" y="${y + 22}" width="${w}" height="25" rx="12.5" fill="${color}"/>` +
    textPath(name, x + 25, y + 39.5, { ...style, fill: '#FFFFFF' })
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A hand-drawn arc: one cubic, filled as a ribbon whose width swells and
 * tapers like a pen stroke, ending in a clean open arrowhead. No jitter: the
 * hand is in the curve and the pressure, not in noise.
 */
function penArrow(p0: Pt, c1: Pt, c2: Pt, p3: Pt, color: string): string {
  const at = (t: number): Pt => {
    const u = 1 - t;
    return [
      u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p3[0],
      u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p3[1],
    ];
  };
  const STEPS = 48;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const [x, y] = at(t);
    const [ax, ay] = at(Math.max(0, t - 0.01));
    const [bx, by] = at(Math.min(1, t + 0.01));
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    // Light at the lift-off, full through the sweep, settling into the head.
    const half = (0.8 + 1.6 * Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.08))) / 2;
    left.push([x + nx * half, y + ny * half]);
    right.push([x - nx * half, y - ny * half]);
  }
  const pts = [...left, ...right.reverse()];
  const capStart = `<circle cx="${r2(p0[0])}" cy="${r2(p0[1])}" r="0.4" fill="${color}"/>`;
  const body = `<path d="M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}Z" fill="${color}"/>`;
  const [bx, by] = at(0.94);
  const angle = Math.atan2(p3[1] - by, p3[0] - bx);
  const wing = (turn: number) => `${r2(p3[0] - Math.cos(angle + turn) * 12)} ${r2(p3[1] - Math.sin(angle + turn) * 12)}`;
  const head = `<path d="M${wing(0.5)}L${r2(p3[0])} ${r2(p3[1])}L${wing(-0.5)}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return capStart + body + head;
}

/** The one hand-drawn note, and the arrow it throws at the chart's best week. */
function aside(bar: Pt): string {
  const text = 'best week yet!';
  const x = 944;
  const y = 318;
  const textW = measure(text, { size: 30, weight: 700, family: 'hand' });
  const p0: Pt = [x + textW + 8, y - 12];
  return (
    textPath(text, x, y, { size: 30, weight: 700, family: 'hand', fill: INK_2 }) +
    penArrow(p0, [p0[0] + 36, p0[1] - 2], [bar[0] + 28, bar[1] - 46], [bar[0] + 4, bar[1] - 12], INK_2)
  );
}

/** Everything on the board, in the 1200×630 card's coordinates. */
function scene(): string {
  const { svg: table, bar } = data();
  return (
    frame() +
    table +
    slides() +
    sticky() +
    aside(bar) +
    cursor(724, 188, 'Maya', '#7C3AED') +
    cursor(744, 534, 'Theo', '#0284C7')
  );
}

/** The scene's extent, labels and cursors included, for placing it elsewhere. */
const SCENE = { x: 612, y: 60, w: 520, h: 538 };

// ------------------------------------------------------------------ cards

export function heroCardSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    cardDefs() +
    cardGround() +
    message() +
    scene() +
    '</svg>'
  );
}

/** The square card's side, for unfurlers that crop to a square (WhatsApp, iMessage). */
export const SQUARE = 1200;

/**
 * The same card composed for a square: the lockup and headline centred and
 * stacked over the board, so a centred crop of any size keeps both.
 */
export function heroSquareSvg(): string {
  const S = SQUARE;
  const mark = 72;
  const style: TextStyle = { size: 86, weight: 700, tracking: -0.032 };
  const lines = ['Think it through', 'together, on one', 'infinite board.'];
  const first = 296;
  const lineH = 92;
  const headline = lines.map((line, i) => textPath(line, S / 2, first + i * lineH, { ...style, fill: INK, align: 'middle' })).join('');
  const scale = 1.12;
  const top = 548;
  const dx = S / 2 - (SCENE.x + SCENE.w / 2) * scale;
  const dy = top - SCENE.y * scale;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">` +
    cardDefs() +
    '<defs><linearGradient id="calmTop" x1="0" y1="0" x2="0" y2="1">' +
    `<stop offset="0" stop-color="${CARD_PAPER}" stop-opacity="1"/>` +
    `<stop offset="0.42" stop-color="${CARD_PAPER}" stop-opacity="0.94"/>` +
    `<stop offset="0.5" stop-color="${CARD_PAPER}" stop-opacity="0"/>` +
    '</linearGradient></defs>' +
    `<rect width="${S}" height="${S}" fill="${CARD_PAPER}"/>` +
    `<rect width="${S}" height="${S}" fill="url(#dots)"/>` +
    `<rect width="${S}" height="${S}" fill="url(#calmTop)"/>` +
    cardLockup(S / 2 - lockupWidth(mark) / 2, 92, mark) +
    headline +
    `<g transform="translate(${r2(dx)} ${r2(dy)}) scale(${scale})">${scene()}</g>` +
    '</svg>'
  );
}
