import React from 'react';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../hooks/useStore';
import { useCameraZoom } from '../../engine/useCameraZoom';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { currentChartInk } from '../../engine/chart/chartInk';
import { setChartFocus } from '../../engine/chart/chartFocus';
import { layoutChart } from '../../engine/chart/chartLayout';
import { CHART_FONT_FAMILY, measureChartText } from '../../engine/chart/chartMeasure';
import { currentRange, resolveChartSpec } from '../../engine/chart/chartFromTable';
import { prefersReducedMotion } from '../../engine/cameraMotion';
import { canvasPlateFill, ThemeService } from '../../engine/ThemeService';
import { layerHover } from '../../engine/interaction/layerHover';
import { claimCursor } from '../../engine/cursor/cursorOverride';
import {
  boardTables,
  chartsReading,
  ensureTableRegistry,
  linkOf,
  linksVersion,
  orphanedCharts,
  registryVersion,
  subscribeLinks,
  subscribePulses,
  subscribeRegistry,
  tableNode,
} from '../../engine/table/tableRegistry';
import { bridge, crossTableLinks, rangeBox, type Box, type TableNodeLike } from '../../engine/chart/dataLinkGeometry';
import type { ChartSpec, ChartTableLink } from '../../engine/chart/chartTypes';
import { FLASH_MS, flashVersion, focusRange, liveFlashes, rangeFocus } from '../data/linkSignals';
import { showSource } from '../data/dataActions';

/**
 * The visible half of the board's data links.
 *
 * - A linked chart, or the table it reads, selected or hovered: a dashed
 *   hairline from the range to the chart, with the range outlined. Nothing
 *   otherwise, so links are never clutter. Hovered links are quieter than
 *   selected ones and linger a moment, long enough to reach the line.
 * - Clicking a line selects the source range: the table opens for editing
 *   with those cells selected.
 * - A source edit sends a pulse down the line, and the readings it changed are
 *   marked on the chart for a moment. Reduced motion keeps the marks, still.
 * - A table selected or open for editing: a line from every range in another
 *   table its formulas read, to the cell that reads it.
 * - A chart whose table was deleted wears a quiet badge.
 * - The panel can point at a range; it is outlined here.
 *
 * Chrome: held at one screen pixel at any zoom, never exported. Only the
 * lines take the pointer. Also publishes this client's selection to
 * `chartFocus`, which is how a chart knows it may offer in-place editing.
 *
 * Everything is found through the table registry's index, so a change costs
 * a lookup per linked object, never a walk of the board.
 */

const PULSE_MS = 900;
const LINGER_MS = 450;

interface LinkLine {
  key: string;
  chartId?: string;
  link?: ChartTableLink;
  from: Box;
  to: Box;
  strength: 'strong' | 'soft' | 'pulse';
  pulseAt?: number;
}

type NodeLike = Box & { id: string; type: string; rotation?: number; scaleX?: number; scaleY?: number };
type FlashNode = NodeLike & { chart?: ChartSpec };

interface FlashMark {
  id: string;
  at: number;
  node: FlashNode;
  rects: Box[];
  dots: Array<{ x: number; y: number }>;
}

/** Where a chart's changed readings are drawn: their bars, or their points, or the whole plot when the order is not the table's. */
function markFlash(id: string, at: number, cells: Array<[number, number]>, node: FlashNode): FlashMark {
  const chart = node.chart!;
  const tableId = chart.link?.tableId;
  const spec = resolveChartSpec(chart, tableId ? tableNode(tableId)?.table : null);
  const layout = layoutChart(spec, node.width, node.height, measureChartText);
  const n = spec.categories.length;
  const stored = (ci: number) => (spec.reverseCategories ? n - 1 - ci : ci);
  const reordered = (spec.sort && spec.sort !== 'none') || Boolean(spec.topN);
  const hit = new Set(cells.map(([si, ci]) => `${si}:${ci}`));
  const rects: Box[] = [];
  const dots: Array<{ x: number; y: number }> = [];
  if (!reordered) {
    for (const b of layout.bars) if (b.categoryIndex >= 0 && hit.has(`${b.seriesIndex}:${stored(b.categoryIndex)}`)) rects.push(b);
    if (rects.length === 0)
      for (const c of layout.columns)
        for (const e of c.entries) if (hit.has(`${e.seriesIndex}:${stored(c.categoryIndex)}`)) dots.push({ x: e.x, y: e.y });
  }
  if (rects.length === 0 && dots.length === 0) rects.push(layout.plot);
  return { id, at, node, rects, dots };
}

const asTable = (n: unknown) =>
  n && typeof n === 'object' && (n as { type?: string }).type === 'table' ? (n as TableNodeLike) : null;

/** The last non-empty hover, kept a moment after the pointer leaves. */
function useLingeringHover(): readonly string[] {
  const hover = React.useSyncExternalStore(layerHover.subscribe, layerHover.getSnapshot, layerHover.getSnapshot);
  const ids = hover?.ids;
  const [kept, setKept] = React.useState<readonly string[]>([]);
  React.useEffect(() => {
    if (ids && ids.length) {
      setKept(ids);
      return;
    }
    const t = window.setTimeout(() => setKept([]), LINGER_MS);
    return () => window.clearTimeout(t);
  }, [ids]);
  return ids && ids.length ? ids : kept;
}

export const DataLinkOverlay: React.FC<{ selectedIds: string[] }> = ({ selectedIds }) => {
  React.useEffect(() => {
    setChartFocus(selectedIds);
  }, [selectedIds]);
  ensureTableRegistry();

  const zoom = useCameraZoom();
  const editingTable = useStore((s) => s.tableEditNodeId);
  const hovered = useLingeringHover();
  const [lineHover, setLineHover] = React.useState<string | null>(null);
  React.useSyncExternalStore(subscribeLinks, linksVersion, linksVersion);
  React.useSyncExternalStore(subscribeRegistry, registryVersion, registryVersion);
  const focus = React.useSyncExternalStore(rangeFocus.subscribe, rangeFocus.get, rangeFocus.get);
  const flashV = React.useSyncExternalStore(flashVersion.subscribe, flashVersion.get, flashVersion.get);

  // A range the board pointed at lets go once the table is no longer what is being worked on.
  React.useEffect(() => {
    const f = rangeFocus.get();
    if (f?.from === 'board' && !selectedIds.includes(f.tableId) && editingTable !== f.tableId) focusRange(null);
  }, [selectedIds, editingTable]);
  React.useEffect(() => () => claimCursor('data-link', null), []);

  // Pulses: when each chart's source last changed.
  const [pulses, setPulses] = React.useState<ReadonlyMap<string, number>>(new Map());
  React.useEffect(
    () =>
      subscribePulses((ids) =>
        setPulses((prev) => {
          const t = performance.now();
          // Spent pulses are dropped as new ones arrive, so the map holds only what is showing.
          const next = new Map([...prev].filter(([, at]) => t - at < PULSE_MS));
          ids.forEach((id) => next.set(id, t));
          return next;
        })
      ),
    []
  );

  // One clock for the pulse and the marks, running only while one is showing.
  const [now, setNow] = React.useState(() => performance.now());
  React.useEffect(() => {
    const alive = (t: number) => [...pulses.values()].some((p) => t - p < PULSE_MS) || liveFlashes(t).size > 0;
    const t0 = performance.now();
    if (!alive(t0)) return;
    setNow(t0);
    if (prefersReducedMotion()) {
      const timer = window.setTimeout(() => setNow(performance.now()), Math.max(PULSE_MS, FLASH_MS) + 20);
      return () => window.clearTimeout(timer);
    }
    let raf = 0;
    const tick = (t: number) => {
      setNow(t);
      if (alive(t)) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pulses, flashV]);

  // Which links are in play, and which nodes they need.
  const strong = new Set<string>(selectedIds);
  if (editingTable) strong.add(editingTable);
  if (lineHover) strong.add(lineHover);
  const soft = new Set<string>(hovered.filter((id) => !strong.has(id)));
  const wanted = new Map<string, LinkLine['strength']>();
  const want = (chartId: string, strength: LinkLine['strength']) => {
    const was = wanted.get(chartId);
    if (!was || strength === 'strong' || (strength === 'soft' && was === 'pulse')) wanted.set(chartId, strength);
  };
  const consider = (id: string, strength: LinkLine['strength']) => {
    if (linkOf(id)) want(id, strength);
    else if (tableNode(id)) for (const c of chartsReading(id)) want(c, strength);
  };
  strong.forEach((id) => consider(id, 'strong'));
  soft.forEach((id) => consider(id, 'soft'));
  for (const [id, at] of pulses) if (now - at < PULSE_MS) want(id, 'pulse');
  const flashes = liveFlashes(now);
  const orphans = orphanedCharts();
  const crossFrom = [...strong].filter((id) => tableNode(id));

  const ids = new Set<string>();
  for (const id of wanted.keys()) {
    ids.add(id);
    ids.add(linkOf(id)!.tableId);
  }
  for (const id of flashes.keys()) ids.add(id);
  orphans.forEach((id) => ids.add(id));
  if (focus) ids.add(focus.tableId);
  const idList = [...ids].sort();
  const nodes = useStore(useShallow((s) => idList.map((id) => s.objects[id])));
  const byId = new Map<string, unknown>();
  idList.forEach((id, i) => nodes[i] && byId.set(id, nodes[i]));

  const lines: LinkLine[] = [];
  for (const [chartId, strength] of wanted) {
    const chart = byId.get(chartId) as NodeLike | undefined;
    const link = linkOf(chartId)!;
    const table = asTable(byId.get(link.tableId));
    if (!chart || !table) continue;
    const range = currentRange(table.table, link);
    const box = range && rangeBox(table, range);
    if (box) lines.push({ key: chartId, chartId, link, from: box, to: chart, strength, pulseAt: pulses.get(chartId) });
  }
  if (crossFrom.length) {
    const all = boardTables() as unknown as TableNodeLike[];
    for (const id of crossFrom) {
      const table = all.find((t) => t.id === id);
      if (!table) continue;
      crossTableLinks(table, all).forEach((l, i) => lines.push({ key: `x:${id}:${i}`, from: l.source, to: l.cell, strength: 'strong' }));
    }
  }

  const focusTable = focus ? asTable(byId.get(focus.tableId)) : null;
  const focusBox = focus && focusTable ? rangeBox(focusTable, focus.range) : null;

  // A flash's marks are laid out once, when it starts or its chart changes, not per frame.
  const flashCache = React.useRef(new Map<string, FlashMark>());
  const flashMarks: FlashMark[] = [];
  for (const [id, f] of flashes) {
    const node = byId.get(id) as FlashNode | undefined;
    if (!node?.chart) continue;
    const cached = flashCache.current.get(id);
    const mark = cached && cached.at === f.at && cached.node === node ? cached : markFlash(id, f.at, f.cells, node);
    flashCache.current.set(id, mark);
    flashMarks.push(mark);
  }
  for (const id of flashCache.current.keys()) if (!flashes.has(id)) flashCache.current.delete(id);

  if (lines.length === 0 && !focusBox && flashMarks.length === 0 && orphans.length === 0) return null;

  const ink = currentChartInk();
  const dark = ThemeService.isDarkMode();
  const plate = canvasPlateFill(dark);
  const hair = 1 / Math.max(zoom, 0.05);
  const reduced = prefersReducedMotion();
  const dash = [hair * 4, hair * 3];

  return (
    <Group name={EXPORT_CHROME}>
      {lines.map((l) => {
        const pts = bridge(l.from, l.to);
        const len = Math.hypot(pts[2] - pts[0], pts[3] - pts[1]);
        const pulseT = l.pulseAt !== undefined ? (now - l.pulseAt) / PULSE_MS : 1;
        const pulsing = pulseT >= 0 && pulseT < 1;
        const lineOpacity = l.strength === 'strong' ? 0.75 : l.strength === 'soft' ? 0.45 : 0;
        const seg = Math.min(len * 0.3, hair * 28);
        // Ease out: the pulse leaves fast and settles into the chart.
        const travelled = (1 - (1 - Math.min(1, pulseT)) ** 3) * (len + seg);
        return (
          <React.Fragment key={l.key}>
            {l.strength !== 'pulse' && (
              // A plate-coloured halo under the dashes, so the outline reads on a light table on a dark board and back.
              <Rect
                x={l.from.x}
                y={l.from.y}
                width={l.from.width}
                height={l.from.height}
                stroke={plate}
                strokeWidth={hair * 3.5}
                opacity={l.strength === 'soft' ? 0.5 : 0.85}
                listening={false}
                perfectDrawEnabled={false}
              />
            )}
            {l.strength !== 'pulse' && (
              <Rect
                x={l.from.x}
                y={l.from.y}
                width={l.from.width}
                height={l.from.height}
                stroke={ink.ink}
                strokeWidth={hair * 1.5}
                dash={dash}
                opacity={l.strength === 'soft' ? 0.6 : 1}
                listening={false}
                perfectDrawEnabled={false}
              />
            )}
            {lineOpacity > 0 && (
              <Line points={pts} stroke={ink.ink} strokeWidth={hair} dash={dash} opacity={lineOpacity} listening={false} perfectDrawEnabled={false} />
            )}
            {pulsing &&
              (reduced ? (
                <Line points={pts} stroke={ink.ink} strokeWidth={hair * 1.5} opacity={0.8} listening={false} perfectDrawEnabled={false} />
              ) : (
                <Line
                  points={pts}
                  stroke={ink.ink}
                  strokeWidth={hair * 2}
                  lineCap="round"
                  dash={[seg, len + seg * 2]}
                  dashOffset={seg - travelled}
                  opacity={0.9}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              ))}
            {l.link && l.chartId && l.strength !== 'pulse' && (
              <Line
                points={pts}
                stroke="transparent"
                strokeWidth={hair * 10}
                hitStrokeWidth={hair * 12}
                onMouseEnter={() => {
                  setLineHover(l.chartId!);
                  claimCursor('data-link', 'pointer');
                }}
                onMouseLeave={() => {
                  setLineHover(null);
                  claimCursor('data-link', null);
                }}
                onMouseDown={(e) => {
                  e.cancelBubble = true;
                }}
                onClick={(e) => {
                  e.cancelBubble = true;
                  claimCursor('data-link', null);
                  setLineHover(null);
                  showSource(l.link!);
                }}
                onTap={(e) => {
                  e.cancelBubble = true;
                  showSource(l.link!);
                }}
              />
            )}
          </React.Fragment>
        );
      })}

      {focusBox && (
        <Group listening={false}>
          {/* A wash under the outline, quiet enough that the cells read through. */}
          <Rect x={focusBox.x} y={focusBox.y} width={focusBox.width} height={focusBox.height} fill={ink.ink} opacity={0.07} perfectDrawEnabled={false} />
          {[{ stroke: plate, width: 4.5 }, { stroke: ink.ink, width: 2 }].map((pass) => (
            <Rect
              key={pass.width}
              x={focusBox.x - hair * 2}
              y={focusBox.y - hair * 2}
              width={focusBox.width + hair * 4}
              height={focusBox.height + hair * 4}
              stroke={pass.stroke}
              strokeWidth={hair * pass.width}
              perfectDrawEnabled={false}
            />
          ))}
        </Group>
      )}

      {flashMarks.map((m) => {
        const t = (now - m.at) / FLASH_MS;
        if (t >= 1) return null;
        const fade = reduced ? 1 : 1 - t * t;
        return (
          <Group
            key={m.id}
            x={m.node.x}
            y={m.node.y}
            rotation={m.node.rotation ?? 0}
            scaleX={m.node.scaleX ?? 1}
            scaleY={m.node.scaleY ?? 1}
            opacity={fade}
            listening={false}
          >
            {m.rects.map((r, i) => (
              <Rect
                key={`r${i}`}
                x={r.x - hair * 2}
                y={r.y - hair * 2}
                width={r.width + hair * 4}
                height={r.height + hair * 4}
                cornerRadius={hair * 3}
                stroke={ink.ink}
                strokeWidth={hair * 1.5}
                perfectDrawEnabled={false}
              />
            ))}
            {m.dots.map((d, i) => (
              <Circle key={`d${i}`} x={d.x} y={d.y} radius={hair * 6} stroke={ink.ink} strokeWidth={hair * 1.5} perfectDrawEnabled={false} />
            ))}
          </Group>
        );
      })}

      {orphans.map((id) => {
        const node = byId.get(id) as NodeLike | undefined;
        if (!node) return null;
        const label = 'Source deleted';
        const size = 11 * hair;
        const padX = 7 * hair;
        const w = measureChartText(label, 11) * hair + padX * 2;
        const h = 20 * hair;
        const inset = 8 * hair;
        return (
          <Group key={`o:${id}`} x={node.x} y={node.y} rotation={node.rotation ?? 0} listening={false}>
            <Group x={node.width * Math.abs(node.scaleX ?? 1) - w - inset} y={inset}>
              <Rect width={w} height={h} cornerRadius={h / 2} fill={canvasPlateFill(dark)} stroke={ink.chrome} strokeWidth={hair} opacity={0.95} />
              <Text
                x={padX}
                y={(h - size) / 2}
                text={label}
                fontSize={size}
                fontFamily={CHART_FONT_FAMILY}
                fontStyle="500"
                fill={ink.ink}
                opacity={0.8}
              />
            </Group>
          </Group>
        );
      })}
    </Group>
  );
};
