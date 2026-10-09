import { afterAll, describe, expect, it } from 'vitest';
import { DATA } from './data';
import { cell, linked, mean, readNumber, regress, round, seeded, sheet, stdev } from './dataKit';
import { normalizeTableSpec, type TableSpec } from '../../table/tableTypes';
import { evaluateCell, isErr, setTableResolver } from '../../table/tableFormula';
import { resolveTableLink } from '../../chart/chartFromTable';
import { layoutChart } from '../../chart/chartLayout';
import type { ChartSpec } from '../../chart/chartTypes';

/**
 * The data and science boards, held to what they claim.
 *
 * A linked chart stores the values it last resolved, and the kit writes those
 * from the same arrays the table is typed from rather than running the formula
 * engine in the gallery's bundle. These tests run the real engine over every
 * board and check the two readings agree, that no formula errors (cross-table
 * references included), and that every plot draws as one unbroken run.
 */

type Node = Record<string, unknown> & { id: string; type: string };

const boards = DATA.map((t) => ({ id: t.id, nodes: t.build() as unknown as Node[] }));

afterAll(() => setTableResolver(null));

/** Point formulas that read another table by title at this board's tables. */
function useBoardTables(nodes: Node[]): Map<string, TableSpec> {
  const specs = new Map<string, TableSpec>();
  const byTitle = new Map<string, { id: string; spec: TableSpec }>();
  for (const n of nodes) {
    if (n.type !== 'table') continue;
    const spec = normalizeTableSpec(n.table);
    specs.set(n.id, spec);
    byTitle.set(String(n.title).toLowerCase(), { id: n.id, spec });
  }
  setTableResolver({
    byTitle: (title) => byTitle.get(title.trim().toLowerCase()) ?? null,
    idOf: (spec) => [...byTitle.values()].find((t) => t.spec === spec)?.id ?? null,
    version: () => 1,
  });
  return specs;
}

describe('the data boards', () => {
  it('store the values their links resolve to', () => {
    const mismatches: string[] = [];
    for (const board of boards) {
      const specs = useBoardTables(board.nodes);
      for (const n of board.nodes) {
        const spec = n.chart as ChartSpec | undefined;
        if (n.type !== 'chart' || !spec?.link) continue;
        const table = specs.get(spec.link.tableId);
        if (!table) {
          mismatches.push(`${board.id}: a chart links to a table that is not on the board`);
          continue;
        }
        const live = resolveTableLink(table, spec.link);
        const near = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-6);
        if (JSON.stringify(live.categories) !== JSON.stringify(spec.categories)) {
          mismatches.push(`${board.id}: categories ${live.categories.join('|')} ≠ ${spec.categories.join('|')}`);
        }
        live.series.forEach((s, i) => {
          const stored = spec.series[i];
          if (!stored || stored.name !== s.name || !s.values.every((v, k) => near(v, stored.values[k] ?? null))) {
            mismatches.push(`${board.id}: series "${s.name}" resolves to ${s.values.join(',')} but stores ${stored?.values.join(',')}`);
          }
        });
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('compute every formula without an error, across tables too', () => {
    const errors: string[] = [];
    for (const board of boards) {
      const specs = useBoardTables(board.nodes);
      for (const [id, spec] of specs) {
        spec.cells.forEach((row, r) =>
          row.forEach((raw, c) => {
            if (!raw.startsWith('=')) return;
            const v = evaluateCell(spec, r, c);
            if (isErr(v) || v === null) errors.push(`${board.id} ${id.slice(0, 4)} ${cell(c, r + 1)} ${raw} → ${JSON.stringify(v)}`);
          })
        );
      }
    }
    expect(errors).toEqual([]);
  });

  it('draw every plot as unbroken curves', () => {
    const broken: string[] = [];
    for (const board of boards) {
      for (const n of board.nodes) {
        const spec = n.chart as ChartSpec | undefined;
        if (n.type !== 'chart' || !spec || !['function', 'parametric', 'polarPlot'].includes(spec.kind)) continue;
        const layout = layoutChart(spec, n.width as number, n.height as number) as unknown as { runs?: unknown[] };
        const want = spec.kind === 'parametric' ? 1 : (spec.functions ?? []).length;
        const runs = layout.runs?.length ?? 0;
        if (runs !== want) broken.push(`${board.id}: ${spec.functions?.[0]?.source.slice(0, 30)} draws ${runs} runs, wants ${want}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('build the same numbers every time', () => {
    for (const t of DATA) {
      const strip = (nodes: unknown[]) => JSON.stringify(nodes, (k, v) => (k === 'id' || k === 'tableId' || k === 'nodeId' ? undefined : v));
      expect(strip(t.build()), t.id).toBe(strip(t.build()));
    }
  });
});

describe('the kit', () => {
  it('draws from a seeded generator that is repeatable and has the right moments', () => {
    const a = seeded(7);
    const b = seeded(7);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
    const g = seeded(11);
    const normal = Array.from({ length: 20000 }, () => g.normal(3, 2));
    expect(mean(normal)).toBeCloseTo(3, 1);
    expect(stdev(normal)).toBeCloseTo(2, 1);
    const pois = Array.from({ length: 20000 }, () => g.poisson(4));
    expect(mean(pois)).toBeCloseTo(4, 1);
    const expo = Array.from({ length: 20000 }, () => g.exponential(1.5));
    expect(mean(expo)).toBeCloseTo(1 / 1.5, 1);
  });

  it('fits a straight line exactly when the points are on one', () => {
    const fit = regress([1, 2, 3, 4], [3, 5, 7, 9]);
    expect(fit.slope).toBeCloseTo(2, 12);
    expect(fit.intercept).toBeCloseTo(1, 12);
    expect(fit.r2).toBeCloseTo(1, 12);
  });

  it('rounds without binary residue and reads numbers as a chart does', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(-2.675, 2)).toBe(-2.68);
    expect(readNumber('$1,204')).toBe(1204);
    expect(readNumber('4.2%')).toBe(4.2);
    expect(readNumber('Dec')).toBeNull();
  });

  it('links a chart to a range that starts on the header and keeps a filter inside it', () => {
    const s = sheet(0, 0, 400, {
      title: 'T',
      columns: [
        { head: 'Month', cells: ['Open', 'Jan', 'Feb'] },
        { head: 'New', cells: ['', '4', '5'] },
        { head: 'Total', cells: ['10', '=B3+C2', '=B4+C3'], values: [10, 14, 19] },
      ],
    });
    const spec = linked(s, { cat: 0, series: [2], filled: 1 }, { kind: 'line', categories: [], series: [] });
    expect(spec.link).toMatchObject({ r0: 0, c0: 0, c1: 2, header: true });
    expect(spec.categories).toEqual(['Jan', 'Feb']);
    expect(spec.series[0]).toMatchObject({ name: 'Total', values: [14, 19] });
    const live = resolveTableLink(normalizeTableSpec(s.node.table as unknown), spec.link!);
    expect(live.categories).toEqual(['Jan', 'Feb']);
    expect(live.series[0].values).toEqual([14, 19]);
  });
});
