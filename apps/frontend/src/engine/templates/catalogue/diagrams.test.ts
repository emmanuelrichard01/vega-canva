import { describe, expect, it } from 'vitest';
import { DIAGRAMS, PKCE_MERMAID } from './diagrams';
import { breakLines } from './diagramsKit';
import { textWidth } from '../templateKit';
import { shapeLabelBox } from '../../model/shapes/labelBox';
import { parseSequence } from '../../diagram/sequence';
import type { ShapeNode } from '../../model/schema';

/**
 * The diagrams boards, checked for what a reader notices first.
 *
 * `templates.test.ts` holds every board to the gallery's rules. These are the
 * rules this set adds: labels keep a margin inside their symbol, words drawn
 * straight onto the board read on both themes, every decision says yes and
 * no, connectors bind to real things, and the Mermaid beside the sequence
 * diagram is the same conversation the drawing shows.
 */

type Node = Record<string, any>;
const BOARDS = DIAGRAMS.map((template) => ({ template, nodes: template.build() as unknown as Node[] }));
const board = (id: string) => BOARDS.find((b) => b.template.id === `diagrams-${id}`)!.nodes;

const LIGHT = '#F9FAFB';
const DARK = '#09090B';
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
const isSurface = (n: Node) =>
  (n.type === 'shape' && Array.isArray(n.appearance?.fill) && n.appearance.fill.length > 0 && (n.appearance.fill[0].opacity ?? 1) >= 0.9) ||
  n.type === 'sticky' ||
  n.type === 'table' ||
  n.type === 'code';

describe('the diagrams set', () => {
  it('is eight boards in the diagrams category, each naming what it shows off', () => {
    expect(DIAGRAMS).toHaveLength(8);
    for (const t of DIAGRAMS) {
      expect(t.id.startsWith('diagrams-'), t.id).toBe(true);
      expect(t.category).toBe('diagrams');
      expect(t.teaches.length, t.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('builds each board well inside the gallery budget', () => {
    for (const t of DIAGRAMS) {
      t.build();
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        t.build();
        best = Math.min(best, performance.now() - start);
      }
      expect(best, t.id).toBeLessThan(25);
    }
  });

  it('lays every board out inside its own frame', () => {
    for (const { template, nodes } of BOARDS) {
      const frame = nodes[0];
      expect(frame.type, template.id).toBe('frame');
      for (const n of nodes) {
        if (n === frame || n.type === 'connector') continue;
        expect(inside(n, frame), `${template.id}: ${n.type} "${String(n.text ?? '').slice(0, 30)}"`).toBe(true);
      }
    }
  });
});

describe('labels', () => {
  it('keep a margin inside the symbol they are written in', () => {
    const bad: string[] = [];
    for (const { template, nodes } of BOARDS) {
      for (const n of nodes) {
        if (n.type !== 'shape' || !n.text) continue;
        const area = shapeLabelBox(n as unknown as ShapeNode);
        const t = n.typography;
        // The renderer sets the author's lines; the widest must clear the box.
        const widest = Math.max(...String(n.text).split('\n').map((line: string) => textWidth(line, t.fontSize, t.fontWeight)));
        const room = n.geometry.kind === 'diamond' ? area.width : area.width - Math.min(16, area.width * 0.2);
        if (widest > room) bad.push(`${template.id}: "${n.text}" is ${Math.round(widest)}px in ${Math.round(room)}px`);
        const lines = String(n.text).split('\n').length;
        const tall = lines * t.fontSize * (t.lineHeight ?? 1.35);
        if (tall > area.height + 2) bad.push(`${template.id}: "${n.text}" is ${Math.round(tall)}px tall in ${Math.round(area.height)}px`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('read on the light board and the dark one when nothing is under them', () => {
    const bad: string[] = [];
    for (const { template, nodes } of BOARDS) {
      const grounds = nodes.filter(isSurface);
      for (const n of nodes) {
        if (n.type !== 'text' || grounds.some((g) => inside(n, g))) continue;
        const ink = n.typography.color as string;
        const size = n.typography.fontSize as number;
        // Free text is large on these boards: a zone or strip heading.
        if (size < 18) bad.push(`${template.id}: "${n.text}" is ${size}px straight on the board`);
        if (ratio(ink, LIGHT) < 3 || ratio(ink, DARK) < 3) bad.push(`${template.id}: "${n.text}" (${ink}) fails 3:1 on a theme`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('are broken without stranding a single word on the last line', () => {
    const text = '35% of teams still active in week 4';
    const lines = breakLines(text, 224, 13, 450).split('\n');
    expect(lines.length).toBe(2);
    expect(lines[1].split(' ').length).toBeGreaterThan(1);
  });
});

describe('connectors', () => {
  it('bind both ends to objects on the board, at anchors inside them', () => {
    for (const { template, nodes } of BOARDS) {
      const ids = new Set(nodes.map((n) => n.id));
      for (const c of nodes.filter((n) => n.type === 'connector')) {
        for (const end of [c.from, c.to]) {
          expect(ids.has(end.nodeId), template.id).toBe(true);
          if (end.anchor) {
            expect(end.anchor.u, template.id).toBeGreaterThanOrEqual(0);
            expect(end.anchor.u, template.id).toBeLessThanOrEqual(1);
            expect(end.anchor.v, template.id).toBeGreaterThanOrEqual(0);
            expect(end.anchor.v, template.id).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('give every decision a yes and a no', () => {
    for (const id of ['support-swimlane', 'choose-a-database']) {
      const nodes = board(id);
      const wires = nodes.filter((n) => n.type === 'connector');
      for (const diamond of nodes.filter((n) => n.geometry?.kind === 'diamond')) {
        const out = wires.filter((w) => w.from.nodeId === diamond.id).map((w) => String(w.labels?.[0]?.text ?? ''));
        expect(out.some((l) => l.startsWith('Yes')), `${id}: "${diamond.text}"`).toBe(true);
        expect(out.some((l) => l.startsWith('No')), `${id}: "${diamond.text}"`).toBe(true);
      }
    }
  });

  it('draw every foreign key in the schema with entity-relationship ends', () => {
    const nodes = board('saas-schema');
    const fks = nodes
      .filter((n) => n.type === 'table')
      .reduce((sum, t) => sum + (t.table.cells as string[][]).filter((row) => row[0] === 'FK').length, 0);
    const rels = nodes.filter((n) => n.type === 'connector');
    expect(rels).toHaveLength(fks);
    for (const r of rels) {
      expect(['bar', 'circle']).toContain(r.endStart);
      expect(['bar', 'crow-foot']).toContain(r.endEnd);
    }
  });
});

describe('the sequence diagram', () => {
  it('is the conversation its Mermaid describes', () => {
    const parsed = parseSequence(PKCE_MERMAID);
    expect(parsed.error).toBeNull();
    const messages = (parsed.diagram?.steps ?? []).filter((s) => s.kind === 'message') as Array<{ label: string }>;
    const drawn = board('oauth-pkce-sequence')
      .filter((n) => n.type === 'connector')
      .map((n) => String(n.labels[0].text).replace(/^\d+\s+/, ''));
    expect(parsed.diagram?.participants).toHaveLength(4);
    expect(drawn).toEqual(messages.map((m) => m.label));
  });
});

describe('the roadmaps', () => {
  it('keep each milestone’s steps as a real checklist', () => {
    const notes = board('series-a-roadmap').filter((n) => n.type === 'sticky');
    expect(notes.length).toBe(9);
    for (const n of notes) {
      expect(n.checklist).toBe(true);
      expect(String(n.text).split('\n')).toHaveLength(3);
    }
  });

  it('mark exactly one place as where you are', () => {
    for (const id of ['series-a-roadmap', 'ml-engineer-roadmap']) {
      const here = board(id).filter((n) => /are here/i.test(String(n.text ?? '')) && n.type === 'shape');
      expect(here, id).toHaveLength(1);
    }
  });
});
