import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SYSTEMS } from './systems';
import { FAMILY, textHeight } from './systemsKit';
import { frameForNode } from '../../model/frames';
import { normalizeNode } from '../../document/normalize';
import { overflowsAtMinimum, STICKY_LINE_HEIGHT } from '../../model/stickyText';
import { textBox } from '../../model/stickyFooter';
import { STICKY_PADDING } from '../../model/stickyThemes';

/**
 * The systems boards, checked for what a reader would notice first.
 *
 * `templates.test.ts` holds every board to the gallery's rules. These are the
 * rules this set adds: everything sits on the board it belongs to, words fit
 * the cards they are written on, zone headings read on both themes, every
 * icon names artwork that exists, and charts read tables that are there.
 */

type Node = Record<string, any>;
const BOARDS = SYSTEMS.map((template) => ({ template, nodes: template.build() as unknown as Node[] }));

const PACKS = resolve(__dirname, '../../../../public/icon-packs');
const index = JSON.parse(readFileSync(resolve(PACKS, 'index.json'), 'utf8')) as {
  packs: Array<{ id: string; cats: Array<{ id: string; file: string }> }>;
};
const ICONS = new Set<string>();
for (const pack of index.packs) {
  for (const cat of pack.cats) {
    const file = JSON.parse(readFileSync(resolve(PACKS, cat.file), 'utf8')) as { icons: Array<{ i: string }> };
    for (const icon of file.icons) ICONS.add(`${pack.id}:${cat.id}/${icon.i}`);
  }
}

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const inside = (n: Node, box: Node) =>
  n.x >= box.x - 0.5 && n.y >= box.y - 0.5 && n.x + n.width <= box.x + box.width + 0.5 && n.y + n.height <= box.y + box.height + 0.5;

describe('the systems boards', () => {
  it('are seven, with unique ids in the systems category', () => {
    expect(SYSTEMS).toHaveLength(7);
    expect(new Set(SYSTEMS.map((t) => t.id)).size).toBe(SYSTEMS.length);
    for (const t of SYSTEMS) {
      expect(t.id.startsWith('systems-'), t.id).toBe(true);
      expect(t.category).toBe('systems');
      expect(t.teaches.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('build quickly', () => {
    for (const t of SYSTEMS) {
      t.build();
      const start = performance.now();
      t.build();
      expect(performance.now() - start, t.id).toBeLessThan(50);
    }
  });

  it('normalise every node they build', () => {
    for (const { template, nodes } of BOARDS) {
      for (const n of nodes) {
        const out = normalizeNode({ ...n }, n.id) as Node;
        expect(out.type, `${template.id}: ${n.type}`).toBe(n.type);
      }
    }
  });

  it('keep everything on the board frame', () => {
    for (const { template, nodes } of BOARDS) {
      const board = nodes[0];
      expect(board.type, template.id).toBe('frame');
      const outside = nodes.filter((n) => n !== board && n.type !== 'connector' && !inside(n, board));
      expect(outside.map((n) => `${template.id}: ${n.type} "${String(n.text ?? n.title ?? '').slice(0, 30)}"`)).toEqual([]);
    }
  });

  it('fit every word inside the surface it is written on', () => {
    for (const { template, nodes } of BOARDS) {
      const surfaces = nodes.filter((n) => n.type === 'shape' && !n.text && n.appearance?.fill?.[0]?.color === '#FFFFFF' && (n.appearance.fill[0].opacity ?? 1) === 1);
      const spilled: string[] = [];
      for (const t of nodes.filter((n) => n.type === 'text' || n.type === 'icon')) {
        const cx = t.x + t.width / 2;
        const cy = t.y + Math.min(t.height, 20) / 2;
        const on = surfaces
          .filter((s) => cx >= s.x && cx <= s.x + s.width && cy >= s.y && cy <= s.y + s.height)
          .sort((a, b) => a.width * a.height - b.width * b.height)[0];
        if (on && !inside(t, on)) spilled.push(`${template.id}: "${String(t.text ?? t.iconId).slice(0, 40)}"`);
      }
      expect(spilled).toEqual([]);
    }
  });

  it('give every text box the height its words need', () => {
    for (const { template, nodes } of BOARDS) {
      for (const t of nodes.filter((n) => n.type === 'text')) {
        const ty = t.typography;
        const need = textHeight(t.text, t.width, ty.fontSize, ty.lineHeight, ty.fontWeight);
        expect(t.height, `${template.id}: "${t.text.slice(0, 30)}"`).toBeGreaterThanOrEqual(need);
      }
    }
  });

  it('leave every sticky room for its words at the smallest size it will draw', () => {
    // Caveat at 0.45 em per glyph: the gallery's estimate, which errs long.
    const measure = (text: string, size: number, width: number) => {
      const perLine = Math.max(1, Math.floor(width / (size * 0.45)));
      let lines = 0;
      for (const para of text.split('\n')) {
        let used = 0;
        let count = 1;
        for (const word of para.split(' ')) {
          if (used === 0) used = word.length;
          else if (used + 1 + word.length <= perLine) used += 1 + word.length;
          else {
            count += 1;
            used = word.length;
          }
        }
        lines += count;
      }
      return lines * size * STICKY_LINE_HEIGHT;
    };
    for (const { template, nodes } of BOARDS) {
      for (const s of nodes.filter((n) => n.type === 'sticky')) {
        const box = textBox(s.width, s.height, STICKY_PADDING, (s.tags ?? []).length > 0);
        const over = overflowsAtMinimum({ text: s.text, width: box.width, height: box.height, measure });
        expect(over, `${template.id}: sticky "${s.text.slice(0, 30)}"`).toBe(false);
      }
    }
  });

  it('name icons that exist in the shipped packs', () => {
    for (const { template, nodes } of BOARDS) {
      const missing = nodes.filter((n) => n.type === 'icon' && !ICONS.has(`${n.pack}:${n.iconId}`));
      expect(missing.map((n) => `${template.id}: ${n.pack}:${n.iconId}`)).toEqual([]);
    }
  });

  it('link charts to a range of a table on the same board', () => {
    for (const { template, nodes } of BOARDS) {
      for (const c of nodes.filter((n) => n.type === 'chart' && n.chart.link)) {
        const link = c.chart.link;
        const table = nodes.find((n) => n.id === link.tableId);
        expect(table?.type, `${template.id}: chart "${c.chart.title}"`).toBe('table');
        expect(link.r1).toBeLessThan(table!.table.cells.length);
        expect(link.c1).toBeLessThan(table!.table.columns.length);
      }
    }
  });

  it('keep connectors out of the panels', () => {
    for (const { template, nodes } of BOARDS) {
      const frames = nodes
        .filter((n) => n.type === 'frame')
        .map((n, i) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, zIndex: i }));
      const owner = (id: string) => {
        const n = nodes.find((m) => m.id === id)!;
        return frameForNode({ id: n.id, type: n.type, x: n.x, y: n.y, width: n.width, height: n.height }, frames);
      };
      for (const w of nodes.filter((n) => n.type === 'connector')) {
        expect(owner(w.from.nodeId), `${template.id}: a wire crosses a panel edge`).toBe(owner(w.to.nodeId));
      }
    }
  });
});

describe('zone headings', () => {
  it('read at 4.5:1 on the light board and 3:1 (large text) on the dark one', () => {
    for (const [name, f] of Object.entries(FAMILY)) {
      expect(ratio(f.ink, '#F9FAFB'), `${name} on light`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(f.ink, '#09090B'), `${name} on dark`).toBeGreaterThanOrEqual(3);
    }
  });
});
