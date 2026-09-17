import { PLOT_PRESETS, specFromPreset } from './plotPresets';
import { CHART_LABELS } from './chartKinds';
import { defaultChartSpec, isPlot, type ChartKind, type ChartSpec } from './chartTypes';

/**
 * A chart you can start from, for every kind.
 *
 * ## Why this exists
 *
 * There were examples, and they were only for the seven math-plot kinds. A
 * bar chart, a pie, a funnel, a waterfall, a radar — everything anybody
 * actually reaches for first — arrived carrying placeholder numbers with no
 * way to see what a finished one looks like. The heatmap had none either,
 * despite being a plot: it was added after the list was written and nobody
 * went back.
 *
 * That asymmetry is backwards. Somebody plotting `sin(x)` knows what they
 * want; somebody making their first waterfall mostly does not know what a
 * waterfall *is for*, and a worked example is the fastest possible answer.
 *
 * ## The data is real in shape, if not in fact
 *
 * Every example here is a plausible thing somebody would actually chart:
 * revenue by quarter, tickets by channel, response times, a signup funnel.
 * That matters more than it sounds. Placeholder data (`A: 10, B: 20, C: 30`)
 * teaches nothing, because the whole question a chart answers is "what does
 * *this* shape of data look like drawn this way" — and a straight ascending
 * ramp is the one shape no real dataset ever has.
 *
 * Each carries a title and a number format too, so picking one lands a
 * finished chart rather than a starting point that still needs three trips to
 * the panel.
 */

export interface ChartExample {
  id: string;
  name: string;
  /** One line, saying what it demonstrates rather than what it is. */
  note: string;
  kind: ChartKind;
  /** Complete and ready to apply. */
  spec: ChartSpec;
}

const money = { valuePrefix: '$', compactNumbers: true } as const;

/**
 * The data kinds. Plots come from `PLOT_PRESETS`, which already had them.
 *
 * Ordered by kind so `examplesFor` can group without a second table.
 */
export const DATA_EXAMPLES: ChartExample[] = [
  // ── Comparison ─────────────────────────────────────────────────────────
  {
    id: 'revenue-quarters',
    name: 'Revenue by quarter',
    note: 'the plain comparison, and what most bar charts are',
    kind: 'bar',
    spec: {
      kind: 'bar',
      title: 'Revenue by quarter',
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [{ name: 'Revenue', values: [1_240_000, 1_410_000, 1_180_000, 1_920_000] }],
      ...money,
      yAxisLabel: 'Revenue',
    },
  },
  {
    id: 'tickets-channel',
    name: 'Tickets by channel',
    note: 'long category names, which is why the bars lie down',
    kind: 'barHorizontal',
    spec: {
      kind: 'barHorizontal',
      title: 'Support tickets by channel',
      categories: ['In-app chat', 'Email', 'Community forum', 'Phone', 'Social'],
      series: [{ name: 'Tickets', values: [1840, 1220, 610, 340, 190] }],
      sort: 'valueDesc',
    },
  },
  {
    id: 'plan-mix',
    name: 'Plan mix by region',
    note: 'the parts and the total, both readable at once',
    kind: 'stackedBar',
    spec: {
      kind: 'stackedBar',
      title: 'Accounts by plan',
      categories: ['Americas', 'EMEA', 'APAC'],
      series: [
        { name: 'Free', values: [4200, 3100, 2600] },
        { name: 'Team', values: [1800, 1500, 900] },
        { name: 'Enterprise', values: [320, 410, 180] },
      ],
    },
  },
  {
    id: 'plan-share',
    name: 'Plan share by region',
    note: 'the same data as a share, where the totals stop competing',
    kind: 'stackedBar100',
    spec: {
      kind: 'stackedBar100',
      title: 'Plan share by region',
      categories: ['Americas', 'EMEA', 'APAC'],
      series: [
        { name: 'Free', values: [4200, 3100, 2600] },
        { name: 'Team', values: [1800, 1500, 900] },
        { name: 'Enterprise', values: [320, 410, 180] },
      ],
    },
  },

  // ── Trend ──────────────────────────────────────────────────────────────
  {
    id: 'weekly-active',
    name: 'Weekly active users',
    note: 'a trend with a dip in it, which is what trends have',
    kind: 'line',
    spec: {
      kind: 'line',
      title: 'Weekly active users',
      categories: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'],
      series: [{ name: 'Active', values: [8200, 8900, 9400, 9100, 10_200, 11_400, 10_900, 12_600] }],
      compactNumbers: true,
    },
  },
  {
    id: 'rate-limit',
    name: 'Rate limit changes',
    note: 'a value that jumps and holds, rather than sliding between readings',
    kind: 'step',
    spec: {
      kind: 'step',
      title: 'API rate limit',
      categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      series: [{ name: 'Requests / min', values: [60, 60, 120, 120, 120, 300] }],
    },
  },
  {
    id: 'cumulative-signups',
    name: 'Cumulative signups',
    note: 'a running total, where the filled area is the quantity',
    kind: 'area',
    spec: {
      kind: 'area',
      title: 'Signups to date',
      categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      series: [{ name: 'Signups', values: [420, 980, 1_640, 2_510, 3_480, 4_720] }],
      compactNumbers: true,
    },
  },
  {
    id: 'traffic-source',
    name: 'Traffic by source',
    note: 'how a total split up, and how the split moved',
    kind: 'stackedArea',
    spec: {
      kind: 'stackedArea',
      title: 'Sessions by source',
      categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      series: [
        { name: 'Direct', values: [1200, 1400, 1350, 1500, 1600, 900, 780] },
        { name: 'Search', values: [2100, 2300, 2250, 2400, 2600, 1400, 1200] },
        { name: 'Referral', values: [400, 380, 460, 520, 610, 300, 240] },
      ],
    },
  },

  // ── Distribution ───────────────────────────────────────────────────────
  {
    id: 'response-times',
    name: 'Response times',
    note: 'a long tail, which is what latency always looks like',
    kind: 'histogram',
    spec: {
      kind: 'histogram',
      title: 'Response time distribution',
      categories: [],
      series: [
        {
          name: 'ms',
          values: [
            42, 48, 51, 53, 55, 58, 58, 61, 62, 64, 65, 66, 68, 69, 71, 72, 74, 75, 77, 79, 81,
            84, 88, 92, 97, 103, 112, 128, 154, 189, 240, 312, 480,
          ],
        },
      ],
      buckets: 12,
      valueSuffix: 'ms',
      showKde: true,
    },
  },
  {
    id: 'price-rating',
    name: 'Price against rating',
    note: 'two measures at once, to see whether they move together',
    kind: 'scatter',
    spec: {
      kind: 'scatter',
      title: 'Price against rating',
      categories: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
      series: [
        { name: 'Rating', values: [3.2, 3.8, 4.1, 3.5, 4.4, 4.6, 3.9, 4.8, 4.2, 3.1, 4.5, 4.9] },
      ],
      showTrendline: true,
    },
  },
  {
    id: 'market-size',
    name: 'Markets by size',
    note: 'a third number carried by the area of the mark',
    kind: 'bubble',
    spec: {
      kind: 'bubble',
      title: 'Markets by size',
      categories: ['US', 'DE', 'JP', 'BR', 'IN', 'UK', 'FR', 'CA'],
      series: [{ name: 'Accounts', values: [8400, 3100, 2700, 1900, 4600, 2900, 1700, 1400] }],
    },
  },

  // ── Part to whole ──────────────────────────────────────────────────────
  {
    id: 'market-share',
    name: 'Market share',
    note: 'a few parts of one whole, which is all a pie can carry',
    kind: 'pie',
    spec: {
      kind: 'pie',
      title: 'Market share',
      categories: ['Us', 'Northwind', 'Contoso', 'Everyone else'],
      series: [{ name: 'Share', values: [34, 27, 21, 18] }],
      valueSuffix: '%',
      showValues: true,
    },
  },
  {
    id: 'storage-used',
    name: 'Storage used',
    note: 'the same shape, with the middle free for the total',
    kind: 'donut',
    spec: {
      kind: 'donut',
      title: 'Storage used',
      categories: ['Documents', 'Media', 'Backups', 'Free'],
      series: [{ name: 'GB', values: [128, 412, 96, 364] }],
      valueSuffix: ' GB',
    },
  },
  {
    id: 'signup-funnel',
    name: 'Signup funnel',
    note: 'where people leave, which is the only thing a funnel says',
    kind: 'funnel',
    spec: {
      kind: 'funnel',
      title: 'Signup funnel',
      categories: ['Visited', 'Started', 'Verified', 'Activated', 'Paid'],
      series: [{ name: 'People', values: [48_000, 12_400, 9_100, 5_600, 1_820] }],
      compactNumbers: true,
    },
  },

  // ── Specialist ─────────────────────────────────────────────────────────
  {
    id: 'revenue-bridge',
    name: 'Revenue bridge',
    note: 'what moved between two totals, and which way',
    kind: 'waterfall',
    spec: {
      kind: 'waterfall',
      title: 'Revenue bridge, FY24 to FY25',
      categories: ['FY24', 'New', 'Expansion', 'Churn', 'Contraction', 'FY25'],
      series: [{ name: 'Change', values: [4_200_000, 1_450_000, 620_000, -780_000, -240_000, 5_250_000] }],
      ...money,
    },
  },
  {
    id: 'team-scores',
    name: 'Capability scores',
    note: 'several scores at once, where the shape is the comparison',
    kind: 'radar',
    spec: {
      kind: 'radar',
      title: 'Capability scores',
      categories: ['Speed', 'Reliability', 'Security', 'Support', 'Price', 'Docs'],
      series: [
        { name: 'Us', values: [8, 9, 7, 8, 5, 9] },
        { name: 'Northwind', values: [6, 7, 9, 5, 8, 6] },
      ],
    },
  },

  // ── Field ──────────────────────────────────────────────────────────────
  // The heatmap had no examples at all: it was added after the preset list was
  // written and nobody went back for it.
  {
    id: 'heat-peaks',
    name: 'Two peaks',
    note: 'a surface with two maxima, and the saddle between them',
    kind: 'heatmap',
    spec: {
      kind: 'heatmap',
      title: 'Two peaks',
      categories: [],
      series: [],
      functions: [{ source: 'exp(-((x-1.5)^2 + (y-1)^2)) + exp(-((x+1.5)^2 + (y+1)^2))' }],
      xMin: -5,
      xMax: 5,
      yPlotMin: -4,
      yPlotMax: 4,
      resolution: 90,
      ramp: 'viridis',
    },
  },
  {
    id: 'heat-interference',
    name: 'Interference',
    note: 'two sources meeting, where a uniform ramp earns its keep',
    kind: 'heatmap',
    spec: {
      kind: 'heatmap',
      title: 'Interference',
      categories: [],
      series: [],
      functions: [{ source: 'sin(sqrt((x-2)^2 + y^2) * 3) + sin(sqrt((x+2)^2 + y^2) * 3)' }],
      xMin: -6,
      xMax: 6,
      yPlotMin: -5,
      yPlotMax: 5,
      resolution: 110,
      ramp: 'diverging',
    },
  },
  {
    id: 'heat-saddle',
    name: 'Saddle',
    note: 'up one way and down the other, which a contour map hides',
    kind: 'heatmap',
    spec: {
      kind: 'heatmap',
      title: 'x² − y²',
      categories: [],
      series: [],
      functions: [{ source: 'x^2 - y^2' }],
      xMin: -4,
      xMax: 4,
      yPlotMin: -4,
      yPlotMax: 4,
      resolution: 90,
      ramp: 'diverging',
    },
  },
  {
    id: 'heat-decay',
    name: 'Radial decay',
    note: 'a cost that falls off with distance — reversed, so heavy reads dark',
    kind: 'heatmap',
    spec: {
      kind: 'heatmap',
      title: 'Distance cost',
      categories: [],
      series: [],
      functions: [{ source: '1 / (1 + x^2 + y^2)' }],
      xMin: -4,
      xMax: 4,
      yPlotMin: -4,
      yPlotMax: 4,
      resolution: 90,
      ramp: 'magma',
      rampReversed: true,
    },
  },

  // ── Grouped comparison ────────────────────────────────────────────────
  {
    id: 'grouped-quarters',
    name: 'Grouped by quarter',
    note: 'several series side by side, compared within each category',
    kind: 'bar',
    spec: {
      kind: 'bar',
      title: 'Revenue by product line',
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [
        { name: 'Core', values: [182, 204, 231, 268] },
        { name: 'Add-ons', values: [64, 78, 91, 110] },
        { name: 'Services', values: [42, 45, 51, 49] },
      ],
      ...money,
      valueSuffix: 'k',
    },
  },

  // ── Heat tables ───────────────────────────────────────────────────────
  {
    id: 'weekday-hours',
    name: 'Weekday × hour',
    note: 'where the load concentrates, read in one glance',
    kind: 'matrix',
    spec: defaultChartSpec('matrix'),
  },
  {
    id: 'correlation-matrix',
    name: 'Correlation matrix',
    note: 'a diverging ramp, because −1 and +1 are different in kind',
    kind: 'matrix',
    spec: {
      kind: 'matrix',
      title: 'How the measures move together',
      categories: ['Height', 'Weight', 'Age', 'Sleep', 'Steps'],
      series: [
        { name: 'Height', values: [1, 0.72, 0.08, -0.04, 0.12] },
        { name: 'Weight', values: [0.72, 1, 0.31, -0.18, -0.26] },
        { name: 'Age', values: [0.08, 0.31, 1, -0.22, -0.41] },
        { name: 'Sleep', values: [-0.04, -0.18, -0.22, 1, 0.19] },
        { name: 'Steps', values: [0.12, -0.26, -0.41, 0.19, 1] },
      ],
      ramp: 'diverging',
      decimals: 2,
      compactNumbers: false,
      showValues: true,
    },
  },

  // ── Time ──────────────────────────────────────────────────────────────
  {
    id: 'launch-plan',
    name: 'Launch plan',
    note: 'phases as spans, a milestone as a point, and a line for today',
    kind: 'timeline',
    spec: defaultChartSpec('timeline'),
  },
  {
    id: 'physics-century',
    name: 'A century of physics',
    note: 'eras on a shared axis, so overlap is visible',
    kind: 'timeline',
    spec: {
      kind: 'timeline',
      title: 'Physics, 1900–2000',
      categories: ['Quantum theory', 'Relativity', 'Nuclear physics', 'Standard Model', 'Cosmology'],
      series: [
        { name: 'Start', values: [1900, 1905, 1932, 1961, 1964] },
        { name: 'End', values: [1927, 1916, 1954, 1978, 1998] },
      ],
      compactNumbers: false,
      showValues: true,
    },
  },

  // ── Distributions ─────────────────────────────────────────────────────
  {
    id: 'latency-regions',
    name: 'Latency by region',
    note: 'medians, quartiles and outliers, side by side',
    kind: 'boxPlot',
    spec: defaultChartSpec('boxPlot'),
  },
  {
    id: 'exam-scores',
    name: 'Scores by class',
    note: 'the same mean hiding very different spreads',
    kind: 'boxPlot',
    spec: {
      kind: 'boxPlot',
      title: 'Exam scores',
      categories: [],
      series: [
        { name: 'Class A', values: [61, 64, 66, 68, 69, 70, 71, 72, 72, 73, 74, 75, 76, 78, 80] },
        { name: 'Class B', values: [38, 45, 52, 58, 63, 67, 71, 74, 78, 82, 86, 90, 93, 96, 99] },
        { name: 'Class C', values: [55, 60, 63, 67, 70, 72, 73, 74, 75, 77, 79, 81, 84, 88, 97] },
      ],
      reference: { value: 72, label: 'Pass' },
    },
  },
  {
    id: 'session-cohorts',
    name: 'Two cohorts',
    note: 'overlapping distributions, each smoothed',
    kind: 'density',
    spec: defaultChartSpec('density'),
  },
  {
    id: 'normal-vs-skewed',
    name: 'Normal against skewed',
    note: 'a bell beside a long tail — what a mean alone cannot say',
    kind: 'density',
    spec: {
      kind: 'density',
      title: 'Symmetric and skewed samples',
      categories: [],
      series: [
        { name: 'Symmetric', values: [42, 45, 46, 47, 48, 48, 49, 49, 50, 50, 50, 51, 51, 52, 52, 53, 54, 55, 57, 58] },
        { name: 'Skewed', values: [31, 32, 33, 33, 34, 34, 35, 35, 36, 37, 38, 40, 42, 45, 49, 54, 60, 67, 75, 86] },
      ],
    },
  },

  // ── Hierarchies and relationships ─────────────────────────────────────
  {
    id: 'budget-tree',
    name: 'Budget by team',
    note: 'area is the quantity, so the big spenders are the big tiles',
    kind: 'treemap',
    spec: defaultChartSpec('treemap'),
  },
  {
    id: 'market-share',
    name: 'Market share',
    note: 'many parts of one whole, where a pie would run out of room',
    kind: 'treemap',
    spec: {
      kind: 'treemap',
      title: 'Browser share',
      categories: ['Chrome', 'Safari', 'Edge', 'Firefox', 'Samsung', 'Opera', 'Other'],
      series: [{ name: 'Share', values: [64.7, 18.6, 5.2, 2.8, 2.5, 2.2, 4] }],
      valueSuffix: '%',
      decimals: 1,
      compactNumbers: false,
      showValues: true,
    },
  },
  {
    id: 'team-graph',
    name: 'Collaboration graph',
    note: 'weighted links, laid out so close collaborators sit close',
    kind: 'network',
    spec: defaultChartSpec('network'),
  },
  {
    id: 'graph-theory',
    name: 'Cycle and hub',
    note: 'a ring of six joined to one centre: a wheel graph',
    kind: 'network',
    spec: (() => {
      const nodes = ['Hub', 'A', 'B', 'C', 'D', 'E', 'F'];
      const n = nodes.length;
      const at = (i: number, j: number) => {
        if (i === j) return 0;
        if (i === 0 || j === 0) return 2;
        const d = Math.abs(i - j);
        return d === 1 || d === n - 2 ? 1 : 0;
      };
      return {
        kind: 'network' as const,
        title: 'Wheel graph W₇',
        categories: nodes,
        series: nodes.map((name, i) => ({ name, values: nodes.map((_, j) => at(i, j)) })),
        curved: true,
      };
    })(),
  },
  {
    id: 'handoff-flow',
    name: 'Hand-offs between teams',
    note: 'one-way links: each arrow is a hand-off, thicker for more of them',
    kind: 'network',
    spec: (() => {
      const teams = ['Sales', 'Solutions', 'Legal', 'Finance', 'Delivery', 'Support'];
      // Row → column: how many hand-offs go from one team to the other.
      const out = [
        [0, 5, 2, 0, 0, 0],
        [1, 0, 1, 0, 4, 0],
        [0, 0, 0, 3, 0, 0],
        [0, 0, 0, 0, 2, 0],
        [0, 1, 0, 0, 0, 5],
        [2, 1, 0, 0, 0, 0],
      ];
      return {
        kind: 'network' as const,
        title: 'Hand-offs between teams',
        categories: teams,
        series: teams.map((name, i) => ({ name, values: out[i] })),
        directed: true,
        curved: true,
        showValues: true,
      };
    })(),
  },
];

/** Every example, from both sources, as one list. */
export function allExamples(): ChartExample[] {
  const fromPlots: ChartExample[] = PLOT_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    note: preset.note,
    kind: preset.kind,
    spec: specFromPreset(preset),
  }));
  return [...DATA_EXAMPLES, ...fromPlots];
}

/**
 * Examples for a kind, that kind first.
 *
 * The current kind's own examples lead, then everything else grouped by kind
 * — because picking an example is *also* how people change kind, and the
 * fastest way to discover that a waterfall exists is to see one while you are
 * looking at a bar chart. Restricting the gallery to the current kind would
 * make it a style picker; leaving it open makes it a chooser.
 */
export function exampleGroups(
  current: ChartKind
): Array<{ kind: ChartKind; label: string; examples: ChartExample[] }> {
  const all = allExamples();
  const kinds: ChartKind[] = [];
  for (const example of all) {
    if (!kinds.includes(example.kind)) kinds.push(example.kind);
  }

  // The current kind first, then its own family, then the rest in the order
  // the examples were written — which groups the data kinds before the plots.
  const ranked = [
    ...kinds.filter((k) => k === current),
    ...kinds.filter((k) => k !== current && isPlot(k) === isPlot(current)),
    ...kinds.filter((k) => k !== current && isPlot(k) !== isPlot(current)),
  ];

  return ranked
    .map((kind) => ({
      kind,
      label: CHART_LABELS[kind],
      examples: all.filter((e) => e.kind === kind),
    }))
    .filter((group) => group.examples.length > 0);
}
