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
  category?: 'Calculus' | 'Physics' | 'Machine Learning' | 'Geometry' | 'Fields';
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
  // ------------------------------------------------------------------ implicit
  {
    id: 'conics',
    name: 'Circle and hyperbola',
    note: 'two curves that are not functions of x',
    kind: 'implicit',
    spec: {
      title: 'Conic sections',
      // Neither passes the vertical-line test, which is the whole reason
      // implicit form exists -- and the hyperbola is the shape that exposes a
      // marching-squares implementation that does not resolve its saddle.
      functions: [{ source: 'x^2 + y^2 - 9' }, { source: 'x^2 - y^2 - 4' }],
      xMin: -6, xMax: 6, yPlotMin: -6, yPlotMax: 6, resolution: 90,
    },
  },
  {
    id: 'cassini',
    name: 'Cassini ovals',
    note: 'one curve that splits into two as it changes',
    kind: 'implicit',
    spec: {
      title: 'Cassini oval',
      // At b = a the oval pinches into a lemniscate; either side it is one
      // loop or two. A single expression whose *topology* changes is the case
      // no point-sampling plotter can follow.
      functions: [{ source: '(x^2 + y^2)^2 - 2*4*(x^2 - y^2) - (2.2^4 - 4^2)' }],
      xMin: -4, xMax: 4, yPlotMin: -3, yPlotMax: 3, resolution: 120,
    },
  },
  {
    id: 'folium',
    name: 'Folium of Descartes',
    note: 'a loop and two asymptotic arms',
    kind: 'implicit',
    spec: {
      title: 'x³ + y³ = 3xy',
      functions: [{ source: 'x^3 + y^3 - 3*x*y' }],
      xMin: -3, xMax: 3, yPlotMin: -3, yPlotMax: 3, resolution: 110,
    },
  },
  {
    id: 'lemniscate',
    name: 'Lemniscate',
    note: 'the figure eight, crossing itself at the origin',
    kind: 'implicit',
    spec: {
      title: 'Lemniscate of Bernoulli',
      functions: [{ source: '(x^2 + y^2)^2 - 4*(x^2 - y^2)' }],
      xMin: -3, xMax: 3, yPlotMin: -2, yPlotMax: 2, resolution: 120,
    },
  },

  // ------------------------------------------------------------------- contour
  {
    id: 'saddle',
    name: 'Saddle',
    note: 'level curves that split rather than nest',
    kind: 'contour',
    spec: {
      title: 'sin(x)·cos(y)',
      functions: [{ source: 'sin(x) * cos(y)' }],
      xMin: -6, xMax: 6, yPlotMin: -6, yPlotMax: 6, resolution: 100, levels: 9,
    },
  },
  {
    id: 'hill',
    name: 'Gaussian hill',
    note: 'nested rings, the shape a peak makes',
    kind: 'contour',
    spec: {
      title: 'A single peak',
      functions: [{ source: 'exp(-(x^2 + y^2) / 4)' }],
      xMin: -5, xMax: 5, yPlotMin: -5, yPlotMax: 5, resolution: 90, levels: 10,
    },
  },
  {
    id: 'ripple',
    name: 'Ripple',
    note: 'concentric waves from a centre',
    kind: 'contour',
    spec: {
      title: 'sin(√(x²+y²))',
      functions: [{ source: 'sin(sqrt(x^2 + y^2))' }],
      xMin: -10, xMax: 10, yPlotMin: -10, yPlotMax: 10, resolution: 120, levels: 8,
    },
  },
  {
    id: 'potential',
    name: 'Two charges',
    note: 'a potential field, drawn as equipotentials',
    kind: 'contour',
    spec: {
      title: 'Equipotentials',
      // Two poles of opposite sign: the contours crowd near each charge and
      // flatten to a straight line halfway between them.
      functions: [{ source: '1/sqrt((x-2)^2 + y^2 + 0.05) - 1/sqrt((x+2)^2 + y^2 + 0.05)' }],
      xMin: -6, xMax: 6, yPlotMin: -4, yPlotMax: 4, resolution: 130, levels: 14,
    },
  },

  // ---------------------------------------------------------------- slope field
  {
    id: 'slope-linear',
    name: 'dy/dx = y − x',
    note: 'the family of solutions, before solving anything',
    kind: 'slopeField',
    spec: {
      title: "dy/dx = y − x",
      functions: [{ source: 'y - x' }],
      xMin: -5, xMax: 5, yPlotMin: -5, yPlotMax: 5, resolution: 18,
    },
  },
  {
    id: 'slope-logistic',
    name: 'Logistic growth',
    note: 'every solution bending toward the carrying capacity',
    kind: 'slopeField',
    spec: {
      title: 'dy/dx = y(1 − y)',
      // The two equilibria are visible as flat rows at y = 0 and y = 1, which
      // is the thing a slope field shows and an algebraic solution hides.
      functions: [{ source: 'y * (1 - y)' }],
      xMin: -4, xMax: 4, yPlotMin: -0.6, yPlotMax: 1.6, resolution: 20,
    },
  },
  {
    id: 'slope-circular',
    name: 'Circular flow',
    note: 'slopes whose solutions are circles',
    kind: 'slopeField',
    spec: {
      title: 'dy/dx = −x / y',
      functions: [{ source: '-x / y' }],
      xMin: -4, xMax: 4, yPlotMin: -4, yPlotMax: 4, resolution: 18,
    },
  },

  // --------------------------------------------------------------- vector field
  {
    id: 'rotation',
    name: 'Rotation',
    note: 'circulation about the origin',
    kind: 'vectorField',
    spec: {
      title: '⟨−y, x⟩',
      functions: [{ source: '-y' }, { source: 'x' }],
      xMin: -5, xMax: 5, yPlotMin: -5, yPlotMax: 5, resolution: 15,
    },
  },
  {
    id: 'source-sink',
    name: 'Source and sink',
    note: 'arrows growing outward, and where they do not',
    kind: 'vectorField',
    spec: {
      title: '⟨x, −y⟩',
      // A saddle: outward along x, inward along y. The magnitudes matter here,
      // which is the difference between this and a slope field.
      functions: [{ source: 'x' }, { source: '-y' }],
      xMin: -4, xMax: 4, yPlotMin: -4, yPlotMax: 4, resolution: 14,
    },
  },
  {
    id: 'gradient',
    name: 'Gradient field',
    note: 'the steepest ascent of a surface',
    kind: 'vectorField',
    category: 'Physics',
    spec: {
      title: '∇(x² + y²)/4',
      functions: [{ source: 'x / 2' }, { source: 'y / 2' }],
      xMin: -4, xMax: 4, yPlotMin: -4, yPlotMax: 4, resolution: 14,
    },
  },
  {
    id: 'shear',
    name: 'Shear flow',
    note: 'speed varying across the channel',
    kind: 'vectorField',
    category: 'Physics',
    spec: {
      title: '⟨y, 0⟩',
      functions: [{ source: 'y' }, { source: '0*x' }],
      xMin: -4, xMax: 4, yPlotMin: -3, yPlotMax: 3, resolution: 14,
    },
  },

  // -------------------------------------------------------- Machine Learning & AI
  {
    id: 'gelu',
    name: 'GELU Activation',
    note: 'the smooth probabilistic gate powering transformers',
    kind: 'function',
    category: 'Machine Learning',
    spec: {
      title: 'GELU(x)',
      functions: [{ source: '0.5 * x * (1 + tanh(0.797884 * (x + 0.044715 * x^3)))' }],
      xMin: -4,
      xMax: 4,
    },
  },
  {
    id: 'relu-family',
    name: 'ReLU & Leaky ReLU',
    note: 'piecewise non-linearities and gradient flow',
    kind: 'function',
    category: 'Machine Learning',
    spec: {
      title: 'ReLU vs Leaky ReLU',
      functions: [{ source: 'max(0, x)' }, { source: 'max(0.1*x, x)' }],
      xMin: -4,
      xMax: 4,
    },
  },
  {
    id: 'swish-silu',
    name: 'Swish / SiLU',
    note: 'self-gated activation with a non-monotonic valley',
    kind: 'function',
    category: 'Machine Learning',
    spec: {
      title: 'Swish: x · σ(x)',
      functions: [{ source: 'x / (1 + exp(-x))' }],
      xMin: -5,
      xMax: 5,
    },
  },
  {
    id: 'softplus',
    name: 'Softplus',
    note: 'smooth differentiable approximation to the rectifier',
    kind: 'function',
    category: 'Machine Learning',
    spec: {
      title: 'ln(1 + e^x)',
      functions: [{ source: 'ln(1 + exp(x))' }, { source: 'max(0, x)' }],
      xMin: -4,
      xMax: 4,
    },
  },

  // ---------------------------------------------------- Physics & Dynamic Systems
  {
    id: 'wave-packet',
    name: 'Wave packet',
    note: 'localized carrier wave modulated by a Gaussian envelope',
    kind: 'function',
    category: 'Physics',
    spec: {
      title: 'Wave Packet',
      functions: [
        { source: 'exp(-x^2 / 10) * cos(6*x)' },
        { source: 'exp(-x^2 / 10)' },
        { source: '-exp(-x^2 / 10)' },
      ],
      xMin: -8,
      xMax: 8,
      samples: 400,
    },
  },
  {
    id: 'witch-agnesi',
    name: 'Witch of Agnesi',
    note: 'classical bell-shaped cubic curve with Cauchy distribution form',
    kind: 'function',
    category: 'Geometry',
    spec: {
      title: 'y = 8 / (x² + 4)',
      functions: [{ source: '8 / (x^2 + 4)' }],
      xMin: -6,
      xMax: 6,
    },
  },
  {
    id: 'trefoil-knot',
    name: 'Trefoil knot projection',
    note: 'the simplest non-trivial knot projected onto 2D',
    kind: 'parametric',
    category: 'Geometry',
    spec: {
      title: 'Trefoil Knot',
      functions: [
        { source: 'sin(t) + 2*sin(2*t)' },
        { source: 'cos(t) - 2*cos(2*t)' },
      ],
      xMin: 0,
      xMax: Math.PI * 2,
      samples: 1000,
    },
  },
  {
    id: 'ballistic-drag',
    name: 'Ballistic flight with drag',
    note: 'aerodynamic trajectory with exponential terminal velocity',
    kind: 'parametric',
    category: 'Physics',
    spec: {
      title: 'Trajectory with Drag',
      functions: [
        { source: '18 * (1 - exp(-0.35*t))' },
        { source: '28 * (1 - exp(-0.35*t)) - 1.8*t' },
      ],
      xMin: 0,
      xMax: 6,
      samples: 400,
    },
  },
  {
    id: 'fermat-spiral',
    name: 'Fermat spiral',
    note: 'parabolic spiral mirroring phyllotaxis plant packing',
    kind: 'polarPlot',
    category: 'Geometry',
    spec: {
      title: 'r² = a (Fermat)',
      functions: [{ source: 'sqrt(a)' }],
      xMin: 0,
      xMax: Math.PI * 8,
      samples: 1200,
    },
  },
  {
    id: 'rose-8',
    name: 'Eight-petal rose',
    note: 'r = cos(4θ) exhibiting multi-fold rotational symmetry',
    kind: 'polarPlot',
    category: 'Geometry',
    spec: {
      title: 'r = cos(4a)',
      functions: [{ source: 'cos(4*a)' }],
      xMin: 0,
      xMax: Math.PI * 2,
      samples: 900,
    },
  },
  {
    id: 'van-der-pol',
    name: 'Van der Pol oscillator',
    note: 'phase plane showing limit cycle convergence',
    kind: 'slopeField',
    category: 'Physics',
    spec: {
      title: 'dy/dx = (1 - x²)y - x',
      functions: [{ source: '(1 - x^2)*y - x' }],
      xMin: -3.5,
      xMax: 3.5,
      yPlotMin: -3.5,
      yPlotMax: 3.5,
      resolution: 20,
    },
  },
  {
    id: 'lotka-volterra',
    name: 'Lotka-Volterra predator-prey',
    note: 'ecological population cycles around a neutral center',
    kind: 'vectorField',
    category: 'Physics',
    spec: {
      title: '⟨x(1 − 0.5y), −y(1 − 0.5x)⟩',
      functions: [{ source: 'x * (1 - 0.5*y)' }, { source: '-y * (1 - 0.5*x)' }],
      xMin: 0.1,
      xMax: 5,
      yPlotMin: 0.1,
      yPlotMax: 5,
      resolution: 16,
    },
  },
  {
    id: 'vortex-flow',
    name: 'Vortex flow',
    note: 'irrotational circulation with 1/r velocity decay',
    kind: 'vectorField',
    category: 'Physics',
    spec: {
      title: 'Point Vortex',
      functions: [
        { source: '-y / (x^2 + y^2 + 0.15)' },
        { source: 'x / (x^2 + y^2 + 0.15)' },
      ],
      xMin: -4,
      xMax: 4,
      yPlotMin: -4,
      yPlotMax: 4,
      resolution: 16,
    },
  },
  {
    id: 'doublet-flow',
    name: 'Aerodynamic doublet',
    note: 'source and sink coalescing at the origin',
    kind: 'slopeField',
    category: 'Physics',
    spec: {
      title: 'Doublet Flow',
      functions: [{ source: '(y^2 - x^2) / (2*x*y + 0.05)' }],
      xMin: -4,
      xMax: 4,
      yPlotMin: -4,
      yPlotMax: 4,
      resolution: 20,
    },
  },
];

/**
 * The presets grouped for the gallery, with the current kind's own first.
 *
 * Twenty-nine entries in one flat list is the wall the chart-type picker was
 * already fixed for. Grouping by kind is not enough on its own either: someone
 * editing a vector field wants vector fields, and making them scroll past
 * fourteen curves to reach four is the same fault at a smaller scale.
 *
 * So the current kind's group is lifted to the top and the rest follow in a
 * stable order. Stable, because a list that reorders itself as you work is one
 * you cannot build muscle memory against — only the *first* group moves, and
 * only when the kind changes.
 */
export function presetGroups(current: ChartKind): Array<{ kind: ChartKind; label: string; presets: PlotPreset[] }> {
  const order: ChartKind[] = [
    'function',
    'parametric',
    'polarPlot',
    'implicit',
    'contour',
    'slopeField',
    'vectorField',
  ];
  const ranked = [current, ...order.filter((k) => k !== current)];

  return ranked
    .map((kind) => ({
      kind,
      label: GROUP_LABELS[kind] ?? kind,
      presets: PLOT_PRESETS.filter((p) => p.kind === kind),
    }))
    .filter((g) => g.presets.length > 0);
}

const GROUP_LABELS: Partial<Record<ChartKind, string>> = {
  function: 'Functions',
  parametric: 'Parametric',
  polarPlot: 'Polar',
  implicit: 'Implicit',
  contour: 'Contours',
  slopeField: 'Slope fields',
  vectorField: 'Vector fields',
};

/** Turn a preset into a whole spec, keeping nothing of what was there. */
export function specFromPreset(preset: PlotPreset): ChartSpec {
  return { kind: preset.kind, ...base, ...preset.spec } as ChartSpec;
}
