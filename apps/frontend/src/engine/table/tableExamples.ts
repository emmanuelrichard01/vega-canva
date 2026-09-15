import { cellKey, type CellStyle, type CellType, type TableSpec, type TableTheme } from './tableTypes';

/**
 * Tables you can start from.
 *
 * ## The same rule as the chart examples
 *
 * Every one is a table somebody actually keeps — a tracker, a budget, a
 * pricing grid, a timetable, a lab notebook — with plausible content, typed
 * columns and the formatting a finished one would have: status cells tinted by
 * meaning, a totals row set in bold, a group header merged across the columns
 * it names. Placeholder grids of "Column 1" teach nothing; a finished table
 * shows in one glance what the tool can do *and* what the table is for.
 *
 * Built in code rather than stored, for the reason `templates.ts` gives: a
 * schema change fails the build here instead of shipping twenty malformed
 * tables to whoever opens the gallery next.
 */

export type TableExampleCategory = 'plan' | 'money' | 'compare' | 'people' | 'schedule' | 'science';

export const TABLE_EXAMPLE_CATEGORIES: Array<{ id: TableExampleCategory; label: string }> = [
  { id: 'plan', label: 'Planning' },
  { id: 'money', label: 'Money' },
  { id: 'compare', label: 'Comparison' },
  { id: 'people', label: 'Teams' },
  { id: 'schedule', label: 'Schedules' },
  { id: 'science', label: 'Science' },
];

export interface TableExample {
  id: string;
  name: string;
  /** One line: what it is for, not what it contains. */
  note: string;
  category: TableExampleCategory;
  spec: TableSpec;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** The status vocabulary, tinted by meaning, shared by every tracker. */
const STATUS: Record<string, CellStyle> = {
  Done: { fill: '#DCFCE7', color: '#166534' },
  Shipped: { fill: '#DCFCE7', color: '#166534' },
  'On track': { fill: '#DCFCE7', color: '#166534' },
  'In progress': { fill: '#DBEAFE', color: '#1E40AF' },
  Review: { fill: '#EDE9FE', color: '#5B21B6' },
  'At risk': { fill: '#FEF3C7', color: '#92400E' },
  Blocked: { fill: '#FEE2E2', color: '#991B1B' },
  'Not started': { fill: '#F1F5F9', color: '#475569' },
  High: { fill: '#FEE2E2', color: '#991B1B' },
  Medium: { fill: '#FEF3C7', color: '#92400E' },
  Low: { fill: '#DCFCE7', color: '#166534' },
};

interface Draft {
  rows: string[][];
  types: CellType[];
  widths?: number[];
  theme?: TableTheme;
  accent?: string;
  firstColumn?: boolean;
  /** Columns whose words carry a status colour. */
  statusCols?: number[];
  /** Rows set in bold with a tint — totals, subtotals. */
  totalRows?: number[];
  /** Rows that head a group: merged across, tinted. */
  groupRows?: number[];
  centre?: number[];
  merges?: TableSpec['merges'];
  styles?: Record<string, CellStyle>;
  sort?: TableSpec['sort'];
  currency?: string;
  fontSize?: number;
}

function table(d: Draft): TableSpec {
  const cols = Math.max(...d.rows.map((r) => r.length));
  const cells = d.rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ''));
  const styles: Record<string, CellStyle> = { ...(d.styles ?? {}) };
  const merges = [...(d.merges ?? [])];

  for (const c of d.statusCols ?? []) {
    cells.forEach((row, r) => {
      if (r === 0) return;
      const s = STATUS[row[c]];
      if (s) styles[cellKey(r, c)] = { ...s, align: 'center' };
    });
  }
  for (const r of d.totalRows ?? []) {
    for (let c = 0; c < cols; c++) styles[cellKey(r, c)] = { ...(styles[cellKey(r, c)] ?? {}), bold: true, fill: '#F1F5F9' };
  }
  for (const r of d.groupRows ?? []) {
    merges.push({ r, c: 0, rs: 1, cs: cols });
    styles[cellKey(r, 0)] = { bold: true, fill: '#EEF2FF', color: '#3730A3' };
  }
  for (const c of d.centre ?? []) {
    cells.forEach((_, r) => {
      if (r === 0) return;
      styles[cellKey(r, c)] = { ...(styles[cellKey(r, c)] ?? {}), align: 'center' };
    });
  }

  return {
    cells,
    columns: Array.from({ length: cols }, (_, c) => ({ width: d.widths?.[c] ?? 1, type: d.types[c] ?? 'text' })),
    header: true,
    ...(d.firstColumn ? { firstColumn: true } : null),
    theme: d.theme ?? 'clean',
    ...(d.accent ? { accent: d.accent } : null),
    fontSize: d.fontSize ?? 13,
    ...(Object.keys(styles).length ? { styles } : null),
    ...(merges.length ? { merges } : null),
    ...(d.sort ? { sort: d.sort } : null),
    ...(d.currency ? { currency: d.currency } : null),
  };
}

const YES = '✓';
const NO = '—';

// ---------------------------------------------------------------------------
// The examples
// ---------------------------------------------------------------------------

export const TABLE_EXAMPLES: TableExample[] = [
  // ── Planning ────────────────────────────────────────────────────────────
  {
    id: 'project-tracker',
    name: 'Project tracker',
    note: 'who owns what, how far along, and what is blocked',
    category: 'plan',
    spec: table({
      rows: [
        ['Task', 'Owner', 'Status', 'Due', 'Progress'],
        ['Discovery interviews', 'Maya', 'Done', '2026-03-06', '100%'],
        ['Information architecture', 'Leo', 'Done', '2026-03-13', '100%'],
        ['High-fidelity designs', 'Ana', 'In progress', '2026-03-27', '65%'],
        ['API contract', 'Sam', 'Review', '2026-03-20', '90%'],
        ['Billing integration', 'Priya', 'Blocked', '2026-04-03', '20%'],
        ['Accessibility audit', 'Leo', 'Not started', '2026-04-10', '0%'],
        ['Launch checklist', 'Maya', 'Not started', '2026-04-17', '0%'],
      ],
      types: ['text', 'text', 'text', 'date', 'percent'],
      widths: [2, 0.9, 1.1, 1, 0.9],
      statusCols: [2],
      firstColumn: true,
    }),
  },
  {
    id: 'sprint-backlog',
    name: 'Sprint backlog',
    note: 'stories by priority, with the points that size the sprint',
    category: 'plan',
    spec: table({
      rows: [
        ['Story', 'Points', 'Priority', 'Assignee', 'Status'],
        ['Sign in with a passkey', '5', 'High', 'Sam', 'In progress'],
        ['Export board as PDF', '8', 'High', 'Priya', 'Not started'],
        ['Dark mode for embeds', '3', 'Medium', 'Leo', 'Review'],
        ['Keyboard shortcuts sheet', '2', 'Low', 'Ana', 'Done'],
        ['Offline indicator', '3', 'Medium', 'Maya', 'In progress'],
        ['Total', '21', '', '', ''],
      ],
      types: ['text', 'number', 'text', 'text', 'text'],
      widths: [2.2, 0.7, 0.9, 0.9, 1.1],
      statusCols: [2, 4],
      totalRows: [6],
      theme: 'striped',
      accent: '#7C3AED',
    }),
  },
  {
    id: 'okrs',
    name: 'Quarterly OKRs',
    note: 'each objective spans the key results that measure it',
    category: 'plan',
    spec: table({
      rows: [
        ['Objective', 'Key result', 'Target', 'Current', 'Confidence'],
        ['Delight new teams', 'Activation within 7 days', '60%', '48%', '70%'],
        ['', 'Time to first board', '3 min', '4.2 min', '60%'],
        ['', 'Onboarding NPS', '50', '44', '75%'],
        ['Grow revenue', 'Net new ARR', '$240k', '$171k', '65%'],
        ['', 'Expansion rate', '115%', '109%', '55%'],
        ['Ship reliably', 'Uptime', '99.95%', '99.97%', '95%'],
        ['', 'P1 incidents', '≤ 2', '1', '90%'],
      ],
      types: ['text', 'text', 'text', 'text', 'percent'],
      widths: [1.4, 1.9, 0.8, 0.8, 1],
      merges: [
        { r: 1, c: 0, rs: 3, cs: 1 },
        { r: 4, c: 0, rs: 2, cs: 1 },
        { r: 6, c: 0, rs: 2, cs: 1 },
      ],
      styles: {
        [cellKey(1, 0)]: { bold: true, fill: '#EEF2FF', color: '#3730A3' },
        [cellKey(4, 0)]: { bold: true, fill: '#ECFDF5', color: '#065F46' },
        [cellKey(6, 0)]: { bold: true, fill: '#FFF7ED', color: '#9A3412' },
      },
      theme: 'grid',
    }),
  },
  {
    id: 'risk-register',
    name: 'Risk register',
    note: 'likelihood times impact, so the worst risks sort to the top',
    category: 'plan',
    spec: table({
      rows: [
        ['Risk', 'Likelihood', 'Impact', 'Score', 'Mitigation', 'Owner'],
        ['Vendor API deprecated', 'Medium', 'High', '12', 'Abstract behind an adapter', 'Sam'],
        ['Key engineer leaves', 'Low', 'High', '8', 'Pair on every critical path', 'Maya'],
        ['Launch slips past event', 'High', 'Medium', '12', 'Cut scope to the core flow', 'Ana'],
        ['Data residency request', 'Medium', 'Medium', '9', 'EU region on the roadmap', 'Priya'],
        ['Cost overrun on hosting', 'Low', 'Low', '4', 'Budget alerts at 80%', 'Leo'],
      ],
      types: ['text', 'text', 'text', 'number', 'text', 'text'],
      widths: [1.7, 0.9, 0.8, 0.6, 2, 0.8],
      statusCols: [1, 2],
      sort: { col: 3, dir: 'desc' },
      theme: 'clean',
    }),
  },

  // ── Money ───────────────────────────────────────────────────────────────
  {
    id: 'monthly-budget',
    name: 'Monthly budget',
    note: 'plan against actual, with the variance and each line’s share',
    category: 'money',
    spec: table({
      rows: [
        ['Category', 'Budget', 'Actual', 'Variance', 'Share'],
        ['Salaries', '48000', '48000', '0', '62%'],
        ['Cloud hosting', '6500', '7240', '-740', '9%'],
        ['Software', '3200', '2980', '220', '4%'],
        ['Marketing', '9000', '8150', '850', '11%'],
        ['Travel', '2500', '3110', '-610', '4%'],
        ['Office', '7800', '7800', '0', '10%'],
        ['Total', '77000', '77280', '-280', '100%'],
      ],
      types: ['text', 'currency', 'currency', 'currency', 'percent'],
      widths: [1.5, 1, 1, 1, 0.8],
      totalRows: [7],
      styles: {
        [cellKey(2, 3)]: { color: '#B91C1C' },
        [cellKey(5, 3)]: { color: '#B91C1C' },
        [cellKey(4, 3)]: { color: '#15803D' },
        [cellKey(3, 3)]: { color: '#15803D' },
      },
      theme: 'bold',
      accent: '#059669',
    }),
  },
  {
    id: 'invoice',
    name: 'Invoice',
    note: 'line items, then subtotal, tax and total set under the amounts',
    category: 'money',
    spec: table({
      rows: [
        ['Item', 'Qty', 'Unit price', 'Amount'],
        ['Brand workshop (half day)', '1', '1800', '1800'],
        ['Design system audit', '1', '2400', '2400'],
        ['Component build, per component', '12', '350', '4200'],
        ['Documentation site', '1', '1500', '1500'],
        ['Subtotal', '', '', '9900'],
        ['VAT 20%', '', '', '1980'],
        ['Total due', '', '', '11880'],
      ],
      types: ['text', 'number', 'currency', 'currency'],
      widths: [2.6, 0.6, 1, 1],
      merges: [
        { r: 5, c: 0, rs: 1, cs: 3 },
        { r: 6, c: 0, rs: 1, cs: 3 },
        { r: 7, c: 0, rs: 1, cs: 3 },
      ],
      styles: {
        [cellKey(5, 0)]: { align: 'right', color: '#475569' },
        [cellKey(6, 0)]: { align: 'right', color: '#475569' },
        [cellKey(7, 0)]: { align: 'right', bold: true },
        [cellKey(7, 3)]: { bold: true, fill: '#F1F5F9' },
      },
      theme: 'minimal',
      currency: '£',
    }),
  },
  {
    id: 'sales-pipeline',
    name: 'Sales pipeline',
    note: 'deals by value, weighted by the chance they close',
    category: 'money',
    spec: table({
      rows: [
        ['Deal', 'Stage', 'Value', 'Probability', 'Close date'],
        ['Northwind — enterprise', 'Negotiation', '84000', '70%', '2026-05-14'],
        ['Contoso — renewal', 'Proposal', '36000', '60%', '2026-05-30'],
        ['Fabrikam — pilot', 'Discovery', '12000', '25%', '2026-06-20'],
        ['Tailspin — expansion', 'Closed won', '52000', '100%', '2026-04-28'],
        ['Litware — new logo', 'Qualified', '28000', '40%', '2026-06-05'],
      ],
      types: ['text', 'text', 'currency', 'percent', 'date'],
      widths: [1.8, 1.1, 1, 0.9, 1],
      sort: { col: 2, dir: 'desc' },
      theme: 'striped',
    }),
  },

  // ── Comparison ──────────────────────────────────────────────────────────
  {
    id: 'pricing-tiers',
    name: 'Pricing tiers',
    note: 'what each plan includes, grouped the way buyers read it',
    category: 'compare',
    spec: table({
      rows: [
        ['', 'Free', 'Pro', 'Team'],
        ['Price per seat / month', '$0', '$12', '$24'],
        ['Collaboration', '', '', ''],
        ['Boards', '3', 'Unlimited', 'Unlimited'],
        ['Live cursors and comments', YES, YES, YES],
        ['Guest editors', NO, '5', 'Unlimited'],
        ['Security', '', '', ''],
        ['Single sign-on', NO, NO, YES],
        ['Audit log', NO, NO, YES],
        ['Version history', '7 days', '90 days', 'Unlimited'],
      ],
      types: ['text', 'text', 'text', 'text'],
      widths: [2, 1, 1, 1],
      groupRows: [2, 6],
      centre: [1, 2, 3],
      styles: {
        [cellKey(0, 2)]: { fill: '#2563EB', color: '#FFFFFF', align: 'center' },
        [cellKey(1, 2)]: { bold: true },
      },
      theme: 'clean',
    }),
  },
  {
    id: 'vendor-scorecard',
    name: 'Vendor scorecard',
    note: 'weighted criteria, so the decision can be defended',
    category: 'compare',
    spec: table({
      rows: [
        ['Criterion', 'Weight', 'Atlas', 'Beacon', 'Cirrus'],
        ['Fit to requirements', '30%', '4', '5', '3'],
        ['Total cost of ownership', '25%', '3', '4', '5'],
        ['Security and compliance', '20%', '5', '4', '3'],
        ['Support quality', '15%', '4', '3', '4'],
        ['Roadmap alignment', '10%', '3', '5', '2'],
        ['Weighted score', '100%', '3.85', '4.30', '3.55'],
      ],
      types: ['text', 'percent', 'number', 'number', 'number'],
      widths: [2, 0.8, 0.8, 0.8, 0.8],
      totalRows: [6],
      centre: [2, 3, 4],
      styles: { [cellKey(6, 3)]: { bold: true, fill: '#DCFCE7', color: '#166534', align: 'center' } },
      theme: 'grid',
    }),
  },
  {
    id: 'feature-matrix',
    name: 'Competitive matrix',
    note: 'where you lead and where you do not, in one grid',
    category: 'compare',
    spec: table({
      rows: [
        ['Capability', 'Us', 'Miro', 'FigJam', 'Mural'],
        ['Real-time collaboration', YES, YES, YES, YES],
        ['Works offline', YES, NO, NO, NO],
        ['Charts from data', YES, 'Partial', NO, 'Partial'],
        ['Maths and scientific plots', YES, NO, NO, NO],
        ['Physics simulation', YES, NO, NO, NO],
        ['Hand-drawn sketch mode', YES, NO, YES, NO],
        ['Enterprise SSO', 'Roadmap', YES, YES, YES],
      ],
      types: ['text', 'text', 'text', 'text', 'text'],
      widths: [2.2, 0.8, 0.8, 0.8, 0.8],
      centre: [1, 2, 3, 4],
      styles: Object.fromEntries(
        [1, 2, 3, 4, 5, 6, 7].map((r) => [cellKey(r, 1), { fill: '#EFF6FF', bold: true, align: 'center' as const }])
      ),
      theme: 'minimal',
    }),
  },

  // ── Teams ───────────────────────────────────────────────────────────────
  {
    id: 'raci',
    name: 'RACI matrix',
    note: 'responsible, accountable, consulted, informed — per activity',
    category: 'people',
    spec: (() => {
      const rows = [
        ['Activity', 'Product', 'Design', 'Engineering', 'QA', 'Legal'],
        ['Define requirements', 'A', 'C', 'C', 'I', 'I'],
        ['Design the flow', 'C', 'A', 'C', 'I', ''],
        ['Build the feature', 'I', 'C', 'A', 'C', ''],
        ['Test and sign off', 'I', 'I', 'R', 'A', ''],
        ['Privacy review', 'R', '', 'C', '', 'A'],
        ['Launch comms', 'A', 'R', 'I', 'I', 'C'],
      ];
      const tint: Record<string, CellStyle> = {
        R: { fill: '#DBEAFE', color: '#1E40AF', bold: true },
        A: { fill: '#FEF3C7', color: '#92400E', bold: true },
        C: { fill: '#F3E8FF', color: '#6B21A8' },
        I: { fill: '#F1F5F9', color: '#475569' },
      };
      const styles: Record<string, CellStyle> = {};
      rows.forEach((row, r) =>
        row.forEach((v, c) => {
          if (r > 0 && c > 0 && tint[v]) styles[cellKey(r, c)] = { ...tint[v], align: 'center' };
        })
      );
      return table({ rows, types: rows[0].map(() => 'text' as CellType), widths: [2, 1, 1, 1.1, 0.8, 0.8], styles, theme: 'grid' });
    })(),
  },
  {
    id: 'team-directory',
    name: 'Team directory',
    note: 'roles, time zones and the hours people overlap',
    category: 'people',
    spec: table({
      rows: [
        ['Name', 'Role', 'Location', 'Time zone', 'Core hours'],
        ['Maya Okafor', 'Product lead', 'Lagos', 'UTC+1', '10:00–16:00'],
        ['Leo Brandt', 'Design', 'Berlin', 'UTC+1', '09:00–15:00'],
        ['Priya Nair', 'Engineering', 'Bengaluru', 'UTC+5:30', '13:00–19:00'],
        ['Sam Chen', 'Engineering', 'Toronto', 'UTC−5', '08:00–14:00'],
        ['Ana Ruiz', 'Research', 'Madrid', 'UTC+1', '09:30–15:30'],
      ],
      types: ['text', 'text', 'text', 'text', 'text'],
      widths: [1.4, 1.2, 1, 0.9, 1.1],
      firstColumn: true,
      theme: 'clean',
    }),
  },
  {
    id: 'leaderboard',
    name: 'Leaderboard',
    note: 'ranked by score, with who moved since last week',
    category: 'people',
    spec: table({
      rows: [
        ['Rank', 'Team', 'Score', 'Change'],
        ['1', 'Orion', '2840', '▲ 2'],
        ['2', 'Lyra', '2715', '▼ 1'],
        ['3', 'Vega', '2690', '▲ 3'],
        ['4', 'Draco', '2410', '▼ 2'],
        ['5', 'Cygnus', '2295', '—'],
      ],
      types: ['number', 'text', 'number', 'text'],
      widths: [0.6, 1.6, 1, 0.8],
      centre: [0, 3],
      styles: {
        [cellKey(1, 1)]: { bold: true },
        [cellKey(1, 3)]: { color: '#15803D', align: 'center' },
        [cellKey(3, 3)]: { color: '#15803D', align: 'center' },
        [cellKey(2, 3)]: { color: '#B91C1C', align: 'center' },
        [cellKey(4, 3)]: { color: '#B91C1C', align: 'center' },
      },
      theme: 'bold',
      accent: '#0F172A',
    }),
  },

  // ── Schedules ───────────────────────────────────────────────────────────
  {
    id: 'timetable',
    name: 'Class timetable',
    note: 'double periods merged, subjects tinted so the week reads at a glance',
    category: 'schedule',
    spec: (() => {
      const rows = [
        ['Time', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        ['09:00', 'Maths', 'Physics', 'English', 'Maths', 'Chemistry'],
        ['10:00', '', '', 'History', 'Biology', ''],
        ['11:00', 'Break', 'Break', 'Break', 'Break', 'Break'],
        ['11:20', 'Art', 'Maths', 'Physics', 'English', 'Computing'],
        ['12:20', 'Lunch', 'Lunch', 'Lunch', 'Lunch', 'Lunch'],
        ['13:10', 'Biology', 'Computing', 'Maths', 'Chemistry', 'Sport'],
        ['14:10', 'English', 'History', '', 'Art', ''],
      ];
      const tint: Record<string, string> = {
        Maths: '#DBEAFE',
        Physics: '#E0E7FF',
        Chemistry: '#FCE7F3',
        Biology: '#DCFCE7',
        English: '#FEF3C7',
        History: '#FFEDD5',
        Art: '#F3E8FF',
        Computing: '#CCFBF1',
        Sport: '#ECFCCB',
      };
      const styles: Record<string, CellStyle> = {};
      rows.forEach((row, r) =>
        row.forEach((v, c) => {
          if (r === 0 || c === 0) return;
          if (tint[v]) styles[cellKey(r, c)] = { fill: tint[v], align: 'center' };
          if (v === 'Break' || v === 'Lunch') styles[cellKey(r, c)] = { color: '#64748B', italic: true, align: 'center' };
        })
      );
      return table({
        rows,
        types: rows[0].map(() => 'text' as CellType),
        widths: [0.7, 1, 1, 1, 1, 1],
        firstColumn: true,
        merges: [
          { r: 1, c: 1, rs: 2, cs: 1 },
          { r: 1, c: 2, rs: 2, cs: 1 },
          { r: 1, c: 5, rs: 2, cs: 1 },
          { r: 3, c: 1, rs: 1, cs: 5 },
          { r: 5, c: 1, rs: 1, cs: 5 },
          { r: 6, c: 3, rs: 2, cs: 1 },
          { r: 6, c: 5, rs: 2, cs: 1 },
        ],
        styles,
        theme: 'grid',
      });
    })(),
  },
  {
    id: 'content-calendar',
    name: 'Content calendar',
    note: 'what goes out, where, and whether it is ready',
    category: 'schedule',
    spec: table({
      rows: [
        ['Date', 'Channel', 'Topic', 'Owner', 'Status'],
        ['2026-05-04', 'Blog', 'Designing for offline', 'Leo', 'Shipped'],
        ['2026-05-06', 'Newsletter', 'May product update', 'Maya', 'Review'],
        ['2026-05-11', 'Video', 'Charts from a spreadsheet', 'Ana', 'In progress'],
        ['2026-05-13', 'Social', 'Sketch mode teaser', 'Priya', 'Not started'],
        ['2026-05-18', 'Webinar', 'Teaching with live plots', 'Sam', 'At risk'],
      ],
      types: ['date', 'text', 'text', 'text', 'text'],
      widths: [1, 0.9, 2, 0.8, 1],
      statusCols: [4],
      theme: 'striped',
      accent: '#DB2777',
    }),
  },
  {
    id: 'meeting-agenda',
    name: 'Meeting agenda',
    note: 'timed items with a lead and the decision each should end in',
    category: 'schedule',
    spec: table({
      rows: [
        ['Time', 'Item', 'Lead', 'Outcome'],
        ['10:00', 'Wins and context', 'Maya', 'Shared picture'],
        ['10:10', 'Metrics review', 'Sam', 'Agree on the one number'],
        ['10:25', 'Launch go / no-go', 'Ana', 'Decision'],
        ['10:45', 'Hiring plan', 'Priya', 'Two roles approved'],
        ['10:55', 'Actions and owners', 'Maya', 'Written down'],
      ],
      types: ['text', 'text', 'text', 'text'],
      widths: [0.6, 1.8, 0.8, 1.6],
      theme: 'minimal',
    }),
  },

  // ── Science ─────────────────────────────────────────────────────────────
  {
    id: 'lab-notebook',
    name: 'Lab notebook',
    note: 'measurements with units in the headings and a note per sample',
    category: 'science',
    spec: table({
      rows: [
        ['Sample', 'Mass (g)', 'Volume (mL)', 'Density (g/mL)', 'Temp (°C)', 'Notes'],
        ['A1 — copper', '44.8', '5.0', '8.96', '21.4', 'Clean cut'],
        ['A2 — aluminium', '13.5', '5.0', '2.70', '21.5', ''],
        ['A3 — steel', '39.3', '5.0', '7.86', '21.3', 'Slight rust'],
        ['A4 — brass', '42.6', '5.0', '8.52', '21.6', 'Repeat tomorrow'],
        ['A5 — lead', '56.7', '5.0', '11.34', '21.4', ''],
      ],
      types: ['text', 'number', 'number', 'number', 'number', 'text'],
      widths: [1.4, 0.8, 0.9, 1, 0.8, 1.3],
      firstColumn: true,
      theme: 'grid',
    }),
  },
  {
    id: 'element-data',
    name: 'Element data',
    note: 'a slice of the periodic table, sortable by any property',
    category: 'science',
    spec: table({
      rows: [
        ['Symbol', 'Element', 'Atomic no.', 'Atomic mass', 'Group', 'Period'],
        ['H', 'Hydrogen', '1', '1.008', '1', '1'],
        ['He', 'Helium', '2', '4.003', '18', '1'],
        ['C', 'Carbon', '6', '12.011', '14', '2'],
        ['N', 'Nitrogen', '7', '14.007', '15', '2'],
        ['O', 'Oxygen', '8', '15.999', '16', '2'],
        ['Na', 'Sodium', '11', '22.990', '1', '3'],
        ['Fe', 'Iron', '26', '55.845', '8', '4'],
      ],
      types: ['text', 'text', 'number', 'number', 'number', 'number'],
      widths: [0.7, 1.2, 0.9, 1, 0.7, 0.7],
      centre: [0],
      styles: { [cellKey(0, 0)]: { align: 'center' } },
      theme: 'clean',
      accent: '#0891B2',
    }),
  },
  {
    id: 'unit-conversions',
    name: 'Unit conversions',
    note: 'SI units and the factors to and from the everyday ones',
    category: 'science',
    spec: table({
      rows: [
        ['Quantity', 'SI unit', 'Symbol', 'Everyday unit', 'Factor'],
        ['Length', 'metre', 'm', 'foot', '0.3048'],
        ['Mass', 'kilogram', 'kg', 'pound', '0.4536'],
        ['Volume', 'cubic metre', 'm³', 'litre', '0.001'],
        ['Energy', 'joule', 'J', 'kilocalorie', '4184'],
        ['Pressure', 'pascal', 'Pa', 'atmosphere', '101325'],
        ['Speed', 'metre per second', 'm/s', 'km/h', '0.2778'],
      ],
      types: ['text', 'text', 'text', 'text', 'number'],
      widths: [1, 1.4, 0.7, 1.1, 0.9],
      centre: [2],
      theme: 'minimal',
    }),
  },
];

export const tableExampleById = (id: string) => TABLE_EXAMPLES.find((e) => e.id === id);
