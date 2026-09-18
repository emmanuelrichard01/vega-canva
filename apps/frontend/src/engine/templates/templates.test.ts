import { describe, expect, it } from 'vitest';
import { CATEGORIES, TEMPLATES, templateById } from './templates';
import { frameForNode } from '../model/frames';

/**
 * The gallery, checked for the faults that only appear once a board is opened.
 *
 * ## Why these are tests and not a review
 *
 * Every defect below shipped at least once, and not one of them was visible in
 * the code that caused it. A caption two words longer than expected is cut off
 * by the frame that owns it. A connector between two zones vanishes in the gap.
 * A `bolt` stretched to 300×74 is a smear. A quarter-planning lane silently
 * draws one card on top of another because two spans overlap by a week. All of
 * it type-checks, all of it builds, and all of it is obvious the moment
 * somebody opens the board — which is to say, after it has shipped.
 *
 * They are also the faults that multiply. There are forty-five boards here and
 * a person reviewing a new one cannot hold "does any text overflow its frame"
 * in their head for every node on it.
 *
 * ## The rules, and why each one exists
 *
 * - **A frame clips what it owns.** Ownership is by *centre* containment
 *   (`frameForNode`), so a node can be adopted by a frame it hangs out of and
 *   then be cut off by it. Anything inside a frame must fit inside it.
 * - **A connector between two frames is cut in the gap.** Its own midpoint
 *   decides its owner, and the clip follows — so the line disappears halfway.
 *   Zones on a diagram are therefore bands, not frames; see `templateKit.zone`.
 * - **An icon geometry is a picture.** Stretched past about 3:2 it stops being
 *   the thing it was chosen for, which is the only reason to use it over a
 *   rectangle.
 * - **A label must be readable on its own fill**, at 4.5:1. The tinted palette
 *   in `templateKit` is built for this; a hand-picked fill is where it breaks.
 * - **Two objects must not sit on top of each other.** Always a layout bug —
 *   an off-by-one span, or a scatter that does not know the size of what it is
 *   scattering.
 * - **`objectCount` is a claim on the card**, and the card says "502 objects"
 *   to somebody who can open the board and count them.
 */

/** Geometries that read as a picture of an object and distort when stretched. */
const ICONIC = new Set([
  'globe', 'shield', 'key', 'bolt', 'gear', 'user', 'mail', 'package', 'cpu',
  'mobile', 'desktop', 'browser', 'terminal', 'heart', 'star', 'plane', 'pin',
  'cross', 'donut', 'cloud', 'badge',
]);

/** The board's own ground in the light theme. See DESIGN.md. */
const CANVAS = '#F9FAFB';

const srgb = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgb(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Node = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : 0);

/** Every template, built once, so forty-five boards are not rebuilt per assertion. */
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

describe('every template', () => {
  it('builds without throwing, and builds something', () => {
    for (const { template, nodes } of BOARDS) {
      expect(nodes.length, `${template.id} built nothing`).toBeGreaterThan(0);
    }
  });

  it('has a unique id and a category the gallery renders', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(CATEGORIES.map((c) => c.id));
    for (const t of TEMPLATES) {
      expect(known.has(t.category), `${t.id} is in "${t.category}", which no chip shows`).toBe(true);
      expect(templateById(t.id)).toBe(t);
    }
  });

  it('gives every node a positive box', () => {
    expect(
      problems(({ nodes }) =>
        nodes
          .filter((n) => n.type !== 'connector' && (num(n.width) <= 0 || num(n.height) <= 0))
          .map((n) => `${n.type} is ${num(n.width)}×${num(n.height)}`)
      )
    ).toEqual([]);
  });
});

describe('frames, which clip whatever they own', () => {
  it('never cuts off the content inside them', () => {
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
          return past.length ? [`${n.type} "${String(n.text ?? '').slice(0, 24)}" hangs past the ${past.join(' and ')} edge`] : [];
        })
      )
    ).toEqual([]);
  });

  it('never runs a connector between two different frames', () => {
    expect(
      problems(({ nodes, ownerOf }) =>
        nodes.flatMap((n) => {
          if (n.type !== 'connector') return [];
          const from = ownerOf.get((n.from as { nodeId: string }).nodeId) ?? null;
          const to = ownerOf.get((n.to as { nodeId: string }).nodeId) ?? null;
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
            : (['from', 'to'] as const)
                .map((end) => (n[end] as { nodeId?: string })?.nodeId)
                .filter((target) => !target || !ids.has(target))
                .map((target) => `dangling end → ${target ?? 'undefined'}`)
        );
      })
    ).toEqual([]);
  });

  it('are drawn beneath the objects they join', () => {
    // `layer()` guarantees this. Without it, an arrow crossing the board is
    // drawn over every label between its two ends.
    expect(
      problems(({ nodes }) => {
        const lastWire = nodes.reduce((last, n, i) => (n.type === 'connector' ? i : last), -1);
        if (lastWire < 0) return [];
        const contentAbove = nodes.findIndex(
          (n, i) => i < lastWire && n.type !== 'connector' && n.type !== 'frame' && String(n.text ?? '').trim().length > 0
        );
        return contentAbove >= 0
          ? [`a labelled ${nodes[contentAbove].type} is drawn under a connector — pass the build through layer()`]
          : [];
      })
    ).toEqual([]);
  });
});

describe('shapes', () => {
  it('never stretches a geometry that is a picture of something', () => {
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

  it('keeps every label readable on what it sits on', () => {
    expect(
      problems(({ nodes }) =>
        nodes.flatMap((n) => {
          const text = String(n.text ?? '').trim();
          const ink = (n.typography as { color?: string } | undefined)?.color;
          if (!text || !ink) return [];
          const fills = (n.appearance as { fill?: Array<{ color?: string }> } | undefined)?.fill;
          const ground = Array.isArray(fills) && fills.length ? fills[0]?.color : n.type === 'text' ? CANVAS : undefined;
          if (!ground) return [];
          const ratio = contrastRatio(ink, ground);
          return ratio !== null && ratio < 4.5
            ? [`"${text.slice(0, 22)}" is ${ratio.toFixed(2)}:1 (${ink} on ${ground})`]
            : [];
        })
      )
    ).toEqual([]);
  });
});

describe('layout', () => {
  it('never draws two objects on top of one another', () => {
    expect(
      problems(({ nodes }) => {
        // Content against content. A caption over a plain band, or a label
        // inside an unlabelled ground, is the intended arrangement.
        const solid = nodes.filter((n) =>
          n.type === 'shape'
            ? String(n.text ?? '').trim().length > 0
            : n.type === 'sticky' || n.type === 'chart' || n.type === 'table' || n.type === 'code'
        );
        const out: string[] = [];
        for (let i = 0; i < solid.length; i++) {
          for (let j = i + 1; j < solid.length; j++) {
            const a = solid[i];
            const b = solid[j];
            const w = Math.min(num(a.x) + num(a.width), num(b.x) + num(b.width)) - Math.max(num(a.x), num(b.x));
            const h = Math.min(num(a.y) + num(a.height), num(b.y) + num(b.height)) - Math.max(num(a.y), num(b.y));
            if (w <= 0 || h <= 0) continue;
            const smaller = Math.min(num(a.width) * num(a.height), num(b.width) * num(b.height));
            if ((w * h) / smaller > 0.12) {
              out.push(`"${String(a.text ?? a.type).slice(0, 18)}" covers "${String(b.text ?? b.type).slice(0, 18)}"`);
            }
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
        template.objectCount === undefined || template.objectCount === nodes.length
          ? []
          : [`card says ${template.objectCount} objects, board builds ${nodes.length}`]
      )
    ).toEqual([]);
  });

  it('is honoured by the preview limit, so a thumbnail is cheap', () => {
    for (const { template } of BOARDS) {
      if (!template.objectCount || template.objectCount < 200) continue;
      // The gallery draws forty-five of these at once; a board that ignores
      // its limit froze the page it was drawn on.
      expect(template.build(150).length, `${template.id} ignores its limit`).toBeLessThanOrEqual(200);
    }
  });
});
