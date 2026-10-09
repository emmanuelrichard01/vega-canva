import { describe, expect, it } from 'vitest';
import { PRODUCT } from './product';
import { gridModules } from './productKit';
import { wrappedLines } from '../templateKit';
import { textBox } from '../../model/stickyFooter';
import { STICKY_LINE_HEIGHT } from '../../model/stickyText';
import { STICKY_PADDING } from '../../model/stickyThemes';

type Node = { id: string; type: string; x: number; y: number; width: number; height: number; [k: string]: unknown };
const build = (id: string, limit?: number) => PRODUCT.find((t) => t.id === id)!.build(limit) as unknown as Node[];
/** Everything about a node except its id, which is fresh on every build. */
const shape = (nodes: Node[]) => nodes.map(({ id: _id, ...rest }) => JSON.stringify(rest).replace(/"(nodeId|tableId|id)":"[^"]+"/g, ''));

describe('the product boards', () => {
  it('draw the same board on every build, so the card is the board', () => {
    for (const t of PRODUCT) expect(shape(t.build() as unknown as Node[]), t.id).toEqual(shape(t.build() as unknown as Node[]));
  });

  it('keep every word on a frame, where it reads in both themes', () => {
    const bad = PRODUCT.flatMap((t) => {
      const nodes = t.build() as unknown as Node[];
      const frames = nodes.filter((n) => n.type === 'frame');
      return nodes
        .filter((n) => n.type === 'text' || (n.type === 'shape' && String(n.text ?? '').trim()))
        .filter((n) => {
          const cx = n.x + n.width / 2;
          const cy = n.y + n.height / 2;
          return !frames.some((f) => cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height);
        })
        .map((n) => `${t.id}: "${String(n.text).slice(0, 30)}" is on the open board`);
    });
    expect(bad).toEqual([]);
  });

  it('write every sticky at a size its words fit, not only at the smallest', () => {
    // The catalogue check proves a note fits at the auto-fit floor; these are
    // written at a fixed size, so they must fit at that size.
    const caveat = (s: string, size: number) => s.length * size * 0.45;
    const bad = PRODUCT.flatMap((t) =>
      (t.build() as unknown as Node[])
        .filter((n) => n.type === 'sticky')
        .flatMap((n) => {
          const size = n.fontSize as number;
          const box = textBox(n.width, n.height, STICKY_PADDING, false);
          // A checklist line carries its box in front of the words.
          const width = n.checklist ? box.width - size * 1.2 : box.width;
          const text = String(n.text).replace(/^\[[ x]\] /gm, '');
          const need = wrappedLines(text, width, (s) => caveat(s, size)) * size * STICKY_LINE_HEIGHT;
          return need > box.height ? [`${t.id}: "${text.slice(0, 30)}" needs ${Math.round(need)}px at ${size}px, has ${Math.round(box.height)}`] : [];
        })
    );
    expect(bad).toEqual([]);
  });

  it('give owners and stamps to real teammates', () => {
    const nodes = PRODUCT.flatMap((t) => t.build() as unknown as Node[]).filter((n) => n.type === 'sticky');
    const owned = nodes.filter((n) => n.author);
    expect(owned.length).toBeGreaterThan(20);
    for (const n of owned) expect((n.author as { id: string }).id).toMatch(/^nw-/);
    for (const n of nodes)
      for (const ids of Object.values(n.reactions as Record<string, string[]>)) {
        expect(new Set(ids).size, 'one stamp per person').toBe(ids.length);
        for (const id of ids) expect(id).toMatch(/^nw-/);
      }
  });

  it('read every linked chart from the rows its table holds', () => {
    for (const t of PRODUCT) {
      const nodes = t.build() as unknown as Node[];
      for (const c of nodes.filter((n) => n.type === 'chart')) {
        const spec = c.chart as { categories: string[]; series: Array<{ values: Array<number | null> }>; link?: { tableId: string; r1: number } };
        expect(spec.link, `${t.id} chart is linked`).toBeDefined();
        const table = nodes.find((n) => n.id === spec.link!.tableId)!;
        const cells = (table.table as { cells: string[][] }).cells;
        expect(spec.categories, t.id).toEqual(cells.slice(1, spec.link!.r1 + 1).map((r) => r[(c.chart as { link: { c0: number } }).link.c0]));
        for (const s of spec.series) expect(s.values.every((v) => typeof v === 'number'), `${t.id} series resolved`).toBe(true);
      }
    }
  });

  it('keep the design sprint’s cover under budget by leaving out the crazy-8s drawings', () => {
    expect(build('product-design-sprint', 150).length).toBeLessThanOrEqual(200);
    expect(build('product-design-sprint').length).toBeGreaterThan(build('product-design-sprint', 150).length);
  });
});

describe('gridModules', () => {
  it('lays out modules the way a modular grid with spans numbers them', () => {
    const m = gridModules(0, 0, 400, 300, { rows: 3, cols: 4, gutter: 0, spans: { '0:0': { rows: 2, cols: 2 } } });
    expect(m).toHaveLength(9);
    expect(m[0]).toMatchObject({ x: 0, y: 0, width: 200, height: 200 });
    expect(m[1]).toMatchObject({ x: 200, y: 0, width: 100, height: 100, row: 0, col: 2 });
    expect(m[3]).toMatchObject({ x: 200, y: 100, row: 1, col: 2 });
  });
});
