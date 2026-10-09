import type { NewNodeInput } from '../../document/mutations';
import type { Template } from '../templates';
import { HUE, INK, INK_FAINT, TINT, hue, layer } from '../templateKit';
import {
  ball,
  block,
  force,
  guide,
  note,
  peg,
  plate,
  strut,
  tray,
  wall,
  type PhysicsPrimer,
} from './physicsKit';

/**
 * Physics & play: boards that move when you push them.
 *
 * Every board opens still. Its guide page says which force to pick, how to set
 * the Forces bar, and where to press; the arena beside it is built from locked
 * furniture and loose bodies whose materials were chosen for what happens next.
 * `physics.test.ts` runs each board's scenario in the real simulation.
 */

/** Where every arena starts: right of the guide page, with a clear gutter. */
const GUIDE_W = 560;
const AX = GUIDE_W + 200;

// ---------------------------------------------------------------------------
// 1. Playground
// ---------------------------------------------------------------------------

interface Station {
  icon: string;
  title: string;
  how: string;
  fill: (x: number, y: number, w: number, h: number) => NewNodeInput[];
}

const STATION_W = 520;
const STATION_H = 340;
const CARD_H = 176;

const STATIONS: Station[] = [
  {
    icon: '🧲',
    title: `${force('magnet')} pulls`,
    how: `Pick ${force('magnet')} and hold the pointer in the middle of the tray. Everything within the ring slides toward it.`,
    fill: (x, y, w, h) =>
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = (i / 8) * Math.PI * 2;
        return block(x + w / 2 + Math.cos(a) * (w / 2 - 50) - 20, y + h / 2 + Math.sin(a) * (h / 2 - 50) - 20, 40, 40, 'wood', hue(i / 8, 62, 60));
      }),
  },
  {
    icon: '💨',
    title: `${force('repel')} pushes`,
    how: `Pick ${force('repel')} and hold just beside the cluster. The blocks scatter to the walls and stop where they land.`,
    fill: (x, y, w, h) =>
      Array.from({ length: 12 }, (_, i) =>
        block(x + w / 2 - 92 + (i % 4) * 48, y + h / 2 - 68 + Math.floor(i / 4) * 48, 40, 40, 'paper', i % 2 ? HUE.sky : HUE.indigo)
      ),
  },
  {
    icon: '🌀',
    title: `${force('swirl')} spins`,
    how: `Pick ${force('swirl')} and hold at the centre of the ring. The dots circle around the pointer instead of gathering.`,
    fill: (x, y, w, h) =>
      Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return ball(x + w / 2 + Math.cos(a) * 120, y + h / 2 + Math.sin(a) * 120, 28, 'rubber', hue(0.55 + i / 40, 70, 56));
      }),
  },
  {
    icon: '⬇️',
    title: `${force('gravity')} tips the table`,
    how: `Pick ${force('gravity')}, keep its direction pointing down, and hold over the tray. The crates fall to the floor and stack.`,
    fill: (x, y, w) =>
      Array.from({ length: 6 }, (_, i) => block(x + 60 + i * 72, y + 24 + (i % 2) * 40, 52, 52, 'wood', i % 2 ? HUE.amber : HUE.orange)),
  },
  {
    icon: '🏀',
    title: 'Bouncy versus heavy',
    how: `Pick ${force('shockwave')} and click left of the three balls. Feather stops at once, Rubber ricochets, Stone glides furthest.`,
    fill: (x, y, w, h) => [
      ball(x + 200, y + h / 2 - 104, 88, 'feather', TINT.sky, 'Feather'),
      ball(x + 200, y + h / 2, 88, 'rubber', TINT.rose, 'Rubber'),
      ball(x + 200, y + h / 2 + 104, 88, 'stone', TINT.slate, 'Stone'),
    ],
  },
  {
    icon: '📌',
    title: 'Pinned stays put',
    how: `Hold ${force('repel')} anywhere here. The pinned note and the locked post never move, and the loose blocks bounce off them.`,
    fill: (x, y, w, h) => [
      note(x + 60, y + h / 2 - 80, 'Pinned. Forces leave me alone.', 'yellow', true),
      wall(x + 300, y + 60, 28, h - 120),
      ...Array.from({ length: 6 }, (_, i) => block(x + 380 + (i % 2) * 56, y + 70 + Math.floor(i / 2) * 76, 40, 40, 'rubber', HUE.green)),
    ],
  },
];

function playground(): NewNodeInput[] {
  const nodes: NewNodeInput[] = [];
  nodes.push(
    ...guide(0, 0, GUIDE_W, { title: 'Start here', icon: '🧪', description: 'Six forces and materials, one tray each' }, [
      { kind: 'title', text: 'Physics playground' },
      { kind: 'lede', text: 'Every object on a board has weight, bounce and drag. Each tray on the right shows one force or material. Nothing moves until you press.' },
      { kind: 'step', text: 'Turn physics on. The Forces bar appears at the bottom of the board.', keys: ['Shift', 'P'] },
      { kind: 'step', text: 'Pick the force a tray names. The ring on the canvas is exactly how far it reaches.' },
      { kind: 'step', text: 'Press inside the tray and hold. Shockwave is a single click.' },
      { kind: 'step', text: 'Freeze stops everything where it is, Reset puts the board back, Done leaves.', keys: ['Esc'] },
      { kind: 'heading', text: 'Make your own' },
      { kind: 'text', text: 'Select any object and open Physics in the panel to choose Feather, Paper, Rubber, Wood or Stone. Pin a note, or lock a shape, to turn it into a wall.' },
      { kind: 'fact', label: 'Flick to throw', text: 'Turn it on in the View menu, then drag an object fast and let go mid-move to launch it.', tint: 'amber' },
    ])
  );

  const pitchX = STATION_W + 200;
  const pitchY = CARD_H + 48 + STATION_H + 48 + 120;
  STATIONS.forEach((s, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = AX + col * pitchX;
    const y = row * pitchY;
    nodes.push(
      ...guide(x - 24, y, STATION_W + 48, { title: `${i + 1}. ${s.title}`, icon: s.icon, description: s.how.split('.')[0] }, [
        { kind: 'heading', text: `${i + 1}. ${s.title}` },
        { kind: 'text', text: s.how },
      ], CARD_H)
    );
    const ty = y + CARD_H + 72;
    nodes.push(...tray(x, ty, STATION_W, STATION_H), ...s.fill(x, ty, STATION_W, STATION_H));
  });
  return layer(nodes);
}

// ---------------------------------------------------------------------------
// 2. Marble run
// ---------------------------------------------------------------------------

/** The run's interior width, its peg rows and its bins: seven bins under six rows. */
const RUN_W = 840;
const PEG_ROWS = 6;
const BINS = 7;
/** Binomial shares for six left-or-right choices, as the bins' labels. */
const SHARES = [1, 6, 15, 20, 15, 6, 1].map((n) => `${((n / 64) * 100).toFixed(1)}%`);

function marbleRun(): NewNodeInput[] {
  const nodes: NewNodeInput[] = [];
  const x0 = AX;
  const mid = x0 + RUN_W / 2;
  const floorY = 1620;

  nodes.push(
    ...guide(0, 0, GUIDE_W, { title: 'How to run it', icon: '🎱', description: 'Fifteen marbles, six rows of pegs, seven bins' }, [
      { kind: 'title', text: 'Marble run' },
      { kind: 'lede', text: 'A Galton board you can tip. Fifteen marbles drop through a funnel and six rows of pegs, and every peg is a coin toss. Watch the bins fill into a bell curve.' },
      { kind: 'step', text: 'Turn physics on and pick Gravity, pointing down.', keys: ['Shift', 'P'] },
      { kind: 'step', text: 'Open Tuning: set Area to the maximum, Edge to Hard, and A press to 10 s.' },
      { kind: 'step', text: 'Click once in the middle of the pegs, then watch. The field runs for ten seconds on its own.' },
      { kind: 'heading', text: 'Why the middle wins' },
      { kind: 'text', text: 'Reaching an outer bin takes six bounces the same way: 1 path in 64. The centre bin has 20 paths, so about a third of the marbles land there. The labels are those odds.' },
      { kind: 'fact', label: 'Three materials, one race', text: 'Stone (grey) is dense and slick, so it falls first. Rubber (rose) ricochets off pegs. Wood (amber) sits between them.', tint: 'slate' },
      { kind: 'fact', label: 'Run it again', text: 'Press Reset in the Forces bar to put every marble back in the hopper.', tint: 'amber' },
    ])
  );

  // Cabinet walls.
  nodes.push(wall(x0 - 24, -40, 24, floorY + 64), wall(x0 + RUN_W, -40, 24, floorY + 64), wall(x0 - 24, floorY, RUN_W + 48, 24));
  // Funnel: 45°, closing to a 120 gap.
  nodes.push(strut(x0, 240, mid - 60, 600), strut(x0 + RUN_W, 240, mid + 60, 600));
  // Pegs, staggered; row r carries r + 2.
  for (let r = 0; r < PEG_ROWS; r++) {
    const count = r + 2;
    // Nine units off the drop line, so no marble can land dead on a peg's crown and balance there.
    for (let c = 0; c < count; c++) peg_(nodes, mid + 9 + (c - (count - 1) / 2) * 104, 720 + r * 84);
  }
  // Bins.
  const binW = RUN_W / BINS;
  // Each divider wears a diamond cap, so a marble cannot come to rest balanced on top of it.
  for (let k = 1; k < BINS; k++) {
    nodes.push(wall(x0 + k * binW - 6, 1272, 12, floorY - 1272));
    nodes.push({ ...wall(x0 + k * binW - 10, 1240, 20, 56), geometry: { kind: 'diamond' } } as NewNodeInput);
  }
  SHARES.forEach((s, k) => nodes.push(plate(x0 + k * binW + 8, floorY + 48, binW - 16, 44, s, k === 3 ? 'amber' : 'slate')));
  // Hopper: five columns of three, materials interleaved.
  const MATS = [
    { m: 'stone', c: INK_FAINT },
    { m: 'rubber', c: HUE.rose },
    { m: 'wood', c: HUE.amber },
  ] as const;
  for (let i = 0; i < 15; i++) {
    const col = i % 5;
    const rowI = Math.floor(i / 5);
    const mat = MATS[(col + rowI) % 3];
    nodes.push(ball(mid + (col - 2) * 64, 60 + rowI * 60, 40, mat.m, mat.c));
  }
  return layer(nodes);
}

const peg_ = (nodes: NewNodeInput[], cx: number, cy: number) => nodes.push(peg(cx, cy, 24));

// ---------------------------------------------------------------------------
// 3. Orbit sandbox
// ---------------------------------------------------------------------------

const SUN = 180;

function orbits(): NewNodeInput[] {
  const nodes: NewNodeInput[] = [];
  const cx = AX + 760;
  const cy = 760;

  nodes.push(
    ...guide(0, 0, GUIDE_W, { title: 'Mission control', icon: '🪐', description: 'Two forces, one star, fifty-odd bodies' }, [
      { kind: 'title', text: 'Orbit sandbox' },
      { kind: 'lede', text: 'A star, four planets and two belts of debris, all at rest. Two forces are all it takes to make a solar system out of them.' },
      { kind: 'step', text: 'Turn physics on and pick Swirl.', keys: ['Shift', 'P'] },
      { kind: 'step', text: 'Open Tuning: Area at two thirds, so the ring reaches past the outer belt. Edge Soft, A press 10 s.' },
      { kind: 'step', text: 'Click the star. Everything starts to circle it, inner belt fastest, and slowly spirals outward.' },
      { kind: 'step', text: 'While it spins, switch to Attract and hold on the star to pull the belts into a tight disc.' },
      { kind: 'heading', text: 'What each force does' },
      { kind: 'fact', label: 'Swirl', text: 'Pushes at right angles to the line to the pointer, so bodies turn instead of gathering. With a Soft edge the inner belt turns faster than the outer one, so the rings shear apart and drift outward, like paint on a spun plate.', tint: 'violet' },
      { kind: 'fact', label: 'Attract', text: 'Pulls straight toward the pointer. The star is locked, so bodies pile against it instead of passing through: an accretion disc.', tint: 'sky' },
    ])
  );

  // The star: locked, so it holds still and is collided against.
  nodes.push({
    ...peg(cx, cy, SUN),
    text: 'Sun',
    appearance: { fill: [{ type: 'solid', color: TINT.amber }], stroke: { color: HUE.amber, width: 3 } },
    typography: { fontSize: 20, fontWeight: 700, color: INK, align: 'center', verticalAlign: 'middle' },
  } as NewNodeInput);

  const ring = (r: number, count: number, d: number, material: 'rubber' | 'wood' | 'paper' | 'stone', tone: (t: number) => string, phase = 0) => {
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * Math.PI * 2;
      nodes.push(ball(cx + Math.cos(a) * r, cy + Math.sin(a) * r, d, material, tone(i / count)));
    }
  };
  ring(190, 12, 24, 'wood', (t) => hue(0.08 + t * 0.06, 85, 60));
  ring(300, 1, 44, 'wood', () => HUE.sky, 0.6);
  ring(360, 1, 40, 'wood', () => HUE.rose, 2.8);
  ring(440, 22, 22, 'paper', (t) => hue(0.55 + t * 0.15, 55, 62), 0.1);
  ring(530, 1, 56, 'wood', () => HUE.violet, 4.4);
  ring(600, 1, 48, 'wood', () => HUE.teal, 1.4);
  ring(680, 18, 20, 'paper', () => INK_FAINT, 0.2);
  return layer(nodes);
}

// ---------------------------------------------------------------------------
// 4. Domino burst
// ---------------------------------------------------------------------------

function dominoes(): NewNodeInput[] {
  const nodes: NewNodeInput[] = [];
  const R = 560;
  const cx = AX + R + 24;
  const cy = R + 24;

  nodes.push(
    ...guide(0, 0, GUIDE_W, { title: 'Launch checklist', icon: '🚀', description: 'One click, ninety tiles, one reveal' }, [
      { kind: 'title', text: 'Domino burst' },
      { kind: 'lede', text: 'Ninety wooden tiles are stacked in three rings over something worth seeing. One Shockwave in the middle throws them to the walls.' },
      { kind: 'step', text: 'Turn physics on and pick Shockwave.', keys: ['Shift', 'P'] },
      { kind: 'step', text: 'Click the centre of the rings once.' },
      { kind: 'step', text: 'Read what was underneath. Reset in the Forces bar stacks the tiles again.' },
      { kind: 'heading', text: 'What is happening' },
      { kind: 'text', text: 'The note in the middle is pinned, so the blast cannot move it. Tiles nearest the click get the hardest shove, and the octagon of locked walls keeps every one of them on the board.' },
      { kind: 'fact', label: 'Try a different material', text: 'Select all the tiles and switch them to Stone in the panel: they slide further and slam the walls. Feather barely leaves the ring.', tint: 'amber' },
    ])
  );

  // Octagonal arena.
  const apothem = R;
  const side = 2 * apothem * Math.tan(Math.PI / 8);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const mx = cx + Math.cos(a) * (apothem + 12);
    const my = cy + Math.sin(a) * (apothem + 12);
    nodes.push(wall(mx - (side + 24) / 2, my - 12, side + 24, 24, (a * 180) / Math.PI + 90));
  }

  nodes.push(note(cx - 90, cy - 90, 'Ship it 🚀', 'lime', true, 180));

  // Three rings of tiles, laid radially over the note.
  const RINGS = [
    { r: 70, n: 14 },
    { r: 160, n: 30 },
    { r: 250, n: 46 },
  ];
  RINGS.forEach(({ r, n }, ri) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ri * 0.1;
      const tx = cx + Math.cos(a) * r;
      const ty = cy + Math.sin(a) * r;
      nodes.push(block(tx - 12, ty - 40, 24, 80, 'wood', hue(0.02 + ri * 0.04 + (i % 3) * 0.02, 70, 52 + ri * 4), (a * 180) / Math.PI + 90));
    }
  });
  return layer(nodes);
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

export const PHYSICS: Template[] = [
  {
    id: 'physics-playground',
    category: 'physics',
    name: 'Physics playground',
    blurb: 'Six trays, six lessons: attract, repel, swirl, gravity, materials and pinning.',
    teaches: ['Forces', 'Materials', 'Pinned and locked'],
    tags: ['tutorial', 'physics', 'forces', 'learn'],
    accent: 'indigo',
    build: playground,
  },
  {
    id: 'physics-marble-run',
    category: 'physics',
    name: 'Marble run',
    blurb: 'Tip the board and fifteen marbles bounce through pegs into a bell curve.',
    teaches: ['Latched gravity', 'Locked pegs', 'Materials'],
    tags: ['galton', 'plinko', 'probability', 'gravity'],
    accent: 'amber',
    build: marbleRun,
  },
  {
    id: 'physics-orbits',
    category: 'physics',
    name: 'Orbit sandbox',
    blurb: 'Swirl a still solar system into spiral arms, then pull it into a disc.',
    teaches: ['Swirl', 'Attract', 'Falloff'],
    tags: ['space', 'galaxy', 'orbit', 'planets'],
    accent: 'violet',
    build: orbits,
  },
  {
    id: 'physics-dominoes',
    category: 'physics',
    name: 'Domino burst',
    blurb: 'One shockwave throws ninety tiles to the walls and reveals the note beneath.',
    teaches: ['Shockwave', 'Pinned notes', 'Walls'],
    tags: ['domino', 'launch', 'celebration'],
    accent: 'orange',
    build: dominoes,
  },
];

/** The Forces bar setup each board is built for, keyed by template id. See `PhysicsPrimer`. */
export const PHYSICS_PRIMERS: Record<string, PhysicsPrimer> = {
  'physics-playground': { force: 'magnet' },
  'physics-marble-run': { force: 'gravity', latchSeconds: 10, radiusScale: 3, falloff: 'constant', gravityAngle: 90 },
  'physics-orbits': { force: 'swirl', latchSeconds: 10, radiusScale: 2, falloff: 'smooth' },
  'physics-dominoes': { force: 'shockwave' },
};
