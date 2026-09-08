import type { ShapeKind } from '../../engine/model/schema';

/**
 * What the dock offers, which is not the same list as `ShapeKind`.
 *
 * A polygon is one kind with a side count, and nobody wants to draw a
 * rectangle and then type "3". So the dock offers the side counts people
 * actually reach for as named presets, each of which creates a polygon.
 * `ShapeKind` describes the document; this describes the menu.
 */
export type ShapePreset =
  | 'rect'
  | 'ellipse'
  | 'squircle'
  | 'capsule'
  | 'diamond'
  | 'triangle'
  | 'cylinder'
  | 'parallelogram'
  | 'trapezoid'
  | 'chevron'
  | 'star'
  | 'heart'
  | 'cloud'
  | 'cross'
  | 'donut'
  | 'badge'
  | 'callout'
  | 'banner'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'document'
  | 'predefined_process'
  | 'summing_junction'
  | 'or_gate'
  | 'and_gate'
  | 'internal_storage'
  | 'delay'
  | 'database'
  | 'server'
  | 'cpu'
  | 'mobile'
  | 'terminal'
  | 'browser'
  | 'shield'
  | 'key'
  | 'bolt'
  | 'package'
  | 'mail'
  | 'user'
  | 'gear'
  | 'wallet'
  | 'line'
  | 'arrow';

/** The kind and side count each preset creates. */
export const PRESET_GEOMETRY: Record<ShapePreset, { kind: ShapeKind; points?: number }> = {
  rect: { kind: 'rect' },
  ellipse: { kind: 'ellipse' },
  squircle: { kind: 'squircle' },
  capsule: { kind: 'capsule' },
  diamond: { kind: 'diamond' },
  triangle: { kind: 'polygon', points: 3 },
  cylinder: { kind: 'cylinder' },
  parallelogram: { kind: 'parallelogram' },
  trapezoid: { kind: 'trapezoid' },
  chevron: { kind: 'chevron' },
  star: { kind: 'star', points: 5 },
  heart: { kind: 'heart' },
  cloud: { kind: 'cloud' },
  cross: { kind: 'cross' },
  donut: { kind: 'donut' },
  badge: { kind: 'badge', points: 12 },
  callout: { kind: 'callout' },
  banner: { kind: 'banner' },
  pentagon: { kind: 'polygon', points: 5 },
  hexagon: { kind: 'polygon', points: 6 },
  octagon: { kind: 'polygon', points: 8 },
  document: { kind: 'document' },
  predefined_process: { kind: 'predefined_process' },
  summing_junction: { kind: 'summing_junction' },
  or_gate: { kind: 'or_gate' },
  and_gate: { kind: 'and_gate' },
  internal_storage: { kind: 'internal_storage' },
  delay: { kind: 'delay' },
  database: { kind: 'cylinder' },
  server: { kind: 'server' },
  cpu: { kind: 'cpu' },
  mobile: { kind: 'mobile' },
  terminal: { kind: 'terminal' },
  browser: { kind: 'browser' },
  shield: { kind: 'shield' },
  key: { kind: 'key' },
  bolt: { kind: 'bolt' },
  package: { kind: 'package' },
  mail: { kind: 'mail' },
  user: { kind: 'user' },
  gear: { kind: 'gear' },
  wallet: { kind: 'wallet' },
  line: { kind: 'line' },
  arrow: { kind: 'arrow' },
};

/**
 * The shapes the Shape seat offers.
 *
 * `line` and `arrow` are not here: they have their own dock seat.
 */
export const SHAPE_KINDS: ShapePreset[] = [
  'rect',
  'ellipse',
  'squircle',
  'capsule',
  'diamond',
  'triangle',
  'cylinder',
  'parallelogram',
  'trapezoid',
  'chevron',
  'star',
  'heart',
  'cloud',
  'cross',
  'donut',
  'badge',
  'callout',
  'banner',
  'pentagon',
  'hexagon',
  'octagon',
  'document',
  'predefined_process',
  'summing_junction',
  'or_gate',
  'and_gate',
  'internal_storage',
  'delay',
  'database',
  'server',
  'cpu',
  'mobile',
  'terminal',
  'browser',
  'shield',
  'key',
  'bolt',
  'package',
  'mail',
  'user',
  'gear',
  'wallet',
];

/** The two open runs, which share a seat and switch between each other. */
export const LINE_KINDS: ShapePreset[] = ['line', 'arrow'];

export const SHAPE_LABELS: Record<ShapePreset, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  squircle: 'Squircle',
  capsule: 'Capsule',
  diamond: 'Diamond',
  triangle: 'Triangle',
  cylinder: 'Cylinder',
  parallelogram: 'Parallelogram',
  trapezoid: 'Trapezoid',
  chevron: 'Chevron',
  star: 'Star',
  heart: 'Heart',
  cloud: 'Cloud',
  cross: 'Cross',
  donut: 'Donut',
  badge: 'Badge',
  callout: 'Callout',
  banner: 'Banner',
  pentagon: 'Pentagon',
  hexagon: 'Hexagon',
  octagon: 'Octagon',
  document: 'Document',
  predefined_process: 'Subroutine',
  summing_junction: 'Junction',
  or_gate: 'OR Gate',
  and_gate: 'AND Gate',
  internal_storage: 'Storage',
  delay: 'Delay',
  database: 'Database',
  server: 'Server',
  cpu: 'CPU',
  mobile: 'Mobile',
  terminal: 'Terminal',
  browser: 'Browser',
  shield: 'Shield',
  key: 'Key',
  bolt: 'Bolt',
  package: 'Package',
  mail: 'Mail',
  user: 'User',
  gear: 'Gear',
  wallet: 'Wallet',
  line: 'Line',
  arrow: 'Arrow',
};

/**
 * Search keywords for each shape, used by the flyout's search filter.
 *
 * Each entry maps a preset to an array of alternative names, abbreviations,
 * and domain terms that a user might type when looking for that shape.
 * The primary label is always searched implicitly; these are *additional* terms.
 */
export const SHAPE_SEARCH_KEYWORDS: Partial<Record<ShapePreset, string[]>> = {
  rect: ['rectangle', 'box', 'square'],
  ellipse: ['circle', 'oval', 'round'],
  squircle: ['rounded square', 'superellipse', 'ios'],
  capsule: ['pill', 'stadium', 'lozenge'],
  diamond: ['decision', 'rhombus', 'rotated square'],
  triangle: ['3', 'arrow up'],
  cylinder: ['disk', 'drum', 'storage'],
  parallelogram: ['data', 'io', 'input output', 'slant'],
  trapezoid: ['operation', 'manual operation'],
  chevron: ['process', 'step', 'arrow'],
  star: ['favorite', 'rating', '5-point'],
  heart: ['love', 'like', 'favourite'],
  cloud: ['network', 'thought', 'aws', 'azure', 'gcp'],
  cross: ['plus', 'add', 'medical'],
  donut: ['ring', 'torus', 'annulus'],
  badge: ['seal', 'rosette', 'certificate', 'award'],
  callout: ['speech bubble', 'tooltip', 'comment', 'chat'],
  banner: ['ribbon', 'flag', 'label'],
  document: ['report', 'page', 'paper', 'file'],
  predefined_process: ['subroutine', 'procedure', 'function'],
  summing_junction: ['junction', 'crossroads', 'merge'],
  or_gate: ['logic', 'boolean', 'or'],
  and_gate: ['logic', 'boolean', 'and'],
  internal_storage: ['memory', 'ram', 'cache'],
  delay: ['buffer', 'wait', 'queue'],
  database: ['db', 'sql', 'table', 'storage'],
  server: ['rack', 'host', 'machine', 'backend'],
  cpu: ['processor', 'chip', 'ic', 'microchip', 'silicon'],
  mobile: ['phone', 'smartphone', 'device', 'ios', 'android'],
  terminal: ['console', 'cli', 'command line', 'shell', 'bash'],
  browser: ['web', 'chrome', 'firefox', 'safari', 'window'],
  shield: ['security', 'auth', 'protection', 'guard'],
  key: ['authentication', 'password', 'lock', 'credential', 'api key'],
  bolt: ['lightning', 'instant', 'fast', 'power', 'electric'],
  package: ['box', 'module', 'npm', 'crate', 'bundle', 'deploy'],
  mail: ['email', 'message', 'envelope', 'letter', 'inbox'],
  user: ['avatar', 'person', 'actor', 'profile', 'account'],
  gear: ['settings', 'cog', 'config', 'preferences'],
  wallet: ['payment', 'fintech', 'money', 'ledger', 'billing'],
};

export interface ShapeGroup {
  name: string;
  presets: ShapePreset[];
}

export interface ShapeCategory {
  id: string;
  name: string;
  presets: ShapePreset[];
  groups?: ShapeGroup[];
}

export const SHAPE_CATEGORIES: ShapeCategory[] = [
  {
    id: 'basic',
    name: 'Basic',
    presets: [
      'rect',
      'ellipse',
      'squircle',
      'capsule',
      'triangle',
      'diamond',
      'pentagon',
      'hexagon',
      'octagon',
    ],
    groups: [
      { name: 'Standard', presets: ['rect', 'ellipse', 'squircle', 'capsule'] },
      { name: 'Polygons', presets: ['triangle', 'diamond', 'pentagon', 'hexagon', 'octagon'] },
    ],
  },
  {
    id: 'decorative',
    name: 'Decorative',
    presets: [
      'star',
      'heart',
      'cloud',
      'cross',
      'badge',
      'donut',
      'bolt',
    ],
    groups: [
      { name: 'Emblems', presets: ['star', 'heart', 'cross', 'bolt'] },
      { name: 'Ornaments', presets: ['badge', 'donut', 'cloud'] },
    ],
  },
  {
    id: 'callouts',
    name: 'Callouts',
    presets: ['callout', 'banner'],
    groups: [
      { name: 'Banners & Bubbles', presets: ['callout', 'banner'] },
    ],
  },
  {
    id: 'flowchart',
    name: 'Flowchart',
    presets: [
      'diamond',
      'parallelogram',
      'trapezoid',
      'chevron',
      'cylinder',
      'document',
      'predefined_process',
      'internal_storage',
      'delay',
    ],
    groups: [
      { name: 'Decisions & I/O', presets: ['diamond', 'parallelogram', 'trapezoid'] },
      { name: 'Processes', presets: ['chevron', 'predefined_process', 'delay'] },
      { name: 'Storage & Docs', presets: ['cylinder', 'document', 'internal_storage'] },
    ],
  },
  {
    id: 'logic',
    name: 'Logic',
    presets: [
      'summing_junction',
      'and_gate',
      'or_gate',
    ],
    groups: [
      { name: 'Logic Gates', presets: ['and_gate', 'or_gate', 'summing_junction'] },
    ],
  },
  {
    id: 'architecture',
    name: 'Architecture',
    presets: [
      'database',
      'server',
      'cpu',
      'cloud',
      'terminal',
      'browser',
      'mobile',
      'package',
    ],
    groups: [
      { name: 'Compute & Cloud', presets: ['server', 'cpu', 'cloud', 'database'] },
      { name: 'Endpoints & Units', presets: ['browser', 'terminal', 'mobile', 'package'] },
    ],
  },
  {
    id: 'symbols',
    name: 'Symbols',
    presets: [
      'user',
      'gear',
      'mail',
      'wallet',
      'shield',
      'key',
    ],
    groups: [
      { name: 'Identity & Utilities', presets: ['user', 'gear', 'mail', 'wallet'] },
      { name: 'Security', presets: ['shield', 'key'] },
    ],
  },
];

/**
 * Concise descriptive subtitle for each shape, shown in the flyout's preview footer.
 */
export const SHAPE_DESCRIPTIONS: Partial<Record<ShapePreset, string>> = {
  rect: 'Right-angled rectangle',
  ellipse: 'Smooth circle or oval',
  squircle: 'Continuous-curvature rounded rectangle',
  capsule: 'Stadium with semicircular ends',
  diamond: 'Rhombus / decision point',
  triangle: 'Equilateral triangle',
  cylinder: 'Data drum / 3D cylinder',
  parallelogram: 'Data input / output block',
  trapezoid: 'Manual operation block',
  chevron: 'Process arrow step',
  star: 'Five-point geometric star',
  heart: 'Smooth heart curve',
  cloud: 'Organic multi-lobe cloud',
  cross: 'Plus / medical cross',
  donut: 'Concentric ring with hole',
  badge: 'Scalloped rosette award seal',
  callout: 'Speech bubble with tail pointer',
  banner: 'Folded ribbon banner',
  pentagon: 'Regular 5-sided polygon',
  hexagon: 'Regular 6-sided polygon',
  octagon: 'Regular 8-sided polygon',
  document: 'Page with bottom wave',
  predefined_process: 'Subroutine with dual vertical rules',
  summing_junction: 'Crossed circle junction',
  or_gate: 'Curved input OR logic gate',
  and_gate: 'Flat input AND logic gate',
  internal_storage: 'Internal memory / cache block',
  delay: 'Half-circle buffer delay',
  database: 'Structured database stack',
  server: 'Rack-mount machine unit',
  cpu: 'Integrated circuit processor chip',
  mobile: 'Handheld smartphone device',
  terminal: 'Command line console window',
  browser: 'Web browser window frame',
  shield: 'Curved heraldic protective shield',
  key: 'Authentication key with teeth',
  bolt: 'Lightning power bolt',
  package: 'Isometric cube container',
  mail: 'Envelope message carrier',
  user: 'Person avatar silhouette',
  gear: 'Settings / configuration cog',
  wallet: 'Payment cardholder / ledger',
  line: 'Two-point straight connector',
  arrow: 'Directed vector pointer',
};

/** `shape-rect` etc. — the ids the ToolManager already registers. */
export const shapeToolId = (preset: ShapePreset) => `shape-${preset}`;

/**
 * Every preset, across both dock seats.
 */
export const ALL_SHAPE_PRESETS: ShapePreset[] = [...SHAPE_KINDS, ...LINE_KINDS];

/** The armed preset for a tool id, or null when the active tool is not a shape. */
export function shapeKindFromToolId(toolId: string): ShapePreset | null {
  const kind = toolId.startsWith('shape-') ? toolId.slice('shape-'.length) : null;
  return kind && (ALL_SHAPE_PRESETS as string[]).includes(kind) ? (kind as ShapePreset) : null;
}
