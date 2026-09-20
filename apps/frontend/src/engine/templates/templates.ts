import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../document/mutations';
import type { AnyNode, StickyTheme } from '../model/schema';
import { buildPreview, MAX_ITEMS_RICH, type BoardPreview } from '../model/boardPreview';
import { previewColorOf, previewPointsOf } from '../model/previewPaint';
import {
  BRAND, BRAND_INK, HAIRLINE, HUE, INK, INK_FAINT, INK_MID, INK_SOFT, INK_STRONG,
  layer, PAPER, PAPER_SOFT, RULE, SIGNAL_OK, strokeOf, contrast, TINT, chart, plot,
} from './templateKit';
import { SCIENCE_TEMPLATES } from './scienceTemplates';
import { TABLE_TEMPLATES } from './tableTemplates';
import { SYSTEM_TEMPLATES } from './systemTemplates';
import { WORK_TEMPLATES } from './workTemplates';
import { ART_TEMPLATES } from './artTemplates';

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
export type TemplateCategory =
  | 'systems'
  | 'work'
  | 'diagrams'
  | 'thinking'
  | 'design'
  | 'art'
  | 'physics'
  | 'science';

/**
 * The order these appear in, which is an editorial decision and not an
 * alphabetical one.
 *
 * `systems` and `work` lead because they are the boards somebody would
 * actually keep — an architecture, a quarter, a launch. What follows is
 * ordered by how far it sits from ordinary work, ending at the generative
 * boards, which are the ones people open last and enjoy most.
 */
export const CATEGORIES: Array<{ id: TemplateCategory; label: string; blurb: string }> = [
  { id: 'systems', label: 'Systems & architecture', blurb: 'How real things actually work, drawn properly.' },
  { id: 'work', label: 'Teams & planning', blurb: 'The boards a team keeps open for a quarter.' },
  { id: 'diagrams', label: 'Charts & flows', blurb: 'Process, hierarchy and the arrows between them.' },
  { id: 'science', label: 'Science & maths', blurb: 'Plots, distributions and data, twice — crisp and hand-drawn.' },
  { id: 'thinking', label: 'Thinking', blurb: 'Workshops, retros and the wall you think at.' },
  { id: 'design', label: 'Web & social', blurb: 'Layouts, kits and the pieces of a brand.' },
  { id: 'art', label: 'Illustration', blurb: 'Drawing with objects, by hand and by formula.' },
  { id: 'physics', label: 'Physics', blurb: 'Boards that move when you push them.' },
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
): NewNodeInput => {
  const extraAppearance = (extra.appearance as Record<string, unknown> | undefined) || {};
  const extraTypography = (extra.typography as Record<string, unknown> | undefined) || {};
  const passedStroke = extraAppearance.stroke as { color?: string; width?: number } | undefined;
  const strokeColor = strokeOf(fill);
  let stroke = { color: strokeColor, width: 1.5 };
  if (passedStroke) {
    const strokeWidth = passedStroke.width ?? 1.5;
    const strokeCol = passedStroke.color;
    if (strokeCol) {
      const cr = contrast(fill, strokeCol);
      if (cr > 2.0) {
        stroke = { color: strokeColor, width: strokeWidth };
      } else {
        stroke = { color: strokeCol, width: strokeWidth };
      }
    } else {
      stroke = { color: strokeColor, width: strokeWidth };
    }
  }
  const defaultFontSize =
    width <= 240 || height <= 60
      ? (text.length > 20 ? 13 : 14)
      : height <= 84
      ? 15
      : 16;
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width,
    height,
    geometry: { kind: 'rect' },
    text,
    /**
     * Ink, explicitly.
     *
     * A shape's text defaults to white, which is right for the saturated fills
     * the shape tool produces and wrong for every fill used here — these are
     * deliberately pale so the labels carry the meaning, and white on pale blue
     * is a label nobody can read.
     */
    typography: {
      fontSize: defaultFontSize,
      fontWeight: 600,
      color: INK,
      align: 'center',
      verticalAlign: 'middle',
      ...extraTypography,
    },
    ...extra,
    appearance: {
      fill: [{ type: 'solid', color: fill }],
      stroke,
      ...extraAppearance,
      cornerRadius: 0,
    },
  };
};

const label = (
  x: number,
  y: number,
  text: string,
  fontSize = 28,
  width?: number,
  extraTypography: Record<string, unknown> = {},
  groundColor?: string
): NewNodeInput => {
  const ground = groundColor ?? (extraTypography.ground as string | undefined);
  const { ground: _, ...cleanTypography } = extraTypography;
  return {
    id: nanoid(),
    type: 'text',
    x,
    y,
    width: width ?? (x === 0 ? (fontSize >= 24 ? 960 : 840) : Math.max(220, Math.min(560, Math.round(text.length * fontSize * 0.65)))),
    height: Math.round(fontSize * 1.35),
    text,
    resize: 'width',
    typography: { fontSize, fontWeight: fontSize >= 24 ? 700 : 500, color: BRAND_INK, ...cleanTypography },
    ...(ground ? { appearance: { fill: [{ type: 'solid', color: ground }] } } : {}),
  };
};


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
  appearance: { stroke: { color: HUE.slate, width: 2, cap: 'round' } },
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

const BASE_TEMPLATES: Template[] = [
  {
    id: 'bloom',
    category: 'physics',
    name: 'Bloom',
    blurb: 'Five hundred shapes on a phyllotaxis spiral. Built to exercise the force tools.',
    teaches: ['Forces', 'Radar', 'Physics'],
    objectCount: 502,
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
          appearance: {
            fill: [{ type: 'solid', color: hue(t * 0.85 + 0.05) }],
            stroke: { color: hue(t * 0.85 + 0.05, 75, 45), width: 1 },
          },
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
    objectCount: 1002,
    build: (limit) => {
      // Kept proportional when trimmed, so the thumbnail is the same surface
      // at lower resolution rather than a corner of it.
      const shrink = limit ? Math.sqrt(Math.min(1, limit / 1000)) : 1;
      const COLS = Math.max(6, Math.round(40 * shrink));
      const ROWS = Math.max(4, Math.round(25 * shrink));
      /**
       * The step grows as the grid thins, so the surface covers the same area
       * and the overall shape is recognisable at a glance.
       */
      const STEP = 44 / shrink;
      const nodes: NewNodeInput[] = [
        label(0, -170, 'Wave field', 44),
        label(0, -105, 'Forces → Attract or Repel, then drag across the surface.', 17),
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
              stroke: { color: hue(0.55 + wave * 0.12, 80, 38), width: 1 },
              cornerRadius: 0,
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
    objectCount: 139,
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
          name: 'Engineering', tint: TINT.blue,
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
          name: 'Product', tint: TINT.green,
          teams: [
            { name: 'Growth', people: ['Ana', 'Theo', 'Suri', 'Cleo', 'Marc', 'Yuki', 'Rosa'] },
            { name: 'Core', people: ['Ivo', 'Nell', 'Omar', 'Tess', 'Gus', 'Sena', 'Ada B.'] },
          ],
        },
        {
          name: 'Operations', tint: TINT.amber,
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
      const root = box(-130, -TIER_H * 2, 260, 96, 'Chief Executive', TINT.indigo, {
        typography: { fontSize: 20, fontWeight: 700, color: INK, align: 'center', verticalAlign: 'middle' },
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
          { typography: { fontSize: 18, fontWeight: 700, color: INK, align: 'center', verticalAlign: 'middle' } }
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
          typography: { fontSize: 16, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
        });
        boxes.push(teamNode);
        links.push(link(fnNodes[Math.floor(t / 2)].id as string, teamNode.id as string, { endEnd: 'none' }));

        if (!withPeople) return;
        team.people.forEach((person, k) => {
          const personNode = box(
            x + 20, 118 + k * (PERSON_H + PERSON_GAP), TEAM_W - 40, PERSON_H, person, PAPER_SOFT,
            { typography: { fontSize: 15, fontWeight: 500, color: INK_MID, align: 'center', verticalAlign: 'middle' } }
          );
          boxes.push(personNode);
          links.push(link(teamNode.id as string, personNode.id as string, { endEnd: 'none' }));
        });
      });

      // Wires first, then the tree, then the titles on top.
      return layer([...links, ...boxes, ...labels]);
    },
  },
  {
    id: 'landing',
    category: 'design',
    name: 'Landing page',
    blurb: 'A high-end modern SaaS launch page: hero split, interactive canvas mockup, bento grid, metrics and footer.',
    teaches: ['Frames', 'Layout', 'Bento grid', 'Export'],
    objectCount: 81,
    build: () => {
      const PAGE = 1440;
      const M = 80;
      const COL = PAGE - M * 2; // 1280

      const plate = (x: number, y: number, w: number, h: number, c: string, r = 0): NewNodeInput =>
        box(x, y, w, h, '', c, { appearance: { fill: [{ type: 'solid', color: c }], stroke: { color: strokeOf(c), width: 1.5 }, cornerRadius: 0 } });

      const btn = (x: number, y: number, w: number, text: string, fill: string, ink: string, r = 0): NewNodeInput =>
        box(x, y, w, 48, text, fill, {
          appearance: { fill: [{ type: 'solid', color: fill }], stroke: { color: strokeOf(fill), width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 14, fontWeight: 700, color: ink, align: 'center', verticalAlign: 'middle' },
        });

      const nodes: NewNodeInput[] = [
        frame(0, 0, PAGE, 2180, 'Desktop 1440 — High-End SaaS Launch'),

        // ---- Nav Bar ----------------------------------------------------------
        // ---- Nav Bar ----------------------------------------------------------
        plate(0, 0, PAGE, 80, PAPER, 0),
        plate(0, 80, PAGE, 1, HAIRLINE, 0),
        plate(M, 22, 36, 36, BRAND, 0),
        label(M + 46, 26, 'Vega', 20, 100, { fontWeight: 800, color: INK_STRONG, align: 'left' }),
        label(M + 260, 28, 'Product', 14, 90, { fontWeight: 600, color: INK_MID, align: 'center' }),
        label(M + 360, 28, 'Architecture', 14, 110, { fontWeight: 600, color: INK_MID, align: 'center' }),
        label(M + 480, 28, 'Enterprise', 14, 90, { fontWeight: 600, color: INK_MID, align: 'center' }),
        label(M + 580, 28, 'Changelog', 14, 90, { fontWeight: 600, color: INK_MID, align: 'center' }),
        label(PAGE - M - 230, 28, 'Sign in', 14, 80, { fontWeight: 600, color: INK_MID, align: 'center' }),
        btn(PAGE - M - 140, 16, 140, 'Get Started ↗', BRAND, BRAND_INK, 0),

        // ---- Hero Left Column -------------------------------------------------
        box(M, 130, 240, 32, '✨  ENGINE ARCHITECTURE 2.0', TINT.amber, {
          appearance: { fill: [{ type: 'solid', color: TINT.amber }], cornerRadius: 0 },
          typography: { fontSize: 11, fontWeight: 700, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
        }),
        label(M, 178, 'The collaborative canvas', 44, 620, { fontWeight: 800, color: INK_STRONG, align: 'left', letterSpacing: -1 }),
        label(M, 238, 'for system engineers.', 44, 620, { fontWeight: 800, color: '#4F46E5', align: 'left', letterSpacing: -1 }),
        label(M, 310, 'Model microservices, review live RFCs, and map infrastructure together with zero latency local-first CRDT state.', 15, 540, { fontWeight: 450, color: INK_SOFT, align: 'left', lineHeight: 1.45 }),
        btn(M, 400, 180, 'Deploy to Team ↗', BRAND, BRAND_INK, 0),
        box(M + 200, 400, 160, 48, 'Read Tech Spec', PAPER, {
          appearance: { fill: [{ type: 'solid', color: PAPER }], stroke: { color: RULE, width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 14, fontWeight: 600, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
        }),
        label(M, 470, '4.9/5 Developer Rating  ·  SOC2 Type II  ·  Local-First', 12, 480, { fontWeight: 500, color: INK_SOFT, align: 'left' }),

        // ---- Hero Right Column: Mockup Window Shell ---------------------------
        plate(680, 120, 680, 410, '#0F172A', 0),
        box(696, 134, 648, 34, 'cluster-topology.vega · 3 peers online', '#1E293B', {
          appearance: { fill: [{ type: 'solid', color: '#1E293B' }], cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 500, color: '#CBD5E1', align: 'center', verticalAlign: 'middle' },
        }),
        box(710, 145, 12, 12, '', '#EF4444', { appearance: { fill: [{ type: 'solid', color: '#EF4444' }], cornerRadius: 0 } }),
        box(728, 145, 12, 12, '', '#F59E0B', { appearance: { fill: [{ type: 'solid', color: '#F59E0B' }], cornerRadius: 0 } }),
        box(746, 145, 12, 12, '', '#10B981', { appearance: { fill: [{ type: 'solid', color: '#10B981' }], cornerRadius: 0 } }),

        // Mockup Nodes inside window
        box(710, 195, 160, 64, 'API Gateway\nKong Ingress', '#1E293B', {
          appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 600, color: '#F8FAFC', align: 'center', verticalAlign: 'middle' },
        }),
        box(900, 195, 160, 64, 'Auth Service\nGo · Envoy', '#1E293B', {
          appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 600, color: '#F8FAFC', align: 'center', verticalAlign: 'middle' },
        }),
        box(1090, 195, 160, 64, 'Redis Edge\nCluster 8x', '#1E293B', {
          appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 600, color: '#F8FAFC', align: 'center', verticalAlign: 'middle' },
        }),
        box(800, 300, 170, 64, 'PostgreSQL\nMulti-AZ Primary', '#1E293B', {
          appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 600, color: '#F8FAFC', align: 'center', verticalAlign: 'middle' },
        }),
        box(1000, 300, 170, 64, 'Kafka Pipeline\n128 Partitions', '#1E293B', {
          appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 600, color: '#F8FAFC', align: 'center', verticalAlign: 'middle' },
        }),
        box(740, 420, 160, 30, '● Elena (Staff Arch)', '#0369A1', {
          appearance: { fill: [{ type: 'solid', color: '#0369A1' }], stroke: { color: '#02527D', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 11, fontWeight: 600, color: '#FFFFFF', align: 'center', verticalAlign: 'middle' },
        }),
        box(1020, 420, 160, 30, '● Marcus (Infra)', '#6D28D9', {
          appearance: { fill: [{ type: 'solid', color: '#6D28D9' }], stroke: { color: '#561FB0', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 11, fontWeight: 600, color: '#FFFFFF', align: 'center', verticalAlign: 'middle' },
        }),

        // ---- Bento Section -----------------------------------------------------
        label(M, 560, 'Built for Concurrency & Scale', 32, 700, { fontWeight: 800, color: INK_STRONG, align: 'left' }),
        label(M, 620, 'Three technical breakthroughs delivering sub-16ms sync and zero input lag.', 15, 800, { fontWeight: 450, color: INK_SOFT, align: 'left' }),

        // Card 1: Large Asymmetric Bento
        plate(M, 660, 780, 320, TINT.indigo, 0),
        label(M + 32, 686, 'GLOBAL DISTRIBUTED MESH', 11, 240, { fontWeight: 700, color: '#4338CA', align: 'left', letterSpacing: 1.5 }),
        label(M + 32, 716, 'Sub-16ms Edge Sync', 22, 500, { fontWeight: 750, color: INK_STRONG, align: 'left' }),
        label(M + 32, 756, 'CRDT state syncs over an edge mesh. Distributed teams experience zero perceived input lag.', 14, 520, { fontWeight: 450, color: INK_MID, align: 'left', lineHeight: 1.45 }),
        box(M + 32, 830, 140, 60, '12ms\nUS-East (VA)', PAPER, {
          appearance: { fill: [{ type: 'solid', color: PAPER }], cornerRadius: 0 },
          typography: { fontSize: 11.5, fontWeight: 600, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
        }),
        box(M + 184, 830, 140, 60, '16ms\nEU-Central (DE)', PAPER, {
          appearance: { fill: [{ type: 'solid', color: PAPER }], cornerRadius: 0 },
          typography: { fontSize: 11.5, fontWeight: 600, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
        }),
        box(M + 336, 830, 140, 60, '19ms\nAP-East (JP)', PAPER, {
          appearance: { fill: [{ type: 'solid', color: PAPER }], cornerRadius: 0 },
          typography: { fontSize: 11.5, fontWeight: 600, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
        }),

        // Card 2: Stacked Top Right Bento
        plate(M + 810, 660, 470, 150, TINT.green, 0),
        label(M + 834, 674, 'Offline-First CRDT Storage', 17, 420, { fontWeight: 700, color: INK_STRONG, align: 'left' }),
        label(M + 834, 712, 'Work offline anywhere. State resolves conflict-free upon reconnection.', 13, 430, { fontWeight: 450, color: INK_MID, align: 'left' }),
        box(M + 834, 764, 180, 26, '100% Conflict-Free Sync', PAPER, {
          appearance: { fill: [{ type: 'solid', color: PAPER }], cornerRadius: 0 },
          typography: { fontSize: 11, fontWeight: 700, color: '#15803D', align: 'center', verticalAlign: 'middle' },
        }),

        // Card 3: Stacked Bottom Right Bento
        plate(M + 810, 830, 470, 150, TINT.sky, 0),
        label(M + 834, 844, 'Hardware-Accelerated WebGL', 17, 420, { fontWeight: 700, color: INK_STRONG, align: 'left' }),
        label(M + 834, 882, 'Instanced WebGL pipeline renders 50,000+ nodes locked at 60 FPS.', 13, 430, { fontWeight: 450, color: INK_MID, align: 'left' }),
        box(M + 834, 934, 160, 26, '60 FPS Frame Budget', PAPER, {
          appearance: { fill: [{ type: 'solid', color: PAPER }], cornerRadius: 0 },
          typography: { fontSize: 11, fontWeight: 700, color: '#0369A1', align: 'center', verticalAlign: 'middle' },
        }),

        // ---- Metrics Bar -------------------------------------------------------
        plate(M, 1020, COL, 96, PAPER_SOFT, 0),
        box(M + 20, 1034, 280, 68, '4.2M+\nNodes Synced Daily', PAPER_SOFT, { typography: { fontSize: 14, fontWeight: 650, color: INK_STRONG, align: 'center', verticalAlign: 'middle' } }),
        box(M + 330, 1034, 280, 68, '< 14ms\nP99 Jitter Latency', PAPER_SOFT, { typography: { fontSize: 14, fontWeight: 650, color: INK_STRONG, align: 'center', verticalAlign: 'middle' } }),
        box(M + 640, 1034, 280, 68, '99.995%\nGlobal Availability', PAPER_SOFT, { typography: { fontSize: 14, fontWeight: 650, color: INK_STRONG, align: 'center', verticalAlign: 'middle' } }),
        box(M + 950, 1034, 280, 68, '180,000+\nEngineering Users', PAPER_SOFT, { typography: { fontSize: 14, fontWeight: 650, color: INK_STRONG, align: 'center', verticalAlign: 'middle' } }),

        // ---- Testimonial Quote Card --------------------------------------------
        plate(M, 1150, COL, 200, '#0F172A', 0),
        label(M + 50, 1175, '“Vega has completely transformed our distributed architecture reviews. We moved all our system topologies, disaster recovery rehearsals, and RFC workshops onto it — the speed and collaborative polish are unmatched.”', 17, COL - 100, { fontWeight: 500, color: '#F1F5F9', align: 'left', lineHeight: 1.45, ground: '#0F172A' }),
        label(M + 50, 1262, 'Dr. Aris Thorne  ·  VP Infrastructure, CloudScale', 13, 540, { fontWeight: 600, color: '#94A3B8', align: 'left', ground: '#0F172A' }),
        box(PAGE - M - 210, 1260, 160, 30, 'Verified Enterprise', '#1E293B', {
          appearance: { fill: [{ type: 'solid', color: '#1E293B' }], cornerRadius: 0 },
          typography: { fontSize: 11, fontWeight: 600, color: '#38BDF8', align: 'center', verticalAlign: 'middle' },
        }),

        // ---- Conversion Banner -------------------------------------------------
        plate(M, 1385, COL, 180, TINT.amber, 0),
        label(M + 50, 1406, 'Design your next architecture together.', 28, 680, { fontWeight: 800, color: INK_STRONG, align: 'left' }),
        label(M + 50, 1460, 'Free for teams in 30 seconds  ·  No credit card required', 15, 680, { fontWeight: 500, color: INK_MID, align: 'left' }),
        btn(PAGE - M - 250, 1445, 200, 'Get Started Free ↗', BRAND, BRAND_INK, 0),

        // ---- Footer Section ----------------------------------------------------
        plate(0, 1600, PAGE, 1, HAIRLINE, 0),
        plate(M, 1635, 36, 36, BRAND, 0),
        label(M, 1680, 'The collaborative canvas for system architecture & RFC design.', 12, 280, { fontWeight: 450, color: INK_SOFT, align: 'left', lineHeight: 1.4 }),
        label(M, 1730, '© 2026 Vega Studio Inc.', 11, 250, { fontWeight: 400, color: INK_SOFT, align: 'left' }),
        box(M, 1765, 230, 28, '● All Systems 100% Operational', '#ECFDF5', {
          appearance: { fill: [{ type: 'solid', color: '#ECFDF5' }], cornerRadius: 0 },
          typography: { fontSize: 11, fontWeight: 600, color: '#047857', align: 'center', verticalAlign: 'middle' },
        }),

        // 4 Footer Columns
        label(480, 1635, 'Product', 13, 140, { fontWeight: 700, color: INK_STRONG, align: 'left' }),
        label(480, 1665, 'Infinite Canvas', 12, 140, { fontWeight: 450, color: INK_MID, align: 'left' }),
        label(480, 1690, 'System Modeling', 12, 140, { fontWeight: 450, color: INK_MID, align: 'left' }),
        label(480, 1715, 'Local-First CRDT', 12, 140, { fontWeight: 450, color: INK_MID, align: 'left' }),

        label(680, 1635, 'Integrations', 13, 140, { fontWeight: 700, color: INK_STRONG, align: 'left' }),
        label(680, 1665, 'GitHub & GitLab', 12, 140, { fontWeight: 450, color: INK_MID, align: 'left' }),
        label(680, 1690, 'Slack & Discord', 12, 140, { fontWeight: 450, color: INK_MID, align: 'left' }),
        label(680, 1715, 'VS Code Extension', 12, 140, { fontWeight: 450, color: INK_MID, align: 'left' }),

        label(880, 1635, 'Resources', 13, 140, { fontWeight: 700, color: INK_STRONG, align: 'left' }),
        label(880, 1665, 'Documentation', 12, 140, { fontWeight: 450, color: INK_MID, align: 'left' }),
        label(880, 1690, 'Template Gallery', 12, 140, { fontWeight: 450, color: INK_MID, align: 'left' }),
        label(880, 1715, 'Community Discord', 12, 140, { fontWeight: 450, color: INK_MID, align: 'left' }),

        label(1080, 1635, 'Security & Trust', 13, 160, { fontWeight: 700, color: INK_STRONG, align: 'left' }),
        label(1080, 1665, 'SOC2 Compliance', 12, 160, { fontWeight: 450, color: INK_MID, align: 'left' }),
        label(1080, 1690, 'Privacy Policy', 12, 160, { fontWeight: 450, color: INK_MID, align: 'left' }),
        label(1080, 1715, 'Terms of Service', 12, 160, { fontWeight: 450, color: INK_MID, align: 'left' }),
      ];

      return nodes;
    },
  },
  {
    id: 'social',
    category: 'design',
    name: 'Social kit',
    blurb: 'Multi-channel brand kit at true dimensions: story, post, and cover banner ready to batch export.',
    teaches: ['Frame presets', 'Batch export', 'Multi-format', 'Social graphics'],
    objectCount: 39,
    build: () => [
      label(0, -240, 'One idea, three formats', 36),
      label(0, -180, 'True pixel dimensions, ready to batch export for multi-channel launches.', 17),

      // ==== 1. Story / Reel (1080 x 1920) =====================================
      frame(0, 0, 1080, 1920, 'Story 1080 x 1920'),
      box(40, 40, 1000, 1840, '', '#0F172A', { appearance: { fill: [{ type: 'solid', color: '#0F172A' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 } }),
      box(90, 110, 170, 44, 'VEGA 2.0', BRAND, {
        appearance: { fill: [{ type: 'solid', color: BRAND }], stroke: { color: strokeOf(BRAND), width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 15, fontWeight: 800, color: BRAND_INK, align: 'center', verticalAlign: 'middle' },
      }),
      box(280, 114, 210, 36, 'MAJOR RELEASE', '#1E293B', {
        appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 12, fontWeight: 700, color: '#38BDF8', align: 'center', verticalAlign: 'middle', letterSpacing: 1.5 },
      }),
      label(90, 195, 'Think together\nin real time.', 54, 900, {
        fontWeight: 850,
        color: '#FFFFFF',
        align: 'left',
        lineHeight: 1.15,
        ground: '#0F172A',
      }),
      label(90, 335, 'The infinite collaborative canvas engineered for systems architecture, RFC reviews, and complex diagrams.', 22, 900, {
        fontWeight: 450,
        color: '#CBD5E1',
        align: 'left',
        lineHeight: 1.4,
        ground: '#0F172A',
      }),

      // Glass Feature Preview Container
      box(90, 460, 900, 590, '', '#1E293B', {
        appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
      }),
      label(130, 504, 'cluster-sync.edge  ·  Multi-Region', 18, 400, {
        fontWeight: 650,
        color: '#F1F5F9',
        align: 'left',
        ground: '#1E293B',
      }),
      box(800, 496, 150, 36, '● 12ms P99', '#0369A1', {
        appearance: { fill: [{ type: 'solid', color: '#0369A1' }], stroke: { color: '#02527D', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 13, fontWeight: 700, color: '#FFFFFF', align: 'center', verticalAlign: 'middle' },
      }),
      box(130, 570, 230, 100, 'API Ingress\nKong Gateway', '#0F172A', {
        appearance: { fill: [{ type: 'solid', color: '#0F172A' }], stroke: { color: '#1E293B', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 16, fontWeight: 650, color: '#F8FAFC', align: 'center', verticalAlign: 'middle' },
      }),
      box(425, 570, 230, 100, 'Auth Engine\nOIDC / JWT', '#0F172A', {
        appearance: { fill: [{ type: 'solid', color: '#0F172A' }], stroke: { color: '#1E293B', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 16, fontWeight: 650, color: '#F8FAFC', align: 'center', verticalAlign: 'middle' },
      }),
      box(720, 570, 230, 100, 'Global Cache\nRedis 8-Node', '#0F172A', {
        appearance: { fill: [{ type: 'solid', color: '#0F172A' }], stroke: { color: '#1E293B', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 16, fontWeight: 650, color: '#F8FAFC', align: 'center', verticalAlign: 'middle' },
      }),
      box(130, 710, 820, 160, '✓ Local-First CRDT Storage\n✓ Instant Multi-Region Synchronization\n✓ Native SVG / Canvas Vector Acceleration', '#0F172A', {
        appearance: { fill: [{ type: 'solid', color: '#0F172A' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 19, fontWeight: 550, color: '#E2E8F0', align: 'left', verticalAlign: 'middle', lineHeight: 1.6 },
      }),
      box(130, 900, 820, 110, '', '#1E293B', {
        appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
      }),
      label(154, 924, '“Vega has completely replaced four separate tools for our distributed engineering teams.\nThe speed is unprecedented.”', 18, 772, {
        fontWeight: 450,
        color: '#94A3B8',
        align: 'left',
        lineHeight: 1.4,
        ground: '#1E293B',
      }),

      // Stat Highlight Badges
      box(90, 1100, 430, 170, '50,000+\nNodes @ 60 FPS', '#1E293B', {
        appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 26, fontWeight: 800, color: '#38BDF8', align: 'center', verticalAlign: 'middle' },
      }),
      box(560, 1100, 430, 170, '< 16ms\nGlobal Latency', '#1E293B', {
        appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 26, fontWeight: 800, color: '#10B981', align: 'center', verticalAlign: 'middle' },
      }),

      // Bottom Swipe-Up CTA pill
      box(90, 1730, 900, 84, 'Swipe up to try Vega 2.0  ↑', BRAND, {
        appearance: { fill: [{ type: 'solid', color: BRAND }], stroke: { color: strokeOf(BRAND), width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 24, fontWeight: 800, color: BRAND_INK, align: 'center', verticalAlign: 'middle' },
      }),

      // ==== 2. Square Post (1080 x 1080) =====================================
      frame(1180, 0, 1080, 1080, 'Square post 1080'),
      box(1220, 40, 1000, 1000, '', '#0F172A', { appearance: { fill: [{ type: 'solid', color: '#0F172A' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 } }),
      box(1270, 90, 220, 36, 'BENCHMARK REPORT', '#1E293B', {
        appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 12, fontWeight: 700, color: '#FBBF24', align: 'center', verticalAlign: 'middle', letterSpacing: 1.5 },
      }),
      label(1270, 148, 'Why leading engineering teams\nare moving to Vega.', 38, 900, {
        fontWeight: 850,
        color: '#FFFFFF',
        align: 'left',
        lineHeight: 1.2,
        ground: '#0F172A',
      }),
      box(1270, 270, 900, 200, '3.4× Faster\nRFC Sign-off & System Alignment', '#1E293B', {
        appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 30, fontWeight: 800, color: '#38BDF8', align: 'center', verticalAlign: 'middle', lineHeight: 1.3 },
      }),
      box(1270, 500, 900, 240, '', '#1E293B', {
        appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
      }),
      label(1310, 540, '“We eliminated 4 separate diagram tools.\nSystem topology and live meeting discussions happen\nin the exact same workspace with zero lag.”', 22, 820, {
        fontWeight: 450,
        color: '#F1F5F9',
        align: 'left',
        lineHeight: 1.5,
        ground: '#1E293B',
      }),
      box(1270, 770, 440, 52, '@sarah_dev  ·  Staff Systems Architect', '#1E293B', {
        appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 14, fontWeight: 650, color: '#CBD5E1', align: 'center', verticalAlign: 'middle' },
      }),
      box(1890, 770, 280, 52, 'vega.dev/canvas  ↗', BRAND, {
        appearance: { fill: [{ type: 'solid', color: BRAND }], stroke: { color: strokeOf(BRAND), width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 15, fontWeight: 750, color: BRAND_INK, align: 'center', verticalAlign: 'middle' },
      }),
      label(1270, 856, '#SystemDesign   #Architecture   #CloudNative   #DeveloperTools', 14, 900, {
        fontWeight: 600,
        color: '#94A3B8',
        align: 'left',
        ground: '#0F172A',
      }),

      // ==== 3. Banner / Header (1500 x 500) ===================================
      frame(1180, 1180, 1500, 500, 'Banner 1500 x 500'),
      box(1220, 1220, 1420, 420, '', '#0F172A', { appearance: { fill: [{ type: 'solid', color: '#0F172A' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 } }),
      box(1270, 1265, 48, 48, 'V', BRAND, {
        appearance: { fill: [{ type: 'solid', color: BRAND }], stroke: { color: strokeOf(BRAND), width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 26, fontWeight: 800, color: BRAND_INK, align: 'center', verticalAlign: 'middle' },
      }),
      label(1335, 1272, 'Vega', 26, 110, {
        fontWeight: 800,
        color: '#FFFFFF',
        align: 'left',
        ground: '#0F172A',
      }),
      label(1270, 1335, 'The infinite collaborative canvas\nbuilt for serious systems engineering.', 26, 820, {
        fontWeight: 800,
        color: '#F8FAFC',
        align: 'left',
        lineHeight: 1.25,
        ground: '#0F172A',
      }),
      label(1270, 1430, 'Local-first CRDT engine  ·  Sub-16ms latency  ·  Native vector performance', 15, 820, {
        fontWeight: 500,
        color: '#CBD5E1',
        align: 'left',
        ground: '#0F172A',
      }),
      box(1270, 1495, 230, 48, 'Get Started Free  ↗', BRAND, {
        appearance: { fill: [{ type: 'solid', color: BRAND }], stroke: { color: strokeOf(BRAND), width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 14, fontWeight: 750, color: BRAND_INK, align: 'center', verticalAlign: 'middle' },
      }),
      box(2140, 1260, 450, 120, 'Microservices Architecture\nKong Ingress  →  Envoy Mesh', '#1E293B', {
        appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 16, fontWeight: 650, color: '#F8FAFC', align: 'center', verticalAlign: 'middle' },
      }),
      box(2180, 1410, 410, 120, 'Distributed Database Cluster\nPostgreSQL Multi-Region Primary', '#1E293B', {
        appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 16, fontWeight: 650, color: '#F8FAFC', align: 'center', verticalAlign: 'middle' },
      }),
    ],
  },
  {
    id: 'barchart',
    category: 'diagrams',
    name: 'Executive metrics',
    blurb: 'Real-time telemetry across 32 edge regions: active concurrency, latency distribution, and throughput.',
    teaches: ['Native charts', 'Metric cards', 'Data visualization', 'KPI tracking'],
    objectCount: 23,
    build: () => [
      label(0, -180, 'Executive Metrics & Analytics', 42),
      label(0, -120, 'Real-time telemetry across 32 edge regions: active concurrency, latency distribution, and throughput.', 17),
      box(0, -50, 260, 36, 'Q3 2026 · Global Real-Time', TINT.slate, {
        appearance: { fill: [{ type: 'solid', color: TINT.slate }], stroke: { color: strokeOf(TINT.slate), width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 13, fontWeight: 700, color: INK_MID, align: 'center', verticalAlign: 'middle' },
      }),

      // Top Metric Cards
      box(0, 10, 380, 140, '', TINT.indigo, { appearance: { fill: [{ type: 'solid', color: TINT.indigo }], stroke: { color: strokeOf(TINT.indigo), width: 1.5 }, cornerRadius: 0 } }),
      label(24, 30, 'Monthly Active Users', 13, 240, { fontWeight: 600, color: INK_MID, align: 'left' }),
      label(24, 62, '248.6k', 36, 200, { fontWeight: 800, color: INK_STRONG, align: 'left' }),
      box(240, 68, 116, 32, '▲ +24.2%', '#DCFCE7', {
        appearance: { fill: [{ type: 'solid', color: '#DCFCE7' }], stroke: { color: '#86EFAC', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 12, fontWeight: 700, color: '#15803D', align: 'center', verticalAlign: 'middle' },
      }),

      box(410, 10, 380, 140, '', TINT.sky, { appearance: { fill: [{ type: 'solid', color: TINT.sky }], stroke: { color: strokeOf(TINT.sky), width: 1.5 }, cornerRadius: 0 } }),
      label(434, 30, 'Mean Sync Latency (P99)', 13, 240, { fontWeight: 600, color: INK_MID, align: 'left' }),
      label(434, 62, '18.4ms', 36, 200, { fontWeight: 800, color: INK_STRONG, align: 'left' }),
      box(650, 68, 116, 32, '▼ -6.1ms', '#DCFCE7', {
        appearance: { fill: [{ type: 'solid', color: '#DCFCE7' }], stroke: { color: '#86EFAC', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 12, fontWeight: 700, color: '#15803D', align: 'center', verticalAlign: 'middle' },
      }),

      box(820, 10, 380, 140, '', TINT.amber, { appearance: { fill: [{ type: 'solid', color: TINT.amber }], stroke: { color: strokeOf(TINT.amber), width: 1.5 }, cornerRadius: 0 } }),
      label(844, 30, '30-Day Retention Rate', 13, 240, { fontWeight: 600, color: INK_MID, align: 'left' }),
      label(844, 62, '78.2%', 36, 200, { fontWeight: 800, color: INK_STRONG, align: 'left' }),
      box(1060, 68, 116, 32, '▲ +12.8%', '#DCFCE7', {
        appearance: { fill: [{ type: 'solid', color: '#DCFCE7' }], stroke: { color: '#86EFAC', width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 12, fontWeight: 700, color: '#15803D', align: 'center', verticalAlign: 'middle' },
      }),

      // Primary Chart
      chart(
        0, 180,
        plot('bar', {
          title: 'Weekly Canvas Throughput',
          subtitle: 'Processed CRDT transactions (thousands) vs target capacity',
          categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          series: [
            { name: 'Actual', values: [142, 198, 245, 290, 340, 110, 165] },
            { name: 'Target', values: [150, 180, 220, 260, 300, 120, 150] },
          ],
          showValues: true,
          compactNumbers: true,
          valueSuffix: 'k',
        }),
        720, 420
      ),

      // Secondary Chart
      chart(
        760, 180,
        plot('line', {
          title: 'Active Concurrency Peak',
          subtitle: 'Concurrent collaborative sessions across regions',
          categories: ['00h', '04h', '08h', '12h', '16h', '20h'],
          series: [
            { name: 'US-East', values: [1200, 850, 4200, 8900, 9400, 6100] },
            { name: 'EU-West', values: [3400, 1800, 7100, 8200, 6400, 4100] },
          ],
          showValues: false,
          yAxisLabel: 'Sessions',
        }),
        440, 420
      ),

      // Bottom SLA Summary Band
      box(0, 630, 1200, 150, '', PAPER_SOFT, {
        appearance: { fill: [{ type: 'solid', color: PAPER_SOFT }], stroke: { color: HAIRLINE, width: 1 }, cornerRadius: 0 },
      }),
      label(30, 648, 'Edge Cluster SLA & Health', 16, 400, {
        fontWeight: 700,
        color: INK_STRONG,
        align: 'left',
      }),
      box(30, 690, 260, 68, 'iad-1 · Virginia\n12.4ms avg  ·  99.998% uptime', PAPER, {
        appearance: { fill: [{ type: 'solid', color: PAPER }], stroke: { color: HAIRLINE, width: 1 }, cornerRadius: 0 },
        typography: { fontSize: 12.5, fontWeight: 600, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
      }),
      box(320, 690, 260, 68, 'fra-1 · Frankfurt\n16.1ms avg  ·  99.995% uptime', PAPER, {
        appearance: { fill: [{ type: 'solid', color: PAPER }], stroke: { color: HAIRLINE, width: 1 }, cornerRadius: 0 },
        typography: { fontSize: 12.5, fontWeight: 600, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
      }),
      box(610, 690, 260, 68, 'hnd-1 · Tokyo\n19.2ms avg  ·  99.999% uptime', PAPER, {
        appearance: { fill: [{ type: 'solid', color: PAPER }], stroke: { color: HAIRLINE, width: 1 }, cornerRadius: 0 },
        typography: { fontSize: 12.5, fontWeight: 600, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
      }),
      box(900, 690, 270, 68, 'syd-1 · Sydney\n24.8ms avg  ·  99.992% uptime', PAPER, {
        appearance: { fill: [{ type: 'solid', color: PAPER }], stroke: { color: HAIRLINE, width: 1 }, cornerRadius: 0 },
        typography: { fontSize: 12.5, fontWeight: 600, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
      }),
    ],
  },
  {
    id: 'spectrum',
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
          appearance: {
            fill: [{ type: 'solid', color: hue(t, 78, 58) }],
            stroke: { color: hue(t, 85, 42), width: 1 },
            cornerRadius: 0,
          },
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
    objectCount: 202,
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
        label(0, -160, 'Domino wall', 40),
        label(0, -96, 'Forces → Shockwave, then click near the wall.', 18),
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
    name: 'Opportunity solution tree',
    blurb: 'Outcome-driven strategic discovery. Map business goals to customer opportunities and validation experiments.',
    teaches: ['Radial layout', 'Curved routing', 'Cross-links', 'Strategic discovery'],
    objectCount: 55,
    build: () => {
      const nodes: NewNodeInput[] = [];

      const centre = box(-170, -60, 340, 120, 'TARGET OUTCOME\n65% Team Activation\nwithin 14 Days', '#FEF3C7', {
        appearance: { fill: [{ type: 'solid', color: '#FEF3C7' }], stroke: { color: strokeOf('#FEF3C7'), width: 1.5 }, cornerRadius: 0 },
        typography: { fontSize: 18, fontWeight: 800, color: INK_STRONG, align: 'center', verticalAlign: 'middle', lineHeight: 1.3 },
      });
      nodes.push(centre);

      interface Branch {
        name: string;
        tint: string;
        leaves: string[];
      }

      const BRANCHES: Branch[] = [
        {
          name: 'Frictionless First 60s',
          tint: TINT.sky,
          leaves: ['Instant guest sandbox', 'One-click invite join', 'Guided template tour'],
        },
        {
          name: 'Viral Collaboration',
          tint: TINT.green,
          leaves: ['Slack/Discord unfurl', 'Follow presenter mode', 'Live audio & cursors'],
        },
        {
          name: 'Toolchain Integrations',
          tint: TINT.violet,
          leaves: ['GitHub PR embeds', 'Figma copy-paste', 'Linear issue 2-way sync'],
        },
        {
          name: 'Engine Performance',
          tint: TINT.amber,
          leaves: ['Sub-16ms edge sync', 'Instanced GPU culling', 'Local-first CRDT'],
        },
        {
          name: 'Enterprise Security',
          tint: TINT.rose,
          leaves: ['Zero-touch SAML/SSO', 'SOC2 audit log stream', 'Air-gapped deployment'],
        },
        {
          name: 'Meeting Facilitation',
          tint: TINT.blue,
          leaves: ['Sticky cluster voting', 'Integrated sprint timer', 'Action ownership grid'],
        },
      ];

      const branchNodes: NewNodeInput[] = [];
      const leafNodesByBranch: NewNodeInput[][] = [];

      BRANCHES.forEach((branch, i) => {
        const angle = (i / BRANCHES.length) * Math.PI * 2 - Math.PI / 2;
        const bx = Math.cos(angle) * 480;
        const by = Math.sin(angle) * 380;
        const node = box(bx - 120, by - 44, 240, 88, branch.name, branch.tint, {
          appearance: { fill: [{ type: 'solid', color: branch.tint }], stroke: { color: strokeOf(branch.tint), width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 16, fontWeight: 700, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
        });
        branchNodes.push(node);
        nodes.push(node);
        nodes.push(link(centre.id as string, node.id as string, { routing: 'curved', endEnd: 'circle' }));

        const leaves: NewNodeInput[] = [];
        branch.leaves.forEach((text, j) => {
          const spread = (j - (branch.leaves.length - 1) / 2) * 0.36;
          const la = angle + spread;
          const leaf = box(
            Math.cos(la) * 880 - 105,
            Math.sin(la) * 720 - 32,
            210,
            64,
            text,
            PAPER_SOFT,
            {
              appearance: { fill: [{ type: 'solid', color: PAPER_SOFT }], stroke: { color: HAIRLINE, width: 1.5 }, cornerRadius: 0 },
              typography: { fontSize: 13, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
            }
          );
          leaves.push(leaf);
          nodes.push(leaf);
          nodes.push(link(node.id as string, leaf.id as string, { routing: 'curved' }));
        });
        leafNodesByBranch.push(leaves);
      });

      // Cross-links showing dependencies / synergies between branches
      const crossLinks = [
        link(leafNodesByBranch[0][0].id as string, leafNodesByBranch[1][0].id as string, {
          label: 'viral loop',
          routing: 'curved',
          appearance: { stroke: { color: HUE.sky, width: 1.5, cap: 'round', dash: [6, 4] } },
        }),
        link(leafNodesByBranch[2][0].id as string, leafNodesByBranch[1][0].id as string, {
          label: 'unfurl sync',
          routing: 'curved',
          appearance: { stroke: { color: HUE.violet, width: 1.5, cap: 'round', dash: [6, 4] } },
        }),
        link(leafNodesByBranch[3][0].id as string, leafNodesByBranch[1][1].id as string, {
          label: 'low latency',
          routing: 'curved',
          appearance: { stroke: { color: HUE.green, width: 1.5, cap: 'round', dash: [6, 4] } },
        }),
        link(leafNodesByBranch[4][0].id as string, leafNodesByBranch[5][2].id as string, {
          label: 'compliance',
          routing: 'curved',
          appearance: { stroke: { color: HUE.rose, width: 1.5, cap: 'round', dash: [6, 4] } },
        }),
      ];
      nodes.push(...crossLinks);

      return layer([
        label(-320, -700, 'Product Opportunity Solution Tree', 44),
        label(-320, -632, 'Outcome-driven strategic discovery. Map business goals to customer opportunities and validation experiments.', 18),
        ...nodes,
      ]);
    },
  },
  {
    id: 'flowchart',
    category: 'diagrams',
    name: 'Authentication & Session State Machine',
    blurb: 'Enterprise token validation state machine with automated refresh loop-backs, OIDC redirects, and context injection.',
    teaches: ['Decision shapes', 'Loop-backs', 'Orthogonal routing', 'State machines'],
    objectCount: 21,
    build: () => {
      const term = (x: number, y: number, text: string, fill: string) =>
        box(x, y, 240, 66, text, fill, {
          appearance: { fill: [{ type: 'solid', color: fill }], stroke: { color: strokeOf(fill), width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 13, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
        });

      const decide = (x: number, y: number, text: string) =>
        box(x, y, 230, 170, text, TINT.amber, {
          geometry: { kind: 'polygon', points: 4 },
          typography: { fontSize: 14, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
        });

      const COL = 420;

      const start = term(COL - 5, 0, 'Incoming Protected Request', TINT.indigo);
      const extract = box(COL, 130, 230, 84, 'Read Token & Session Cookie', TINT.blue, {
        typography: { fontSize: 13, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
      });
      const checkToken = decide(COL, 274, 'Token Present?');
      const redirectLogin = box(COL - 340, 274, 210, 84, 'Redirect to SSO Login', TINT.slate, {
        typography: { fontSize: 13, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
      });
      const verifySig = box(COL, 500, 230, 84, 'Verify Signature (JWKS)', TINT.blue, {
        typography: { fontSize: 13, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
      });
      const checkExpiry = decide(COL, 644, 'Token Expired?');
      const refreshToken = box(COL + 330, 644, 210, 84, 'Refresh via Redis Cache', '#FEE2E2', {
        typography: { fontSize: 13, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
      });
      const authorize = box(COL, 870, 230, 84, 'Authorize & Inject Context', TINT.green, {
        typography: { fontSize: 13, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
      });
      const done = term(COL - 5, 1004, 'Forward to Upstream Service', TINT.indigo);

      return layer([
        label(COL - 360, -160, 'Authentication & Session Flow', 44),
        label(COL - 360, -96, 'Enterprise token validation state machine with automated refresh loop-backs and OIDC redirects.', 17),

        start, extract, checkToken, redirectLogin, verifySig, checkExpiry, refreshToken, authorize, done,

        link(start.id as string, extract.id as string),
        link(extract.id as string, checkToken.id as string),

        link(checkToken.id as string, verifySig.id as string, { label: 'yes' }),
        link(checkToken.id as string, redirectLogin.id as string, { label: 'no' }),

        link(verifySig.id as string, checkExpiry.id as string),
        link(checkExpiry.id as string, authorize.id as string, { label: 'valid' }),
        link(checkExpiry.id as string, refreshToken.id as string, { label: 'expired' }),

        // Loop back: refresh climbs back up to verify signature
        link(refreshToken.id as string, verifySig.id as string, { label: 're-validate', appearance: { stroke: { color: HUE.rose, width: 2 }, sketch: 'light' } }),
        // Second loop back: login redirects back to token extraction
        link(redirectLogin.id as string, extract.id as string, { label: 'authenticated', routing: 'curved', appearance: { stroke: { color: HUE.sky, width: 2 }, sketch: 'light' } }),

        link(authorize.id as string, done.id as string),
      ]);
    },
  },
  {
    id: 'brainstorm',
    featured: true,
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
        label(0, -114, 'Double-click a note to edit it. Tab chains another one directly below.', 18),
      ];

      LANES.forEach((lane, i) => {
        const x = laneX(i);
        nodes.push(frame(x, 0, LANE_W, 1180, lane.title));
        // The lane's own instruction, inside the lane — a legend off to one
        // side is a legend nobody reads while they are working.
        nodes.push({
          id: nanoid(), type: 'text', x: x + 34, y: 54,
          width: LANE_W - 68, height: 22, text: lane.hint, resize: 'width',
          typography: { fontSize: 15, fontWeight: 500, color: HUE.slate },
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
    name: 'Agile Sprint Retrospective & Action Matrix',
    blurb: 'Sailboat & 4Ls retrospective with live reaction tallies, categorical tags, and owned action accountability matrix.',
    teaches: ['Frames as columns', 'Reaction counting', 'Sticky tags', 'Ownership matrix'],
    objectCount: 44,
    build: () => {
      const COL_W = 420;
      const COL_GAP = 30;
      const colX = (i: number) => i * (COL_W + COL_GAP);

      type Card = [string, number, string[]];

      const COLUMNS: Array<{ title: string; hint: string; theme: StickyTheme; cards: Card[] }> = [
        {
          title: '⛵ Wind in Our Sails',
          hint: 'Accelerators: what made us fast and confident.',
          theme: 'mint',
          cards: [
            ['Shipped distributed CRDT sync 2 days early! 🚀', 6, ['infra']],
            ['Zero customer regressions during v2.4 migration', 5, ['qa']],
            ['Design token sync in Figma streamlined frontend', 4, ['design']],
          ],
        },
        {
          title: '⚓ Anchors Holding Back',
          hint: 'Friction: bottlenecks that caused drag.',
          theme: 'peach',
          cards: [
            ['Flaky websocket tests blocked 3 PR merges in CI', 7, ['ci']],
            ['Export modal scope crept late into the sprint', 5, ['scope']],
            ['Daily standups ran over 25 mins without parking lot', 3, ['process']],
          ],
        },
        {
          title: '🪨 Rocks / Risks Ahead',
          hint: 'Hazards: emerging tech debt and blind spots.',
          theme: 'yellow',
          cards: [
            ['Safari WebGL memory leak when panning 10k nodes', 6, ['perf']],
            ['Developer documentation falling behind v2.4 API', 4, ['docs']],
            ['Need automated performance regression alerts', 3, ['infra']],
          ],
        },
        {
          title: '🏝 The Island / Ideas',
          hint: 'Aspirations: experiments and high-leverage bets.',
          theme: 'sky',
          cards: [
            ['Prototype canvas AI diagram copilot in Sprint 43', 8, ['ai']],
            ['Add interactive presentation slide mode', 6, ['feature']],
            ['Host monthly open office hours for community', 4, ['community']],
          ],
        },
      ];

      const nodes: NewNodeInput[] = [
        label(0, -180, 'Sprint 42 Retrospective', 44),
        label(0, -114, 'Engine v2.4 launch review. Vote to agree, identify root causes, and commit to owned actions.', 18),
      ];

      COLUMNS.forEach((column, i) => {
        const x = colX(i);
        nodes.push(frame(x, 0, COL_W, 900, column.title));
        nodes.push({
          id: nanoid(),
          type: 'text',
          x: x + 30,
          y: 52,
          width: COL_W - 60,
          height: 22,
          text: column.hint,
          resize: 'width',
          typography: { fontSize: 14, fontWeight: 500, color: HUE.slate },
        });

        column.cards.forEach(([text, votes, tags], k) => {
          nodes.push({
            ...sticky(x + 30, 96 + k * 250, text, column.theme),
            width: COL_W - 60,
            height: 220,
            tags,
            reactions: votes > 0 ? { '👍': Array.from({ length: votes }, (_, v) => `demo-r-${i}-${k}-${v}`) } : {},
          });
        });
      });

      // Action Ownership & Accountability Matrix
      const MATRIX_Y = 960;
      const MATRIX_W = COL_W * 4 + COL_GAP * 3; // 1770
      nodes.push(frame(0, MATRIX_Y, MATRIX_W, 320, 'Action Items & Ownership Matrix'));
      nodes.push({
        id: nanoid(),
        type: 'text',
        x: 32,
        y: MATRIX_Y + 46,
        width: 800,
        height: 22,
        text: 'Every action item has an explicit owner and deadline, or it is only a wish.',
        resize: 'width',
        typography: { fontSize: 14, fontWeight: 500, color: INK_MID },
      });

      const ACTIONS: Array<{ title: string; owner: string; due: string; priority: string; tint: string; ink: string }> = [
        { title: 'Fix Safari WebGL memory leak', owner: '@marcus (Lead)', due: 'Friday', priority: 'URGENT', tint: TINT.rose, ink: '#9F1239' },
        { title: 'Quarantine flaky CI websocket suite', owner: '@ana (DevOps)', due: 'Wednesday', priority: 'HIGH', tint: TINT.amber, ink: '#92400E' },
        { title: 'Hard 15-minute cap on daily standup', owner: '@sam (Scrum)', due: 'Monday', priority: 'MEDIUM', tint: TINT.green, ink: '#166534' },
        { title: 'Schedule RFC review for AI copilot', owner: '@elena (Staff)', due: 'Sprint 43', priority: 'NORMAL', tint: TINT.sky, ink: '#075985' },
      ];

      const CARD_W = (MATRIX_W - 64 - 3 * 24) / 4;
      ACTIONS.forEach((act, idx) => {
        const cx = 32 + idx * (CARD_W + 24);
        const cy = MATRIX_Y + 84;
        nodes.push(
          box(cx, cy, CARD_W, 200, '', act.tint, {
            appearance: { fill: [{ type: 'solid', color: act.tint }], stroke: { color: strokeOf(act.tint), width: 1.5 }, cornerRadius: 14 },
          }),
          {
            id: nanoid(),
            type: 'text',
            x: cx + 20,
            y: cy + 20,
            width: CARD_W - 40,
            height: 48,
            text: act.title,
            resize: 'width',
            typography: { fontSize: 16, fontWeight: 700, color: INK_STRONG, align: 'left', lineHeight: 1.3 },
          },
          {
            id: nanoid(),
            type: 'text',
            x: cx + 20,
            y: cy + 78,
            width: CARD_W - 40,
            height: 24,
            text: `Owner: ${act.owner}`,
            resize: 'width',
            typography: { fontSize: 13, fontWeight: 600, color: INK_MID, align: 'left' },
          },
          {
            id: nanoid(),
            type: 'text',
            x: cx + 20,
            y: cy + 108,
            width: CARD_W - 40,
            height: 24,
            text: `Due Date: ${act.due}`,
            resize: 'width',
            typography: { fontSize: 13, fontWeight: 500, color: INK_SOFT, align: 'left' },
          },
          box(cx + 20, cy + 146, 110, 28, act.priority, PAPER, {
            appearance: { fill: [{ type: 'solid', color: PAPER }], stroke: { color: strokeOf(act.tint), width: 1 }, cornerRadius: 14 },
            typography: { fontSize: 11, fontWeight: 800, color: act.ink, align: 'center', verticalAlign: 'middle' },
          })
        );
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
    objectCount: 87,
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

      /**
       * A caption inside a plate, in the plate's own coordinates.
       *
       * Its width is a **column**, not a paragraph. It was 260 against a
       * 190-wide column, so the third caption in every row — "Triangle",
       * "Arrow", "Radial" — ran 60 units past the plate's right edge and was
       * cut off by it: a frame clips whatever it owns, and these are inside
       * one. Wide enough for the longest word on the sheet and no wider.
       */
      const note = (col: number, row: number, dx: number, dy: number, text: string): NewNodeInput => {
        const p = at(col, row);
        return {
          id: nanoid(),
          type: 'text',
          x: p.x + dx,
          y: p.y + dy,
          width: 170,
          height: 20,
          text,
          resize: 'width',
          typography: { fontSize: 13, fontWeight: 500, color: HUE.slate },
        };
      };

      const swatch = (
        col: number, row: number, dx: number, dy: number,
        w: number, h: number, appearance: Record<string, unknown>, extra: Record<string, unknown> = {}
      ): NewNodeInput => {
        const p = at(col, row);
        const fill = appearance.fill;
        const fillColor = Array.isArray(fill) && fill[0]?.color ? fill[0].color : BRAND;
        const stroke = appearance.stroke ?? { color: strokeOf(fillColor), width: 1.5 };
        return {
          id: nanoid(),
          type: 'shape',
          x: p.x + dx,
          y: p.y + dy,
          width: w,
          height: h,
          geometry: { kind: 'rect' },
          appearance: {
            ...appearance,
            stroke,
            cornerRadius: 0,
          },
          ...extra,
        };
      };

      const nodes: NewNodeInput[] = [
        label(0, -220, 'Everything, on one sheet', 52),
        label(0, -145, 'Nine plates. Every object on them is live. Select one and change it.', 20),
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
          stroke: { color: '#A5B4FC', width: 1.5 },
        }, { geometry }));
        nodes.push(note(0, 0, dx, dy + 122, name));
      });

      // ---------------------------------------------------- 2. fills ------
      nodes.push(plate(1, 0, '2 · Every kind of fill'));
      const STOPS = [
        { offset: 0, color: BRAND },
        { offset: 1, color: HUE.indigo },
      ];
      const FILLS: Array<[string, Record<string, unknown>]> = [
        ['Solid', { type: 'solid', color: BRAND }],
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
          t(64, 'Regular 34', { fontSize: 34, fontWeight: 400, color: INK_STRONG }),
          t(120, 'Semibold 34', { fontSize: 34, fontWeight: 700, color: INK_STRONG }),
          t(176, 'Italic, underlined', { fontSize: 24, fontWeight: 400, italic: true, underline: true, color: INK_STRONG }),
          t(220, 'Struck through', { fontSize: 24, fontWeight: 400, strikethrough: true, color: HUE.slate }),
          // Shown in upper case, still stored as written — change the case
          // control back and the original text is intact.
          t(264, 'Shown in upper case', { fontSize: 24, fontWeight: 600, textCase: 'upper', color: INK_STRONG }),
          t(312, 'Letter-spaced and loose', { fontSize: 20, fontWeight: 400, letterSpacing: 3, lineHeight: 1.8, color: HUE.slate }),
          t(370, 'Centred', { fontSize: 20, fontWeight: 500, align: 'center', color: HUE.slate }),
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
          const a = box(p.x + 40, p.y + dy, 110, 62, 'From', TINT.blue);
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
          ['Hairline', { color: INK_STRONG, width: 1 }],
          ['Heavy', { color: INK_STRONG, width: 8 }],
          ['Dashed', { color: INK_STRONG, width: 3, dash: [14, 10] }],
          ['Dotted, round cap', { color: INK_STRONG, width: 5, dash: [0, 14], cap: 'round' }],
          ['Round join', { color: '#4F46E5', width: 7, join: 'round' }],
          ['Mitred join', { color: '#4F46E5', width: 7, join: 'miter' }],
        ];
        STROKES.forEach(([name, stroke], i) => {
          const isTriangle = i >= 4;
          const w = isTriangle ? 90 : 220;
          const dx = 40 + (i % 2) * 280 + (isTriangle ? 65 : 0);
          const dy = 70 + Math.floor(i / 2) * 130;
          nodes.push(swatch(2, 1, dx, dy, w, 78, {
            fill: [{ type: 'solid', color: PAPER }],
            stroke,
            cornerRadius: isTriangle ? 0 : 10,
          }, isTriangle ? { geometry: { kind: 'polygon', points: 3 } } : {}));
          nodes.push(note(2, 1, 40 + (i % 2) * 280, dy + 88, name));
        });
      }

      // ---------------------------------------------------- 7. physics ----
      nodes.push(plate(0, 2, '7 · Materials'));
      {
        const MATERIALS: Array<[string, string]> = [
          ['feather', TINT.green], ['paper', TINT.blue], ['rubber', '#FBD2E1'],
          ['wood', TINT.amber], ['stone', HAIRLINE],
        ];
        MATERIALS.forEach(([material, fill], i) => {
          const dx = 40 + (i % 3) * 190;
          const dy = 76 + Math.floor(i / 3) * 180;
          nodes.push(swatch(0, 2, dx, dy, 130, 110, {
            fill: [{ type: 'solid', color: fill }],
            cornerRadius: 14,
          }, { material, text: material, typography: { fontSize: 15, fontWeight: 600, color: INK_STRONG, align: 'center', verticalAlign: 'middle' } }));
        });
        nodes.push(note(0, 2, 40, 400, 'Arm a force, then flick one. Stone barely moves; a feather sails.'));
      }

      // ---------------------------------------------------- 8. depth ------
      nodes.push(plate(1, 2, '8 · Depth and blending'));
      {
        nodes.push(
          swatch(1, 2, 60, 90, 190, 190, { fill: [{ type: 'solid', color: BRAND }], cornerRadius: 20 }),
          // Overlapping, half-transparent, and multiplied — three different
          // ways of being "on top of" something, shown together.
          swatch(1, 2, 170, 150, 190, 190, { fill: [{ type: 'solid', color: HUE.indigo, opacity: 0.75 }], cornerRadius: 20 }),
          swatch(1, 2, 280, 210, 190, 190, { fill: [{ type: 'solid', color: SIGNAL_OK }], cornerRadius: 20, blendMode: 'multiply' }),
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
          box(p.x + 100, p.y + 170, 240, 110, 'Clipped to the frame', TINT.blue, {
            typography: { fontSize: 15, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
          }),
          note(2, 2, 50, 356, 'A frame owns what is inside it: move it and its contents travel.'),
          note(2, 2, 50, 392, 'Export this one on its own at 1x, 2x or 3x.'),
        );
      }

      return layer(nodes);
    },
  },
  {
    id: 'halftone',
    category: 'art',
    name: 'Halftone',
    blurb: 'A lit sphere printed as a thousand dots, each sized by how much light falls on it.',
    teaches: ['Scale', 'Colour', 'Generative'],
    objectCount: 1020,
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
            appearance: {
              fill: [{ type: 'solid', color: `hsl(${Math.round(h)}, ${Math.round(sat)}%, ${Math.round(l)}%)` }],
              stroke: { color: `hsl(${Math.round(h)}, ${Math.round(sat)}%, ${Math.max(10, Math.round(l) - 15)}%)`, width: 1 },
              cornerRadius: 0,
            },
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
    objectCount: 373,
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
        label(0, -110, 'A year of anything', 40),
        label(0, -50, 'One square per day. Fifty-three weeks across, seven days down.', 17),
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
            appearance: {
              fill: [{ type: 'solid', color: STEPS[step] }],
              stroke: { color: step === 0 ? '#CBD5E1' : STEPS[Math.min(step + 1, STEPS.length - 1)], width: 1 },
              cornerRadius: 0,
            },
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
    objectCount: 96,
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
          appearance: {
            fill: [{ type: 'solid', color: hue(i / COUNT, 62, 60) }],
            stroke: { color: hue(i / COUNT, 75, 40), width: 1.5 },
            cornerRadius: 0,
          },
          text: String(i + 1),
          typography: { fontSize: 22, fontWeight: 700, color: BRAND_INK, align: 'center', verticalAlign: 'middle' },
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
      return layer(nodes);
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
        label(0, -170, 'Sprint board', 44),
        label(0, -105, 'Drag a card past a lane edge and the frame it belongs to changes with it.', 17),
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
            reactions: votes > 0
              ? { '👍': Array.from({ length: votes }, (_, v) => `demo-s-${i}-${k}-${v}`) }
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
            stroke: { color: hue(i / COUNT, 80, 42), width: 1 },
            cornerRadius: 0,
          },
        });
      }
      return nodes;
    },
  },
  {
    id: 'uikit',
    category: 'design',
    name: 'Interface kit & Design Tokens',
    blurb: 'Color tokens, typography ramp, button matrices, inputs, segmented controls, status chips, and machined containers.',
    teaches: ['Design tokens', 'Machined containers', 'Button matrices', 'Color ramps'],
    objectCount: 56,
    build: () => {
      const nodes: NewNodeInput[] = [
        label(0, -170, 'Interface Kit & Design Tokens', 44),
        label(0, -105, 'Color tokens, typography ramp, button matrices, inputs, segmented controls, status chips, and machined containers.', 17),
        frame(0, 0, 1380, 1020, 'Design System Specification'),
      ];

      // ---- Section 1: Palette Ramp (Neutrals & Accents) -----------------------
      nodes.push(label(60, 40, 'Palette Ramp', 20));
      const NEUTRALS = [
        { c: '#0F172A', label: '950' },
        { c: '#334155', label: '700' },
        { c: '#64748B', label: '500' },
        { c: '#94A3B8', label: '400' },
        { c: '#E2E8F0', label: '200' },
        { c: '#F8FAFC', label: '50' },
      ];
      NEUTRALS.forEach((item, i) => {
        nodes.push(
          box(60 + i * 86, 76, 76, 56, item.label, item.c, {
            appearance: { fill: [{ type: 'solid', color: item.c }], stroke: { color: strokeOf(item.c), width: 1.5 }, cornerRadius: 0 },
            typography: { fontSize: 12, fontWeight: 700, color: i < 3 ? '#FFFFFF' : INK_STRONG, align: 'center', verticalAlign: 'middle' },
          })
        );
      });

      const ACCENTS = [
        { c: BRAND, label: 'Brand', ink: BRAND_INK },
        { c: '#DCFCE7', label: 'Online', ink: '#166534' },
        { c: '#B91C1C', label: 'Danger', ink: '#FFFFFF' },
        { c: '#1D4ED8', label: 'Blue', ink: '#FFFFFF' },
        { c: '#6D28D9', label: 'Violet', ink: '#FFFFFF' },
        { c: '#FEF3C7', label: 'Amber', ink: '#92400E' },
      ];
      ACCENTS.forEach((item, i) => {
        nodes.push(
          box(60 + i * 86, 142, 76, 56, item.label, item.c, {
            appearance: { fill: [{ type: 'solid', color: item.c }], stroke: { color: strokeOf(item.c), width: 1.5 }, cornerRadius: 0 },
            typography: { fontSize: 12, fontWeight: 700, color: item.ink, align: 'center', verticalAlign: 'middle' },
          })
        );
      });

      // ---- Section 2: Typography Scale ----------------------------------------
      nodes.push(label(60, 230, 'Typography Scale', 20));
      const TYPE: Array<[string, number]> = [
        ['Display 30 · SemiBold 650', 30],
        ['Headline 24 · SemiBold 600', 24],
        ['Title 16 · Medium 550', 16],
        ['Body 13 · Regular 400', 13],
        ['Label 11 · Medium Caps', 11],
      ];
      let ty = 268;
      TYPE.forEach(([text, size]) => {
        nodes.push(label(60, ty, text, size));
        ty += size * 1.8 + 8;
      });

      // ---- Section 3: Interactive Buttons -------------------------------------
      nodes.push(label(680, 40, 'Button Variants', 20));
      nodes.push(
        box(680, 76, 190, 44, 'Primary ↗', BRAND, {
          appearance: { fill: [{ type: 'solid', color: BRAND }], stroke: { color: strokeOf(BRAND), width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 13, fontWeight: 700, color: BRAND_INK, align: 'center', verticalAlign: 'middle' },
        }),
        box(885, 76, 190, 44, 'Secondary', '#1E293B', {
          appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 13, fontWeight: 650, color: '#F8FAFC', align: 'center', verticalAlign: 'middle' },
        }),
        box(1090, 76, 190, 44, 'Outline Button', PAPER, {
          appearance: { fill: [{ type: 'solid', color: PAPER }], stroke: { color: HAIRLINE, width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 13, fontWeight: 600, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
        }),
        box(680, 132, 190, 40, 'Ghost Button', PAPER_SOFT, {
          appearance: { fill: [{ type: 'solid', color: PAPER_SOFT }], stroke: { color: HAIRLINE, width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 13, fontWeight: 600, color: INK_MID, align: 'center', verticalAlign: 'middle' },
        }),
        box(885, 132, 190, 40, 'Destructive ✕', '#FEE2E2', {
          appearance: { fill: [{ type: 'solid', color: '#FEE2E2' }], stroke: { color: '#FECDD3', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 13, fontWeight: 700, color: '#991B1B', align: 'center', verticalAlign: 'middle' },
        }),
        box(1090, 132, 150, 36, 'Small Pill', TINT.slate, {
          appearance: { fill: [{ type: 'solid', color: TINT.slate }], stroke: { color: strokeOf(TINT.slate), width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 600, color: INK_MID, align: 'center', verticalAlign: 'middle' },
        })
      );

      // ---- Section 4: Form Fields & States ------------------------------------
      nodes.push(label(680, 200, 'Form Fields & States', 20));
      nodes.push(
        box(680, 236, 290, 44, 'name@company.com', PAPER, {
          appearance: { fill: [{ type: 'solid', color: PAPER }], stroke: { color: HAIRLINE, width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 13, fontWeight: 400, color: INK_MID, align: 'left', verticalAlign: 'middle' },
        }),
        box(990, 236, 290, 44, 'elena.rostova@cloudscale.io', PAPER, {
          appearance: { fill: [{ type: 'solid', color: PAPER }], stroke: { color: HAIRLINE, width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 13, fontWeight: 500, color: INK_STRONG, align: 'left', verticalAlign: 'middle' },
        }),
        box(680, 292, 290, 44, 'invalid-domain.xyz', '#FEF2F2', {
          appearance: { fill: [{ type: 'solid', color: '#FEF2F2' }], stroke: { color: '#FECDD3', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 13, fontWeight: 500, color: '#991B1B', align: 'left', verticalAlign: 'middle' },
        }),
        box(990, 292, 290, 44, '🔍  Search components, tokens...', PAPER_SOFT, {
          appearance: { fill: [{ type: 'solid', color: PAPER_SOFT }], stroke: { color: HAIRLINE, width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 13, fontWeight: 450, color: INK_MID, align: 'left', verticalAlign: 'middle' },
        })
      );

      // ---- Section 5: Segmented Controls & Chips ------------------------------
      nodes.push(label(60, 560, 'Segmented Controls & Status Chips', 20));
      nodes.push(
        box(60, 600, 360, 44, '', TINT.slate, { appearance: { fill: [{ type: 'solid', color: TINT.slate }], stroke: { color: strokeOf(TINT.slate), width: 1.5 }, cornerRadius: 0 } }),
        box(64, 604, 110, 36, 'Design', PAPER, {
          appearance: { fill: [{ type: 'solid', color: PAPER }], stroke: { color: HAIRLINE, width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 13, fontWeight: 700, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
        }),
        box(180, 604, 110, 36, 'Prototype', TINT.slate, { appearance: { fill: [{ type: 'solid', color: TINT.slate }], stroke: { color: strokeOf(TINT.slate), width: 1.5 }, cornerRadius: 0 }, typography: { fontSize: 13, fontWeight: 500, color: INK_MID, align: 'center', verticalAlign: 'middle' } }),
        box(296, 604, 110, 36, 'Code', TINT.slate, { appearance: { fill: [{ type: 'solid', color: TINT.slate }], stroke: { color: strokeOf(TINT.slate), width: 1.5 }, cornerRadius: 0 }, typography: { fontSize: 13, fontWeight: 500, color: INK_MID, align: 'center', verticalAlign: 'middle' } })
      );

      nodes.push(
        box(60, 664, 130, 36, '● Operational', '#ECFDF5', {
          appearance: { fill: [{ type: 'solid', color: '#ECFDF5' }], stroke: { color: strokeOf('#ECFDF5'), width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 700, color: '#047857', align: 'center', verticalAlign: 'middle' },
        }),
        box(200, 664, 130, 36, '● Syncing', '#EFF6FF', {
          appearance: { fill: [{ type: 'solid', color: '#EFF6FF' }], stroke: { color: strokeOf('#EFF6FF'), width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 700, color: '#1D4ED8', align: 'center', verticalAlign: 'middle' },
        }),
        box(340, 664, 130, 36, '▲ Degraded', '#FFFBEB', {
          appearance: { fill: [{ type: 'solid', color: '#FFFBEB' }], stroke: { color: strokeOf('#FFFBEB'), width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 700, color: '#B45309', align: 'center', verticalAlign: 'middle' },
        }),
        box(480, 664, 130, 36, '✕ Offline', '#FEF2F2', {
          appearance: { fill: [{ type: 'solid', color: '#FEF2F2' }], stroke: { color: strokeOf('#FEF2F2'), width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 700, color: '#B91C1C', align: 'center', verticalAlign: 'middle' },
        })
      );

      // ---- Section 6: Double-Bezel Hardware Container -------------------------
      nodes.push(label(680, 360, 'Machined Double-Bezel Container Specimen', 20));
      nodes.push(
        box(680, 400, 600, 320, '', '#0F172A', { appearance: { fill: [{ type: 'solid', color: '#0F172A' }], stroke: { color: '#1E293B', width: 1.5 }, cornerRadius: 0 } }),
        box(696, 416, 568, 288, '', '#1E293B', { appearance: { fill: [{ type: 'solid', color: '#1E293B' }], stroke: { color: '#334155', width: 1.5 }, cornerRadius: 0 } }),
        box(716, 436, 528, 36, 'Hardware-Machined Bezel  ·  Physical tactile depth', '#0F172A', {
          appearance: { fill: [{ type: 'solid', color: '#0F172A' }], stroke: { color: '#1E293B', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 600, color: '#CBD5E1', align: 'center', verticalAlign: 'middle' },
        }),
        box(716, 490, 250, 40, 'Collaborators (4 active)', '#0F172A', {
          appearance: { fill: [{ type: 'solid', color: '#0F172A' }], stroke: { color: '#1E293B', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 600, color: '#CBD5E1', align: 'center', verticalAlign: 'middle' },
        }),
        box(986, 490, 258, 40, '99.995% Availability', '#0F172A', {
          appearance: { fill: [{ type: 'solid', color: '#0F172A' }], stroke: { color: '#1E293B', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12, fontWeight: 600, color: '#CBD5E1', align: 'center', verticalAlign: 'middle' },
        }),
        box(716, 550, 528, 120, '“Machined hardware aesthetics:\nNested containers provide physical tactile depth on the canvas, eliminating flat digital monotony without adding heavy artificial drop shadows.”', '#0F172A', {
          appearance: { fill: [{ type: 'solid', color: '#0F172A' }], stroke: { color: '#1E293B', width: 1.5 }, cornerRadius: 0 },
          typography: { fontSize: 12.5, fontWeight: 450, color: '#E2E8F0', align: 'left', verticalAlign: 'middle', lineHeight: 1.45 },
        })
      );

      // ---- Section 7: Avatars & Presence Tokens -------------------------------
      nodes.push(label(60, 730, 'Avatar & Presence Indicators', 20));
      nodes.push(
        box(60, 770, 50, 50, 'AR', '#1D4ED8', { appearance: { fill: [{ type: 'solid', color: '#1D4ED8' }], stroke: { color: strokeOf('#1D4ED8'), width: 1.5 }, cornerRadius: 0 }, typography: { fontSize: 15, fontWeight: 700, color: '#FFFFFF', align: 'center', verticalAlign: 'middle' } }),
        box(120, 770, 50, 50, 'SK', '#047857', { appearance: { fill: [{ type: 'solid', color: '#047857' }], stroke: { color: strokeOf('#047857'), width: 1.5 }, cornerRadius: 0 }, typography: { fontSize: 15, fontWeight: 700, color: '#FFFFFF', align: 'center', verticalAlign: 'middle' } }),
        box(180, 770, 50, 50, 'EL', '#6D28D9', { appearance: { fill: [{ type: 'solid', color: '#6D28D9' }], stroke: { color: strokeOf('#6D28D9'), width: 1.5 }, cornerRadius: 0 }, typography: { fontSize: 15, fontWeight: 700, color: '#FFFFFF', align: 'center', verticalAlign: 'middle' } }),
        box(240, 770, 50, 50, '+8', '#334155', { appearance: { fill: [{ type: 'solid', color: '#334155' }], stroke: { color: strokeOf('#334155'), width: 1.5 }, cornerRadius: 0 }, typography: { fontSize: 14, fontWeight: 700, color: '#F8FAFC', align: 'center', verticalAlign: 'middle' } }),
        box(310, 775, 270, 40, 'Live Multi-User Cursors Active', PAPER, { appearance: { fill: [{ type: 'solid', color: PAPER }], stroke: { color: HAIRLINE, width: 1.5 }, cornerRadius: 0 }, typography: { fontSize: 13, fontWeight: 600, color: INK_MID, align: 'center', verticalAlign: 'middle' } })
      );

      return nodes;
    },
  },
  {
    id: 'pachinko',
    category: 'physics',
    name: 'Pachinko',
    blurb: 'A pin board with walls and bins. Latch Drop above it and watch the balls sort themselves.',
    teaches: ['Locked obstacles', 'Latched force', 'Collisions'],
    objectCount: 146,
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
      const fixture = (x: number, y: number, w: number, h: number, color = RULE): NewNodeInput => ({
        id: nanoid(), type: 'shape', x, y, width: w, height: h,
        geometry: { kind: 'rect' },
        appearance: { fill: [{ type: 'solid', color }], stroke: { color: strokeOf(color), width: 1 }, cornerRadius: 0 },
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
            appearance: { fill: [{ type: 'solid', color: INK_FAINT }], stroke: { color: strokeOf(INK_FAINT), width: 1 } },
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
        nodes.push(fixture(-halfWidth + i * binWidth - 6, fieldBottom + 90, 12, 190, HAIRLINE));
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
          appearance: {
            fill: [{ type: 'solid', color: hue(i / balls, 74, 60) }],
            stroke: { color: hue(i / balls, 80, 42), width: 1 },
          },
          material: 'rubber',
        });
      }

      nodes.unshift(
        label(-halfWidth - 40, -535, 'Pachinko', 44),
        label(-halfWidth - 40, -470, 'Forces → Drop, set to Latch. Click above the pins and watch them sort.', 17),
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
        [0, Q + ROW_GAP, 'Fill-in: when there is room', PAPER_SOFT],
        [Q + COL_GAP, Q + ROW_GAP, 'Thankless: say no', '#FEF2F2'],
      ];

      /** A hairline axis rule. */
      const axis = (x: number, y: number, w: number, h: number): NewNodeInput => ({
        id: nanoid(), type: 'shape', x, y, width: w, height: h,
        geometry: { kind: 'rect' },
        appearance: { fill: [{ type: 'solid', color: INK_FAINT }], stroke: { color: strokeOf(INK_FAINT), width: 1 }, cornerRadius: 0 },
      });

      /** An axis end-stop, set small and spaced so it reads as a scale mark. */
      const tick = (x: number, y: number, text: string): NewNodeInput => ({
        id: nanoid(), type: 'text', x, y, width: 260, height: 22, text, resize: 'width',
        typography: { fontSize: 16, fontWeight: 700, color: HUE.slate, letterSpacing: 2, textCase: 'upper' },
      });

      const nodes: NewNodeInput[] = [
        label(-300, -230, 'Impact and effort', 44),
        label(-300, -165, 'Position is the argument. Drag a note and you have changed your mind in public.', 18),
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
        tick(SPAN_X - 190, SPAN_Y + 96, 'High effort')
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

/**
 * Every board in the gallery, in the order the "All" view falls back to.
 *
 * Split across files by *what they are*, not to keep any one file short:
 * `systemTemplates` are real architectures, `workTemplates` the boards a team
 * keeps, `artTemplates` the drawings, and the two data files the plots and
 * tables. A new board goes in the file whose subject it shares, and nowhere
 * needs editing but that file and this line.
 */
export const TEMPLATES: Template[] = [
  ...SYSTEM_TEMPLATES,
  ...WORK_TEMPLATES,
  ...BASE_TEMPLATES,
  ...SCIENCE_TEMPLATES,
  ...TABLE_TEMPLATES,
  ...ART_TEMPLATES,
];

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
