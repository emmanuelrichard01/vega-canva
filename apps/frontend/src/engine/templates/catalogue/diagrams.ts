import type { NewNodeInput } from '../../document/mutations';
import type { StickyTheme } from '../../model/schema';
import type { Template } from '../templates';
import { textWidth } from '../templateKit';
import { codeHeight, Draft, FAMILY, mindMap, mindMapHeight, vline, WIRE_INK, type Branch, type Family, type MindMapStyle } from './diagramsKit';

/**
 * Diagrams & thinking: maps, roadmaps, flows, trees and schemas, drawn to the
 * standard a Lucidchart power user would hold them to.
 *
 * Every board says something true about its subject, is laid out on an 8px
 * grid with one node size per role, and uses the diagramming tools the way
 * they are meant to be used: bound connectors that re-route when a box moves,
 * the flowchart symbols, the ERD line ends, Mermaid and code beside the
 * drawing. The vocabulary lives in `diagramsKit.ts`, so a board here is
 * layout and content only.
 */

const M = 64; // board margin

// ---------------------------------------------------------------------------
// 1. Mind map: launching a product
// ---------------------------------------------------------------------------

const LAUNCH: Branch[] = [
  {
    icon: '🎯',
    title: 'Positioning',
    family: 'indigo',
    topics: [
      { text: 'Ideal customer', children: [{ text: 'Ops leads at 50–500 person companies' }, { text: 'Running shifts across 3+ tools today' }] },
      { text: 'The promise', children: [{ text: 'Every shift covered, nobody chasing' }] },
      { text: 'Versus the alternatives', children: [{ text: 'Spreadsheets: free, but no swaps or alerts' }, { text: 'Enterprise WFM: a six-month rollout' }] },
    ],
  },
  {
    icon: '🛠️',
    title: 'Product readiness',
    family: 'blue',
    topics: [
      { text: 'Feature freeze', children: [{ text: 'T−14 days, then bug fixes only' }] },
      { text: 'Onboarding', children: [{ text: 'First schedule published in under 5 minutes' }, { text: 'Import from CSV and Google Sheets' }] },
      { text: 'Reliability', children: [{ text: 'Load-tested at 10× forecast sign-ups' }, { text: 'Status page and one-click rollback' }] },
    ],
  },
  {
    icon: '💰',
    title: 'Pricing',
    family: 'green',
    topics: [
      { text: 'Free', children: [{ text: 'Up to 10 people, one location' }] },
      { text: 'Team · $8 per user', children: [{ text: 'Billed yearly, or $10 month to month' }, { text: 'Waitlist gets 50% off for 3 months' }] },
      { text: 'Business · talk to us', children: [{ text: 'SSO, audit log and priority support' }] },
    ],
  },
  {
    icon: '🤝',
    title: 'Support & sales',
    family: 'violet',
    topics: [
      { text: 'Help centre', children: [{ text: '30 articles live before launch' }] },
      { text: 'Launch-week rota', children: [{ text: 'Two people on chat, 7am to 10pm' }] },
      { text: 'Sales kit', children: [{ text: 'Demo script and five case studies' }] },
    ],
  },
  {
    icon: '📣',
    title: 'Go to market',
    family: 'orange',
    topics: [
      { text: 'Launch day', children: [{ text: 'Product Hunt, Tuesday 00:01 PT' }, { text: 'Founder posts on LinkedIn and X' }] },
      { text: 'Waitlist', children: [{ text: '4,200 sign-ups, three-email sequence' }] },
      { text: 'Marketplaces', children: [{ text: 'Slack App Directory' }, { text: 'Google Workspace Marketplace' }] },
    ],
  },
  {
    icon: '📈',
    title: 'Success metrics',
    family: 'rose',
    topics: [
      { text: 'Activation', children: [{ text: '40% publish a schedule within 24 hours' }] },
      { text: 'Retention', children: [{ text: '35% of teams still active in week 4' }] },
      { text: 'Revenue', children: [{ text: '500 paying teams within 90 days' }] },
    ],
  },
];

function launchMap() {
  const d = new Draft();
  const style: MindMapStyle = { rootW: 232, subW: 216, leafW: 256, colGap: 56, rowGap: 16, arc: 72, leafSize: 13 };
  const mapH = mindMapHeight(LAUNCH, style);
  const HEADER = 152;
  const top = M + HEADER + 80;
  const W = 2400;
  const cy = top + mapH / 2;
  const H = Math.ceil((top + mapH + M) / 8) * 8;
  const headW = 1336;

  d.board(W, H, 'Launch plan', '🚀', 'Everything a product launch touches, on one page');
  d.header(
    M,
    M,
    headW,
    HEADER,
    'Launching Tandem 2.0',
    'A shift-scheduling app for operations teams goes from waitlist to paying customers. Six workstreams, each owned by one lead, each with a number that says it worked.'
  );

  // Open questions beside the title: the decisions the map does not settle yet.
  const SW = (W - M * 2 - headW - 3 * 24) / 3;
  const questions: Array<[string, StickyTheme]> = [
    ['Open question: launch on the Tuesday, or wait out the Slack directory review (5 to 10 days)?', 'yellow'],
    ['Open question: keep CSV import on the free plan? It drives activation more than anything else.', 'pink'],
    ['Open question: who answers chat after 10pm Pacific, when Europe wakes up?', 'sky'],
  ];
  questions.forEach(([body, theme], i) => {
    d.sticky(M + headW + 24 + i * (SW + 24), M, SW, HEADER, body, theme);
  });

  mindMap(d, W / 2, cy, { text: '🚀  Launching\nTandem 2.0', width: 240, height: 96, fill: '#4338CA' }, LAUNCH, style);
  return d.nodes();
}

// ---------------------------------------------------------------------------
// 2. Mind map: how the internet works
// ---------------------------------------------------------------------------

const INTERNET: Branch[] = [
  {
    icon: '📖',
    title: 'DNS',
    family: 'sky',
    topics: [
      { text: 'Resolution', children: [{ text: 'Your resolver asks a root server, then .com, then the domain’s own name servers' }] },
      { text: 'Root servers', children: [{ text: '13 named roots, served from over 1,000 anycast sites' }] },
      { text: 'Records', children: [{ text: 'A and AAAA map a name to IPv4 and IPv6' }, { text: 'Answers are cached for their TTL' }] },
    ],
  },
  {
    icon: '🔒',
    title: 'TLS',
    family: 'violet',
    topics: [
      { text: 'Handshake', children: [{ text: 'TLS 1.3 needs one round trip before data flows' }] },
      { text: 'Certificates', children: [{ text: 'Signed by a CA your device already trusts' }, { text: 'Let’s Encrypt certificates last 90 days' }] },
      { text: 'Forward secrecy', children: [{ text: 'Fresh ECDHE keys per session: a stolen key can’t unlock old traffic' }] },
    ],
  },
  {
    icon: '🔌',
    title: 'TCP/IP',
    family: 'blue',
    topics: [
      { text: 'IP', children: [{ text: 'Best effort: packets can arrive late, twice or never' }, { text: 'IPv4 addresses are 32 bits, IPv6 128' }] },
      { text: 'TCP', children: [{ text: 'Handshake: SYN, SYN-ACK, ACK' }, { text: 'Resends what’s lost and keeps bytes in order' }] },
      { text: 'Ports', children: [{ text: 'HTTPS listens on 443, DNS on 53' }] },
    ],
  },
  {
    icon: '📨',
    title: 'HTTP',
    family: 'green',
    topics: [
      { text: 'Requests', children: [{ text: 'A method, a path, headers and an optional body' }] },
      { text: 'Versions', children: [{ text: 'HTTP/2 multiplexes streams over one connection' }, { text: 'HTTP/3 runs over QUIC, on UDP' }] },
      { text: 'Status codes', children: [{ text: '2xx worked, 3xx look elsewhere, 4xx your mistake, 5xx theirs' }] },
    ],
  },
  {
    icon: '🗺️',
    title: 'BGP',
    family: 'rose',
    topics: [
      { text: 'Autonomous systems', children: [{ text: 'Over 70,000 networks, each with its own AS number' }] },
      { text: 'Announcements', children: [{ text: 'Each network tells its neighbours which IP ranges it can reach' }] },
      { text: 'When it breaks', children: [{ text: 'In 2021 Facebook withdrew its own routes and vanished for six hours' }] },
    ],
  },
  {
    icon: '🚚',
    title: 'CDNs',
    family: 'amber',
    topics: [
      { text: 'Edge caches', children: [{ text: 'Copies of a site in hundreds of cities, close to readers' }] },
      { text: 'Anycast', children: [{ text: 'One IP announced from many places; routing picks the nearest' }] },
      { text: 'Cache-Control', children: [{ text: 'max-age says how long the edge may keep a copy' }] },
    ],
  },
];

/** One page load, left to right, coloured by the branch each step belongs to. */
const PAGE_LOAD: Array<{ title: string; sub: string; family: Family }> = [
  { title: 'DNS lookup', sub: 'example.com becomes an IP address', family: 'sky' },
  { title: 'TCP handshake', sub: 'SYN, SYN-ACK, ACK on port 443', family: 'blue' },
  { title: 'TLS handshake', sub: 'Keys agreed, certificate checked', family: 'violet' },
  { title: 'HTTP request', sub: 'GET / with Host: example.com', family: 'green' },
  { title: 'CDN edge', sub: 'A cache hit, or a fetch from origin', family: 'amber' },
  { title: 'Render', sub: 'Parse HTML, then fetch CSS and JS', family: 'slate' },
];

function internetMap() {
  const d = new Draft();
  const style: MindMapStyle = { rootW: 176, subW: 192, leafW: 272, colGap: 56, rowGap: 16, arc: 64, leafSize: 13, sketch: 'medium' };
  const mapH = mindMapHeight(INTERNET, style);
  const HEADER = 152;
  const W = 2400;
  const top = M + HEADER + 80;
  const cy = top + mapH / 2;
  const stripTop = Math.ceil((top + mapH + 96) / 8) * 8;
  const STRIP_H = 232;
  const H = Math.ceil((stripTop + STRIP_H + M) / 8) * 8;

  d.board(W, H, 'How the internet works', '🌐', 'Six protocols, and the order they run in when you open a page');
  d.header(
    M,
    M,
    W - M * 2,
    HEADER,
    'How the internet works',
    'Every page load leans on six systems designed decades apart. Each leaf is one true thing worth knowing about them; the strip at the bottom shows the order they run in.',
    (
      [
        [FAMILY.sky.wire, 'Naming'],
        [FAMILY.blue.wire, 'Transport'],
        [FAMILY.violet.wire, 'Security'],
        [FAMILY.green.wire, 'Application'],
        [FAMILY.amber.wire, 'Delivery'],
        [FAMILY.rose.wire, 'Routing'],
      ] as const
    ).map(([line, label]) => ({ line, label, end: 'none' as const, curved: true })),
    440
  );

  mindMap(d, W / 2, cy, { text: '🌐  The\ninternet', width: 200, height: 96, fill: '#0F766E' }, INTERNET, style);

  // What happens when you open a page: six cards, one wire between each.
  d.wash(M, stripTop, W - M * 2, STRIP_H, 'slate', { opacity: 0.05 });
  d.write(M + 32, stripTop + 24, 900, 'What happens when you open https://example.com', { size: 20, weight: 650, color: FAMILY.slate.ink, lineHeight: 1.3 });
  const CW = 280;
  const gap = (W - M * 2 - 64 - CW * PAGE_LOAD.length) / (PAGE_LOAD.length - 1);
  const cardY = stripTop + 96;
  let prev: NewNodeInput | null = null;
  PAGE_LOAD.forEach((step, i) => {
    const x = M + 32 + i * (CW + gap);
    const card = d.card(x, cardY, CW, 96, { title: step.title, sub: step.sub, family: step.family });
    d.disc(x + 2, cardY + 2, 28, String(i + 1), FAMILY[step.family].ink);
    if (prev) d.wire(prev, card, { from: 'right', to: 'left' });
    prev = card;
  });
  return d.nodes();
}

// ---------------------------------------------------------------------------
// 3. Roadmap: from idea to Series A
// ---------------------------------------------------------------------------

interface Milestone {
  title: string;
  target: string;
  /** Checklist lines; a leading `[x] ` marks one done. */
  steps: string[];
  phase: Family;
}

const PHASES: Array<[Family, string]> = [
  ['violet', 'Discover'],
  ['blue', 'Build'],
  ['teal', 'Traction'],
  ['amber', 'Raise'],
];

const RAISE: Milestone[] = [
  {
    title: 'Find a problem worth solving',
    target: '8 of 20 interviewees describe the pain unprompted',
    steps: ['[x] 20 problem interviews', '[x] Map today’s workaround and its cost', '[x] One-sentence problem statement'],
    phase: 'violet',
  },
  {
    title: 'Prove demand before code',
    target: '5% of landing-page visitors join the waitlist',
    steps: ['[x] Landing page and waitlist', '[x] $500 of targeted ads', '[x] 10 calls with sign-ups'],
    phase: 'violet',
  },
  {
    title: 'Form the company',
    target: 'Incorporated, with founder vesting in place',
    steps: ['[x] Delaware C-corp, IP assigned', '[x] 4-year vesting, 1-year cliff', '[x] 83(b) filed within 30 days'],
    phase: 'blue',
  },
  {
    title: 'Ship the MVP',
    target: 'In real users’ hands within 8 weeks',
    steps: ['[x] One workflow, done properly', '[x] Activation events tracked', '[x] A weekly release rhythm'],
    phase: 'blue',
  },
  {
    title: 'First 10 users',
    target: '10 people using it every week, unprompted',
    steps: ['[x] Onboard each one by hand', '[x] Talk to every user weekly', 'Fix what blocks them first'],
    phase: 'teal',
  },
  {
    title: 'Pre-seed round',
    target: '18 months of runway in the bank',
    steps: ['$500k to $1.5M on post-money SAFEs', '40 angel and fund conversations', 'Data room: deck, metrics, cap table'],
    phase: 'teal',
  },
  {
    title: 'Product–market fit signals',
    target: '40% would be very disappointed without it',
    steps: ['Retention curve flattens out', 'A third of sign-ups come by referral', 'Customers pay full price'],
    phase: 'teal',
  },
  {
    title: 'Seed round',
    target: '$2M to $4M at 15 to 25% dilution',
    steps: ['A lead investor sets the terms', 'First four engineering hires', 'Board: two founders, one investor'],
    phase: 'amber',
  },
  {
    title: 'Series A',
    target: '$1M to $3M ARR, growing 3× a year',
    steps: ['One channel that scales predictably', 'Net revenue retention above 100%', 'CAC paid back within 12 months'],
    phase: 'amber',
  },
];

function seriesARoadmap() {
  const d = new Draft();
  const CARD_W = 304;
  const CARD_H = 104;
  const NOTE_H = 168;
  const DISC = 48;
  const LIFT = 40; // between the road and a card or note

  // Columns: the left turn, two road stops, the right turn.
  const xL = M + 32 + CARD_W + 48 + DISC / 2;
  const c1 = xL + 456;
  const c2 = c1 + 504;
  const xR = c2 + 456;
  const W = xR + DISC / 2 + 48 + CARD_W + 32 + M;

  const HEADER = 152;
  const y1 = M + HEADER + 72 + CARD_H + LIFT + DISC / 2;
  const PITCH = DISC + LIFT * 2 + CARD_H + NOTE_H + 128;
  const y2 = y1 + PITCH;
  const y3 = y2 + PITCH;
  const H = y3 + DISC / 2 + LIFT + NOTE_H + 56 + M;

  d.board(W, H, 'Idea to Series A', '🛣️', 'Nine milestones, each with its checklist and the number that says you are done');
  d.header(
    M,
    M,
    W - M * 2,
    HEADER,
    'From idea to Series A',
    'The road most venture-backed software companies travel, with the evidence investors look for at each stop. Solid road is behind you; dashed is still ahead.',
    [
      ...PHASES.map(([family, label]) => ({ swatch: FAMILY[family].tint, edge: FAMILY[family].hue, label, round: true })),
      { line: WIRE_INK, label: 'Done', end: 'none' as const },
      { line: WIRE_INK, label: 'Ahead', dash: [10, 8], end: 'none' as const },
    ],
    440
  );

  const DONE = 4; // milestones finished; the fifth is under way

  /** Where each stop sits, and which side its card and note go. */
  const stops: Array<{ x: number; y: number; side: 'above' | 'left' | 'right' }> = [
    { x: c1, y: y1, side: 'above' },
    { x: c2, y: y1, side: 'above' },
    { x: xR, y: (y1 + y2) / 2, side: 'right' },
    { x: c2, y: y2, side: 'above' },
    { x: c1, y: y2, side: 'above' },
    { x: xL, y: (y2 + y3) / 2, side: 'left' },
    { x: c1, y: y3, side: 'above' },
    { x: c2, y: y3, side: 'above' },
    { x: xR, y: y3, side: 'right' },
  ];

  const start = d.node(xL - 88, y1 - 28, 176, 56, '💡  An idea', { family: 'violet', radius: 28, size: 15, weight: 700, strokeWidth: 2 });

  const discs = RAISE.map((m, i) => {
    const s = stops[i];
    const f = FAMILY[m.phase];
    const done = i < DONE;
    const last = i === RAISE.length - 1;
    const reached = done || i === DONE || last;
    const disc = d.disc(s.x, s.y, last ? DISC + 16 : DISC, last ? '🏁' : String(i + 1), reached ? f.ink : '#F1F5F9', 17, reached ? {} : { ink: '#475569', edge: '#94A3B8' });

    // The card and its checklist: above and below the road, or stacked beside a turn.
    let cardX: number;
    let cardY: number;
    let noteX: number;
    let noteY: number;
    if (s.side === 'above') {
      cardX = s.x - CARD_W / 2;
      cardY = s.y - DISC / 2 - LIFT - CARD_H;
      noteX = cardX;
      noteY = s.y + DISC / 2 + LIFT;
    } else {
      const stack = CARD_H + 16 + NOTE_H;
      cardX = s.side === 'right' ? s.x + DISC / 2 + 48 : s.x - DISC / 2 - 48 - CARD_W;
      cardY = Math.round(s.y - stack / 2);
      noteX = cardX;
      noteY = cardY + CARD_H + 16;
    }
    d.card(cardX, cardY, CARD_W, CARD_H, {
      title: m.title,
      sub: `🎯  ${m.target}`,
      family: m.phase,
      lift: i === DONE,
      titleSize: 16,
      subSize: 13,
    });
    d.sticky(noteX, noteY, CARD_W, NOTE_H, m.steps.join('\n'), done ? 'mint' : i === DONE ? 'yellow' : 'white', { checklist: true });
    if (i === DONE) d.chip(cardX + CARD_W / 2 - 80, cardY - 44, 160, 30, '📍  We are here', 'amber', 13);
    return disc;
  });

  // The road: one bound connector per leg, solid behind and dashed ahead.
  const leg = (a: NewNodeInput, b: NewNodeInput, from: 'left' | 'right' | 'top' | 'bottom', to: 'left' | 'right' | 'top' | 'bottom', i: number, family: Family) =>
    d.wire(a, b, {
      routing: 'curved',
      from,
      to,
      color: i <= DONE ? FAMILY[family].wire : '#94A3B8',
      width: 6,
      end: 'none',
      avoid: false,
      ...(i <= DONE ? null : { dash: [10, 8] }),
    });
  leg(start, discs[0], 'right', 'left', 0, 'violet');
  leg(discs[0], discs[1], 'right', 'left', 1, RAISE[1].phase);
  leg(discs[1], discs[2], 'right', 'top', 2, RAISE[2].phase);
  leg(discs[2], discs[3], 'bottom', 'right', 3, RAISE[3].phase);
  leg(discs[3], discs[4], 'left', 'right', 4, RAISE[4].phase);
  leg(discs[4], discs[5], 'left', 'top', 5, RAISE[5].phase);
  leg(discs[5], discs[6], 'bottom', 'left', 6, RAISE[6].phase);
  leg(discs[6], discs[7], 'right', 'left', 7, RAISE[7].phase);
  leg(discs[7], discs[8], 'right', 'left', 8, RAISE[8].phase);
  return d.nodes();
}

// ---------------------------------------------------------------------------
// 4. Roadmap: becoming an ML engineer
// ---------------------------------------------------------------------------

type Status = 'done' | 'here' | 'doing' | 'next' | 'later';

interface Skill {
  title: string;
  sub: string;
  status: Status;
}

interface Track {
  icon: string;
  name: string;
  family: Family;
  /** One per stage; null leaves the cell empty. */
  skills: Array<Skill | null>;
  resources: string;
}

const STAGES = ['Foundations\nmonths 0 to 3', 'Core\nmonths 3 to 6', 'Applied\nmonths 6 to 9', 'Production\nmonths 9 to 12'];

const TRACKS: Track[] = [
  {
    icon: '📐',
    name: 'Maths',
    family: 'violet',
    skills: [
      { title: 'Linear algebra', sub: 'Vectors, matrices, eigenvalues', status: 'done' },
      { title: 'Probability & statistics', sub: 'Distributions, Bayes, tests', status: 'done' },
      { title: 'Calculus & optimisation', sub: 'Gradients, chain rule, SGD', status: 'next' },
      null,
    ],
    resources: '3Blue1Brown’s linear algebra series\nMathematics for ML (Deisenroth)',
  },
  {
    icon: '🧠',
    name: 'Deep learning',
    family: 'indigo',
    skills: [
      null,
      null,
      { title: 'Neural networks', sub: 'Backprop, PyTorch, training loops', status: 'later' },
      { title: 'Transformers & LLMs', sub: 'Attention, fine-tuning, LoRA', status: 'later' },
    ],
    resources: 'Karpathy’s Zero to Hero videos\nfast.ai Practical Deep Learning',
  },
  {
    icon: '📊',
    name: 'ML fundamentals',
    family: 'teal',
    skills: [
      { title: 'Supervised learning', sub: 'Linear models, trees, k-NN', status: 'done' },
      { title: 'Model evaluation', sub: 'Splits, leakage, the right metric', status: 'here' },
      { title: 'Gradient boosting', sub: 'XGBoost, LightGBM, features', status: 'next' },
      { title: 'Unsupervised learning', sub: 'Clustering, PCA, anomalies', status: 'later' },
    ],
    resources: 'Hands-On ML (Géron)\nAndrew Ng’s ML Specialization',
  },
  {
    icon: '🐍',
    name: 'Programming',
    family: 'blue',
    skills: [
      { title: 'Python & NumPy', sub: 'Vectorised code, broadcasting', status: 'done' },
      { title: 'pandas & SQL', sub: 'Joins, group-bys, windows', status: 'done' },
      { title: 'Software craft', sub: 'Git, tests, types, packaging', status: 'next' },
      null,
    ],
    resources: 'Python Data Science Handbook\nSQLBolt, then real queries',
  },
  {
    icon: '🚢',
    name: 'MLOps',
    family: 'orange',
    skills: [
      null,
      null,
      { title: 'Model serving', sub: 'FastAPI, Docker, batching', status: 'later' },
      { title: 'Monitoring', sub: 'Drift, data quality, retraining', status: 'later' },
    ],
    resources: 'Designing ML Systems (Chip Huyen)\nMade With ML',
  },
  {
    icon: '🛠️',
    name: 'Projects',
    family: 'rose',
    skills: [
      { title: 'House-price regression', sub: 'A baseline, then beat it', status: 'done' },
      { title: 'Churn model', sub: 'Honest evaluation, written up', status: 'doing' },
      { title: 'Image classifier API', sub: 'Fine-tuned CNN behind FastAPI', status: 'later' },
      { title: 'LLM app with evals', sub: 'Retrieval, tests, monitoring', status: 'later' },
    ],
    resources: 'Write each one up: problem, baseline, result, next step.',
  },
];

/** Prerequisites that cross tracks: [track, stage] → [track, stage], and where along the edges they attach. */
const PREREQS: Array<[[number, number], [number, number], number?]> = [
  [[0, 0], [2, 0]], // linear algebra → supervised learning
  [[3, 0], [2, 0]], // Python & NumPy → supervised learning
  [[0, 1], [2, 1], 0.78], // probability → evaluation, clear of the "you are here" tag
  [[0, 2], [1, 2]], // calculus → neural networks
  [[3, 2], [4, 2]], // software craft → serving
  [[4, 2], [5, 2]], // serving → image classifier API
  [[4, 3], [5, 3]], // monitoring → LLM app
];

function mlRoadmap() {
  const d = new Draft();
  const HEADER = 152;
  const LABEL_W = 200;
  const CARD_W = 264;
  const CARD_H = 72;
  const COL = CARD_W + 72;
  const LANE_H = 136;
  const LANE_GAP = 12;
  const NOTE_W = 328;
  const x0 = M;
  const colX = (i: number) => x0 + LABEL_W + 48 + i * COL;
  const noteX = colX(STAGES.length) + 8;
  const W = noteX + NOTE_W + 24 + M;
  const headTop = M + HEADER + 56;
  const lanesTop = headTop + 56 + 16;
  const laneY = (i: number) => lanesTop + i * (LANE_H + LANE_GAP);
  const H = laneY(TRACKS.length) - LANE_GAP + M;

  d.board(W, H, 'ML engineer roadmap', '🤖', 'Six tracks over a year, with prerequisites drawn and progress marked');
  d.header(
    M,
    M,
    W - M * 2,
    HEADER,
    'Becoming an ML engineer',
    'A year of deliberate practice, one track per row. Arrows that cross tracks are prerequisites; the notes on the right are the resources most practitioners recommend.',
    [
      { swatch: '#F0FDF4', edge: FAMILY.green.hue, label: 'Done' },
      { swatch: '#FFFFFF', edge: FAMILY.amber.hue, label: 'In progress' },
      { swatch: '#FFFFFF', edge: '#94A3B8', label: 'Up next' },
      { swatch: '#FFFFFF', edge: '#94A3B8', label: 'Later', dashed: true },
      { line: FAMILY.indigo.wire, label: 'Prerequisite' },
    ],
    400
  );

  // Stage headings over the columns, and over the notes.
  STAGES.forEach((stage, i) => {
    d.node(colX(i), headTop, CARD_W, 56, stage, { fill: '#F1F5F9', stroke: '#CBD5E1', strokeWidth: 1, size: 14, weight: 650, lineHeight: 1.3, radius: 10 });
  });
  d.node(noteX, headTop, NOTE_W, 56, '📚  Where to learn it', { fill: '#F1F5F9', stroke: '#CBD5E1', strokeWidth: 1, size: 14, weight: 650, radius: 10 });

  const cards: Array<Array<NewNodeInput | null>> = TRACKS.map((track, ti) => {
    const y = laneY(ti);
    const f = FAMILY[track.family];
    d.wash(x0, y, W - M * 2, LANE_H, track.family, { opacity: 0.05, edge: false, radius: 12 });
    d.node(x0 + 12, y + 12, LABEL_W, LANE_H - 24, `${track.icon}  ${track.name}`, { family: track.family, strokeWidth: 1.5, size: 16, weight: 700, radius: 10 });
    const row = track.skills.map((skill, si) => {
      if (!skill) return null;
      const cx = colX(si);
      const cy = y + (LANE_H - CARD_H) / 2;
      const status = skill.status;
      const card = d.card(cx, cy, CARD_W, CARD_H, {
        title: status === 'done' ? `✓  ${skill.title}` : skill.title,
        sub: skill.sub,
        fill: status === 'done' ? '#F0FDF4' : undefined,
        edge: status === 'done' ? FAMILY.green.hue : status === 'here' || status === 'doing' ? FAMILY.amber.hue : status === 'next' ? '#94A3B8' : '#CBD5E1',
        strokeWidth: status === 'here' || status === 'doing' ? 2 : 1.25,
        dashed: status === 'later',
        lift: status === 'here',
      });
      if (status === 'here') d.chip(cx + 12, cy - 22, 140, 28, '📍  You are here', 'amber', 12.5);
      return card;
    });
    // Within a track, each skill leads to the next one along.
    const placed = row.filter((c): c is NewNodeInput => c !== null);
    placed.slice(1).forEach((card, i) => d.wire(placed[i], card, { from: 'right', to: 'left', color: f.wire, width: 1.5, routing: 'straight' }));
    d.sticky(noteX, y + 12, NOTE_W, LANE_H - 24, track.resources, ti % 2 === 0 ? 'yellow' : 'lavender');
    return row;
  });

  for (const [[ta, sa], [tb, sb], u = 0.5] of PREREQS) {
    const from = cards[ta][sa];
    const to = cards[tb][sb];
    if (!from || !to) continue;
    const down = tb > ta;
    d.wire(from, to, {
      fromAnchor: { u, v: down ? 1 : 0 },
      toAnchor: { u, v: down ? 0 : 1 },
      color: FAMILY.indigo.wire,
      width: 2,
    });
  }
  return d.nodes();
}

// ---------------------------------------------------------------------------
// 5. Swimlane: customer support escalation
// ---------------------------------------------------------------------------

const YES = FAMILY.green.wire;
const NO = FAMILY.rose.wire;

function supportSwimlane() {
  const d = new Draft();
  const HEADER = 152;
  const LABEL_W = 176;
  const LANE_H = 168;
  const LANE_GAP = 8;
  const PITCH = 248;
  const NW = 176;
  const NH = 64;
  const COLS = 10;
  const lanesTop = M + HEADER + 64;
  const x0 = M;
  const colX = (c: number) => x0 + LABEL_W + 40 + c * PITCH;
  const W = colX(COLS - 1) + NW + 40 + M;
  const laneY = (l: number) => lanesTop + l * (LANE_H + LANE_GAP);
  const H = laneY(5) - LANE_GAP + M;

  const LANES: Array<[string, Family]> = [
    ['🙋  Customer', 'sky'],
    ['🎧  Tier 1\nsupport', 'blue'],
    ['🔎  Tier 2\nsupport', 'violet'],
    ['⚙️  Engineering', 'teal'],
    ['💼  Account\nmanager', 'amber'],
  ];

  d.board(W, H, 'Support escalation', '🎧', 'From a customer’s report to a closed ticket, across five teams');
  d.header(
    M,
    M,
    W - M * 2,
    HEADER,
    'Customer support escalation',
    'How a SaaS support team moves an issue from first report to a confirmed fix: who owns each step, where it branches, and the response-time promises (SLAs) that run while it does.',
    [
      { line: WIRE_INK, label: 'Hand-off' },
      { line: WIRE_INK, label: 'Heads-up', dash: [7, 6] },
      { line: YES, label: 'Yes' },
      { line: NO, label: 'No' },
    ],
    360
  );

  LANES.forEach(([name, family], l) => {
    const y = laneY(l);
    d.wash(x0, y, W - M * 2, LANE_H, family, { opacity: 0.06, edge: false, radius: 12 });
    d.node(x0 + 12, y + 12, LABEL_W - 24, LANE_H - 24, name, { family, strokeWidth: 1.5, size: 15, weight: 700, radius: 10, lineHeight: 1.3 });
  });

  /** A step centred in its lane and column. */
  const at = (c: number, l: number, w = NW, h = NH) => ({ x: colX(c) + (NW - w) / 2, y: laneY(l) + (LANE_H - h) / 2, w, h });
  const step = (c: number, l: number, label: string, family: Family) => {
    const p = at(c, l);
    return d.node(p.x, p.y, p.w, p.h, label, { family, size: 13.5, weight: 600 });
  };
  const ends = (c: number, l: number, label: string, family: Family) => {
    const p = at(c, l);
    return d.node(p.x, p.y, p.w, p.h, label, { family, radius: NH / 2, size: 13.5, weight: 700, strokeWidth: 2 });
  };
  const ask = (c: number, l: number, label: string) => {
    const p = at(c, l, 200, 112);
    return d.decision(p.x, p.y, p.w, p.h, label, 'amber', 13);
  };
  const sla = (on: NewNodeInput, label: string) => d.chip(on.x + (NW - 168) / 2, on.y + NH + 10, 168, 26, label, 'rose', 12);

  // Customer
  const report = ends(0, 0, 'Customer reports\nan issue', 'sky');
  const fixed = ask(8, 0, 'Fixed for the\ncustomer?');
  const close = ends(9, 0, 'Close ticket and\nsend CSAT survey', 'green');
  // Tier 1
  const log = step(1, 1, 'Log the ticket\nand set priority', 'blue');
  const known = ask(2, 1, 'Known fix in\nhelp centre?');
  const send = step(3, 1, 'Send the fix\nwith a macro', 'blue');
  // Tier 2
  const repro = step(3, 2, 'Reproduce and\ncollect logs', 'violet');
  const bug = ask(4, 2, 'Is it a\nproduct bug?');
  const config = step(5, 2, 'Config fix or\nworkaround', 'violet');
  const verify = step(7, 2, 'Verify the fix\nin production', 'violet');
  // Engineering
  const file = step(5, 3, 'File the bug, page\non-call if P1', 'teal');
  const hotfix = step(6, 3, 'Ship a hotfix or\nschedule the fix', 'teal');
  // Account manager
  const brief = step(2, 4, 'Brief the account\nmanager', 'amber');
  const update = step(5, 4, 'Update the customer\nevery 2 hours', 'amber');
  const review = step(9, 4, 'Incident review\nwith the customer', 'amber');

  sla(report, '⏱  P1 first reply: 15 min');
  sla(send, '⏱  Auto-closes after 72 h');
  sla(repro, '⏱  P1 update every 2 h');
  sla(hotfix, '⏱  P1 fix within 24 h');

  d.wire(report, log, { from: 'right', to: 'left' });
  d.wire(log, known, { from: 'right', to: 'left' });
  d.wire(known, send, { from: 'right', to: 'left', color: YES, label: 'Yes' });
  d.wire(known, repro, { from: 'bottom', to: 'left', color: NO, label: 'No' });
  d.wire(repro, bug, { from: 'right', to: 'left' });
  d.wire(bug, file, { from: 'bottom', to: 'left', color: YES, label: 'Yes' });
  d.wire(bug, config, { from: 'right', to: 'left', color: NO, label: 'No' });
  d.wire(file, hotfix, { from: 'right', to: 'left' });
  d.wire(hotfix, verify, { from: 'right', to: 'bottom' });
  d.wire(config, verify, { from: 'right', to: 'left' });
  d.wire(send, fixed, { from: 'right', to: 'bottom' });
  d.wire(verify, fixed, { from: 'top', to: 'left' });
  d.wire(fixed, close, { from: 'right', to: 'left', color: YES, label: 'Yes' });
  d.wire(fixed, log, { from: 'top', to: 'top', color: NO, label: 'No, reopen' });
  d.wire(log, brief, { from: 'bottom', to: 'left', dash: [7, 6], label: 'P1 or key account' });
  d.wire(brief, update, { from: 'right', to: 'left', dash: [7, 6] });
  d.wire(close, review, { from: 'bottom', to: 'top', dash: [7, 6], label: 'P1 only' });
  return d.nodes();
}

// ---------------------------------------------------------------------------
// 6. Sequence diagram: OAuth 2.0 with PKCE
// ---------------------------------------------------------------------------

/** The same flow as the drawing, as Mermaid. "Render as diagram" on the block draws it again. */
export const PKCE_MERMAID = `sequenceDiagram
    autonumber
    actor U as User
    participant A as Web app
    participant S as Auth server
    participant R as API
    U->>A: Click Sign in
    A->>A: Create verifier and S256 challenge
    A->>+S: GET /authorize with code_challenge
    S-->>U: Sign-in and consent page
    U->>S: Credentials and consent
    S-->>-A: Redirect back with code and state
    A->>+S: POST /token with code and code_verifier
    S->>S: SHA-256 of verifier matches challenge?
    S-->>-A: Access, refresh and ID tokens
    A->>+R: GET /me with Bearer token
    R->>R: Check signature, audience, expiry
    R-->>-A: 200 OK with the profile
    A-->>U: Signed in`;

interface Message {
  from: number;
  to: number;
  text: string;
  reply?: boolean;
  /** Where the label sits along the run, for a message that crosses another lifeline. */
  at?: number;
}

const PKCE: Message[] = [
  { from: 0, to: 1, text: 'Click Sign in' },
  { from: 1, to: 1, text: 'Create verifier and S256 challenge' },
  { from: 1, to: 2, text: 'GET /authorize with code_challenge' },
  { from: 2, to: 0, text: 'Sign-in and consent page', reply: true, at: 0.36 },
  { from: 0, to: 2, text: 'Credentials and consent', at: 0.64 },
  { from: 2, to: 1, text: 'Redirect back with code and state', reply: true },
  { from: 1, to: 2, text: 'POST /token with code and code_verifier' },
  { from: 2, to: 2, text: 'SHA-256 of verifier matches challenge?' },
  { from: 2, to: 1, text: 'Access, refresh and ID tokens', reply: true },
  { from: 1, to: 3, text: 'GET /me with Bearer token', at: 0.3 },
  { from: 3, to: 3, text: 'Check signature, audience, expiry' },
  { from: 3, to: 1, text: '200 OK with the profile', reply: true, at: 0.7 },
  { from: 1, to: 0, text: 'Signed in', reply: true },
];

function pkceSequence() {
  const d = new Draft();
  const HEADER = 152;
  const ROW = 56;
  const HEAD_W = 184;
  const HEAD_H = 56;
  const BAR = 14;
  const cast: Array<{ name: string; family: Family; actor?: boolean }> = [
    { name: '🧑  User', family: 'slate', actor: true },
    { name: '💻  Web app', family: 'blue' },
    { name: '🔐  Auth server', family: 'violet' },
    { name: '🗄️  API', family: 'teal' },
  ];
  const px = [M + 40 + HEAD_W / 2];
  [264, 448, 344].forEach((gap, i) => px.push(px[i] + gap));

  const headY = M + HEADER + 64;
  const firstRow = headY + HEAD_H + 56;
  // Rows: a self-message takes two, so its loop clears the next arrow.
  const rowY: number[] = [];
  let r = 0;
  for (const m of PKCE) {
    rowY.push(firstRow + r * ROW);
    r += m.from === m.to ? 2 : 1;
  }
  const lineBottom = firstRow + r * ROW + 8;

  const codeX = px[3] + 336;
  const codeW = 592;
  const W = codeX + codeW + M;
  const codeH = codeHeight(PKCE_MERMAID, 12.5);
  const H = Math.max(lineBottom + 40, headY + codeH + 40 + 240) + M;

  d.board(W, H, 'OAuth 2.0 with PKCE', '🔐', 'The login flow every public client should use, drawn and written as Mermaid');
  d.header(
    M,
    M,
    W - M * 2,
    HEADER,
    'OAuth 2.0 login with PKCE',
    'Authorization Code with Proof Key for Code Exchange: how a browser or mobile app signs a user in without ever holding a client secret. On the right, the same flow as Mermaid.',
    [
      { line: INK_SOFT_WIRE, label: 'Request' },
      { line: INK_SOFT_WIRE, label: 'Response', dash: [6, 5], end: 'open-arrow' },
      { swatch: FAMILY.violet.tint, edge: FAMILY.violet.hue, label: 'Activation' },
    ],
    360
  );

  // Lifelines first, so heads and bars sit over them.
  const lifelines = cast.map((p, i) => {
    const line = vline(px[i], headY + HEAD_H, lineBottom - headY - HEAD_H, '#94A3B8', [4, 5], 1.5);
    d.add(line);
    return line;
  });

  // Activation bars, from the message that wakes a participant to the one it answers with.
  const bars: Array<{ lane: number; top: number; bottom: number; node: NewNodeInput }> = [];
  const activate = (lane: number, first: number, last: number) => {
    const top = rowY[first] - 14;
    const bottom = rowY[last] + (PKCE[last].from === PKCE[last].to ? 34 : 0) + 14;
    const f = FAMILY[cast[lane].family];
    const node = d.surface(px[lane] - BAR / 2, top, BAR, bottom - top, { fill: f.tint, edge: f.hue, radius: 3, strokeWidth: 1.25 });
    bars.push({ lane, top, bottom, node });
  };
  activate(1, 0, PKCE.length - 1);
  activate(2, 2, 5);
  activate(2, 6, 8);
  activate(3, 9, 11);

  cast.forEach((p, i) => {
    d.node(px[i] - HEAD_W / 2, headY, HEAD_W, HEAD_H, p.name, {
      family: p.family,
      radius: p.actor ? HEAD_H / 2 : 10,
      size: 15,
      weight: 700,
      strokeWidth: 1.75,
    });
  });

  /** The bar a message lands on at `y`, or the bare lifeline. */
  const target = (lane: number, y: number) => {
    const bar = bars.find((b) => b.lane === lane && y >= b.top && y <= b.bottom);
    if (bar) return { node: bar.node, top: bar.top, height: bar.bottom - bar.top };
    return { node: lifelines[lane], top: headY + HEAD_H, height: lineBottom - headY - HEAD_H };
  };

  PKCE.forEach((m, i) => {
    const y = rowY[i];
    const self = m.from === m.to;
    const a = target(m.from, y);
    const yTo = self ? y + 34 : y;
    const b = target(m.to, yTo);
    const right = px[m.to] > px[m.from];
    const label = `${i + 1}  ${m.text}`;
    const labelW = textWidth(label, 12, 500) + 6;
    d.wire(a.node, b.node, {
      routing: self ? 'orthogonal' : 'straight',
      fromAnchor: { u: self || right ? 1 : 0, v: (y - a.top) / a.height },
      toAnchor: { u: self ? 1 : right ? 0 : 1, v: (yTo - b.top) / b.height },
      avoid: false,
      corner: 6,
      color: INK_SOFT_WIRE,
      width: 1.75,
      end: m.reply ? 'open-arrow' : 'arrow',
      ...(m.reply ? { dash: [6, 5] } : null),
      label,
      at: m.at ?? 0.5,
      // Above the line; beside the loop for a self-message.
      dn: self ? -(labelW / 2 + 14) : right ? -14 : 14,
    });
  });

  // The same flow as code, and why PKCE exists.
  const code = d.code(codeX, headY, codeW, PKCE_MERMAID, 'mermaid', { fontSize: 12.5, filename: 'oauth-pkce.mmd', lineNumbers: true });
  const below = headY + (code.height as number) + 32;
  const why = Draft.calloutHeight(codeW, 'Why PKCE exists', PKCE_WHY);
  d.callout(codeX, below, codeW, 'Why PKCE exists', PKCE_WHY, 'violet', { lift: true });
  d.sticky(codeX, below + why + 24, codeW, 120, 'Select the code block and press Render as diagram: the Mermaid draws itself as shapes and arrows you can edit.', 'sky');
  return d.nodes();
}

const INK_SOFT_WIRE = '#64748B';

const PKCE_WHY =
  'A browser or mobile app cannot keep a client secret, so a stolen authorization code used to be enough to get tokens. With PKCE the app sends only a hash of a random verifier at step 3 and reveals the verifier at step 7. An attacker holding the code has no verifier, and the server refuses the swap. OAuth 2.1 makes PKCE mandatory for every client.';

// ---------------------------------------------------------------------------
// 7. Database schema (ERD) for a SaaS app
// ---------------------------------------------------------------------------

/** A column: its key marker (PK, FK, UQ or blank), name and Postgres type. */
type Column = [string, string, string];

interface Entity {
  name: string;
  family: Family;
  columns: Column[];
}

const ENTITIES: Record<string, Entity> = {
  users: {
    name: 'users',
    family: 'indigo',
    columns: [
      ['PK', 'id', 'uuid'],
      ['UQ', 'email', 'citext'],
      ['', 'name', 'text'],
      ['', 'avatar_url', 'text'],
      ['', 'created_at', 'timestamptz'],
    ],
  },
  memberships: {
    name: 'memberships',
    family: 'indigo',
    columns: [
      ['PK', 'id', 'uuid'],
      ['FK', 'org_id', 'uuid'],
      ['FK', 'user_id', 'uuid'],
      ['', 'role', 'text'],
      ['', 'created_at', 'timestamptz'],
    ],
  },
  organizations: {
    name: 'organizations',
    family: 'indigo',
    columns: [
      ['PK', 'id', 'uuid'],
      ['UQ', 'slug', 'text'],
      ['', 'name', 'text'],
      ['', 'created_at', 'timestamptz'],
    ],
  },
  subscriptions: {
    name: 'subscriptions',
    family: 'amber',
    columns: [
      ['PK', 'id', 'uuid'],
      ['FK', 'org_id', 'uuid'],
      ['UQ', 'stripe_id', 'text'],
      ['', 'plan', 'text'],
      ['', 'status', 'text'],
      ['', 'renews_at', 'timestamptz'],
    ],
  },
  comments: {
    name: 'comments',
    family: 'teal',
    columns: [
      ['PK', 'id', 'uuid'],
      ['FK', 'task_id', 'uuid'],
      ['FK', 'author_id', 'uuid'],
      ['', 'body', 'text'],
      ['', 'created_at', 'timestamptz'],
    ],
  },
  tasks: {
    name: 'tasks',
    family: 'teal',
    columns: [
      ['PK', 'id', 'uuid'],
      ['FK', 'project_id', 'uuid'],
      ['FK', 'assignee_id', 'uuid'],
      ['', 'title', 'text'],
      ['', 'status', 'text'],
      ['', 'due_date', 'date'],
    ],
  },
  projects: {
    name: 'projects',
    family: 'teal',
    columns: [
      ['PK', 'id', 'uuid'],
      ['FK', 'org_id', 'uuid'],
      ['', 'name', 'text'],
      ['', 'archived_at', 'timestamptz'],
    ],
  },
  invoices: {
    name: 'invoices',
    family: 'amber',
    columns: [
      ['PK', 'id', 'uuid'],
      ['FK', 'subscription_id', 'uuid'],
      ['', 'amount_cents', 'integer'],
      ['', 'status', 'text'],
      ['', 'issued_at', 'timestamptz'],
    ],
  },
};

const SCHEMA_SQL = `-- Who belongs to which organisation, and as what.
CREATE TABLE memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES users (id) ON DELETE SET NULL,
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'todo'
              CHECK (status IN ('todo', 'doing', 'done')),
  due_date    date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Postgres does not index foreign keys for you.
CREATE INDEX tasks_project_status_idx ON tasks (project_id, status);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id);`;

const KEY_INK: Record<string, string> = { PK: '#B45309', FK: '#4F46E5', UQ: '#0F766E' };

function saasSchema() {
  const d = new Draft();
  const HEADER = 152;
  const TW = 304;
  const ROW = 32;
  const GAP_X = 136;
  const GAP_Y = 112;
  const colX = (c: number) => M + 32 + c * (TW + GAP_X);
  const top = M + HEADER + 72;
  const rowsOf = (e: Entity) => e.columns.length + 1;
  const row1H = Math.max(...['users', 'memberships', 'organizations', 'subscriptions'].map((k) => rowsOf(ENTITIES[k]) * ROW));
  const row2Y = top + row1H + GAP_Y;
  const row2H = Math.max(...['comments', 'tasks', 'projects', 'invoices'].map((k) => rowsOf(ENTITIES[k]) * ROW));
  const bottomY = row2Y + row2H + 88;
  const W = colX(4) - GAP_X + 32 + M;
  const codeW = 832;
  const codeH = codeHeight(SCHEMA_SQL, 12);
  const H = bottomY + codeH + M;

  d.board(W, H, 'SaaS schema', '🗃️', 'Eight tables, their keys and how they relate, plus the SQL for two of them');
  d.header(
    M,
    M,
    W - M * 2,
    HEADER,
    'Database schema for a SaaS app',
    'Multi-tenant from the first table: every row hangs off an organisation, people join through memberships, and billing mirrors Stripe. Lines attach to the exact key they join.',
    [
      { line: WIRE_INK, label: 'Exactly one', end: 'bar' },
      { line: WIRE_INK, label: 'Many', end: 'crow-foot' },
      { line: WIRE_INK, label: 'Zero or one', end: 'circle', dash: [6, 5] },
      { swatch: FAMILY.indigo.tint, edge: FAMILY.indigo.hue, label: 'Identity' },
      { swatch: FAMILY.teal.tint, edge: FAMILY.teal.hue, label: 'Work' },
      { swatch: FAMILY.amber.tint, edge: FAMILY.amber.hue, label: 'Billing' },
    ],
    400
  );

  const tables: Record<string, NewNodeInput> = {};
  const place = (key: string, c: number, y: number) => {
    const e = ENTITIES[key];
    const styles: Record<string, { bold?: boolean; color?: string }> = { '0:0': { bold: true } };
    e.columns.forEach(([mark], r) => {
      if (mark) styles[`${r + 1}:0`] = { bold: true, color: KEY_INK[mark] };
      if (mark === 'PK') styles[`${r + 1}:1`] = { bold: true };
    });
    tables[key] = d.table(
      colX(c),
      y,
      TW,
      {
        header: true,
        theme: 'striped',
        accent: FAMILY[e.family].hue,
        fontSize: 13,
        columns: [
          { width: 0.16, type: 'text', align: 'center' },
          { width: 0.5, type: 'text' },
          { width: 0.34, type: 'text' },
        ],
        cells: [[e.name, '', ''], ...e.columns.map((col) => [...col])],
        merges: [{ r: 0, c: 0, rs: 1, cs: 3 }],
        styles,
      },
      ROW
    );
  };
  place('users', 0, top);
  place('memberships', 1, top);
  place('organizations', 2, top);
  place('subscriptions', 3, top);
  place('comments', 0, row2Y);
  place('tasks', 1, row2Y);
  place('projects', 2, row2Y);
  place('invoices', 3, row2Y);

  /** The anchor at the middle of a column's row, on one side of its table. */
  const at = (key: string, column: string, side: 'left' | 'right') => {
    const e = ENTITIES[key];
    const r = e.columns.findIndex((c) => c[1] === column) + 1;
    return { u: side === 'left' ? 0 : 1, v: (r + 0.5) / rowsOf(e) };
  };
  const rel = (
    one: string,
    many: string,
    fk: string,
    sides: { one: 'left' | 'right' | 'top' | 'bottom'; many: 'left' | 'right' | 'top' | 'bottom'; u?: number },
    o: { oneToOne?: boolean; optional?: boolean } = {}
  ) => {
    const vertical = sides.one === 'top' || sides.one === 'bottom';
    d.wire(tables[one], tables[many], {
      ...(vertical
        ? { fromAnchor: { u: sides.u ?? 0.5, v: sides.one === 'bottom' ? 1 : 0 }, toAnchor: { u: sides.u ?? 0.5, v: sides.many === 'top' ? 0 : 1 } }
        : { fromAnchor: at(one, 'id', sides.one as 'left' | 'right'), toAnchor: at(many, fk, sides.many as 'left' | 'right') }),
      start: o.optional ? 'circle' : 'bar',
      end: o.oneToOne ? 'bar' : 'crow-foot',
      color: WIRE_INK,
      width: 1.75,
      endScale: 1.35,
      corner: 8,
      ...(o.optional ? { dash: [6, 5] } : null),
    });
  };
  rel('users', 'memberships', 'user_id', { one: 'right', many: 'left' });
  rel('organizations', 'memberships', 'org_id', { one: 'left', many: 'right' });
  rel('organizations', 'subscriptions', 'org_id', { one: 'right', many: 'left' }, { oneToOne: true });
  rel('organizations', 'projects', 'org_id', { one: 'bottom', many: 'top' });
  rel('subscriptions', 'invoices', 'subscription_id', { one: 'bottom', many: 'top' });
  rel('projects', 'tasks', 'project_id', { one: 'left', many: 'right' });
  rel('tasks', 'comments', 'task_id', { one: 'left', many: 'right' });
  rel('users', 'comments', 'author_id', { one: 'bottom', many: 'top', u: 0.3 });
  rel('users', 'tasks', 'assignee_id', { one: 'bottom', many: 'top', u: 0.78 }, { optional: true });

  // The SQL for two of the tables, and the reasoning behind the shape.
  d.code(M + 32, bottomY, codeW, SCHEMA_SQL, 'sql', { fontSize: 12, filename: 'schema.sql' });
  const nx = M + 32 + codeW + 40;
  const nw = W - M - 32 - nx;
  const notes: Array<[string, string, Family]> = [
    ['Tenant on every row', 'Projects, tasks and comments all reach an organisation, so one WHERE clause (or a row-level security policy) keeps customers apart.', 'indigo'],
    ['Index your foreign keys', 'Postgres indexes a primary key automatically but never a foreign key. Without one, deleting an organisation scans every task.', 'teal'],
    ['Stripe stays the source of truth', 'subscriptions and invoices are a cache of Stripe, updated from webhooks. Never let the two disagree about who has paid.', 'amber'],
  ];
  let ny = bottomY;
  for (const [t, b, f] of notes) {
    d.callout(nx, ny, nw, t, b, f);
    ny += Draft.calloutHeight(nw, t, b) + 20;
  }
  return d.nodes();
}

// ---------------------------------------------------------------------------
// 8. Decision tree: choosing a database
// ---------------------------------------------------------------------------

const DATABASES: Array<{ name: string; why: string; family: Family }> = [
  { name: 'DynamoDB', why: 'Single-digit-millisecond reads at any scale, if you design keys around every query up front.', family: 'orange' },
  { name: 'PostgreSQL', why: 'Joins, transactions, constraints and JSONB. The right default for most products.', family: 'blue' },
  { name: 'Redis', why: 'In-memory keys for caches, sessions, rate limits and queues. Keep it disposable.', family: 'rose' },
  { name: 'ClickHouse', why: 'Columnar storage that scans billions of rows a second for dashboards and analytics.', family: 'amber' },
  { name: 'Neo4j', why: 'Relationships stored as pointers, so deep traversals stay fast as the graph grows.', family: 'teal' },
  { name: 'A vector database', why: 'Nearest-neighbour search over embeddings, for semantic search and RAG.', family: 'violet' },
];

function databaseTree() {
  const d = new Draft();
  const HEADER = 152;
  const LEAF_W = 264;
  const LEAF_GAP = 40;
  const LEAF_H = 136;
  const DW = 232;
  const DH = 128;
  const ROW = 168;
  const L = M + 32;
  const leafX = (i: number) => L + i * (LEAF_W + LEAF_GAP);
  const leafC = (i: number) => leafX(i) + LEAF_W / 2;
  const W = leafX(DATABASES.length) - LEAF_GAP + 32 + M;
  const top = M + HEADER + 72;
  const rowY = (k: number) => top + k * ROW;
  const leavesY = rowY(4) + 8;
  const notesY = leavesY + LEAF_H + 64;
  const NOTE_H = 152;
  const H = notesY + NOTE_H + M;

  d.board(W, H, 'Choosing a database', '🧭', 'Five yes-or-no questions that land on the right engine for the job');
  d.header(
    M,
    M,
    W - M * 2,
    HEADER,
    'Which database should you use?',
    'Answer from the top. Most products only ever need the first branch: the others are specialists you add beside your system of record, never instead of it.',
    [
      { line: YES, label: 'Yes' },
      { line: NO, label: 'No' },
    ],
    280
  );

  const ask = (cx: number, k: number, q: string) => d.decision(cx - DW / 2, rowY(k), DW, DH, q, 'amber', 13.5);
  const cA = (leafC(0) + leafC(1)) / 2;
  const cD = (leafC(4) + leafC(5)) / 2;
  const cC = (leafC(3) + cD) / 2;
  const cB = (leafC(2) + cC) / 2;
  const cRoot = (cA + cB) / 2;

  const root = ask(cRoot, 0, 'The system of\nrecord for your\nproduct?');
  const a = ask(cA, 1, 'Key-value\naccess at huge\nscale?');
  const b = ask(cB, 1, 'Hot keys read\nin under a\nmillisecond?');
  const c = ask(cC, 2, 'Aggregating\nbillions of\nrows?');
  const dq = ask(cD, 3, 'Following\nrelationships\nmany hops?');

  const leaves = DATABASES.map((db, i) =>
    d.card(leafX(i), leavesY, LEAF_W, LEAF_H, { title: db.name, sub: db.why, glyph: 'database', family: db.family, lift: i === 1 })
  );

  const yes = (from: NewNodeInput, to: NewNodeInput) => d.wire(from, to, { from: 'left', to: 'top', color: YES, label: 'Yes', corner: 12 });
  const no = (from: NewNodeInput, to: NewNodeInput, label = 'No') => d.wire(from, to, { from: 'right', to: 'top', color: NO, label, corner: 12 });
  yes(root, a);
  no(root, b);
  yes(a, leaves[0]);
  no(a, leaves[1]);
  yes(b, leaves[2]);
  no(b, c);
  yes(c, leaves[3]);
  no(c, dq);
  yes(dq, leaves[4]);
  no(dq, leaves[5], 'No: by meaning');

  const rules: Array<[string, StickyTheme]> = [
    ['Start with Postgres. It handles JSON, full-text search and vectors well enough for most products; add a specialist when a real query outgrows it.', 'yellow'],
    ['Pick DynamoDB only when you can list every query today. A new access pattern later can mean copying every row into a new index.', 'peach'],
    ['Treat Redis as a cache: if it vanished tonight, you should be able to rebuild it from the system of record.', 'pink'],
    ['Before a vector database, try pgvector. Keeping embeddings next to the rows they describe saves a whole sync pipeline.', 'lavender'],
  ];
  const NW = (W - M * 2 - 64 - 3 * 32) / 4;
  rules.forEach(([body, theme], i) => d.sticky(L + i * (NW + 32), notesY, NW, NOTE_H, body, theme));
  return d.nodes();
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

export const DIAGRAMS: Template[] = [
  {
    id: 'diagrams-launch-mind-map',
    category: 'diagrams',
    name: 'Mind map: launching a product',
    blurb: 'Six workstreams, from positioning to the numbers that prove the launch worked.',
    teaches: ['Mind map', 'Curved connectors', 'Emoji topics'],
    tags: ['mind map', 'launch', 'go to market', 'gtm', 'brainstorm', 'product'],
    accent: 'indigo',
    build: launchMap,
  },
  {
    id: 'diagrams-internet-mind-map',
    category: 'diagrams',
    name: 'Mind map: how the internet works',
    blurb: 'DNS, TCP/IP, TLS, HTTP, CDNs and BGP: one true fact per leaf, then a page load in order.',
    teaches: ['Mind map', 'Sketch mode', 'Connectors'],
    tags: ['mind map', 'internet', 'networking', 'dns', 'tcp', 'tls', 'http', 'bgp', 'cdn', 'education'],
    accent: 'teal',
    build: internetMap,
  },
  {
    id: 'diagrams-series-a-roadmap',
    category: 'diagrams',
    name: 'Roadmap: from idea to Series A',
    blurb: 'Nine milestones on one winding road, each with a checklist and the number that proves it.',
    teaches: ['Curved connectors', 'Sticky checklists', 'Roadmap'],
    tags: ['roadmap', 'startup', 'fundraising', 'series a', 'seed', 'pmf', 'founder'],
    accent: 'amber',
    build: seriesARoadmap,
  },
  {
    id: 'diagrams-ml-engineer-roadmap',
    category: 'diagrams',
    name: 'Roadmap: becoming an ML engineer',
    blurb: 'Six tracks over a year, prerequisites drawn as arrows, progress marked, resources pinned beside.',
    teaches: ['Lanes', 'Routed connectors', 'Stickies'],
    tags: ['roadmap', 'machine learning', 'ml', 'career', 'learning path', 'ai', 'mlops'],
    accent: 'violet',
    build: mlRoadmap,
  },
  {
    id: 'diagrams-support-swimlane',
    category: 'diagrams',
    name: 'Swimlane: support escalation',
    blurb: 'Five teams, three decisions and the SLA clocks, from first report to a confirmed fix.',
    teaches: ['Swimlanes', 'Orthogonal routing', 'Flowchart'],
    tags: ['swimlane', 'process', 'flowchart', 'support', 'customer success', 'sla', 'bpmn', 'escalation'],
    accent: 'blue',
    build: supportSwimlane,
  },
  {
    id: 'diagrams-oauth-pkce-sequence',
    category: 'diagrams',
    name: 'Sequence: OAuth 2.0 login with PKCE',
    blurb: 'Four lifelines, thirteen numbered messages, and the same flow written as Mermaid.',
    teaches: ['Sequence diagram', 'Mermaid', 'Anchored connectors'],
    tags: ['sequence diagram', 'oauth', 'pkce', 'auth', 'security', 'uml', 'mermaid', 'login'],
    accent: 'violet',
    build: pkceSequence,
  },
  {
    id: 'diagrams-saas-schema',
    category: 'diagrams',
    name: 'Database schema for a SaaS app',
    blurb: 'Eight tables with keys and crow’s-foot relationships, plus the SQL that creates two of them.',
    teaches: ['ERD', 'Line ends', 'Tables', 'Code blocks'],
    tags: ['erd', 'schema', 'database', 'postgres', 'sql', 'data model', 'saas', 'multi-tenant'],
    accent: 'sky',
    build: saasSchema,
  },
  {
    id: 'diagrams-choose-a-database',
    category: 'diagrams',
    name: 'Decision tree: choosing a database',
    blurb: 'Five yes-or-no questions that land on Postgres, DynamoDB, Redis, ClickHouse, Neo4j or vectors.',
    teaches: ['Decision tree', 'Labelled connectors', 'Stickies'],
    tags: ['decision tree', 'database', 'architecture', 'postgres', 'redis', 'dynamodb', 'clickhouse', 'neo4j', 'vector'],
    accent: 'amber',
    build: databaseTree,
  },
];
