import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../document/mutations';
import type { Template } from './templates';
import {
  BRAND, BRAND_INK, caption, hue, INK, INK_SOFT, layer, note, rng, sticky, title,
} from './templateKit';

/**
 * Drawing, rather than diagramming.
 *
 * ## Why a canvas product needs these
 *
 * Every board elsewhere in the gallery is *about* something — a pipeline, a
 * quarter, a payment. These are about the tool itself: what fifty shape
 * geometries look like when somebody has arranged them with care, what the
 * hand-drawn pen does to a perfect circle, what happens when you let a
 * formula place four hundred objects.
 *
 * They are also the boards that get screenshotted, and that is a real
 * function. A diagram of a data pipeline tells somebody this app is
 * competent; a page of hand-drawn shapes scattered around a logo tells them
 * it is *fun*, and those are different arguments aimed at different people.
 *
 * ## Seeded, never random
 *
 * Each of these lays out with `rng(seed)` rather than `Math.random`. The card
 * in the gallery is drawn from one call to `build()` and the board you open
 * from another, so anything genuinely random would make the thumbnail a
 * picture of a board that has never existed. Seeded, the card is a photograph
 * of the board.
 */

// ---------------------------------------------------------------------------

/** The geometries worth scattering: things with a recognisable silhouette. */
const DOODLE_SHAPES = [
  'ellipse', 'squircle', 'star', 'heart', 'diamond', 'right_triangle', 'semicircle',
  'trapezoid', 'parallelogram', 'arrow_block', 'cloud', 'chevron', 'cross', 'donut',
  'badge', 'banner', 'capsule', 'cylinder', 'pin', 'plane', 'globe', 'bolt', 'key',
  'shield', 'gear', 'package', 'mail', 'user', 'wallet', 'note', 'folder', 'document',
  'callout', 'database', 'server', 'cpu', 'mobile', 'desktop', 'browser', 'terminal',
] as const;

/**
 * A hand-drawn shape, ink only.
 *
 * No fill and a coloured stroke, which is the whole trick behind why a page of
 * these reads as a sketchbook rather than as a chart: filled shapes at this
 * density become a quilt, and the eye reads a quilt as one object. Outlines
 * stay separate, so forty of them still read as forty drawings.
 */
const doodle = (
  x: number,
  y: number,
  size: number,
  kind: string,
  color: string,
  rotation: number,
  sketch: 'light' | 'medium' | 'heavy' = 'medium'
): NewNodeInput => ({
  id: nanoid(),
  type: 'shape',
  x,
  y,
  width: size,
  height: size,
  rotation,
  geometry: { kind },
  appearance: {
    fill: [],
    stroke: { color, width: 2.4, cap: 'round', join: 'round' },
    sketch,
    cornerRadius: 8,
  },
});

/**
 * Scatter shapes on a ring, avoiding a rectangle in the middle.
 *
 * Poisson-ish by rejection: a candidate is kept only if it is far enough from
 * everything already placed and outside the keep-out box. Evenly spaced beats
 * truly random here — real randomness clumps, and a clump in a decorative
 * scatter looks like a mistake rather than like nature.
 */
function scatter(
  count: number,
  bounds: { w: number; h: number },
  keepOut: { x: number; y: number; w: number; h: number } | null,
  seed: number,
  minGap: number,
  /**
   * How big the things being placed actually are.
   *
   * It used to be hard-coded to the doodle range, and the sticky board then
   * spaced 210px notes as though they were 46–120px shapes: the rejection test
   * passed, and half the wall landed on top of the other half. A scatter that
   * does not know the size of what it is scattering is not a scatter, it is a
   * list of coordinates.
   */
  sizes: { min: number; max: number } = { min: 46, max: 120 }
): Array<{ x: number; y: number; size: number; kind: string; rot: number; tint: number }> {
  const random = rng(seed);
  const placed: Array<{ x: number; y: number; size: number; kind: string; rot: number; tint: number }> = [];
  let guard = 0;
  while (placed.length < count && guard < count * 400) {
    guard += 1;
    const size = sizes.min + random() * (sizes.max - sizes.min);
    const x = random() * (bounds.w - size);
    const y = random() * (bounds.h - size);
    const cx = x + size / 2;
    const cy = y + size / 2;

    if (
      keepOut &&
      cx > keepOut.x - size * 0.7 &&
      cx < keepOut.x + keepOut.w + size * 0.7 &&
      cy > keepOut.y - size * 0.7 &&
      cy < keepOut.y + keepOut.h + size * 0.7
    ) {
      continue;
    }
    const clear = placed.every((p) => Math.hypot(p.x + p.size / 2 - cx, p.y + p.size / 2 - cy) > (p.size + size) / 2 + minGap);
    if (!clear) continue;

    placed.push({
      x,
      y,
      size,
      kind: DOODLE_SHAPES[Math.floor(random() * DOODLE_SHAPES.length)],
      rot: (random() - 0.5) * 34,
      tint: random(),
    });
  }
  return placed;
}

export const ART_TEMPLATES: Template[] = [
  // -------------------------------------------------------------------------
  {
    id: 'art-hero',
    category: 'art',
    name: 'Sketch hero',
    blurb: 'A hundred hand-drawn objects arranged around a clear centre — the picture a canvas tool should lead with.',
    teaches: ['Sketch mode', 'Composition', 'Scatter'],
    objectCount: 103,
    build: (limit) => {
      /**
       * The Excalidraw-poster idea, built properly.
       *
       * The thing that makes that image work is not the doodles — it is the
       * *hole*. A field of drawings with a calm rectangle cut out of the
       * middle gives the eye somewhere to land, and everything around it
       * becomes a frame rather than noise. So the scatter is a real keep-out
       * region, not a hope, and the wordmark sits in it with room to breathe.
       *
       * Every object is a separate node, hand-drawn by the same pen, in a
       * palette that rotates once around the wheel so neighbouring shapes are
       * always related and opposite ones never clash.
       */
      const W = 2200;
      const H = 1320;
      const CENTRE = { x: 700, y: 500, w: 800, h: 320 };
      const COUNT = Math.min(100, limit ?? 100);

      const nodes: NewNodeInput[] = [];

      for (const s of scatter(COUNT, { w: W, h: H }, CENTRE, 20260918, 26)) {
        nodes.push(doodle(s.x, s.y, s.size, s.kind, hue(s.tint, 62, 52), s.rot));
      }

      // The centre: the name, the line, and nothing else.
      nodes.push({
        id: nanoid(),
        type: 'text',
        x: CENTRE.x,
        y: CENTRE.y + 40,
        width: CENTRE.w,
        height: 150,
        text: 'Vega Studio',
        resize: 'width',
        typography: { fontSize: 128, fontWeight: 700, color: BRAND_INK, align: 'center', letterSpacing: -4 },
      } as never);

      nodes.push({
        id: nanoid(),
        type: 'text',
        x: CENTRE.x,
        y: CENTRE.y + 200,
        width: CENTRE.w,
        height: 44,
        text: 'An infinite canvas you can share with a link.',
        resize: 'width',
        typography: { fontSize: 30, fontWeight: 500, color: INK_SOFT, align: 'center' },
      } as never);

      // One amber mark under the wordmark — the single brand note on the page.
      nodes.push({
        id: nanoid(),
        type: 'shape',
        x: CENTRE.x + CENTRE.w / 2 - 60,
        y: CENTRE.y + 172,
        width: 120,
        height: 10,
        geometry: { kind: 'rect' },
        appearance: {
          fill: [{ type: 'solid', color: BRAND }],
          cornerRadius: 5,
          sketch: 'light',
        },
      } as never);

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'art-sketchbook',
    category: 'art',
    name: 'Sketchbook',
    blurb: 'Every shape the tool knows, drawn by hand and laid out like a specimen sheet.',
    teaches: ['Shape library', 'Sketch levels', 'Grids'],
    objectCount: 126,
    build: (limit) => {
      /**
       * A specimen sheet, which is the honest way to show a shape library.
       *
       * A scattered pile looks nicer in a screenshot and tells you nothing —
       * you cannot tell whether the tool has a cylinder because you cannot
       * find the cylinder. On a grid, every shape is legible, comparable and
       * findable, and the rows can say something the pile cannot: these three
       * rows are **the same shapes at the three sketch levels**, so the whole
       * feature is one glance rather than a settings menu.
       */
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -170, 'Sketchbook'),
        caption(0, -104, 'Every geometry the shape tool knows, drawn three times — light, medium and heavy pen.', 940)
      );

      const PER_ROW = 10;
      const CELL = 150;
      const SIZE = 96;
      const LEVELS: Array<['light' | 'medium' | 'heavy', string]> = [
        ['light', 'Light — a ruled line with a wobble'],
        ['medium', 'Medium — the default, a felt pen'],
        ['heavy', 'Heavy — a marker in a hurry'],
      ];

      const budget = limit ?? Infinity;
      let made = 0;
      let y = 0;

      for (const [level, name] of LEVELS) {
        nodes.push(note(0, y, name, 700, 17, INK));
        y += 40;
        DOODLE_SHAPES.forEach((kind, i) => {
          if (made >= budget) return;
          const col = i % PER_ROW;
          const rowOffset = Math.floor(i / PER_ROW) * CELL;
          nodes.push(doodle(col * CELL, y + rowOffset, SIZE, kind, hue(i / DOODLE_SHAPES.length, 58, 50), 0, level));
          made += 1;
        });
        y += Math.ceil(DOODLE_SHAPES.length / PER_ROW) * CELL + 60;
      }

      nodes.push(
        note(0, y, 'Same geometry, same size, same seed — only the pen changes. Select any of them and the Sketch control is in the shape panel.', 1400, 16, INK_SOFT)
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'art-bauhaus',
    category: 'art',
    name: 'Composition',
    blurb: 'A poster built from sixty flat shapes on a strict grid — no gradients, no effects, just placement.',
    teaches: ['Layout', 'Colour', 'Layering'],
    objectCount: 47,
    build: (limit) => {
      /**
       * The argument here is that a canvas tool is a design tool.
       *
       * Everything on this board is a rectangle, a circle, a semicircle or a
       * quarter-arc, filled flat, placed on an eight-column grid. No effect is
       * doing any work — which is the point: if it looks good, it looks good
       * because of arrangement, and arrangement is the thing this tool is for.
       */
      const nodes: NewNodeInput[] = [];
      const random = rng(88041);
      const budget = limit ?? Infinity;

      const PALETTE = ['#E8533A', BRAND, '#2B59C3', '#1C1917', '#F7F3EC', '#3F8E6B'];
      const UNIT = 150;
      const COLS = 9;
      const ROWS = 8;

      // Paper
      nodes.push({
        id: nanoid(),
        type: 'shape',
        x: -60,
        y: -60,
        width: COLS * UNIT + 120,
        height: ROWS * UNIT + 120,
        geometry: { kind: 'rect' },
        appearance: { fill: [{ type: 'solid', color: '#F7F3EC' }], cornerRadius: 0 },
      } as never);

      let made = 0;
      for (let r = 0; r < ROWS; r += 1) {
        for (let c = 0; c < COLS; c += 1) {
          if (made >= budget) break;
          const roll = random();
          // Two thirds of the grid stays empty. Density is what separates a
          // composition from a quilt.
          if (roll < 0.42) continue;

          const span = random() < 0.24 ? 2 : 1;
          if (c + span > COLS) continue;

          const kind =
            roll > 0.94 ? 'semicircle' : roll > 0.86 ? 'ellipse' : roll > 0.78 ? 'right_triangle' : 'rect';
          const color = PALETTE[Math.floor(random() * (PALETTE.length - 1))];

          nodes.push({
            id: nanoid(),
            type: 'shape',
            x: c * UNIT + 6,
            y: r * UNIT + 6,
            width: span * UNIT - 12,
            height: UNIT - 12,
            rotation: kind === 'semicircle' || kind === 'right_triangle' ? Math.floor(random() * 4) * 90 : 0,
            geometry: { kind },
            appearance: { fill: [{ type: 'solid', color }], cornerRadius: kind === 'rect' ? 2 : 0 },
          } as never);
          made += 1;
        }
      }

      // Two rules and a word, which is what turns a pattern into a poster.
      nodes.push(
        {
          id: nanoid(),
          type: 'shape',
          x: -60,
          y: ROWS * UNIT - 190,
          width: COLS * UNIT + 120,
          height: 6,
          geometry: { kind: 'rect' },
          appearance: { fill: [{ type: 'solid', color: '#1C1917' }] },
        } as never,
        {
          id: nanoid(),
          type: 'text',
          x: -50,
          y: ROWS * UNIT - 170,
          width: 900,
          height: 120,
          text: 'FORM\nFOLLOWS',
          resize: 'width',
          typography: { fontSize: 76, fontWeight: 700, color: '#1C1917', lineHeight: 0.95, letterSpacing: -2 },
        } as never,
        {
          id: nanoid(),
          type: 'text',
          x: COLS * UNIT - 320,
          y: ROWS * UNIT - 100,
          width: 380,
          height: 50,
          text: 'sixty-four objects',
          resize: 'width',
          typography: { fontSize: 22, fontWeight: 500, color: '#1C1917', align: 'right' },
        } as never
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'art-isometric',
    category: 'art',
    name: 'Isometric stack',
    blurb: 'A little machine room drawn in projection — three hundred rotated shapes pretending to be 3D.',
    teaches: ['Rotation', 'Layering', 'Projection'],
    objectCount: 120,
    build: (limit) => {
      /**
       * Isometric drawing from flat shapes, which is a genuinely good trick
       * and a real test of the transform stack: every tile is one rectangle,
       * rotated 30° and squashed, and the illusion holds only if rotation,
       * scale and z-order all agree. They do, and you can drag any single tile
       * out of the stack to prove it.
       *
       * The projection is the standard one — x goes right-and-down, y goes
       * left-and-down, z goes straight up — so a tile's screen position is a
       * plain linear combination of its grid coordinates.
       */
      const COUNT = Math.min(300, limit ?? 300);
      const nodes: NewNodeInput[] = [];
      const random = rng(4242);

      const TILE = 96;
      const project = (gx: number, gy: number, gz: number) => ({
        x: (gx - gy) * TILE * 0.86,
        y: (gx + gy) * TILE * 0.5 - gz * TILE * 0.62,
      });

      type Tile = { gx: number; gy: number; gz: number; color: string; kind: string };
      const tiles: Tile[] = [];

      const GRID = 9;
      for (let gx = 0; gx < GRID; gx += 1) {
        for (let gy = 0; gy < GRID; gy += 1) {
          // The floor, always.
          tiles.push({ gx, gy, gz: 0, color: (gx + gy) % 2 ? '#E7E5E4' : '#D6D3D1', kind: 'rect' });

          // Towers of varying height, clustered rather than uniform.
          const edge = gx === 0 || gy === 0 || gx === GRID - 1 || gy === GRID - 1;
          const height = edge ? 0 : Math.floor(random() * random() * 7);
          for (let gz = 1; gz <= height; gz += 1) {
            const t = (gx * 7 + gy * 13 + gz * 3) / 120;
            tiles.push({
              gx,
              gy,
              gz,
              color: hue(t, 46, 58 - gz * 2),
              kind: gz === height && random() > 0.7 ? 'cylinder' : 'rect',
            });
          }
        }
      }

      // Painter's algorithm: far tiles first, so near ones overlap them.
      tiles.sort((a, b) => a.gx + a.gy - (b.gx + b.gy) || a.gz - b.gz);

      for (const tile of tiles.slice(0, COUNT)) {
        const p = project(tile.gx, tile.gy, tile.gz);
        nodes.push({
          id: nanoid(),
          type: 'shape',
          x: p.x,
          y: p.y,
          width: TILE,
          height: TILE,
          rotation: 45,
          scaleX: 1,
          scaleY: 0.58,
          geometry: { kind: tile.kind },
          appearance: {
            fill: [{ type: 'solid', color: tile.color }],
            stroke: { color: 'rgba(28,25,23,0.22)', width: 1 },
            cornerRadius: 4,
          },
        } as never);
      }

      nodes.push(
        title(-560, -520, 'Isometric stack'),
        caption(-560, -456, 'One rectangle each, rotated 45° and squashed to 58%. Drag any tile straight out of the stack.', 520)
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'art-notes',
    category: 'art',
    name: 'Ideas, unsorted',
    blurb: 'Forty sticky notes in eight colours, scattered the way a real wall looks before anyone tidies it.',
    teaches: ['Sticky notes', 'Rotation', 'Colour'],
    objectCount: 42,
    build: (limit) => {
      /**
       * Every other sticky board in this gallery is tidy, because every other
       * one is about a method. This one is about the medium: a wall covered in
       * paper, slightly crooked, in every colour the tool has, which is what
       * the end of a real workshop actually looks like and what nobody ever
       * puts in a template.
       */
      const COUNT = Math.min(40, limit ?? 40);
      const random = rng(771103);
      const THEMES = ['yellow', 'mint', 'sky', 'pink', 'lavender', 'peach', 'white'] as const;
      const IDEAS = [
        'What if the board could explain itself?',
        'Cursor chat',
        'Stickies that know they are duplicates',
        'A board that fits in a tweet',
        'Undo, but for a whole meeting',
        'Paste a spreadsheet, get a chart',
        'Voice notes pinned to a corner',
        'Show me only what changed',
        'A timer that nobody has to run',
        'Templates that learn from your last board',
        'Snap to nothing. Ever.',
        'Let two people drag the same thing',
        'An export that still looks like this',
        'Search inside the drawings',
        'A quiet mode for one person thinking',
        'Comments that resolve themselves',
        'Boards that archive politely',
        'What is the smallest useful board?',
        'Colour by author, on a key press',
        'Make the empty state do the teaching',
      ];

      const nodes: NewNodeInput[] = [
        title(0, -180, 'Ideas, unsorted'),
        caption(0, -116, 'Forty notes, eight colours, nobody has tidied them yet. This is the honest state of a wall.', 820),
      ];

      // The wall is bigger than the note count needs, because a scatter that
      // only just fits is a scatter that ends up in a grid.
      const NOTE = 210;
      const placed = scatter(COUNT, { w: 2400, h: 1500 }, null, 771103, 26, { min: NOTE, max: NOTE });
      placed.forEach((p, i) => {
        nodes.push(
          sticky(p.x, p.y, IDEAS[i % IDEAS.length], THEMES[Math.floor(random() * THEMES.length)], {
            width: NOTE,
            height: NOTE,
            rotation: (random() - 0.5) * 9,
          })
        );
      });

      return layer(nodes);
    },
  },
];
