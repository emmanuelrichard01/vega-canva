import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../../document/mutations';
import type { Template } from '../templates';
import { BRAND, BRAND_INK, chart, code, INK_MID, INK_SOFT, layer, link, paragraph, plot, rng, table, title } from '../templateKit';
import {
  type Hue,
  HAND, PAPER_WARM, PEN_INK, SPARKLE, STUDIO_CAP, STUDIO_WIDTH, VEGA_V,
  handNote, linePath, pencil, place, polygon, quad, sampleCubic, sketch, solidPath, stroke, studioLine, vegaMark, vegaWordmark, withHead, wordmarkWidth,
} from './artKit';

/**
 * Illustration: drawing with objects, by hand and by formula.
 *
 * Every other set in the gallery is *about* something — a system, a quarter, a
 * dataset. These boards are about the tool: what the shape library, the sketch
 * pen, the pen tool and a few lines of arithmetic can draw when somebody
 * arranges them with care. They are also the boards that get screenshotted
 * and shared, which is a real job, so each one is composed to a frame that
 * exports cleanly.
 *
 * Seeded, never random: the card in the gallery is drawn from one `build()`
 * and the board you open from another, so both must be the same drawing.
 */

/** A frame preset's artboard, filled with paper so it prints the same on either theme. */
function artboard(
  x: number,
  y: number,
  width: number,
  height: number,
  name: string,
  icon: string,
  description: string,
  extra: Record<string, unknown> = {}
): NewNodeInput {
  return {
    id: nanoid(),
    type: 'frame',
    x,
    y,
    width,
    height,
    title: name,
    icon,
    description,
    appearance: { fill: [{ type: 'solid', color: PAPER_WARM }] },
    ...extra,
  } as NewNodeInput;
}

// ---------------------------------------------------------------------------
// 1. The hero
// ---------------------------------------------------------------------------

function heroBoard(): NewNodeInput[] {
  const W = 1200;
  const H = 630;
  const nodes: NewNodeInput[] = [];

  nodes.push(
    artboard(0, 0, W, H, 'Vega Studio', '✨', 'A 1200×630 link preview. Export the frame as PNG.', { preset: 'og' })
  );

  // --- The lockup: the brand's stacked logo, centred, and one line under it.
  const MARK = 120;
  const CAP = 56;
  const wordW = wordmarkWidth(CAP);
  const studioCap = CAP * STUDIO_CAP;
  const studioW = wordW * STUDIO_WIDTH;
  const top = 132;
  const wordTop = top + MARK + 30;
  const studioTop = wordTop + CAP + 20;
  nodes.push(
    ...vegaMark(W / 2 - MARK / 2, top, MARK, { color: '#000000', offsetX: 0, offsetY: 12, blur: 28, spread: 0, opacity: 0.18 }),
    ...vegaWordmark(W / 2 - wordW / 2, wordTop, CAP),
    ...studioLine(W / 2 - studioW / 2, studioTop, studioCap, studioW),
    {
      id: nanoid(),
      type: 'text',
      x: W / 2 - 290,
      y: studioTop + studioCap + 38,
      width: 580,
      height: 30,
      text: 'Think it through together, on one infinite board.',
      resize: 'width',
      typography: { fontFamily: 'Inter', fontSize: 20, fontWeight: 500, color: INK_SOFT, align: 'center', letterSpacing: -0.2 },
    } as NewNodeInput
  );

  // --- The constellation: a loose ring, heavier at the corners. -------------
  // Left
  nodes.push(
    sketch(92, 62, 122, 82, 'cloud', { hue: 'blue', fillStyle: 'hachure', rotation: -4 }),
    sketch(288, 70, 56, 56, 'star', { hue: 'amber', fillStyle: 'solid', fill: HAND.amber.wash, rotation: 14 }),
    chart(70, 206, plot('bar', {
      title: undefined,
      categories: ['M', 'T', 'W', 'T', 'F'],
      series: [{ name: 'Ideas', values: [3, 5, 4, 8, 6], color: HAND.blue.pen }],
      showGrid: false,
      showLegend: false,
    }), 176, 132, { rotation: -4, appearance: { sketch: 'medium' } }),
    sketch(298, 262, 92, 76, 'chat', { hue: 'violet', fillStyle: 'solid', rotation: 6 }),
    sketch(112, 450, 76, 96, 'database', { hue: 'teal', fillStyle: 'hachure', rotation: -5 }),
  );

  // A pencil laying down a squiggle, bottom left.
  nodes.push(...pencilDoodle({ x: 262, y: 566 }, 124, 136));
  const squiggle: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    squiggle.push({ x: 92 + t * 166, y: 578 + Math.sin(t * Math.PI * 4) * 9 - t * 10 });
  }
  nodes.push(pencil(squiggle, HAND.amber.pen, 3.4, 'light'));

  // Right
  nodes.push(
    {
      id: nanoid(),
      type: 'sticky',
      x: 900,
      y: 58,
      width: 150,
      height: 150,
      rotation: 5,
      text: 'Ship it on Friday',
      theme: 'yellow',
      fontSize: 24,
      reactions: {},
      tags: [],
      pinned: false,
      showAuthor: false,
      appearance: { sketch: 'medium' },
    } as NewNodeInput,
    sketch(1092, 236, 54, 74, 'bolt', { hue: 'amber', fillStyle: 'solid', fill: HAND.amber.wash, rotation: -10 }),
    {
      id: nanoid(),
      type: 'text',
      x: 936,
      y: 300,
      width: 120,
      height: 96,
      rotation: -8,
      text: '{ }',
      resize: 'width',
      typography: { fontFamily: 'Outfit', fontSize: 76, fontWeight: 300, color: HAND.violet.pen, align: 'center' },
    } as NewNodeInput,
    sketch(1040, 448, 92, 82, 'polygon', { hue: 'teal', fillStyle: 'crosshatch', rotation: 8, geometry: { points: 6 } }),
    sketch(866, 488, 68, 68, 'heart', { hue: 'violet', fillStyle: 'hachure', rotation: -8 }),
  );

  // A collaborator, pointing at the wordmark.
  const tip = { x: 812, y: 262 };
  nodes.push(
    solidPath([
      { to: { x: tip.x, y: tip.y } },
      { to: { x: tip.x + 4, y: tip.y + 30 } },
      { to: { x: tip.x + 12, y: tip.y + 22 } },
      { to: { x: tip.x + 26, y: tip.y + 21 } },
    ], HAND.blue.pen, { appearance: { fill: [{ type: 'solid', color: HAND.blue.pen }], stroke: { color: '#FFFFFF', width: 2, join: 'round' } } }),
    sketch(tip.x + 20, tip.y + 28, 52, 26, 'rect', {
      hue: 'blue', fillStyle: 'solid', fill: HAND.blue.pen, level: 'light', cornerRadius: 13,
      text: 'Ada', typography: { fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: '#FFFFFF' },
    }),
  );

  // The hand-lettered aside, and the arrow it throws at the mark.
  nodes.push(handNote(704, 66, 'drawn right here', 27));
  const run = sampleCubic({ x: 716, y: 104 }, { x: 702, y: 136 }, { x: 690, y: 150 }, { x: 672, y: 162 }, 14);
  nodes.push(pencil(withHead(run, 12, 32), PEN_INK, 3.2, 'medium'));

  // The product's story in three marks, bottom centre: the one place the
  // ring uses connectors, routed straight between hand-drawn shapes.
  const flowY = 546;
  const idea = sketch(420, flowY - 24, 92, 48, 'ellipse', { hue: 'amber', fillStyle: 'solid', text: 'idea', typography: { fontSize: 20 } });
  const board = sketch(554, flowY - 26, 92, 52, 'rect', { hue: 'blue', fillStyle: 'solid', text: 'board', cornerRadius: 10, typography: { fontSize: 20 } });
  const ship = sketch(688, flowY - 32, 92, 64, 'diamond', { hue: 'teal', fillStyle: 'solid', text: 'ship', typography: { fontSize: 20 } });
  const arrow = { routing: 'straight', appearance: { stroke: { color: PEN_INK, width: 2.2, cap: 'round' }, sketch: 'medium' } };
  nodes.push(idea, board, ship, link(idea.id, board.id, arrow), link(board.id, ship.id, arrow));

  // Sparkles in the gaps, so the ring closes without another object.
  nodes.push(
    sparkle(470, 74, 13, HAND.amber.wash),
    sparkle(214, 392, 10, HAND.blue.wash),
    sparkle(1128, 382, 11, HAND.amber.wash),
    sparkle(972, 584, 11, HAND.teal.wash),
    sparkle(1132, 120, 9, HAND.violet.wash),
  );

  return layer(nodes);
}

/** A four-point sparkle, the mark's own star, as a filled path. */
function sparkle(cx: number, cy: number, r: number, color: string): NewNodeInput {
  const k = 0.12 * r;
  const top = { x: cx, y: cy - r };
  const right = { x: cx + r, y: cy };
  const bottom = { x: cx, y: cy + r };
  const left = { x: cx - r, y: cy };
  return solidPath([
    { to: top },
    quad(top, { x: cx + k, y: cy - k }, right),
    quad(right, { x: cx + k, y: cy + k }, bottom),
    quad(bottom, { x: cx - k, y: cy + k }, left),
    quad(left, { x: cx - k, y: cy - k }, top),
  ], color);
}

/**
 * A pencil drawn from four sketched shapes along one axis: eraser, ferrule,
 * body and sharpened tip. `tip` is where the lead touches the paper and
 * `angle` the direction the pencil points, in degrees.
 */
function pencilDoodle(tip: { x: number; y: number }, angle: number, length: number): NewNodeInput[] {
  const rad = (angle * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const T = 24;
  // Distances back from the tip to each part's centre, and its length.
  const part = (back: number, len: number) => ({ cx: tip.x - ux * back, cy: tip.y - uy * back, len });
  const bodyLen = length - 60;
  const body = part(28 + bodyLen / 2, bodyLen);
  const ferrule = part(28 + bodyLen + 7, 14);
  const eraser = part(28 + bodyLen + 14 + 9, 18);
  const cone = part(14, 28);
  const box = (p: { cx: number; cy: number; len: number }) => ({ x: p.cx - p.len / 2, y: p.cy - T / 2, w: p.len, h: T });
  const b = box(body);
  const f = box(ferrule);
  const e = box(eraser);
  return [
    sketch(e.x, e.y, e.w, e.h, 'rect', { hue: 'violet', fillStyle: 'solid', rotation: angle, level: 'light', cornerRadius: 4 }),
    sketch(f.x, f.y, f.w, f.h, 'rect', { hue: 'ink', fillStyle: 'solid', rotation: angle, level: 'light' }),
    sketch(b.x, b.y, b.w, b.h, 'rect', { hue: 'amber', fillStyle: 'hachure', rotation: angle, level: 'light' }),
    // The cone points along the pencil; a triangle's apex is at its top.
    sketch(cone.cx - T / 2, cone.cy - cone.len / 2, T, cone.len, 'polygon', {
      hue: 'amber', fillStyle: 'solid', fill: '#F6DDB8', rotation: angle + 90, level: 'light', geometry: { points: 3 },
    }),
  ];
}

// ---------------------------------------------------------------------------
// 2. Doodle wall
// ---------------------------------------------------------------------------

/** A sticky note on the wall: no author chip, its own hand. */
function wallNote(
  x: number,
  y: number,
  text: string,
  theme: 'yellow' | 'pink' | 'mint' | 'sky' | 'lavender' | 'peach' | 'white' | 'lime' | 'coral',
  rotation: number,
  extra: Record<string, unknown> = {}
): NewNodeInput {
  return {
    id: nanoid(),
    type: 'sticky',
    x,
    y,
    width: 210,
    height: 210,
    rotation,
    text,
    theme,
    fontSize: 22,
    reactions: {},
    tags: [],
    pinned: false,
    showAuthor: false,
    appearance: { sketch: 'medium' },
    ...extra,
  } as NewNodeInput;
}

/** The icons the wall scatters: things with a silhouette everybody reads. */
const WALL_ICONS = [
  'heart', 'globe', 'bolt', 'gear', 'mail', 'plane', 'key',
  'star', 'pin', 'user', 'lock', 'package', 'cloud', 'chat',
] as const;

function doodleWall(): NewNodeInput[] {
  const W = 1680;
  const H = 1000;
  const M = 72;
  const nodes: NewNodeInput[] = [];
  const random = rng(20261007);

  nodes.push(
    artboard(0, 0, W, H, 'Doodle wall', '🖍️', 'Every mark is a real shape, sticky or pencil line, drawn by hand.'),
    handNote(M, 44, 'Doodle wall', 68),
    handNote(M + 4, 132, 'Everything here is drawn by hand. Pick anything and change its pen.', 28, HAND.ink.wash)
  );

  // --- Three hands: one box, three pens. ------------------------------------
  const LEVELS = [
    ['light', 'Neat', 'one steady pass'],
    ['medium', 'Sketchy', 'drawn twice'],
    ['heavy', 'Wild', 'twice, past every corner'],
  ] as const;
  const headY = 214;
  const boxY = 272;
  nodes.push(handNote(M, headY, 'three hands', 30, HAND.amber.pen));
  LEVELS.forEach(([level, name, how], i) => {
    const x = M + i * 260;
    nodes.push(
      sketch(x, boxY, 220, 128, 'rect', {
        hue: 'blue', fillStyle: 'solid', level, cornerRadius: 18, weight: 2.8,
        text: name, typography: { fontSize: 36, fontWeight: 700 },
      }),
      handNote(x + 4, boxY + 144, how, 22, HAND.ink.wash)
    );
  });
  nodes.push(handNote(636, headY + 4, 'my favourite', 26, HAND.amber.pen));
  nodes.push(pencil(withHead(sampleCubic({ x: 652, y: 252 }, { x: 650, y: 262 }, { x: 660, y: 270 }, { x: 690, y: 266 }, 8), 10, 34), HAND.amber.pen, 3, 'medium'));

  // --- Five fills: one circle, five ways to shade it. ------------------------
  const FILLS = [
    ['solid', 'Solid', 'amber'],
    ['hachure', 'Hachure', 'blue'],
    ['crosshatch', 'Cross-hatch', 'teal'],
    ['dots', 'Dots', 'violet'],
    ['zigzag', 'Scribble', 'amber'],
  ] as const;
  const fillX = 872;
  nodes.push(handNote(fillX, headY, 'five fills', 30, HAND.amber.pen));
  FILLS.forEach(([style, name, hue], i) => {
    const x = fillX + i * 150;
    nodes.push(
      sketch(x, boxY, 128, 128, 'ellipse', { hue, fillStyle: style, level: 'medium', weight: 2.6, angle: -40 + i * 12 }),
      handNote(x + 4, boxY + 144, name, 22, HAND.ink.wash)
    );
  });

  // --- The wall: notes on the left, a field of doodles to the right. --------
  const wallY = 520;
  const NOTE = 190;
  nodes.push(
    wallNote(M, wallY + 10, 'Shift + S draws the whole board by hand', 'yellow', -4, { width: NOTE, height: NOTE }),
    wallNote(M + 210, wallY, "A shape's own pen beats the board's", 'pink', 3, { width: NOTE, height: NOTE }),
    wallNote(M + 420, wallY + 14, '[x] Pick a shape\n[ ] Make it Wild\n[ ] Scribble it', 'white', -2, { width: NOTE, height: NOTE, checklist: true }),
  );

  // Three squiggles under the notes: the line shapes' profiles, by hand.
  const PROFILES = [['wavy', 'blue'], ['zigzag', 'teal'], ['coil', 'violet']] as const;
  PROFILES.forEach(([profile, hue], i) => {
    const x = M + i * 210;
    const y = wallY + NOTE + 92;
    nodes.push(
      stroke({ x: x + 8, y }, { x: x + 172, y }, { hue, profile, weight: 2.6, waves: profile === 'coil' ? 6 : 4, head: profile !== 'zigzag' }),
      handNote(x + 8, y + 34, profile, 24, HAND.ink.wash)
    );
  });

  // The doodle field: a jittered grid, so it reads as loose without clumping.
  const fieldX = 760;
  const COLS = 7;
  const CELL_W = 120;
  const CELL_H = 170;
  const HUES = ['amber', 'blue', 'teal', 'violet'] as const;
  const STYLES = ['hachure', 'solid', 'crosshatch', 'dots', 'hachure', 'zigzag'] as const;
  WALL_ICONS.forEach((kind, i) => {
    const col = i % COLS;
    const r = Math.floor(i / COLS);
    const size = 70 + Math.round(random() * 26);
    const cx = fieldX + col * CELL_W + CELL_W / 2 + (random() - 0.5) * 26 + (r % 2) * 28;
    const cy = wallY + r * CELL_H + CELL_H / 2 + (random() - 0.5) * 34;
    const hue = HUES[(i + r) % HUES.length];
    const style = STYLES[Math.floor(random() * STYLES.length)];
    nodes.push(
      sketch(cx - size / 2, cy - size / 2, size, size, kind, {
        hue,
        fillStyle: style,
        level: (['light', 'medium', 'heavy'] as const)[i % 3],
        rotation: Math.round((random() - 0.5) * 24),
        weight: 2.4,
      })
    );
  });

  // A margin note under the field, underlined the way a margin fills up.
  const noteY = wallY + CELL_H * 2 + 28;
  nodes.push(handNote(fieldX + 24, noteY, 'every one of these is still a real shape: resize it, recolour it, connect to it', 24, HAND.ink.wash));
  const under = sampleCubic({ x: fieldX + 28, y: noteY + 42 }, { x: fieldX + 280, y: noteY + 36 }, { x: fieldX + 540, y: noteY + 50 }, { x: fieldX + 800, y: noteY + 40 }, 30);
  nodes.push(pencil(under, HAND.amber.wash, 3.6, 'medium'));

  return layer(nodes);
}

// ---------------------------------------------------------------------------
// 3. Generative: a flow field
// ---------------------------------------------------------------------------

/** Four vortices and a breeze, in the plate's unit square. Signs set the spin. */
const VORTICES = [
  { x: 0.3, y: 0.34, spin: 1, r: 0.16 },
  { x: 0.7, y: 0.6, spin: -1.15, r: 0.2 },
  { x: 0.56, y: 0.16, spin: 0.55, r: 0.1 },
  { x: 0.2, y: 0.8, spin: -0.7, r: 0.14 },
] as const;
const BREEZE = { x: 0.9, y: 0.25 };

/** The field's direction at a point of the unit square, as a unit vector. */
function flow(u: number, v: number): { x: number; y: number } {
  let x = BREEZE.x;
  let y = BREEZE.y;
  for (const c of VORTICES) {
    const dx = u - c.x;
    const dy = v - c.y;
    const k = (0.6 * c.spin) / (dx * dx + dy * dy + c.r * c.r);
    // Perpendicular to the radius: a swirl around the centre.
    x -= dy * k;
    y += dx * k;
  }
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/** Amber through rose to violet to teal, across the plate from left to right. */
const FLOW_STOPS = ['#F3A024', '#EF6F6C', '#B983FF', '#6E8BFF', '#38C6B4'];

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function rampAt(t: number): string {
  const x = Math.max(0, Math.min(0.9999, t)) * (FLOW_STOPS.length - 1);
  const i = Math.floor(x);
  return mix(FLOW_STOPS[i], FLOW_STOPS[i + 1], x - i);
}

/**
 * Evenly spaced streamlines, traced through `flow`.
 *
 * Each seed is followed both ways in short steps until it leaves the plate or
 * runs into a cell another line already owns. The occupancy grid is what turns
 * a tangle into a drawing: lines stop short of each other at a steady gap, so
 * the whole field reads as one combed surface rather than as noise.
 */
function streamlines(size: number, max: number): Array<{ points: Array<{ x: number; y: number }>; seed: { x: number; y: number } }> {
  const STEP = 6;
  const GAP = 9;
  const MARGIN = 34;
  const cells = Math.ceil(size / GAP);
  const owner = new Int32Array(cells * cells).fill(-1);
  const cellOf = (p: { x: number; y: number }) => Math.floor(p.y / GAP) * cells + Math.floor(p.x / GAP);
  const inside = (p: { x: number; y: number }) => p.x > MARGIN && p.y > MARGIN && p.x < size - MARGIN && p.y < size - MARGIN;
  const random = rng(7);
  const out: Array<{ points: Array<{ x: number; y: number }>; seed: { x: number; y: number } }> = [];

  const SEEDS = 18;
  const order: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < SEEDS; i++) {
    for (let j = 0; j < SEEDS; j++) {
      order.push({
        x: MARGIN + ((j + 0.5 + (random() - 0.5) * 0.8) / SEEDS) * (size - 2 * MARGIN),
        y: MARGIN + ((i + 0.5 + (random() - 0.5) * 0.8) / SEEDS) * (size - 2 * MARGIN),
      });
    }
  }
  // A shuffled seed order, so no corner of the plate gets first claim on space.
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (const seed of order) {
    if (out.length >= max) break;
    if (!inside(seed) || owner[cellOf(seed)] !== -1) continue;
    const id = out.length;
    const trace = (dir: 1 | -1) => {
      const pts: Array<{ x: number; y: number }> = [];
      let p = seed;
      for (let n = 0; n < 90; n++) {
        const f = flow(p.x / size, p.y / size);
        const next = { x: p.x + f.x * STEP * dir, y: p.y + f.y * STEP * dir };
        if (!inside(next)) break;
        const c = cellOf(next);
        if (owner[c] !== -1 && owner[c] !== id) break;
        pts.push(next);
        p = next;
      }
      return pts;
    };
    const back = trace(-1).reverse();
    const fwd = trace(1);
    const points = [...back, seed, ...fwd];
    if (points.length < 8) continue;
    points.forEach((p) => {
      owner[cellOf(p)] = id;
    });
    out.push({ points, seed });
  }
  return out;
}

const FLOW_SOURCE = `// Four vortices and a breeze. Every line on the plate follows this.
const vortices = [
  { x: 0.30, y: 0.34, spin:  1.00, r: 0.16 },
  { x: 0.70, y: 0.60, spin: -1.15, r: 0.20 },
  { x: 0.56, y: 0.16, spin:  0.55, r: 0.10 },
  { x: 0.20, y: 0.80, spin: -0.70, r: 0.14 },
];

function flow(u, v) {
  let x = 0.9, y = 0.25;            // the breeze
  for (const c of vortices) {
    const dx = u - c.x, dy = v - c.y;
    const k = (0.6 * c.spin) / (dx * dx + dy * dy + c.r * c.r);
    x -= dy * k;                     // swirl around the centre
    y += dx * k;
  }
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}`;

function flowFieldBoard(limit?: number): NewNodeInput[] {
  const W = 1520;
  const H = 1000;
  const PLATE = 920;
  const P = 40;
  const nodes: NewNodeInput[] = [];

  nodes.push(
    artboard(0, 0, W, H, 'Flow field', '🌀', 'Every line is a pen path traced through one formula. Seeded, so it never changes.'),
    {
      id: nanoid(),
      type: 'shape',
      x: P,
      y: P,
      width: PLATE,
      height: PLATE,
      geometry: { kind: 'rect' },
      appearance: { fill: [{ type: 'solid', color: '#15151C' }], cornerRadius: 6, sketchClean: true },
    } as NewNodeInput
  );

  // The other nodes on the board: frame, plate and the column of text.
  const FIXED = 11;
  const budget = Math.max(12, (limit ?? 400) - FIXED);
  const lines = streamlines(PLATE, budget);
  lines.forEach(({ points, seed }) => {
    const t = seed.x / PLATE;
    const width = 1.4 + (points.length / 180) * 2.4;
    nodes.push(
      linePath(
        points.map((p) => ({ to: { x: P + p.x, y: P + p.y } })),
        rampAt(t + (seed.y / PLATE - 0.5) * 0.18),
        Math.min(3.6, width)
      )
    );
  });

  // The column: what it is, how it was made, and the source that made it.
  const CX = P + PLATE + 56;
  const CW = W - CX - P;
  nodes.push(
    { ...title(CX, 52, 'Flow field', 44), width: CW },
    paragraph(CX, 118, `${lines.length} pen paths, each traced through the same field: four vortices and a breeze. Lines stop a steady gap short of each other, which is what combs a tangle into a surface.`, CW, 17, INK_SOFT),
    code(CX, 236, FLOW_SOURCE, 'javascript', CW, 456, { fontSize: 12, lineNumbers: false }),
    paragraph(CX, 724, 'Colour runs left to right through the ramp below. The formula decides every curve; a seeded shuffle decides only which line claims its space first.', CW, 15, INK_SOFT),
  );
  FLOW_STOPS.forEach((color, i) => {
    nodes.push({
      id: nanoid(),
      type: 'shape',
      x: CX + i * 52,
      y: 820,
      width: 40,
      height: 40,
      geometry: { kind: 'ellipse' },
      appearance: { fill: [{ type: 'solid', color }], cornerRadius: 0, sketchClean: true },
    } as NewNodeInput);
  });

  return layer(nodes);
}


// ---------------------------------------------------------------------------
// 4. Isometric: a desk that ships
// ---------------------------------------------------------------------------

type P3 = { x: number; y: number; z: number };
/** Three tones of one material: lit from the upper left, so the top is lightest. */
type Tones = { top: string; left: string; right: string };

const OAK: Tones = { top: '#F2C88A', left: '#DDAA62', right: '#C48D45' };
const GRAPHITE: Tones = { top: '#4A4A56', left: '#34343E', right: '#26262E' };
const PLASTER_A: Tones = { top: '#FFFFFF', left: '#F3EEE6', right: '#E4DCCF' };
const PLASTER_B: Tones = { top: '#FFFFFF', left: '#EAE3D8', right: '#F6F1EA' };
const FLOOR: Tones = { top: '#E9DFCF', left: '#D3C5AF', right: '#BFAF96' };

/**
 * A room drawn in isometric projection, from flat pen paths.
 *
 * Every surface is one filled path in one of three tones, placed back to
 * front (the painter's algorithm), so the depth is entirely in the order and
 * the shading. Nothing here is a 3D feature: it is the shape and pen tools,
 * and anyone can pull a face off the drawing to see how it was made.
 */
function isoScene(ox: number, oy: number) {
  const C = Math.cos(Math.PI / 6);
  const S = 0.5;
  const at = (p: P3) => ({ x: ox + (p.x - p.y) * C, y: oy + (p.x + p.y) * S - p.z });
  const nodes: NewNodeInput[] = [];
  const face = (corners: P3[], color: string, extra: Record<string, unknown> = {}) =>
    nodes.push(solidPath(polygon(corners.map(at)), color, extra));

  /** A box's three visible faces: the top, the face towards +y and the face towards +x. */
  const box = (x: number, y: number, z: number, w: number, d: number, h: number, t: Tones) => {
    face([{ x, y: y + d, z }, { x: x + w, y: y + d, z }, { x: x + w, y: y + d, z: z + h }, { x, y: y + d, z: z + h }], t.left);
    face([{ x: x + w, y, z }, { x: x + w, y: y + d, z }, { x: x + w, y: y + d, z: z + h }, { x: x + w, y, z: z + h }], t.right);
    face([{ x, y, z: z + h }, { x: x + w, y, z: z + h }, { x: x + w, y: y + d, z: z + h }, { x, y: y + d, z: z + h }], t.top);
  };

  /** A flat quad lying in the plane y = const (the back wall), u along x and v up z. */
  const onBackWall = (y: number, x0: number, z0: number, w: number, h: number, color: string) =>
    face([{ x: x0, y, z: z0 }, { x: x0 + w, y, z: z0 }, { x: x0 + w, y, z: z0 + h }, { x: x0, y, z: z0 + h }], color);
  /** A flat quad lying in the plane x = const (the side wall), u along y and v up z. */
  const onSideWall = (x: number, y0: number, z0: number, w: number, h: number, color: string) =>
    face([{ x, y: y0, z: z0 }, { x, y: y0 + w, z: z0 }, { x, y: y0 + w, z: z0 + h }, { x, y: y0, z: z0 + h }], color);
  /** A flat quad on a horizontal plane. */
  const onFloor = (x: number, y: number, z: number, w: number, d: number, color: string, extra: Record<string, unknown> = {}) =>
    face([{ x, y, z }, { x: x + w, y, z }, { x: x + w, y: y + d, z }, { x, y: y + d, z }], color, extra);

  /** An upright cylinder as a shape: its top is an isometric circle. */
  const cylinder = (cx: number, cy: number, z: number, r: number, h: number, body: string, top: string) => {
    const c = at({ x: cx, y: cy, z: z + h });
    const rx = r * Math.SQRT2 * C;
    const ry = r * Math.SQRT2 * S;
    const height = h + 2 * ry;
    nodes.push({
      id: nanoid(),
      type: 'shape',
      x: c.x - rx,
      y: c.y - ry,
      width: rx * 2,
      height,
      geometry: { kind: 'cylinder', rimRatio: Math.min(0.4, ry / height) },
      appearance: { fill: [{ type: 'solid', color: body }], stroke: { color: body, width: 0.5 }, cornerRadius: 0, sketchClean: true },
    } as NewNodeInput);
    nodes.push(ellipseAt(c.x, c.y, rx, ry, top));
  };
  /** `blur` softens the ellipse itself (a layer blur); `opacity` is the node's. */
  const ellipseAt = (cx: number, cy: number, rx: number, ry: number, color: string, soft: { blur?: number; opacity?: number } = {}): NewNodeInput => ({
    id: nanoid(),
    type: 'shape',
    x: cx - rx,
    y: cy - ry,
    width: rx * 2,
    height: ry * 2,
    ...(soft.opacity !== undefined ? { opacity: soft.opacity } : {}),
    geometry: { kind: 'ellipse' },
    appearance: { fill: [{ type: 'solid', color }], cornerRadius: 0, sketchClean: true, ...(soft.blur ? { blur: soft.blur } : {}) },
  } as NewNodeInput);

  return { at, nodes, face, box, onBackWall, onSideWall, onFloor, cylinder, ellipseAt, C, S };
}

function isometricBoard(): NewNodeInput[] {
  const W = 1440;
  const H = 1000;
  const nodes: NewNodeInput[] = [];
  nodes.push(
    artboard(0, 0, W, H, 'A desk that ships', '🏙️', 'An isometric room built from pen paths, shapes and drop shadows.', {
      appearance: { fill: [{ type: 'solid', color: '#EDF3FE' }] },
    })
  );

  const ROOM = 480;
  const WALL = 300;
  const T = 14;
  const s = isoScene(800, 380);
  const { at, box, onBackWall, onSideWall, onFloor, cylinder, ellipseAt } = s;

  // The diorama's contact shadow: one blurred ellipse, under everything.
  const base = at({ x: ROOM, y: ROOM, z: -26 });
  s.nodes.push(ellipseAt(base.x, base.y - 60, 430, 70, '#1E2A4A', { blur: 28, opacity: 0.22 }));

  // Floor slab and the two walls.
  box(0, 0, -26, ROOM, ROOM, 26, FLOOR);
  box(0, 0, 0, T, ROOM, WALL, PLASTER_B);
  box(T, 0, 0, ROOM - T, T, WALL, PLASTER_A);

  // A rug, and the shadows things cast on the floor (light from the left).
  onFloor(150, 150, 0.5, 280, 250, '#DCE4FF');
  onFloor(166, 166, 1, 248, 218, '#C9D5FF');
  onFloor(206, 152, 1.2, 250, 128, '#1E2A4A', { opacity: 0.1 });

  // Side wall: a window onto a pale sky.
  onSideWall(T, 110, 120, 170, 140, '#FFFFFF');
  onSideWall(T, 118, 128, 154, 124, '#BFD4FF');
  onSideWall(T, 118, 190, 154, 6, '#FFFFFF');
  onSideWall(T, 192, 128, 6, 124, '#FFFFFF');

  // Back wall: a shelf of books and the Vega poster.
  box(70, T, 196, 150, 30, 6, OAK);
  const BOOKS = ['#3355D1', '#B45309', '#0B7A75', '#6741D9', '#F3A024', '#3355D1', '#E4DCCF'];
  BOOKS.forEach((color, i) => {
    const h = 34 + ((i * 7) % 4) * 7;
    const tone = { top: color, left: color, right: color };
    box(80 + i * 16, T + 4, 202, 12, 22, h, tone);
    // Darken the side the light misses with a translucent wash.
    s.face(
      [{ x: 92 + i * 16, y: T + 4, z: 202 }, { x: 92 + i * 16, y: T + 26, z: 202 }, { x: 92 + i * 16, y: T + 26, z: 202 + h }, { x: 92 + i * 16, y: T + 4, z: 202 + h }],
      '#000000',
      { opacity: 0.22 }
    );
  });
  onBackWall(T + 0.5, 290, 140, 120, 140, BRAND_INK);
  // The mark, mapped onto the wall plane: u along x, v down the poster.
  const poster = (u: number, v: number) => at({ x: 300 + u, y: T + 0.6, z: 270 - v });
  s.nodes.push(
    solidPath(place(VEGA_V, (p) => poster(p.x, p.y)), BRAND),
    solidPath(place(SPARKLE(78.1, 76.82, 17.4), (p) => poster(p.x, p.y)), '#FFFFFF')
  );

  // A low cabinet under the window, with two drawers and a stack of books.
  const KX = T;
  const KY = 300;
  box(KX, KY, 0, 66, 120, 84, PLASTER_A);
  for (const z of [30, 58]) {
    s.face([{ x: KX + 66.5, y: KY + 10, z }, { x: KX + 66.5, y: KY + 110, z }, { x: KX + 66.5, y: KY + 110, z: z + 2 }, { x: KX + 66.5, y: KY + 10, z: z + 2 }], '#CFC5B5');
    const knob = at({ x: KX + 67, y: KY + 60, z: z - 13 });
    s.nodes.push(ellipseAt(knob.x, knob.y, 4, 4, '#B45309'));
  }
  box(KX + 12, KY + 22, 84, 44, 60, 8, { top: '#7C95F2', left: '#5C77DE', right: '#3355D1' });
  box(KX + 16, KY + 30, 92, 38, 52, 7, { top: '#F6C766', left: '#E4A93E', right: '#C98A22' });
  box(KX + 10, KY + 26, 99, 44, 56, 6, { top: '#5FD0C2', left: '#38B2AC', right: '#0B7A75' });

  // Desk: legs first, then the top over them.
  const DX = 170;
  const DY = 120;
  const DW = 250;
  const DD = 130;
  const DZ = 118;
  for (const [lx, ly] of [[DX, DY], [DX + DW - 10, DY], [DX, DY + DD - 10], [DX + DW - 10, DY + DD - 10]]) {
    box(lx, ly, 0, 10, 10, DZ, GRAPHITE);
  }
  box(DX, DY, DZ, DW, DD, 12, OAK);
  // The pool of light the lamp throws on the desk: a blurred ellipse, under
  // everything that stands on the desk so it lights the wood and not the laptop.
  const pool = at({ x: DX + 150, y: DY + 70, z: DZ + 12 });
  s.nodes.push(ellipseAt(pool.x, pool.y, 92, 44, '#FFE7A8', { blur: 18, opacity: 0.8 }));

  // Laptop: base, then the lid standing at its back edge, then the screen.
  const LX = 200;
  const LY = 140;
  const LZ = DZ + 12;
  box(LX, LY, LZ, 116, 76, 5, GRAPHITE);
  box(LX, LY - 4, LZ + 5, 116, 4, 78, GRAPHITE);
  onBackWall(LY + 0.4, LX + 6, LZ + 11, 104, 66, PAPER_WARM);
  // A board on the screen: three notes and the line between two of them.
  onBackWall(LY + 0.6, LX + 16, LZ + 50, 22, 18, '#FDE68A');
  onBackWall(LY + 0.6, LX + 46, LZ + 50, 22, 18, '#FBCFE8');
  onBackWall(LY + 0.6, LX + 76, LZ + 30, 22, 18, '#BBF7D0');
  onBackWall(LY + 0.6, LX + 16, LZ + 22, 50, 6, BRAND);

  // Mug and lamp on the desk.
  cylinder(DX + DW - 44, DY + 92, DZ + 12, 13, 26, BRAND, '#5B3A1E');
  cylinder(DX + DW - 40, DY + 26, DZ + 12, 16, 5, BRAND_INK, '#4A4A56');
  const foot = at({ x: DX + DW - 40, y: DY + 26, z: DZ + 17 });
  const elbow = at({ x: DX + DW - 60, y: DY + 26, z: DZ + 92 });
  const hood = at({ x: DX + DW - 100, y: DY + 40, z: DZ + 104 });
  s.nodes.push(linePath([{ to: foot }, { to: elbow }, { to: hood }], BRAND_INK, 5));
  s.nodes.push(solidPath(polygon([
    { x: hood.x - 14, y: hood.y - 10 }, { x: hood.x + 16, y: hood.y - 4 }, { x: hood.x + 6, y: hood.y + 22 }, { x: hood.x - 26, y: hood.y + 14 },
  ]), BRAND));

  // A plant in the near corner of the room.
  const PX = 400;
  const PY = 360;
  cylinder(PX, PY, 0, 26, 52, '#0B7A75', '#5B3A1E');
  const crown = at({ x: PX, y: PY, z: 52 });
  const LEAVES = [
    [-30, -58, 26, 64, -28, '#2F9E6E'], [8, -74, 24, 70, 12, '#38B2AC'], [-6, -44, 22, 56, -4, '#2F9E6E'],
    [26, -40, 22, 54, 34, '#1F7A55'], [-44, -26, 20, 46, -52, '#38B2AC'],
  ] as const;
  for (const [dx, dy, w, h, rot, color] of LEAVES) {
    s.nodes.push({
      id: nanoid(),
      type: 'shape',
      x: crown.x + dx - w / 2,
      y: crown.y + dy - h / 2 + 24,
      width: w,
      height: h,
      rotation: rot,
      geometry: { kind: 'ellipse' },
      appearance: { fill: [{ type: 'solid', color }], cornerRadius: 0, sketchClean: true },
    } as NewNodeInput);
  }

  // A chair pulled up to the desk: seat, back and a single stem.
  const CXc = 250;
  const CYc = 286;
  box(CXc + 30, CYc + 26, 0, 10, 10, 62, GRAPHITE);
  box(CXc, CYc, 62, 76, 64, 10, { top: '#7C95F2', left: '#5C77DE', right: '#3355D1' });
  box(CXc, CYc + 58, 72, 76, 8, 64, { top: '#7C95F2', left: '#5C77DE', right: '#3355D1' });

  nodes.push(...s.nodes);

  // Floating over the room, the way collaboration looks: a note and a cursor.
  const lifted = { color: '#1E2A4A', offsetX: 0, offsetY: 14, blur: 30, spread: 0, opacity: 0.22 };
  nodes.push(
    {
      id: nanoid(),
      type: 'shape',
      x: 1076,
      y: 116,
      width: 200,
      height: 96,
      rotation: 4,
      geometry: { kind: 'rect' },
      text: 'Ship the beta\nthis Friday',
      typography: { fontFamily: 'Caveat', fontSize: 26, fontWeight: 600, color: PEN_INK, align: 'center', verticalAlign: 'middle', lineHeight: 1.1 },
      appearance: { fill: [{ type: 'solid', color: '#FDE68A' }], cornerRadius: 4, shadow: lifted, sketchClean: true },
    } as NewNodeInput,
  );
  // Maya has the note: her cursor sits on its corner, mid-drag.
  const tip = { x: 1092, y: 208 };
  nodes.push(
    solidPath(polygon([
      { x: tip.x, y: tip.y }, { x: tip.x + 5, y: tip.y + 34 }, { x: tip.x + 14, y: tip.y + 25 }, { x: tip.x + 30, y: tip.y + 24 },
    ]), HAND.violet.pen, { appearance: { fill: [{ type: 'solid', color: HAND.violet.pen }], stroke: { color: '#FFFFFF', width: 2, join: 'round' }, shadow: lifted } }),
    {
      id: nanoid(),
      type: 'shape',
      x: tip.x + 22,
      y: tip.y + 32,
      width: 64,
      height: 28,
      geometry: { kind: 'rect' },
      text: 'Maya',
      typography: { fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: '#FFFFFF', align: 'center', verticalAlign: 'middle' },
      appearance: { fill: [{ type: 'solid', color: HAND.violet.pen }], cornerRadius: 14, shadow: lifted, sketchClean: true },
    } as NewNodeInput,
  );

  nodes.push(
    { ...title(72, 64, 'A desk that ships', 40), width: 420 },
    paragraph(72, 124, 'Every surface is one pen path in one of three tones, drawn back to front. The light is a blurred ellipse; the lift is a drop shadow.', 330, 16, INK_SOFT),
  );

  return layer(nodes);
}


// ---------------------------------------------------------------------------
// 5. Poster: Ideas need room
// ---------------------------------------------------------------------------

function posterBoard(): NewNodeInput[] {
  // A3 at 72 dpi, the frame preset's own size, so it prints edge to edge.
  const W = 842;
  const H = 1191;
  const M = 48;
  const nodes: NewNodeInput[] = [];
  const flat = (x: number, y: number, w: number, h: number, kind: string, color: string, extra: Record<string, unknown> = {}): NewNodeInput => ({
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width: w,
    height: h,
    geometry: { kind },
    appearance: { fill: [{ type: 'solid', color }], cornerRadius: 0, sketchClean: true },
    ...extra,
  } as NewNodeInput);
  const display = (x: number, y: number, text: string, width: number, extra: Record<string, unknown> = {}): NewNodeInput => ({
    id: nanoid(),
    type: 'text',
    x,
    y,
    width,
    height: Math.round(176 * 0.86 * text.split('\n').length),
    text,
    resize: 'width',
    typography: { fontFamily: 'Outfit', fontSize: 176, fontWeight: 800, color: BRAND_INK, lineHeight: 0.86, letterSpacing: -7 },
    ...extra,
  } as NewNodeInput);

  nodes.push(
    artboard(0, 0, W, H, 'Ideas need room', '🖼️', 'An A3 poster set in text styles and flat shapes. Export it as PDF.', { preset: 'a3' }),
    // The sun the words stand in front of, and the ground they stand on.
    flat(300, 118, 500, 500, 'ellipse', BRAND),
    flat(M, 872, 264, 132, 'semicircle', BRAND_INK),
    flat(372, 944, 60, 60, 'ellipse', HAND.blue.pen),
    ...vegaMark(M, M, 34),
    {
      id: nanoid(),
      type: 'text',
      x: M + 46,
      y: M + 6,
      width: 140,
      height: 24,
      text: 'Vega Studio',
      resize: 'width',
      typography: { fontFamily: 'Inter', fontSize: 16, fontWeight: 650, color: BRAND_INK, letterSpacing: -0.2 },
    } as NewNodeInput,
    {
      id: nanoid(),
      type: 'text',
      // Sized to the year itself, so it ends on the right margin like the rule below.
      x: W - M - 38,
      y: M + 6,
      width: 38,
      height: 24,
      text: '2026',
      resize: 'width',
      typography: { fontFamily: 'Inter', fontSize: 16, fontWeight: 500, color: BRAND_INK },
    } as NewNodeInput,
    display(M - 6, 300, 'Ideas\nneed', 500),
    // The last word sits on a ribbon; its ink is picked against the ribbon.
    display(M + 10, 628, 'room.', 470, {
      typography: {
        fontFamily: 'Outfit', fontSize: 176, fontWeight: 800, color: BRAND_INK, lineHeight: 0.86, letterSpacing: -7,
        highlight: { color: BRAND_INK, radius: 6, paddingX: 16, paddingY: 4, join: 'ribbon', autoContrast: true },
      },
    }),
    {
      id: nanoid(),
      type: 'sticky',
      x: 560,
      y: 700,
      width: 210,
      height: 210,
      rotation: 6,
      text: 'Give it a whole board, not the corner of one.',
      theme: 'yellow',
      fontSize: 24,
      reactions: {},
      tags: [],
      pinned: false,
      showAuthor: false,
    } as NewNodeInput,
    flat(M, 1036, W - 2 * M, 3, 'rect', BRAND_INK),
    paragraph(M, 1060, 'A thought trimmed to fit the space it was given comes out smaller. Room is not a luxury for an idea; it is how you find out where it goes.', 380, 15, INK_MID, 450, 1.5),
    paragraph(470, 1060, 'Think it through together, on one infinite board.', 324, 15, INK_MID, 600, 1.5),
  );

  return layer(nodes);
}


// ---------------------------------------------------------------------------
// 6. Spot illustrations
// ---------------------------------------------------------------------------

/** The spots' one palette: an ink, a card white, and four gradient pairs. */
const SPOT = {
  ink: '#1E1B4B',
  muted: '#64748B',
  card: '#FFFFFF',
  violet: ['#8B5CF6', '#6D28D9'],
  indigo: ['#818CF8', '#4F46E5'],
  amber: ['#FBBF24', '#F97316'],
  teal: ['#2DD4BF', '#0891B2'],
} as const;

/** One soft lift for every card in the set, so the four read as one family. */
const SPOT_SHADOW = { color: '#1E1B4B', offsetX: 0, offsetY: 14, blur: 30, spread: -4, opacity: 0.16 };

const diagonal = (pair: readonly [string, string] | readonly string[], from = { x: 0, y: 0 }, to = { x: 1, y: 1 }) => ({
  type: 'linear',
  from,
  to,
  stops: [{ offset: 0, color: pair[0] }, { offset: 1, color: pair[1] }],
});

/**
 * A spot's local drawing kit: everything is placed in the frame's own 0..S
 * square, so each illustration is written once and can sit anywhere.
 */
function spotKit(ox: number, oy: number) {
  const nodes: NewNodeInput[] = [];
  const shape = (
    x: number, y: number, w: number, h: number, kind: string,
    fill: unknown, extra: { radius?: number; shadow?: boolean; stroke?: { color: string; width: number; dash?: number[] }; rotation?: number; opacity?: number; text?: string; typography?: Record<string, unknown>; geometry?: Record<string, unknown> } = {}
  ): NewNodeInput => {
    const node = {
      id: nanoid(),
      type: 'shape',
      x: ox + x,
      y: oy + y,
      width: w,
      height: h,
      rotation: extra.rotation ?? 0,
      ...(extra.opacity !== undefined ? { opacity: extra.opacity } : {}),
      geometry: { kind, ...extra.geometry },
      ...(extra.text ? { text: extra.text, typography: { fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: SPOT.ink, align: 'center', verticalAlign: 'middle', ...extra.typography } } : {}),
      appearance: {
        fill: fill ? [fill] : [],
        ...(extra.stroke ? { stroke: { cap: 'round', join: 'round', ...extra.stroke } } : {}),
        cornerRadius: extra.radius ?? 0,
        sketchClean: true,
        ...(extra.shadow ? { shadow: SPOT_SHADOW } : {}),
      },
    } as NewNodeInput;
    nodes.push(node);
    return node;
  };
  const solid = (color: string) => ({ type: 'solid', color });
  const card = (x: number, y: number, w: number, h: number, radius = 18) => shape(x, y, w, h, 'rect', solid(SPOT.card), { radius, shadow: true });
  /** The pale disc behind each spot, fading into the frame. */
  const halo = (pale: string, ground: string) =>
    shape(60, 60, 400, 400, 'ellipse', { type: 'radial', center: { x: 0.5, y: 0.5 }, radius: 0.5, stops: [{ offset: 0, color: pale }, { offset: 1, color: ground }] });
  const label = (x: number, y: number, text: string, size = 13, weight = 600, color: string = SPOT.ink, width = 200) => {
    const node = {
      id: nanoid(),
      type: 'text',
      x: ox + x,
      y: oy + y,
      width,
      height: Math.round(size * 1.4),
      text,
      resize: 'width',
      typography: { fontFamily: 'Inter', fontSize: size, fontWeight: weight, color, letterSpacing: size > 20 ? -0.6 : 0 },
    } as NewNodeInput;
    nodes.push(node);
    return node;
  };
  const cursor = (x: number, y: number, color: readonly [string, string] | readonly string[], name: string) => {
    nodes.push(solidPath(polygon([
      { x: ox + x, y: oy + y }, { x: ox + x + 5, y: oy + y + 32 }, { x: ox + x + 13, y: oy + y + 23 }, { x: ox + x + 28, y: oy + y + 22 },
    ]), color[1], { appearance: { fill: [solid(color[1])], stroke: { color: '#FFFFFF', width: 2.5, join: 'round' }, shadow: SPOT_SHADOW } }));
    shape(x + 20, y + 30, 18 + name.length * 9, 26, 'rect', diagonal(color), {
      radius: 13, text: name, typography: { color: '#FFFFFF', fontSize: 12 },
    });
  };
  /** An arc as a stroked pen path: `from` and `to` in degrees, clockwise from three o'clock. */
  const arc = (cx: number, cy: number, r: number, from: number, to: number, color: string, width: number) => {
    const steps = Math.max(8, Math.round(Math.abs(to - from) / 6));
    const pts = Array.from({ length: steps + 1 }, (_, i) => {
      const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
      return { to: { x: ox + cx + r * Math.cos(a), y: oy + cy + r * Math.sin(a) } };
    });
    nodes.push(linePath(pts, color, width));
  };
  return { nodes, shape, solid, card, halo, label, cursor, arc };
}

const SPOT_SIZE = 520;

function spotCollaboration(ox: number, oy: number): NewNodeInput[] {
  const k = spotKit(ox, oy);
  k.halo('#E4DBFF', '#F7F5FF');
  k.card(92, 120, 320, 240);
  [0, 1, 2].forEach((i) => k.shape(112 + i * 14, 140, 8, 8, 'ellipse', k.solid('#E2E8F0')));
  const a = k.shape(118, 176, 82, 70, 'rect', k.solid('#FDE68A'), { radius: 6 });
  const b = k.shape(300, 168, 82, 70, 'rect', k.solid('#C4B5FD'), { radius: 6, rotation: 4 });
  const c = k.shape(208, 268, 82, 70, 'rect', k.solid('#99F6E4'), { radius: 6, rotation: -3 });
  for (const sticky of [a, b, c]) {
    const n = sticky as unknown as { x: number; y: number };
    k.shape(n.x - ox + 12, n.y - oy + 18, 50, 6, 'rect', k.solid('#1E1B4B'), { radius: 3, opacity: 0.18 });
    k.shape(n.x - ox + 12, n.y - oy + 32, 34, 6, 'rect', k.solid('#1E1B4B'), { radius: 3, opacity: 0.18 });
  }
  k.nodes.push(
    link(a.id, b.id, {
      routing: 'curved', from: { nodeId: a.id, port: 'right' }, to: { nodeId: b.id, port: 'left' },
      appearance: { stroke: { color: SPOT.violet[1], width: 2.5, cap: 'round', dash: [6, 6] } },
    }),
    link(a.id, c.id, {
      routing: 'curved', from: { nodeId: a.id, port: 'bottom' }, to: { nodeId: c.id, port: 'left' },
      appearance: { stroke: { color: SPOT.teal[1], width: 2.5, cap: 'round' } },
    })
  );
  // Who is here: three avatars, overlapping, ringed in white.
  [SPOT.violet, SPOT.amber, SPOT.teal].forEach((pair, i) => {
    k.shape(334 + i * 30, 82, 44, 44, 'ellipse', diagonal(pair), { stroke: { color: '#FFFFFF', width: 3 }, shadow: i === 2 });
  });
  k.cursor(352, 286, SPOT.violet, 'Ada');
  k.cursor(150, 214, SPOT.teal, 'Leo');
  k.card(96, 392, 222, 52, 26);
  k.shape(108, 402, 32, 32, 'ellipse', diagonal(SPOT.amber));
  k.label(150, 408, 'Looks great, ship it', 13, 600);
  return k.nodes;
}

function spotSecurity(ox: number, oy: number): NewNodeInput[] {
  const k = spotKit(ox, oy);
  k.halo('#DCE1FF', '#F5F7FF');
  // A clean shape with no paint takes the tool's default fill, so "none" is a clear one.
  k.shape(40, 40, 440, 440, 'ellipse', { type: 'solid', color: '#FFFFFF', opacity: 0 }, { stroke: { color: '#A5B4FC', width: 2, dash: [2, 12] } });
  k.card(70, 160, 270, 210);
  k.label(96, 186, 'Sign in', 18, 700);
  k.shape(96, 226, 218, 42, 'rect', k.solid('#EEF2FF'), {
    radius: 10, text: '••••••••••', typography: { fontSize: 18, color: SPOT.indigo[1], align: 'left', fontWeight: 700 },
  });
  k.shape(96, 290, 120, 42, 'rect', diagonal(SPOT.indigo), { radius: 10, text: 'Continue', typography: { color: '#FFFFFF' } });
  k.shape(272, 108, 172, 204, 'shield', diagonal(SPOT.indigo), { shadow: true });
  k.shape(326, 162, 64, 72, 'lock', k.solid('#FFFFFF'));
  k.shape(392, 286, 60, 60, 'ellipse', diagonal(['#34D399', '#059669']), { stroke: { color: '#FFFFFF', width: 4 }, shadow: true });
  k.nodes.push(linePath(polygon([{ x: ox + 407, y: oy + 316 }, { x: ox + 418, y: oy + 327 }, { x: ox + 438, y: oy + 305 }]), '#FFFFFF', 5));
  k.shape(110, 96, 10, 10, 'ellipse', k.solid('#818CF8'));
  k.shape(438, 400, 14, 14, 'ellipse', k.solid('#C7D2FE'));
  return k.nodes;
}

function spotSpeed(ox: number, oy: number): NewNodeInput[] {
  const k = spotKit(ox, oy);
  k.halo('#FFE6C2', '#FFF8EF');
  // Speed lines, fading in towards the bolt.
  [[70, 168, 150], [40, 214, 186], [96, 260, 120]].forEach(([x, y, w]) => {
    k.shape(x, y, w, 12, 'rect', { type: 'linear', from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, stops: [{ offset: 0, color: '#F97316', opacity: 0 }, { offset: 1, color: '#F97316', opacity: 0.85 }] }, { radius: 6 });
  });
  k.shape(232, 92, 168, 224, 'bolt', diagonal(SPOT.amber, { x: 0.2, y: 0 }, { x: 0.8, y: 1 }), { shadow: true });
  k.card(250, 320, 196, 132);
  k.arc(348, 410, 54, 180, 360, '#FDE7CF', 12);
  k.arc(348, 410, 54, 180, 318, '#F97316', 12);
  k.nodes.push(linePath([{ to: { x: ox + 348, y: oy + 410 } }, { to: { x: ox + 348 + 40 * Math.cos((318 * Math.PI) / 180), y: oy + 410 + 40 * Math.sin((318 * Math.PI) / 180) } }], SPOT.ink, 4));
  k.shape(342, 404, 12, 12, 'ellipse', k.solid(SPOT.ink));
  k.label(70, 336, '120 ms', 30, 750, SPOT.ink, 150);
  k.label(72, 378, 'p95, worldwide', 13, 500, SPOT.muted, 150);
  return k.nodes;
}

function spotAnalytics(ox: number, oy: number): NewNodeInput[] {
  const k = spotKit(ox, oy);
  k.halo('#CFF7F0', '#F2FCFA');
  k.card(70, 112, 340, 270);
  k.label(96, 136, 'Weekly active', 13, 600, SPOT.muted, 150);
  k.label(96, 158, '12.4k', 32, 750, SPOT.ink, 120);
  k.shape(318, 140, 68, 28, 'rect', k.solid('#D1FAE5'), { radius: 14, text: '+24%', typography: { color: '#047857', fontSize: 12, fontWeight: 700 } });
  const HEIGHTS = [52, 76, 64, 98, 88, 132];
  HEIGHTS.forEach((h, i) => {
    const last = i === HEIGHTS.length - 1;
    k.shape(94 + i * 44, 356 - h, 28, h, 'rect', diagonal(last ? SPOT.amber : SPOT.teal, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }), { radius: 8 });
  });
  k.shape(96, 357, 284, 2, 'rect', k.solid('#E2E8F0'));
  // A small donut card, lifted off the corner of the big one.
  k.card(352, 304, 132, 132, 22);
  k.arc(418, 370, 36, -90, 270, '#E6F7F4', 12);
  k.arc(418, 370, 36, -90, 160, '#0891B2', 12);
  k.arc(418, 370, 36, 160, 230, '#F97316', 12);
  return k.nodes;
}

function spotsBoard(): NewNodeInput[] {
  const GAP = 80;
  const SPOTS: Array<[string, string, string, string, (x: number, y: number) => NewNodeInput[]]> = [
    ['Collaboration', '🤝', '#F7F5FF', 'Cards, cursors and the people behind them.', spotCollaboration],
    ['Security', '🔒', '#F5F7FF', 'A sign-in card and the shield over it.', spotSecurity],
    ['Speed', '⚡', '#FFF8EF', 'A bolt, its slipstream and the number it buys.', spotSpeed],
    ['Analytics', '📈', '#F2FCFA', 'A metric card with its trend and its split.', spotAnalytics],
  ];
  // Drawn in the order written, frames first: the connectors here run across
  // a card, so they must sit above it rather than where layer() puts them.
  const frames: NewNodeInput[] = [];
  const art: NewNodeInput[] = [];
  SPOTS.forEach(([name, icon, ground, description, draw], i) => {
    const x = (i % 2) * (SPOT_SIZE + GAP);
    const y = Math.floor(i / 2) * (SPOT_SIZE + GAP);
    frames.push(artboard(x, y, SPOT_SIZE, SPOT_SIZE, name, icon, description, { appearance: { fill: [{ type: 'solid', color: ground }] } }));
    art.push(...draw(x, y));
  });
  return [...frames, ...art];
}


// ---------------------------------------------------------------------------
// 7. A year of making things: a hand-drawn infographic
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHIPPED = [8, 12, 15, 11, 22, 18, 9, 14, 24, 27, 19, 13];

function yearInfographic(): NewNodeInput[] {
  const W = 1600;
  const H = 1140;
  const M = 72;
  const nodes: NewNodeInput[] = [];
  const total = SHIPPED.reduce((a, b) => a + b, 0);

  nodes.push(
    artboard(0, 0, W, H, 'A year of making things', '📒', 'Hand-drawn charts read from a real table. Edit a number and the bars follow.'),
    handNote(M, 40, 'A year of making things', 72),
    handNote(M + 4, 138, 'One sketchbook page for 2026. The bars read from the table beside them.', 28, HAND.ink.wash),
    wallNote(1330, 52, 'Next year: fewer meetings, more walks', 'yellow', 4, { width: 196, height: 196 }),
  );

  // --- Shipped, by month: a sketched table feeding a sketched chart. --------
  const rowY = 236;
  nodes.push(handNote(M, rowY, 'things shipped, by month', 32, HAND.amber.pen));
  const tableNode = table(M, rowY + 56, {
    cells: [['Month', 'Shipped'], ...MONTHS.map((m, i) => [m, String(SHIPPED[i])])],
    columns: [{ width: 1.1, type: 'text' }, { width: 1, type: 'number' }],
    header: true,
    theme: 'minimal',
    fontSize: 14,
    refs: 2,
  } as never, 200, 13 * 30, { appearance: { sketch: 'light' } });
  nodes.push(tableNode);
  nodes.push(chart(M + 236, rowY + 56, plot('bar', {
    title: undefined,
    categories: MONTHS,
    series: [{ name: 'Shipped', values: SHIPPED, color: HAND.blue.pen }],
    showGrid: false,
    showLegend: false,
    showValues: true,
    link: { tableId: tableNode.id as string, r0: 0, c0: 0, r1: 12, c1: 1, header: true },
  }), 600, 390, { appearance: { sketch: 'medium' } }));
  // The peak, called out the way you would in a margin.
  nodes.push(handNote(M + 640, rowY + 2, 'October: launch month', 26, HAND.ink.pen));
  nodes.push(pencil(withHead(sampleCubic({ x: M + 700, y: rowY + 40 }, { x: M + 690, y: rowY + 70 }, { x: M + 700, y: rowY + 90 }, { x: M + 712, y: rowY + 112 }, 10), 11, 30), HAND.ink.pen, 3, 'medium'));

  // --- Where the time went: a waffle of fifty hand-drawn squares. ----------
  const wx = 1000;
  nodes.push(handNote(wx, rowY, 'where the time went', 32, HAND.amber.pen));
  const SPLIT: Array<[string, number, Hue]> = [['making', 21, 'amber'], ['building', 14, 'blue'], ['meetings', 10, 'violet'], ['walks', 5, 'teal']];
  const cells: Hue[] = SPLIT.flatMap(([, n, hue]) => Array.from({ length: n }, () => hue));
  const SQ = 38;
  const GAP = 7;
  cells.forEach((hue, i) => {
    const col = i % 10;
    const r = Math.floor(i / 10);
    nodes.push(sketch(wx + col * (SQ + GAP), rowY + 60 + r * (SQ + GAP), SQ, SQ, 'rect', {
      hue, fillStyle: 'solid', fill: HAND[hue].wash, level: 'light', weight: 1.8, cornerRadius: 4,
    }));
  });
  const legendY = rowY + 60 + 5 * (SQ + GAP) + 22;
  SPLIT.forEach(([name, n, hue], i) => {
    const x = wx + (i % 2) * 220;
    const y = legendY + Math.floor(i / 2) * 38;
    nodes.push(
      sketch(x, y + 8, 18, 18, 'ellipse', { hue, fillStyle: 'solid', fill: HAND[hue].wash, level: 'light', weight: 1.6 }),
      handNote(x + 28, y, `${name}  ${n * 2}%`, 24, HAND.ink.wash),
    );
  });
  // A question in the margin, aimed at the meetings.
  nodes.push(handNote(wx + 52, legendY + 92, 'too many?', 26, HAND.violet.pen));
  nodes.push(pencil(withHead(sampleCubic({ x: wx + 46, y: legendY + 108 }, { x: wx + 24, y: legendY + 104 }, { x: wx + 12, y: legendY + 90 }, { x: wx + 10, y: legendY + 70 }, 8), 9, 32), HAND.violet.pen, 2.8, 'medium'));

  // --- The year in four numbers, each with its own doodle. ----------------
  const statY = 760;
  const STATS: Array<[string, string, string, Hue, Record<string, unknown>?]> = [
    [String(total), 'things shipped', 'document', 'blue'],
    ['48', 'boards started', 'browser', 'teal'],
    ['9', 'talks given', 'chat', 'violet'],
    ['1,140', 'coffees', 'cylinder', 'amber', { rimRatio: 0.16 }],
  ];
  STATS.forEach(([value, what, kind, hue, geometry], i) => {
    const x = M + i * 372;
    nodes.push(
      sketch(x, statY + 8, 84, 84, kind, { hue, fillStyle: 'hachure', weight: 2.4, rotation: i % 2 ? 5 : -5, geometry }),
      handNote(x + 108, statY - 6, value, 64, HAND.ink.pen),
      handNote(x + 112, statY + 70, what, 24, HAND.ink.wash),
    );
  });

  // --- A timeline along the foot of the page. -----------------------------
  const lineY = 1010;
  nodes.push(stroke({ x: M, y: lineY }, { x: W - M, y: lineY }, { hue: 'ink', profile: 'wavy', waves: 14, amplitude: 0.35, weight: 2.4, head: true }));
  const MOMENTS: Array<[number, string, Hue]> = [
    [0.02, 'new sketchbook', 'amber'], [0.27, 'first talk', 'violet'], [0.5, 'v2 out the door', 'blue'], [0.77, '200th sketch', 'teal'], [0.95, 'rest', 'amber'],
  ];
  MOMENTS.forEach(([t, what, hue], i) => {
    const x = M + t * (W - 2 * M - 40);
    nodes.push(
      sketch(x - 9, lineY - 9, 18, 18, 'ellipse', { hue, fillStyle: 'solid', fill: HAND[hue].wash, level: 'light', weight: 2 }),
      handNote(x - 6, i % 2 ? lineY + 22 : lineY - 54, what, 24, HAND.ink.pen),
    );
  });

  return layer(nodes);
}


export const ART: Template[] = [
  {
    id: 'art-vega-hero',
    category: 'art',
    name: 'Vega Studio hero',
    blurb: 'The logo, drawn as vectors, in a ring of hand-sketched objects. Exports as a 1200×630 link card.',
    teaches: ['Sketch mode', 'Pen paths', 'Frame presets'],
    tags: ['og image', 'social card', 'logo', 'brand', 'excalidraw', 'doodle', 'hero'],
    accent: 'amber',
    featured: true,
    build: () => heroBoard(),
  },
  {
    id: 'art-doodle-wall',
    category: 'art',
    name: 'Doodle wall',
    blurb: 'The three sketch hands, five pen fills and a wall of doodles, stickies and squiggles.',
    teaches: ['Sketch levels', 'Fill styles', 'Sticky notes'],
    tags: ['doodle', 'hand-drawn', 'sketch', 'roughness', 'hachure', 'caveat', 'whiteboard'],
    accent: 'sky',
    build: () => doodleWall(),
  },
  {
    id: 'art-flow-field',
    category: 'art',
    name: 'Flow field',
    blurb: 'Pen paths traced through one formula, with the source that drew them set beside it.',
    teaches: ['Pen paths', 'Code blocks', 'Generative art'],
    tags: ['generative', 'creative coding', 'streamlines', 'vector field', 'algorithmic', 'math art'],
    accent: 'violet',
    build: (limit) => flowFieldBoard(limit),
  },
  {
    id: 'art-isometric-desk',
    category: 'art',
    name: 'A desk that ships',
    blurb: 'An isometric room drawn from flat pen paths, with a lamp-lit desk and a note floating on a drop shadow.',
    teaches: ['Pen paths', 'Drop shadows', 'Layer blur'],
    tags: ['isometric', 'illustration', 'vector art', 'workspace', 'room', 'diorama', 'shadows'],
    accent: 'blue',
    build: () => isometricBoard(),
  },
  {
    id: 'art-poster-ideas',
    category: 'art',
    name: 'Poster: Ideas need room',
    blurb: 'A print-ready A3 poster from text styles, flat shapes and one dog-eared sticky note.',
    teaches: ['Text styles', 'Print frames', 'Sticky notes'],
    tags: ['poster', 'typography', 'print', 'a3', 'swiss', 'bauhaus', 'layout'],
    accent: 'amber',
    build: () => posterBoard(),
  },
  {
    id: 'art-spot-illustrations',
    category: 'art',
    name: 'Spot illustrations',
    blurb: 'Four marketing spots in one style: collaboration, security, speed and analytics, each in its own frame.',
    teaches: ['Gradients', 'Drop shadows', 'Frames'],
    tags: ['spot illustration', 'marketing', 'saas', 'landing page', 'icons', 'vector', 'gradient'],
    accent: 'violet',
    build: () => spotsBoard(),
  },
  {
    id: 'art-year-infographic',
    category: 'art',
    name: 'A year of making things',
    blurb: 'A hand-drawn infographic: sketched charts fed by a real table, a waffle, doodles and a timeline.',
    teaches: ['Sketch mode', 'Data links', 'Hand lettering'],
    tags: ['infographic', 'year in review', 'hand-drawn', 'sketchnote', 'waffle chart', 'caveat', 'data viz'],
    accent: 'amber',
    build: () => yearInfographic(),
  },
];
