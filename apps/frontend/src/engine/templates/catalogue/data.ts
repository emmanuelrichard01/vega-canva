import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../../document/mutations';
import type { ChartSpec } from '../../chart/chartTypes';
import type { Template } from '../templates';
import { INK, INK_SOFT, INK_STRONG, HAIRLINE, PAPER_SOFT, RULE, code, layer } from '../templateKit';
import {
  COL,
  GUTTER,
  MARGIN,
  PAGE_GAP,
  PAGE_H,
  PAGE_W,
  aside,
  axes,
  cell,
  chartAt,
  colX,
  dot,
  figure,
  fmt,
  formula,
  head,
  lede,
  linked,
  mean,
  note,
  page,
  pageTitle,
  polyline,
  regress,
  round,
  rule,
  seeded,
  sheet,
  slab,
  span,
  stdev,
  words,
  type Pt,
  type Sheet,
} from './dataKit';

/**
 * Data & dashboards, and science & maths.
 *
 * Every board is a working document rather than a picture of one: the charts
 * read the tables beside them through data links, the tables compute with
 * real formulas, and the science is simulated from seeded draws, so a board
 * and its cover are the same drawing and the numbers on it can be checked.
 *
 * Figures a chart cannot draw honestly are drawn from shapes on measured
 * axes: a scatter whose x is a measurement (a chart's x is a set of
 * categories), confidence intervals, a hexbin, a network you can drag apart.
 */

/** Series colours the boards share: deep enough to read on white, distinct in hue. */
const C = {
  indigo: '#4F46E5',
  teal: '#0D9488',
  rose: '#E11D48',
  amber: '#D97706',
  sky: '#0284C7',
  violet: '#7C3AED',
  slate: '#64748B',
  green: '#059669',
  pink: '#DB2777',
};

/** The same hues a step deeper, for text set in a series colour: each clears 4.5:1 on white. */
const DEEP: Record<string, string> = {
  [C.indigo]: '#4338CA',
  [C.teal]: '#0F766E',
  [C.amber]: '#B45309',
  [C.rose]: '#BE123C',
  [C.violet]: '#6D28D9',
};

/** Inputs are typed in blue and formulas sit on grey: the spreadsheet convention. */
const INPUT = { color: '#1D4ED8' };
const COMPUTED = { fill: '#F8FAFC', color: INK };
/** The maths face: a text serif's italic, so an equation reads as one. */
const MATHS = 'Source Serif 4';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A chart of `kind` with nothing in it yet.
 *
 * Not `defaultChartSpec`: a new chart's demo data carries its own title, an
 * SLA line and `$…k` formatting, and every one of those would leak into a
 * board that only meant to choose the kind.
 */
const base = (kind: ChartSpec['kind']): ChartSpec => ({ kind, categories: [], series: [] });

/** The left edge of page `i` on a board laid out left to right. */
const pageX = (i: number) => i * (PAGE_W + PAGE_GAP);

/** A page's title and the sentence under it. */
const heading = (x0: number, title: string, sentence: string): NewNodeInput[] => [
  pageTitle(colX(x0, 0), 64, title),
  lede(colX(x0, 0), 124, sentence, span(11)),
];

/** The standard normal CDF, by Abramowitz & Stegun 7.1.26 (error below 1.5e-7). */
function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y =
    1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** A row of colour keys: a dot and its name, for figures drawn from shapes. */
function key(x: number, y: number, items: Array<[string, string]>, gap = 28): NewNodeInput[] {
  const out: NewNodeInput[] = [];
  let cx = x;
  for (const [label, color] of items) {
    out.push(dot(cx + 6, y + 10, 6, color));
    const w = Math.ceil(label.length * 14 * 0.56) + 8;
    out.push(words(cx + 18, y, w, label, { size: 14, weight: 500, color: INK_SOFT, lineHeight: 1.4 }));
    cx += 18 + w + gap;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. SaaS metrics review
// ---------------------------------------------------------------------------

function saasBoard(): NewNodeInput[] {
  const out: NewNodeInput[] = [];
  const P1 = pageX(0);
  const P2 = pageX(1);

  // A year of monthly recurring revenue, in $k, as finance books it.
  const opening = 612.0;
  const newMrr = [24.6, 22.1, 27.8, 26.4, 29.3, 31.0, 28.2, 25.7, 33.4, 35.1, 37.9, 30.6];
  const expansion = [9.8, 10.4, 11.9, 12.6, 13.1, 14.8, 15.2, 13.9, 16.7, 18.3, 19.6, 21.4];
  const churned = [11.2, 10.6, 12.1, 11.4, 12.8, 11.9, 13.4, 21.8, 14.1, 12.7, 12.2, 13.0];
  const mrr: number[] = [];
  newMrr.forEach((n, i) => mrr.push(round((i ? mrr[i - 1] : opening) + n + expansion[i] - churned[i], 1)));
  const prev = (i: number) => (i ? mrr[i - 1] : opening);
  const nrr = mrr.map((_, i) => round((prev(i) + expansion[i] - churned[i]) / prev(i), 4));

  // Row 2 is December's closing balance; January is row 3.
  const bridge = sheet(colX(P2, 0), 256, span(7), {
    title: 'MRR bridge',
    columns: [
      { head: 'Month', width: 1.1, cells: ["Dec '24", ...MONTHS] },
      { head: 'New', type: 'number', cells: ['', ...newMrr.map((v) => fmt(v, 1))], style: INPUT },
      { head: 'Expansion', type: 'number', cells: ['', ...expansion.map((v) => fmt(v, 1))], style: INPUT },
      { head: 'Churned', type: 'number', cells: ['', ...churned.map((v) => fmt(v, 1))], style: INPUT },
      {
        head: 'MRR',
        type: 'number',
        cells: [fmt(opening, 1), ...MONTHS.map((_, i) => `=ROUND(${cell(4, i + 2)}+${cell(1, i + 3)}+${cell(2, i + 3)}-${cell(3, i + 3)},1)`)],
        values: [opening, ...mrr],
        style: COMPUTED,
      },
      {
        head: 'Net new',
        type: 'number',
        cells: ['', ...MONTHS.map((_, i) => `=ROUND(${cell(4, i + 3)}-${cell(4, i + 2)},1)`)],
        values: [null, ...mrr.map((v, i) => round(v - prev(i), 1))],
        style: COMPUTED,
      },
      {
        head: 'NRR',
        type: 'percent',
        cells: ['', ...MONTHS.map((_, i) => `=ROUND((${cell(4, i + 2)}+${cell(2, i + 3)}-${cell(3, i + 3)})/${cell(4, i + 2)},4)`)],
        values: [null, ...nrr.map((v) => round(v * 100, 2))],
        style: COMPUTED,
      },
    ],
    accent: C.indigo,
    styles: { '1:4': { ...INPUT, fill: '#F8FAFC' } },
    rules: [{ col: 3, when: '>18', fill: '#FFE4E6', color: '#9F1239', bold: true }],
  });

  // Quarterly unit economics: CAC from spend, LTV from ARPA, margin and churn.
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  const spend = [790, 836, 871, 902];
  const logos = [37, 40, 41, 46];
  const arpa = [1.58, 1.61, 1.63, 1.68];
  const margin = [80, 81, 81, 82];
  const logoChurn = [1.9, 1.8, 2.1, 1.6];
  const cac = spend.map((s, i) => round(s / logos[i], 1));
  const ltv = arpa.map((a, i) => round((a * margin[i]) / logoChurn[i], 0));
  const ratio = ltv.map((l, i) => round(l / cac[i], 1));
  const unit = sheet(colX(P2, 7), 256, span(5), {
    title: 'Unit economics',
    columns: [
      { head: 'Qtr', width: 0.7, cells: quarters },
      { head: 'Spend', type: 'number', cells: spend.map(String), style: INPUT },
      { head: 'Logos', type: 'number', width: 0.9, cells: logos.map(String), style: INPUT },
      { head: 'CAC', type: 'number', width: 0.9, cells: quarters.map((_, i) => `=ROUND(${cell(1, i + 2)}/${cell(2, i + 2)},1)`), values: cac, style: COMPUTED },
      { head: 'ARPA', type: 'number', width: 0.9, cells: arpa.map((v) => fmt(v, 2)), style: INPUT },
      { head: 'Margin', type: 'percent', cells: margin.map((v) => `${v}%`), style: INPUT },
      { head: 'Churn', type: 'percent', width: 0.9, cells: logoChurn.map((v) => `${v}%`), style: INPUT },
      { head: 'LTV', type: 'number', width: 0.8, cells: quarters.map((_, i) => `=ROUND(${cell(4, i + 2)}*${cell(5, i + 2)}/${cell(6, i + 2)},0)`), values: ltv, style: COMPUTED },
      { head: 'LTV : CAC', type: 'number', width: 1.1, cells: quarters.map((_, i) => `=ROUND(${cell(7, i + 2)}/${cell(3, i + 2)},1)`), values: ratio, style: COMPUTED },
    ],
    accent: C.indigo,
    rules: [{ col: 8, when: '<3', fill: '#FFE4E6', color: '#9F1239', bold: true }],
  });

  // Logo retention by signup cohort. August's outage shows as a diagonal.
  const cohorts = MONTHS.slice(0, 8);
  const curve = [100, 91, 86.5, 83, 80.5, 78.5, 77];
  const retention = cohorts.map((_, ci) =>
    curve.map((b, m) => {
      if (ci + m > 11) return null;
      const lift = ci * 0.45 * Math.min(m, 3);
      const outage = m > 0 && ci + m >= 7 ? 2.6 : 0;
      return Math.round(b + lift - outage);
    })
  );
  const cohortY = 256 + unit.height + 88;
  const cohortSheet = sheet(colX(P2, 7), cohortY, span(5), {
    title: 'Cohort retention',
    columns: [
      { head: 'Cohort', width: 1.1, cells: cohorts.map((m) => `${m} '25`) },
      ...curve.map((_, m) => ({
        head: `M${m}`,
        type: 'percent' as const,
        width: 0.8,
        cells: retention.map((row) => (row[m] === null ? '' : `${row[m]}%`)),
      })),
    ],
    accent: C.indigo,
    scales: curve.slice(1).map((_, m) => ({ col: m + 2, from: '#FFFFFF', to: '#C7D2FE' })),
  });

  // ---- Page 1: the dashboard ------------------------------------------
  out.push(
    page(P1, 0, 'Revenue dashboard', {
      icon: '📈',
      description: 'FY2025 at a glance. Every number here is read from the tables on the next page.',
    }),
    ...heading(
      P1,
      'Northwind Analytics · FY2025 revenue review',
      `MRR closed the year at $${fmt(mrr[11], 1)}k, up ${fmt(((mrr[11] - opening) / opening) * 100, 0)}% on December. Expansion carried the second half; churn spiked once, in August.`
    )
  );

  // KPI tiles: a label, a live value (a one-cell table reading the others by name), and what it measures.
  const kpis: Array<{ label: string; formula: string; caption: string }> = [
    { label: 'MRR', formula: `=TEXT('MRR bridge'!E14,"$#,##0.0k")`, caption: 'December close' },
    { label: 'ARR run-rate', formula: `=TEXT('MRR bridge'!E14*12/1000,"$0.00M")`, caption: 'MRR × 12' },
    { label: 'Net new MRR', formula: `=TEXT('MRR bridge'!E14-'MRR bridge'!E2,"+$#,##0.0k")`, caption: 'Over the year' },
    { label: 'Net revenue retention', formula: `=TEXT('MRR bridge'!G14,"0.0%")`, caption: 'December, month on month' },
    { label: 'CAC', formula: `=TEXT('Unit economics'!D5,"$0.0k")`, caption: 'Per new logo, Q4' },
    { label: 'LTV : CAC', formula: `=TEXT('Unit economics'!I5,"0.0")&" : 1"`, caption: 'Q4 · healthy above 3' },
  ];
  kpis.forEach((k, i) => {
    const x = colX(P1, i * 2);
    const w = span(2);
    const y = 208;
    out.push(slab(x, y, w, 136, '#FFFFFF', { stroke: RULE, strokeWidth: 1 }));
    out.push(words(x + 20, y + 18, w - 40, k.label, { size: 14, weight: 600, color: INK_SOFT }));
    out.push(
      sheet(x + 8, y + 46, w - 16, {
        title: `KPI · ${k.label}`,
        header: false,
        columns: [{ head: '', cells: [k.formula], align: 'left', style: { bold: true, color: INK_STRONG } }],
        theme: 'minimal',
        fontSize: 30,
        rowH: 48,
      }).node
    );
    out.push(words(x + 20, y + 100, w - 40, k.caption, { size: 13, color: INK_SOFT }));
  });

  out.push(
    ...figure(colX(P1, 0), 384, span(6), 336, 'Monthly recurring revenue', "$k, December '24 to December '25", {
      ...linked(bridge, { cat: 0, series: [4] }, {
        ...base('area'),
        series: [{ name: '', values: [], color: C.indigo }],
        valuePrefix: '$',
        valueSuffix: 'k',
        gradient: true,
        curved: true,
        includeZero: false,
        showLegend: false,
      } as ChartSpec),
    }),
    ...figure(colX(P1, 6), 384, span(6), 336, 'What moved MRR', '$k a month: new and expansion as bars, churn as a line', {
      ...linked(bridge, { cat: 0, series: [1, 2, 3], filled: 1 }, {
        ...base('bar'),
        series: [
          { name: '', values: [], color: C.indigo },
          { name: '', values: [], color: C.teal },
          { name: '', values: [], color: C.rose, mark: 'line' },
        ],
        valuePrefix: '$',
        valueSuffix: 'k',
        cornerRadius: 2,
        legendPosition: 'top',
      } as ChartSpec),
    }),
    ...figure(colX(P1, 0), 752, span(4), 272, 'Net revenue retention', 'Month on month; under 100% the base shrank', {
      ...linked(bridge, { cat: 0, series: [6], filled: 1 }, {
        ...base('line'),
        series: [{ name: '', values: [], color: C.teal }],
        valueSuffix: '%',
        reference: { value: 100, label: '', color: C.slate },
        markerShape: 'circle',
        decimals: 1,
        showLegend: false,
      } as ChartSpec),
    }),
    ...figure(colX(P1, 4), 752, span(4), 272, 'Logo retention by cohort', 'Months 1–6; August’s outage runs down the diagonal', {
      ...linked(cohortSheet, { cat: 0, series: [2, 3, 4, 5, 6, 7] }, {
        ...base('matrix'),
        series: [],
        ramp: 'mono',
        showValues: true,
        valueSuffix: '%',
        showLegend: false,
      } as ChartSpec),
    }),
    ...figure(colX(P1, 8), 752, span(4), 272, 'LTV against CAC', '$k by quarter, with the ratio on the right axis', {
      ...linked(unit, { cat: 0, series: [3, 7, 8] }, {
        ...base('bar'),
        series: [
          { name: '', values: [], color: C.slate },
          { name: '', values: [], color: C.indigo },
          { name: '', values: [], color: C.amber, mark: 'line', axis: 'right' },
        ],
        cornerRadius: 2,
        legendPosition: 'top',
      } as ChartSpec),
    })
  );

  // ---- Page 2: the tables ---------------------------------------------
  out.push(
    page(P2, 0, 'Source tables', {
      icon: '🧮',
      description: 'Blue cells are inputs; grey cells are formulas. Change one and the dashboard follows.',
    }),
    ...heading(P2, 'The numbers behind the dashboard', 'Type over a blue input and every chart, KPI and formula that reads it recomputes, on every screen in the room.'),
    head(colX(P2, 0), 208, 'MRR bridge · $k'),
    bridge.node,
    head(colX(P2, 7), 208, 'Unit economics · $k by quarter'),
    unit.node,
    head(colX(P2, 7), cohortY - 48, 'Logo retention by signup cohort'),
    cohortSheet.node
  );

  const ny = 256 + bridge.height + 48;
  const stickyW = (span(7) - 2 * GUTTER) / 3;
  out.push(
    note(colX(P2, 0), ny, `August churn of $${fmt(churned[7], 1)}k traces to the SSO outage (INC-2291). Without it, Q3 NRR holds above 100%.`, 'peach', {
      w: stickyW,
      h: 216,
      fontSize: 19,
      stamps: { '👍': ['maya', 'tom'], '⭐': ['priya'] },
    }),
    note(colX(P2, 0) + stickyW + GUTTER, ny, 'Expansion was two-thirds of new MRR in December: Team-plan seat growth is now the engine.', 'mint', {
      w: stickyW,
      h: 216,
      fontSize: 19,
      stamps: { '🎉': ['maya', 'priya', 'jon'] },
    }),
    note(colX(P2, 0) + 2 * (stickyW + GUTTER), ny, 'Q4 payback is 14 months. Hold CAC under $20k as outbound scales in Q1.', 'sky', {
      w: stickyW,
      h: 216,
      fontSize: 19,
      stamps: { '+1': ['tom', 'jon'] },
    }),
    aside(
      colX(P2, 7),
      cohortY + cohortSheet.height + 24,
      span(5),
      'Each month column is coloured by its own values, so the table reads as a heatmap before the chart does. The KPI tiles are one-cell tables whose formulas read these tables by name.'
    )
  );

  return layer(out);
}

// ---------------------------------------------------------------------------
// 2. A/B test readout
// ---------------------------------------------------------------------------

function abTestBoard(): NewNodeInput[] {
  const out: NewNodeInput[] = [];
  const P1 = pageX(0);
  const P2 = pageX(1);

  const arms = [
    { name: 'A · Control', short: 'A', sessions: 24180, orders: 1031, color: C.slate },
    { name: 'B · One-page checkout', short: 'B', sessions: 24034, orders: 1181, color: C.indigo },
    { name: 'C · Express pay first', short: 'C', sessions: 24112, orders: 1082, color: C.amber },
  ];
  const rate = arms.map((a) => a.orders / a.sessions);
  const se = arms.map((a, i) => Math.sqrt((rate[i] * (1 - rate[i])) / a.sessions));
  const z = arms.map((_, i) => (i === 0 ? 0 : (rate[i] - rate[0]) / Math.sqrt(se[i] ** 2 + se[0] ** 2)));
  const p = z.map((v) => 2 * (1 - normCdf(Math.abs(v))));
  const lift = rate.map((r) => r / rate[0] - 1);
  const total = arms.reduce((s, a) => s + a.sessions, 0);
  const chi2 = arms.reduce((s, a) => s + (a.sessions - total / 3) ** 2 / (total / 3), 0);
  const srmP = Math.exp(-chi2 / 2); // χ² with two degrees of freedom

  const variants = sheet(colX(P1, 0), 256, span(7), {
    title: 'Variants',
    columns: [
      { head: 'Arm', width: 1.8, cells: arms.map((a) => a.name) },
      { head: 'Sessions', type: 'number', cells: arms.map((a) => String(a.sessions)), style: INPUT },
      { head: 'Orders', type: 'number', width: 0.9, cells: arms.map((a) => String(a.orders)), style: INPUT },
      {
        head: 'Conversion',
        type: 'percent',
        cells: arms.map((_, i) => `=ROUND(${cell(2, i + 2)}/${cell(1, i + 2)},5)`),
        values: rate.map((r) => round(round(r, 5) * 100, 3)),
        style: COMPUTED,
      },
      {
        head: '95% low',
        type: 'percent',
        width: 0.9,
        cells: arms.map((_, i) => `=ROUND(${cell(3, i + 2)}-1.96*SQRT(${cell(3, i + 2)}*(1-${cell(3, i + 2)})/${cell(1, i + 2)}),5)`),
        style: COMPUTED,
      },
      {
        head: '95% high',
        type: 'percent',
        width: 0.9,
        cells: arms.map((_, i) => `=ROUND(${cell(3, i + 2)}+1.96*SQRT(${cell(3, i + 2)}*(1-${cell(3, i + 2)})/${cell(1, i + 2)}),5)`),
        style: COMPUTED,
      },
      {
        head: 'Lift vs A',
        type: 'percent',
        width: 0.9,
        cells: arms.map((_, i) => (i === 0 ? '' : `=ROUND(${cell(3, i + 2)}/D2-1,4)`)),
        style: COMPUTED,
      },
      {
        head: 'z',
        type: 'number',
        width: 0.6,
        cells: arms.map((_, i) =>
          i === 0 ? '' : `=ROUND((${cell(3, i + 2)}-D2)/SQRT(${cell(3, i + 2)}*(1-${cell(3, i + 2)})/${cell(1, i + 2)}+D2*(1-D2)/B2),2)`
        ),
        style: COMPUTED,
      },
    ],
    accent: C.indigo,
    rules: [{ col: 7, when: '>2.24', fill: '#DCFCE7', color: '#166534', bold: true }],
  });

  // Cumulative conversion by day: noisy early, settling as the sample grows.
  const rnd = seeded(20251013);
  const days = Array.from({ length: 14 }, (_, d) => `Day ${d + 1}`);
  const daily = arms.map((_, i) =>
    days.map((__, d) => {
      const wobble = (rnd.normal() * 0.0042) / Math.sqrt(d + 1) + (i === 1 ? 0.0016 * Math.exp(-d / 3) : 0);
      return round((d === 13 ? rate[i] : rate[i] + wobble) * 100, 2);
    })
  );
  const dailySheet = sheet(colX(P2, 7), 256, span(5), {
    title: 'Daily cumulative conversion',
    rowH: 30,
    columns: [
      { head: 'Day', width: 1, cells: days },
      ...arms.map((a, i) => ({ head: a.short, type: 'percent' as const, cells: daily[i].map((v) => `${fmt(v, 2)}%`), style: INPUT })),
    ],
    accent: C.indigo,
  });

  // ---- Page 1: the readout --------------------------------------------
  out.push(
    page(P1, 0, 'Experiment readout', { icon: '🧪', description: 'Checkout redesign, 29 Sep – 12 Oct 2025, three arms, equal split.' }),
    ...heading(
      P1,
      'Checkout redesign · A/B/C test readout',
      `${total.toLocaleString('en-US')} sessions over 14 days. The one-page checkout lifts conversion by ${fmt((rate[1] - rate[0]) * 100, 2)} points (+${fmt(lift[1] * 100, 1)}%); express pay first does not clear the bar.`
    ),
    head(colX(P1, 0), 208, 'Results by arm'),
    variants.node
  );

  // The significance call, as a callout the table's colours agree with.
  const cx = colX(P1, 7);
  out.push(
    slab(cx, 208, span(5), 204, '#F0FDF4', { stroke: '#86EFAC', strokeWidth: 1.5 }),
    words(cx + 28, 228, span(5) - 56, 'Ship B', { size: 30, weight: 750, color: '#14532D', lineHeight: 1.2 }),
    words(cx + 28, 272, span(5) - 56, `B against A: z = ${fmt(z[1], 2)}, p = ${fmt(p[1], 4)}. Significant.`, { size: 17, weight: 600, color: '#166534', lineHeight: 1.45 }),
    words(cx + 28, 302, span(5) - 56, `C against A: z = ${fmt(z[2], 2)}, p = ${fmt(p[2], 2)}. Not significant.`, { size: 17, weight: 500, color: INK, lineHeight: 1.45 }),
    words(cx + 28, 344, span(5) - 56, 'Two comparisons against control, so each must clear α = 0.025 (Bonferroni). Two-sided tests on the difference of proportions.', { size: 14, color: INK_SOFT, lineHeight: 1.45 })
  );

  // Confidence intervals, drawn on a measured axis: a chart's bars cannot carry them.
  const forestTop = 512;
  const fx = colX(P1, 0) + 180;
  const fw = span(6) - 220;
  out.push(
    head(colX(P1, 0), 456, 'Conversion with 95% intervals'),
    words(colX(P1, 0), 484, span(6), 'Each bar is the range the true rate plausibly lies in; the dashed line is control.', { size: 14 })
  );
  const ax = axes(fx, forestTop + 32, fw, 168, {
    x: [3.8, 5.4],
    y: [0, 3],
    xTicks: [4.0, 4.4, 4.8, 5.2],
    yTicks: [],
    grid: false,
    xLabel: 'Checkout conversion (%)',
    xFormat: (v) => `${fmt(v, 1)}%`,
  });
  // No y axis line: the rows are named, not measured.
  out.push(...ax.nodes.filter((_, i) => i !== 1));
  out.push(rule({ x: ax.sx(rate[0] * 100), y: forestTop + 32 }, { x: ax.sx(rate[0] * 100), y: forestTop + 200 }, C.slate, 1.5, [6, 6]));
  arms.forEach((a, i) => {
    const y = ax.sy(2.5 - i);
    const lo = (rate[i] - 1.96 * se[i]) * 100;
    const hi = (rate[i] + 1.96 * se[i]) * 100;
    out.push(words(colX(P1, 0), y - 12, 168, a.name, { size: 14, weight: 600, color: INK, align: 'right' }));
    out.push(polyline([{ x: ax.sx(lo), y }, { x: ax.sx(hi), y }], { color: a.color, width: 5 }));
    out.push(dot(ax.sx(rate[i] * 100), y, 8, '#FFFFFF', { stroke: a.color, strokeWidth: 3 }));
    out.push(words(ax.sx(hi) + 14, y - 11, 200, `${fmt(rate[i] * 100, 2)}%  [${fmt(lo, 2)}, ${fmt(hi, 2)}]`, { size: 13, color: INK_SOFT }));
  });

  // Where each rate could be: the sampling distributions, drawn on the same measured axis
  // as the intervals. Each is a normal curve with the arm's rate as its mean and its
  // standard error as σ, sampled densely enough that the polyline is the curve.
  const sx0 = colX(P1, 7) + 64;
  const distW = span(5) - 72;
  out.push(
    head(colX(P1, 7), 456, 'Sampling distributions'),
    words(colX(P1, 7), 484, span(5), 'Where each arm’s true rate could lie: normal, mean the observed rate, σ its standard error.', { size: 14 })
  );
  const dax = axes(sx0, 560, distW, 360, {
    x: [3.7, 5.5],
    y: [0, 3.5],
    xTicks: [3.8, 4.2, 4.6, 5.0, 5.4],
    yTicks: [0, 1, 2, 3],
    xLabel: 'Checkout conversion (%)',
    yLabel: 'Density',
    xFormat: (v) => `${fmt(v, 1)}%`,
  });
  out.push(...dax.nodes);
  arms.forEach((a, i) => {
    const m = rate[i] * 100;
    const sd = se[i] * 100;
    const curve = Array.from({ length: 161 }, (_, j) => {
      const xv = m - 4 * sd + (8 * sd * j) / 160;
      return { x: dax.sx(xv), y: dax.sy(Math.exp(-(((xv - m) / sd) ** 2) / 2) / (sd * Math.sqrt(2 * Math.PI))) };
    });
    const floor = dax.sy(0);
    out.push(
      polyline([{ x: curve[0].x, y: floor }, ...curve, { x: curve[curve.length - 1].x, y: floor }], { color: a.color, width: 0, closed: true, fill: a.color, opacity: 0.14 }),
      polyline(curve, { color: a.color, width: 3 })
    );
  });
  out.push(...key(colX(P1, 7) + 8, 1000, arms.map((a) => [a.short === 'A' ? 'A control' : a.short === 'B' ? 'B one-page' : 'C express pay', a.color] as [string, string])));

  out.push(
    ...figure(colX(P1, 0), 784, span(6), 264, 'Daily cumulative conversion', 'B led from day 2 and held; the early gap was partly novelty', {
      ...linked(dailySheet, { cat: 0, series: [1, 2, 3] }, {
        ...base('line'),
        series: arms.map((a) => ({ name: '', values: [], color: a.color })),
        valueSuffix: '%',
        decimals: 1,
        legendPosition: 'right',
        markerShape: 'none',
        labelEvery: 2,
      } as ChartSpec),
    })
  );

  // ---- Page 2: method and decision ------------------------------------
  out.push(
    page(P2, 0, 'Method and decision', { icon: '✅', description: 'How the numbers were pulled, the guardrails, and what we are doing about it.' }),
    ...heading(P2, 'Method, guardrails and the call', 'Pre-registered on 26 Sep: primary metric checkout conversion, minimum detectable effect 0.5 points, 80% power.'),
    head(colX(P2, 0), 208, 'The query'),
    code(
      colX(P2, 0),
      256,
      [
        '-- Sessions and orders per arm, first exposure only',
        'WITH exposed AS (',
        '  SELECT session_id, arm, MIN(ts) AS first_seen',
        '  FROM analytics.experiment_exposures',
        "  WHERE experiment = 'checkout_v3'",
        "    AND ts BETWEEN '2025-09-29' AND '2025-10-12 23:59:59'",
        '  GROUP BY session_id, arm',
        ')',
        'SELECT',
        '  e.arm,',
        '  COUNT(*)                                   AS sessions,',
        '  COUNTIF(o.order_id IS NOT NULL)            AS orders,',
        '  ROUND(COUNTIF(o.order_id IS NOT NULL) / COUNT(*), 5) AS conversion',
        'FROM exposed e',
        'LEFT JOIN commerce.orders o',
        '  ON o.session_id = e.session_id AND o.ts >= e.first_seen',
        'GROUP BY e.arm',
        'ORDER BY e.arm;',
      ].join('\n'),
      'sql',
      span(7),
      456,
      { filename: 'checkout_v3_readout.sql', theme: 'midnight', fontSize: 14, followBoard: false, highlights: [12, 16] }
    ),
    head(colX(P2, 7), 208, 'Daily cumulative conversion, %'),
    dailySheet.node
  );

  const guard = sheet(colX(P2, 0), 840, span(7), {
    title: 'Guardrails',
    columns: [
      { head: 'Guardrail', width: 1.8, cells: ['Average order value', 'Refund rate (14 days)', 'Checkout p95 load', 'Payment errors'] },
      { head: 'A', width: 0.9, cells: ['$86.40', '2.1%', '1.84 s', '0.62%'] },
      { head: 'B', width: 0.9, cells: ['$85.10', '2.2%', '1.21 s', '0.58%'] },
      { head: 'Limit', width: 1.2, cells: ['no worse than −3%', 'no worse than +0.5 pt', 'under 2.5 s', 'under 1%'] },
      { head: 'Status', width: 0.9, cells: ['Pass', 'Pass', 'Pass', 'Pass'], align: 'center' },
    ],
    accent: C.indigo,
    rules: [
      { col: 4, when: 'Pass', fill: '#DCFCE7', color: '#166534', bold: true },
      { col: 4, when: 'Fail', fill: '#FFE4E6', color: '#9F1239', bold: true },
    ],
  });
  out.push(head(colX(P2, 0), 792, 'Guardrails, B against A'), guard.node);

  const sy = 256 + dailySheet.height + 48;
  const sw = (span(5) - GUTTER) / 2;
  out.push(
    note(
      colX(P2, 7),
      sy,
      `[x] Sample ratio check: χ² = ${fmt(chi2, 2)}, p = ${fmt(srmP, 2)}\n[x] Ran the full 14 days\n[x] No peeking before day 14\n[ ] Holdout of 5% for 30 days`,
      'white',
      { w: sw, h: 248, fontSize: 18, checklist: true }
    ),
    note(colX(P2, 7) + sw + GUTTER, sy, 'Decision: ship B to 100% on Mon 13 Oct. Re-test express pay inside the one-page flow next sprint.', 'yellow', {
      w: sw,
      h: 248,
      fontSize: 20,
      stamps: { '👍': ['lena', 'arjun', 'sofia'], '+1': ['mei', 'tom'], '🎉': ['lena'] },
    })
  );

  return layer(out);
}

// ---------------------------------------------------------------------------
// 3. Marketing funnel and attribution
// ---------------------------------------------------------------------------

function funnelBoard(): NewNodeInput[] {
  const out: NewNodeInput[] = [];
  const P1 = pageX(0);
  const P2 = pageX(1);

  const stages = ['Visited site', 'Signed up', 'Activated', 'Started trial', 'Paid'];
  const users = [182400, 14592, 6129, 3310, 1026];
  const funnel = sheet(colX(P1, 0), 256, span(6), {
    title: 'Funnel',
    columns: [
      { head: 'Stage', width: 1.4, cells: stages },
      { head: 'People', type: 'number', cells: users.map(String), style: INPUT },
      {
        head: 'Step rate',
        type: 'percent',
        cells: stages.map((_, i) => (i === 0 ? '' : `=ROUND(${cell(1, i + 2)}/${cell(1, i + 1)},3)`)),
        style: COMPUTED,
      },
      {
        head: 'Of visitors',
        type: 'percent',
        cells: stages.map((_, i) => `=ROUND(${cell(1, i + 2)}/B2,4)`),
        style: COMPUTED,
      },
    ],
    accent: C.violet,
  });

  const channels = ['Organic search', 'Paid search', 'Paid social', 'Referral', 'Lifecycle email', 'Partners'];
  const spend = [38, 214, 162, 21, 12, 46];
  const signups = [4380, 3210, 2904, 1460, 1318, 1320];
  const paid = [318, 236, 128, 152, 104, 88];
  const firstTouch = [362, 248, 176, 124, 38, 78];
  const lastTouch = [284, 251, 92, 158, 163, 78];
  const chSheet = sheet(colX(P2, 0), 256, span(7), {
    title: 'Channels',
    columns: [
      { head: 'Channel', width: 1.5, cells: channels },
      { head: 'Spend ($k)', type: 'number', cells: spend.map(String), style: INPUT },
      { head: 'Signups', type: 'number', cells: signups.map(String), style: INPUT },
      { head: 'Paid', type: 'number', width: 0.8, cells: paid.map(String), style: INPUT },
      { head: 'Signup → paid', type: 'percent', width: 1.2, cells: channels.map((_, i) => `=ROUND(${cell(3, i + 2)}/${cell(2, i + 2)},3)`), style: COMPUTED },
      { head: 'CAC ($)', type: 'number', width: 0.9, cells: channels.map((_, i) => `=ROUND(${cell(1, i + 2)}*1000/${cell(3, i + 2)},0)`), style: COMPUTED },
    ],
    accent: C.violet,
    summary: [null, 'sum', 'sum', 'sum', null, null],
    rules: [{ col: 5, when: '>1000', color: '#9F1239', bold: true }],
  });
  const attribution = sheet(colX(P2, 7), 256, span(5), {
    title: 'Attribution',
    columns: [
      { head: 'Channel', width: 1.5, cells: channels },
      { head: 'First touch', type: 'number', cells: firstTouch.map(String), style: INPUT },
      { head: 'Last touch', type: 'number', cells: lastTouch.map(String), style: INPUT },
      { head: 'Linear', type: 'number', cells: paid.map(String), style: INPUT },
    ],
    accent: C.violet,
    summary: [null, 'sum', 'sum', 'sum'],
  });

  // ---- Page 1: the funnel and where people go -------------------------
  out.push(
    page(P1, 0, 'Acquisition funnel', { icon: '🔻', description: 'Q3 2025, all channels. The flow below is drawn to scale.' }),
    ...heading(
      P1,
      'Q3 acquisition · from visit to paid',
      `${users[0].toLocaleString('en-US')} visitors became ${users[4].toLocaleString('en-US')} paying customers: ${fmt((users[4] / users[0]) * 100, 2)}% end to end. Activation is the leak worth fixing first.`
    ),
    head(colX(P1, 0), 208, 'Stage by stage'),
    funnel.node,
    ...figure(colX(P1, 6), 208, span(6), 288, 'From signup on', 'People at each stage after the visit, read from the table', {
      ...linked(funnel, { cat: 0, series: [1], filled: 2 }, {
        ...base('funnel'),
        series: [{ name: '', values: [] }],
        showValues: true,
        paletteId: 'editorial',
        showLegend: false,
      } as ChartSpec)
    })
  );

  // A Sankey from channels to outcome, ribbon width proportional to people.
  const sTop = 600;
  const sH = 400;
  out.push(head(colX(P1, 0), 528, 'Where 14,592 signups went'));
  out.push(words(colX(P1, 0), 556, span(12), 'Ribbon width is proportional to people. Drag any bar: the ribbons follow.', { size: 14 }));
  const k = (sH - 5 * 6) / users[1];
  const barW = 14;
  const colsX = [colX(P1, 2) + 40, colX(P1, 5) + 40, colX(P1, 8), colX(P1, 10) + 40];
  const ribbons: NewNodeInput[] = [];
  const flow = (from: NewNodeInput, fromV: number, to: NewNodeInput, toV: number, width: number, color: string) =>
    ({
      id: nanoid(),
      type: 'connector',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      from: { nodeId: from.id, anchor: { u: 1, v: fromV } },
      to: { nodeId: to.id, anchor: { u: 0, v: toV } },
      routing: 'curved',
      endEnd: 'none',
      endStart: 'none',
      appearance: { stroke: { color, width, cap: 'butt' } },
    }) as unknown as NewNodeInput;

  // Channels, stacked with a gap, each its share of the signup bar.
  const chanColors = [C.green, C.indigo, C.pink, C.amber, C.sky, C.violet];
  // Ribbons in the pale partner of each bar's colour, so the bars stay the subject.
  const chanTints = ['#A7F3D0', '#C7D2FE', '#FBCFE8', '#FDE68A', '#BAE6FD', '#DDD6FE'];
  let cy = sTop;
  const signupBar = slab(colsX[1], sTop + 15, barW, users[1] * k, INK_STRONG);
  let into = 0;
  channels.forEach((name, i) => {
    const h = signups[i] * k;
    const bar = slab(colsX[0], cy, barW, h, chanColors[i]);
    out.push(bar, words(colX(P1, 0), cy + h / 2 - 12, colsX[0] - colX(P1, 0) - 16, `${name} · ${signups[i].toLocaleString('en-US')}`, { size: 14, weight: 500, color: INK, align: 'right' }));
    ribbons.push(flow(bar, 0.5, signupBar, (into + signups[i] / 2) / users[1], h, chanTints[i]));
    into += signups[i];
    cy += h + 6;
  });
  out.push(signupBar);
  out.push(words(colsX[1] - 93, sTop - 30, 200, `Signed up · ${users[1].toLocaleString('en-US')}`, { size: 14, weight: 650, color: INK_STRONG, align: 'center' }));

  // Signed up → activated or not; activated → trial or not; trial → paid or lapsed.
  const act = users[2];
  const notAct = users[1] - act;
  const actBar = slab(colsX[2], sTop, barW, act * k, C.teal);
  // The bar's label sits above it, clear of the ribbons leaving its right edge.
  const dropBar = slab(colsX[2], sTop + act * k + 24, barW, notAct * k, RULE);
  ribbons.push(flow(signupBar, act / 2 / users[1], actBar, 0.5, act * k, '#99F6E4'));
  ribbons.push(flow(signupBar, (act + notAct / 2) / users[1], dropBar, 0.5, notAct * k, '#E2E8F0'));
  out.push(actBar, dropBar);
  out.push(
    words(colsX[2] - 90, sTop - 30, 200, `Activated · ${act.toLocaleString('en-US')}`, { size: 14, weight: 650, color: INK_STRONG, align: 'center' }),
    words(colsX[2] + 24, sTop + act * k + 24 + (notAct * k) / 2 - 12, 240, `Not activated · ${notAct.toLocaleString('en-US')}`, { size: 14, weight: 500, color: INK_SOFT })
  );
  const trial = users[3];
  const noTrial = act - trial;
  const paidN = users[4];
  const lapsed = trial - paidN;
  const paidBar = slab(colsX[3], sTop, barW, paidN * k, C.indigo);
  const lapsedBar = slab(colsX[3], sTop + paidN * k + 16, barW, lapsed * k, '#818CF8');
  const noTrialBar = slab(colsX[3], sTop + trial * k + 40, barW, noTrial * k, RULE);
  ribbons.push(
    flow(actBar, paidN / 2 / act, paidBar, 0.5, paidN * k, '#A5B4FC'),
    flow(actBar, (paidN + lapsed / 2) / act, lapsedBar, 0.5, lapsed * k, '#E0E7FF'),
    flow(actBar, (trial + noTrial / 2) / act, noTrialBar, 0.5, noTrial * k, '#E2E8F0')
  );
  out.push(
    paidBar,
    lapsedBar,
    noTrialBar,
    words(colsX[3] + 24, sTop + (paidN * k) / 2 - 12, 220, `Paid · ${paidN.toLocaleString('en-US')}`, { size: 14, weight: 650, color: INK_STRONG }),
    words(colsX[3] + 24, sTop + paidN * k + 16 + (lapsed * k) / 2 - 12, 220, `Trial lapsed · ${lapsed.toLocaleString('en-US')}`, { size: 14, weight: 500, color: INK_SOFT }),
    words(colsX[3] + 24, sTop + trial * k + 40 + (noTrial * k) / 2 - 12, 220, `No trial · ${noTrial.toLocaleString('en-US')}`, { size: 14, weight: 500, color: INK_SOFT }),
    ...ribbons
  );

  // ---- Page 2: channels and credit ------------------------------------
  out.push(
    page(P2, 0, 'Channels and attribution', { icon: '🧭', description: 'Which channels bring paying customers, and how much credit each model gives them.' }),
    ...heading(P2, 'Channel mix and attribution', 'Organic search brings the most customers; lifecycle email looks twice as good under last touch as under first.'),
    head(colX(P2, 0), 208, 'Channels, Q3'),
    chSheet.node,
    head(colX(P2, 7), 208, 'Paid customers credited, by model'),
    attribution.node
  );
  const lowY = 256 + chSheet.height + 64;
  out.push(
    ...figure(colX(P2, 0), lowY, span(4), 1080 - 56 - lowY, 'Channel mix', 'Paid customers, linear attribution', {
      ...linked(chSheet, { cat: 0, series: [3] }, {
        ...base('donut'),
        series: [{ name: '', values: [] }],
        innerRadius: 0.62,
        showValues: true,
        valueFormat: 'percent',
        paletteId: 'editorial',
        legendPosition: 'right',
      } as ChartSpec)
    }),
    ...figure(colX(P2, 4), lowY, span(8), 1080 - 56 - lowY, 'Credit by attribution model', 'Same 1,026 customers, three ways of sharing the credit', {
      ...linked(attribution, { cat: 0, series: [1, 2, 3] }, {
        ...base('barHorizontal'),
        series: [
          { name: '', values: [], color: '#A5B4FC' },
          { name: '', values: [], color: C.indigo },
          { name: '', values: [], color: C.slate },
        ],
        sort: 'none',
        cornerRadius: 2,
        legendPosition: 'top',
        showValues: false,
      } as ChartSpec)
    })
  );

  return layer(out);
}

// ---------------------------------------------------------------------------
// 4. Enzyme kinetics notebook
// ---------------------------------------------------------------------------

/** Michaelis–Menten by Gauss–Newton on every replicate, with standard errors from (JᵀJ)⁻¹. */
function fitMichaelisMenten(s: number[], v: number[]) {
  let vmax = Math.max(...v);
  let km = s[Math.floor(s.length / 2)];
  for (let it = 0; it < 60; it += 1) {
    let a = 0;
    let b = 0;
    let c = 0;
    let g0 = 0;
    let g1 = 0;
    for (let i = 0; i < s.length; i += 1) {
      const d = km + s[i];
      const f = (vmax * s[i]) / d;
      const j0 = s[i] / d;
      const j1 = (-vmax * s[i]) / (d * d);
      const r = v[i] - f;
      a += j0 * j0;
      b += j0 * j1;
      c += j1 * j1;
      g0 += j0 * r;
      g1 += j1 * r;
    }
    const det = a * c - b * b;
    vmax += (c * g0 - b * g1) / det;
    km += (a * g1 - b * g0) / det;
  }
  let sse = 0;
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < s.length; i += 1) {
    const d = km + s[i];
    sse += (v[i] - (vmax * s[i]) / d) ** 2;
    const j0 = s[i] / d;
    const j1 = (-vmax * s[i]) / (d * d);
    a += j0 * j0;
    b += j0 * j1;
    c += j1 * j1;
  }
  const s2 = sse / (s.length - 2);
  const det = a * c - b * b;
  return { vmax, km, seVmax: Math.sqrt((s2 * c) / det), seKm: Math.sqrt((s2 * a) / det) };
}

function enzymeBoard(): NewNodeInput[] {
  const out: NewNodeInput[] = [];
  const P1 = pageX(0);
  const P2 = pageX(1);

  // ONPG hydrolysis by β-galactosidase: true Km 0.24 mM, Vmax 38.5 µM/min, 2 nM enzyme.
  const S = [0.025, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4];
  const rnd = seeded(4242);
  const truth = (s: number) => (38.5 * s) / (0.24 + s);
  const reps = S.map((s) => [0, 1, 2].map(() => round(truth(s) * (1 + rnd.normal(0, 0.035)) + rnd.normal(0, 0.25), 2)));
  const fit = fitMichaelisMenten(
    S.flatMap((s) => [s, s, s]),
    reps.flat()
  );
  const vmax = round(fit.vmax, 2);
  const km = round(fit.km, 3);
  const enzyme = 2; // nM
  const kcat = round((vmax / (enzyme / 1000)) / 60, 0); // per second
  const meanV = reps.map((r) => round(mean(r), 2));
  const model = S.map((s) => round((vmax * s) / (km + s), 2));

  const params = sheet(colX(P1, 8), 256, span(4), {
    title: 'Fit',
    columns: [
      { head: 'Parameter', width: 1.2, cells: ['Vmax (µM/min)', 'Km (mM)', 'kcat (s⁻¹)', 'kcat/Km (M⁻¹s⁻¹)'] },
      { head: 'Estimate', type: 'number', cells: [fmt(vmax, 2), fmt(km, 3), `=ROUND(B2/(${enzyme}/1000)/60,0)`, `=ROUND(B4/(B3/1000),0)`], style: COMPUTED },
      { head: '± SE', type: 'number', width: 0.8, cells: [fmt(fit.seVmax, 2), fmt(fit.seKm, 3), '', ''] },
    ],
    accent: C.teal,
    styles: { '1:1': { ...INPUT, bold: true }, '2:1': { ...INPUT, bold: true } },
  });

  const rates = sheet(colX(P1, 0), 256, span(8) - 16, {
    title: 'Initial rates',
    columns: [
      { head: '[S] mM', type: 'number', width: 0.9, cells: S.map(String), style: INPUT },
      { head: 'v₁', type: 'number', width: 0.8, cells: reps.map((r) => fmt(r[0], 2)), style: INPUT },
      { head: 'v₂', type: 'number', width: 0.8, cells: reps.map((r) => fmt(r[1], 2)), style: INPUT },
      { head: 'v₃', type: 'number', width: 0.8, cells: reps.map((r) => fmt(r[2], 2)), style: INPUT },
      { head: 'Mean v', type: 'number', cells: S.map((_, i) => `=ROUND(AVERAGE(B${i + 2}:D${i + 2}),2)`), values: meanV, style: COMPUTED },
      { head: 'SD', type: 'number', width: 0.7, cells: S.map((_, i) => `=ROUND(STDEV(B${i + 2}:D${i + 2}),2)`), style: COMPUTED },
      { head: '1/[S]', type: 'number', width: 0.8, cells: S.map((_, i) => `=ROUND(1/A${i + 2},2)`), style: COMPUTED },
      { head: '1/v', type: 'number', width: 0.8, cells: S.map((_, i) => `=ROUND(1/E${i + 2},4)`), style: COMPUTED },
      { head: 'Model v', type: 'number', cells: S.map((_, i) => `=ROUND(Fit!B2*A${i + 2}/(Fit!B3+A${i + 2}),2)`), values: model, style: COMPUTED },
      {
        head: 'Residual',
        type: 'number',
        cells: S.map((_, i) => `=ROUND(E${i + 2}-I${i + 2},2)`),
        values: meanV.map((m, i) => round(m - model[i], 2)),
        style: COMPUTED,
      },
    ],
    accent: C.teal,
    rules: [{ col: 9, when: '<0', color: '#9F1239' }],
  });

  out.push(
    page(P1, 0, 'Results', { icon: '🧫', description: 'β-galactosidase with ONPG, 37 °C, pH 7.0, triplicate initial rates.' }),
    ...heading(
      P1,
      'Enzyme kinetics · β-galactosidase and ONPG',
      `Nine substrate concentrations, three replicates each. Non-linear least squares gives Vmax = ${fmt(vmax, 1)} ± ${fmt(fit.seVmax, 1)} µM/min and Km = ${fmt(km, 3)} ± ${fmt(fit.seKm, 3)} mM.`
    ),
    head(colX(P1, 0), 208, 'Initial rates, µM/min'),
    rates.node,
    head(colX(P1, 8), 208, 'Fitted parameters'),
    params.node,
    formula(colX(P1, 8), 256 + params.height + 20, span(4), 'v = Vmax · [S] / (Km + [S])', 22),
    aside(colX(P1, 8), 256 + params.height + 60, span(4), `Edit Vmax or Km above and the model column, its residuals and the curve on the left all follow. kcat assumes ${enzyme} nM enzyme.`)
  );

  const fy = 256 + rates.height + 56;
  const fh = 1080 - 48 - fy;
  out.push(
    ...figure(colX(P1, 0), fy, span(4), fh, 'Measured against the model', 'Mean rate (bars) and fitted v (line); [S] doubles each step', {
      ...linked(rates, { cat: 0, series: [4, 8] }, {
        ...base('bar'),
        series: [
          { name: '', values: [], color: '#99F6E4' },
          { name: '', values: [], color: C.teal, mark: 'line' },
        ],
        xAxisLabel: '[S], mM',
        legendPosition: 'top',
        cornerRadius: 2,
      } as ChartSpec)
    }),
    // Parametric (x = t, y = v(t)) rather than a function plot: the function
    // sampler drops the steep first stretch of this curve, the part that
    // shows the rate rising from zero.
    ...figure(colX(P1, 4), fy, span(4), fh, 'Michaelis–Menten', `The fit on linear axes; the dashed line is Vmax = ${fmt(vmax, 1)} µM/min`, {
      ...base('parametric'),
      functions: [
        { source: 't', color: C.teal, width: 3 },
        { source: `${fmt(vmax, 2)}*t/(${fmt(km, 3)}+t)` },
      ],
      reference: { value: round(vmax, 2), label: 'Vmax', color: C.slate },
      xMin: 0,
      xMax: 6.6,
      yMin: 0,
      yMax: 44,
      samples: 300,
      equalAxes: false,
      showLegend: false,
      xAxisLabel: '[S], mM',
    } as ChartSpec),
    ...figure(colX(P1, 8), fy, span(4), fh, 'Lineweaver–Burk', `1/v against 1/[S]; the marked root is −1/Km = ${fmt(-1 / km, 2)} mM⁻¹`, {
      ...base('function'),
      functions: [{ source: `${fmt(km / vmax, 5)}*x+${fmt(1 / vmax, 5)}`, color: C.violet, width: 3 }],
      showRoots: true,
      xMin: -6,
      xMax: 42,
      yMin: -0.05,
      yMax: 0.32,
      equalAxes: false,
      showLegend: false,
      xAxisLabel: '1/[S], mM⁻¹',
      yAxisLabel: '1/v, min/µM',
    } as ChartSpec)
  );

  // ---- Page 2: methods ------------------------------------------------
  out.push(
    page(P2, 0, 'Methods and next steps', { icon: '📓', description: 'How the rates were measured and fitted, and what to run next.' }),
    ...heading(P2, 'Methods', 'Rates from the first 60 s of absorbance at 420 nm, where product formation is linear; ε(ONP) = 4.5 mM⁻¹ cm⁻¹.'),
    head(colX(P2, 0), 208, 'Protocol'),
    words(
      colX(P2, 0),
      248,
      span(5),
      '1.  Pre-warm 100 mM sodium phosphate, 1 mM MgCl₂, pH 7.0, to 37 °C.\n2.  Make ONPG from 12.8 mM by serial halving to 0.05 mM (2× the final concentration).\n3.  Start each well with enzyme to 2 nM; read A₄₂₀ every 5 s for 2 min.\n4.  Blank-correct, convert with ε = 4.5 mM⁻¹ cm⁻¹ and a 0.6 cm path.\n5.  Take the slope over 0–60 s as v; reject fits with R² < 0.98.',
      { size: 16, color: INK, lineHeight: 1.7 }
    ),
    head(colX(P2, 0), 480, 'Fitting'),
    aside(
      colX(P2, 0),
      520,
      span(5),
      'Fit the untransformed rates by non-linear least squares. The Lineweaver–Burk line is a diagnostic only: taking reciprocals multiplies the error on the slowest, least certain rates, and an ordinary straight-line fit there gives a biased Km.',
      16
    ),
    code(
      colX(P2, 6),
      208,
      [
        'import numpy as np',
        'from scipy.optimize import curve_fit',
        '',
        'S = np.repeat([0.025, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4], 3)  # mM',
        'v = np.loadtxt("rates_2025-10-06.csv", delimiter=",", usecols=1)  # µM/min',
        '',
        'def michaelis_menten(S, vmax, km):',
        '    return vmax * S / (km + S)',
        '',
        'popt, pcov = curve_fit(michaelis_menten, S, v, p0=[v.max(), np.median(S)])',
        'vmax, km = popt',
        'se_vmax, se_km = np.sqrt(np.diag(pcov))',
        '',
        'kcat = vmax / 2e-3 / 60          # 2 nM enzyme -> per second',
        'print(f"Vmax = {vmax:.2f} ± {se_vmax:.2f} µM/min")',
        'print(f"Km   = {km:.3f} ± {se_km:.3f} mM, kcat = {kcat:.0f} /s")',
      ].join('\n'),
      'python',
      span(6),
      392,
      { filename: 'fit_kinetics.py', theme: 'midnight', fontSize: 14, followBoard: false, highlights: [10] }
    )
  );
  const residualY = 640;
  out.push(
    ...figure(colX(P2, 6), residualY, span(6), 1080 - 48 - residualY, 'Residuals', 'Mean rate minus model at each [S], µM/min: no pattern left to explain', {
      ...linked(rates, { cat: 0, series: [9] }, {
        ...base('bar'),
        series: [{ name: '', values: [], color: C.slate }],
        reference: { value: 0, label: '' },
        showLegend: false,
        cornerRadius: 2,
        xAxisLabel: '[S], mM',
      } as ChartSpec)
    }),
    note(colX(P2, 0), 680, '[x] Blank-corrected at 420 nm\n[x] Linear range checked, 0–60 s\n[x] Triplicates within 5% CV\n[ ] Repeat at pH 6.0\n[ ] Galactose inhibition series', 'white', {
      w: 340,
      h: 300,
      fontSize: 18,
      checklist: true,
    }),
    note(colX(P2, 0) + 372, 680, `Km of ${fmt(km, 2)} mM sits inside the published 0.2–0.3 mM range. Next: does galactose raise the apparent Km (competitive)?`, 'mint', {
      w: 300,
      h: 300,
      fontSize: 19,
      stamps: { '⭐': ['dr-okafor'], '👍': ['lin', 'sam'] },
    })
  );

  return layer(out);
}

// ---------------------------------------------------------------------------
// 5. Distributions explorer
// ---------------------------------------------------------------------------

function distributionsBoard(): NewNodeInput[] {
  const out: NewNodeInput[] = [];
  const P1 = pageX(0);
  const P2 = pageX(1);
  const N = 500;
  const rnd = seeded(1729);

  const normal = Array.from({ length: N }, () => round(rnd.normal(0, 1), 3));
  const logNormal = Array.from({ length: N }, () => round(Math.exp(rnd.normal(0, 0.5)), 3));
  const expo = Array.from({ length: N }, () => round(rnd.exponential(1.5), 3));
  const pois = Array.from({ length: N }, () => rnd.poisson(4));
  const binom = Array.from({ length: N }, () => rnd.binomial(20, 0.3));

  const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
  const choose = (n: number, k: number) => fact(n) / (fact(k) * fact(n - k));
  const poisPmf = (k: number) => (Math.exp(-4) * 4 ** k) / fact(k);
  const binomPmf = (k: number) => choose(20, k) * 0.3 ** k * 0.7 ** (20 - k);
  const counts = (xs: number[], k: number) => xs.filter((v) => v === k).length;

  const ls2 = 0.25; // σ² of the log-normal's log
  const lnMean = Math.exp(ls2 / 2);
  const lnSd = Math.sqrt((Math.exp(ls2) - 1) * Math.exp(ls2));

  type Dist = {
    name: string;
    params: string;
    eq: string;
    use: string;
    top: ChartSpec;
    bottom: ChartSpec;
    bottomTitle: string;
    theory: [number, number, number];
    sample: number[];
    color: string;
  };
  const fn = (source: string, a: number, b: number, lo: number, hi: number, top: number, color: string): ChartSpec =>
    ({
      ...base('function'),
      functions: [{ source, color, width: 3 }],
      xMin: lo,
      xMax: hi,
      yMin: 0,
      yMax: top,
      fillArea: true,
      integralBounds: { a, b },
      equalAxes: false,
      showLegend: false,
    }) as ChartSpec;
  const hist = (values: number[], color: string, buckets: number): ChartSpec =>
    ({
      ...base('histogram'),
      categories: [],
      series: [{ name: 'Draws', values, color }],
      buckets,
      labelEvery: 3,
      showLegend: false,
    }) as ChartSpec;
  const pmf = (ks: number[], f: (k: number) => number, draws: number[], color: string): ChartSpec =>
    ({
      ...base('bar'),
      categories: ks.map(String),
      series: [
        { name: 'Expected', values: ks.map((k) => round(f(k) * N, 1)), color: '#CBD5E1' },
        { name: 'Drawn', values: ks.map((k) => counts(draws, k)), color },
      ],
      cornerRadius: 1,
      legendPosition: 'top',
    }) as ChartSpec;
  const dists: Dist[] = [
    {
      name: 'Normal',
      params: 'μ = 0, σ = 1',
      eq: 'f(x) = e^(−x²/2) / √(2π)',
      use: 'Measurement error; sums of many small effects.',
      top: fn('gauss(x)', -1, 1, -4, 4, 0.45, C.indigo),
      bottom: hist(normal, C.indigo, 12),
      bottomTitle: `${N} seeded draws`,
      theory: [0, 1, 0],
      sample: normal,
      color: C.indigo,
    },
    {
      name: 'Log-normal',
      params: 'μ = 0, σ = 0.5 (of ln x)',
      eq: 'f(x) = e^(−(ln x)²/0.5) / (0.5x√(2π))',
      use: 'Incomes, file sizes, response times.',
      top: fn('exp(-(ln(x))^2/0.5)/(0.5*x*sqrt(2pi))', round(lnMean - lnSd, 3), round(lnMean + lnSd, 3), 0.01, 4, 0.9, C.teal),
      bottom: hist(logNormal, C.teal, 12),
      bottomTitle: `${N} seeded draws`,
      theory: [lnMean, lnSd, (Math.exp(ls2) + 2) * Math.sqrt(Math.exp(ls2) - 1)],
      sample: logNormal,
      color: C.teal,
    },
    {
      name: 'Exponential',
      params: 'λ = 1.5',
      eq: 'f(x) = 1.5 e^(−1.5x)',
      use: 'Time between independent arrivals.',
      top: fn('1.5*exp(-1.5x)', 0, round(2 / 1.5, 3), 0, 4, 1.6, C.amber),
      bottom: hist(expo, C.amber, 12),
      bottomTitle: `${N} seeded draws`,
      theory: [1 / 1.5, 1 / 1.5, 2],
      sample: expo,
      color: C.amber,
    },
    {
      name: 'Poisson',
      params: 'λ = 4',
      eq: 'P(k) = 4ᵏ e^(−4) / k!',
      use: 'Counts per interval: calls, decays, typos.',
      top: { ...base('bar'), categories: Array.from({ length: 13 }, (_, k) => String(k)), series: [{ name: 'P(k)', values: Array.from({ length: 13 }, (_, k) => round(poisPmf(k), 4)), color: C.rose }], showLegend: false, cornerRadius: 1, decimals: 2 } as ChartSpec,
      bottom: pmf(Array.from({ length: 13 }, (_, k) => k), poisPmf, pois, C.rose),
      bottomTitle: `Expected against drawn, ${N} draws`,
      theory: [4, 2, 0.5],
      sample: pois,
      color: C.rose,
    },
    {
      name: 'Binomial',
      params: 'n = 20, p = 0.3',
      eq: 'P(k) = C(20, k) 0.3ᵏ 0.7²⁰⁻ᵏ',
      use: 'Successes in a fixed number of trials.',
      top: { ...base('bar'), categories: Array.from({ length: 15 }, (_, k) => String(k)), series: [{ name: 'P(k)', values: Array.from({ length: 15 }, (_, k) => round(binomPmf(k), 4)), color: C.violet }], showLegend: false, cornerRadius: 1, decimals: 2 } as ChartSpec,
      bottom: pmf(Array.from({ length: 15 }, (_, k) => k), binomPmf, binom, C.violet),
      bottomTitle: `Expected against drawn, ${N} draws`,
      theory: [6, Math.sqrt(20 * 0.3 * 0.7), 0.4 / Math.sqrt(4.2)],
      sample: binom,
      color: C.violet,
    },
  ];

  out.push(
    page(P1, 0, 'Five distributions', { icon: '🎲', description: 'Exact densities above, seeded simulated draws below; the shaded band is μ ± σ.' }),
    ...heading(P1, 'Distributions explorer', 'Each column pairs the exact density with 500 seeded draws from it. On the curves, the shaded band runs from μ − σ to μ + σ and its area is printed.')
  );
  const cw = (PAGE_W - 2 * MARGIN - 4 * GUTTER) / 5;
  dists.forEach((d, i) => {
    const x = P1 + MARGIN + i * (cw + GUTTER);
    out.push(
      words(x, 208, cw, d.name, { size: 22, weight: 700, color: INK_STRONG, lineHeight: 1.25 }),
      words(x, 240, cw, d.params, { size: 14, weight: 550, color: DEEP[d.color] ?? INK, lineHeight: 1.35 }),
      words(x, 266, cw, d.eq, { size: 16, weight: 500, color: INK, italic: true, fontFamily: MATHS, lineHeight: 1.35 }),
      words(x, 296, cw, d.use, { size: 13, color: INK_SOFT, lineHeight: 1.4 }),
      chartAt(x, 336, cw, 260, d.top),
      words(x, 620, cw, d.bottomTitle, { size: 14, weight: 600, color: INK, lineHeight: 1.35 }),
      chartAt(x, 648, cw, 248, d.bottom)
    );
  });

  // The summary, theory beside the sample, with the sample columns as formulas over nothing hidden.
  const statsRows = dists.map((d) => [d.name, d.params, fmt(d.theory[0], 3), fmt(mean(d.sample), 3), fmt(d.theory[1], 3), fmt(stdev(d.sample), 3), fmt(d.theory[2], 2)]);
  const stats = sheet(colX(P1, 0), 920, span(12), {
    title: 'Summary statistics',
    columns: [
      { head: 'Distribution', width: 1.1, cells: statsRows.map((r) => r[0]) },
      { head: 'Parameters', width: 1.5, cells: statsRows.map((r) => r[1]) },
      { head: 'Mean, theory', type: 'number', cells: statsRows.map((r) => r[2]) },
      { head: `Mean, ${N} draws`, type: 'number', cells: statsRows.map((r) => r[3]), style: COMPUTED },
      { head: 'σ, theory', type: 'number', cells: statsRows.map((r) => r[4]) },
      { head: `σ, ${N} draws`, type: 'number', cells: statsRows.map((r) => r[5]), style: COMPUTED },
      { head: 'Skewness', type: 'number', width: 0.8, cells: statsRows.map((r) => r[6]) },
    ],
    accent: C.indigo,
    fontSize: 12,
    rowH: 22,
  });
  out.push(stats.node);

  // ---- Page 2: the central limit theorem, simulated -------------------
  out.push(
    page(P2, 0, 'Central limit theorem', { icon: '🔔', description: 'Means of exponential draws, n = 1, 2, 5 and 30, 1,000 times each.' }),
    ...heading(P2, 'Averages forget where they came from', 'Draw n values from the skewed exponential on the first page, average them, repeat 1,000 times. As n grows the averages pile into a bell around 0.667, narrowing as σ/√n.')
  );
  const ns = [1, 2, 5, 30];
  out.push(
    ...key(colX(P2, 0), 168, [
      ['Means of n draws, per 0.1', '#FBBF24'],
      ['Normal the theorem predicts', INK_STRONG],
    ])
  );
  const clt = seeded(31415);
  // One set of bins for all four, so the narrowing is read straight across.
  const width = 0.1;
  const bins = Array.from({ length: 25 }, (_, b) => round(b * width, 1));
  const mu = 1 / 1.5;
  ns.forEach((n, i) => {
    const means = Array.from({ length: 1000 }, () => {
      let s0 = 0;
      for (let j = 0; j < n; j += 1) s0 += clt.exponential(1.5);
      return s0 / n;
    });
    const sd = mu / Math.sqrt(n);
    const counts = bins.map((lo) => means.filter((m) => m >= lo && m < lo + width).length);
    const predicted = bins.map((lo) => {
      const c = lo + width / 2;
      return round((1000 * width * Math.exp(-(((c - mu) / sd) ** 2) / 2)) / (sd * Math.sqrt(2 * Math.PI)), 1);
    });
    const x = colX(P2, i * 3);
    out.push(
      ...figure(x, 216, span(3), 560, `n = ${n}`, `σ/√n = ${fmt(sd, 3)} · sample σ = ${fmt(stdev(means), 3)}`, {
        ...base('bar'),
        categories: bins.map((b) => fmt(b, 1)),
        series: [
          { name: 'Means', values: counts, color: i === 3 ? C.indigo : '#FBBF24' },
          { name: 'Normal prediction', values: predicted, color: INK_STRONG, mark: 'line' },
        ],
        labelEvery: 5,
        showLegend: false,
        labelAngle: 0,
        yMax: 360,
        markerShape: 'none',
      } as ChartSpec)
    );
  });
  out.push(
    formula(colX(P2, 0), 832, span(12), 'X̄ₙ = (X₁ + … + Xₙ) / n   →   N(μ, σ² / n)   as n → ∞', 30, 'center'),
    aside(
      colX(P2, 2),
      900,
      span(8),
      'Bars count the thousand means in steps of 0.1; the line is the normal the theorem predicts for that n. At n = 1 it is plainly wrong; by n = 30 it is hard to tell apart. Every draw comes from a fixed seed, so this board and its preview agree.',
      16
    )
  );
  return layer(out);
}

// ---------------------------------------------------------------------------
// 6. Waves and Fourier series
// ---------------------------------------------------------------------------

function fourierBoard(): NewNodeInput[] {
  const out: NewNodeInput[] = [];
  const odd = (n: number) => Array.from({ length: Math.ceil(n / 2) }, (_, i) => 2 * i + 1);
  const partial = (n: number) => `4/pi*(${odd(n).map((k) => (k === 1 ? 'sin(x)' : `sin(${k}x)/${k}`)).join('+')})`;
  const W = span(6);
  const H = 400;
  const panels = (x0: number, hand: boolean) => {
    const sketch = hand ? ('medium' as const) : undefined;
    const items: Array<[number, number, string, string, ChartSpec, string]> = [
      [
        colX(x0, 0),
        208,
        'A square wave from sines',
        'Partial sums up to the 1st, 3rd, 5th and 15th harmonic',
        {
          ...base('function'),
          functions: [
            { source: partial(1), color: '#A5B4FC', width: 2 },
            { source: partial(3), color: '#818CF8', width: 2 },
            { source: partial(5), color: C.indigo, width: 2 },
            { source: partial(15), color: '#312E81', width: 2.5 },
          ],
          // One period, up to the 15th harmonic: the adaptive sampler's work grows
          // fast with every term and every extra period, and this already shows
          // the Gibbs overshoot settling in.
          xMin: 0,
          xMax: 2 * Math.PI,
          yMin: -1.5,
          yMax: 1.5,
          samples: 200,
          equalAxes: false,
          showLegend: false,
            } as ChartSpec,
        'f(x) = (4/π) Σ sin(kx)/k,  k = 1, 3, 5, …',
      ],
      [
        colX(x0, 6),
        208,
        'Modes of a vibrating string',
        'sin x, sin 2x and sin 3x: the first three standing waves',
        {
          ...base('function'),
          functions: [
            { source: 'sin(x)', color: C.teal, width: 3 },
            { source: 'sin(2x)', color: C.sky, width: 2.5 },
            { source: 'sin(3x)', color: C.violet, width: 2 },
          ],
          xMin: 0,
          xMax: Math.PI,
          yMin: -1.3,
          yMax: 1.3,
          equalAxes: false,
          showLegend: false,
          showRoots: false,
            } as ChartSpec,
        'yₙ(x) = sin(nx),  0 ≤ x ≤ π,  fixed at both ends',
      ],
      [
        colX(x0, 0),
        640,
        'Two waves, beating',
        'sin 6x + sin 7x inside its envelope ±2 cos(x/2)',
        {
          ...base('function'),
          functions: [
            { source: 'sin(6x)+sin(7x)', color: C.rose, width: 2 },
            { source: '2cos(x/2)', color: C.slate, style: 'dashed', width: 1.5 },
            { source: '-2cos(x/2)', color: C.slate, style: 'dashed', width: 1.5 },
          ],
          xMin: 0,
          xMax: 4 * Math.PI,
          yMin: -2.4,
          yMax: 2.4,
          samples: 400,
          equalAxes: false,
          showLegend: false,
            } as ChartSpec,
        'sin a + sin b = 2 sin((a+b)/2) cos((a−b)/2)',
      ],
      [
        colX(x0, 6),
        640,
        'The square wave’s spectrum',
        'Amplitude of each harmonic: 4/(nπ) for odd n, zero for even',
        {
          ...base('bar'),
          categories: Array.from({ length: 25 }, (_, i) => String(i + 1)),
          series: [{ name: 'Amplitude', values: Array.from({ length: 25 }, (_, i) => ((i + 1) % 2 ? round(4 / ((i + 1) * Math.PI), 4) : 0)), color: C.indigo }],
          showLegend: false,
          cornerRadius: 1,
          decimals: 2,
          xAxisLabel: 'Harmonic n',
        } as ChartSpec,
        'bₙ = 4/(nπ) for odd n',
      ],
    ];
    for (const [x, y, t, s, spec, eq] of items) {
      out.push(...figure(x, y, W, H - 48, t, s, spec, { sketch, hand }));
      out.push(
        words(x, y + H - 40, W, eq, hand ? { size: 22, color: INK, fontFamily: 'Caveat' } : { size: 17, weight: 500, color: INK, italic: true, fontFamily: MATHS })
      );
    }
  };

  const P1 = pageX(0);
  const P2 = pageX(1);
  out.push(
    page(P1, 0, 'Presentation', { icon: '📊', description: 'Exact plots, ready for a lecture slide.' }),
    pageTitle(colX(P1, 0), 64, 'Waves and Fourier series'),
    lede(colX(P1, 0), 124, 'Any periodic signal is a sum of sines. Every curve here is a live formula: open one and change a coefficient.', span(11))
  );
  panels(P1, false);
  out.push(
    page(P2, 0, 'Whiteboard', { icon: '🖍️', description: 'The same four plots, hand-drawn for teaching.' }),
    words(colX(P2, 0), 56, span(10), 'Waves & Fourier, by hand', { size: 56, weight: 700, color: INK_STRONG, fontFamily: 'Caveat', lineHeight: 1.1 }),
    words(colX(P2, 0), 124, span(9), 'Same formulas, sketch mode on. Nothing moved: compare any curve with its twin.', { size: 26, color: INK_SOFT, fontFamily: 'Caveat', lineHeight: 1.2 }),
    note(colX(P2, 9), 40, 'Gibbs: add as many terms as you like, the overshoot settles at about 9% of the jump, a peak near 1.18.', 'yellow', {
      w: span(3),
      h: 152,
      fontSize: 20,
      stamps: { '🔥': ['ms-ito'] },
    })
  );
  panels(P2, true);
  return layer(out);
}

// ---------------------------------------------------------------------------
// 7. Mathematical curves gallery
// ---------------------------------------------------------------------------

const PHI = (1 + Math.sqrt(5)) / 2;

/** Sample a parametric curve. */
const trace = (f: (t: number) => Pt, t0: number, t1: number, n: number): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => f(t0 + ((t1 - t0) * i) / n));

/** Fit maths-space points into a box, y up, aspect kept, centred. */
function fitInto(points: Pt[], x: number, y: number, w: number, h: number): Pt[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1));
  const ox = x + (w - (maxX - minX) * s) / 2;
  const oy = y + (h - (maxY - minY) * s) / 2;
  return points.map((p) => ({ x: ox + (p.x - minX) * s, y: oy + (maxY - p.y) * s }));
}

/** The golden rectangle, cut into squares, with the quarter-circle spiral through them. */
function goldenSpiral(x: number, y: number, w: number, h: number, color: string): NewNodeInput[] {
  let rh = Math.min(h, w / PHI);
  let rw = rh * PHI;
  let rx = x + (w - rw) / 2;
  let ry = y + (h - rh) / 2;
  const out: NewNodeInput[] = [polyline([{ x: rx, y: ry }, { x: rx + rw, y: ry }, { x: rx + rw, y: ry + rh }, { x: rx, y: ry + rh }], { color: RULE, width: 1.25, closed: true })];
  const arc: Pt[] = [];
  const quarter = (cx: number, cy: number, r: number, a0: number) => {
    for (let i = 0; i <= 24; i += 1) {
      const a = a0 + (Math.PI / 2) * (i / 24);
      arc.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  };
  for (let step = 0; step < 9; step += 1) {
    const dir = step % 4;
    if (dir === 0) {
      const s = rh;
      out.push(polyline([{ x: rx + s, y: ry }, { x: rx + s, y: ry + s }], { color: RULE, width: 1.25 }));
      quarter(rx + s, ry + s, s, Math.PI);
      rx += s;
      rw -= s;
    } else if (dir === 1) {
      const s = rw;
      out.push(polyline([{ x: rx, y: ry + s }, { x: rx + s, y: ry + s }], { color: RULE, width: 1.25 }));
      quarter(rx, ry + s, s, 1.5 * Math.PI);
      ry += s;
      rh -= s;
    } else if (dir === 2) {
      const s = rh;
      out.push(polyline([{ x: rx + rw - s, y: ry }, { x: rx + rw - s, y: ry + s }], { color: RULE, width: 1.25 }));
      quarter(rx + rw - s, ry, s, 0);
      rw -= s;
    } else {
      const s = rw;
      out.push(polyline([{ x: rx, y: ry + rh - s }, { x: rx + s, y: ry + rh - s }], { color: RULE, width: 1.25 }));
      quarter(rx + rw, ry + rh - s, s, 0.5 * Math.PI);
      rh -= s;
    }
  }
  out.push(polyline(arc, { color, width: 3 }));
  return out;
}

/** The Lorenz system by fourth-order Runge–Kutta, kept in scalars: this runs on every build. */
function lorenz(): Pt[] {
  const sigma = 10;
  const rho = 28;
  const beta = 8 / 3;
  const dt = 0.006;
  const f = (x: number, y: number, z: number) => [sigma * (y - x), x * (rho - z) - y, x * y - beta * z] as const;
  let x = 1;
  let y = 1;
  let z = 1;
  const pts: Pt[] = [];
  for (let i = 0; i < 4800; i += 1) {
    const [ax, ay, az] = f(x, y, z);
    const [bx, by, bz] = f(x + (dt / 2) * ax, y + (dt / 2) * ay, z + (dt / 2) * az);
    const [cx, cy, cz] = f(x + (dt / 2) * bx, y + (dt / 2) * by, z + (dt / 2) * bz);
    const [ex, ey, ez] = f(x + dt * cx, y + dt * cy, z + dt * cz);
    x += (dt / 6) * (ax + 2 * bx + 2 * cx + ex);
    y += (dt / 6) * (ay + 2 * by + 2 * cy + ey);
    z += (dt / 6) * (az + 2 * bz + 2 * cz + ez);
    if (i > 200 && i % 2 === 0) pts.push({ x, y: z });
  }
  return pts;
}

function curvesBoard(): NewNodeInput[] {
  const out: NewNodeInput[] = [];
  const P1 = pageX(0);
  const P2 = pageX(1);
  const polar = (r: (a: number) => number) => (a: number) => ({ x: r(a) * Math.cos(a), y: r(a) * Math.sin(a) });
  type Card = { name: string; eq: string; note: string; color: string; points?: Pt[]; closed?: boolean; golden?: true };
  const cards: Card[] = [
    {
      name: 'Lissajous figure',
      eq: 'x = sin(3t + π/2),  y = sin 2t',
      note: 'Two perpendicular oscillations at 3 : 2.',
      color: C.indigo,
      points: trace((t) => ({ x: Math.sin(3 * t + Math.PI / 2), y: Math.sin(2 * t) }), 0, 2 * Math.PI, 600),
      closed: true,
    },
    {
      name: 'Rose',
      eq: 'r = cos 4θ',
      note: 'An even k gives 2k petals: eight here.',
      color: C.rose,
      points: trace(polar((a) => Math.cos(4 * a)), 0, 2 * Math.PI, 480),
      closed: true,
    },
    {
      name: 'Cardioid',
      eq: 'r = 1 + cos θ',
      note: 'Traced by a point on a circle rolling round an equal one.',
      color: C.amber,
      points: trace(polar((a) => 1 + Math.cos(a)), 0, 2 * Math.PI, 400),
      closed: true,
    },
    {
      name: 'Golden spiral',
      eq: 'r = φ^(2θ/π),  φ = (1 + √5)/2',
      note: 'Quarter-circle arcs through the squares trace it closely.',
      color: C.teal,
      golden: true,
    },
    {
      name: 'Butterfly curve',
      eq: 'r = e^(sin θ) − 2 cos 4θ + sin⁵((2θ − π)/24)',
      note: 'Temple Fay, 1989; θ from 0 to 12π.',
      color: C.violet,
      points: trace(
        polar((a) => Math.exp(Math.sin(a)) - 2 * Math.cos(4 * a) + Math.sin((2 * a - Math.PI) / 24) ** 5),
        0,
        12 * Math.PI,
        1600
      ),
    },
    {
      name: 'Heart',
      eq: 'x = 16 sin³t,  y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t',
      note: 'A parametric heart; t from 0 to 2π.',
      color: C.pink,
      points: trace(
        (t) => ({ x: 16 * Math.sin(t) ** 3, y: 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) }),
        0,
        2 * Math.PI,
        400
      ),
      closed: true,
    },
    {
      name: 'Lorenz attractor',
      eq: 'ẋ = σ(y − x),  ẏ = x(ρ − z) − y,  ż = xy − βz',
      note: 'σ = 10, ρ = 28, β = 8/3; RK4, seen down the y axis.',
      color: C.sky,
      points: lorenz(),
    },
    {
      name: 'Hypotrochoid',
      eq: 'x = 2 cos t + 5 cos(2t/3),  y = 2 sin t − 5 sin(2t/3)',
      note: 'A spirograph: R = 5, r = 3, d = 5.',
      color: C.green,
      points: trace((t) => ({ x: 2 * Math.cos(t) + 5 * Math.cos((2 * t) / 3), y: 2 * Math.sin(t) - 5 * Math.sin((2 * t) / 3) }), 0, 6 * Math.PI, 600),
      closed: true,
    },
  ];

  out.push(
    page(P1, 0, 'Curves gallery', { icon: '🌀', description: 'Eight curves, each drawn exactly from its equation as an editable path.' }),
    ...heading(P1, 'A gallery of mathematical curves', 'Each curve is a pen path sampled from its equation: select one to restyle it, or open the next page to edit the formula live.')
  );
  const cw = span(3);
  const ch = 404;
  cards.forEach((c, i) => {
    const x = colX(P1, (i % 4) * 3);
    const y = 200 + Math.floor(i / 4) * (ch + 24);
    out.push(slab(x, y, cw, ch, PAPER_SOFT, { stroke: HAIRLINE, strokeWidth: 1 }));
    const art = { x: x + 32, y: y + 24, w: cw - 64, h: 236 };
    if (c.golden) out.push(...goldenSpiral(art.x, art.y, art.w, art.h, c.color));
    else out.push(polyline(fitInto(c.points!, art.x, art.y, art.w, art.h), { color: c.color, width: c.name === 'Lorenz attractor' ? 1.25 : 2.5, closed: c.closed }));
    out.push(
      words(x + 24, y + 280, cw - 48, c.name, { size: 19, weight: 700, color: INK_STRONG, lineHeight: 1.25 }),
      words(x + 24, y + 308, cw - 48, c.eq, { size: 15, weight: 500, color: INK, italic: true, fontFamily: MATHS, lineHeight: 1.35 }),
      words(x + 24, y + 356, cw - 48, c.note, { size: 13, color: INK_SOFT, lineHeight: 1.4 })
    );
  });

  // ---- Page 2: the same curves as live plots --------------------------
  out.push(
    page(P2, 0, 'Live formulas', { icon: '✏️', description: 'Four of the curves as plots whose equations you can edit.' }),
    ...heading(P2, 'Change the numbers, watch the curve', 'These are plot objects, not drawings. Select one and edit its formula: try cos(5θ) for the rose, or 5 : 4 for the Lissajous.')
  );
  const live: Array<[string, string, ChartSpec]> = [
    ['Lissajous, parametric', 'x(t) = sin(3t + π/2), y(t) = sin(2t)', { ...base('parametric'), functions: [{ source: 'sin(3t+pi/2)', color: C.indigo, width: 3 }, { source: 'sin(2t)' }], xMin: 0, xMax: 2 * Math.PI, samples: 300 } as ChartSpec],
    ['Rose, polar', 'r(θ) = cos(4θ)', { ...base('polarPlot'), functions: [{ source: 'cos(4a)', color: C.rose, width: 3 }], xMin: 0, xMax: 2 * Math.PI, samples: 360 } as ChartSpec],
    ['Cardioid, polar', 'r(θ) = 1 + cos θ', { ...base('polarPlot'), functions: [{ source: '1+cos(a)', color: C.amber, width: 3 }], xMin: 0, xMax: 2 * Math.PI, samples: 240 } as ChartSpec],
    ['Butterfly, polar', 'r(θ) = e^(sin θ) − 2cos 4θ + sin⁵((2θ − π)/24)', { ...base('polarPlot'), functions: [{ source: 'exp(sin(a))-2cos(4a)+sin((2a-pi)/24)^5', color: C.violet, width: 2 }], xMin: 0, xMax: 12 * Math.PI, samples: 600 } as ChartSpec],
  ];
  live.forEach(([t, s, spec], i) => {
    out.push(...figure(colX(P2, i * 3), 216, span(3), 600, t, s, { ...spec, showLegend: false }));
  });
  out.push(
    head(colX(P2, 0), 856, 'Reading a polar plot'),
    aside(
      colX(P2, 0),
      896,
      span(6) - 32,
      'θ runs anticlockwise from the positive x axis and r is the distance from the origin. Where r goes negative the point is drawn on the opposite ray, which is how cos 4θ makes eight petals rather than four.',
      16
    ),
    head(colX(P2, 6), 856, 'Reading a parametric plot'),
    aside(
      colX(P2, 6),
      896,
      span(6),
      'x and y are both functions of a third variable t. The first formula is x(t) and the second is y(t); the domain sets how far t runs. A ratio of whole numbers closes the figure.',
      16
    )
  );
  return layer(out);
}

// ---------------------------------------------------------------------------
// 8. Scatter, regression and density
// ---------------------------------------------------------------------------

/** Points on the scatter at full size: the board's object count rests on it. */
const SCATTER_N = 300;

function regressionBoard(limit?: number): NewNodeInput[] {
  const out: NewNodeInput[] = [];
  const P1 = pageX(0);
  const P2 = pageX(1);
  const rnd = seeded(1490);
  // Height and arm span in adults: span ≈ height, the Vitruvian square.
  const hgt: number[] = [];
  const arm: number[] = [];
  for (let i = 0; i < SCATTER_N; i += 1) {
    const h = rnd.normal(170, 9.5);
    hgt.push(round(h, 1));
    arm.push(round(1.03 * h - 4.6 + rnd.normal(0, 4.2), 1));
  }
  const fit = regress(hgt, arm);
  const shown = limit ? Math.max(24, Math.min(SCATTER_N, Math.floor(limit / 4))) : SCATTER_N;

  out.push(
    page(P1, 0, 'Scatter and fit', { icon: '📐', description: `${SCATTER_N} adults, height against arm span, with the least-squares line.` }),
    ...heading(
      P1,
      'Height against arm span',
      `${SCATTER_N} simulated adults. Arm span rises ${fmt(fit.slope, 2)} cm for every centimetre of height, and height explains ${fmt(fit.r2 * 100, 0)}% of its variation.`
    )
  );

  // The scatter, on measured axes.
  const ax = axes(colX(P1, 0) + 72, 248, span(7) - 72, 712, {
    x: [140, 200],
    y: [135, 210],
    xTicks: [140, 150, 160, 170, 180, 190, 200],
    yTicks: [140, 150, 160, 170, 180, 190, 200, 210],
    xLabel: 'Height (cm)',
    yLabel: 'Arm span (cm)',
  });
  out.push(...ax.nodes);
  const lineAt = (x: number) => fit.intercept + fit.slope * x;
  const band = 1.96 * fit.se;
  // A band edge clipped to the plot's y range, so nothing is drawn under the axis.
  const edge = (offset: number) => {
    const xAt = (yv: number) => (yv - offset - fit.intercept) / fit.slope;
    const x0 = Math.max(140, Math.min(xAt(135), xAt(210)));
    const x1 = Math.min(200, Math.max(xAt(135), xAt(210)));
    return rule({ x: ax.sx(x0), y: ax.sy(lineAt(x0) + offset) }, { x: ax.sx(x1), y: ax.sy(lineAt(x1) + offset) }, '#A5B4FC', 1.5, [8, 6]);
  };
  out.push(edge(band), edge(-band));
  for (let i = 0; i < shown; i += 1) out.push(dot(ax.sx(hgt[i]), ax.sy(arm[i]), 4.5, C.indigo, { opacity: 0.5 }));
  out.push(polyline([{ x: ax.sx(140), y: ax.sy(lineAt(140)) }, { x: ax.sx(200), y: ax.sy(lineAt(200)) }], { color: C.rose, width: 3 }));
  out.push(
    slab(ax.sx(142), ax.sy(207.5), 300, 92, '#FFFFFF', { stroke: HAIRLINE, strokeWidth: 1 }),
    words(ax.sx(142) + 16, ax.sy(207.5) + 14, 270, `ŷ = ${fmt(fit.slope, 3)}x ${fit.intercept < 0 ? '−' : '+'} ${fmt(Math.abs(fit.intercept), 1)}`, { size: 18, weight: 500, color: DEEP[C.rose], italic: true, fontFamily: MATHS }),
    words(ax.sx(142) + 16, ax.sy(207.5) + 50, 270, `R² = ${fmt(fit.r2, 3)} · dashed: 95% prediction`, { size: 14, color: INK_SOFT })
  );

  // A hexbin of the same points: density where the scatter saturates.
  const hx = colX(P1, 8);
  const hw = span(4);
  out.push(head(hx, 208, 'Where the points crowd'), words(hx, 238, hw, 'The same 300 points, binned into hexagons: darker holds more.', { size: 14 }));
  const hax = axes(hx + 56, 300, hw - 56, 380, {
    x: [140, 200],
    y: [135, 210],
    xTicks: [150, 170, 190],
    yTicks: [140, 160, 180, 200],
    grid: false,
    xLabel: 'Height (cm)',
  });
  const R = 15; // hexagon radius in board units, pointy-top
  const dx = Math.sqrt(3) * R;
  const dy = 1.5 * R;
  const bins = new Map<string, { cx: number; cy: number; n: number }>();
  for (let i = 0; i < SCATTER_N; i += 1) {
    const px = hax.sx(hgt[i]);
    const py = hax.sy(arm[i]);
    const row = Math.round((py - 300) / dy);
    const off = row % 2 ? dx / 2 : 0;
    const col = Math.round((px - (hx + 56) - off) / dx);
    // Check the two nearest rows for the true nearest centre.
    let best = { r: row, c: col, d: Infinity };
    for (const r of [row - 1, row, row + 1]) {
      const o = ((r % 2) + 2) % 2 ? dx / 2 : 0;
      const c = Math.round((px - (hx + 56) - o) / dx);
      const cx = hx + 56 + o + c * dx;
      const cy = 300 + r * dy;
      const d = (px - cx) ** 2 + (py - cy) ** 2;
      if (d < best.d) best = { r, c, d };
    }
    const key2 = `${best.r}:${best.c}`;
    const o = ((best.r % 2) + 2) % 2 ? dx / 2 : 0;
    const b = bins.get(key2) ?? { cx: hx + 56 + o + best.c * dx, cy: 300 + best.r * dy, n: 0 };
    b.n += 1;
    bins.set(key2, b);
  }
  const maxN = Math.max(...[...bins.values()].map((b) => b.n));
  const ramp = ['#E0E7FF', '#C7D2FE', '#A5B4FC', '#818CF8', '#6366F1', '#4F46E5', '#3730A3'];
  out.push(...hax.nodes);
  for (const b of bins.values()) {
    const shade = ramp[Math.min(ramp.length - 1, Math.floor(((b.n - 1) / maxN) * ramp.length))];
    const pts = Array.from({ length: 6 }, (_, j) => {
      const a = Math.PI / 6 + (j * Math.PI) / 3;
      return { x: b.cx + (R - 0.75) * Math.cos(a), y: b.cy + (R - 0.75) * Math.sin(a) };
    });
    out.push(polyline(pts, { color: shade, width: 1, closed: true, fill: shade }));
  }
  out.push(
    ...key(hx, 764, [
      ['1–2', ramp[1]],
      ['3–5', ramp[3]],
      [`6–${maxN}`, ramp[6]],
    ], 20),
    words(hx, 794, hw, 'Points per hexagon', { size: 13, color: INK_SOFT })
  );

  // Stats, as a table a reader can check against the drawing.
  const stats = sheet(hx, 840, hw, {
    title: 'Regression',
    columns: [
      { head: 'Statistic', width: 1.3, cells: ['Slope', 'Intercept (cm)', 'Pearson r', 'R²', 'Residual SE (cm)'] },
      { head: 'Value', type: 'number', cells: [fmt(fit.slope, 3), fmt(fit.intercept, 2), fmt(fit.r, 3), fmt(fit.r2, 3), fmt(fit.se, 2)], style: { bold: true } },
    ],
    accent: C.indigo,
    fontSize: 13,
    rowH: 32,
  });
  out.push(stats.node);

  // ---- Page 2: residuals ----------------------------------------------
  out.push(
    page(P2, 0, 'Residuals', { icon: '🔍', description: 'Checking the fit: residuals against fitted values, and their distribution.' }),
    ...heading(P2, 'Is a straight line enough?', 'Residuals scatter evenly about zero with no curve or funnel, and their histogram is close to normal: a linear model is adequate here.')
  );
  const rx = axes(colX(P2, 0) + 72, 248, span(7) - 72, 640, {
    x: [140, 205],
    y: [-15, 15],
    xTicks: [140, 150, 160, 170, 180, 190, 200],
    yTicks: [-15, -10, -5, 0, 5, 10, 15],
    xLabel: 'Fitted arm span (cm)',
    yLabel: 'Residual (cm)',
  });
  if (!limit) {
    // The residual plot is the one figure a cover leaves out: it repeats the scatter's silhouette.
    out.push(...rx.nodes);
    out.push(rule({ x: rx.sx(140), y: rx.sy(0) }, { x: rx.sx(205), y: rx.sy(0) }, C.rose, 2));
    for (let i = 0; i < SCATTER_N; i += 1) out.push(dot(rx.sx(lineAt(hgt[i])), rx.sy(fit.residuals[i]), 4, C.teal, { opacity: 0.55 }));
  }
  out.push(
    ...figure(colX(P2, 8), 216, span(4), 440, 'Distribution of residuals', `${SCATTER_N} residuals, cm: centred on zero, close to normal`, {
      ...base('histogram'),
      categories: [],
      series: [{ name: 'Residual', values: fit.residuals.map((r) => round(r, 2)), color: C.teal }],
      buckets: 14,
      labelEvery: 3,
      showLegend: false,
    } as ChartSpec),
    note(colX(P2, 8), 704, `Residual SE ${fmt(fit.se, 1)} cm: a span predicted from height is good to about ±${fmt(2 * fit.se, 0)} cm, 95% of the time.`, 'sky', {
      w: span(4),
      h: 220,
      fontSize: 24,
      stamps: { '👍': ['amara'] },
    })
  );
  return layer(out);
}

// ---------------------------------------------------------------------------
// 9. Networks and graph theory
// ---------------------------------------------------------------------------

let networkLayout: Array<{ x: number; y: number }> | undefined;

function networkBoard(): NewNodeInput[] {
  const out: NewNodeInput[] = [];
  const P1 = pageX(0);
  const P2 = pageX(1);

  const labs = [
    { name: 'Kinetics lab', tint: '#CCFBF1', stroke: C.teal, people: ['Ana', 'Ben', 'Chen', 'Dara', 'Eli', 'Femi'] },
    { name: 'Imaging lab', tint: '#E0E7FF', stroke: C.indigo, people: ['Gita', 'Hugo', 'Ines', 'Jon', 'Kai', 'Lena'] },
    { name: 'Modelling lab', tint: '#FEF3C7', stroke: C.amber, people: ['Mo', 'Noor', 'Omar', 'Pia', 'Quinn', 'Ravi'] },
  ];
  const people = labs.flatMap((l) => l.people);
  const labOf = (p: string) => labs.findIndex((l) => l.people.includes(p));
  const papers: Array<[string, string, number]> = [
    ['Ana', 'Ben', 4], ['Ana', 'Chen', 3], ['Ben', 'Chen', 2], ['Ben', 'Dara', 2], ['Chen', 'Dara', 3], ['Dara', 'Eli', 2], ['Eli', 'Femi', 3], ['Femi', 'Ana', 1], ['Chen', 'Eli', 1],
    ['Gita', 'Hugo', 3], ['Gita', 'Ines', 2], ['Hugo', 'Ines', 4], ['Hugo', 'Jon', 2], ['Ines', 'Kai', 3], ['Jon', 'Kai', 2], ['Kai', 'Lena', 3], ['Jon', 'Lena', 1], ['Gita', 'Lena', 2],
    ['Mo', 'Noor', 4], ['Mo', 'Omar', 2], ['Noor', 'Omar', 3], ['Noor', 'Pia', 2], ['Omar', 'Quinn', 3], ['Pia', 'Quinn', 2], ['Quinn', 'Ravi', 4], ['Pia', 'Ravi', 1], ['Mo', 'Ravi', 2],
    ['Chen', 'Hugo', 2], ['Eli', 'Mo', 3], ['Lena', 'Pia', 1], ['Dara', 'Noor', 1],
  ];
  const idx = (p: string) => people.indexOf(p);
  const n = people.length;
  const W: number[][] = people.map(() => people.map(() => 0));
  for (const [a, b, w] of papers) {
    W[idx(a)][idx(b)] = w;
    W[idx(b)][idx(a)] = w;
  }
  const degree = W.map((row) => row.filter((v) => v > 0).length);

  // Fruchterman–Reingold from a seeded start: deterministic, so the board never reshuffles.
  // The layout depends on nothing the caller passes, so it runs once.
  const pos = (networkLayout ??= (() => {
    const rnd = seeded(808);
    const pos = people.map((p) => {
      const lab = labOf(p);
      const a = (lab / 3) * 2 * Math.PI;
      return { x: Math.cos(a) * 3 + rnd.next(), y: Math.sin(a) * 3 + rnd.next() };
    });
    const kk = 1.4;
    for (let it = 0; it < 400; it += 1) {
      const temp = 0.25 * (1 - it / 400) + 0.01;
      const disp = pos.map(() => ({ x: 0, y: 0 }));
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
          if (i === j) continue;
          const dxv = pos[i].x - pos[j].x;
          const dyv = pos[i].y - pos[j].y;
          const d = Math.max(0.01, Math.hypot(dxv, dyv));
          const rep = (kk * kk) / d;
          disp[i].x += (dxv / d) * rep;
          disp[i].y += (dyv / d) * rep;
          if (W[i][j] > 0) {
            const att = ((d * d) / kk) * (0.4 + W[i][j] * 0.25);
            disp[i].x -= (dxv / d) * att;
            disp[i].y -= (dyv / d) * att;
          }
        }
      }
      pos.forEach((p, i) => {
        const d = Math.max(0.01, Math.hypot(disp[i].x, disp[i].y));
        p.x += (disp[i].x / d) * Math.min(d, temp);
        p.y += (disp[i].y / d) * Math.min(d, temp);
      });
    }
    return pos;
  })());

  // Shortest path by Dijkstra, distance 1 / papers: strong ties are short.
  const from = idx('Femi');
  const to = idx('Kai');
  const dist = people.map(() => Infinity);
  const back = people.map(() => -1);
  const done = people.map(() => false);
  dist[from] = 0;
  for (let step = 0; step < n; step += 1) {
    let u = -1;
    for (let i = 0; i < n; i += 1) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    done[u] = true;
    for (let v = 0; v < n; v += 1) {
      if (W[u][v] > 0 && dist[u] + 1 / W[u][v] < dist[v]) {
        dist[v] = dist[u] + 1 / W[u][v];
        back[v] = u;
      }
    }
  }
  const path: number[] = [];
  for (let v = to; v >= 0; v = back[v]) path.unshift(v);
  const onPath = (a: number, b: number) => path.some((p, i) => i > 0 && ((path[i - 1] === a && p === b) || (path[i - 1] === b && p === a)));

  // ---- Page 1: the drawn network --------------------------------------
  out.push(
    page(P1, 0, 'Collaboration network', { icon: '🕸️', description: 'Co-authorship across three labs, laid out by force. Drag a node and its edges follow.' }),
    ...heading(
      P1,
      'Who writes with whom',
      `${n} researchers, ${papers.length} collaborations, three labs. Node size is degree; edge weight is papers together. Four ties hold the labs together.`
    )
  );
  const box = { x: colX(P1, 0) + 64, y: 272, w: span(8) - 128, h: 700 };
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  // Each axis fills the box: a force layout's aspect carries no meaning, and the room keeps nodes apart.
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const at = (i: number) => ({ x: box.x + ((pos[i].x - x0) / (x1 - x0)) * box.w, y: box.y + ((pos[i].y - y0) / (y1 - y0)) * box.h });
  const nodes = people.map((p, i) => {
    const lab = labs[labOf(p)];
    const r = 22 + degree[i] * 4;
    const c = at(i);
    return dot(c.x, c.y, r, lab.tint, { stroke: path.includes(i) ? INK_STRONG : lab.stroke, strokeWidth: path.includes(i) ? 3 : 2, text: p, ink: INK_STRONG, size: 13 });
  });
  for (const [a, b, w] of papers) {
    const hot = onPath(idx(a), idx(b));
    out.push({
      id: nanoid(),
      type: 'connector',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      from: { nodeId: nodes[idx(a)].id, port: 'auto' },
      to: { nodeId: nodes[idx(b)].id, port: 'auto' },
      routing: 'straight',
      endEnd: 'none',
      appearance: { stroke: { color: hot ? '#E11D48' : labOf(a) === labOf(b) ? '#94A3B8' : '#475569', width: hot ? 5 : 1 + w * 0.75, cap: 'round', ...(labOf(a) === labOf(b) || hot ? {} : { dash: [6, 5] }) } },
    } as unknown as NewNodeInput);
  }
  out.push(...nodes);

  const sideX = colX(P1, 8) + 16;
  const sideW = span(4) - 16;
  out.push(head(sideX, 232, 'Labs'));
  labs.forEach((l, i) => {
    out.push(dot(sideX + 12, 286 + i * 36, 10, l.tint, { stroke: l.stroke, strokeWidth: 2 }));
    out.push(words(sideX + 36, 274 + i * 36, sideW - 36, `${l.name} · ${l.people.join(', ')}`, { size: 14, color: INK, lineHeight: 1.6 }));
  });
  out.push(
    words(sideX, 396, sideW, 'Grey edges stay inside a lab; dashed edges cross between labs. Thicker means more papers.', { size: 14 }),
    head(sideX, 476, 'Shortest path'),
    words(sideX, 512, sideW, path.map((i) => people[i]).join('  →  '), { size: 20, weight: 650, color: '#BE123C', lineHeight: 1.4 }),
    words(
      sideX,
      552,
      sideW,
      `Dijkstra with each edge costing 1 / papers, so strong ties are short: ${path.length - 1} hops at a cost of ${fmt(dist[to], 2)}, crossing between labs only at Chen–Hugo.`,
      { size: 14 }
    ),
    head(sideX, 656, 'Bridges'),
    words(sideX, 692, sideW, 'Chen–Hugo, Eli–Mo, Lena–Pia and Dara–Noor are the only ties between labs. Remove Eli–Mo and the Kinetics lab reaches Modelling only through Dara.', { size: 14 }),
    note(sideX, 800, 'Invite Eli and Mo to co-lead the joint grant: they already carry three papers across labs.', 'lavender', {
      w: sideW,
      h: 176,
      fontSize: 24,
      stamps: { '👍': ['pi-adeyemi', 'pi-novak'], '⭐': ['pi-sato'] },
    })
  );

  // ---- Page 2: the matrix ---------------------------------------------
  const adj = sheet(colX(P2, 0), 248, span(8), {
    title: 'Adjacency',
    columns: [
      { head: '', width: 1.4, cells: people, style: { bold: true } },
      ...people.map((p, j) => ({
        head: p,
        type: 'number' as const,
        width: 0.8,
        align: 'center' as const,
        cells: people.map((_, i) => (W[i][j] ? String(W[i][j]) : '')),
      })),
      {
        head: 'Papers',
        type: 'number' as const,
        width: 1.1,
        cells: people.map((_, i) => `=SUM(B${i + 2}:S${i + 2})`),
        values: W.map((row) => row.reduce((s, v) => s + v, 0)),
        style: COMPUTED,
      },
    ],
    accent: C.violet,
    fontSize: 11,
    rowH: 30,
    scales: people.map((_, j) => ({ col: j + 1, from: '#FFFFFF', to: '#C4B5FD' })),
  });
  out.push(
    page(P2, 0, 'Adjacency matrix', { icon: '🔢', description: 'The same graph as a table, and two charts that read it.' }),
    ...heading(P2, 'The graph as a matrix', 'Row i, column j holds the papers i and j wrote together. The matrix is symmetric because co-authorship is.'),
    head(colX(P2, 0), 200, 'Papers co-authored'),
    adj.node,
    ...figure(colX(P2, 8), 200, span(4), 440, 'Read by the chart engine', 'A network chart linked to the table, laid on a ring', {
      ...linked(adj, { cat: 0, series: people.map((_, j) => j + 1) }, {
        ...base('network'),
        series: [],
        networkLayout: 'ring',
        showLegend: false,
      } as ChartSpec),
    }),
    aside(
      colX(P2, 0),
      248 + adj.height + 24,
      span(8),
      'Each column is shaded by its own values, so clusters show as blocks along the diagonal: the three labs. The Papers column is =SUM across its row, a weighted degree; the chart on the right ranks people by it.'
    ),
    ...figure(colX(P2, 8), 672, span(4), 360, 'Most connected', 'Total papers with others, from the last column', {
      ...linked(adj, { cat: 0, series: [n + 1] }, {
        ...base('barHorizontal'),
        series: [{ name: '', values: [], color: C.violet }],
        sort: 'valueDesc',
        showLegend: false,
        cornerRadius: 2,
        labelEvery: 1,
      } as ChartSpec),
    })
  );
  return layer(out);
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

/** What the scatter board builds at full size; the card states it. */
const REGRESSION_COUNT = regressionBoard().length;

export const DATA: Template[] = [
  {
    id: 'data-saas-metrics',
    category: 'data',
    name: 'SaaS metrics review',
    blurb: 'A year of MRR, retention and unit economics, with every chart reading live from its table.',
    teaches: ['Data links', 'Formulas', 'Combo charts', 'Cross-table refs'],
    tags: ['mrr', 'arr', 'nrr', 'churn', 'cohort', 'ltv', 'cac', 'saas', 'finance', 'board pack', 'kpi'],
    accent: 'indigo',
    featured: true,
    build: saasBoard,
  },
  {
    id: 'data-ab-test',
    category: 'data',
    name: 'A/B test readout',
    blurb: 'Three checkout variants, intervals, significance and the call — with the SQL that pulled it.',
    teaches: ['Confidence intervals', 'Linked charts', 'Code blocks', 'Stamps'],
    tags: ['experiment', 'ab test', 'conversion', 'statistics', 'p-value', 'growth', 'product analytics'],
    accent: 'green',
    build: abTestBoard,
  },
  {
    id: 'data-marketing-funnel',
    category: 'data',
    name: 'Funnel and attribution',
    blurb: 'Visit to paid, a to-scale flow of where signups go, and how three models share the credit.',
    teaches: ['Funnel charts', 'Sankey ribbons', 'Donuts', 'Table totals'],
    tags: ['marketing', 'funnel', 'sankey', 'attribution', 'channels', 'cac', 'growth', 'acquisition'],
    accent: 'violet',
    build: funnelBoard,
  },
  {
    id: 'science-enzyme-kinetics',
    category: 'science',
    name: 'Enzyme kinetics notebook',
    blurb: 'Triplicate rates, a Michaelis–Menten fit, Lineweaver–Burk and the Python that fitted it.',
    teaches: ['Function plots', 'Formulas', 'Data links', 'Code blocks'],
    tags: ['biochemistry', 'michaelis menten', 'lab notebook', 'curve fit', 'enzyme', 'km', 'vmax'],
    accent: 'teal',
    build: enzymeBoard,
  },
  {
    id: 'science-distributions',
    category: 'science',
    name: 'Distributions explorer',
    blurb: 'Five distributions, exact and simulated side by side, and the central limit theorem at work.',
    teaches: ['Histograms', 'Density curves', 'Shaded integrals', 'Seeded data'],
    tags: ['probability', 'statistics', 'normal', 'poisson', 'binomial', 'exponential', 'clt', 'teaching'],
    accent: 'indigo',
    featured: true,
    build: distributionsBoard,
  },
  {
    id: 'science-fourier',
    category: 'science',
    name: 'Waves and Fourier series',
    blurb: 'A square wave built from sines, standing waves, beats and a spectrum — crisp and hand-drawn.',
    teaches: ['Function plots', 'Sketch mode', 'Spectrum bars', 'Frames as slides'],
    tags: ['physics', 'signals', 'fourier', 'harmonics', 'waves', 'gibbs', 'lecture'],
    accent: 'sky',
    build: fourierBoard,
  },
  {
    id: 'science-curves',
    category: 'science',
    name: 'Mathematical curves',
    blurb: 'Lissajous, rose, cardioid, golden spiral, butterfly, heart, Lorenz and a spirograph — exact.',
    teaches: ['Pen paths', 'Polar plots', 'Parametric plots', 'Equations'],
    tags: ['maths', 'geometry', 'polar', 'parametric', 'golden ratio', 'chaos', 'art'],
    accent: 'rose',
    featured: true,
    build: curvesBoard,
  },
  {
    id: 'science-regression',
    category: 'science',
    name: 'Scatter, regression and density',
    blurb: '300 measured points, a least-squares fit with prediction bands, a hexbin and the residuals.',
    teaches: ['Measured axes', 'Regression', 'Hexbins', 'Residuals'],
    tags: ['statistics', 'linear regression', 'r squared', 'scatter plot', 'density', 'data science'],
    accent: 'indigo',
    objectCount: REGRESSION_COUNT,
    build: regressionBoard,
  },
  {
    id: 'science-network',
    category: 'science',
    name: 'Network and graph theory',
    blurb: 'A force-laid co-authorship graph with communities, a shortest path and its adjacency matrix.',
    teaches: ['Connectors', 'Network charts', 'Colour scales', 'Shortest paths'],
    tags: ['graph theory', 'network', 'dijkstra', 'community', 'adjacency matrix', 'social network'],
    accent: 'violet',
    build: networkBoard,
  },
];
