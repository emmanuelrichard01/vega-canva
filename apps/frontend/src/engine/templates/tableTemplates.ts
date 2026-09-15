import type { NewNodeInput } from '../document/mutations';
import { defaultChartSpec, type ChartSpec } from '../chart/chartTypes';
import { tableExampleById } from '../table/tableExamples';
import type { TableSpec } from '../table/tableTypes';
import { caption, chart, frame, table, title } from './scienceTemplates';
import type { Template } from './templates';

/**
 * Boards built around tables.
 *
 * Each is a working board a team would actually keep — an operating review,
 * a pricing decision, a teaching week — assembled from the table examples
 * plus the one chart that turns a table's numbers into a shape. The tables are
 * the gallery's own (`tableExamples.ts`), so a board and the gallery can never
 * describe the same tracker two different ways.
 *
 * Laid out as two columns of labelled tiles inside one frame. Each table gets
 * whole rows at the height the table tool gives a new one, so nothing arrives
 * squeezed and a row added later lands at the same height as the rest.
 */

const ROW_H = 36; // tableApply.TABLE_ROW_H — kept literal so the template module stays out of the editor's import graph
const COL_W = 820;
const GAP = 64;
const PAD = 56;
const LABEL_H = 34;

type Tile = { label: string } & ({ table: TableSpec } | { chart: ChartSpec; h: number });

const example = (id: string): TableSpec => {
  const found = tableExampleById(id);
  if (!found) throw new Error(`No table example "${id}"`);
  return JSON.parse(JSON.stringify(found.spec)) as TableSpec;
};

const plot = (kind: ChartSpec['kind'], over: Partial<ChartSpec>): ChartSpec => ({ ...defaultChartSpec(kind), ...over });

function board(heading: string, lede: string, frameName: string, columns: Tile[][]): NewNodeInput[] {
  const tiles: NewNodeInput[] = [];
  let bottom = 0;
  columns.forEach((col, i) => {
    const x = PAD + i * (COL_W + GAP);
    let y = PAD;
    for (const tile of col) {
      tiles.push(caption(x, y, tile.label));
      y += LABEL_H;
      if ('table' in tile) {
        const h = tile.table.cells.length * ROW_H;
        tiles.push(table(x, y, tile.table, false, COL_W, h));
        y += h + GAP;
      } else {
        tiles.push(chart(x, y, tile.chart, false, COL_W, tile.h));
        y += tile.h + GAP;
      }
    }
    bottom = Math.max(bottom, y - GAP + PAD);
  });
  const width = PAD * 2 + columns.length * COL_W + (columns.length - 1) * GAP;
  return [title(0, -150, heading), caption(0, -86, lede), frame(0, 0, width, bottom, frameName), ...tiles];
}

export const TABLE_TEMPLATES: Template[] = [
  {
    id: 'tbl-operating-review',
    category: 'thinking',
    name: 'Project operating review',
    blurb: 'Delivery, ownership, money and risk on one board — the weekly review, ready to run.',
    teaches: ['Tables', 'Status colours', 'Merged cells', 'Charts'],
    build: () =>
      board('Atlas launch — weekly review', 'Everything the Monday meeting asks, answered on one board.', 'Week 12', [
        [
          { label: 'Delivery', table: example('project-tracker') },
          { label: 'Who does what', table: example('raci') },
          {
            label: 'Sprint burndown',
            h: 300,
            chart: plot('line', {
              title: 'Points remaining',
              subtitle: 'actual against the ideal line',
              categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
              series: [
                { name: 'Ideal', values: [40, 36, 32, 28, 24, 20, 16, 12, 8, 4] },
                { name: 'Actual', values: [40, 38, 35, 34, 29, 24, 22, null, null, null] },
              ],
              yAxisLabel: 'Points',
            }),
          },
        ],
        [
          { label: 'Budget', table: example('monthly-budget') },
          { label: 'Risks, worst first', table: example('risk-register') },
          { label: 'This quarter', table: example('okrs') },
        ],
      ]),
  },
  {
    id: 'tbl-pricing-review',
    category: 'thinking',
    name: 'Pricing & market review',
    blurb: 'Plans, competitors, a weighted vendor decision and the pipeline it feeds.',
    teaches: ['Comparison tables', 'Weighted scoring', 'Sorting', 'Charts'],
    build: () =>
      board('Pricing review', 'Where we stand, what we charge, and what it is worth.', 'Q3 pricing', [
        [
          { label: 'Our plans', table: example('pricing-tiers') },
          { label: 'Choosing a billing vendor', table: example('vendor-scorecard') },
        ],
        [
          { label: 'Against the market', table: example('feature-matrix') },
          { label: 'Open pipeline, largest first', table: example('sales-pipeline') },
          {
            label: 'Pipeline by stage',
            h: 280,
            chart: plot('bar', {
              title: 'Weighted value by stage',
              subtitle: 'value × probability',
              categories: ['Discovery', 'Qualified', 'Proposal', 'Negotiation', 'Closed won'],
              series: [{ name: 'Weighted value', values: [3000, 11200, 21600, 58800, 52000] }],
              yAxisLabel: 'USD',
            }),
          },
        ],
      ]),
  },
  {
    id: 'tbl-finance-planner',
    category: 'thinking',
    name: 'Finance planner',
    blurb: 'A budget, a savings plan, a break-even and the unit economics — every number computed from its inputs.',
    teaches: ['Formulas', 'Colour rules', 'Tables', 'Charts'],
    build: () =>
      board('Money, worked out', 'Change any input and every total, variance and verdict on the board follows.', 'Q3 plan', [
        [
          { label: 'This month', table: example('monthly-budget') },
          { label: 'Savings, five years out', table: example('savings-plan') },
        ],
        [
          { label: 'Break-even', table: example('break-even') },
          {
            label: 'Profit by units sold',
            h: 280,
            chart: plot('bar', {
              title: 'Profit by units sold',
              subtitle: 'break-even at 800 units',
              categories: ['0', '400', '800', '1200', '1600', '2000'],
              series: [{ name: 'Profit', values: [-12000, -6000, 0, 6000, 12000, 18000] }],
              yAxisLabel: 'USD',
            }),
          },
          { label: 'Unit economics', table: example('unit-economics') },
        ],
      ]),
  },
  {
    id: 'tbl-teaching-week',
    category: 'science',
    name: 'Science teaching week',
    blurb: 'A timetable, a lab notebook and the reference tables a practical needs.',
    teaches: ['Tables', 'Merged periods', 'Units', 'Charts'],
    build: () =>
      board('Year 10 science — week 6', 'The timetable, Tuesday’s density practical, and the tables beside it.', 'Week 6', [
        [
          { label: 'Timetable', table: example('timetable') },
          { label: 'Grade book', table: example('grade-book') },
          { label: 'Units and conversions', table: example('unit-conversions') },
        ],
        [
          { label: 'Density practical — results', table: example('lab-notebook') },
          {
            label: 'Measured densities',
            h: 280,
            chart: plot('bar', {
              title: 'Density by metal',
              subtitle: 'g/mL, from the lab notebook',
              categories: ['Aluminium', 'Steel', 'Brass', 'Copper', 'Lead'],
              series: [{ name: 'Density', values: [2.7, 7.86, 8.52, 8.96, 11.34] }],
              yAxisLabel: 'g/mL',
            }),
          },
          { label: 'Reference: elements', table: example('element-data') },
        ],
      ]),
  },
];
