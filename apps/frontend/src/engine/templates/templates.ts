import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../document/mutations';
import type { AnyNode, StickyTheme } from '../model/schema';
import { buildPreview, MAX_ITEMS_RICH, type BoardPreview } from '../model/boardPreview';
import { previewColorOf, previewPointsOf } from '../model/previewPaint';

/**
 * Boards that already have something on them.
 *
 * ## Why templates and not a tour
 *
 * An empty canvas is the hardest screen in the product. It asks you to know
 * what the tool is for before you have used it, and every explanation of a
 * canvas app — this one included — has to compete with the fact that there is
 * nothing to look at. A board that arrives with work on it inverts that: the
 * features are visible as *results*, and the fastest way to find out what a
 * connector does is to drag the box it is attached to.
 *
 * These are not read-only demos. Each one opens as an ordinary room that
 * happens to start full, so the first thing anyone does is edit it — which is
 * the thing a tour can only describe.
 *
 * ## Why they are built in code
 *
 * The obvious alternative is to ship each template as a JSON export and pour
 * it in through the importer, which already exists and is tested. It was
 * tempting for exactly that reason. But a stored blob is invisible to the type
 * checker: rename a field on the schema and every template silently becomes a
 * board full of malformed nodes, discovered by someone opening one. Built from
 * `NewNodeInput`, the same rename fails the build.
 *
 * They also stay legible. A JSON dump of forty nodes is not something anyone
 * will edit later; a function that lays out a grid of notes is.
 */

/**
 * What kind of thing a template is.
 *
 * Grouped by the *job* rather than by the tools involved. Someone arriving
 * knows they want a flowchart or a social post; almost nobody arrives wanting
 * "connectors and frames". A row of thirteen ungrouped cards is also a row
 * nobody reads to the end.
 */
export type TemplateCategory = 'diagrams' | 'thinking' | 'design' | 'art' | 'physics';

export const CATEGORIES: Array<{ id: TemplateCategory; label: string }> = [
  { id: 'diagrams', label: 'Charts & flows' },
  { id: 'design', label: 'Web & social' },
  { id: 'thinking', label: 'Thinking' },
  { id: 'art', label: 'Illustration' },
  { id: 'physics', label: 'Physics' },
];

export interface Template {
  id: string;
  category: TemplateCategory;
  name: string;
  /** One line, on the card. Says what the board is *for*, not what it contains. */
  blurb: string;
  /** What someone will learn by poking it, shown as small chips. */
  teaches: string[];
  /**
   * Roughly how many objects it builds, when that is the point.
   *
   * Only the showcase boards carry it. "500 objects" is a claim about the
   * engine, and a claim like that belongs on the card where it can be checked
   * by opening the thing — not in a marketing line nobody can verify.
   */
  objectCount?: number;
  /**
   * Shown large, at the head of the gallery.
   *
   * Thirteen cards at one size is a wall, and a wall has no first thing to
   * look at. These three are the boards that make a claim about the engine
   * rather than about a workflow — a thousand objects, five hundred, three
   * hundred and sixty — so they are the ones worth the room. Everything else
   * is a starting point for work, which is a different promise and reads
   * fine at grid size.
   *
   * Deliberately three, and deliberately not a `rank` field: the moment this
   * becomes an ordering it becomes something to maintain.
   */
  featured?: true;
  /**
   * Built fresh each time, so two people opening one never share ids.
   *
   * `limit` is a *hint*, honoured by the boards that generate hundreds of
   * objects. The thumbnail needs a recognisable silhouette, not the whole
   * board — and `buildPreview` keeps only its busiest few dozen items anyway,
   * so generating a thousand nodes to draw forty-eight was a page that froze
   * on load for pictures that discarded 95% of the work.
   */
  build: (limit?: number) => NewNodeInput[];
}

/** Shorthand builders, so the layouts below read as layout and not as plumbing. */
const sticky = (x: number, y: number, text: string, theme: StickyTheme = 'yellow'): NewNodeInput => ({
  id: nanoid(),
  type: 'sticky',
  x,
  y,
  width: 180,
  height: 180,
  text,
  theme,
  fontSize: 16,
  reactions: {},
  tags: [],
  pinned: false,
});

const box = (
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  fill: string,
  extra: Record<string, unknown> = {}
): NewNodeInput => ({
  id: nanoid(),
  type: 'shape',
  x,
  y,
  width,
  height,
  geometry: { kind: 'rect' },
  appearance: { fill: [{ type: 'solid', color: fill }], cornerRadius: 10 },
  text,
  /**
   * Ink, explicitly.
   *
   * A shape's text defaults to white, which is right for the saturated fills
   * the shape tool produces and wrong for every fill used here — these are
   * deliberately pale so the labels carry the meaning, and white on pale blue
   * is a label nobody can read. The first build of these templates shipped
   * exactly that.
   */
  typography: { fontSize: 18, fontWeight: 600, color: '#1F2937', align: 'center', verticalAlign: 'middle' },
  ...extra,
});

const label = (x: number, y: number, text: string, fontSize = 28): NewNodeInput => ({
  id: nanoid(),
  type: 'text',
  x,
  y,
  width: 320,
  height: fontSize * 1.6,
  text,
  resize: 'width',
  typography: { fontSize, fontWeight: 700, color: '#161616' },
});

const frame = (x: number, y: number, width: number, height: number, title: string): NewNodeInput => ({
  id: nanoid(),
  type: 'frame',
  x,
  y,
  width,
  height,
  title,
});

const link = (
  fromId: string,
  toId: string,
  extra: Record<string, unknown> = {}
): NewNodeInput => ({
  id: nanoid(),
  type: 'connector',
  // Derived from the route on the first render; these only seed the box.
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  from: { nodeId: fromId, port: 'auto' },
  to: { nodeId: toId, port: 'auto' },
  routing: 'orthogonal',
  endEnd: 'arrow',
  appearance: { stroke: { color: '#64748B', width: 2, cap: 'round' } },
  ...extra,
});

/**
 * A ring of hues, evenly spaced.
 *
 * HSL rather than a fixed palette: the showcase boards need hundreds of
 * colours that stay related, and interpolating a list of eight would give
 * banding exactly where the eye is most likely to look for structure.
 */
const hue = (t: number, saturation = 68, lightness = 62): string =>
  `hsl(${Math.round(((t % 1) + 1) % 1 * 360)}, ${saturation}%, ${lightness}%)`;

export const TEMPLATES: Template[] = [
  {
    id: 'bloom',
    featured: true,
    category: 'physics',
    name: 'Bloom',
    blurb: 'Five hundred shapes on a phyllotaxis spiral. Built to exercise the force tools.',
    teaches: ['Forces', 'Radar', 'Physics'],
    objectCount: 500,
    build: (limit) => {
      /**
       * Phyllotaxis — the arrangement a sunflower uses.
       *
       * Each seed sits one golden angle round from the last, which is the one
       * rotation that never repeats and so never leaves gaps or spokes. It is
       * the cheapest way to put five hundred objects on a board and have the
       * result look composed rather than scattered, and it gives the physics
       * tools something genuinely satisfying to disturb.
       */
      const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
      const FULL = 500;
      const COUNT = Math.min(FULL, limit ?? FULL);
      /**
       * Constant extent when trimmed.
       *
       * A phyllotaxis disc's radius grows as sqrt(i), so drawing 90 seeds
       * instead of 500 gave a disc 42% of the width — which is what the
       * gallery asked for when it capped the node count. The card then showed
       * a small cluster marooned under two full-size labels: a composition
       * that appears nowhere except on the card, on the board whose whole
       * claim is five hundred objects.
       *
       * Spreading the survivors over the full radius keeps the silhouette the
       * board actually has, at lower resolution — which is what a thumbnail
       * is for. `spectrum` was the only showcase that already looked right on
       * its card, and this is the only thing it was doing differently.
       */
      const spread = Math.sqrt(FULL / COUNT);

      /**
       * The titles clear the flower, rather than landing on it.
       *
       * They sat at y = -420 and -360 while the disc reaches y = -358, so the
       * subtitle was drawn *inside* the bloom — overlapped by a hundred
       * petals, unreadable, and looking like a layering bug rather than a
       * caption. The disc's radius is known here, so the labels are placed
       * from it instead of from a number typed once and never rechecked.
       */
      const REACH = 16 * Math.sqrt(FULL) * 1.02;
      const nodes: NewNodeInput[] = [
        label(-160, -REACH - 150, 'Bloom', 44),
        label(-160, -REACH - 92, 'Five hundred objects, one golden angle apart.', 18),
      ];

      for (let i = 0; i < COUNT; i += 1) {
        const t = i / COUNT;
        const radius = 16 * Math.sqrt(i) * spread;
        const angle = i * GOLDEN_ANGLE;
        // Size falls off toward the rim, so the eye reads depth rather than a
        // flat disc of identical dots.
        const size = (26 - t * 12) * spread;
        /**
         * Round at the heart, petalled at the rim.
         *
         * A phyllotaxis of circles reads as a texture; the same arrangement
         * of ellipses elongated along the radius reads as a flower. But
         * elongating *every* seed ruins the middle: near the origin the
         * radius approaches zero, so a hundred stretched petals pile through
         * each other pointing in every direction, and the centre — the one
         * part of a seed head the eye actually lands on — becomes a scribble.
         *
         * A real sunflower does not do that either. Its centre is a dense
         * disc of round florets that only lengthen into petals further out.
         * So the elongation is ramped by radius rather than applied flat.
         *
         * The ramp runs most of the way to the rim (0.72 of it) rather than
         * over the first third, which was the first attempt and was not
         * enough: because radius grows as sqrt(i), a third of the *radius* is
         * only the innermost tenth of the *seeds*, so the round heart was a
         * dozen florets nobody could see. Ramping over most of the radius
         * leaves a genuine disc at the centre and keeps the petals for the
         * outer ring, which is where they read.
         */
        const petal = Math.min(1, radius / (REACH * 0.72));
        const w = size * (1 - 0.20 * petal);
        const h = size * (1 + 0.30 * petal);
        nodes.push({
          id: nanoid(),
          type: 'shape',
          x: Math.cos(angle) * radius - w / 2,
          y: Math.sin(angle) * radius - h / 2,
          width: w,
          height: h,
          // Facing outward, so the whole head turns with the spiral. Harmless
          // at the centre, where the shape is round and rotation is a no-op.
          rotation: (angle * 180) / Math.PI + 90,
          geometry: { kind: 'ellipse' },
          appearance: { fill: [{ type: 'solid', color: hue(t * 0.85 + 0.05) }] },
        });
      }
      return nodes;
    },
  },
  {
    id: 'field',
    category: 'physics',
    name: 'Wave field',
    blurb: 'One thousand tiles on a sine surface. Demonstrates rendering and culling at scale.',
    teaches: ['Culling', 'Zoom', 'Performance'],
    objectCount: 1000,
    build: (limit) => {
      // Kept proportional when trimmed, so the thumbnail is the same surface
      // at lower resolution rather than a corner of it.
      const shrink = limit ? Math.sqrt(Math.min(1, limit / 1000)) : 1;
      const COLS = Math.max(6, Math.round(40 * shrink));
      const ROWS = Math.max(4, Math.round(25 * shrink));
      /**
       * The step grows as the grid thins, so the surface covers the same area
       * whether it is 40x25 or 12x8. Trimming the count alone shrank the
       * field to a third of its width and cropped the interference pattern
       * down to a plain blue rectangle — the one thing the board exists to
       * show, absent from its own card.
       */
      const STEP = 46 / shrink;
      const nodes: NewNodeInput[] = [
        label(0, -140, 'Wave field', 44),
        label(0, -80, 'One thousand objects. Only what is in view is drawn.', 18),
      ];

      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          // Two sine waves at right angles: the interference is what turns a
          // grid into a surface with hills in it.
          const wave = Math.sin(col / 5) * Math.cos(row / 4);
          const size = (20 + (wave + 1) * 9) / shrink;
          nodes.push({
            id: nanoid(),
            type: 'shape',
            x: col * STEP + (STEP - size) / 2,
            y: row * STEP + (STEP - size) / 2 + (wave * 14) / shrink,
            width: size,
            height: size,
            rotation: wave * 40,
            geometry: { kind: 'rect' },
            appearance: {
              fill: [{ type: 'solid', color: hue(0.55 + wave * 0.12, 70, 50 + wave * 16) }],
              cornerRadius: 4,
            },
          });
        }
      }
      return nodes;
    },
  },
  {
    id: 'org',
    category: 'diagrams',
    name: 'Org chart',
    blurb: 'A small company, four disciplines deep, wired throughout with 68 live connectors.',
    teaches: ['Connectors at scale', 'Layout'],
    objectCount: 137,
    build: (limit) => {
      /**
       * Deep rather than wide, and staffed rather than numbered.
       *
       * Two things were wrong with it. The last tier was thirty-two boxes on
       * one row, which made the board 6000px across and barely 1000 tall — a
       * 6:1 letterbox that shrank to a smear in any frame with a normal
       * aspect, its own card included. Real org charts do not solve that by
       * getting wider: they stack the people vertically under the team that
       * owns them, which is what the bottom tier does here and why it costs no
       * width at all.
       *
       * The other was that every box read "Team 2.1" and every person "3.4".
       * A chart of placeholders demonstrates the *shape* of an org chart and
       * nothing about reading one — you cannot tell at a glance which branch
       * is engineering, so the colour coding and the depth carry no meaning
       * and there is nothing to recognise. It is a small company now, with
       * disciplines you can tell apart.
       */
      type Person = string;
      interface Team { name: string; people: Person[] }
      interface Fn { name: string; tint: string; teams: Team[] }

      const ORG: Fn[] = [
        {
          name: 'Engineering', tint: '#DBEAFE',
          teams: [
            { name: 'Platform', people: ['Ada', 'Ravi', 'Mei', 'Tom', 'Iris', 'Kojo', 'Lena'] },
            { name: 'Client', people: ['Sam', 'Priya', 'Noor', 'Eli', 'Dana', 'Hugo', 'Maya'] },
          ],
        },
        {
          name: 'Design', tint: '#FBD2E1',
          teams: [
            { name: 'Product design', people: ['Jo', 'Amara', 'Finn', 'Zara', 'Otto', 'Lila', 'Bo'] },
            { name: 'Brand', people: ['Rey', 'Ines', 'Kai', 'Nia', 'Pip', 'Sol', 'Vik'] },
          ],
        },
        {
          name: 'Product', tint: '#DCFCE7',
          teams: [
            { name: 'Growth', people: ['Ana', 'Theo', 'Suri', 'Cleo', 'Marc', 'Yuki', 'Rosa'] },
            { name: 'Core', people: ['Ivo', 'Nell', 'Omar', 'Tess', 'Gus', 'Sena', 'Ada B.'] },
          ],
        },
        {
          name: 'Operations', tint: '#FEF3C7',
          teams: [
            { name: 'People', people: ['Rune', 'Asha', 'Milo', 'Wren', 'Jonas', 'Efe', 'Tara'] },
            { name: 'Finance', people: ['Cass', 'Deniz', 'Rui', 'Alba', 'Nils', 'Sena B.', 'Ove'] },
          ],
        },
      ];

      const TEAM_W = 190;
      const TEAM_GAP = 46;
      const TIER_H = 250;
      const PERSON_H = 44;
      const PERSON_GAP = 10;

      const teams = ORG.flatMap((fn) => fn.teams.map((team) => ({ ...team, fn })));
      const boardW = teams.length * TEAM_W + (teams.length - 1) * TEAM_GAP;
      const teamX = (i: number) => -boardW / 2 + i * (TEAM_W + TEAM_GAP);

      /**
       * Boxes and lines are collected separately so the lines can go to the
       * back.
       *
       * Creation order is z-order, and building the tree naturally interleaves
       * them — box, its link, box, its link — so every connector ended up
       * drawn *over* the boxes created before it. On a chart this dense that
       * reads as wires lying across the labels. Returning all the connectors
       * first puts the whole harness behind the whole tree, which is where a
       * reader expects it and how every org chart is drawn.
       */
      const boxes: NewNodeInput[] = [];
      const links: NewNodeInput[] = [];
      const labels: NewNodeInput[] = [
        label(-boardW / 2, -TIER_H - 190, 'Who does what', 44),
        label(-boardW / 2, -TIER_H - 136, 'Drag any box. Every line beneath it re-solves as it moves.', 17),
      ];

      // ---- the root ------------------------------------------------------
      const root = box(-130, -TIER_H * 2, 260, 96, 'Chief Executive', '#E0E7FF', {
        typography: { fontSize: 20, fontWeight: 700, color: '#1F2937', align: 'center', verticalAlign: 'middle' },
      });
      boxes.push(root);

      // ---- the functions -------------------------------------------------
      // Centred over the pair of teams each one owns, so a branch is a shape
      // you can follow rather than a line you have to trace.
      const fnNodes = ORG.map((fn, f) => {
        const left = teamX(f * 2);
        const right = teamX(f * 2 + 1) + TEAM_W;
        const node = box(
          (left + right) / 2 - 110, -TIER_H, 220, 78, fn.name, fn.tint,
          { typography: { fontSize: 18, fontWeight: 700, color: '#1F2937', align: 'center', verticalAlign: 'middle' } }
        );
        boxes.push(node);
        links.push(link(root.id as string, node.id as string, { endEnd: 'none' }));
        return node;
      });

      // ---- the teams, and the people under each --------------------------
      const withPeople = !limit || limit >= 120;
      teams.forEach((team, t) => {
        const x = teamX(t);
        const teamNode = box(x, 0, TEAM_W, 70, team.name, team.fn.tint, {
          typography: { fontSize: 16, fontWeight: 600, color: '#1F2937', align: 'center', verticalAlign: 'middle' },
        });
        boxes.push(teamNode);
        links.push(link(fnNodes[Math.floor(t / 2)].id as string, teamNode.id as string, { endEnd: 'none' }));

        if (!withPeople) return;
        team.people.forEach((person, k) => {
          const personNode = box(
            x + 20, 118 + k * (PERSON_H + PERSON_GAP), TEAM_W - 40, PERSON_H, person, '#F8FAFC',
            { typography: { fontSize: 15, fontWeight: 500, color: '#334155', align: 'center', verticalAlign: 'middle' } }
          );
          boxes.push(personNode);
          links.push(link(teamNode.id as string, personNode.id as string, { endEnd: 'none' }));
        });
      });

      // Wires first, then the tree, then the titles on top.
      return [...links, ...boxes, ...labels];
    },
  },
  {
    id: 'landing',
    category: 'design',
    name: 'Landing page',
    blurb: 'A composed desktop page at 1440: nav, split hero, feature row, footer.',
    teaches: ['Frames', 'Layout', 'Export'],
    objectCount: 74,
    build: () => {
      /**
       * A wireframe that is actually laid out.
       *
       * The previous version was seven grey rectangles stacked down a frame —
       * technically a page, and useful for nothing: there was no hierarchy to
       * learn from, no colour, and the "feature" row was three identical
       * blocks with a caption dropped on top. A template is a starting point,
       * and a starting point made of undifferentiated grey boxes leaves the
       * person who opened it with all of the work still to do.
       *
       * This one is composed: a real navigation bar, a hero with a primary
       * and a secondary action, an asymmetric split so the eye has somewhere
       * to go, three feature cards that each carry a mark, a call-to-action
       * band, and a footer with columns. Every measurement is a real one at
       * 1440, so exporting the frame produces a usable comp.
       */
      const PAGE = 1440;
      const M = 80;                    // page margin
      const COL = PAGE - M * 2;        // content width

      const INK = '#0F172A';
      const MUTED = '#94A3B8';
      const LINE = '#E2E8F0';
      const CARD = '#F8FAFC';

      /** A plain filled block — the wireframe's stand-in for a picture. */
      const plate = (x: number, y: number, w: number, h: number, c: string, r = 16): NewNodeInput =>
        box(x, y, w, h, '', c, { appearance: { fill: [{ type: 'solid', color: c }], cornerRadius: r } });

      /** A grey bar standing in for a line of body copy. */
      const rule = (x: number, y: number, w: number, c = LINE): NewNodeInput =>
        plate(x, y, w, 12, c, 6);

      const button = (x: number, y: number, w: number, text: string, fill: string, ink: string): NewNodeInput =>
        box(x, y, w, 56, text, fill, {
          appearance: { fill: [{ type: 'solid', color: fill }], cornerRadius: 28 },
          typography: { fontSize: 17, fontWeight: 600, color: ink, align: 'center', verticalAlign: 'middle' },
        });

      const nodes: NewNodeInput[] = [
        // A frame at a real screen size, so "export this" produces a real asset.
        frame(0, 0, PAGE, 1980, 'Desktop 1440'),

        // ---- navigation ------------------------------------------------
        plate(0, 0, PAGE, 88, '#FFFFFF', 0),
        plate(M, 28, 32, 32, '#F3A024', 10),
        rule(M + 46, 38, 84, INK),
        rule(PAGE - M - 470, 40, 70, MUTED),
        rule(PAGE - M - 370, 40, 62, MUTED),
        rule(PAGE - M - 280, 40, 78, MUTED),
        button(PAGE - M - 160, 16, 160, 'Sign up', INK, '#FFFFFF'),
        plate(0, 88, PAGE, 1, LINE, 0),

        // ---- hero: text left, picture right ----------------------------
        label(M, 190, 'Build it together,', 62),
        label(M, 268, 'in one place.', 62),
        label(M, 380, 'One sentence that says what this does and who it is for,', 21),
        label(M, 414, 'without saying "seamless" or "leverage".', 21),
        button(M, 480, 190, 'Get started', '#F3A024', '#161616'),
        button(M + 210, 480, 170, 'See a demo', '#FFFFFF', INK),

        // The asymmetric half. A hero split down the middle reads as a table;
        // 40/60 gives the headline room and still leaves the image dominant.
        plate(700, 170, 660, 440, '#EEF2FF'),
        plate(740, 210, 340, 180, '#C7D2FE'),
        plate(740, 410, 160, 160, '#A5B4FC'),
        plate(920, 410, 160, 160, '#DDD6FE'),
        plate(1100, 210, 220, 360, '#E0E7FF'),

        // ---- features ---------------------------------------------------
        label(M, 720, 'Three things it does well', 38),
        rule(M, 792, 380, MUTED),
      ];

      // Cards, each with its own mark — so the row reads as three things
      // rather than as three copies of one thing.
      const CARD_W = (COL - 40 * 2) / 3;
      const MARKS = ['#F3A024', '#10B981', '#6366F1'];
      [0, 1, 2].forEach((i) => {
        const x = M + i * (CARD_W + 40);
        nodes.push(plate(x, 860, CARD_W, 320, CARD));
        nodes.push(plate(x + 32, 892, 48, 48, MARKS[i], 14));
        nodes.push(label(x + 32, 970, `Feature ${i + 1}`, 24));
        nodes.push(rule(x + 32, 1030, CARD_W - 64));
        nodes.push(rule(x + 32, 1058, CARD_W - 100));
        nodes.push(rule(x + 32, 1086, CARD_W - 140));
      });

      nodes.push(
        // ---- call to action band ---------------------------------------
        plate(M, 1260, COL, 280, INK, 24),
        label(M + 60, 1330, 'Ready when you are.', 40),
        label(M + 60, 1400, 'One line about starting, with no pricing invented.', 20),
        button(PAGE - M - 260, 1360, 200, 'Start free', '#F3A024', '#161616'),

        // ---- footer ------------------------------------------------------
        plate(0, 1620, PAGE, 1, LINE, 0),
        plate(M, 1680, 32, 32, '#F3A024', 10),
        rule(M + 46, 1690, 84, INK),
        rule(M, 1760, 210, MUTED),
      );

      // Four footer columns of links, which is the shape a real footer has.
      [0, 1, 2, 3].forEach((c) => {
        const x = 700 + c * 170;
        nodes.push(rule(x, 1682, 74, INK));
        [0, 1, 2].forEach((r) => nodes.push(rule(x, 1722 + r * 26, 96, MUTED)));
      });

      return nodes;
    },
  },
  {
    id: 'social',
    category: 'design',
    name: 'Social kit',
    blurb: 'Square post, story and banner at their true dimensions, ready to batch export.',
    teaches: ['Frame presets', 'Batch export', 'Multi-format'],
    build: () => [
      /**
       * Packed, not queued.
       *
       * The three frames used to sit in a single row — 1080, 1080 and 1500
       * wide against heights of 1080, 1920 and 500 — so the board was nearly
       * 4000px across with two-thirds of it empty air under the short ones.
       * The tall story frame anchors a left column now and the two landscape
       * formats stack beside it, which costs nothing, loses no fidelity, and
       * turns a 2:1 letterbox into something close to square.
       */
      // Clear of the tallest frame's own name, which is drawn eighteen screen
      // pixels above its top edge — about eighty-eight world units at the zoom
      // this board fits to. The subtitle used to sit inside that band.
      label(0, -240, 'One idea, three formats', 36),
      label(0, -180, 'True pixel dimensions, so what you draw is what gets posted.', 17),

      // The tall one anchors the left column at full height.
      frame(0, 0, 1080, 1920, 'Story 1080 x 1920'),
      box(90, 760, 900, 260, 'Your headline', '#BFDBFE', {
        typography: { fontSize: 64, fontWeight: 700, color: '#161616', align: 'center', verticalAlign: 'middle' },
      }),
      box(90, 1060, 900, 96, 'A supporting line', '#FFFFFF', {
        typography: { fontSize: 28, fontWeight: 500, color: '#475569', align: 'center', verticalAlign: 'middle' },
      }),

      // The two landscape formats stack against it, bottom-aligned to the
      // same baseline so the three read as one set rather than three offcuts.
      frame(1180, 0, 1080, 1080, 'Square post 1080'),
      box(1270, 320, 900, 220, 'Your headline', '#FDE68A', {
        typography: { fontSize: 64, fontWeight: 700, color: '#161616', align: 'center', verticalAlign: 'middle' },
      }),
      box(1270, 590, 900, 96, 'A supporting line', '#FFFFFF', {
        typography: { fontSize: 28, fontWeight: 500, color: '#475569', align: 'center', verticalAlign: 'middle' },
      }),

      frame(1180, 1180, 1500, 500, 'Banner 1500 x 500'),
      box(1260, 1350, 1340, 160, 'Your headline', '#FBCFE8', {
        typography: { fontSize: 56, fontWeight: 700, color: '#161616', align: 'center', verticalAlign: 'middle' },
      }),
    ],
  },
  {
    id: 'barchart',
    category: 'diagrams',
    name: 'Bar chart',
    blurb: 'A bar chart made of ordinary shapes, so every bar is directly editable.',
    teaches: ['Shapes as data', 'Alignment', 'Text'],
    build: () => {
      const data: Array<[string, number]> = [
        ['Mon', 120], ['Tue', 210], ['Wed', 170], ['Thu', 260],
        ['Fri', 300], ['Sat', 90], ['Sun', 140],
      ];
      const BASE = 520;
      const BAR = 88;
      const GAP = 34;

      return [
        label(0, -140, 'Visits this week', 38),
        // The axis is a shape like everything else, which is the point: this
        // chart is not a widget, it is objects you can grab.
        box(-20, BASE, data.length * (BAR + GAP) + 20, 3, '', '#CBD5E1'),
        ...data.flatMap(([day, value], i) => {
          const x = i * (BAR + GAP);
          return [
            box(x, BASE - value, BAR, value, '', hue(0.55 + i * 0.02, 65, 62)),
            { ...label(x, BASE + 20, day, 18), width: BAR },
            { ...label(x, BASE - value - 36, String(value), 16), width: BAR },
          ];
        }),
      ];
    },
  },
  {
    id: 'spectrum',
    featured: true,
    category: 'art',
    name: 'Spectrum',
    blurb: 'A colour wheel of 360 rotated wedges.',
    teaches: ['Colour', 'Rotation', 'Generative'],
    objectCount: 360,
    build: (limit) => {
      const COUNT = Math.min(360, limit ?? 360);
      const RADIUS = 380;
      const nodes: NewNodeInput[] = [];
      for (let i = 0; i < COUNT; i += 1) {
        const t = i / COUNT;
        const angle = t * Math.PI * 2;
        // Each wedge is a thin bar pointing outward, rotated into place — the
        // simplest primitive that composes into something which does not read
        // as a grid of squares.
        nodes.push({
          id: nanoid(),
          type: 'shape',
          x: Math.cos(angle) * RADIUS - 8,
          y: Math.sin(angle) * RADIUS - 60,
          width: 16,
          height: 120,
          rotation: (angle * 180) / Math.PI + 90,
          geometry: { kind: 'rect' },
          appearance: { fill: [{ type: 'solid', color: hue(t, 78, 58) }], cornerRadius: 8 },
        });
      }
      return nodes;
    },
  },
  {
    id: 'domino',
    category: 'physics',
    name: 'Domino wall',
    blurb: 'Two hundred tiles in staggered courses, for testing shockwave and throws.',
    teaches: ['Shockwave', 'Throws', 'Materials'],
    objectCount: 200,
    build: (limit) => {
      const COLS = 20;
      const FULL_ROWS = 10;
      const ROWS = Math.min(FULL_ROWS, limit ? Math.max(2, Math.floor(limit / COLS)) : FULL_ROWS);
      /**
       * Courses get taller as the wall loses rows, so a trimmed wall is still
       * a wall rather than the top two courses of one floating in an empty
       * card. Width is untouched: the column count never changes.
       */
      const W = 78;
      const H = 44 * (FULL_ROWS / ROWS);
      const nodes: NewNodeInput[] = [
        label(0, -150, 'Domino wall', 40),
        label(0, -94, 'Forces → Shockwave, then click near the wall.', 18),
      ];
      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          // Alternate rows are offset, like real brickwork. A straight grid
          // collapses in columns and reads as a spreadsheet falling over.
          const stagger = row % 2 ? W / 2 : 0;
          nodes.push(box(col * (W + 6) + stagger, row * (H + 6), W, H, '', hue(0.06 + row * 0.02, 55, 62 - row * 2)));
        }
      }
      return nodes;
    },
  },
  {
    id: 'mindmap',
    category: 'diagrams',
    name: 'Mind map',
    blurb: 'A radial map with curved connectors from a central node.',
    teaches: ['Radial layout', 'Curved routing', 'Connectors'],
    build: () => {
      const centre = box(-110, -45, 220, 90, 'Big idea', '#FDE68A');
      const branches = ['Research', 'Design', 'Build', 'Launch', 'Measure', 'Iterate'];
      const tints = ['#DBEAFE', '#DCFCE7', '#FBD2E1', '#DDD5F8', '#FDDBBF', '#C3E1FA'];
      const nodes: NewNodeInput[] = [centre];

      branches.forEach((name, i) => {
        const angle = (i / branches.length) * Math.PI * 2 - Math.PI / 2;
        const node = box(Math.cos(angle) * 430 - 85, Math.sin(angle) * 330 - 35, 170, 70, name, tints[i]);
        nodes.push(node);
        // Curved: a radial diagram drawn with right angles reads as a circuit
        // board rather than as branches.
        nodes.push(link(centre.id as string, node.id as string, { routing: 'curved', endEnd: 'circle' }));
      });
      return nodes;
    },
  },
  {
    id: 'flowchart',
    category: 'diagrams',
    name: 'Flowchart',
    blurb: 'A real process, with the two loops back that make routing hard.',
    teaches: ['Decision shapes', 'Loop-backs', 'Routing'],
    build: () => {
      /**
       * A flowchart with somewhere to go backwards.
       *
       * The previous version was five boxes and one decision, all flowing
       * down the page — which is the easy case for a connector system and
       * therefore demonstrates nothing. Every arrow went the way arrows
       * already want to go.
       *
       * Real processes loop. "Changes requested" sends you back up to the
       * step you just left, and a route that has to leave a box, climb past
       * two other boxes and re-enter one above it is the case orthogonal
       * routing exists for. There are two of those here, and they are the
       * only reason this board is worth opening.
       *
       * The shapes carry meaning too, which the old one did not do: a
       * terminator is a pill, a decision is a diamond, a step is a rectangle.
       * That is the convention every flowchart reader already knows, and it
       * costs one geometry field.
       */
      const term = (x: number, y: number, text: string, fill: string) =>
        box(x, y, 190, 66, text, fill, { appearance: { fill: [{ type: 'solid', color: fill }], cornerRadius: 33 } });

      const decide = (x: number, y: number, text: string) =>
        box(x, y, 230, 170, text, '#FEF3C7', {
          geometry: { kind: 'polygon', points: 4 },
          typography: { fontSize: 15, fontWeight: 600, color: '#1F2937', align: 'center', verticalAlign: 'middle' },
        });

      const COL = 420;

      const start  = term(COL + 20, 0, 'Idea', '#E0E7FF');
      const draft  = box(COL, 130, 230, 84, 'Write the spec', '#DBEAFE');
      const review = decide(COL, 274, 'Signed off?');
      const build  = box(COL, 500, 230, 84, 'Build it', '#DCFCE7');
      const tests  = decide(COL, 634, 'Tests pass?');
      const fix    = box(COL + 330, 634, 210, 84, 'Fix it', '#FEE2E2');
      const ship   = box(COL, 860, 230, 84, 'Ship it', '#DBEAFE');
      const done   = term(COL + 20, 994, 'Done', '#E0E7FF');
      const park   = box(COL - 340, 274, 210, 84, 'Park it', '#F1F5F9');

      return [
        label(COL - 360, -140, 'Flowchart', 44),
        label(COL - 360, -86, 'Two of these arrows travel back up the page. Drag a box and watch them solve.', 17),

        start, draft, review, build, tests, fix, ship, done, park,

        link(start.id as string, draft.id as string),
        link(draft.id as string, review.id as string),

        // Labelled, because the branches out of a decision are the one place
        // an unlabelled arrow genuinely loses information.
        link(review.id as string, build.id as string, { label: 'yes' }),
        link(review.id as string, park.id as string, { label: 'no' }),

        link(build.id as string, tests.id as string),
        link(tests.id as string, ship.id as string, { label: 'yes' }),
        link(tests.id as string, fix.id as string, { label: 'no' }),

        // The loop back up. This is the route that has to climb past two
        // boxes and re-enter one above where it started.
        link(fix.id as string, build.id as string, { label: 'again' }),
        // And the second one, from the sign-off decision back to the draft.
        link(park.id as string, draft.id as string, { label: 'revise', routing: 'curved' }),

        link(ship.id as string, done.id as string),
      ];
    },
  },
  {
    id: 'brainstorm',
    category: 'thinking',
    name: 'Brainstorm',
    blurb: 'A session already running: four lanes, thirteen notes, and the votes that sorted them.',
    teaches: ['Sticky notes', 'Tags', 'Reactions'],
    build: () => {
      /**
       * A brainstorm mid-flight, not an empty one.
       *
       * The previous board was six notes in a frame and an empty one beside
       * it. That is the *setup* for a brainstorm, and the setup is the part
       * nobody needs help with — anyone can put a sticky on a canvas. What is
       * hard, and what a template can actually give you, is the shape a
       * session takes once it is running: a pile of raw ideas, the beginnings
       * of clusters, votes that have started to separate them, and a place
       * for the ones that are out of scope but should not be deleted.
       *
       * So this arrives at the middle of the exercise. The four lanes are the
       * four states an idea passes through, and the notes are already
       * distributed across them with the votes that got them there.
       */
      const LANE_W = 440;
      const LANE_GAP = 36;
      const laneX = (i: number) => i * (LANE_W + LANE_GAP);

      type Idea = [string, StickyTheme, string[], number];

      const LANES: Array<{ title: string; hint: string; ideas: Idea[] }> = [
        {
          title: 'Raw ideas',
          hint: 'No filter. Quantity first.',
          ideas: [
            ['Open a board straight from a link', 'yellow', [], 0],
            ['Undo across a whole session', 'yellow', ['big'], 1],
            ['Search inside a board', 'yellow', [], 2],
            ['Comments that resolve', 'yellow', [], 0],
          ],
        },
        {
          title: 'Clustering',
          hint: 'Same idea, said twice? Stack them.',
          ideas: [
            ['Faster first paint', 'mint', ['perf'], 3],
            ['Cull off-screen objects', 'mint', ['perf'], 2],
            ['Fewer clicks to share', 'sky', ['ux'], 4],
            ['Keyboard for everything', 'sky', ['ux', 'a11y'], 3],
          ],
        },
        {
          title: 'Voted up',
          hint: 'React to agree. The order emerges.',
          ideas: [
            ['Offline first', 'peach', ['infra'], 6],
            ['Templates that arrive full', 'peach', ['ux'], 5],
            ['Real-time cursors', 'peach', ['infra'], 4],
          ],
        },
        {
          title: 'Parked',
          hint: 'Not now. Not lost either.',
          ideas: [
            ['Plug-in API', 'white', ['later'], 1],
            ['Video on the canvas', 'white', ['later'], 0],
          ],
        },
      ];

      const nodes: NewNodeInput[] = [
        label(0, -180, 'What should we build next?', 44),
        label(0, -122, 'Double-click a note to edit it. Tab chains another one directly below.', 18),
      ];

      LANES.forEach((lane, i) => {
        const x = laneX(i);
        nodes.push(frame(x, 0, LANE_W, 1180, lane.title));
        // The lane's own instruction, inside the lane — a legend off to one
        // side is a legend nobody reads while they are working.
        nodes.push({
          id: nanoid(), type: 'text', x: x + 34, y: 54,
          width: LANE_W - 68, height: 22, text: lane.hint, resize: 'width',
          typography: { fontSize: 15, fontWeight: 500, color: '#64748B' },
        });

        lane.ideas.forEach(([text, theme, tags, votes], k) => {
          nodes.push({
            ...sticky(x + 34, 104 + k * 260, text, theme),
            width: LANE_W - 68,
            height: 230,
            tags,
            reactions: votes > 0
              ? { '👍': Array.from({ length: votes }, (_, v) => `demo-b-${i}-${k}-${v}`) }
              : {},
          });
        });
      });

      return nodes;
    },
  },
  {
    id: 'retro',
    category: 'thinking',
    name: 'Retro',
    blurb: 'Four columns including the one templates always omit: what anyone is actually doing.',
    teaches: ['Frames as columns', 'Reactions', 'Tags'],
    build: () => {
      /**
       * A retro with the part that actually matters on it.
       *
       * The old board was three columns of two notes. Every real retro has a
       * fourth column the templates always leave out — **what we are actually
       * going to do** — and without it the exercise ends in a pile of
       * observations nobody owns. The board that runs the meeting has to have
       * somewhere for the meeting to land.
       *
       * The notes arrive with votes already on them, because the ordering a
       * retro produces is the output: a column of six unranked complaints is
       * the raw material, and the ranking is the work. Showing it done is the
       * only way a template can teach that the reactions are for counting.
       */
      const COL_W = 420;
      const COL_GAP = 32;
      const colX = (i: number) => i * (COL_W + COL_GAP);

      type Card = [string, number, string[]];

      const COLUMNS: Array<{ title: string; hint: string; theme: StickyTheme; cards: Card[] }> = [
        {
          title: 'Went well', hint: 'Name it so it keeps happening.', theme: 'mint',
          cards: [
            ['Shipped the editor rebuild', 5, []],
            ['Design review took twenty minutes', 3, []],
            ['Nobody worked a weekend', 4, []],
          ],
        },
        {
          title: 'Went badly', hint: 'The problem, not the person.', theme: 'peach',
          cards: [
            ['Flaky tests blocked three merges', 6, ['ci']],
            ['Scope moved twice mid-sprint', 4, []],
            ['Standup ran to forty minutes', 2, []],
          ],
        },
        {
          title: 'Try next', hint: 'Small enough to finish in one sprint.', theme: 'sky',
          cards: [
            ['Quarantine the flaky suite', 5, ['ci']],
            ['Freeze scope after day two', 3, []],
            ['Pair on the hard parts', 2, []],
          ],
        },
        {
          title: 'Actions', hint: 'An owner and a date, or it is a wish.', theme: 'yellow',
          cards: [
            ['Ana: quarantine the suite, Friday', 0, ['owned']],
            ['Sam: scope freeze in the charter, Weds', 0, ['owned']],
          ],
        },
      ];

      const nodes: NewNodeInput[] = [
        label(0, -180, 'Sprint retro', 44),
        label(0, -122, 'One note per point. React to agree, and the order that emerges is the agenda.', 18),
      ];

      COLUMNS.forEach((column, i) => {
        const x = colX(i);
        nodes.push(frame(x, 0, COL_W, 940, column.title));
        // The column's own instruction, inside the column. A legend off to
        // one side is a legend nobody reads while they are working.
        nodes.push({
          id: nanoid(), type: 'text', x: x + 32, y: 54,
          width: COL_W - 64, height: 22, text: column.hint, resize: 'width',
          typography: { fontSize: 15, fontWeight: 500, color: '#64748B' },
        });

        column.cards.forEach(([text, votes, tags], k) => {
          nodes.push({
            ...sticky(x + 32, 104 + k * 270, text, column.theme),
            width: COL_W - 64,
            height: 240,
            tags,
            reactions: votes > 0
              ? { '👍': Array.from({ length: votes }, (_, v) => `demo-r-${i}-${k}-${v}`) }
              : {},
          });
        });
      });

      return nodes;
    },
  },
  {
    id: 'canvas-tour',
    category: 'thinking',
    name: 'Take the tour',
    blurb: 'A specimen sheet: nine plates covering fills, type, notes, routing, strokes and materials.',
    teaches: ['Every object type', 'Paint model', 'Materials'],
    objectCount: 96,
    build: () => {
      /**
       * A specimen sheet, not a sampler.
       *
       * The previous version was three frames — some connectors, some shapes,
       * some notes — and a line of text saying everything on it was editable.
       * As a demonstration of a canvas that carries five paint types, six
       * shape kinds, eight note themes, five materials, three routings and a
       * full stroke model, it showed almost none of it, and what it did show
       * it showed without saying what the thing was called.
       *
       * This is the format the question actually wants: a plate per
       * capability, each one titled, each one holding real objects rather
       * than a description of them. It is how a type foundry shows a
       * typeface and how a paint maker shows a range, for the same reason —
       * the specimen *is* the argument, and it is checkable, because every
       * object on it is a live object you can select and change.
       *
       * Laid out on a strict grid so the sheet reads as one document. Nine
       * plates, three across, which keeps the whole board close to landscape
       * and therefore legible on its own card.
       */
      const PW = 620;         // plate width
      const PH = 470;         // plate height
      const COL_GAP = 70;
      /**
       * Taller than the column gap, for the same reason the impact matrix
       * needs it: a frame's name is drawn eighteen *screen* pixels above its
       * top edge, so the clearance it needs in world units is `18 / zoom`.
       * Nine plates fit at roughly a quarter zoom, where that is about
       * seventy-six units — more than the seventy this had, so each row's
       * titles were printing through the plate above.
       *
       * A hundred and fifty leaves headroom down to about an eighth zoom,
       * which is further out than anyone reads a specimen sheet from.
       */
      const ROW_GAP = 150;
      const at = (col: number, row: number) => ({ x: col * (PW + COL_GAP), y: row * (PH + ROW_GAP) });

      const plate = (col: number, row: number, title: string): NewNodeInput => {
        const p = at(col, row);
        return frame(p.x, p.y, PW, PH, title);
      };

      /** A caption inside a plate, in the plate's own coordinates. */
      const note = (col: number, row: number, dx: number, dy: number, text: string): NewNodeInput => {
        const p = at(col, row);
        return {
          id: nanoid(),
          type: 'text',
          x: p.x + dx,
          y: p.y + dy,
          width: 260,
          height: 20,
          text,
          resize: 'width',
          typography: { fontSize: 13, fontWeight: 500, color: '#64748B' },
        };
      };

      const swatch = (
        col: number, row: number, dx: number, dy: number,
        w: number, h: number, appearance: Record<string, unknown>, extra: Record<string, unknown> = {}
      ): NewNodeInput => {
        const p = at(col, row);
        return {
          id: nanoid(),
          type: 'shape',
          x: p.x + dx,
          y: p.y + dy,
          width: w,
          height: h,
          geometry: { kind: 'rect' },
          appearance,
          ...extra,
        };
      };

      const nodes: NewNodeInput[] = [
        label(0, -210, 'Everything, on one sheet', 52),
        label(0, -140, 'Nine plates. Every object on them is live. Select one and change it.', 20),
      ];

      // ---------------------------------------------------- 1. shapes -----
      nodes.push(plate(0, 0, '1 · Shapes'));
      const SHAPES: Array<[string, Record<string, unknown>]> = [
        ['Rectangle', { kind: 'rect' }],
        ['Ellipse', { kind: 'ellipse' }],
        ['Triangle', { kind: 'polygon', points: 3 }],
        ['Hexagon', { kind: 'polygon', points: 6 }],
        // `innerRatio`, which is the field the schema declares. The old board
        // wrote `innerRadius` — a name nothing reads, so every star on it
        // silently fell back to the default.
        ['Star', { kind: 'star', points: 5, innerRatio: 0.45 }],
        ['Arrow', { kind: 'arrow', arrowEnd: true }],
      ];
      SHAPES.forEach(([name, geometry], i) => {
        const dx = 40 + (i % 3) * 190;
        const dy = 70 + Math.floor(i / 3) * 190;
        nodes.push(swatch(0, 0, dx, dy, 130, 110, {
          fill: [{ type: 'solid', color: '#C7D2FE' }],
          stroke: { color: '#4F46E5', width: 2 },
        }, { geometry }));
        nodes.push(note(0, 0, dx, dy + 122, name));
      });

      // ---------------------------------------------------- 2. fills ------
      nodes.push(plate(1, 0, '2 · Every kind of fill'));
      const STOPS = [
        { offset: 0, color: '#F3A024' },
        { offset: 1, color: '#6366F1' },
      ];
      const FILLS: Array<[string, Record<string, unknown>]> = [
        ['Solid', { type: 'solid', color: '#F3A024' }],
        ['Linear', { type: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, stops: STOPS }],
        ['Radial', { type: 'radial', center: { x: 0.5, y: 0.5 }, radius: 0.72, stops: STOPS }],
        ['Conic', { type: 'conic', center: { x: 0.5, y: 0.5 }, angle: 0, stops: STOPS }],
        ['Diamond', { type: 'diamond', center: { x: 0.5, y: 0.5 }, radius: 0.72, stops: STOPS }],
      ];
      FILLS.forEach(([name, paint], i) => {
        const dx = 40 + (i % 3) * 190;
        const dy = 70 + Math.floor(i / 3) * 190;
        nodes.push(swatch(1, 0, dx, dy, 150, 110, { fill: [paint], cornerRadius: 12 }));
        nodes.push(note(1, 0, dx, dy + 122, name));
      });

      // ---------------------------------------------------- 3. type -------
      nodes.push(plate(2, 0, '3 · Type'));
      {
        const p = at(2, 0);
        const t = (dy: number, text: string, typography: Record<string, unknown>): NewNodeInput => ({
          id: nanoid(), type: 'text', x: p.x + 40, y: p.y + dy,
          width: 520, height: 40, text, resize: 'width', typography,
        });
        nodes.push(
          t(64, 'Regular 34', { fontSize: 34, fontWeight: 400, color: '#0F172A' }),
          t(120, 'Semibold 34', { fontSize: 34, fontWeight: 700, color: '#0F172A' }),
          t(176, 'Italic, underlined', { fontSize: 24, fontWeight: 400, italic: true, underline: true, color: '#0F172A' }),
          t(220, 'Struck through', { fontSize: 24, fontWeight: 400, strikethrough: true, color: '#64748B' }),
          // Shown in upper case, still stored as written — change the case
          // control back and the original text is intact.
          t(264, 'Shown in upper case', { fontSize: 24, fontWeight: 600, textCase: 'upper', color: '#0F172A' }),
          t(312, 'Letter-spaced and loose', { fontSize: 20, fontWeight: 400, letterSpacing: 3, lineHeight: 1.8, color: '#64748B' }),
          t(370, 'Centred', { fontSize: 20, fontWeight: 500, align: 'center', color: '#64748B' }),
        );
      }

      // ---------------------------------------------------- 4. notes ------
      nodes.push(plate(0, 1, '4 · Sticky notes'));
      {
        const p = at(0, 1);
        const THEMES: StickyTheme[] = ['yellow', 'mint', 'sky', 'pink', 'lavender', 'peach', 'white', 'dark'];
        THEMES.forEach((theme, i) => {
          const dx = 34 + (i % 4) * 143;
          const dy = 66 + Math.floor(i / 4) * 168;
          nodes.push({
            ...sticky(p.x + dx, p.y + dy, theme, theme),
            width: 126,
            height: 126,
            fontSize: 15,
            // The first three carry the things a note can hold, so tags,
            // votes and pinning are visible as behaviour rather than named
            // in a caption nobody reads.
            ...(i === 0 ? { tags: ['tagged'] } : {}),
            ...(i === 1 ? { reactions: { '👍': ['a', 'b', 'c'] } } : {}),
            ...(i === 2 ? { pinned: true } : {}),
          });
        });
        nodes.push(note(0, 1, 34, 404, 'Eight papers. The first three are tagged, voted and pinned.'));
      }

      // ---------------------------------------------------- 5. connectors -
      nodes.push(plate(1, 1, '5 · Connectors'));
      {
        const p = at(1, 1);
        const pair = (dy: number, routing: string, endEnd: string, name: string) => {
          const a = box(p.x + 40, p.y + dy, 110, 62, 'From', '#DBEAFE');
          const b = box(p.x + 380, p.y + dy, 110, 62, 'To', '#FEE2E2');
          return [
            a, b,
            link(a.id as string, b.id as string, { routing, endEnd }),
            note(1, 1, 40, dy + 70, name),
          ];
        };
        nodes.push(
          ...pair(70, 'straight', 'arrow', 'Straight, arrow'),
          ...pair(200, 'orthogonal', 'diamond', 'Orthogonal, diamond'),
          ...pair(330, 'curved', 'circle', 'Curved, circle'),
        );
      }

      // ---------------------------------------------------- 6. strokes ----
      nodes.push(plate(2, 1, '6 · Strokes'));
      {
        const STROKES: Array<[string, Record<string, unknown>]> = [
          ['Hairline', { color: '#0F172A', width: 1 }],
          ['Heavy', { color: '#0F172A', width: 8 }],
          ['Dashed', { color: '#0F172A', width: 3, dash: [14, 10] }],
          ['Dotted, round cap', { color: '#0F172A', width: 5, dash: [0, 14], cap: 'round' }],
          ['Round join', { color: '#4F46E5', width: 7, join: 'round' }],
          ['Mitred join', { color: '#4F46E5', width: 7, join: 'miter' }],
        ];
        STROKES.forEach(([name, stroke], i) => {
          const dx = 40 + (i % 2) * 280;
          const dy = 70 + Math.floor(i / 2) * 130;
          nodes.push(swatch(2, 1, dx, dy, 220, 78, {
            fill: [{ type: 'solid', color: '#FFFFFF' }],
            stroke,
            cornerRadius: i >= 4 ? 0 : 10,
          }, i >= 4 ? { geometry: { kind: 'polygon', points: 3 } } : {}));
          nodes.push(note(2, 1, dx, dy + 88, name));
        });
      }

      // ---------------------------------------------------- 7. physics ----
      nodes.push(plate(0, 2, '7 · Materials'));
      {
        const MATERIALS: Array<[string, string]> = [
          ['feather', '#DCFCE7'], ['paper', '#DBEAFE'], ['rubber', '#FBD2E1'],
          ['wood', '#FEF3C7'], ['stone', '#E2E8F0'],
        ];
        MATERIALS.forEach(([material, fill], i) => {
          const dx = 40 + (i % 3) * 190;
          const dy = 76 + Math.floor(i / 3) * 180;
          nodes.push(swatch(0, 2, dx, dy, 130, 110, {
            fill: [{ type: 'solid', color: fill }],
            cornerRadius: 14,
          }, { material, text: material, typography: { fontSize: 15, fontWeight: 600, color: '#0F172A', align: 'center', verticalAlign: 'middle' } }));
        });
        nodes.push(note(0, 2, 40, 400, 'Arm a force, then flick one. Stone barely moves; a feather sails.'));
      }

      // ---------------------------------------------------- 8. depth ------
      nodes.push(plate(1, 2, '8 · Depth and blending'));
      {
        nodes.push(
          swatch(1, 2, 60, 90, 190, 190, { fill: [{ type: 'solid', color: '#F3A024' }], cornerRadius: 20 }),
          // Overlapping, half-transparent, and multiplied — three different
          // ways of being "on top of" something, shown together.
          swatch(1, 2, 170, 150, 190, 190, { fill: [{ type: 'solid', color: '#6366F1', opacity: 0.75 }], cornerRadius: 20 }),
          swatch(1, 2, 280, 210, 190, 190, { fill: [{ type: 'solid', color: '#10B981' }], cornerRadius: 20, blendMode: 'multiply' }),
          note(1, 2, 60, 420, 'Stacking order, layer opacity, and a multiply blend.'),
        );
      }

      // ---------------------------------------------------- 9. frames -----
      nodes.push(plate(2, 2, '9 · Frames'));
      {
        const p = at(2, 2);
        nodes.push(
          // `safeArea` is an inset per edge, not a single number — writing a
          // scalar here would have declared a field the renderer cannot read.
          // Inset far enough down that the nested frame's *own* name still
          // lands inside the plate. At seventy it started thirteen units above
          // the plate's top edge, so the plate clipped its own contents' label.
          {
            ...frame(p.x + 50, p.y + 120, 340, 210, 'Artboard 340 x 210'),
            safeArea: { top: 24, right: 24, bottom: 24, left: 24 },
          },
          box(p.x + 100, p.y + 170, 240, 110, 'Clipped to the frame', '#DBEAFE', {
            typography: { fontSize: 15, fontWeight: 600, color: '#1F2937', align: 'center', verticalAlign: 'middle' },
          }),
          note(2, 2, 50, 356, 'A frame owns what is inside it: move it and its contents travel.'),
          note(2, 2, 50, 392, 'Export this one on its own at 1x, 2x or 3x.'),
        );
      }

      return nodes;
    },
  },
  {
    id: 'halftone',
    featured: true,
    category: 'art',
    name: 'Halftone',
    blurb: 'A lit sphere printed as a thousand dots, each sized by how much light falls on it.',
    teaches: ['Scale', 'Colour', 'Generative'],
    objectCount: 1000,
    build: (limit) => {
      /**
       * The oldest trick in print, done with real objects.
       *
       * A halftone conveys a continuous tone with dots of one colour by
       * varying only their *size* — which is exactly what a canvas of
       * independent shapes can do and a raster image cannot undo. Every dot
       * here is a real ellipse you can select, recolour, drag or throw, and
       * the image survives being taken apart, which is the whole point of
       * making it out of objects instead of pixels.
       *
       * The tone is not noise: it is a sphere with a light on it. Each cell
       * samples the surface normal at that point and takes its brightness
       * from the angle between that normal and the light, which is the same
       * arithmetic a renderer does per pixel. That is why it reads as a solid
       * object rather than as a pattern, and why the terminator falls where
       * the eye expects.
       */
      const FULL = 36;
      // Trimmed by resolution, never by area — a thumbnail wants the whole
      // sphere at fewer dots, not a corner of it at full size.
      const N = limit && limit < 1000 ? Math.max(14, Math.floor(Math.sqrt(limit / 0.79))) : FULL;
      const CELL = 1080 / N;

      // Pointing up, left and toward the viewer: the conventional key light,
      // which puts the highlight where a reader already expects it.
      const LX = -0.42, LY = -0.56, LZ = 0.72;

      const nodes: NewNodeInput[] = [];
      for (let row = 0; row < N; row += 1) {
        for (let col = 0; col < N; col += 1) {
          // Cell centre in unit coordinates, -1..1 across the sphere.
          const u = ((col + 0.5) / N) * 2 - 1;
          const v = ((row + 0.5) / N) * 2 - 1;
          const r2 = u * u + v * v;
          if (r2 > 1) continue; // outside the disc

          const z = Math.sqrt(1 - r2);
          // Lambert, plus a floor so the dark side is a shadow and not a hole.
          // Gamma below 1 lifts the mid-tones, which widens the lit face and
          // keeps the terminator from eating half the sphere.
          const lambert = Math.pow(Math.max(0, u * LX + v * LY + z * LZ), 0.72);
          const b = 0.08 + 0.92 * lambert;

          /**
           * Violet shadow to warm highlight — the long way round the wheel,
           * deliberately.
           *
           * Sweeping hue *downward* from indigo to orange passes straight
           * through green, and a green terminator on a lit sphere reads as a
           * colour bug rather than as shade. Going up instead — 265 through
           * magenta, red, and out at 28 — never touches green and lands on
           * the ramp a sunset actually takes, which is the one the eye
           * already accepts as "this is lighting".
           */
          const h = (265 + b * 123) % 360;
          const sat = 62 + b * 26;
          const l = 22 + b * 46;

          // A wider size range than the colour needs, because at a distance
          // the dots merge and it is the *area* that carries the tone.
          const size = CELL * (0.14 + 0.86 * b);
          nodes.push({
            id: nanoid(),
            type: 'shape',
            x: col * CELL + (CELL - size) / 2,
            y: row * CELL + (CELL - size) / 2,
            width: size,
            height: size,
            geometry: { kind: 'ellipse' },
            appearance: { fill: [{ type: 'solid', color: `hsl(${Math.round(h)}, ${Math.round(sat)}%, ${Math.round(l)}%)` }] },
          });
        }
      }
      return nodes;
    },
  },
  {
    id: 'year',
    category: 'diagrams',
    name: 'A year of anything',
    blurb: 'Fifty-three weeks as a grid of days. Recolour a square and you have a record.',
    teaches: ['Data as objects', 'Grid', 'Colour'],
    objectCount: 371,
    build: (limit) => {
      /**
       * The contribution grid, rebuilt as editable objects.
       *
       * Everyone can read this chart, which is most of why it is here: it
       * needs no legend and no title to be understood, so it demonstrates
       * that a canvas can hold *data* without becoming a spreadsheet. And
       * unlike the chart it imitates, every square is a real object — click
       * one, change its colour, and you have edited the data by editing the
       * drawing.
       *
       * The values are deterministic rather than random, so the board looks
       * the same to two people opening it side by side, and so it has the
       * shape real activity has: busier midweek, quiet at weekends, with a
       * slow seasonal swell rather than uniform noise.
       */
      const WEEKS = limit && limit < 371 ? Math.max(12, Math.floor(limit / 7)) : 53;
      const CELL = 26;
      const GAP = 5;

      const nodes: NewNodeInput[] = [
        label(0, -96, 'A year of anything', 40),
        label(0, -44, 'One square per day. Fifty-three weeks across, seven days down.', 17),
      ];

      // Five steps, quiet to loud. A ramp rather than a palette, so the eye
      // reads intensity instead of category.
      const STEPS = ['#EEF2F5', '#CFE8D6', '#93D0A8', '#4FAE78', '#237A4E'];

      for (let w = 0; w < WEEKS; w += 1) {
        for (let d = 0; d < 7; d += 1) {
          // Weekdays busier than weekends, with a seasonal swell over the
          // year and a fine-grained wobble on top.
          const weekend = d === 0 || d === 6 ? 0.35 : 1;
          const season = 0.55 + 0.45 * Math.sin((w / WEEKS) * Math.PI * 2 - 1.1);
          const grain = (Math.sin(w * 12.9898 + d * 78.233) * 43758.5453) % 1;
          const value = weekend * season * (0.55 + 0.45 * Math.abs(grain));
          const step = Math.min(4, Math.max(0, Math.round(value * 4)));

          nodes.push({
            id: nanoid(),
            type: 'shape',
            x: w * (CELL + GAP),
            y: d * (CELL + GAP),
            width: CELL,
            height: CELL,
            geometry: { kind: 'rect' },
            appearance: { fill: [{ type: 'solid', color: STEPS[step] }], cornerRadius: 6 },
          });
        }
      }
      return nodes;
    },
  },
  {
    id: 'network',
    category: 'diagrams',
    name: 'Chord map',
    blurb: 'Twenty-four nodes on a ring, wired to each other with a hundred curved connectors.',
    teaches: ['Curved routing', 'Connectors at scale'],
    objectCount: 120,
    build: (limit) => {
      /**
       * Every connector re-routing at once.
       *
       * A chord diagram is the hardest thing to ask of a connector system:
       * the routes cross the middle rather than following a hierarchy, no two
       * leave at the same angle, and dragging any one node makes every line
       * touching it re-solve. On a tree the arrows mostly go down; here they
       * go everywhere, which is what makes it a test rather than a diagram.
       *
       * The chords are deterministic — node `i` joins the ones a fixed set of
       * strides away — so the figure has rotational symmetry and reads as a
       * woven object rather than as a tangle. Two people opening it get the
       * same picture.
       */
      const COUNT = 24;
      const RADIUS = 620;
      const SIZE = 92;
      const nodes: NewNodeInput[] = [];
      const ring: NewNodeInput[] = [];

      for (let i = 0; i < COUNT; i += 1) {
        const angle = (i / COUNT) * Math.PI * 2 - Math.PI / 2;
        const node: NewNodeInput = {
          id: nanoid(),
          type: 'shape',
          x: Math.cos(angle) * RADIUS - SIZE / 2,
          y: Math.sin(angle) * RADIUS - SIZE / 2,
          width: SIZE,
          height: SIZE,
          geometry: { kind: 'ellipse' },
          appearance: { fill: [{ type: 'solid', color: hue(i / COUNT, 62, 60) }] },
          text: String(i + 1),
          typography: { fontSize: 22, fontWeight: 700, color: '#161616', align: 'center', verticalAlign: 'middle' },
        };
        ring.push(node);
        nodes.push(node);
      }

      // Three strides, so each node carries four chords of differing span and
      // the weave has structure at more than one scale.
      const STRIDES = [5, 9, 11];
      const budget = limit ? Math.max(0, limit - COUNT) : Infinity;
      let drawn = 0;
      for (const stride of STRIDES) {
        for (let i = 0; i < COUNT; i += 1) {
          if (drawn >= budget) break;
          const j = (i + stride) % COUNT;
          // Each unordered pair once: at stride 12 on a 24-ring, i→j and j→i
          // are the same chord drawn twice.
          if (stride * 2 === COUNT && j < i) continue;
          nodes.push(
            link(ring[i].id as string, ring[j].id as string, {
              routing: 'curved',
              endEnd: 'none',
              appearance: { stroke: { color: hue(i / COUNT, 55, 62), width: 2, cap: 'round' } },
            })
          );
          drawn += 1;
        }
      }
      return nodes;
    },
  },
  {
    id: 'sprint',
    category: 'thinking',
    name: 'Sprint board',
    blurb: 'Four framed lanes and a fortnight of work, with tags and votes already on the cards.',
    teaches: ['Frames as lanes', 'Tags', 'Reactions'],
    build: () => {
      /**
       * The board most teams actually keep.
       *
       * Retro covers looking back; this is the one that runs the week, and it
       * was the obvious gap in the set. It exists mostly to show that the
       * *frame* is the right primitive for a lane: drag a card past a lane's
       * edge and it changes hands, because membership is decided by the box
       * rather than by a column index nobody can see.
       *
       * Cards arrive with tags and reactions on them, because both are
       * invisible until something is using them — an empty board teaches
       * neither.
       */
      const LANES: Array<{ title: string; theme: StickyTheme; cards: Array<[string, string[], number]> }> = [
        { title: 'Backlog', theme: 'sky', cards: [
          ['Rename the export presets', ['copy'], 0],
          ['Audit the empty states', ['design'], 2],
          ['Keyboard map for the panels', ['a11y'], 1],
          ['Drop the legacy colour picker', ['debt'], 0],
        ] },
        { title: 'In progress', theme: 'yellow', cards: [
          ['Multi-select in the inspector', ['design'], 3],
          ['Connector ends, six kinds', ['build'], 1],
          ['Thumbnail text rendering', ['bug'], 0],
        ] },
        { title: 'In review', theme: 'lavender', cards: [
          ['Restore from a JSON backup', ['build'], 2],
          ['Focus ring on every control', ['a11y'], 4],
        ] },
        { title: 'Done', theme: 'mint', cards: [
          ['Ruler guides you can drag out', ['build'], 5],
          ['Search the layers panel', ['build'], 2],
          ['Templates that arrive full', ['design'], 3],
        ] },
      ];

      const LANE_W = 460;
      const LANE_GAP = 40;
      const nodes: NewNodeInput[] = [
        label(0, -150, 'Sprint board', 44),
        label(0, -96, 'Drag a card past a lane edge and the frame it belongs to changes with it.', 17),
      ];

      LANES.forEach((lane, i) => {
        const x = i * (LANE_W + LANE_GAP);
        nodes.push(frame(x, 0, LANE_W, 1120, lane.title));
        lane.cards.forEach(([text, tags, votes], k) => {
          nodes.push({
            ...sticky(x + 40, 80 + k * 250, text, lane.theme),
            width: 380,
            height: 210,
            tags,
            // A count, not a name: the reaction only has to look counted.
            reactions: votes > 0
              ? { '👍': Array.from({ length: votes }, (_, v) => `demo-${i}-${k}-${v}`) }
              : {},
          });
        });
      });
      return nodes;
    },
  },
  {
    id: 'spiro',
    category: 'art',
    name: 'Spirograph',
    blurb: 'Six hundred wedges tracing a hypotrochoid, the curve a gear pen draws.',
    teaches: ['Rotation', 'Generative', 'Scale'],
    objectCount: 600,
    build: (limit) => {
      /**
       * The toy, done properly.
       *
       * A hypotrochoid is the path traced by a point fixed inside a small
       * circle rolling around the inside of a large one. Three numbers decide
       * the whole figure — the two radii and how far out the pen sits — and
       * the ratio between the radii decides how many times the curve wraps
       * before it closes. 5/13 closes after thirteen laps, which is enough
       * repetition to read as woven and not so much that it fills in solid.
       *
       * Each object is a thin wedge rotated to lie along the tangent, so the
       * curve is drawn by six hundred *oriented* rectangles rather than by a
       * path. That is the point: this is a shape made of objects, and every
       * one of them can be pulled out of it.
       */
      const COUNT = Math.min(600, limit ?? 600);
      const R = 520;   // fixed circle
      const r = 200;   // rolling circle
      const d = 300;   // pen offset
      const k = (R - r) / r;

      /**
       * Laps scale with the sample count, and the wedge length is measured
       * rather than guessed.
       *
       * Both of these were wrong first time and the card showed it. The
       * figure was drawn over thirteen laps, which at the thumbnail's node
       * budget puts consecutive wedges most of the way across the figure from
       * each other — the curve arrived as a field of unrelated specks.
       *
       * Thirteen was simply wrong. With these radii `k` is 8/5, so the curve
       * **closes after five laps** and everything past that retraces a path
       * already drawn: two and a half wasted laps spending sample budget on
       * ink that lands where there is ink. Five laps draws the whole figure
       * exactly once, which means the full board and the trimmed thumbnail
       * are the same drawing at two resolutions — the rule every other
       * generated board here follows.
       *
       * The wedges then have to be long enough to touch. Rather than pick a
       * number and hope, the path is walked once to measure its true length
       * and each wedge is cut a little longer than the average step. That is
       * self-correcting: change the radii and the ribbon stays closed.
       */
      const LAPS = 5;

      const pt = (i: number) => {
        const t = (i / COUNT) * Math.PI * 2 * LAPS;
        return {
          t,
          x: (R - r) * Math.cos(t) + d * Math.cos(k * t),
          y: (R - r) * Math.sin(t) - d * Math.sin(k * t),
        };
      };

      let length = 0;
      let prev = pt(0);
      for (let i = 1; i <= COUNT; i += 1) {
        const cur = pt(i);
        length += Math.hypot(cur.x - prev.x, cur.y - prev.y);
        prev = cur;
      }
      // 1.35 rather than 1: neighbouring wedges must overlap, or the ribbon
      // is a dotted line at every point where the curve bends away.
      const w = Math.max(14, (length / COUNT) * 1.35);
      const h = Math.max(5, w * 0.16);

      const nodes: NewNodeInput[] = [];
      for (let i = 0; i < COUNT; i += 1) {
        const { t, x, y } = pt(i);

        // The tangent, from the derivative — so each wedge lies along the
        // curve instead of pointing at the origin.
        const dx = -(R - r) * Math.sin(t) - d * k * Math.sin(k * t);
        const dy = (R - r) * Math.cos(t) - d * k * Math.cos(k * t);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

        nodes.push({
          id: nanoid(),
          type: 'shape',
          x: x - w / 2,
          y: y - h / 2,
          width: w,
          height: h,
          rotation: angle,
          geometry: { kind: 'rect' },
          appearance: {
            fill: [{ type: 'solid', color: hue(i / COUNT, 72, 58) }],
            cornerRadius: h / 2,
          },
        });
      }
      return nodes;
    },
  },
  {
    id: 'uikit',
    category: 'design',
    name: 'Interface kit',
    blurb: 'Buttons, fields, swatches and type at real sizes: a page of parts to build from.',
    teaches: ['Frames', 'Type scale', 'Colour'],
    objectCount: 96,
    build: () => {
      /**
       * The board a designer opens on day one.
       *
       * Every other template here is a finished artefact. This one is a
       * *supply* — the pieces an interface is assembled from, drawn once at
       * the sizes they are actually used at, so the first screen anyone lays
       * out is not built from rectangles they guessed the height of.
       *
       * It doubles as the honest answer to "is this a design tool": a swatch
       * row, a type ramp and three button states is the smallest thing that
       * makes that question checkable.
       */
      const nodes: NewNodeInput[] = [
        label(0, -150, 'Interface kit', 44),
        label(0, -96, 'Real control heights, a real type ramp, and a palette that goes with them.', 17),
        frame(0, 0, 1240, 900, 'Kit'),
      ];

      // ---- palette -------------------------------------------------------
      nodes.push(label(60, 44, 'Palette', 22));
      const RAMP = ['#0F172A', '#334155', '#64748B', '#94A3B8', '#CBD5E1', '#E2E8F0', '#F1F5F9'];
      const ACCENT = ['#F3A024', '#EF4444', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899'];
      RAMP.forEach((c, i) => {
        nodes.push(box(60 + i * 92, 92, 80, 80, '', c, { appearance: { fill: [{ type: 'solid', color: c }], cornerRadius: 12 } }));
      });
      ACCENT.forEach((c, i) => {
        nodes.push(box(60 + i * 92, 188, 80, 80, '', c, { appearance: { fill: [{ type: 'solid', color: c }], cornerRadius: 12 } }));
      });

      // ---- type ramp -----------------------------------------------------
      nodes.push(label(60, 312, 'Type', 22));
      const TYPE: Array<[string, number]> = [
        ['Display 30', 30], ['Headline 24', 24], ['Title 16', 16], ['Body 13', 13], ['Label 11', 11],
      ];
      let ty = 356;
      TYPE.forEach(([text, size]) => {
        nodes.push(label(60, ty, text, size));
        ty += size * 1.9 + 10;
      });

      // ---- controls ------------------------------------------------------
      nodes.push(label(660, 312, 'Controls', 22));
      // The three heights the system actually has, drawn at those heights.
      const BUTTONS: Array<[string, number, string, string]> = [
        ['Primary  38', 38, '#F3A024', '#161616'],
        ['Secondary  32', 32, '#F1F5F9', '#0F172A'],
        ['Small  28', 28, '#FFFFFF', '#334155'],
      ];
      let by = 356;
      BUTTONS.forEach(([text, h, fill, ink]) => {
        nodes.push(box(660, by, 240, h, text, fill, {
          appearance: { fill: [{ type: 'solid', color: fill }], cornerRadius: 8 },
          typography: { fontSize: 13, fontWeight: 600, color: ink, align: 'center', verticalAlign: 'middle' },
        }));
        by += h + 18;
      });

      // Fields, at the same widths, so a form laid out from these lines up.
      nodes.push(label(660, 520, 'Fields', 22));
      ['Label', 'Placeholder', 'Filled value'].forEach((text, i) => {
        nodes.push(box(660, 564 + i * 60, 480, 44, text, '#FFFFFF', {
          appearance: { fill: [{ type: 'solid', color: '#FFFFFF' }], cornerRadius: 8, stroke: { color: '#CBD5E1', width: 1 } },
          typography: { fontSize: 14, fontWeight: 400, color: '#64748B', align: 'left', verticalAlign: 'middle' },
        }));
      });

      // ---- chips ---------------------------------------------------------
      nodes.push(label(60, 640, 'Chips', 22));
      ['Draft', 'In review', 'Shipped', 'Blocked'].forEach((text, i) => {
        nodes.push(box(60 + i * 130, 684, 116, 32, text, ['#E2E8F0', '#FEF3C7', '#DCFCE7', '#FEE2E2'][i], {
          appearance: { fill: [{ type: 'solid', color: ['#E2E8F0', '#FEF3C7', '#DCFCE7', '#FEE2E2'][i] }], cornerRadius: 999 },
          typography: { fontSize: 12, fontWeight: 600, color: '#334155', align: 'center', verticalAlign: 'middle' },
        }));
      });

      return nodes;
    },
  },
  {
    id: 'pachinko',
    category: 'physics',
    name: 'Pachinko',
    blurb: 'A pin board with walls and bins. Latch Drop above it and watch the balls sort themselves.',
    teaches: ['Locked obstacles', 'Latched force', 'Collisions'],
    objectCount: 200,
    build: (limit) => {
      /**
       * A board built to be knocked over.
       *
       * Every other physics template is a field you disturb. This one has
       * *structure* to fall through — a staggered peg lattice, walls, and a
       * hopper of loose balls above it — so the simulation produces something
       * with a direction rather than a pretty scatter. The classic Galton
       * arrangement, which means the pile in the bins is a binomial
       * distribution if you let it run.
       *
       * ## What it needed from the engine, and did not have
       *
       * The first version of this board jammed. Every body in the simulation
       * was built as a **rectangle** regardless of its shape, so a "ball"
       * landing on a "peg" was a square meeting a square: it balanced on the
       * flat top and stopped. Nothing round could roll, so nothing could pass.
       * Bodies are circles now when the shape is one.
       *
       * It also needed **locked** bodies, which did not exist: `stone` only
       * makes a peg heavy, so the lattice scattered the first time anyone used
       * it. Locked bodies stay in the world and are collided against but are
       * never set in motion — which is also what makes the walls and the bin
       * dividers below possible at all.
       */
      const ROWS = 11;
      const PEG = 24;
      const SPACING = 104;
      /** Rows are closer together than columns, as on a real pin board. */
      const ROW_GAP = SPACING * 0.74;
      const BALL = 34;

      const fieldWidth = (ROWS + 2) * SPACING;
      const halfWidth = fieldWidth / 2;
      const fieldBottom = 160 + ROWS * ROW_GAP;

      const nodes: NewNodeInput[] = [];

      /** Locked furniture: walls, floor, dividers. Collided against, never moved. */
      const fixture = (x: number, y: number, w: number, h: number, color = '#CBD5E1'): NewNodeInput => ({
        id: nanoid(), type: 'shape', x, y, width: w, height: h,
        geometry: { kind: 'rect' },
        appearance: { fill: [{ type: 'solid', color }], cornerRadius: 6 },
        material: 'stone',
        locked: true,
      });

      // ---- the pins -----------------------------------------------------
      for (let row = 0; row < ROWS; row += 1) {
        const cols = row + 3;
        const offset = -((cols - 1) * SPACING) / 2;
        for (let col = 0; col < cols; col += 1) {
          nodes.push({
            id: nanoid(),
            type: 'shape',
            x: offset + col * SPACING - PEG / 2,
            y: 160 + row * ROW_GAP,
            width: PEG,
            height: PEG,
            geometry: { kind: 'ellipse' },
            appearance: { fill: [{ type: 'solid', color: '#94A3B8' }] },
            material: 'stone',
            locked: true,
          });
        }
      }

      // ---- the cabinet --------------------------------------------------
      // Walls, so a ball that skips wide comes back into play instead of
      // sailing off across an infinite canvas and never being seen again.
      nodes.push(
        fixture(-halfWidth - 40, -220, 24, fieldBottom + 500),
        fixture(halfWidth + 16, -220, 24, fieldBottom + 500),
        fixture(-halfWidth - 40, fieldBottom + 280, fieldWidth + 80, 26),
      );

      // Bins, so the distribution the pins produce is visible as a shape
      // rather than as a heap.
      const BINS = 9;
      const binWidth = fieldWidth / BINS;
      for (let i = 1; i < BINS; i += 1) {
        nodes.push(fixture(-halfWidth + i * binWidth - 6, fieldBottom + 90, 12, 190, '#E2E8F0'));
      }

      // ---- the hopper ---------------------------------------------------
      /**
       * Narrow and centred over the apex.
       *
       * They used to start spread wider than the top of the lattice, so most
       * of them fell straight past the pins they were meant to be sorted by
       * and the board demonstrated nothing.
       */
      const balls = limit ? Math.max(10, Math.min(45, limit - 130)) : 45;
      const PER_ROW = 9;
      const hopperStep = 46;
      for (let i = 0; i < balls; i += 1) {
        const col = i % PER_ROW;
        const row = Math.floor(i / PER_ROW);
        nodes.push({
          id: nanoid(),
          type: 'shape',
          x: -((PER_ROW - 1) * hopperStep) / 2 + col * hopperStep - BALL / 2,
          y: -60 - row * 44,
          width: BALL,
          height: BALL,
          geometry: { kind: 'ellipse' },
          appearance: { fill: [{ type: 'solid', color: hue(i / balls, 74, 60) }] },
          material: 'rubber',
        });
      }

      nodes.unshift(
        label(-halfWidth - 40, -520, 'Pachinko', 44),
        label(-halfWidth - 40, -462, 'Forces → Drop, set to Latch. Click above the pins and watch them sort.', 17),
      );

      return nodes;
    },
  },
  {
    id: 'matrix',
    category: 'thinking',
    name: 'Impact and effort',
    blurb: 'Both axes drawn and labelled, four washed quadrants, twelve notes already argued over.',
    teaches: ['Frames as quadrants', 'Reactions', 'Tags'],
    build: () => {
      /**
       * The meeting that actually decides something.
       *
       * A retro looks back and a sprint board tracks the present; this is the
       * one where a list becomes an order. It is here because it is the
       * clearest use of the canvas as an *argument surface* — a note's
       * meaning is its position, so moving it is the whole discussion, and
       * none of that survives being written down as a list.
       *
       * ## What the first version was missing
       *
       * Two quadrant labels and no axes. A four-box grid with names in the
       * corners is not a matrix: nothing said which direction impact
       * increased in, so "Big bet" and "Thankless" were assertions rather
       * than positions, and a note could not be *read* from where it sat.
       * The axes are the instrument; the boxes are just where the readings
       * land.
       *
       * So both axes are drawn and labelled at each end, the quadrants carry
       * a wash that says which corner is the good one without needing a
       * legend, and the notes are placed at meaningful distances from the
       * origin rather than tidied into rows — a grid of evenly spaced cards
       * would say that everything in a quadrant scores the same, which is the
       * one thing this chart exists to deny.
       */
      const Q = 720;
      /**
       * The rows need more room than the columns, and not for balance.
       *
       * `FrameRenderer` draws a frame's name at `y = -18 / stageScale` — that
       * is eighteen *screen* pixels above the top edge, so the clearance it
       * needs in **world** units is `18 / zoom`. This board fits at roughly
       * half zoom, where the label wants about thirty-six units, and the gap
       * between the rows was twenty-four: the two bottom quadrant names were
       * drawn straight through the bottom edge of the quadrants above them.
       *
       * Columns are unaffected — a name sits above its frame, not beside it —
       * so only the row gap grows. Widening both would have opened a gutter
       * down the middle of a matrix whose quadrants are supposed to meet.
       */
      const COL_GAP = 24;
      const ROW_GAP = 132;
      const SPAN_X = Q * 2 + COL_GAP;
      const SPAN_Y = Q * 2 + ROW_GAP;

      /** Quadrant washes: the useful corner reads warm, the wasteful one cold. */
      const QUADRANTS: Array<[number, number, string, string]> = [
        [0, 0, 'Quick win: do it now', '#F0FDF4'],
        [Q + COL_GAP, 0, 'Big bet: plan it properly', '#EFF6FF'],
        [0, Q + ROW_GAP, 'Fill-in: when there is room', '#F8FAFC'],
        [Q + COL_GAP, Q + ROW_GAP, 'Thankless: say no', '#FEF2F2'],
      ];

      /** A hairline axis rule. */
      const axis = (x: number, y: number, w: number, h: number): NewNodeInput => ({
        id: nanoid(), type: 'shape', x, y, width: w, height: h,
        geometry: { kind: 'rect' },
        appearance: { fill: [{ type: 'solid', color: '#94A3B8' }], cornerRadius: 3 },
      });

      /** An axis end-stop, set small and spaced so it reads as a scale mark. */
      const tick = (x: number, y: number, text: string): NewNodeInput => ({
        id: nanoid(), type: 'text', x, y, width: 260, height: 22, text, resize: 'width',
        typography: { fontSize: 16, fontWeight: 700, color: '#64748B', letterSpacing: 2, textCase: 'upper' },
      });

      const nodes: NewNodeInput[] = [
        label(-300, -220, 'Impact and effort', 44),
        label(-300, -162, 'Position is the argument. Drag a note and you have changed your mind in public.', 18),
      ];

      QUADRANTS.forEach(([x, y, title, wash]) => {
        nodes.push({
          ...frame(x, y, Q, Q, title),
          appearance: { fill: [{ type: 'solid', color: wash }] },
        });
      });

      nodes.push(
        // The vertical axis, in the left margin, running the full height.
        axis(-70, 0, 6, SPAN_Y),
        tick(-300, 0, 'High impact'),
        tick(-300, SPAN_Y - 22, 'Low impact'),

        // The horizontal axis, beneath, running the full width.
        axis(0, SPAN_Y + 64, SPAN_X, 6),
        tick(0, SPAN_Y + 96, 'Low effort'),
        tick(SPAN_X - 190, SPAN_Y + 96, 'High effort'),
      );

      /**
       * Twelve cards, positioned rather than arranged.
       *
       * The coordinates are per-card and deliberately uneven: a note nearer
       * the top of its quadrant is claiming more impact than one below it,
       * and that reading is the entire mechanism. Laying them out on a grid
       * would flatten twelve distinct positions into four buckets.
       */
      const CARDS: Array<[number, number, string, StickyTheme, string[], number]> = [
        // Quick win — high impact, low effort.
        [70, 60, 'Multi-select in the inspector', 'yellow', ['ux'], 6],
        [370, 210, 'Keyboard map for the panels', 'yellow', ['a11y'], 4],
        [130, 420, 'Search inside a board', 'yellow', [], 3],
        // Big bet — high impact, high effort.
        [Q + COL_GAP + 90, 90, 'Components and instances', 'sky', ['engine'], 5],
        [Q + COL_GAP + 400, 300, 'Auto layout', 'sky', ['engine'], 4],
        [Q + COL_GAP + 160, 470, 'Real nested groups', 'sky', ['engine'], 2],
        // Fill-in — low impact, low effort.
        [90, Q + ROW_GAP + 120, 'Rename the export presets', 'mint', ['copy'], 2],
        [390, Q + ROW_GAP + 280, 'Empty-state copy pass', 'mint', ['copy'], 1],
        [150, Q + ROW_GAP + 460, 'Tidy the tooltip delays', 'mint', [], 1],
        // Thankless — low impact, high effort.
        [Q + COL_GAP + 120, Q + ROW_GAP + 140, 'Skins for the drawn cursor', 'peach', [], 0],
        [Q + COL_GAP + 420, Q + ROW_GAP + 330, 'Six more blend modes', 'peach', ['engine'], 0],
        [Q + COL_GAP + 170, Q + ROW_GAP + 500, 'Confetti on export', 'peach', [], 1],
      ];

      CARDS.forEach(([x, y, text, theme, tags, votes], i) => {
        nodes.push({
          ...sticky(x, y, text, theme),
          width: 250,
          height: 190,
          fontSize: 17,
          tags,
          reactions: votes > 0
            ? { '👍': Array.from({ length: votes }, (_, v) => `demo-m-${i}-${v}`) }
            : {},
        });
      });

      return nodes;
    },
  },
];

/**
 * How many nodes a thumbnail is allowed to ask for.
 *
 * Sized to sit just above `MAX_ITEMS_RICH`, so a generated board's picture is
 * the whole of what it built rather than the largest slice of it. Below that
 * line the preview starts discarding objects by size, and on the boards where
 * size carries the pattern that is the pattern going missing.
 *
 * Only the four showcase boards ever reach this; the rest build twenty or
 * thirty nodes and ignore it entirely.
 */
const PREVIEW_NODE_LIMIT = 150;

export const templateById = (id: string): Template | undefined =>
  TEMPLATES.find((t) => t.id === id);

/**
 * The picture on a template's card.
 *
 * Built from the template's own `build()`, so the thumbnail is a drawing of the
 * exact board you will get rather than an illustration someone drew once and
 * then forgot to update. Change a template's layout and its card changes with
 * it, for free.
 *
 * The nodes are normalised into the shape `buildPreview` expects — it reads a
 * document, and `build()` returns creation input, which is nearly but not
 * quite the same thing: creation input leaves out the fields the CRDT boundary
 * would fill in, and the preview needs `zIndex` to layer and `hidden` to skip.
 */
export function templatePreview(template: Template): BoardPreview | null {
  // Enough to read the shape, cheap enough that four of these do not freeze
  // the page they are drawn on.
  const nodes = template.build(PREVIEW_NODE_LIMIT).map((node, i) => ({
    ...node,
    zIndex: i,
    hidden: false,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  })) as unknown as AnyNode[];

  const byId: Record<string, AnyNode> = {};
  nodes.forEach((node) => { byId[node.id] = node; });

  return buildPreview(nodes, previewColorOf, (node) => previewPointsOf(node, byId), MAX_ITEMS_RICH);
}
