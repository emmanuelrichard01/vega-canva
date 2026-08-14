import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../document/mutations';
import type { AnyNode, StickyTheme } from '../model/schema';
import { buildPreview, type BoardPreview } from '../model/boardPreview';
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
      const COUNT = Math.min(500, limit ?? 500);
      const nodes: NewNodeInput[] = [
        label(-120, -420, 'Bloom', 44),
        label(-120, -360, 'Five hundred objects.', 18),
      ];

      for (let i = 0; i < COUNT; i += 1) {
        const t = i / COUNT;
        const radius = 16 * Math.sqrt(i);
        const angle = i * GOLDEN_ANGLE;
        // Size falls off toward the rim, so the eye reads depth rather than a
        // flat disc of identical dots.
        const size = 26 - t * 12;
        nodes.push({
          id: nanoid(),
          type: 'shape',
          x: Math.cos(angle) * radius - size / 2,
          y: Math.sin(angle) * radius - size / 2,
          width: size,
          height: size,
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
      const STEP = 46;
      const nodes: NewNodeInput[] = [
        label(0, -140, 'Wave field', 44),
        label(0, -80, 'One thousand objects. Only what is in view is drawn.', 18),
      ];

      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          // Two sine waves at right angles: the interference is what turns a
          // grid into a surface with hills in it.
          const wave = Math.sin(col / 5) * Math.cos(row / 4);
          const size = 20 + (wave + 1) * 9;
          nodes.push({
            id: nanoid(),
            type: 'shape',
            x: col * STEP + (STEP - size) / 2,
            y: row * STEP + (STEP - size) / 2 + wave * 14,
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
    blurb: 'Four tiers, wired throughout. Every connector re-routes as boxes move.',
    teaches: ['Connectors at scale', 'Frames', 'Layout'],
    objectCount: 120,
    build: (limit) => {
      const nodes: NewNodeInput[] = [label(0, -140, 'Org chart', 44)];
      const tiers = limit && limit < 120 ? [1, 4, 12] : [1, 4, 12, 32];
      const rows: NewNodeInput[][] = [];

      tiers.forEach((count, tier) => {
        const row: NewNodeInput[] = [];
        const width = tier === 0 ? 220 : 150;
        const gap = tier === 0 ? 0 : 40;
        const totalWidth = count * width + (count - 1) * gap;
        for (let i = 0; i < count; i += 1) {
          row.push(
            box(
              -totalWidth / 2 + i * (width + gap),
              tier * 260,
              width,
              tier === 0 ? 90 : 70,
              tier === 0 ? 'Everyone' : `Team ${tier}.${i + 1}`,
              ['#DBEAFE', '#DCFCE7', '#FEF3C7', '#FBD2E1'][tier]
            )
          );
        }
        rows.push(row);
        nodes.push(...row);
      });

      // Each tier fans out from its parent, so the connectors have real work to
      // do — a hundred arrows all re-routing the instant a box is dragged.
      for (let tier = 1; tier < rows.length; tier += 1) {
        rows[tier].forEach((child, i) => {
          const parent = rows[tier - 1][Math.floor(i / (rows[tier].length / rows[tier - 1].length))];
          nodes.push(link(parent.id as string, child.id as string, { endEnd: 'none' }));
        });
      }
      return nodes;
    },
  },
  {
    id: 'landing',
    category: 'design',
    name: 'Landing page',
    blurb: 'A desktop wireframe at 1440px. The frame exports directly to PNG.',
    teaches: ['Frames', 'Layout', 'Export'],
    build: () => {
      const PAGE = 1440;
      const block = (y: number, h: number, w = PAGE - 160, x = 80, c = '#E2E8F0') =>
        box(x, y, w, h, '', c);

      return [
        // A frame at a real screen size, so "export this" produces a real asset.
        frame(0, 0, PAGE, 1600, 'Desktop — 1440'),
        block(40, 64, PAGE - 160, 80, '#CBD5E1'),
        label(100, 200, 'Headline goes here', 56),
        label(100, 290, 'One sentence of supporting copy that explains the product.', 22),
        box(100, 360, 200, 56, 'Get started', '#161616', {
          typography: { fontSize: 17, fontWeight: 600, color: '#FFFFFF', align: 'center', verticalAlign: 'middle' },
        }),
        block(470, 380, PAGE - 200, 100, '#F1F5F9'),
        ...[0, 1, 2].map((i) => block(920, 260, 380, 100 + i * 420)),
        ...[0, 1, 2].map((i) => label(120 + i * 420, 950, 'Feature ' + (i + 1), 24)),
        block(1300, 200, PAGE - 200, 100, '#CBD5E1'),
      ];
    },
  },
  {
    id: 'social',
    category: 'design',
    name: 'Social kit',
    blurb: 'Square post, story and banner at their true dimensions, ready to batch export.',
    teaches: ['Frame presets', 'Batch export', 'Multi-format'],
    build: () => [
      label(0, -120, 'One idea, three formats', 36),
      // The three sizes a campaign actually needs, at true pixel dimensions —
      // so what you draw here is what gets posted.
      frame(0, 0, 1080, 1080, 'Square post — 1080'),
      box(90, 320, 900, 220, 'Your headline', '#FDE68A', {
        typography: { fontSize: 64, fontWeight: 700, color: '#161616', align: 'center', verticalAlign: 'middle' },
      }),
      box(90, 590, 900, 96, 'A supporting line', '#FFFFFF', {
        typography: { fontSize: 28, fontWeight: 500, color: '#475569', align: 'center', verticalAlign: 'middle' },
      }),

      frame(1180, 0, 1080, 1920, 'Story — 1080 x 1920'),
      box(1270, 760, 900, 260, 'Your headline', '#BFDBFE', {
        typography: { fontSize: 64, fontWeight: 700, color: '#161616', align: 'center', verticalAlign: 'middle' },
      }),

      frame(2360, 0, 1500, 500, 'Banner — 1500 x 500'),
      box(2440, 170, 1340, 160, 'Your headline', '#FBCFE8', {
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
      const ROWS = Math.min(10, limit ? Math.max(2, Math.floor(limit / COLS)) : 10);
      const W = 78;
      const H = 44;
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
    blurb: 'A decision tree with labelled branches and live connector routing.',
    teaches: ['Connectors', 'Shapes', 'Routing'],
    build: () => {
      const start = box(520, 120, 200, 80, 'Idea', '#DBEAFE');
      const check = box(520, 300, 200, 100, 'Worth doing?', '#FEF3C7');
      const yes = box(300, 520, 200, 80, 'Build it', '#DCFCE7');
      const no = box(760, 520, 200, 80, 'Park it', '#FEE2E2');
      const ship = box(300, 700, 200, 80, 'Ship', '#DBEAFE');

      return [
        label(300, 40, 'Drag a box to see the connectors re-route', 22),
        start, check, yes, no, ship,
        link(start.id as string, check.id as string),
        // Labelled, because the two branches out of a decision are the one
        // place an unlabelled arrow genuinely loses information.
        link(check.id as string, yes.id as string, { label: 'yes' }),
        link(check.id as string, no.id as string, { label: 'no' }),
        link(yes.id as string, ship.id as string, { routing: 'curved' }),
      ];
    },
  },
  {
    id: 'brainstorm',
    category: 'thinking',
    name: 'Brainstorm',
    blurb: 'Notes grouped in frames, with tags and reactions. Tab chains a new note.',
    teaches: ['Sticky notes', 'Frames', 'Tab-chaining'],
    build: () => {
      const ideas: Array<[string, StickyTheme, string[]]> = [
        ['Faster onboarding', 'yellow', ['ux']],
        ['Fewer clicks to share', 'mint', ['ux']],
        ['Offline first', 'sky', ['infra']],
        ['Keyboard for everything', 'lavender', ['ux', 'a11y']],
        ['Templates', 'peach', []],
        ['Better search', 'pink', ['infra']],
      ];

      const notes = ideas.map(([text, theme, tags], i) => ({
        ...sticky(340 + (i % 3) * 210, 300 + Math.floor(i / 3) * 210, text, theme),
        tags,
        // A couple of notes already carry a reaction, so the mechanism is
        // visible as something the board does rather than something you have
        // to be told about.
        ...(i === 0 ? { reactions: { '👍': ['demo-a', 'demo-b'] }, pinned: true } : {}),
        ...(i === 3 ? { reactions: { '🔥': ['demo-a'] } } : {}),
      }));

      return [
        label(320, 120, 'What should we build next?', 32),
        label(320, 172, 'Double-click to edit. Tab chains another note.', 16),
        frame(300, 260, 660, 440, 'Ideas'),
        ...notes,
        // A second, empty frame: the board shows you where the next round of
        // thinking goes instead of leaving you to invent the structure.
        frame(1010, 260, 380, 440, 'Parked'),
        sticky(1110, 320, 'Park notes here', 'white'),
      ];
    },
  },
  {
    id: 'retro',
    category: 'thinking',
    name: 'Retro',
    blurb: 'Three framed columns, seeded with notes carrying authors and reactions.',
    teaches: ['Frames as columns', 'Reactions', 'Collaboration'],
    build: () => {
      const columns = [
        { title: 'Went well', x: 260, theme: 'mint' as StickyTheme, seed: 'Shipped the editor', second: 'Design review was quick', hot: true },
        { title: 'Went badly', x: 700, theme: 'peach' as StickyTheme, seed: 'Too many meetings', second: 'Flaky tests again', hot: false },
        { title: 'Try next', x: 1140, theme: 'sky' as StickyTheme, seed: 'Pair on the hard parts', second: 'Timebox the spikes', hot: false },
      ];

      return [
        label(260, 90, 'Sprint retro', 34),
        label(260, 142, 'One note per point. React to agree.', 16),
        ...columns.flatMap((column) => [
          frame(column.x, 200, 380, 560, column.title),
          {
            ...sticky(column.x + 100, 260, column.seed, column.theme),
            reactions: column.hot ? { '👍': ['demo-a', 'demo-b', 'demo-c'] } : {},
          },
          sticky(column.x + 100, 470, column.second, column.theme),
        ]),
      ];
    },
  },
  {
    id: 'canvas-tour',
    category: 'thinking',
    name: 'Take the tour',
    blurb: 'One of each object type, labelled, on a single board.',
    teaches: ['All tools', 'Panels', 'Navigation'],
    build: () => {
      const a = box(340, 460, 160, 90, 'From', '#DBEAFE');
      const b = box(660, 460, 160, 90, 'To', '#FEE2E2');
      const c = box(340, 640, 160, 90, 'Curved', '#DCFCE7');

      return [
        label(300, 120, 'Everything on one board', 36),
        label(300, 180, 'Every object here is editable.', 18),

        // Connectors, with all three routings side by side so the difference
        // is visible rather than described.
        frame(300, 380, 580, 400, 'Connectors'),
        a, b, c,
        link(a.id as string, b.id as string, { label: 'orthogonal' }),
        link(a.id as string, c.id as string, { routing: 'curved', endEnd: 'circle' }),

        // Shapes, one of each kind the tool offers.
        frame(940, 380, 520, 400, 'Shapes'),
        box(980, 440, 140, 140, '', '#DBEAFE'),
        box(1150, 440, 140, 140, '', '#DCFCE7', { geometry: { kind: 'ellipse' } }),
        box(1320, 440, 110, 140, '', '#FEF3C7', { geometry: { kind: 'polygon', points: 6 } }),
        box(980, 620, 140, 140, '', '#FBD2E1', { geometry: { kind: 'star', points: 5, innerRadius: 0.45 } }),
        box(1150, 620, 140, 140, '', '#DDD5F8', { geometry: { kind: 'polygon', points: 3 } }),

        // Notes, showing the palette and the two things they carry.
        frame(300, 840, 1160, 300, 'Notes'),
        { ...sticky(360, 900, 'Tags group notes', 'yellow'), tags: ['demo'] },
        { ...sticky(570, 900, 'Reactions count votes', 'mint'), reactions: { '👍': ['demo-a', 'demo-b'] } },
        { ...sticky(780, 900, 'Pin the important one', 'sky'), pinned: true },
        sticky(990, 900, 'Tab makes the next one', 'lavender'),
        sticky(1200, 900, 'Eight papers to choose from', 'peach'),

        label(300, 1200, 'Select an object to see its properties on the right.', 18),
      ];
    },
  },
];

/** How many nodes a thumbnail is allowed to ask for. */
const PREVIEW_NODE_LIMIT = 90;

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

  return buildPreview(nodes, previewColorOf, (node) => previewPointsOf(node, byId));
}
