import { describe, expect, it } from 'vitest';
import { CATEGORIES, FIRST_BOARD, SHOWCASE, TEMPLATES, templateById, type Template } from './templates';
import { textWidth, TINT, wrappedLines } from './templateKit';
import { frameForNode } from '../model/frames';
import { normalizeNode } from '../document/normalize';
import { shapeLabelBox } from '../model/shapes/labelBox';
import { textBox } from '../model/stickyFooter';
import { STICKY_PADDING } from '../model/stickyThemes';
import { overflowsAtMinimum, STICKY_LINE_HEIGHT } from '../model/stickyText';
import type { ShapeNode } from '../model/schema';

/**
 * The catalogue, checked for the faults that only appear once a board is opened.
 *
 * Every rule here exists because the fault type-checks, builds and reads as
 * correct in code, and is obvious the moment somebody opens the board:
 *
 * - **A frame clips what it owns.** Ownership is by *centre* containment
 *   (`frameForNode`), so a node hanging out of a frame is cut off by it, and a
 *   connector between two frames is adopted by one and vanishes in the gap.
 * - **Text must fit its box.** Measured with a conservative per-glyph estimate
 *   of Inter (and Caveat for notes), so a failure here is a real overflow.
 * - **Two objects must not sit on top of each other.** Content against
 *   content; a label over a plain band or inside a frame is intended.
 * - **An icon geometry is a picture**, and stretched past 3:2 it stops being one.
 * - **A label must read on its own fill**, at 4.5:1.
 * - **A chart's data link points at a real table, inside its grid.**
 * - **A board builds in under 50ms**, and generative boards honour `limit`.
 *
 * Failures name the template and the object, so a builder can fix them
 * without a debugger.
 */

/** Geometries that read as a picture of an object and distort when stretched. */
const ICONIC = new Set([
  'globe', 'shield', 'key', 'bolt', 'gear', 'user', 'mail', 'package', 'cpu',
  'mobile', 'desktop', 'browser', 'terminal', 'heart', 'star', 'plane', 'pin',
  'cross', 'donut', 'cloud', 'badge',
]);

/** The board's own ground in the light theme. See DESIGN.md. */
const CANVAS = '#F9FAFB';

/** A typical board, a generous budget on a slow CI runner. */
const BUILD_BUDGET_MS = 50;

const srgb = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgb(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Node = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const textOf = (n: Node) => String(n.text ?? '').trim();
const short = (n: Node) => `${n.type} "${(textOf(n) || String(n.id)).slice(0, 24)}"`;

// ---------------------------------------------------------------------------
// Text estimate
// ---------------------------------------------------------------------------

/** Room for the estimate's error before a box counts as overflowing. */
const SLACK = 1.04;

const longestWord = (text: string) => text.split(/\s+/).reduce((a, w) => (w.length > a.length ? w : a), '');

interface Type { fontSize: number; fontWeight: number; lineHeight: number }
const typeOf = (n: Node): Type => {
  const t = (n.typography ?? {}) as Partial<Type>;
  return { fontSize: num(t.fontSize) || 16, fontWeight: num(t.fontWeight) || 400, lineHeight: num(t.lineHeight) || 1.4 };
};

/** Why a node's text does not fit its box, or null when it does. */
function textOverflow(n: Node): string | null {
  const text = textOf(n);
  if (!text) return null;

  if (n.type === 'sticky') {
    const box = textBox(num(n.width), num(n.height), STICKY_PADDING, Array.isArray(n.tags) && n.tags.length > 0);
    const caveat = (s: string, size: number) => s.length * size * 0.45;
    const measure = (s: string, size: number, width: number) =>
      wrappedLines(s, width, (part) => caveat(part, size)) * size * STICKY_LINE_HEIGHT;
    return overflowsAtMinimum({ text, width: box.width, height: box.height, measure })
      ? `overflows its note even at the smallest size`
      : null;
  }

  const t = typeOf(n);
  const measure = (s: string) => textWidth(s, t.fontSize, t.fontWeight);

  let area: { width: number; height: number } | null = null;
  if (n.type === 'shape') area = shapeLabelBox(n as unknown as ShapeNode);
  else if (n.type === 'text') {
    const resize = n.resize ?? 'height';
    if (resize === 'width') {
      // A label that grows sideways: it must not grow far past the box it was given.
      const widest = Math.max(...text.split('\n').map(measure));
      return widest > num(n.width) * SLACK + 4
        ? `is ${Math.round(widest)}px wide on one unwrapped line, box is ${Math.round(num(n.width))} (wrap it: templateKit.paragraph)`
        : null;
    }
    area = { width: num(n.width), height: num(n.height) };
  }
  if (!area || area.width <= 0) return null;

  const word = longestWord(text);
  if (measure(word) > area.width + 2) return `breaks the word "${word}" (box ${Math.round(area.width)}px wide)`;
  const height = wrappedLines(text, area.width, measure) * t.fontSize * t.lineHeight;
  // Wrapped text in a fixed box is clipped; in a growing one it pushes into
  // whatever sits below. Either way the declared box is the promise.
  return height > area.height * SLACK + 4
    ? `needs ${Math.round(height)}px of height, has ${Math.round(area.height)}`
    : null;
}

// ---------------------------------------------------------------------------
// Boards, built once
// ---------------------------------------------------------------------------

/** Median of three builds after one warm-up, so a loaded runner's spike does not fail a board. */
function timeBuild(template: Template): number {
  template.build();
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    template.build();
    times.push(performance.now() - start);
  }
  return times.sort((x, y) => x - y)[1];
}

const BOARDS = TEMPLATES.map((template) => {
  const nodes = template.build() as unknown as Node[];
  const frames = nodes
    .filter((n) => n.type === 'frame')
    .map((n, i) => ({ id: n.id as string, x: num(n.x), y: num(n.y), width: num(n.width), height: num(n.height), zIndex: i }));
  const ownerOf = new Map<string, string | null>();
  for (const n of nodes) {
    ownerOf.set(
      n.id as string,
      frameForNode(
        { id: n.id as string, type: n.type as string, x: num(n.x), y: num(n.y), width: num(n.width), height: num(n.height) },
        frames
      )
    );
  }
  return { template, nodes, frames, ownerOf };
});

const problems = (find: (board: (typeof BOARDS)[number]) => string[]): string[] =>
  BOARDS.flatMap((board) => find(board).map((detail) => `${board.template.id}: ${detail}`));

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

describe('the catalogue', () => {
  it('has unique ids, shaped <category>-<slug>, in categories the gallery renders', () => {
    const ids = TEMPLATES.map((t) => t.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, 'duplicate template ids').toEqual([]);
    const known = new Set(CATEGORIES.map((c) => c.id));
    const bad = TEMPLATES.flatMap((t) => [
      ...(known.has(t.category) ? [] : [`${t.id} is in "${t.category}", which no tab shows`]),
      ...(new RegExp(`^${t.category}-[a-z0-9]+(-[a-z0-9]+)*$`).test(t.id) ? [] : [`${t.id} is not "${t.category}-<slug>"`]),
      ...(templateById(t.id) === t ? [] : [`${t.id} does not resolve by id`]),
    ]);
    expect(bad).toEqual([]);
  });

  it('gives every card a name, a one-line blurb and capability chips', () => {
    const bad = TEMPLATES.flatMap((t) => [
      ...(t.name.trim() ? [] : [`${t.id} has no name`]),
      ...(t.name.length <= 40 ? [] : [`${t.id} name is ${t.name.length} chars; a card fits about 40`]),
      ...(t.blurb.trim() ? [] : [`${t.id} has no blurb`]),
      ...(t.blurb.length <= 120 ? [] : [`${t.id} blurb is ${t.blurb.length} chars; keep it to one line`]),
      ...(t.teaches.length >= 2 ? [] : [`${t.id} teaches ${t.teaches.length} things; name at least two`]),
      ...(t.teaches.every((c) => c.trim() && c.length <= 24) ? [] : [`${t.id} has an empty or overlong chip`]),
      ...(t.accent === undefined || t.accent in TINT ? [] : [`${t.id} accent "${t.accent}" is not a palette tint`]),
    ]);
    expect(bad).toEqual([]);
  });

  it('keeps the showcase to a handful', () => {
    expect(TEMPLATES.filter((t) => t.featured).length).toBeLessThanOrEqual(8);
  });

  it('leads the gallery and the first-run screen with boards that exist', () => {
    // A renamed or unfeatured lead silently drops out of the showcase.
    expect(SHOWCASE.filter((id) => !templateById(id)?.featured)).toEqual([]);
    expect(FIRST_BOARD === null || templateById(FIRST_BOARD) !== undefined).toBe(true);
  });
});

describe('every template', () => {
  it('builds without throwing, and builds something', () => {
    expect(problems(({ nodes }) => (nodes.length > 0 ? [] : ['built nothing']))).toEqual([]);
  });

  it('builds in under 50ms', () => {
    expect(
      BOARDS.flatMap(({ template }) => {
        const ms = timeBuild(template);
        return ms <= BUILD_BUDGET_MS ? [] : [`${template.id}: builds in ${ms.toFixed(1)}ms`];
      })
    ).toEqual([]);
  });

  it('uses unique node ids', () => {
    expect(
      problems(({ nodes }) => {
        const seen = new Set<string>();
        return nodes.flatMap((n) => {
          const id = String(n.id ?? '');
          if (!id) return [`${n.type} has no id`];
          if (seen.has(id)) return [`id ${id} is used twice`];
          seen.add(id);
          return [];
        });
      })
    ).toEqual([]);
  });

  it('builds fresh ids every time, so two rooms never share them', () => {
    expect(
      BOARDS.flatMap(({ template, nodes }) => {
        const again = new Set(template.build().map((n) => (n as unknown as Node).id as string));
        return nodes.some((n) => again.has(n.id as string)) ? [`${template.id}: reuses ids across builds`] : [];
      })
    ).toEqual([]);
  });

  it('survives normalisation with its type, id and box intact', () => {
    expect(
      problems(({ nodes }) =>
        nodes.flatMap((n) => {
          let out;
          try {
            out = normalizeNode(n) as unknown as Node;
          } catch (error) {
            return [`${short(n)} throws in normalizeNode: ${(error as Error).message}`];
          }
          const lost = (['type', 'id'] as const).filter((k) => out[k] !== n[k]);
          if (n.type !== 'connector') {
            for (const k of ['x', 'y', 'width', 'height'] as const) if (num(out[k]) !== num(n[k])) lost.push(k as never);
          }
          return lost.length ? [`${short(n)} changes ${lost.join(', ')} in normalizeNode`] : [];
        })
      )
    ).toEqual([]);
  });

  it('gives every node a positive box', () => {
    expect(
      problems(({ nodes }) =>
        nodes
          .filter((n) => n.type !== 'connector' && (num(n.width) <= 0 || num(n.height) <= 0))
          .map((n) => `${short(n)} is ${num(n.width)}×${num(n.height)}`)
      )
    ).toEqual([]);
  });
});

describe('frames, which clip whatever they own', () => {
  it('never cut off the content inside them', () => {
    expect(
      problems(({ nodes, frames, ownerOf }) =>
        nodes.flatMap((n) => {
          if (n.type === 'frame' || n.type === 'connector') return [];
          const f = frames.find((x) => x.id === ownerOf.get(n.id as string));
          if (!f) return [];
          const past = [
            num(n.x) < f.x ? 'left' : '',
            num(n.y) < f.y ? 'top' : '',
            num(n.x) + num(n.width) > f.x + f.width ? 'right' : '',
            num(n.y) + num(n.height) > f.y + f.height ? 'bottom' : '',
          ].filter(Boolean);
          return past.length ? [`${short(n)} hangs past the ${past.join(' and ')} edge of its frame`] : [];
        })
      )
    ).toEqual([]);
  });

  it('never run a connector between two different frames', () => {
    expect(
      problems(({ nodes, ownerOf }) =>
        nodes.flatMap((n) => {
          if (n.type !== 'connector') return [];
          const from = ownerOf.get((n.from as { nodeId?: string })?.nodeId ?? '') ?? null;
          const to = ownerOf.get((n.to as { nodeId?: string })?.nodeId ?? '') ?? null;
          return from === to ? [] : [`connector spans ${from ?? 'the open board'} → ${to ?? 'the open board'}`];
        })
      )
    ).toEqual([]);
  });
});

describe('connectors', () => {
  it('always point at a node that is on the board', () => {
    expect(
      problems(({ nodes }) => {
        const ids = new Set(nodes.map((n) => n.id as string));
        return nodes.flatMap((n) =>
          n.type !== 'connector'
            ? []
            : (['from', 'to'] as const).flatMap((end) => {
                const at = n[end] as { nodeId?: string; x?: number; y?: number } | undefined;
                // A free end is a point, which is allowed; a bound end must resolve.
                if (at && at.nodeId === undefined && typeof at.x === 'number') return [];
                return at?.nodeId && ids.has(at.nodeId) ? [] : [`${end} end → ${at?.nodeId ?? 'nothing'}`];
              })
        );
      })
    ).toEqual([]);
  });

  it('are drawn beneath the objects they join', () => {
    // `layer()` guarantees this; without it an arrow crossing the board is
    // drawn over every label between its two ends.
    expect(
      problems(({ nodes }) => {
        const lastWire = nodes.reduce((last, n, i) => (n.type === 'connector' ? i : last), -1);
        if (lastWire < 0) return [];
        const contentAbove = nodes.findIndex(
          (n, i) => i < lastWire && n.type !== 'connector' && n.type !== 'frame' && textOf(n).length > 0
        );
        return contentAbove >= 0
          ? [`${short(nodes[contentAbove])} is drawn under a connector; pass the build through layer()`]
          : [];
      })
    ).toEqual([]);
  });
});

describe('data links', () => {
  it('point at a table on the board, inside its grid', () => {
    expect(
      problems(({ nodes }) => {
        const tables = new Map(nodes.filter((n) => n.type === 'table').map((n) => [n.id as string, n]));
        return nodes.flatMap((n) => {
          const link = (n.chart as { link?: { tableId: string; r0: number; c0: number; r1: number; c1: number } } | undefined)?.link;
          if (n.type !== 'chart' || !link) return [];
          const table = tables.get(link.tableId);
          if (!table) return [`${short(n)} links to missing table ${link.tableId}`];
          const cells = ((table.table as { cells?: string[][] } | undefined)?.cells ?? []);
          const cols = cells[0]?.length ?? 0;
          const inside =
            link.r0 >= 0 && link.c0 >= 0 && link.r0 <= link.r1 && link.c0 <= link.c1 && link.r1 < cells.length && link.c1 < cols;
          return inside ? [] : [`${short(n)} reads ${link.r0}:${link.c0}–${link.r1}:${link.c1} of a ${cells.length}×${cols} table`];
        });
      })
    ).toEqual([]);
  });
});

/** The visible solid fill of the nearest frame that owns `node`, if any. */
function owningGround(node: Record<string, any>, nodes: Array<Record<string, any>>): string | undefined {
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  let id = node.frameId as string | undefined;
  for (let depth = 0; id && depth < 16; depth++) {
    const frame = byId.get(id);
    if (!frame) return undefined;
    const paint = frame.appearance?.fill?.[0];
    if (frame.type === 'frame' && paint?.type === 'solid' && (paint.opacity ?? 1) >= 0.5) return paint.color as string;
    id = frame.frameId;
  }
  return undefined;
}

describe('text', () => {
  it('fits the box it is written in', () => {
    expect(
      problems(({ nodes }) =>
        nodes.flatMap((n) => {
          const why = textOverflow(n);
          return why ? [`${short(n)} ${why}`] : [];
        })
      )
    ).toEqual([]);
  });

  it('keeps every label readable on what it sits on', () => {
    expect(
      problems(({ nodes }) =>
        nodes.flatMap((n) => {
          const text = textOf(n);
          const ink = (n.typography as { color?: string } | undefined)?.color;
          if (!text || !ink) return [];
          const fills = (n.appearance as { fill?: Array<{ color?: string }> } | undefined)?.fill;
          // Free text sits on the fill of the frame that owns it, else the board.
          const ground = Array.isArray(fills) && fills.length ? fills[0]?.color : n.type === 'text' ? owningGround(n, nodes) ?? CANVAS : undefined;
          if (!ground) return [];
          const ratio = contrastRatio(ink, ground);
          return ratio !== null && ratio < 4.5 ? [`"${text.slice(0, 22)}" is ${ratio.toFixed(2)}:1 (${ink} on ${ground})`] : [];
        })
      )
    ).toEqual([]);
  });
});

describe('shapes', () => {
  it('never stretch a geometry that is a picture of something', () => {
    expect(
      problems(({ nodes }) =>
        nodes.flatMap((n) => {
          if (n.type !== 'shape') return [];
          const kind = (n.geometry as { kind?: string } | undefined)?.kind;
          if (!kind || !ICONIC.has(kind)) return [];
          const ratio = Math.max(num(n.width) / num(n.height), num(n.height) / num(n.width));
          return ratio > 1.5 ? [`${kind} at ${Math.round(num(n.width))}×${Math.round(num(n.height))} (${ratio.toFixed(2)}:1)`] : [];
        })
      )
    ).toEqual([]);
  });
});

/** Widest line of `text` wrapped greedily at `width`. */
function widestLine(text: string, width: number, measure: (s: string) => number): number {
  let widest = 0;
  const space = measure(' ');
  for (const paragraph of text.split('\n')) {
    let used = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const w = measure(word);
      if (used > 0 && used + space + w > width) {
        widest = Math.max(widest, used);
        used = w;
      } else used += (used > 0 ? space : 0) + w;
    }
    widest = Math.max(widest, used);
  }
  return widest;
}

/**
 * Where a node's content actually is. A text box is drawn as the lines in it,
 * aligned in its box, and a growing one takes the height its lines need: a
 * one-word heading in a box 1,500 wide covers nothing past its last letter.
 */
function inkBox(n: Node): { x: number; y: number; width: number; height: number } {
  const box = { x: num(n.x), y: num(n.y), width: num(n.width), height: num(n.height) };
  if (n.type !== 'text' || !textOf(n)) return box;
  const t = typeOf(n);
  const measure = (s: string) => textWidth(s, t.fontSize, t.fontWeight);
  const text = textOf(n);
  const grows = n.resize === 'width';
  const wide = grows ? Math.max(...text.split('\n').map(measure)) : Math.min(box.width, widestLine(text, box.width, measure));
  const lines = grows ? text.split('\n').length : wrappedLines(text, box.width, measure);
  const tall = lines * t.fontSize * t.lineHeight;
  const align = (n.typography as { align?: string } | undefined)?.align;
  const slack = Math.max(0, box.width - wide);
  return {
    x: box.x + (align === 'center' ? slack / 2 : align === 'right' ? slack : 0),
    y: box.y,
    width: wide,
    height: n.resize === 'fixed' ? Math.min(box.height, tall) : tall,
  };
}

/** Objects that carry content of their own. Bands, plain shapes and frames are grounds. */
const isContent = (n: Node) =>
  n.type === 'shape'
    ? textOf(n).length > 0
    : n.type !== 'connector' && n.type !== 'frame' && n.type !== 'path' && n.type !== 'pen' && n.type !== 'line' && n.type !== 'group';

describe('layout', () => {
  it('never draws two objects on top of one another', () => {
    expect(
      problems(({ nodes }) => {
        const solid = nodes.filter((n) => isContent(n) && !n.rotation).map((n) => ({ n, ...inkBox(n) }));
        const out: string[] = [];
        for (let i = 0; i < solid.length; i++) {
          for (let j = i + 1; j < solid.length; j++) {
            const a = solid[i];
            const b = solid[j];
            const w = Math.min(num(a.x) + num(a.width), num(b.x) + num(b.width)) - Math.max(num(a.x), num(b.x));
            if (w <= 0) continue;
            const h = Math.min(num(a.y) + num(a.height), num(b.y) + num(b.height)) - Math.max(num(a.y), num(b.y));
            if (h <= 0) continue;
            const areaA = num(a.width) * num(a.height);
            const areaB = num(b.width) * num(b.height);
            if ((w * h) / Math.min(areaA, areaB) <= 0.12) continue;
            // An icon, picture or emoji placed on a card is decoration on a
            // ground, the way a label on a shape is. Two things that both
            // carry words, or content on a chart or table, is a collision.
            const [inner, outer] = areaA <= areaB ? [a.n, b.n] : [b.n, a.n];
            const decoration = !textOf(inner) && outer.type === 'shape' && (w * h) / Math.min(areaA, areaB) > 0.98;
            if (!decoration) out.push(`${short(a.n)} covers ${short(b.n)}`);
          }
        }
        return out;
      })
    ).toEqual([]);
  });
});

describe('the claim on the card', () => {
  it('matches the number of objects the board actually builds', () => {
    expect(
      problems(({ template, nodes }) =>
        template.objectCount === undefined || Math.abs(template.objectCount - nodes.length) <= Math.max(2, nodes.length * 0.02)
          ? []
          : [`card says ${template.objectCount} objects, board builds ${nodes.length}`]
      )
    ).toEqual([]);
  });

  it('is honoured by the preview limit, so a cover is cheap', () => {
    expect(
      BOARDS.flatMap(({ template, nodes }) =>
        nodes.length < 200 || template.build(150).length <= 200 ? [] : [`${template.id} ignores its limit (${template.build(150).length} at 150)`]
      )
    ).toEqual([]);
  });
});
