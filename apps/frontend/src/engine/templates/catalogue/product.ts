import type { NewNodeInput } from '../../document/mutations';
import type { StickyTheme } from '../../model/schema';
import type { Template } from '../templates';
import { HAIRLINE, INK, INK_MID, INK_SOFT, INK_STRONG, layer } from '../templateKit';
import {
  FRAME_GAP_X,
  FRAME_GAP_Y,
  PAD,
  PEOPLE,
  TAG,
  type Person,
  body,
  card,
  cellRef,
  chartNode,
  chartSpec,
  chip,
  grid,
  gridModules,
  head,
  headline,
  label,
  legend,
  linked,
  note,
  page,
  plate,
  progress,
  rule,
  sheet,
  sink,
  wire,
  words,
  wordsHeight,
} from './productKit';

/**
 * Product and teams: the boards a team keeps open for a quarter.
 *
 * Every board belongs to one fictional company, Northwind Labs, and its
 * product, Northwind Route (dispatch and route planning for regional
 * carriers), so the same people own the same work from the planning wall to
 * the retro. Each is a set of frames on white paper: see `productKit` for why.
 */

// ---------------------------------------------------------------------------
// Shared colour
// ---------------------------------------------------------------------------

/** Status, as bar and swatch colour. Mid-tones: they sit on white paper, never carry text. */
const STATUS = {
  onTrack: { color: '#34D399', label: 'On track' },
  atRisk: { color: '#FBBF24', label: 'At risk' },
  blocked: { color: '#FB7185', label: 'Blocked' },
  exploring: { color: '#A5B4FC', label: 'Exploring' },
} as const;
type Status = keyof typeof STATUS;

/** Progress colour by share done, the way an OKR check-in reads it. */
const progressColor = (share: number) => (share >= 0.7 ? '#10B981' : share >= 0.4 ? '#F59E0B' : '#F43F5E');

/** Ink for status words on a white page: each a 700 hue that clears 4.5:1. */
const STATUS_INK = { good: '#047857', warn: '#B45309', bad: '#BE123C', info: '#4338CA' } as const;

const pct = (share: number) => `${Math.round(share * 100)}%`;

// ---------------------------------------------------------------------------
// 1. Q3 planning wall
// ---------------------------------------------------------------------------

interface Initiative {
  text: string;
  owner: Person;
  votes: Record<string, number>;
}

interface Theme {
  title: string;
  icon: string;
  description: string;
  metric: string;
  measure: string;
  paper: StickyTheme;
  initiatives: Initiative[];
  exit: { owner: Person; items: string };
}

const THEMES: Theme[] = [
  {
    title: 'Faster dispatch',
    icon: '🚚',
    description: "Get an order onto a driver's phone in half the time",
    metric: 'Order to dispatch: 6.1 min → 3 min',
    measure: 'Median across EU carriers, weekly in Looker',
    paper: 'yellow',
    initiatives: [
      { text: 'Auto-assign v2: score drivers by ETA, hours left and vehicle fit', owner: 'marcus', votes: { '+1': 6, '🔥': 2 } },
      { text: 'Bulk dispatch from the map: lasso 40 orders, assign in one go', owner: 'sofia', votes: { '+1': 4 } },
      { text: 'Recalculate ETAs live when a driver leaves the planned route', owner: 'tomas', votes: { '+1': 3, '👀': 1 } },
    ],
    exit: {
      owner: 'marcus',
      items: '[x] Routing API v2 spec\n[x] Load test at 3× peak\n[ ] Beta with Hartmann\n[ ] GA to EU carriers',
    },
  },
  {
    title: 'Self-serve growth',
    icon: '📈',
    description: 'Let a 20-truck fleet buy and go live without a sales call',
    metric: 'Trial to paid: 9% → 15%',
    measure: 'Self-serve trials started this quarter',
    paper: 'mint',
    initiatives: [
      { text: 'Card checkout on Stripe Billing, monthly and annual plans', owner: 'lena', votes: { '+1': 7 } },
      { text: 'Guided setup: import drivers and vehicles from CSV or Samsara', owner: 'priya', votes: { '+1': 5, '❤️': 2 } },
      { text: 'Pricing page with a fleet-size calculator, no demo gate', owner: 'lena', votes: { '+1': 2 } },
    ],
    exit: {
      owner: 'priya',
      items: '[x] Pricing signed off\n[ ] Checkout behind a flag\n[ ] Day 1–7 onboarding emails\n[ ] Remove "Book a demo"',
    },
  },
  {
    title: 'Platform reliability',
    icon: '🛡️',
    description: 'Hit 99.95% uptime and halve the pages on-call gets',
    metric: 'Uptime: 99.81% → 99.95%',
    measure: 'And pages per on-call week from 23 to 10',
    paper: 'sky',
    initiatives: [
      { text: 'Move the dispatch queue from Redis lists to Kafka, with replay', owner: 'daniel', votes: { '+1': 5 } },
      { text: 'Postgres 16 upgrade, plus read replicas for reporting', owner: 'daniel', votes: { '+1': 3 } },
      { text: 'SLO dashboards and alert routing per service in Grafana', owner: 'aiko', votes: { '+1': 4, '🎯': 1 } },
    ],
    exit: {
      owner: 'aiko',
      items: '[x] Error budget policy\n[x] Runbooks, top 10 alerts\n[ ] Region failover game day\n[ ] Under 10 pages a week',
    },
  },
];

function planningWall(): NewNodeInput[] {
  const N: NewNodeInput[] = [];
  const NOTE = 240;
  const THEME_W = PAD + NOTE + 32 + NOTE + PAD;
  const LEFT_W = THEME_W * 3 + FRAME_GAP_X * 2;

  // --- Header ---------------------------------------------------------------
  const HEADER_H = 216;
  N.push(page(0, 0, LEFT_W, HEADER_H, 'Q3 2026 planning', '🗓️', 'Northwind Route, July to September'));
  N.push(headline(PAD, 40, 980, 'Q3 2026 planning: Northwind Route'));
  N.push(
    body(
      PAD,
      96,
      980,
      'Three themes, nine initiatives, six sprints. Stamp +1 on what matters most, check your chip is on what you own, and flag anything that blocks you in the risks lane before the August review.',
      16
    )
  );
  const dates: Array<[string, string]> = [
    ['Jul 6', 'Kickoff and voting'],
    ['Aug 14', 'Mid-quarter review'],
    ['Sep 25', 'Close and demo day'],
  ];
  const DATE_W = 216;
  dates.forEach(([when, what], i) => {
    const x = LEFT_W - PAD - (DATE_W + 16) * (dates.length - i) + 16;
    N.push(card(x, 44, DATE_W, 128));
    N.push(label(x + 20, 64, when, { size: 26, weight: 700, color: INK_STRONG }));
    N.push(label(x + 20, 108, what, { size: 14, weight: 500, color: INK_SOFT }));
  });

  // --- Themes ---------------------------------------------------------------
  const THEME_Y = HEADER_H + FRAME_GAP_Y;
  const THEME_H = 680;
  THEMES.forEach((t, i) => {
    const x = i * (THEME_W + FRAME_GAP_X);
    N.push(page(x, THEME_Y, THEME_W, THEME_H, t.title, t.icon, t.description));
    N.push(head(x + PAD, THEME_Y + 36, THEME_W - PAD * 2, t.metric, 20));
    N.push(body(x + PAD, THEME_Y + 70, THEME_W - PAD * 2, t.measure, 14));
    const cells = [
      [x + PAD, THEME_Y + 128],
      [x + PAD + NOTE + 32, THEME_Y + 128],
      [x + PAD, THEME_Y + 128 + NOTE + 32],
    ];
    t.initiatives.forEach((it, k) => {
      N.push(note(cells[k][0], cells[k][1], it.text, t.paper, { w: NOTE, owner: it.owner, stamps: it.votes, fontSize: 22 }));
    });
    N.push(
      note(x + PAD + NOTE + 32, THEME_Y + 128 + NOTE + 32, t.exit.items, 'white', { w: NOTE, owner: t.exit.owner, checklist: true, fontSize: 18 })
    );
  });

  // --- Capacity -------------------------------------------------------------
  const CAP_X = LEFT_W + FRAME_GAP_X;
  const CAP_W = 1100;
  const CAP_H = THEME_Y + THEME_H;
  N.push(page(CAP_X, 0, CAP_W, CAP_H, 'Capacity', '⚖️', 'Story points per squad and sprint, after holidays and on-call'));
  const inner = CAP_W - PAD * 2;
  N.push(head(CAP_X + PAD, 36, inner, 'Can we carry it?', 22));
  N.push(
    body(
      CAP_X + PAD,
      72,
      inner,
      'Capacity sums each squad’s sprints; Load divides what the initiatives need by it. Change a sprint and the totals, the red flag and the chart all follow.'
    )
  );

  const squads = ['Dispatch', 'Driver app', 'Growth', 'Platform'];
  const sprints = [
    [34, 32, 34, 30, 34, 34],
    [21, 21, 18, 21, 21, 21],
    [26, 24, 26, 26, 22, 26],
    [30, 30, 28, 30, 30, 30],
  ];
  const committed = [176, 104, 156, 141];
  const capacity = sprints.map((row) => row.reduce((a, b) => a + b, 0));
  const totalCap = capacity.reduce((a, b) => a + b, 0);
  const totalCommitted = committed.reduce((a, b) => a + b, 0);
  const heads = ['S13 · Jul 6', 'S14 · Jul 20', 'S15 · Aug 3', 'S16 · Aug 17', 'S17 · Aug 31', 'S18 · Sep 14'];
  const TOTAL_ROW = squads.length + 2; // spreadsheet row of the totals line
  const cap = sheet(CAP_X + PAD, 132, inner, {
    title: 'Q3 capacity',
    theme: 'clean',
    accent: '#0F766E',
    fontSize: 13,
    firstColumn: true,
    columns: [
      { head: 'Squad', width: 1.3, cells: [...squads, 'All squads'] },
      ...heads.map((h, s) => ({
        head: h,
        type: 'number' as const,
        width: 1,
        cells: [...sprints.map((row) => String(row[s])), `=SUM(${cellRef(s + 1, 2)}:${cellRef(s + 1, squads.length + 1)})`],
      })),
      {
        head: 'Capacity',
        type: 'number' as const,
        width: 1,
        cells: [...squads.map((_, r) => `=SUM(B${r + 2}:G${r + 2})`), `=SUM(H2:H${squads.length + 1})`],
        values: [...capacity, totalCap],
        style: { bold: true },
      },
      {
        head: 'Committed',
        type: 'number' as const,
        width: 1,
        cells: [...committed.map(String), `=SUM(I2:I${squads.length + 1})`],
        values: [...committed, totalCommitted],
      },
      {
        head: 'Load',
        type: 'percent' as const,
        width: 0.8,
        cells: [...squads.map((_, r) => `=ROUND(I${r + 2}/H${r + 2},2)`), `=ROUND(I${TOTAL_ROW}/H${TOTAL_ROW},2)`],
        style: { bold: true },
      },
    ],
    rules: [{ col: 9, when: '>0.9', fill: '#FEE2E2', color: '#991B1B', bold: true }],
    styles: Object.fromEntries(Array.from({ length: 10 }, (_, c) => [`${squads.length + 1}:${c}`, { bold: true, fill: '#F1F5F9' }])),
  });
  N.push(cap.node);

  const CHART_Y = 132 + cap.height + 40;
  N.push(head(CAP_X + PAD, CHART_Y, inner, 'Capacity against committed, by squad', 17));
  N.push(
    chartNode(
      CAP_X + PAD,
      CHART_Y + 36,
      inner,
      360,
      linked(cap, { cat: 0, series: [7, 8], count: squads.length }, chartSpec('bar', {
        title: undefined,
        series: [
          { name: 'Capacity', values: [], color: '#99F6E4' },
          { name: 'Committed', values: [], color: '#0F766E' },
        ],
        showLegend: false,
        showValues: false,
        valueSuffix: ' pts',
      }))
    )
  );
  N.push(...legend(CAP_X + PAD, CHART_Y + 36 + 360 + 8, [
    { color: '#99F6E4', text: 'Capacity' },
    { color: '#0F766E', text: 'Committed' },
  ]));
  const NOTE_Y = CHART_Y + 36 + 360 + 48;
  const halfW = (inner - 24) / 2;
  N.push(
    note(CAP_X + PAD, NOTE_Y, 'Growth is at 104%. Move CSV import to S17, or borrow a Platform engineer for S15–S16?', 'peach', {
      w: halfW,
      h: 150,
      owner: 'priya',
      stamps: { '👀': 3 },
      fontSize: 20,
    })
  );
  N.push(
    note(CAP_X + PAD + halfW + 24, NOTE_Y, 'Platform has 37 spare points. Happy to lend two people to checkout QA in August.', 'lime', {
      w: halfW,
      h: 150,
      owner: 'daniel',
      stamps: { '+1': 4 },
      fontSize: 20,
    })
  );

  // --- Risks and dependencies ----------------------------------------------
  const LOW_Y = CAP_H + FRAME_GAP_Y;
  const LOW_H = 720;
  N.push(page(0, LOW_Y, LEFT_W, LOW_H, 'Risks and dependencies', '🧯', 'What could stop an initiative, and what it would take with it'));
  const COL = { risk: PAD, blocked: PAD + 320, knock: PAD + 640, plan: PAD + 960 };
  const colHead = (x: number, text: string) => N.push(label(x, LOW_Y + 40, text, { size: 14, weight: 650, color: INK_SOFT }));
  colHead(COL.risk, 'Risk or blocker');
  colHead(COL.blocked, 'What it blocks');
  colHead(COL.knock, 'Knock-on');
  colHead(COL.plan, 'Mitigation and owner');
  N.push(rule({ x: PAD, y: LOW_Y + 76 }, { x: LEFT_W - PAD, y: LOW_Y + 76 }, { color: HAIRLINE, width: 1 }));

  const item = (x: number, y: number, title: string, meta: string) =>
    chip(x, y, 264, 76, `${title}\n${meta}`, { fill: '#F8FAFC', stroke: '#CBD5E1', radius: 10, size: 13, weight: 600, ink: INK });
  const RISK = { color: '#E11D48', dash: [7, 5] };
  const rows: Array<{
    risk?: { text: string; owner: Person };
    start?: [string, string];
    blocked: [string, string];
    knock?: [string, string];
    why: [string, string];
    plan: string;
  }> = [
    {
      risk: { text: 'Legal sign-off on EU data residency in Frankfurt', owner: 'sam' },
      blocked: ['Auto-assign v2 · EU rollout', 'Marcus Chen · due Aug 28'],
      knock: ['Bulk dispatch from the map', 'Sofia Alvarez · S16'],
      why: ['blocks', 'delays'],
      plan: 'Ship to UK carriers first, behind the per-carrier flag. Sam has the DPA review with counsel on Jul 21; escalate to Priya if it slips past Jul 28.',
    },
    {
      risk: { text: 'Invoices issued before Jul 1 stay on Chargebee', owner: 'lena' },
      blocked: ['Card checkout · Stripe Billing', 'Lena Fischer · due Sep 11'],
      knock: ['Remove the "Book a demo" gate', 'Priya Raman · S18'],
      why: ['delays', 'needs'],
      plan: 'Run both billing systems until the last Chargebee renewal in October. Finance owns the reconciliation report; Lena owns the cut-over date.',
    },
    {
      start: ['Postgres 16 upgrade', 'Daniel Okafor · S14'],
      blocked: ['Read replicas for reporting', 'Daniel Okafor · S15'],
      knock: ['Admin usage dashboard', 'Lena Fischer · S17'],
      why: ['needs', 'feeds'],
      plan: 'Rehearse the upgrade on a restored snapshot first; the 20-minute write freeze is booked for Sunday Jul 26, 05:00 CET.',
    },
  ];
  const ROW_H = 180;
  rows.forEach((r, i) => {
    const y = LOW_Y + 104 + i * (ROW_H + 24);
    const mid = y + ROW_H / 2 - 38;
    const first = r.risk
      ? note(COL.risk, y, r.risk.text, 'coral', { w: 240, h: ROW_H, owner: r.risk.owner, stamps: { '⚠️': 3 }, fontSize: 22 })
      : item(COL.risk, mid, r.start![0], r.start![1]);
    const blocked = item(COL.blocked, mid, r.blocked[0], r.blocked[1]);
    N.push(first, blocked);
    N.push(wire(first, blocked, { label: r.why[0], ...(r.risk ? RISK : {}), from: 'right', to: 'left' }));
    if (r.knock) {
      const knock = item(COL.knock, mid, r.knock[0], r.knock[1]);
      N.push(knock, wire(blocked, knock, { label: r.why[1], from: 'right', to: 'left' }));
    }
    N.push(body(COL.plan, y + ROW_H / 2 - wordsHeight(r.plan, LEFT_W - PAD - COL.plan) / 2, LEFT_W - PAD - COL.plan, r.plan));
  });

  // --- Decisions log --------------------------------------------------------
  N.push(page(CAP_X, LOW_Y, CAP_W, LOW_H, 'Decisions log', '📝', 'What was decided, by whom, and when'));
  N.push(head(CAP_X + PAD, LOW_Y + 36, inner, 'Write it down the day it is decided', 22));
  N.push(body(CAP_X + PAD, LOW_Y + 72, inner, 'Anything still Proposed goes on the agenda for the Aug 14 review. Filter by Status to see what is open.'));
  const status = [
    { label: 'Decided', tag: TAG.green },
    { label: 'Proposed', tag: TAG.amber },
    { label: 'Waiting on legal', tag: TAG.red },
  ];
  const log = sheet(CAP_X + PAD, LOW_Y + 132, inner, {
    title: 'Decisions',
    theme: 'striped',
    accent: '#475569',
    fontSize: 13,
    rowH: 44,
    columns: [
      { head: 'Date', type: 'date', width: 0.75, cells: ['2026-07-02', '2026-07-06', '2026-07-09', '2026-07-16', '2026-07-23', '2026-07-30', '2026-08-06'] },
      {
        head: 'Decision',
        width: 2.9,
        cells: [
          'Defer Android offline maps to Q4',
          'Auto-assign v2 ships behind a per-carrier flag',
          'Price self-serve per vehicle, not per seat',
          'Kafka over SQS for the dispatch queue (replay)',
          'EU data stays in Frankfurt, with no US failover',
          'Samsara import ships read-only first',
          'Freeze new integrations until the review',
        ],
      },
      {
        head: 'Owner',
        type: 'person',
        width: 1.3,
        cells: ['Tomás Herrera', 'Marcus Chen', 'Lena Fischer', 'Daniel Okafor', 'Sam Whitfield', 'Priya Raman', 'Priya Raman'],
      },
      {
        head: 'Status',
        type: 'select',
        width: 1.2,
        options: status,
        cells: ['Decided', 'Decided', 'Decided', 'Decided', 'Waiting on legal', 'Decided', 'Proposed'],
      },
    ],
  });
  N.push(log.node);
  const PARK_Y = LOW_Y + 132 + log.height + 36;
  N.push(head(CAP_X + PAD, PARK_Y, inner, 'Parked until Q4', 17));
  const PW = (inner - 32) / 3;
  [
    ['Driver tipping in the app', 'tomas'],
    ['Fuel-card integration with DKV', 'lena'],
    ['Route replay for disputes', 'marcus'],
  ].forEach(([t, who], i) =>
    N.push(note(CAP_X + PAD + i * (PW + 16), PARK_Y + 36, t, 'white', { w: PW, h: 112, owner: who as Person, fontSize: 18 }))
  );

  return layer(N);
}

// ---------------------------------------------------------------------------
// 2. Brand explorations
// ---------------------------------------------------------------------------

const BRAND = {
  fjord: { hex: '#0E3B43', name: 'Fjord', role: 'Primary · 45%' },
  tide: { hex: '#1F7A8C', name: 'Tide', role: 'Secondary · 12%' },
  glacier: { hex: '#BFE3E8', name: 'Glacier', role: 'Surface · 8%' },
  sand: { hex: '#EFE7DA', name: 'Sand', role: 'Ground · 30%' },
  signal: { hex: '#F2A541', name: 'Signal', role: 'Accent · 5%' },
  ink: { hex: '#14171A', name: 'Ink', role: 'Text' },
} as const;

function brandBoard(): NewNodeInput[] {
  const N: NewNodeInput[] = [];
  const W = 1200;
  const H = 780;
  const inner = W - PAD * 2;
  const X2 = W + FRAME_GAP_X;
  const Y2 = H + FRAME_GAP_Y;
  const B = BRAND;

  // --- Moodboard -------------------------------------------------------------
  N.push(page(0, 0, W, H, 'Moodboard', '🎨', 'Round 2: calm, precise, outdoors, with one warm signal'));
  N.push(head(PAD, 36, inner, 'What Northwind should feel like', 22));
  N.push(body(PAD, 72, inner, 'Drawn, not sourced: every tile is shapes on a grid, so swap a colour in the grid and the board re-tints.'));
  const G = { rows: 3, cols: 4, gutter: 16, spans: { '0:0': { rows: 2, cols: 2 }, '1:3': { rows: 2, cols: 1 }, '2:0': { rows: 1, cols: 2 } } };
  const GX = PAD;
  const GY = 124;
  const GW = inner;
  const GH = 536;
  // Module order: big, top-mid, top-right, mid-mid, tall-right, wide-bottom, bottom-mid.
  const tiles = [B.fjord.hex, B.sand.hex, B.signal.hex, B.glacier.hex, B.tide.hex, B.ink.hex, B.sand.hex];
  N.push(grid(GX, GY, GW, GH, { ...G, palette: tiles, radius: 14 }));
  const m = gridModules(GX, GY, GW, GH, G);

  // Big Fjord tile: a planned route over contour rings.
  {
    const t = m[0];
    const cx = t.x + t.width * 0.62;
    const cy = t.y + t.height * 0.5;
    [300, 220, 140].forEach((d, i) =>
      N.push(plate(cx - d / 2, cy - d / 2, d, d, { kind: 'ellipse', fill: 'none', stroke: B.glacier.hex, strokeWidth: 2, opacity: 0.35 + i * 0.2 }))
    );
    N.push(
      rule({ x: t.x + 48, y: t.y + t.height - 64 }, { x: cx, y: cy }, { color: B.signal.hex, width: 4, dash: [2, 12] }),
      plate(t.x + 36, t.y + t.height - 76, 24, 24, { kind: 'ellipse', fill: B.sand.hex }),
      plate(cx - 22, cy - 56, 44, 56, { kind: 'pin', fill: B.signal.hex })
    );
  }
  // Sand: sun on the horizon.
  {
    const t = m[1];
    N.push(plate(t.x + t.width / 2 - 56, t.y + 30, 112, 56, { kind: 'semicircle', fill: B.signal.hex }));
    [0, 1, 2].forEach((k) =>
      N.push(rule({ x: t.x + 28 + k * 14, y: t.y + 100 + k * 14 }, { x: t.x + t.width - 28 - k * 14, y: t.y + 100 + k * 14 }, { color: B.tide.hex, width: 3 }))
    );
  }
  // Signal: a compass point.
  {
    const t = m[2];
    const s = Math.min(t.width, t.height) - 48;
    N.push(plate(t.x + (t.width - s) / 2, t.y + (t.height - s) / 2, s, s, { kind: 'star', geometry: { points: 4, innerRatio: 0.28 }, fill: B.ink.hex }));
  }
  // Glacier: wind.
  {
    const t = m[3];
    [0, 1, 2].forEach((k) =>
      N.push({
        ...rule({ x: t.x + 28 + k * 18, y: t.y + 46 + k * 34 }, { x: t.x + t.width - 28 - k * 30, y: t.y + 46 + k * 34 }, { color: B.tide.hex, width: 4 }),
        geometry: {
          kind: 'line',
          a: { x: 4, y: 18 },
          b: { x: t.width - 56 - k * 48 + 4, y: 18 },
          lineProfile: 'wavy',
          lineWaves: 2,
          lineAmplitude: 0.7,
        },
        y: t.y + 32 + k * 34,
        height: 36,
      } as NewNodeInput)
    );
  }
  // Tide, tall: forward motion.
  {
    const t = m[4];
    [0, 1, 2].forEach((k) =>
      N.push(plate(t.x + t.width / 2 - 52, t.y + 60 + k * 92, 104, 64, { kind: 'chevron', geometry: { indent: 0.4 }, fill: k === 1 ? B.signal.hex : B.glacier.hex }))
    );
  }
  // Ink, wide: a dotted route home.
  {
    const t = m[5];
    for (let k = 0; k < 9; k += 1) {
      const x = t.x + 44 + k * ((t.width - 120) / 8);
      const y = t.y + t.height / 2 + Math.sin(k * 0.9) * 22;
      N.push(plate(x - 6, y - 6, 12, 12, { kind: 'ellipse', fill: k === 8 ? B.signal.hex : B.glacier.hex }));
    }
    N.push(plate(t.x + t.width - 64, t.y + t.height / 2 - 20, 40, 40, { kind: 'ellipse', fill: 'none', stroke: B.signal.hex, strokeWidth: 3 }));
  }
  // Sand, small: contour lines.
  {
    const t = m[6];
    [0, 1, 2, 3].forEach((k) =>
      N.push(plate(t.x + 24 + k * 12, t.y + 20 + k * 10, t.width - 48 - k * 24, t.height - 40 - k * 20, { kind: 'ellipse', fill: 'none', stroke: B.tide.hex, strokeWidth: 1.5 }))
    );
  }
  const words5 = ['Calm', 'Precise', 'Outdoors', 'Forward motion', 'One warm signal'];
  let kx = PAD;
  words5.forEach((w) => {
    const width = Math.ceil(w.length * 8.2 + 36);
    N.push(chip(kx, GY + GH + 32, width, 36, w, { fill: '#F1F5F9', stroke: HAIRLINE, size: 14, weight: 600, ink: INK_MID }));
    kx += width + 12;
  });

  // --- Logo directions -------------------------------------------------------
  N.push(page(X2, 0, W, H, 'Logo directions', '✏️', 'Three sketches in sketch mode; stamp +1 on the one to take forward'));
  const LW = (inner - 32 * 2) / 3;
  const directions: Array<{ name: string; why: string; quote: string; owner: Person; votes: Record<string, number>; draw: (x: number, y: number, s: number) => NewNodeInput[] }> = [
    {
      name: 'A · Compass',
      why: 'A four-point star inside a ring: direction, found. Reads at 16px; the risk is that half of logistics already owns a compass.',
      quote: 'Strong at app-icon size. Feels familiar, maybe too familiar.',
      owner: 'marcus',
      votes: { '+1': 3 },
      draw: (x, y, s) => [
        plate(x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8, { kind: 'ellipse', fill: 'none', stroke: B.fjord.hex, strokeWidth: 6, sketch: 'medium' }),
        plate(x + s * 0.24, y + s * 0.24, s * 0.52, s * 0.52, { kind: 'star', geometry: { points: 4, innerRatio: 0.3 }, fill: B.signal.hex, stroke: B.fjord.hex, strokeWidth: 3, sketch: 'medium' }),
      ],
    },
    {
      name: 'B · Wind lines',
      why: 'Three lines of moving air, the top one arriving at a point. Ownable, and it animates: the lines can draw on as a route resolves.',
      quote: 'This is the one that feels like us. Calm, and it moves.',
      owner: 'sofia',
      votes: { '+1': 6, '❤️': 2 },
      draw: (x, y, s) => [
        ...[0, 1, 2].map((k) => ({
          ...rule({ x: x + s * 0.08, y: y + s * (0.3 + k * 0.2) }, { x: x + s * (0.86 - k * 0.14), y: y + s * (0.3 + k * 0.2) }, { color: B.tide.hex, width: 10, sketch: 'medium' }),
          geometry: { kind: 'line', a: { x: 4, y: 16 }, b: { x: s * (0.78 - k * 0.14) + 4, y: 16 }, lineProfile: 'wavy', lineWaves: 1, lineAmplitude: 0.8 },
          y: y + s * (0.3 + k * 0.2) - 16,
          height: 32,
        }) as NewNodeInput),
        plate(x + s * 0.84, y + s * 0.3 - 14, 28, 28, { kind: 'ellipse', fill: B.signal.hex, stroke: B.fjord.hex, strokeWidth: 2, sketch: 'medium' }),
      ],
    },
    {
      name: 'C · Monogram',
      why: 'A heavy N in a soft square: confident and easy to stamp on a truck door. It says company more than it says movement.',
      quote: 'Great on the fleet livery. Generic as an app icon.',
      owner: 'tomas',
      votes: { '+1': 2 },
      draw: (x, y, s) => [
        plate(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76, { fill: B.glacier.hex, stroke: B.fjord.hex, strokeWidth: 3, radius: 28, sketch: 'medium' }),
        rule({ x: x + s * 0.33, y: y + s * 0.3 }, { x: x + s * 0.33, y: y + s * 0.7 }, { color: B.fjord.hex, width: 18, sketch: 'medium' }),
        rule({ x: x + s * 0.33, y: y + s * 0.3 }, { x: x + s * 0.67, y: y + s * 0.7 }, { color: B.fjord.hex, width: 18, sketch: 'medium' }),
        rule({ x: x + s * 0.67, y: y + s * 0.3 }, { x: x + s * 0.67, y: y + s * 0.7 }, { color: B.fjord.hex, width: 18, sketch: 'medium' }),
      ],
    },
  ];
  directions.forEach((d, i) => {
    const x = X2 + PAD + i * (LW + 32);
    const CARD_H = 336;
    N.push(card(x, 40, LW, CARD_H, '#FBF8F3'));
    const s = 240;
    N.push(...d.draw(x + (LW - s) / 2, 40 + (CARD_H - s) / 2, s));
    N.push(head(x, 400, LW, d.name, 19));
    N.push(body(x, 434, LW, d.why, 14));
    N.push(note(x, 548, d.quote, 'yellow', { w: LW, h: H - PAD - 548, owner: d.owner, stamps: d.votes, fontSize: 20 }));
  });

  // --- Palette and type ------------------------------------------------------
  N.push(page(0, Y2, W, H, 'Palette and type', '🌈', 'Six colours with their roles, and the faces that set them'));
  N.push(head(PAD, Y2 + 36, 540, 'Palette', 22));
  const swatches = [B.fjord, B.tide, B.glacier, B.sand, B.signal, B.ink];
  const SW = 168;
  swatches.forEach((c, i) => {
    const x = PAD + (i % 3) * (SW + 18);
    const y = Y2 + 88 + Math.floor(i / 3) * 236;
    N.push(plate(x, y, SW, 136, { fill: c.hex, stroke: c.hex === B.sand.hex || c.hex === B.glacier.hex ? '#D6CCBC' : c.hex, radius: 12 }));
    N.push(label(x, y + 148, c.name, { size: 16, weight: 650, color: INK_STRONG }));
    N.push(label(x, y + 172, `${c.hex} · ${c.role}`, { size: 13, weight: 450, color: INK_SOFT }));
  });
  // The proportion bar: how much of a page each colour should cover.
  const shares: Array<[string, number]> = [[B.fjord.hex, 0.45], [B.sand.hex, 0.3], [B.tide.hex, 0.12], [B.glacier.hex, 0.08], [B.signal.hex, 0.05]];
  const BAR_W = SW * 3 + 36;
  let bx = PAD;
  const BAR_Y = Y2 + 584;
  N.push(head(PAD, BAR_Y - 34, BAR_W, 'How much of a page each one covers', 15));
  shares.forEach(([hex, share]) => {
    const w = Math.round(BAR_W * share);
    N.push(plate(bx, BAR_Y, w - 4, 40, { fill: hex, radius: 6 }));
    bx += w;
  });
  N.push(body(PAD, BAR_Y + 56, BAR_W, 'Signal is the only warm colour. Keep it to one thing per screen: the next action, or the live vehicle.', 14));

  const TX = 660;
  N.push(head(TX, Y2 + 36, 500, 'Type', 22));
  N.push(label(TX, Y2 + 84, 'Aa', { size: 112, weight: 600, color: B.fjord.hex, fontFamily: 'Space Grotesk', lineHeight: 1.05 }));
  N.push(label(TX + 190, Y2 + 104, 'Space Grotesk', { size: 22, weight: 650, color: INK_STRONG }));
  N.push(label(TX + 190, Y2 + 138, 'Display and headings · 600 · −2% tracking', { size: 13, weight: 450, color: INK_SOFT }));
  N.push(words(TX, Y2 + 224, 500, 'Every route, already planned.', { size: 36, weight: 600, color: INK_STRONG, fontFamily: 'Space Grotesk', lineHeight: 1.15, letterSpacing: -0.7 }));
  N.push(rule({ x: TX, y: Y2 + 330 }, { x: W - PAD, y: Y2 + 330 }, { color: HAIRLINE, width: 1 }));
  N.push(label(TX, Y2 + 352, 'Inter', { size: 22, weight: 650, color: INK_STRONG }));
  N.push(label(TX + 74, Y2 + 360, 'Body and interface · 400 and 600', { size: 13, weight: 450, color: INK_SOFT }));
  N.push(
    words(
      TX,
      Y2 + 396,
      500,
      'Northwind Route gives each order to the driver who can reach it soonest, then keeps the plan current as the day changes around it.',
      { size: 16, weight: 400, color: INK_MID, lineHeight: 1.55 }
    )
  );
  N.push(rule({ x: TX, y: Y2 + 520 }, { x: W - PAD, y: Y2 + 520 }, { color: HAIRLINE, width: 1 }));
  N.push(label(TX, Y2 + 542, 'Outfit', { size: 22, weight: 650, color: INK_STRONG }));
  N.push(label(TX + 86, Y2 + 550, 'Numbers in data and dashboards', { size: 13, weight: 450, color: INK_SOFT }));
  N.push(label(TX, Y2 + 588, '41,280 routes · 3.1 min', { size: 34, weight: 500, color: B.tide.hex, fontFamily: 'Outfit' }));
  N.push(label(TX, Y2 + 650, 'Tabular figures, so columns of times line up.', { size: 14, weight: 450, color: INK_SOFT }));

  // --- Voice and decision ----------------------------------------------------
  N.push(page(X2, Y2, W, H, 'Voice and the decision', '🗣️', 'How Northwind sounds, and how the directions scored'));
  N.push(head(X2 + PAD, Y2 + 36, 540, 'Voice', 22));
  const VW = 260;
  const dos = ['Say what happened: "Driver assigned. ETA 14:20."', 'Name the fix: "Add a vehicle to dispatch this route."', 'Talk like a dispatcher, not a brochure.'];
  const donts = ['"Leverage AI-powered logistics synergies."', 'Exclamation marks on an error!', 'Blame the user: "Invalid input."'];
  N.push(label(X2 + PAD, Y2 + 84, 'Do', { size: 15, weight: 700, color: STATUS_INK.good }));
  N.push(label(X2 + PAD + VW + 20, Y2 + 84, 'Don’t', { size: 15, weight: 700, color: STATUS_INK.bad }));
  dos.forEach((t, i) => N.push(note(X2 + PAD, Y2 + 116 + i * 148, t, 'mint', { w: VW, h: 132, fontSize: 17 })));
  donts.forEach((t, i) => N.push(note(X2 + PAD + VW + 20, Y2 + 116 + i * 148, t, 'coral', { w: VW, h: 132, fontSize: 17 })));
  N.push(
    note(X2 + PAD, Y2 + 572, 'Take Wind lines into round 3. Borrow the compass point for the app icon.', 'yellow', {
      w: VW * 2 + 20,
      h: 164,
      owner: 'sofia',
      stamps: { '+1': 5, '✅': 1 },
      fontSize: 22,
    })
  );

  const MX = X2 + PAD + VW * 2 + 60;
  const MW = W - PAD - (MX - X2);
  N.push(head(MX, Y2 + 36, MW, 'Comparison', 22));
  const criteria = ['Recognisable at 16px', 'Ownable in logistics', 'Says calm and precise', 'Works in motion', 'Pairs with the wordmark'];
  const weights = [0.25, 0.25, 0.2, 0.15, 0.15];
  const scores = [
    [4, 3, 5],
    [2, 4, 4],
    [3, 5, 4],
    [3, 5, 2],
    [4, 4, 3],
  ];
  const weighted = [0, 1, 2].map((d) => Math.round(scores.reduce((s, row, r) => s + row[d] * weights[r], 0) * 100) / 100);
  const LAST = criteria.length + 1;
  const matrix = sheet(MX, Y2 + 84, MW, {
    title: 'Direction scores',
    theme: 'grid',
    accent: B.tide.hex,
    fontSize: 13,
    firstColumn: true,
    columns: [
      { head: 'Criterion', width: 2.3, cells: [...criteria, 'Weighted score'] },
      { head: 'Weight', type: 'percent', width: 0.9, cells: [...weights.map((w) => String(w * 100)), `=SUM(B2:B${LAST})`], align: 'center' },
      ...['Compass', 'Wind lines', 'Monogram'].map((name, d) => ({
        head: name,
        type: 'number' as const,
        width: 1.05,
        align: 'center' as const,
        cells: [...scores.map((row) => String(row[d])), `=SUMPRODUCT($B2:$B${LAST},${cellRef(d + 2, 2)}:${cellRef(d + 2, LAST)})`],
        values: [...scores.map((row) => row[d]), weighted[d]],
      })),
    ],
    rules: [2, 3, 4].map((col) => ({ col, when: '5', fill: '#DCFCE7', color: '#166534', bold: true })),
    styles: {
      ...Object.fromEntries(Array.from({ length: 5 }, (_, c) => [`${criteria.length + 1}:${c}`, { bold: true, fill: '#F1F5F9' }])),
      [`${criteria.length + 1}:3`]: { bold: true, fill: '#DCFCE7', color: '#166534' },
    },
  });
  N.push(matrix.node);
  const RY = Y2 + 84 + matrix.height + 32;
  N.push(head(MX, RY, MW, 'How the directions compare', 15));
  N.push(...legend(MX, RY + 32, [
    { color: '#F2A541', text: 'Compass' },
    { color: '#1F7A8C', text: 'Wind lines' },
    { color: '#94A3B8', text: 'Monogram' },
  ]));
  N.push(
    chartNode(
      MX,
      RY + 60,
      MW,
      Y2 + H - PAD - (RY + 60),
      linked(matrix, { cat: 0, series: [2, 3, 4], count: criteria.length }, chartSpec('radar', {
        title: undefined,
        series: [
          { name: 'Compass', values: [], color: '#F2A541' },
          { name: 'Wind lines', values: [], color: '#1F7A8C' },
          { name: 'Monogram', values: [], color: '#94A3B8' },
        ],
        showLegend: false,
        yMin: 0,
        yMax: 5,
      }))
    )
  );

  return layer(N);
}

// ---------------------------------------------------------------------------
// 3. Roadmap
// ---------------------------------------------------------------------------

function roadmapBoard(): NewNodeInput[] {
  const N: NewNodeInput[] = [];
  const W = 2280;
  const LABEL_W = 360;
  const TL_X = PAD + LABEL_W + 32;
  const TL_W = W - PAD - TL_X;
  const GUT = 8;
  const QW = (TL_W - GUT * 3) / 4;
  const lanes = [
    {
      name: 'Dispatch',
      owner: 'Marcus Chen',
      epics: [
        { name: 'Auto-assign v2', who: 'Marcus', from: [0, 6], to: [1, 28], status: 'onTrack' as Status },
        { name: 'Bulk dispatch from the map', who: 'Sofia', from: [1, 10], to: [3, 16], status: 'atRisk' as Status },
        { name: 'Multi-day route planning', who: 'Marcus', from: [6, 11], to: [9, 30], status: 'exploring' as Status },
      ],
    },
    {
      name: 'Driver app',
      owner: 'Tomás Herrera',
      epics: [
        { name: 'Live ETA recalculation', who: 'Tomás', from: [2, 1], to: [4, 20], status: 'onTrack' as Status },
        { name: 'Offline maps for Android', who: 'Tomás', from: [3, 5], to: [5, 18], status: 'atRisk' as Status },
        { name: 'Proof of delivery v2', who: 'Aiko', from: [7, 1], to: [10, 28], status: 'exploring' as Status },
      ],
    },
    {
      name: 'Self-serve',
      owner: 'Lena Fischer',
      epics: [
        { name: 'Card checkout on Stripe', who: 'Lena', from: [0, 6], to: [2, 11], status: 'onTrack' as Status },
        { name: 'Guided setup and import', who: 'Priya', from: [1, 3], to: [3, 9], status: 'blocked' as Status },
        { name: 'Usage-based pricing', who: 'Lena', from: [4, 2], to: [6, 29], status: 'exploring' as Status },
      ],
    },
    {
      name: 'Platform',
      owner: 'Daniel Okafor',
      epics: [
        { name: 'Kafka dispatch queue', who: 'Daniel', from: [0, 6], to: [2, 4], status: 'onTrack' as Status },
        { name: 'EU region in Frankfurt', who: 'Sam', from: [1, 17], to: [4, 6], status: 'atRisk' as Status },
        { name: 'Public API v3 and webhooks', who: 'Daniel', from: [5, 1], to: [8, 26], status: 'exploring' as Status },
      ],
    },
  ];
  /** Board x for a month (0 = July 2026) and day. */
  const tx = (month: number, day: number) => {
    const q = Math.floor(month / 3);
    const within = (month % 3) + (day - 1) / 30;
    return TL_X + q * (QW + GUT) + (within / 3) * QW;
  };

  const ROW = 44;
  const LANE_HEAD = 44;
  const LANE_H = LANE_HEAD + ROW * 3 + 12;
  const GRID_Y = 400;
  const GRID_H = LANE_H * lanes.length + GUT * (lanes.length - 1);
  const LEGEND_Y = GRID_Y + GRID_H + 48;
  const NOTES_Y = LEGEND_Y + 72;
  const H = NOTES_Y + 220 + PAD;

  N.push(page(0, 0, W, H, 'Northwind Route roadmap', '🛣️', 'Now, next and later, by workstream'));
  N.push(headline(PAD, 40, 1200, 'Roadmap: now, next, later'));
  N.push(
    body(
      PAD,
      96,
      1200,
      'Epics by workstream over the next four quarters. Bars are the plan, not a promise: anything in Later is a direction, and gets dates when it moves into Next.',
      16
    )
  );

  // Horizons over the quarter columns.
  const horizon = (q0: number, q1: number, title: string, sub: string, fill: string, ink: string) => {
    const x = TL_X + q0 * (QW + GUT);
    const w = (q1 - q0 + 1) * QW + (q1 - q0) * GUT;
    N.push(chip(x, 196, w, 44, title, { fill, radius: 10, size: 16, weight: 700, ink }));
    for (let q = q0; q <= q1; q += 1) N.push(label(TL_X + q * (QW + GUT) + 12, 252, sub.split('|')[q - q0], { size: 13, weight: 500, color: INK_SOFT }));
  };
  horizon(0, 0, 'Now', 'Q3 2026 · Jul to Sep', '#D1FAE5', '#065F46');
  horizon(1, 1, 'Next', 'Q4 2026 · Oct to Dec', '#DBEAFE', '#1E40AF');
  horizon(2, 3, 'Later', 'Q1 2027 · Jan to Mar|Q2 2027 · Apr to Jun', '#EDE9FE', '#5B21B6');

  // Milestones on their own track, each with a dashed line down through the lanes.
  N.push(label(PAD, 306, 'Milestones', { size: 15, weight: 650, color: INK_STRONG }));
  const milestones: Array<[number, number, string]> = [
    [0, 28, 'Jul 28 · Auto-assign beta'],
    [2, 15, 'Sep 15 · Self-serve GA'],
    [4, 6, 'Nov 6 · EU region live'],
    [8, 26, 'Mar 26 · API v3'],
  ];
  milestones.forEach(([mo, d, text]) => {
    const x = tx(mo, d);
    N.push(plate(x - 12, 302, 24, 24, { kind: 'diamond', fill: '#0F172A' }));
    N.push(label(x + 18, 304, text, { size: 13, weight: 600, color: INK }));
    N.push(rule({ x, y: 336 }, { x, y: GRID_Y + GRID_H }, { color: '#94A3B8', width: 1.5, dash: [4, 6] }));
  });

  // The timeline: a grid with a module per lane and quarter.
  const timeline = grid(TL_X, GRID_Y, TL_W, GRID_H, {
      rows: lanes.length,
      cols: 4,
      gutter: GUT,
      palette: ['#F8FAFC', '#F1F5F9', '#F8FAFC', '#F1F5F9'],
      stroke: '#E2E8F0',
      strokeWidth: 1,
      radius: 8,
    });
  N.push(timeline);

  const bars = new Map<string, NewNodeInput>();
  lanes.forEach((lane, li) => {
    const top = GRID_Y + li * (LANE_H + GUT);
    N.push(plate(PAD, top, LABEL_W, LANE_H, { fill: '#F8FAFC', stroke: HAIRLINE, radius: 8 }));
    N.push(label(PAD + 16, top + 12, lane.name, { size: 16, weight: 700, color: INK_STRONG }));
    N.push(label(PAD + LABEL_W - 16, top + 15, lane.owner, { size: 13, weight: 500, color: INK_SOFT, align: 'right' }));
    lane.epics.forEach((e, k) => {
      const y = top + LANE_HEAD + k * ROW + 6;
      N.push(label(PAD + 16, y + 4, e.name, { size: 14, weight: 550, color: INK }));
      N.push(label(PAD + LABEL_W - 16, y + 5, e.who, { size: 13, weight: 500, color: INK_SOFT, align: 'right' }));
      const x0 = tx(e.from[0], e.from[1]);
      const x1 = tx(e.to[0], e.to[1]);
      const bar = plate(x0, y, x1 - x0, 28, {
        fill: STATUS[e.status].color,
        radius: 8,
        ...(e.status === 'exploring' ? { stroke: '#6366F1', strokeWidth: 1.5, dash: [5, 4] } : {}),
      });
      bars.set(e.name, bar);
      N.push(bar);
    });
  });
  const dep = (a: string, b: string) => wire(bars.get(a)!, bars.get(b)!, { routing: 'curved', from: 'right', to: 'left', color: '#334155', width: 1.75 });
  N.push(dep('Kafka dispatch queue', 'Live ETA recalculation'));
  N.push(dep('Card checkout on Stripe', 'Usage-based pricing'));
  N.push(dep('EU region in Frankfurt', 'Multi-day route planning'));

  // Legend.
  let lx = TL_X;
  N.push(label(PAD, LEGEND_Y + 4, 'Legend', { size: 15, weight: 650, color: INK_STRONG }));
  (Object.keys(STATUS) as Status[]).forEach((s) => {
    N.push(plate(lx, LEGEND_Y + 4, 36, 20, { fill: STATUS[s].color, radius: 6, ...(s === 'exploring' ? { stroke: '#6366F1', strokeWidth: 1.5, dash: [5, 4] } : {}) }));
    const t = label(lx + 48, LEGEND_Y + 4, STATUS[s].label, { size: 14, weight: 500, color: INK });
    N.push(t);
    lx += 48 + (t.width as number) + 40;
  });
  N.push(plate(lx, LEGEND_Y + 3, 22, 22, { kind: 'diamond', fill: '#0F172A' }));
  const ms = label(lx + 34, LEGEND_Y + 4, 'Milestone', { size: 14, weight: 500, color: INK });
  N.push(ms);
  lx += 34 + (ms.width as number) + 40;
  N.push(rule({ x: lx, y: LEGEND_Y + 14 }, { x: lx + 40, y: LEGEND_Y + 14 }, { color: '#334155', width: 1.75, arrow: true }));
  N.push(label(lx + 52, LEGEND_Y + 4, 'Depends on', { size: 14, weight: 500, color: INK }));

  // Open questions.
  N.push(label(PAD, NOTES_Y, 'Open questions for Q4 planning', { size: 15, weight: 650, color: INK_STRONG }));
  const qs: Array<[string, Person, Record<string, number>, StickyTheme]> = [
    ['Can bulk dispatch ship without the EU region, UK first?', 'sofia', { '+1': 4 }, 'yellow'],
    ['Offline maps: drop Android 9 to save a sprint?', 'tomas', { '+1': 2, '👀': 2 }, 'yellow'],
    ['Usage pricing needs metering in Kafka. Pull it into Q4?', 'lena', { '+1': 3 }, 'yellow'],
    ['API v3 before multi-day planning, or after?', 'daniel', { '+1': 1 }, 'lavender'],
  ];
  const QW2 = (TL_W - 24 * 3) / 4;
  qs.forEach(([t, who, votes, theme], i) => N.push(note(TL_X + i * (QW2 + 24), NOTES_Y, t, theme, { w: QW2, h: 200, owner: who, stamps: votes, fontSize: 22 })));

  return sink(layer(N), [timeline]);
}

// ---------------------------------------------------------------------------
// 4. User journey map
// ---------------------------------------------------------------------------

function journeyBoard(): NewNodeInput[] {
  const N: NewNodeInput[] = [];
  const LABEL_W = 232;
  const COL_W = 392;
  const COL_GAP = 16;
  const X0 = PAD + LABEL_W + 24;
  const stages = ['Discover', 'Start a trial', 'Set up the fleet', 'First dispatch', 'Daily use'];
  const W = X0 + stages.length * COL_W + (stages.length - 1) * COL_GAP + PAD;
  const colX = (i: number) => X0 + i * (COL_W + COL_GAP);

  const actions = [
    'Reads a G2 comparison, watches the two-minute demo, looks for a price.',
    'Fills in the trial form on her phone between depot calls.',
    'Imports 38 vehicles and 52 drivers; connects Samsara for live positions.',
    'Lets auto-assign plan the 6:00 wave, then checks every route by hand.',
    'Plans the next day at 16:30; drivers get routes on the app by 17:00.',
  ];
  const touch = [
    ['G2', 'YouTube demo', 'Pricing'],
    ['Trial form', 'Welcome email'],
    ['CSV import', 'Samsara', 'Help centre'],
    ['Dispatch board', 'Driver app'],
    ['Morning digest', 'Reports'],
  ];
  const thinking = [
    'Will this work with Samsara, or is it another tablet in the cab?',
    'A free trial. Do I still have to talk to sales?',
    'Why does it want our depot codes in this format?',
    'It gave Dave the Bradford run. Why Dave?',
    'I have not touched the whiteboard in a week.',
  ];
  const pains = [
    'Pricing is behind "Book a demo"',
    'Asks for a VAT number before showing anything',
    'CSV import rejects our depot codes; Samsara sync shows no progress',
    'No reason shown for an auto-assign pick',
    'Old Android phones cannot hold the map offline',
  ];
  const ideas: Array<[string, Person, Record<string, number>]> = [
    ['Public pricing with a fleet-size calculator', 'lena', { '+1': 6 }],
    ['Ask for VAT at checkout, not at signup', 'priya', { '+1': 4 }],
    ['Import preview that maps columns before upload', 'priya', { '+1': 7 }],
    ['"Why this driver?" on every auto-assign', 'marcus', { '+1': 8, '🔥': 3 }],
    ['Offline map packs for Android 9 and up', 'tomas', { '+1': 5 }],
  ];
  const scores = [1, 0.5, -1.5, 1.5, 2];
  const heard = [
    'Hopeful, but wary of another tool',
    'Relieved there is a trial',
    'Frustrated: two hours lost',
    'The moment it clicked',
    'Trusts it with the morning wave',
  ];
  const interviews = [9, 9, 8, 7, 6];

  const rows = [
    { name: 'Doing', help: 'What she actually does', h: 120 },
    { name: 'Touchpoints', help: 'Where it happens', h: 112 },
    { name: 'Thinking', help: 'In her words', h: 196 },
    { name: 'Feeling', help: 'From the evidence table', h: 248 },
    { name: 'Pain points', help: 'What went wrong', h: 196 },
    { name: 'Opportunities', help: 'Ideas, owned and voted', h: 196 },
  ];
  const STAGE_Y = 236;
  const ROWS_Y = STAGE_Y + 64 + 24;
  const ROW_GAP = 16;
  const rowY: number[] = [];
  rows.reduce((y, r) => {
    rowY.push(y);
    return y + r.h + ROW_GAP;
  }, ROWS_Y);
  const ROWS_END = rowY[rowY.length - 1] + rows[rows.length - 1].h;
  const EVIDENCE_Y = ROWS_END + 56;
  const H = EVIDENCE_Y + 300 + PAD;

  N.push(page(0, 0, W, H, 'Journey: a carrier’s first month', '🧭', 'From first search to the daily routine, for one fleet manager'));
  N.push(headline(PAD, 40, 1100, 'How a carrier finds, tries and adopts Northwind Route'));
  N.push(
    body(
      PAD,
      96,
      1100,
      'Built from nine interviews with fleet managers at carriers of 20 to 100 vehicles, May to June 2026. The emotion curve reads its scores from the evidence table at the bottom.',
      16
    )
  );
  // Persona card.
  const PX = W - PAD - 620;
  N.push(card(PX, 40, 620, 164, '#F8FAFC', 14));
  N.push(plate(PX + 24, 64, 64, 64, { kind: 'ellipse', fill: '#FBD2E1' }));
  N.push(label(PX + 56, 82, 'MB', { size: 20, weight: 700, color: '#7A2547', align: 'center' }));
  N.push(label(PX + 108, 62, 'Maya Brooks, operations manager', { size: 18, weight: 700, color: INK_STRONG }));
  N.push(label(PX + 108, 92, 'Hartmann Logistics · 38 trucks · Leeds', { size: 14, weight: 500, color: INK_SOFT }));
  N.push(
    words(PX + 108, 124, 488, 'Goal: every order dispatched by 7:30, without the whiteboard or the 6 a.m. phone calls.', {
      size: 14,
      weight: 450,
      color: INK_MID,
      lineHeight: 1.45,
    })
  );

  // Stages.
  stages.forEach((s, i) =>
    N.push(
      chip(colX(i), STAGE_Y, COL_W, 64, s, {
        kind: 'chevron',
        geometry: { indent: 0.08 },
        fill: i === 2 ? '#FFE4E6' : '#E0F2FE',
        radius: 0,
        size: 17,
        weight: 700,
        ink: i === 2 ? '#9F1239' : '#075985',
      })
    )
  );

  rows.forEach((r, ri) => {
    const y = rowY[ri];
    N.push(plate(PAD, y, W - PAD * 2, r.h, { fill: ri % 2 === 0 ? '#F8FAFC' : '#FFFFFF', stroke: HAIRLINE, radius: 12 }));
    N.push(label(PAD + 20, y + 18, r.name, { size: 17, weight: 700, color: INK_STRONG }));
    N.push(label(PAD + 20, y + 46, r.help, { size: 13, weight: 450, color: INK_SOFT }));
  });

  stages.forEach((_, i) => {
    const x = colX(i);
    // Doing.
    N.push(body(x + 16, rowY[0] + 20, COL_W - 32, actions[i], 15, INK_MID));
    // Touchpoints.
    let px = x + 16;
    touch[i].forEach((t) => {
      const w = Math.ceil(t.length * 7.6 + 32);
      N.push(chip(px, rowY[1] + 38, w, 36, t, { fill: '#FFFFFF', stroke: '#CBD5E1', size: 13, weight: 600, ink: INK_MID }));
      px += w + 10;
    });
    // Thinking, pains and opportunities as notes.
    const NW = COL_W - 32;
    N.push(note(x + 16, rowY[2] + 16, thinking[i], 'sky', { w: NW, h: rows[2].h - 32, fontSize: 22 }));
    N.push(note(x + 16, rowY[4] + 16, pains[i], 'coral', { w: NW, h: rows[4].h - 32, fontSize: 22, stamps: i === 2 ? { '⚠️': 6 } : i === 3 ? { '⚠️': 4 } : { '⚠️': 2 } }));
    N.push(note(x + 16, rowY[5] + 16, ideas[i][0], 'mint', { w: NW, h: rows[5].h - 32, owner: ideas[i][1], stamps: ideas[i][2], fontSize: 22 }));
  });

  // Evidence table, then the emotion curve that reads it.
  const ev = sheet(PAD, EVIDENCE_Y + 40, 1080, {
    title: 'Emotion by stage',
    theme: 'clean',
    accent: '#0369A1',
    fontSize: 13,
    columns: [
      { head: 'Stage', width: 1.3, cells: stages },
      { head: 'Score (−2 to +2)', type: 'number', width: 1.1, cells: scores.map(String), align: 'center' },
      { head: 'What we heard', width: 2.6, cells: heard },
      { head: 'Interviews', type: 'number', width: 0.9, cells: interviews.map(String) },
    ],
    rules: [{ col: 1, when: '<0', fill: '#FFE4E6', color: '#9F1239', bold: true }],
  });
  N.push(head(PAD, EVIDENCE_Y, 1080, 'Evidence', 19));
  N.push(ev.node);
  N.push(
    body(
      PAD + 1080 + 48,
      EVIDENCE_Y + 40,
      W - PAD * 2 - 1080 - 48,
      'Scores are the median of what each interviewee said about that stage, coded by two researchers. Change one and the curve above moves with it.',
      15
    )
  );
  N.push(
    chartNode(
      X0 - 56,
      rowY[3] + 8,
      W - PAD - (X0 - 56) - 8,
      rows[3].h - 16,
      linked(ev, { cat: 0, series: [1] }, chartSpec('line', {
        title: undefined,
        series: [{ name: 'Score (−2 to +2)', values: [], color: '#0284C7' }],
        curved: true,
        showLegend: false,
        showValues: false,
        yMin: -2,
        yMax: 2,
        reference: { value: 0, style: 'dashed', color: '#94A3B8' },
      }))
    )
  );

  return layer(N);
}

// ---------------------------------------------------------------------------
// 5. Design sprint
// ---------------------------------------------------------------------------

interface Slot {
  time: string;
  what: string;
  mins: number;
}

function agenda(N: NewNodeInput[], x: number, y: number, w: number, slots: Slot[]): number {
  N.push(head(x, y, w, 'Agenda', 17));
  let cy = y + 40;
  slots.forEach((s) => {
    N.push(card(x, cy, w, 64, '#F8FAFC', 10));
    N.push(label(x + 16, cy + 12, s.time, { size: 13, weight: 650, color: INK_SOFT }));
    N.push(label(x + 16, cy + 34, s.what, { size: 14, weight: 600, color: INK }));
    N.push(chip(x + w - 84, cy + 18, 68, 28, `${s.mins} min`, { fill: '#E0E7FF', size: 12, weight: 650, ink: '#3730A3' }));
    cy += 72;
  });
  return cy;
}

function sprintBoard(limit?: number): NewNodeInput[] {
  // The crazy-8s drawings are a quarter of the board; a cover asks for fewer objects and keeps the grid alone.
  const sketches = limit === undefined || limit >= 260;
  const N: NewNodeInput[] = [];
  const W = 1000;
  const H = 940;
  const AG_W = 300;
  const MX = PAD + AG_W + 40;
  const MW = W - PAD - MX;
  const at = (col: number, row: number) => ({ x: col * (W + FRAME_GAP_X), y: row * (H + FRAME_GAP_Y) });

  // --- Brief ----------------------------------------------------------------
  {
    const o = at(0, 0);
    N.push(page(o.x, o.y, W, H, 'Sprint brief', '🏁', 'The challenge, the goal, and who decides'));
    N.push(headline(o.x + PAD, o.y + 40, W - PAD * 2, 'Go live in one sitting'));
    N.push(
      body(
        o.x + PAD,
        o.y + 92,
        W - PAD * 2,
        'Design sprint, Aug 3 to 7 2026. Can a new carrier get from signup to a first dispatched route in one sitting, without talking to us?',
        17,
        INK_MID
      )
    );
    N.push(card(o.x + PAD, o.y + 180, W - PAD * 2, 120, '#FFFBEB', 14));
    N.push(label(o.x + PAD + 24, o.y + 200, 'Long-term goal', { size: 15, weight: 700, color: STATUS_INK.warn }));
    N.push(
      words(o.x + PAD + 24, o.y + 230, W - PAD * 2 - 48, 'In two years, any carrier with under 100 vehicles goes live on Northwind Route without a call.', {
        size: 18,
        weight: 600,
        color: INK_STRONG,
        lineHeight: 1.4,
      })
    );
    N.push(head(o.x + PAD, o.y + 336, W - PAD * 2, 'Sprint questions', 17));
    const qs = [
      'Will fleet managers trust auto-assign on day one?',
      'Can a CSV from any TMS import without help?',
      'Will they pay by card before seeing their own routes?',
    ];
    qs.forEach((q, i) =>
      N.push(note(o.x + PAD + i * (296 + 16), o.y + 376, `Can we… ${q.charAt(0).toLowerCase()}${q.slice(1)}`, 'lavender', { w: 296, h: 176, stamps: { '+1': 5 - i } }))
    );
    N.push(head(o.x + PAD, o.y + 592, W - PAD * 2, 'The team', 17));
    const team = sheet(o.x + PAD, o.y + 632, W - PAD * 2, {
      title: 'Sprint team',
      theme: 'minimal',
      fontSize: 13,
      columns: [
        { head: 'Role', width: 1, cells: ['Decider', 'Facilitator', 'Design', 'Engineering', 'Customer expert', 'Marketing'] },
        { head: 'Who', type: 'person', width: 1.2, cells: ['Priya Raman', 'Sam Whitfield', 'Sofia Alvarez', 'Marcus Chen', 'Tomás Herrera', 'Lena Fischer'] },
        { head: 'Brings', width: 2.2, cells: ['Final call on the target and the winner', 'Timekeeper; runs every exercise', 'Leads sketching and the prototype', 'Knows what auto-assign can explain', 'Ran onboarding calls for two years', 'Owns the pricing story'] },
      ],
    });
    N.push(team.node);
  }

  // --- Monday: map ----------------------------------------------------------
  {
    const o = at(1, 0);
    N.push(page(o.x, o.y, W, H, 'Monday · Map', '🗺️', 'Long-term goal, the map, expert interviews, pick a target'));
    agenda(N, o.x + PAD, o.y + PAD, AG_W, [
      { time: '10:00', what: 'Long-term goal', mins: 30 },
      { time: '10:30', what: 'Sprint questions', mins: 30 },
      { time: '11:00', what: 'Make the map', mins: 60 },
      { time: '13:00', what: 'Ask the experts', mins: 120 },
      { time: '15:00', what: 'How might we notes', mins: 45 },
      { time: '16:00', what: 'Pick a target', mins: 30 },
    ]);
    N.push(head(o.x + MX, o.y + PAD, MW, 'The map', 17));
    const actors = [
      { name: 'Fleet manager', y: 0 },
      { name: 'Driver', y: 1 },
    ];
    const steps = [
      ['Finds us', 'Starts trial', 'Imports fleet', 'Plans a wave', 'Dispatches'],
      ['', '', 'Gets invite', 'Opens route', 'Delivers'],
    ];
    const SX = o.x + MX;
    const sw = (MW - 4 * 12) / 5;
    const nodesByRow: NewNodeInput[][] = [];
    actors.forEach((a, r) => {
      const y = o.y + PAD + 44 + r * 128;
      N.push(label(SX, y, a.name, { size: 13, weight: 650, color: INK_SOFT }));
      const row: NewNodeInput[] = [];
      steps[r].forEach((s, i) => {
        if (!s) return;
        const target = r === 0 && i === 2;
        const n = chip(SX + i * (sw + 12), y + 28, sw, 56, s, {
          fill: target ? '#FEF3C7' : '#F1F5F9',
          stroke: target ? '#D97706' : '#CBD5E1',
          radius: 10,
          size: 13,
          weight: 600,
        });
        row.push(n);
        N.push(n);
      });
      nodesByRow.push(row);
      row.slice(1).forEach((n, i) => N.push(wire(row[i], n, { routing: 'straight', from: 'right', to: 'left', width: 1.75 })));
    });
    N.push(wire(nodesByRow[0][2], nodesByRow[1][0], { from: 'bottom', to: 'top', dash: [5, 4], width: 1.5, label: 'invites' }));
    N.push(
      body(SX, o.y + PAD + 312, MW, 'Target, circled in amber: importing the fleet. Every expert named it as where trials stall.', 14, INK_MID)
    );
    N.push(head(SX, o.y + PAD + 388, MW, 'How might we…', 17));
    const hmw: Array<[string, Record<string, number>]> = [
      ['HMW make any TMS export import first time?', { '+1': 5, '⭐': 1 }],
      ['HMW show why auto-assign picked a driver?', { '+1': 4 }],
      ['HMW let them see their own routes before paying?', { '+1': 3 }],
      ['HMW invite drivers without collecting phone numbers?', { '+1': 1 }],
    ];
    const HW = (MW - 16) / 2;
    hmw.forEach(([t, v], i) => N.push(note(SX + (i % 2) * (HW + 16), o.y + PAD + 428 + Math.floor(i / 2) * 212, t, 'sky', { w: HW, h: 196, stamps: v })));
  }

  // --- Tuesday: sketch ------------------------------------------------------
  {
    const o = at(2, 0);
    N.push(page(o.x, o.y, W, H, 'Tuesday · Sketch', '✍️', 'Lightning demos, then crazy 8s and a solution sketch each'));
    const tueEnd = agenda(N, o.x + PAD, o.y + PAD, AG_W, [
      { time: '10:00', what: 'Lightning demos', mins: 90 },
      { time: '11:30', what: 'Divide the map', mins: 15 },
      { time: '13:00', what: 'Notes and ideas', mins: 40 },
      { time: '13:40', what: 'Crazy 8s', mins: 8 },
      { time: '14:00', what: 'Solution sketch', mins: 90 },
    ]);
    N.push(note(o.x + PAD, tueEnd + 24, 'Work alone, together. No names on sketches until tomorrow.', 'white', { w: AG_W, h: 168, owner: 'sam', fontSize: 20 }));
    const SX = o.x + MX;
    N.push(head(SX, o.y + PAD, MW, 'Lightning demos', 17));
    const demos = [
      'Linear: import from Jira maps fields with a live preview',
      'Stripe: test mode shows real flows with fake money',
      'Samsara: setup checklist with progress per vehicle',
    ];
    demos.forEach((d, i) => N.push(note(SX + i * ((MW - 32) / 3 + 16), o.y + PAD + 40, d, 'peach', { w: (MW - 32) / 3, h: 176, fontSize: 16 })));
    N.push(head(SX, o.y + PAD + 248, MW, 'Crazy 8s: the import step, eight ways in eight minutes', 17));
    const C8 = { rows: 2, cols: 4, gutter: 12 };
    const CY = o.y + PAD + 288;
    const CH = 500;
    N.push(grid(SX, CY, MW, CH, { ...C8, palette: ['#FFFFFF'], colorMode: 'solid', stroke: '#CBD5E1', strokeWidth: 1.5, radius: 8 }));
    if (sketches) gridModules(SX, CY, MW, CH, C8).forEach((cell, i) => N.push(...crazyEight(i, cell.x + 14, cell.y + 14, cell.width - 28, cell.height - 28)));
    N.push(body(SX, CY + CH + 16, MW, 'Sofia’s #3, a live column-mapping preview, became her solution sketch.', 14, INK_MID));
  }

  // --- Wednesday: decide ----------------------------------------------------
  {
    const o = at(0, 1);
    N.push(page(o.x, o.y, W, H, 'Wednesday · Decide', '🗳️', 'Heat map, straw poll, supervote, then the storyboard'));
    const wedEnd = agenda(N, o.x + PAD, o.y + PAD, AG_W, [
      { time: '10:00', what: 'Heat map', mins: 30 },
      { time: '10:30', what: 'Speed critique', mins: 60 },
      { time: '11:30', what: 'Straw poll', mins: 15 },
      { time: '11:45', what: 'Supervote', mins: 15 },
      { time: '13:00', what: 'Storyboard', mins: 180 },
    ]);
    N.push(note(o.x + PAD, wedEnd + 24, 'Priya has the supervote. Stars on a note are hers; dots are everyone else.', 'white', { w: AG_W, h: 168, owner: 'sam', fontSize: 20 }));
    const SX = o.x + MX;
    N.push(head(SX, o.y + PAD, MW, 'Solution sketches, after the vote', 17));
    const sk: Array<[string, Person, Record<string, number>]> = [
      ['Live mapping preview: drop a CSV, fix columns before import', 'sofia', { '+1': 7, '⭐': 1 }],
      ['Sample fleet: try dispatch on demo data, import later', 'marcus', { '+1': 5 }],
      ['Concierge import: we map your file within an hour', 'tomas', { '+1': 2 }],
      ['Samsara first: pull vehicles, skip the CSV entirely', 'lena', { '+1': 4, '⭐': 1 }],
    ];
    const SW2 = (MW - 16) / 2;
    sk.forEach(([t, who, v], i) => N.push(note(SX + (i % 2) * (SW2 + 16), o.y + PAD + 40 + Math.floor(i / 2) * 196, t, i === 0 ? 'yellow' : 'white', { w: SW2, h: 180, owner: who, stamps: v })));
    N.push(head(SX, o.y + PAD + 448, MW, 'Storyboard: the test, frame by frame', 17));
    const story = ['Sees price on G2', 'Starts a trial', 'Drops a CSV', 'Fixes 2 columns', 'Plans a wave', 'Sees why Dave'];
    const SBW = (MW - 2 * 16) / 3;
    const frames: NewNodeInput[] = [];
    story.forEach((s, i) => {
      const x = SX + (i % 3) * (SBW + 16);
      const y = o.y + PAD + 488 + Math.floor(i / 3) * 176;
      const f = chip(x, y, SBW, 152, `${i + 1}. ${s}`, { fill: '#F8FAFC', stroke: '#CBD5E1', radius: 10, size: 14, weight: 600 });
      frames.push(f);
      N.push(f);
    });
    frames.slice(1).forEach((f, i) => {
      // Rows read left to right; the turn from frame 3 to frame 4 is the line break, not an arrow.
      if (i !== 2) N.push(wire(frames[i], f, { routing: 'straight', width: 1.5, color: '#94A3B8', from: 'right', to: 'left' }));
    });
  }

  // --- Thursday: prototype --------------------------------------------------
  {
    const o = at(1, 1);
    N.push(page(o.x, o.y, W, H, 'Thursday · Prototype', '🛠️', 'A realistic facade, built in a day'));
    const thuEnd = agenda(N, o.x + PAD, o.y + PAD, AG_W, [
      { time: '10:00', what: 'Pick tools, split roles', mins: 30 },
      { time: '10:30', what: 'Build', mins: 270 },
      { time: '15:00', what: 'Stitch and trial run', mins: 60 },
      { time: '16:00', what: 'Finish interview script', mins: 60 },
    ]);
    N.push(note(o.x + PAD, thuEnd + 24, 'Goldilocks quality: real enough to react to, fake enough to finish by five.', 'white', { w: AG_W, h: 168, owner: 'sam', fontSize: 20 }));
    const SX = o.x + MX;
    N.push(head(SX, o.y + PAD, MW, 'Roles', 17));
    const roles = sheet(SX, o.y + PAD + 40, MW, {
      title: 'Prototype roles',
      theme: 'striped',
      accent: '#6366F1',
      fontSize: 13,
      columns: [
        { head: 'Role', width: 1, cells: ['Maker', 'Maker', 'Stitcher', 'Writer', 'Asset collector', 'Interviewer'] },
        { head: 'Who', type: 'person', width: 1.2, cells: ['Sofia Alvarez', 'Aiko Tanaka', 'Marcus Chen', 'Lena Fischer', 'Tomás Herrera', 'Sam Whitfield'] },
        { head: 'Builds', width: 1.6, cells: ['Import and mapping screens', 'Dispatch board', 'Links every screen', 'Every word, real prices', 'Hartmann’s real CSV', 'Script and recruiting'] },
      ],
    });
    N.push(roles.node);
    const RY = o.y + PAD + 40 + roles.height + 32;
    N.push(head(SX, RY, MW, 'Before the trial run', 17));
    N.push(
      note(SX, RY + 40, '[x] 14 Figma screens linked\n[x] Hartmann CSV, 52 drivers\n[x] Real prices on checkout\n[ ] Script reviewed by Priya\n[ ] Trial run at 15:00', 'white', {
        w: (MW - 16) / 2,
        h: 248,
        owner: 'marcus',
        checklist: true,
        fontSize: 17,
      })
    );
    N.push(
      note(SX + (MW - 16) / 2 + 16, RY + 40, 'Fake it: the mapping preview is three prepared states, not a real parser.', 'yellow', {
        w: (MW - 16) / 2,
        h: 248,
        owner: 'sofia',
        stamps: { '+1': 3 },
      })
    );
  }

  // --- Friday: test ---------------------------------------------------------
  {
    const o = at(2, 1);
    N.push(page(o.x, o.y, W, H, 'Friday · Test', '🔬', 'Five interviews, one table, and the patterns'));
    agenda(N, o.x + PAD, o.y + PAD, AG_W, [
      { time: '09:00', what: 'Interview 1', mins: 60 },
      { time: '10:30', what: 'Interview 2', mins: 60 },
      { time: '12:00', what: 'Interview 3', mins: 60 },
      { time: '14:30', what: 'Interview 4', mins: 60 },
      { time: '16:00', what: 'Interview 5', mins: 60 },
      { time: '17:00', what: 'Patterns and next', mins: 30 },
    ]);
    const SX = o.x + MX;
    N.push(head(SX, o.y + PAD, MW, 'Did each step work? ✓ yes, ✗ no, ~ with help', 17));
    const stepsT = ['Find the price', 'Start the trial', 'Import the fleet', 'Fix the mapping', 'Dispatch a wave', 'Trust the picks'];
    const grid5 = [
      ['✓', '✓', '✓', '✓', '~'],
      ['✓', '✓', '✓', '✓', '✓'],
      ['✓', '~', '✓', '✓', '✓'],
      ['✓', '✓', '~', '✓', '✗'],
      ['✓', '✓', '✓', '✓', '✓'],
      ['✗', '✓', '~', '✓', '✗'],
    ];
    const passed = grid5.map((r) => r.filter((v) => v === '✓').length);
    const test = sheet(SX, o.y + PAD + 40, MW, {
      title: 'Interview results',
      theme: 'grid',
      accent: '#0F766E',
      fontSize: 13,
      firstColumn: true,
      columns: [
        { head: 'Step', width: 1.6, cells: stepsT },
        ...['P1', 'P2', 'P3', 'P4', 'P5'].map((p, k) => ({ head: p, width: 0.5, align: 'center' as const, cells: grid5.map((r) => r[k]) })),
        { head: 'Passed', type: 'number' as const, width: 0.7, cells: stepsT.map((_, r) => `=COUNTIF(B${r + 2}:F${r + 2},"✓")`), values: passed, align: 'center' as const },
        { head: 'Rate', type: 'percent' as const, width: 0.7, cells: stepsT.map((_, r) => `=ROUND(G${r + 2}/5,2)`), values: passed.map((p) => (p / 5) * 100) },
      ],
      rules: [
        ...[1, 2, 3, 4, 5].map((col) => ({ col, when: '✗', fill: '#FFE4E6', color: '#9F1239', bold: true })),
        ...[1, 2, 3, 4, 5].map((col) => ({ col, when: '~', fill: '#FEF3C7', color: '#92400E' })),
      ],
    });
    N.push(test.node);
    const CY2 = o.y + PAD + 40 + test.height + 28;
    N.push(head(SX, CY2, MW, 'Success rate by step', 15));
    N.push(
      chartNode(
        SX,
        CY2 + 28,
        MW,
        244,
        linked(test, { cat: 0, series: [7] }, chartSpec('barHorizontal', {
          title: undefined,
          series: [{ name: 'Rate', values: [], color: '#14B8A6' }],
          showLegend: false,
          showValues: false,
          valueSuffix: '%',
          yMin: 0,
          yMax: 100,
        }))
      )
    );
    const PY = CY2 + 28 + 244 + 20;
    const PW = (MW - 16) / 2;
    N.push(note(SX, PY, 'Import with preview works: 4 of 5 fixed mapping alone', 'mint', { w: PW, h: o.y + H - PAD - PY, stamps: { '✅': 4 } }));
    N.push(note(SX + PW + 16, PY, 'Nobody trusted the picks without a reason. Build "Why Dave?"', 'coral', { w: PW, h: o.y + H - PAD - PY, owner: 'priya', stamps: { '🔥': 5 } }));
  }

  return layer(N);
}

/** One crazy-8s panel: a phone screen of the import step, drawn quickly in sketch mode. */
function crazyEight(i: number, x: number, y: number, w: number, h: number): NewNodeInput[] {
  const pen = '#334155';
  const accent = ['#F59E0B', '#0EA5E9', '#10B981', '#8B5CF6'][i % 4];
  const S = { sketch: 'medium' as const };
  const out: NewNodeInput[] = [plate(x, y, w, h, { fill: 'none', stroke: pen, strokeWidth: 2, radius: 14, ...S })];
  const ix = x + 12;
  const iw = w - 24;
  const line = (yy: number, share: number, color = pen, weight = 2) => rule({ x: ix, y: yy }, { x: ix + iw * share, y: yy }, { color, width: weight, ...S });
  out.push(line(y + 20, 0.5, pen, 3));
  switch (i) {
    case 0: // drop zone
      out.push(plate(ix, y + 40, iw, h * 0.45, { fill: 'none', stroke: accent, strokeWidth: 2, dash: [6, 5], radius: 8, ...S }));
      out.push(plate(x + w / 2 - 14, y + 40 + h * 0.18, 28, 28, { kind: 'arrow_block', geometry: { indent: 0.5 }, fill: accent, ...S }));
      out.push(line(y + h - 40, 0.8), line(y + h - 24, 0.6));
      break;
    case 1: // column mapping: two columns with arrows
      for (let k = 0; k < 4; k += 1) {
        const yy = y + 44 + k * ((h - 64) / 4);
        out.push(plate(ix, yy, iw * 0.38, 18, { fill: '#F1F5F9', stroke: pen, strokeWidth: 1.5, radius: 4, ...S }));
        out.push(rule({ x: ix + iw * 0.42, y: yy + 9 }, { x: ix + iw * 0.56, y: yy + 9 }, { color: accent, width: 2, arrow: true, ...S }));
        out.push(plate(ix + iw * 0.6, yy, iw * 0.4, 18, { fill: 'none', stroke: pen, strokeWidth: 1.5, radius: 4, ...S }));
      }
      break;
    case 2: // live preview table
      for (let k = 0; k < 5; k += 1) out.push(line(y + 48 + k * 22, 1, k === 0 ? accent : pen, k === 0 ? 3 : 1.5));
      out.push(plate(ix + iw * 0.55, y + 40, iw * 0.45, 32, { fill: 'none', stroke: '#F43F5E', strokeWidth: 2, radius: 6, ...S }));
      out.push(plate(ix, y + h - 44, iw * 0.5, 24, { fill: accent, radius: 6, ...S }));
      break;
    case 3: // checklist progress
      for (let k = 0; k < 4; k += 1) {
        const yy = y + 46 + k * 30;
        out.push(plate(ix, yy, 16, 16, { fill: k < 2 ? accent : 'none', stroke: pen, strokeWidth: 1.5, radius: 3, ...S }));
        out.push(rule({ x: ix + 26, y: yy + 8 }, { x: ix + iw * 0.85, y: yy + 8 }, { color: pen, width: 2, ...S }));
      }
      break;
    case 4: // sample fleet card
      out.push(plate(ix, y + 44, iw, h * 0.32, { fill: '#F1F5F9', stroke: pen, strokeWidth: 1.5, radius: 8, ...S }));
      out.push(plate(ix + 10, y + 54, 28, 28, { kind: 'ellipse', fill: accent, ...S }));
      out.push(line(y + h * 0.32 + 64, 0.9), line(y + h * 0.32 + 80, 0.7));
      out.push(plate(ix, y + h - 44, iw, 24, { fill: 'none', stroke: accent, strokeWidth: 2, radius: 6, ...S }));
      break;
    case 5: // map with pins
      out.push(plate(ix, y + 40, iw, h * 0.55, { fill: '#F1F5F9', stroke: pen, strokeWidth: 1.5, radius: 8, ...S }));
      [[0.25, 0.3], [0.6, 0.5], [0.4, 0.75]].forEach(([px, py]) =>
        out.push(plate(ix + iw * px - 9, y + 40 + h * 0.55 * py - 22, 18, 22, { kind: 'pin', fill: accent, ...S }))
      );
      out.push(line(y + h - 30, 0.7));
      break;
    case 6: // chat with support
      out.push(plate(ix, y + 44, iw * 0.75, 40, { kind: 'callout', fill: '#F1F5F9', stroke: pen, strokeWidth: 1.5, ...S }));
      out.push(plate(ix + iw * 0.25, y + 100, iw * 0.75, 40, { kind: 'callout', fill: accent, ...S }));
      out.push(line(y + h - 30, 1));
      break;
    default: // progress ring
      out.push(plate(x + w / 2 - 34, y + 48, 68, 68, { kind: 'donut', fill: accent, ...S }));
      out.push(line(y + 136, 0.9), line(y + 152, 0.6));
      out.push(plate(ix, y + h - 44, iw, 24, { fill: accent, radius: 6, ...S }));
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6. Team retrospective
// ---------------------------------------------------------------------------

function retroBoard(): NewNodeInput[] {
  const N: NewNodeInput[] = [];
  const COL_W = 520;
  const COL_GAP = 32;
  const W = PAD * 2 + COL_W * 4 + COL_GAP * 3;
  const COLS_Y = 200;
  const NOTE = 224;
  const CLUSTER_H = 44 + NOTE + 24;
  const COLS_H = 56 + CLUSTER_H * 2 + 16 + 16;
  const BOTTOM_Y = COLS_Y + COLS_H + 40;
  const H = BOTTOM_Y + 340 + PAD;

  N.push(page(0, 0, W, H, 'Sprint 16 retro · Dispatch squad', '🔁', 'Aug 17 to 28, 2026 · facilitated by Sam'));
  N.push(headline(PAD, 40, 1400, 'Sprint 16 retrospective'));
  N.push(
    body(
      PAD,
      94,
      1400,
      'Seven minutes of silent writing, then group into clusters and stamp +1 on what to talk about (three each). Actions need an owner chip before anyone leaves.',
      16
    )
  );

  const columns: Array<{
    title: string;
    ink: string;
    tint: string;
    paper: StickyTheme;
    clusters: Array<{ name: string; notes: Array<{ text: string; owner?: Person; stamps?: Record<string, number>; checklist?: boolean }> }>;
  }> = [
    {
      title: 'Went well',
      ink: '#047857',
      tint: '#ECFDF5',
      paper: 'mint',
      clusters: [
        {
          name: 'Auto-assign beta',
          notes: [
            { text: 'Hartmann ran the whole 6:00 wave on auto-assign on day two', stamps: { '+1': 5, '🎉': 3 } },
            { text: 'Feature flag per carrier made rollback a toggle, not a deploy', stamps: { '+1': 3 } },
          ],
        },
        {
          name: 'Working together',
          notes: [
            { text: 'Pairing Marcus and Tomás on the ETA service cleared it in four days', stamps: { '+1': 2, '❤️': 2 } },
            { text: 'Design review moved to Tuesdays: no more Friday surprises', stamps: { '+1': 2 } },
          ],
        },
      ],
    },
    {
      title: 'To improve',
      ink: '#BE123C',
      tint: '#FFF1F2',
      paper: 'coral',
      clusters: [
        {
          name: 'Flaky end-to-end tests',
          notes: [
            { text: 'Six Cypress specs failed at random; we reran CI 31 times', stamps: { '+1': 6, '😩': 2 } },
            { text: 'Nobody owns a red build after 18:00', stamps: { '+1': 4 } },
          ],
        },
        {
          name: 'Scope',
          notes: [
            { text: 'Bulk dispatch grew a "select by postcode" mid-sprint', stamps: { '+1': 3 } },
            { text: 'Two tickets had no acceptance criteria until review', stamps: { '+1': 2 } },
          ],
        },
      ],
    },
    {
      title: 'Ideas',
      ink: '#4338CA',
      tint: '#EEF2FF',
      paper: 'lavender',
      clusters: [
        {
          name: 'Testing',
          notes: [
            { text: 'Quarantine flaky specs automatically after two failures', stamps: { '+1': 5 } },
            { text: 'Contract tests for the routing API instead of full e2e', stamps: { '+1': 3, '🤔': 1 } },
          ],
        },
        {
          name: 'Rituals',
          notes: [
            { text: 'Scope freeze two days before the sprint ends', stamps: { '+1': 4 } },
            { text: 'Monthly ride-along with a Hartmann dispatcher', stamps: { '+1': 2, '❤️': 1 } },
          ],
        },
      ],
    },
    {
      title: 'Action items',
      ink: '#B45309',
      tint: '#FFFBEB',
      paper: 'yellow',
      clusters: [
        {
          name: 'This sprint',
          notes: [
            { text: '[x] Quarantine 6 flaky specs\n[ ] Auto-quarantine after 2 fails\n[ ] Weekly flake report', owner: 'daniel', checklist: true },
            { text: '[ ] Scope freeze on day 8\n[ ] Acceptance criteria before planning', owner: 'priya', checklist: true },
          ],
        },
        {
          name: 'Next sprint',
          notes: [
            { text: '[ ] Contract tests for routing API\n[ ] Retire 12 e2e specs', owner: 'marcus', checklist: true },
            { text: '[x] Book Hartmann ride-along\n[ ] Share notes in #dispatch', owner: 'tomas', checklist: true },
          ],
        },
      ],
    },
  ];

  columns.forEach((col, ci) => {
    const x = PAD + ci * (COL_W + COL_GAP);
    N.push(plate(x, COLS_Y, COL_W, COLS_H, { fill: col.tint, stroke: HAIRLINE, radius: 16 }));
    N.push(plate(x + 20, COLS_Y + 24, 12, 12, { kind: 'ellipse', fill: col.ink }));
    N.push(label(x + 42, COLS_Y + 18, col.title, { size: 19, weight: 700, color: INK_STRONG }));
    const count = col.clusters.reduce((s, c) => s + c.notes.length, 0);
    N.push(label(x + COL_W - 20, COLS_Y + 22, `${count} notes`, { size: 13, weight: 500, color: INK_SOFT, align: 'right' }));
    col.clusters.forEach((cl, k) => {
      const cy = COLS_Y + 56 + k * (CLUSTER_H + 16);
      N.push(plate(x + 16, cy, COL_W - 32, CLUSTER_H, { fill: '#FFFFFF', stroke: HAIRLINE, radius: 12 }));
      N.push(label(x + 32, cy + 14, cl.name, { size: 14, weight: 650, color: col.ink }));
      cl.notes.forEach((n, j) =>
        N.push(
          note(x + 32 + j * (NOTE + 8), cy + 44, n.text, col.paper, {
            w: NOTE,
            owner: n.owner,
            stamps: n.stamps,
            checklist: n.checklist,
            fontSize: n.checklist ? 17 : 22,
          })
        )
      );
    });
  });

  // Mood over the last six sprints, and the vote behind this one.
  const sprints = ['S11', 'S12', 'S13', 'S14', 'S15', 'S16'];
  const mood = [3.4, 3.1, 3.6, 3.2, 2.8, 3.9];
  const velocity = [31, 28, 34, 30, 26, 35];
  const T_W = 640;
  N.push(head(PAD, BOTTOM_Y, T_W, 'Sprint health', 19));
  const moodT = sheet(PAD, BOTTOM_Y + 40, T_W, {
    title: 'Team mood',
    theme: 'striped',
    accent: '#B45309',
    fontSize: 13,
    columns: [
      { head: 'Sprint', width: 0.8, cells: sprints },
      { head: 'Mood (1 to 5)', type: 'number', width: 1.1, cells: mood.map((v) => v.toFixed(1)), align: 'center' },
      { head: 'Velocity', type: 'number', width: 0.9, cells: velocity.map(String), align: 'center' },
      { head: 'Votes', type: 'number', width: 0.8, cells: ['7', '7', '6', '7', '7', '7'], align: 'center' },
    ],
    bars: [{ col: 2, color: '#FCD34D' }],
  });
  N.push(moodT.node);
  const CX = PAD + T_W + 48;
  const CW = 980;
  N.push(head(CX, BOTTOM_Y, CW, 'Team mood, last six sprints', 19));
  N.push(
    chartNode(
      CX,
      BOTTOM_Y + 40,
      CW,
      300,
      linked(moodT, { cat: 0, series: [1] }, chartSpec('line', {
        title: undefined,
        series: [{ name: 'Mood (1 to 5)', values: [], color: '#D97706' }],
        curved: true,
        showValues: false,
        showLegend: false,
        yMin: 1,
        yMax: 5,
      }))
    )
  );
  const NX = CX + CW + 48;
  const NW = W - PAD - NX;
  N.push(head(NX, BOTTOM_Y, NW, 'Facilitator notes', 19));
  N.push(
    body(
      NX,
      BOTTOM_Y + 40,
      NW,
      'Mood recovered from 2.8 to 3.9 once the beta landed. The flaky suite is the third retro in a row to top the vote, so it gets an owner and a date this time, not another idea note.',
      15,
      INK_MID
    )
  );
  N.push(note(NX, BOTTOM_Y + 184, 'Next retro Sep 11: sailboat format, run by Aiko', 'white', { w: NW, h: 152, owner: 'aiko', fontSize: 20 }));

  return layer(N);
}

// ---------------------------------------------------------------------------
// 7. OKR tree
// ---------------------------------------------------------------------------

interface KeyResult {
  code: string;
  text: string;
  owner: string;
  start: number;
  target: number;
  now: number;
  unit: string;
}

function okrBoard(): NewNodeInput[] {
  const N: NewNodeInput[] = [];
  const teams: Array<{ title: string; team: string; owner: string; krs: KeyResult[] }> = [
    {
      title: 'Make the first dispatch effortless',
      team: 'Product · Sofia Alvarez',
      owner: 'Sofia Alvarez',
      krs: [
        { code: 'KR 1.1', text: 'Signup to first dispatch under one day', owner: 'Sofia Alvarez', start: 6, target: 1, now: 2.4, unit: ' days' },
        { code: 'KR 1.2', text: 'Setup finished without support: 31% to 70%', owner: 'Priya Raman', start: 31, target: 70, now: 52, unit: '%' },
        { code: 'KR 1.3', text: 'Auto-assign picks kept unedited: 58% to 85%', owner: 'Marcus Chen', start: 58, target: 85, now: 77, unit: '%' },
      ],
    },
    {
      title: 'Win the mid-market',
      team: 'Growth · Lena Fischer',
      owner: 'Lena Fischer',
      krs: [
        { code: 'KR 2.1', text: 'Self-serve trial to paid: 9% to 15%', owner: 'Lena Fischer', start: 9, target: 15, now: 12.1, unit: '%' },
        { code: 'KR 2.2', text: '120 new carriers with 20 to 100 vehicles', owner: 'Sam Whitfield', start: 0, target: 120, now: 64, unit: '' },
        { code: 'KR 2.3', text: 'Net revenue retention: 104% to 112%', owner: 'Lena Fischer', start: 104, target: 112, now: 107, unit: '%' },
      ],
    },
    {
      title: 'Earn enterprise trust',
      team: 'Platform · Daniel Okafor',
      owner: 'Daniel Okafor',
      krs: [
        { code: 'KR 3.1', text: 'Uptime from 99.81% to 99.95%', owner: 'Daniel Okafor', start: 99.81, target: 99.95, now: 99.92, unit: '%' },
        { code: 'KR 3.2', text: 'Pages per on-call week: 23 to 10', owner: 'Aiko Tanaka', start: 23, target: 10, now: 13, unit: '' },
        { code: 'KR 3.3', text: 'SOC 2 controls passing: 61% to 100%', owner: 'Sam Whitfield', start: 61, target: 100, now: 88, unit: '%' },
      ],
    },
  ];
  const share = (k: KeyResult) => Math.max(0, Math.min(1, (k.now - k.start) / (k.target - k.start)));
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const teamShare = teams.map((t) => t.krs.reduce((s, k) => s + share(k), 0) / t.krs.length);
  const companyShare = teamShare.reduce((s, v) => s + v, 0) / teams.length;

  const KR_W = 232;
  const KR_GAP = 16;
  const TEAM_W = KR_W * 3 + KR_GAP * 2;
  const TEAM_GAP = 56;
  const W = PAD * 2 + TEAM_W * 3 + TEAM_GAP * 2;
  const CO_Y = 176;
  const TEAM_Y = CO_Y + 176 + 72;
  const KR_Y = TEAM_Y + 152 + 72;
  const KR_H = 196;
  const TABLE_Y = KR_Y + KR_H + 72;

  const krRows = teams.flatMap((t) => t.krs);
  const H = TABLE_Y + 48 + (krRows.length + 1) * 38 + PAD;

  N.push(page(0, 0, W, H, 'H2 2026 OKRs', '🎯', 'Company objective, team objectives and the key results that score them'));
  N.push(headline(PAD, 40, 1200, 'H2 2026 objectives and key results'));
  N.push(
    body(
      PAD,
      94,
      1300,
      'Checked in every other Friday. Progress is how far each key result has moved from where it started toward its target; 70% by the end of the half is a good score.',
      16
    )
  );

  const progressRow = (x: number, y: number, w: number, s: number, size = 15) => {
    N.push(...progress(x, y + 6, w - 64, s, progressColor(s), 10));
    N.push(label(x + w, y, pct(s), { size, weight: 700, color: INK_STRONG, align: 'right' }));
  };

  // Company.
  const CO_W = 680;
  const coX = (W - CO_W) / 2;
  const company = plate(coX, CO_Y, CO_W, 176, { fill: '#EEF2FF', stroke: '#C7D2FE', strokeWidth: 1.5, radius: 16 });
  N.push(company);
  N.push(
    words(coX + 32, CO_Y + 26, CO_W - 64, 'Become the default dispatch platform for regional carriers in Europe', {
      size: 22,
      weight: 700,
      color: '#1E1B4B',
      lineHeight: 1.3,
    })
  );
  N.push(label(coX + 32, CO_Y + 94, 'Northwind Labs · owned by Priya Raman', { size: 13, weight: 500, color: '#4338CA' }));
  N.push(...progress(coX + 32, CO_Y + 136, CO_W - 64 - 72, companyShare, progressColor(companyShare), 10));
  N.push(label(coX + CO_W - 32, CO_Y + 129, pct(companyShare), { size: 17, weight: 700, color: '#1E1B4B', align: 'right' }));

  const teamCards: NewNodeInput[] = [];
  teams.forEach((t, ti) => {
    const x = PAD + ti * (TEAM_W + TEAM_GAP);
    const tw = TEAM_W - 120;
    const tx = x + 60;
    const tc = card(tx, TEAM_Y, tw, 152, '#F8FAFC', 14);
    teamCards.push(tc);
    N.push(tc);
    N.push(words(tx + 24, TEAM_Y + 22, tw - 48, t.title, { size: 19, weight: 700, color: INK_STRONG, lineHeight: 1.3 }));
    N.push(label(tx + 24, TEAM_Y + 56, t.team, { size: 13, weight: 500, color: INK_SOFT }));
    progressRow(tx + 24, TEAM_Y + 104, tw - 48, teamShare[ti]);
    N.push(wire(company, tc, { routing: 'curved', from: 'bottom', to: 'top', color: '#64748B', width: 2 }));

    t.krs.forEach((k, ki) => {
      const kx = x + ki * (KR_W + KR_GAP);
      const kc = card(kx, KR_Y, KR_W, KR_H, '#FFFFFF', 12);
      N.push(kc);
      N.push(label(kx + 20, KR_Y + 18, k.code, { size: 13, weight: 700, color: STATUS_INK.info }));
      N.push(words(kx + 20, KR_Y + 44, KR_W - 40, k.text, { size: 15, weight: 600, color: INK, lineHeight: 1.35 }));
      N.push(label(kx + 20, KR_Y + 118, `Now ${k.now}${k.unit} · target ${k.target}${k.target === 1 && k.unit === ' days' ? ' day' : k.unit}`, { size: 12, weight: 500, color: INK_SOFT }));
      progressRow(kx + 20, KR_Y + 150, KR_W - 40, share(k), 14);
      N.push(wire(tc, kc, { routing: 'curved', from: 'bottom', to: 'top', color: '#94A3B8', width: 1.75 }));
    });
  });

  // Scoring table and the chart that reads it.
  const T_W = 1360;
  N.push(head(PAD, TABLE_Y, T_W, 'Scoring', 19));
  const status = [
    { label: 'On track', tag: TAG.green },
    { label: 'At risk', tag: TAG.amber },
    { label: 'Off track', tag: TAG.red },
  ];
  const scoring = sheet(PAD, TABLE_Y + 48, T_W, {
    title: 'Key results',
    theme: 'clean',
    accent: '#4F46E5',
    fontSize: 13,
    columns: [
      { head: 'KR', width: 0.6, cells: krRows.map((k) => k.code), style: { bold: true } },
      { head: 'Key result', width: 2.8, cells: krRows.map((k) => k.text) },
      { head: 'Owner', type: 'person', width: 1.3, cells: krRows.map((k) => k.owner) },
      { head: 'Start', type: 'number', width: 0.6, cells: krRows.map((k) => String(k.start)) },
      { head: 'Target', type: 'number', width: 0.6, cells: krRows.map((k) => String(k.target)) },
      { head: 'Now', type: 'number', width: 0.6, cells: krRows.map((k) => String(k.now)) },
      {
        head: 'Progress',
        type: 'percent',
        width: 0.9,
        cells: krRows.map((_, r) => `=ROUND(MAX(0,MIN(1,(F${r + 2}-D${r + 2})/(E${r + 2}-D${r + 2}))),2)`),
        values: krRows.map((k) => round2(share(k)) * 100),
      },
      {
        head: 'Status',
        type: 'select',
        width: 0.9,
        options: status,
        cells: krRows.map((k) => (share(k) >= 0.7 ? 'On track' : share(k) >= 0.4 ? 'At risk' : 'Off track')),
      },
    ],
    bars: [{ col: 6, color: '#A5B4FC' }],
  });
  N.push(scoring.node);
  const CX = PAD + T_W + 48;
  const CW = W - PAD - CX;
  N.push(head(CX, TABLE_Y, CW, 'Progress by key result', 19));
  N.push(label(CX + CW, TABLE_Y + 4, 'Dashed line: 70%, a good score', { size: 13, weight: 500, color: INK_SOFT, align: 'right' }));
  N.push(
    chartNode(
      CX,
      TABLE_Y + 48,
      CW,
      scoring.height,
      linked(scoring, { cat: 0, series: [6] }, chartSpec('barHorizontal', {
        title: undefined,
        series: [{ name: 'Progress', values: [], color: '#6366F1' }],
        showLegend: false,
        showValues: false,
        valueSuffix: '%',
        yMin: 0,
        yMax: 100,
        reference: { value: 70, style: 'dashed', color: '#10B981' },
      }))
    )
  );

  return layer(N);
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

export const PRODUCT: Template[] = [
  {
    id: 'product-q3-planning',
    category: 'product',
    name: 'Q3 planning wall',
    blurb: 'Themes, owned initiatives, dot votes, a capacity sheet that sums itself, risks and a decisions log.',
    teaches: ['Frames with emoji', 'Stamps and owners', 'Table formulas', 'Linked chart'],
    tags: ['quarterly planning', 'okr', 'capacity', 'big room planning', 'pi planning', 'risks', 'decision log'],
    accent: 'amber',
    build: planningWall,
  },
  {
    id: 'product-brand-explorations',
    category: 'product',
    name: 'Brand explorations',
    blurb: 'A drawn moodboard, three logo sketches, palette and type, voice rules and a scored comparison.',
    teaches: ['Grid moodboard', 'Sketch mode', 'Real fonts', 'Radar from a table'],
    tags: ['branding', 'rebrand', 'logo', 'moodboard', 'palette', 'typography', 'voice and tone'],
    accent: 'teal',
    build: brandBoard,
  },
  {
    id: 'product-roadmap',
    category: 'product',
    name: 'Roadmap: now, next, later',
    blurb: 'Epics as bars on a quarter grid, with status, milestones and the dependencies between them.',
    teaches: ['Timeline grid', 'Dependencies', 'Milestones', 'Status legend'],
    tags: ['roadmap', 'now next later', 'gantt', 'timeline', 'epics', 'quarterly'],
    accent: 'indigo',
    build: roadmapBoard,
  },
  {
    id: 'product-journey-map',
    category: 'product',
    name: 'User journey map',
    blurb: 'One persona across five stages: doing, thinking and feeling, with pains and owned opportunities.',
    teaches: ['Emotion curve chart', 'Data link', 'Sticky themes', 'Stage chevrons'],
    tags: ['customer journey', 'ux research', 'persona', 'service design', 'experience map'],
    accent: 'sky',
    build: journeyBoard,
  },
  {
    id: 'product-design-sprint',
    category: 'product',
    name: 'Design sprint',
    blurb: 'Five days as frames: map, crazy 8s, a voted decision, roles for the prototype and a test grid.',
    teaches: ['Five day frames', 'Crazy 8s grid', 'Voting stamps', 'COUNTIF and chart'],
    tags: ['design sprint', 'gv sprint', 'workshop', 'how might we', 'crazy 8s', 'usability test'],
    accent: 'violet',
    build: (limit) => sprintBoard(limit),
  },
  {
    id: 'product-retro',
    category: 'product',
    name: 'Team retrospective',
    blurb: 'Clustered notes with stamps, owned action checklists and the team’s mood over six sprints.',
    teaches: ['Clusters', 'Checklists', 'Owner chips', 'Mood chart'],
    tags: ['retro', 'retrospective', 'agile', 'scrum', 'start stop continue', 'team health'],
    accent: 'rose',
    build: retroBoard,
  },
  {
    id: 'product-okr-tree',
    category: 'product',
    name: 'OKR tree',
    blurb: 'A company objective down to nine key results, each with live progress and a scoring table.',
    teaches: ['Curved connectors', 'Progress bars', 'Formulas', 'Linked bar chart'],
    tags: ['okr', 'objectives', 'key results', 'goals', 'strategy', 'alignment'],
    accent: 'green',
    build: okrBoard,
  },
];
