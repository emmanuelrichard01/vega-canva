import type { ChartKind, ChartSpec } from './chartTypes';

/**
 * Curves worth having on a menu.
 *
 * ## Why a gallery, and why these
 *
 * A formula field is the most powerful control in this panel and the least
 * discoverable: it works perfectly and tells you nothing about what it can do.
 * Somebody who does not already know that `cos(2a)` draws a four-petal rose has
 * no way to find out from an empty text box, and the feature reads as "you can
 * type `x^2`".
 *
 * So the gallery is not a convenience — it is the documentation, in the only
 * form a graph can be documented in. Each entry is chosen to demonstrate one
 * capability rather than to be pretty:
 *
 * - `tan` exists to show the **asymptote handling**. It is the curve every
 *   naive plotter draws wrong, with vertical lines through the poles, and
 *   seeing it drawn correctly is the fastest way to know this one is not.
 * - `sinc` and the damped wave show **adaptive sampling**: both have regions
 *   that need many samples beside regions that need almost none.
 * - The butterfly and the rose show that **polar negative radii** are drawn on
 *   the opposite ray rather than dropped.
 * - The Lissajous figures show **parametric self-intersection**, which is the
 *   whole reason that form exists.
 *
 * Ordered by how much each teaches, not alphabetically — the first three are
 * the three somebody should see first.
 */

export interface PlotPreset {
  id: string;
  name: string;
  /** One line, saying what it demonstrates rather than what it is. */
  note: string;
  kind: ChartKind;
  spec: Omit<ChartSpec, 'kind' | 'categories' | 'series'>;
}

const base = { categories: [] as string[], series: [] };

export const PLOT_PRESETS: PlotPreset[] = [
  {
    id: 'trig',
    name: 'Sine and cosine',
    note: 'the pair, and how they sit against each other',
    kind: 'function',
    spec: {
      title: 'sin and cos',
      functions: [{ source: 'sin(x)' }, { source: 'cos(x)' }],
      xMin: -6.5,
      xMax: 6.5,
    },
  },
  {
    id: 'tangent',
    name: 'Tangent',
    note: 'breaks at its poles instead of drawing through them',
    kind: 'function',
    spec: {
      title: 'tan(x)',
      functions: [{ source: 'tan(x)' }],
      xMin: -4.8,
      xMax: 4.8,
      yMin: -6,
      yMax: 6,
      samples: 400,
    },
  },
  {
    id: 'damped',
    name: 'Damped oscillation',
    note: 'fast where it moves, sparse where it does not',
    kind: 'function',
    spec: {
      title: 'e^(-x/4) · sin(3x)',
      functions: [{ source: 'exp(-x/4) * sin(3x)' }, { source: 'exp(-x/4)' }, { source: '-exp(-x/4)' }],
      xMin: 0,
      xMax: 18,
      samples: 300,
    },
  },
  {
    id: 'sinc',
    name: 'Sinc',
    note: 'the signal-processing kernel, defined at zero',
    kind: 'function',
    spec: {
      title: 'sin(x)/x',
      functions: [{ source: 'sinc(x)' }],
      xMin: -18,
      xMax: 18,
      samples: 400,
    },
  },
  {
    id: 'gaussian',
    name: 'Normal distribution',
    note: 'the bell, and one standard deviation either side',
    kind: 'function',
    spec: {
      title: 'Standard normal',
      functions: [{ source: 'gauss(x)' }, { source: 'gauss(x - 2) / 2' }],
      xMin: -4.5,
      xMax: 6,
    },
  },
  {
    id: 'logistic',
    name: 'Logistic curve',
    note: 'saturating growth, the shape adoption actually takes',
    kind: 'function',
    spec: {
      title: 'Logistic',
      functions: [{ source: '1 / (1 + exp(-x))' }],
      xMin: -8,
      xMax: 8,
    },
  },
  {
    id: 'polynomial',
    name: 'Cubic and its slope',
    note: 'roots and turning points, where the two agree',
    kind: 'function',
    spec: {
      title: 'x³ − 3x',
      functions: [{ source: 'x^3 - 3x' }, { source: '3x^2 - 3' }],
      xMin: -3,
      xMax: 3,
      showRoots: true,
      showExtrema: true,
    },
  },
  {
    id: 'rose',
    name: 'Four-petal rose',
    note: 'negative radii drawn on the opposite ray',
    kind: 'polarPlot',
    spec: {
      title: 'r = cos(2a)',
      functions: [{ source: 'cos(2a)' }],
      xMin: 0,
      xMax: Math.PI * 2,
      samples: 720,
    },
  },
  {
    id: 'cardioid',
    name: 'Cardioid',
    note: 'the heart curve, one cusp',
    kind: 'polarPlot',
    spec: {
      title: 'r = 1 − cos(a)',
      functions: [{ source: '1 - cos(a)' }],
      xMin: 0,
      xMax: Math.PI * 2,
      samples: 720,
    },
  },
  {
    id: 'spiral',
    name: 'Archimedean spiral',
    note: 'a domain longer than one turn',
    kind: 'polarPlot',
    spec: {
      title: 'r = a / 6',
      functions: [{ source: 'a / 6' }],
      xMin: 0,
      xMax: Math.PI * 8,
      samples: 1200,
    },
  },
  {
    id: 'lissajous',
    name: 'Lissajous 3:2',
    note: 'a parametric curve that crosses itself',
    kind: 'parametric',
    spec: {
      title: 'Lissajous',
      functions: [{ source: 'sin(3t)' }, { source: 'sin(2t)' }],
      xMin: 0,
      xMax: Math.PI * 2,
      samples: 900,
    },
  },
  {
    id: 'butterfly',
    name: 'Butterfly',
    note: 'what the notation is capable of',
    kind: 'parametric',
    spec: {
      title: 'Butterfly curve',
      // Fay's butterfly. The long domain is the point: it takes many turns to
      // close, which is a thing the domain control makes visible.
      functions: [
        { source: 'sin(t) * (exp(cos(t)) - 2cos(4t) - sin(t/12)^5)' },
        { source: 'cos(t) * (exp(cos(t)) - 2cos(4t) - sin(t/12)^5)' },
      ],
      xMin: 0,
      xMax: Math.PI * 24,
      samples: 3000,
    },
  },
  {
    id: 'astroid',
    name: 'Astroid',
    note: 'four cusps, from a cubed sine and cosine',
    kind: 'parametric',
    spec: {
      title: 'Astroid',
      functions: [{ source: 'cos(t)^3' }, { source: 'sin(t)^3' }],
      xMin: 0,
      xMax: Math.PI * 2,
      samples: 600,
    },
  },
  {
    id: 'epicycloid',
    name: 'Epicycloid',
    note: 'a circle rolling around a circle',
    kind: 'parametric',
    spec: {
      title: 'Epicycloid',
      functions: [
        { source: '4cos(t) - cos(4t)' },
        { source: '4sin(t) - sin(4t)' },
      ],
      xMin: 0,
      xMax: Math.PI * 2,
      samples: 900,
    },
  },
];

/** Turn a preset into a whole spec, keeping nothing of what was there. */
export function specFromPreset(preset: PlotPreset): ChartSpec {
  return { kind: preset.kind, ...base, ...preset.spec } as ChartSpec;
}
