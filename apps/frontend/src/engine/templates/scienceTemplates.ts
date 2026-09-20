import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../document/mutations';
import { defaultChartSpec, type ChartSpec } from '../chart/chartTypes';
import type { TableSpec } from '../table/tableTypes';
import type { Template } from './templates';
import { INK_SOFT, INK_STRONG } from './templateKit';

/**
 * Science and maths, each board drawn twice.
 *
 * ## Why every board holds two frames
 *
 * The brief for these was to show both treatments — precise, presentation-
 * ready charts, and hand-drawn ones for teaching and whiteboarding — and the
 * strongest way to show that the sketch treatment keeps every value, label and
 * axis is to put the same charts side by side: **Presentation** on the left,
 * **Whiteboard** on the right, one spec apiece. Anyone can check that nothing
 * moved, and flip either frame's charts to the other hand from the panel.
 *
 * Every chart here is an ordinary chart node, so each board opens as a working
 * room: the formulae are editable, the data opens in the sheet, and the
 * tables edit in place.
 */

const TAU = Math.PI * 2;

export const title = (x: number, y: number, text: string, fontSize = 40): NewNodeInput => ({
  id: nanoid(),
  type: 'text',
  x,
  y,
  width: 900,
  height: fontSize * 1.5,
  text,
  resize: 'width',
  typography: { fontSize, fontWeight: 700, color: INK_STRONG },
});

export const caption = (x: number, y: number, text: string): NewNodeInput => ({
  id: nanoid(),
  type: 'text',
  x,
  y,
  width: 560,
  height: 30,
  text,
  resize: 'width',
  typography: { fontSize: 18, fontWeight: 500, color: INK_SOFT },
});

export const frame = (x: number, y: number, width: number, height: number, name: string): NewNodeInput => ({
  id: nanoid(),
  type: 'frame',
  x,
  y,
  width,
  height,
  title: name,
});

export const chart = (x: number, y: number, spec: ChartSpec, sketch: boolean, w = 520, h = 340): NewNodeInput =>
  ({
    id: nanoid(),
    type: 'chart',
    x,
    y,
    width: w,
    height: h,
    chart: spec,
    ...(sketch ? { appearance: { sketch: 'medium' } } : null),
  }) as unknown as NewNodeInput;

export const table = (x: number, y: number, spec: TableSpec, sketch: boolean, w = 520, h = 340): NewNodeInput =>
  ({
    id: nanoid(),
    type: 'table',
    x,
    y,
    width: w,
    height: h,
    table: spec,
    ...(sketch ? { appearance: { sketch: 'medium' } } : null),
  }) as unknown as NewNodeInput;

type Item = { chart: ChartSpec } | { table: TableSpec };

/**
 * Four items in a two-by-two, twice: once clean, once sketched.
 *
 * The frames share one geometry so the eye can go straight across from a
 * chart to its hand-drawn twin at the same position.
 */
function boards(heading: string, lede: string, items: Item[]): NewNodeInput[] {
  const W = 1160;
  const H = 860;
  const GAP = 140;
  const out: NewNodeInput[] = [title(0, -150, heading), caption(0, -86, lede)];
  (['Presentation', 'Whiteboard'] as const).forEach((name, f) => {
    const fx = f * (W + GAP);
    out.push(frame(fx, 0, W, H, name));
    items.slice(0, 4).forEach((item, i) => {
      const x = fx + 40 + (i % 2) * 560;
      const y = 60 + Math.floor(i / 2) * 400;
      const sketch = f === 1;
      out.push('chart' in item ? chart(x, y, item.chart, sketch) : table(x, y, item.table, sketch));
    });
  });
  return out;
}

const plot = (kind: ChartSpec['kind'], over: Partial<ChartSpec>): ChartSpec => ({ ...defaultChartSpec(kind), ...over });

export const SCIENCE_TEMPLATES: Template[] = [
  {
    id: 'sci-functions',
    featured: true,
    category: 'science',
    name: 'Functions & waves',
    blurb: 'Curves, coordinate systems and waves — clean beside a whiteboard sketch.',
    teaches: ['Function plots', 'Parametric', 'Polar', 'Sketch mode'],
    build: () =>
      boards('Functions & waves', 'The same four plots, presentation-ready and hand-drawn.', [
        {
          chart: plot('function', {
            title: 'sin x and cos x',
            subtitle: 'a quarter turn apart',
            functions: [{ source: 'sin(x)' }, { source: 'cos(x)' }],
            xMin: -TAU,
            xMax: TAU,
            equalAxes: false,
          }),
        },
        {
          chart: plot('implicit', {
            title: 'Circle and ellipse',
            subtitle: 'x² + y² = 9 and x²/16 + y²/4 = 1',
            functions: [{ source: 'x^2 + y^2 - 9' }, { source: 'x^2/16 + y^2/4 - 1' }],
          }),
        },
        {
          chart: plot('parametric', {
            title: 'Lissajous figure, 3 : 2',
            functions: [{ source: 'sin(3t)' }, { source: 'sin(2t)' }],
            xMin: 0,
            xMax: TAU,
          }),
        },
        {
          chart: plot('polarPlot', {
            title: 'Rose, r = cos 4a',
            functions: [{ source: 'cos(4a)' }],
            xMin: 0,
            xMax: TAU,
          }),
        },
      ]),
  },
  {
    id: 'sci-statistics',
    category: 'science',
    name: 'Probability & statistics',
    blurb: 'The normal curve, densities, spreads and a histogram — ready to teach from.',
    teaches: ['Distributions', 'Box plots', 'Density', 'Sketch mode'],
    build: () =>
      boards('Probability & statistics', 'Four ways to look at a distribution, clean and sketched.', [
        {
          chart: plot('function', {
            title: 'The standard normal',
            subtitle: 'about 68% of the area lies within one σ',
            functions: [{ source: 'gauss(x)' }],
            xMin: -4,
            xMax: 4,
            fillArea: true,
            integralBounds: { a: -1, b: 1 },
            equalAxes: false,
          }),
        },
        { chart: { ...defaultChartSpec('histogram'), showKde: true, title: 'Response times, with density' } },
        { chart: defaultChartSpec('boxPlot') },
        {
          chart: {
            ...defaultChartSpec('density'),
            title: 'Symmetric against skewed',
            series: [
              { name: 'Symmetric', values: [42, 45, 46, 47, 48, 48, 49, 49, 50, 50, 50, 51, 51, 52, 52, 53, 54, 55, 57, 58] },
              { name: 'Skewed', values: [31, 32, 33, 33, 34, 34, 35, 35, 36, 37, 38, 40, 42, 45, 49, 54, 60, 67, 75, 86] },
            ],
            valueSuffix: undefined,
          },
        },
      ]),
  },
  {
    id: 'sci-graphs',
    category: 'science',
    name: 'Graph theory',
    blurb: 'Networks, a wheel and a complete graph, and the matrix behind them.',
    teaches: ['Network graphs', 'Adjacency', 'Heatmaps', 'Sketch mode'],
    build: () => {
      const people = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus'];
      const links = defaultChartSpec('network').series;
      const five = ['A', 'B', 'C', 'D', 'E'];
      const wheel = ['Hub', 'A', 'B', 'C', 'D', 'E', 'F'];
      const w = (i: number, j: number) => {
        if (i === j) return 0;
        if (i === 0 || j === 0) return 2;
        const d = Math.abs(i - j);
        return d === 1 || d === wheel.length - 2 ? 1 : 0;
      };
      return boards('Graph theory', 'Who connects to whom — as a graph, and as the matrix that defines it.', [
        { chart: defaultChartSpec('network') },
        {
          chart: {
            kind: 'matrix',
            title: 'Its adjacency matrix',
            categories: people,
            series: links,
            ramp: 'magma',
            rampReversed: true,
            showValues: true,
          },
        },
        {
          chart: {
            kind: 'network',
            title: 'Complete graph K₅',
            categories: five,
            series: five.map((name, i) => ({ name, values: five.map((_, j) => (i === j ? 0 : 1)) })),
            curved: true,
          },
        },
        {
          chart: {
            kind: 'network',
            title: 'Wheel graph W₇',
            categories: wheel,
            series: wheel.map((name, i) => ({ name, values: wheel.map((_, j) => w(i, j)) })),
          },
        },
      ]);
    },
  },
  {
    id: 'sci-lab',
    category: 'science',
    name: 'Experimental physics',
    blurb: "Hooke's law from raw measurements: the table, the fit, the model and the plan.",
    teaches: ['Tables', 'Trendlines', 'Models', 'Timelines'],
    build: () =>
      boards("Hooke's law, measured", 'A spring stretched eight times — data, fit, model and schedule.', [
        {
          table: {
            cells: [
              ['Trial', 'Force (N)', 'Extension (mm)', 'Stiffness (N/mm)'],
              ['1', '0.5', '2.1', '0.238'],
              ['2', '1.0', '4.0', '0.250'],
              ['3', '1.5', '6.2', '0.242'],
              ['4', '2.0', '7.9', '0.253'],
              ['5', '2.5', '10.1', '0.248'],
              ['6', '3.0', '12.2', '0.246'],
              ['7', '3.5', '13.8', '0.254'],
              ['8', '4.0', '16.1', '0.248'],
            ],
            columns: [
              { width: 0.7, type: 'text' },
              { width: 1, type: 'number' },
              { width: 1.2, type: 'number' },
              { width: 1.4, type: 'number' },
            ],
            header: true,
            theme: 'striped',
            fontSize: 13,
          },
        },
        {
          chart: {
            kind: 'scatter',
            title: 'Extension against force',
            subtitle: 'the slope is 1 / k',
            categories: ['0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4'],
            series: [{ name: 'Extension', values: [2.1, 4.0, 6.2, 7.9, 10.1, 12.2, 13.8, 16.1] }],
            showTrendline: true,
            xAxisLabel: 'Force (N)',
            yAxisLabel: 'Extension (mm)',
          },
        },
        {
          chart: plot('function', {
            title: 'A damped oscillator',
            subtitle: 'x(t) = e^(−t/4) cos 3t, inside its envelope',
            functions: [{ source: 'exp(-x/4) * cos(3x)' }, { source: 'exp(-x/4)', style: 'dashed' }, { source: '-exp(-x/4)', style: 'dashed' }],
            xMin: 0,
            xMax: 12,
            equalAxes: false,
          }),
        },
        {
          chart: {
            kind: 'timeline',
            title: 'Experiment plan',
            categories: ['Calibrate', 'Trials', 'Analysis', 'Write-up', 'Review'],
            series: [
              { name: 'Start', values: [1, 2, 6, 8, 10] },
              { name: 'End', values: [2, 6, 9, 10, null] },
            ],
            xAxisLabel: 'Day',
            reference: { value: 5, label: 'Today' },
          },
        },
      ]),
  },
];
