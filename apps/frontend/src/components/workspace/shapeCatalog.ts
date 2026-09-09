import type { ShapeGeometry, ShapeKind } from '../../engine/model/schema';

/**
 * Every shape the product offers, described once.
 *
 * ## Why one table
 *
 * A shape had five descriptions of itself and they had already stopped
 * agreeing. `shapePresetTypes` held its label; `railConstants` held a second
 * label, and called the capsule "Capsule (Pill)" while the dock called it
 * "Capsule"; `CanvasContextMenu` held a third; `shapeIcons` held a hand-drawn
 * picture of it; and the geometry that the picture was supposed to be a picture
 * *of* lived somewhere else again. The Database tile is what that costs: its
 * icon drew a stack of disks, its recipe created a plain cylinder, and both had
 * been shipped that way for as long as the tile existed.
 *
 * So a shape is one entry. What it is called, what it does in one line, what a
 * search should match, **what placing it creates**, and the box its glyph is
 * drawn in. The picture is not in here because the picture is not a separate
 * fact: `ShapeIcon` draws the recipe through the same geometry the board uses,
 * so a tile cannot promise a shape the canvas will not draw.
 *
 * ## Presets and kinds are not the same list
 *
 * `ShapeKind` is what the *document* can hold. A preset is what the *dock*
 * offers, and the two differ in both directions: a pentagon, a hexagon and an
 * octagon are one `polygon` kind at three side counts, and a rounded rectangle
 * is a `rect` with a corner radius rather than a kind of its own — because a
 * rectangle you have rounded and a rounded rectangle you have squared should be
 * the same object, and a separate kind makes them two.
 */

export interface ShapeEntry {
  /** Stable id. Also the tool id, as `shape-<preset>`. */
  preset: string;
  /** Sentence case, and the only name this shape has anywhere in the product. */
  label: string;
  /** One line, shown in the picker's preview bar. What it is, or what it means. */
  hint: string;
  /** Extra words a search should match — the name somebody else's tool uses. */
  keywords?: readonly string[];
  /** What placing this preset creates. The tool and the glyph both read it. */
  geometry: ShapeGeometry;
  /**
   * A corner radius to seed, as a share of the shape's shorter side.
   *
   * A ratio rather than the pixel value the document stores, because the two
   * things that need it are a shape somebody has just dragged out at any size
   * and a glyph 21 units across. A fixed 16px seeds a corner that is a gentle
   * curve on a banner and a full capsule on a chip, and draws as very nearly a
   * square in the toolbar — so the tile would not look like the thing it
   * makes. The radius is converted once, at the size it applies to, and after
   * that it is an ordinary stored value that resizing does not touch.
   */
  cornerRadiusRatio?: number;
  /**
   * The proportions the glyph is drawn at, inside a 24-unit square.
   *
   * A shape whose whole identity is its proportion — a capsule, a phone, a
   * browser window — reads as something else in a square. Absent is square,
   * which is right for most of them.
   */
  glyph?: readonly [number, number];
}

const SQUARE = undefined;

/**
 * The shapes, in one flat list.
 *
 * Ordered by family for reading, not for display: the categories below decide
 * what appears where, and a shape may be in more than one of them.
 */
export const SHAPE_ENTRIES = [
  // -- Basic --------------------------------------------------------------
  {
    preset: 'rect',
    label: 'Rectangle',
    hint: 'Four right angles. The default container for anything.',
    keywords: ['box', 'square', 'process', 'block'],
    geometry: { kind: 'rect' },
    glyph: [22, 16],
  },
  {
    preset: 'rounded_rect',
    label: 'Rounded rectangle',
    hint: 'A rectangle with softened corners. The radius stays editable.',
    keywords: ['box', 'card', 'button', 'soft'],
    geometry: { kind: 'rect' },
    cornerRadiusRatio: 0.18,
    glyph: [22, 16],
  },
  {
    preset: 'squircle',
    label: 'Squircle',
    hint: 'A superellipse: straighter sides than a rounded corner, no visible join.',
    keywords: ['superellipse', 'continuous', 'ios', 'app icon'],
    geometry: { kind: 'squircle' },
    glyph: SQUARE,
  },
  {
    preset: 'ellipse',
    label: 'Ellipse',
    hint: 'A circle, or an oval when the box is not square.',
    keywords: ['circle', 'oval', 'round', 'dot'],
    geometry: { kind: 'ellipse' },
    glyph: SQUARE,
  },
  {
    preset: 'capsule',
    label: 'Capsule',
    hint: 'Semicircular ends on straight sides. The flowchart terminator.',
    keywords: ['pill', 'stadium', 'lozenge', 'terminator', 'start', 'end'],
    geometry: { kind: 'capsule' },
    glyph: [24, 13],
  },
  {
    preset: 'semicircle',
    label: 'Semicircle',
    hint: 'A half disc, flat edge down.',
    keywords: ['half circle', 'dome', 'arch', 'half moon'],
    geometry: { kind: 'semicircle' },
    glyph: [24, 13],
  },
  {
    preset: 'triangle',
    label: 'Triangle',
    hint: 'Apex at the top, base across the bottom.',
    keywords: ['3', 'three', 'delta', 'play'],
    geometry: { kind: 'polygon', points: 3 },
    glyph: SQUARE,
  },
  {
    preset: 'right_triangle',
    label: 'Right triangle',
    hint: 'The right angle at the bottom left, hypotenuse from the top.',
    keywords: ['corner', 'wedge', 'ramp', '90'],
    geometry: { kind: 'right_triangle' },
    glyph: SQUARE,
  },
  {
    preset: 'diamond',
    label: 'Diamond',
    hint: 'A rhombus on its point. The flowchart decision.',
    keywords: ['rhombus', 'decision', 'branch', 'if'],
    geometry: { kind: 'diamond' },
    glyph: SQUARE,
  },

  // -- Polygons -----------------------------------------------------------
  {
    preset: 'pentagon',
    label: 'Pentagon',
    hint: 'Five equal sides, first point at the top.',
    keywords: ['5', 'five'],
    geometry: { kind: 'polygon', points: 5 },
    glyph: SQUARE,
  },
  {
    preset: 'hexagon',
    label: 'Hexagon',
    hint: 'Six equal sides, point up. Tiles without gaps.',
    keywords: ['6', 'six', 'honeycomb', 'tile'],
    geometry: { kind: 'polygon', points: 6 },
    glyph: SQUARE,
  },
  {
    preset: 'octagon',
    label: 'Octagon',
    hint: 'Eight equal sides. Reads as a stop.',
    keywords: ['8', 'eight', 'stop'],
    geometry: { kind: 'polygon', points: 8 },
    glyph: SQUARE,
  },
  {
    preset: 'star',
    label: 'Star',
    hint: 'Five points at the golden ratio. The count and the depth are editable.',
    keywords: ['favourite', 'favorite', 'rating', 'spark'],
    geometry: { kind: 'star', points: 5, innerRatio: 0.382 },
    glyph: SQUARE,
  },
  {
    preset: 'badge',
    label: 'Seal',
    hint: 'A disc with scalloped edges. An award or a certificate mark.',
    keywords: ['badge', 'rosette', 'certificate', 'award', 'stamp', 'scallop'],
    geometry: { kind: 'badge', points: 12 },
    glyph: SQUARE,
  },
  {
    preset: 'cross',
    label: 'Cross',
    hint: 'Four arms of equal thickness at any aspect.',
    keywords: ['plus', 'add', 'medical', 'health', 'intersection'],
    geometry: { kind: 'cross' },
    glyph: SQUARE,
  },
  {
    preset: 'donut',
    label: 'Ring',
    hint: 'A disc with a concentric hole. The hole is editable.',
    keywords: ['donut', 'doughnut', 'annulus', 'torus', 'washer', 'loop'],
    geometry: { kind: 'donut' },
    glyph: SQUARE,
  },

  // -- Flowchart ----------------------------------------------------------
  {
    preset: 'parallelogram',
    label: 'Parallelogram',
    hint: 'Leaning sides. The flowchart symbol for data in or out.',
    keywords: ['data', 'io', 'input', 'output', 'slant', 'skew'],
    geometry: { kind: 'parallelogram' },
    glyph: [24, 16],
  },
  {
    preset: 'trapezoid',
    label: 'Trapezoid',
    hint: 'A narrower top edge. The flowchart manual operation.',
    keywords: ['trapezium', 'manual operation', 'funnel'],
    geometry: { kind: 'trapezoid' },
    glyph: [24, 16],
  },
  {
    preset: 'preparation',
    label: 'Preparation',
    hint: 'A flat-topped hexagon. Set-up before a process runs.',
    keywords: ['setup', 'initialise', 'initialize', 'hexagon', 'flat'],
    geometry: { kind: 'preparation' },
    glyph: [24, 15],
  },
  {
    preset: 'chevron',
    label: 'Chevron',
    hint: 'A step in a sequence, notched to sit against the next one.',
    keywords: ['process', 'step', 'stage', 'pipeline', 'breadcrumb'],
    geometry: { kind: 'chevron' },
    glyph: [24, 15],
  },
  {
    preset: 'predefined_process',
    label: 'Subroutine',
    hint: 'A process defined elsewhere, marked by two rules.',
    keywords: ['predefined process', 'procedure', 'function', 'call', 'module'],
    geometry: { kind: 'predefined_process' },
    glyph: [24, 17],
  },
  {
    preset: 'document',
    label: 'Document',
    hint: 'A page with a torn bottom edge. Printed or written output.',
    keywords: ['report', 'page', 'paper', 'file', 'print'],
    geometry: { kind: 'document' },
    glyph: [21, 20],
  },
  {
    preset: 'note',
    label: 'Note',
    hint: 'A page with one corner turned back.',
    keywords: ['dog ear', 'fold', 'memo', 'card'],
    geometry: { kind: 'note' },
    glyph: [19, 22],
  },
  {
    preset: 'manual_input',
    label: 'Manual input',
    hint: 'A sloped top edge. Something a person types in.',
    keywords: ['keyboard', 'entry', 'form', 'card', 'punch'],
    geometry: { kind: 'manual_input' },
    glyph: [24, 17],
  },
  {
    preset: 'folder',
    label: 'Folder',
    hint: 'A tabbed folder. A group of things, or a directory.',
    keywords: ['directory', 'group', 'category', 'files', 'bucket'],
    geometry: { kind: 'folder' },
    glyph: [23, 19],
  },
  {
    preset: 'internal_storage',
    label: 'Internal storage',
    hint: 'Memory held inside the process, ruled top and left.',
    keywords: ['memory', 'ram', 'cache', 'register'],
    geometry: { kind: 'internal_storage' },
    glyph: [24, 17],
  },
  {
    preset: 'delay',
    label: 'Delay',
    hint: 'A wait before the next step. A rectangle with a rounded end.',
    keywords: ['wait', 'buffer', 'queue', 'pause', 'timeout'],
    geometry: { kind: 'delay' },
    glyph: [24, 16],
  },
  {
    preset: 'cylinder',
    label: 'Cylinder',
    hint: 'A drum seen from slightly above. Stored data.',
    keywords: ['disk', 'drum', 'storage', 'tank', 'volume'],
    geometry: { kind: 'cylinder' },
    glyph: [18, 22],
  },
  {
    preset: 'database',
    label: 'Database',
    hint: 'A stack of disks. Decks and rim depth are editable.',
    keywords: ['db', 'sql', 'table', 'store', 'persistence', 'stack'],
    geometry: { kind: 'database' },
    glyph: [18, 22],
  },
  {
    preset: 'summing_junction',
    label: 'Summing junction',
    hint: 'A circle crossed by an X, where flows meet.',
    keywords: ['junction', 'merge', 'adder', 'crossroads', 'sum'],
    geometry: { kind: 'summing_junction' },
    glyph: SQUARE,
  },
  {
    preset: 'and_gate',
    label: 'AND gate',
    hint: 'A flat back and a round front. True only when every input is.',
    keywords: ['logic', 'boolean', 'conjunction', 'all'],
    geometry: { kind: 'and_gate' },
    glyph: [24, 16],
  },
  {
    preset: 'or_gate',
    label: 'OR gate',
    hint: 'A curved back and a pointed front. True when any input is.',
    keywords: ['logic', 'boolean', 'disjunction', 'any'],
    geometry: { kind: 'or_gate' },
    glyph: [24, 16],
  },

  // -- Annotation ---------------------------------------------------------
  {
    preset: 'callout',
    label: 'Speech bubble',
    hint: 'A rounded balloon with a tail. Seven tail positions, all editable.',
    keywords: ['callout', 'comment', 'chat', 'quote', 'says', 'tooltip'],
    geometry: { kind: 'callout', tailPosition: 'bottom-left' },
    glyph: [22, 20],
  },
  {
    preset: 'cloud',
    label: 'Cloud',
    hint: 'A big lobe, a shoulder and a flat base. A network, or a thought.',
    keywords: ['thought', 'network', 'internet', 'aws', 'azure', 'gcp', 'bubble'],
    geometry: { kind: 'cloud' },
    glyph: [24, 18],
  },
  {
    preset: 'banner',
    label: 'Ribbon',
    hint: 'A band with a swallowtail cut into each end.',
    keywords: ['banner', 'flag', 'label', 'title', 'award'],
    geometry: { kind: 'banner' },
    glyph: [24, 13],
  },
  {
    preset: 'arrow_block',
    label: 'Block arrow',
    hint: 'A filled arrow with a shaft. A direction you can put text in.',
    keywords: ['arrow', 'direction', 'pointer', 'flow', 'next'],
    geometry: { kind: 'arrow_block' },
    glyph: [24, 16],
  },

  // -- Architecture -------------------------------------------------------
  {
    preset: 'server',
    label: 'Server',
    hint: 'A rack face with bays, lights and vents. The bay count is editable.',
    keywords: ['rack', 'host', 'machine', 'backend', 'node', 'vm'],
    geometry: { kind: 'server' },
    glyph: [21, 22],
  },
  {
    preset: 'cpu',
    label: 'Chip',
    hint: 'A package with contacts on all four edges and a die in the middle.',
    keywords: ['cpu', 'processor', 'ic', 'microchip', 'silicon', 'gpu', 'compute'],
    geometry: { kind: 'cpu' },
    glyph: SQUARE,
  },
  {
    preset: 'browser',
    label: 'Browser',
    hint: 'A window with a title bar and an address field.',
    keywords: ['web', 'chrome', 'safari', 'firefox', 'window', 'page', 'site'],
    geometry: { kind: 'browser' },
    glyph: [24, 18],
  },
  {
    preset: 'terminal',
    label: 'Terminal',
    hint: 'A console window with a prompt.',
    keywords: ['console', 'cli', 'command line', 'shell', 'bash', 'ssh'],
    geometry: { kind: 'terminal' },
    glyph: [24, 18],
  },
  {
    preset: 'mobile',
    label: 'Phone',
    hint: 'A handset with an island and a home bar.',
    keywords: ['mobile', 'smartphone', 'device', 'ios', 'android', 'app'],
    geometry: { kind: 'mobile' },
    glyph: [13, 23],
  },
  {
    preset: 'globe',
    label: 'Globe',
    hint: 'A sphere with an equator and a meridian. The web, or a region.',
    keywords: ['web', 'world', 'internet', 'global', 'cdn', 'region', 'www'],
    geometry: { kind: 'globe' },
    glyph: SQUARE,
  },
  {
    preset: 'archive',
    label: 'Archive',
    hint: 'A lidded box. Something put away rather than deleted.',
    keywords: ['box', 'storage', 'cold', 'backup', 'retain', 'glacier'],
    geometry: { kind: 'archive' },
    glyph: [23, 19],
  },
  {
    preset: 'hopper',
    label: 'Storage',
    hint: 'A hopper with sloped shoulders. A store, or a bucket.',
    keywords: ['bucket', 'volume', 'disk', 'blob', 's3', 'silo'],
    geometry: { kind: 'hopper' },
    glyph: [23, 19],
  },
  {
    preset: 'activity',
    label: 'Activity',
    hint: 'A panel with a trace across it. Monitoring, or throughput.',
    keywords: ['monitor', 'metrics', 'pulse', 'health', 'trace', 'telemetry', 'chart'],
    geometry: { kind: 'activity' },
    glyph: [24, 18],
  },
  {
    preset: 'desktop',
    label: 'Desktop',
    hint: 'A monitor on a stand. A workstation, or a large screen.',
    keywords: ['monitor', 'screen', 'computer', 'display', 'workstation', 'pc'],
    geometry: { kind: 'desktop' },
    glyph: [24, 21],
  },
  {
    preset: 'package',
    label: 'Package',
    hint: 'An isometric box, creased at its three visible faces.',
    keywords: ['box', 'cube', 'module', 'npm', 'crate', 'bundle', 'deploy', 'artifact'],
    geometry: { kind: 'package' },
    glyph: [21, 22],
  },

  // -- Symbols ------------------------------------------------------------
  {
    preset: 'user',
    label: 'Person',
    hint: 'A head and shoulders. An actor, or an account.',
    keywords: ['user', 'avatar', 'actor', 'profile', 'account', 'human', 'customer'],
    geometry: { kind: 'user' },
    glyph: [20, 22],
  },
  {
    preset: 'shield',
    label: 'Shield',
    hint: 'A flat top over curved sides. Protection, or a boundary.',
    keywords: ['security', 'auth', 'protection', 'guard', 'firewall', 'trust'],
    geometry: { kind: 'shield' },
    glyph: [20, 22],
  },
  {
    preset: 'key',
    label: 'Key',
    hint: 'A pierced bow on a toothed shaft. A credential.',
    keywords: ['auth', 'password', 'secret', 'credential', 'api key', 'token'],
    geometry: { kind: 'key' },
    glyph: [24, 9],
  },
  {
    preset: 'gear',
    label: 'Gear',
    hint: 'Teeth around a bore. The tooth count is editable.',
    keywords: ['settings', 'cog', 'config', 'preferences', 'engine', 'build'],
    geometry: { kind: 'gear' },
    glyph: SQUARE,
  },
  {
    preset: 'mail',
    label: 'Envelope',
    hint: 'A sealed flap. A message, or a queue.',
    keywords: ['mail', 'email', 'message', 'letter', 'inbox', 'send', 'smtp'],
    geometry: { kind: 'mail' },
    glyph: [24, 17],
  },
  {
    preset: 'wallet',
    label: 'Wallet',
    hint: 'A billfold with a seam and a snap. Payments, or a ledger.',
    keywords: ['payment', 'fintech', 'money', 'ledger', 'billing', 'purse'],
    geometry: { kind: 'wallet' },
    glyph: [24, 18],
  },
  {
    preset: 'bolt',
    label: 'Lightning',
    hint: 'A struck bolt. Something instant, or powered.',
    keywords: ['bolt', 'flash', 'instant', 'fast', 'power', 'electric', 'zap', 'event'],
    geometry: { kind: 'bolt' },
    glyph: [15, 22],
  },
  {
    preset: 'pin',
    label: 'Location',
    hint: 'A map pin. A place, or a point of interest.',
    keywords: ['map', 'place', 'marker', 'gps', 'where', 'address'],
    geometry: { kind: 'pin' },
    glyph: [17, 23],
  },
  {
    preset: 'plane',
    label: 'Send',
    hint: 'A paper plane. Something dispatched.',
    keywords: ['paper plane', 'submit', 'deliver', 'publish', 'push', 'message'],
    geometry: { kind: 'plane' },
    glyph: SQUARE,
  },
  {
    preset: 'heart',
    label: 'Heart',
    hint: 'Two lobes over a point.',
    keywords: ['love', 'like', 'favourite', 'favorite', 'health'],
    geometry: { kind: 'heart' },
    glyph: SQUARE,
  },

  // -- The open runs, which live on their own dock seat --------------------
  {
    preset: 'line',
    label: 'Line',
    hint: 'A run between two points. Click once per corner for more.',
    keywords: ['segment', 'edge', 'rule', 'divider'],
    geometry: { kind: 'line' },
    glyph: SQUARE,
  },
  {
    preset: 'arrow',
    label: 'Arrow',
    hint: 'A run with a head. Click once per corner for more.',
    keywords: ['pointer', 'direction', 'vector', 'link'],
    geometry: { kind: 'arrow' },
    glyph: SQUARE,
  },
] as const satisfies readonly ShapeEntry[];

export type ShapePreset = (typeof SHAPE_ENTRIES)[number]['preset'];

/** One entry by preset. Total: the list above is the definition of the type. */
export const SHAPE_BY_PRESET = Object.fromEntries(
  SHAPE_ENTRIES.map((e) => [e.preset, e])
) as unknown as Record<ShapePreset, ShapeEntry>;

export const shapeEntry = (preset: ShapePreset): ShapeEntry => SHAPE_BY_PRESET[preset];

/**
 * A shape's recipe as a fresh geometry object.
 *
 * Cloned rather than handed out, because the caller writes it into a document
 * and a shared literal would be one object on every node ever placed.
 */
export function presetGeometry(preset: ShapePreset): ShapeGeometry {
  return { ...SHAPE_BY_PRESET[preset].geometry };
}

/**
 * The first preset that creates `kind`, for the surfaces keyed by kind.
 *
 * The properties panel and the swapper know what a node *is*, not which tile
 * placed it, and they still want its name and its glyph. Ambiguity is real and
 * harmless: three presets make a `polygon`, and any of the three is a fair
 * picture of one.
 */
export function presetForKind(kind: ShapeKind): ShapePreset {
  return (SHAPE_ENTRIES.find((e) => e.geometry.kind === kind)?.preset as ShapePreset) ?? 'rect';
}

export interface ShapeGroup {
  name: string;
  presets: readonly ShapePreset[];
}

export interface ShapeCategory {
  id: string;
  name: string;
  groups: readonly ShapeGroup[];
}

/**
 * The tabs, and the runs inside them.
 *
 * ## What changed, and why
 *
 * There were seven tabs, two of which held two and three tiles — a whole tab
 * strip to reach a list shorter than the strip itself. Callouts had exactly two
 * entries under a heading that named both of them. Logic had three.
 *
 * Six tabs, none under six tiles. A shape appears in every family it belongs to
 * rather than being filed once and hidden: a diamond is a basic form *and* the
 * flowchart decision, a cloud is an annotation *and* a piece of architecture.
 * Cross-listing costs nothing because a shape has exactly one name and one
 * sentence wherever it appears — which is the rule that makes it safe, and the
 * rule the three duplicate label tables used to break.
 */
export const SHAPE_CATEGORIES: readonly ShapeCategory[] = [
  {
    id: 'basic',
    name: 'Basic',
    groups: [
      { name: 'Boxes', presets: ['rect', 'rounded_rect', 'squircle', 'capsule'] },
      { name: 'Curves', presets: ['ellipse', 'semicircle', 'donut'] },
      { name: 'Angles', presets: ['triangle', 'right_triangle', 'diamond'] },
    ],
  },
  {
    id: 'polygons',
    name: 'Polygons',
    groups: [
      { name: 'Regular', presets: ['triangle', 'pentagon', 'hexagon', 'octagon'] },
      { name: 'Radial', presets: ['star', 'badge', 'cross', 'donut'] },
    ],
  },
  {
    id: 'flowchart',
    name: 'Flowchart',
    groups: [
      { name: 'Start and decide', presets: ['capsule', 'diamond', 'preparation'] },
      { name: 'Process', presets: ['rect', 'predefined_process', 'chevron', 'delay'] },
      { name: 'Data', presets: ['parallelogram', 'trapezoid', 'cylinder', 'database', 'internal_storage'] },
      { name: 'Paper and logic', presets: ['document', 'note', 'folder', 'manual_input', 'summing_junction', 'and_gate', 'or_gate'] },
    ],
  },
  {
    id: 'annotation',
    name: 'Annotation',
    groups: [
      { name: 'Bubbles', presets: ['callout', 'cloud'] },
      { name: 'Marks', presets: ['banner', 'badge', 'note', 'arrow_block'] },
    ],
  },
  {
    id: 'architecture',
    name: 'Architecture',
    groups: [
      { name: 'Compute', presets: ['server', 'cpu', 'database', 'cloud', 'globe'] },
      { name: 'Endpoints', presets: ['browser', 'terminal', 'mobile', 'desktop'] },
      { name: 'Storage and flow', presets: ['package', 'archive', 'hopper', 'activity'] },
    ],
  },
  {
    id: 'symbols',
    name: 'Symbols',
    groups: [
      { name: 'Identity', presets: ['user', 'shield', 'key'] },
      { name: 'Utility', presets: ['gear', 'mail', 'plane', 'wallet'] },
      { name: 'Marks', presets: ['bolt', 'heart', 'pin', 'star'] },
    ],
  },
];

/** The two open runs, which share a dock seat and switch between each other. */
export const LINE_PRESETS: readonly ShapePreset[] = ['line', 'arrow'];

/**
 * Every closed shape the Shape seat offers, in category order and without
 * repeats.
 *
 * Derived from the categories rather than listed again — the list this replaces
 * was maintained by hand beside them, and had drifted into a different order
 * with a different membership.
 */
export const SHAPE_PRESETS: readonly ShapePreset[] = Array.from(
  new Set(SHAPE_CATEGORIES.flatMap((c) => c.groups.flatMap((g) => g.presets)))
);

/** Every preset across both seats. */
export const ALL_SHAPE_PRESETS: readonly ShapePreset[] = [...SHAPE_PRESETS, ...LINE_PRESETS];

/**
 * The size a shape is placed at when the gesture gave it none.
 *
 * ## Why a click cannot place a square
 *
 * Clicking the board with a shape armed drops one at a default size, and that
 * size was 120×120 for everything. A capsule in a square box **is a circle** —
 * that is what a stadium with equal sides is — so the one tile whose whole
 * identity is its proportion placed an object indistinguishable from the
 * ellipse two tiles along. A phone came out a rounded square, a ribbon came
 * out an hourglass, and a key came out squashed into a third of its length.
 *
 * None of those is a drawing bug. Each shape is drawn correctly *for the box
 * it was given*, and the box was wrong.
 *
 * The proportions are the ones the glyph already declares, because they are
 * the same fact: the shape's natural aspect. Reusing them means a tile and the
 * object it places cannot disagree about what the shape looks like, which is
 * the rule the rest of this file is built on.
 *
 * A *drag* is untouched — the box you draw is the box you get, and Shift still
 * constrains to a square, which for a capsule is a circle and correctly so.
 */
const PLACED_LONG_SIDE = 140;

export function placedSize(preset: ShapePreset): { width: number; height: number } {
  const [gw, gh] = SHAPE_BY_PRESET[preset].glyph ?? [1, 1];
  const scale = PLACED_LONG_SIDE / Math.max(gw, gh);
  return { width: Math.round(gw * scale), height: Math.round(gh * scale) };
}

/** `shape-rect` etc. — the ids the ToolManager registers. */
export const shapeToolId = (preset: ShapePreset) => `shape-${preset}`;

/** The armed preset for a tool id, or null when the active tool is not a shape. */
export function shapeKindFromToolId(toolId: string): ShapePreset | null {
  const preset = toolId.startsWith('shape-') ? toolId.slice('shape-'.length) : null;
  return preset && (ALL_SHAPE_PRESETS as readonly string[]).includes(preset)
    ? (preset as ShapePreset)
    : null;
}
