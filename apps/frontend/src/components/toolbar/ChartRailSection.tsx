import React from 'react';
import {
  Check,
  Copy,
  Download,
  Lock,
  RotateCcw,
  Sliders,
  Table as TableIcon,
  Unlock,
  FileUp as RailImportIcon,
  PenLine as RailSketchIcon,
  PanelTop as RailLegendTop,
  PanelBottom as RailLegendBottom,
  PanelRight as RailLegendRight,
} from 'lucide-react';
import type { ChartNode } from '../../engine/model/schema';
import { editor } from '../../engine/api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import { RailButton, Divider } from './RailBase';
import { RailPopover } from './RailPopover';
import { KindPicker } from '../workspace/KindPicker';
import { ChartKindIcon } from '../workspace/chartIcons';
import { CHART_HINTS, CHART_LABELS, chartPickerGroups } from '../../engine/chart/chartKinds';
import { setChartKind, updateChart } from '../../engine/chart/chartApply';
import {
  CHART_AGENCY_PALETTES,
  chartCapabilities,
  defaultPlotDomain,
  getPaletteColors,
  isSampleKind,
  resolveChartOptions,
} from '../../engine/chart/chartTypes';
import {
  chartToCsv,
  csvFilename,
  downloadCsv,
  parseChartData,
  withChartData,
} from '../../engine/chart/chartCsv';
import { SegmentedControl } from '../ui/SegmentedControl';

export interface ChartRailSectionProps {
  node: ChartNode;
}

/**
 * Contextual rail controls for a selected chart node.
 * Handles chart kind picker, data sheet toggle, math plot plane reset/lock,
 * agency palette switcher, sketch toggle, display toggles, and CSV import/export.
 */
export const ChartRailSection: React.FC<ChartRailSectionProps> = ({ node }) => {
  return (
    <>
      <div className="ctx-group">
        {/* Chart Kind Switcher Popover */}
        <RailPopover
          label="Chart type"
          trigger={
            <span className="ctx-trigger">
              <ChartKindIcon kind={node.chart.kind} size={15} />
              <span className="ctx-value">{CHART_LABELS[node.chart.kind]}</span>
            </span>
          }
          align="start"
        >
          <KindPicker
            columns={4}
            tile={80}
            searchPlaceholder="Chart types"
            groups={chartPickerGroups().map((group) => ({
              id: group.family,
              label: group.label,
              options: group.kinds.map((k) => ({
                id: k,
                label: CHART_LABELS[k],
                hint: CHART_HINTS[k],
                icon: <ChartKindIcon kind={k} size={18} />,
              })),
            }))}
            value={node.chart.kind}
            onPick={(k) => setChartKind(node.id, node.chart, k)}
          />
        </RailPopover>

        {/* The sheet, for the kinds that have one. */}
        {chartCapabilities(node.chart.kind).data && (
          <RailButton
            label="Edit data"
            hint="Open the data sheet"
            onClick={() => useStore.getState().setChartDataModalNodeId(node.id)}
          >
            <TableIcon size={15} />
          </RailButton>
        )}

        {/* Math Plot / Graph Plane Lock & Reset */}
        {chartCapabilities(node.chart.kind).lockPlane && (
          <>
            <RailButton
              label={node.chart.lockPlane ? 'Unlock plane' : 'Lock plane'}
              hint={
                node.chart.lockPlane
                  ? 'Plane is locked against accidental zoom/pan'
                  : 'Lock graph plane to prevent accidental zoom/pan'
              }
              pressed={Boolean(node.chart.lockPlane)}
              onClick={() => updateChart(node.id, { ...node.chart, lockPlane: !node.chart.lockPlane })}
            >
              {node.chart.lockPlane ? <Lock size={15} /> : <Unlock size={15} />}
            </RailButton>
            <RailButton
              label="Reset view"
              hint="Put the plane back where a new plot starts"
              onClick={() =>
                updateChart(node.id, {
                  ...node.chart,
                  ...defaultPlotDomain(node.chart.kind),
                })
              }
            >
              <RotateCcw size={15} />
            </RailButton>
          </>
        )}

        {/* The palette, shown as itself. */}
        <RailPopover
          label="Palette"
          trigger={
            <span className="ctx-ribbon" aria-hidden="true">
              {getPaletteColors(node.chart.paletteId).slice(0, 4).map((c, i) => (
                <i key={i} style={{ background: c }} />
              ))}
            </span>
          }
          align="start"
        >
          {(close) => (
            <>
              <span className="ctx-popover__label">Palette</span>
              <div className="ctx-palettes">
                {CHART_AGENCY_PALETTES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="ctx-palette"
                    aria-pressed={(node.chart.paletteId ?? 'default') === p.id}
                    onClick={() => {
                      updateChart(node.id, { ...node.chart, paletteId: p.id === 'default' ? undefined : p.id });
                      close();
                    }}
                  >
                    <span className="ctx-palette__ribbon" aria-hidden="true">
                      {p.colors.slice(0, 6).map((c, i) => (
                        <i key={i} style={{ background: c }} />
                      ))}
                    </span>
                    <span className="ctx-palette__name">{p.label}</span>
                    {(node.chart.paletteId ?? 'default') === p.id && <Check size={13} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </RailPopover>

        {/* Clean or sketch in one press */}
        <RailButton
          label={node.appearance?.sketch ? 'Make it clean' : 'Sketch it'}
          hint={
            node.appearance?.sketch
              ? 'Back to the precise, presentation look'
              : 'Hand-drawn for whiteboarding — the data is unchanged'
          }
          pressed={Boolean(node.appearance?.sketch)}
          onClick={() =>
            editor.updateNode(node.id, {
              appearance: { ...(node.appearance ?? {}), sketch: node.appearance?.sketch ? undefined : 'medium' },
            })
          }
        >
          <RailSketchIcon size={15} />
        </RailButton>

        {/* What the chart shows, each switch reporting what is *drawn*. */}
        <RailPopover label="Display" trigger={<Sliders size={15} />} align="start">
          <span className="ctx-popover__label">Show</span>
          <div className="ctx-popover__toggles">
            <button
              type="button"
              className="ctx-popover__action"
              role="switch"
              aria-checked={resolveChartOptions(node.chart).showLegend}
              onClick={() =>
                updateChart(node.id, {
                  ...node.chart,
                  showLegend: !resolveChartOptions(node.chart).showLegend,
                })
              }
            >
              <Check
                size={14}
                style={{ opacity: resolveChartOptions(node.chart).showLegend ? 1 : 0 }}
              />
              Legend
            </button>
            {chartCapabilities(node.chart.kind).valueLabels && (
              <button
                type="button"
                className="ctx-popover__action"
                role="switch"
                aria-checked={resolveChartOptions(node.chart).showValues}
                onClick={() =>
                  updateChart(node.id, { ...node.chart, showValues: !resolveChartOptions(node.chart).showValues })
                }
              >
                <Check size={14} style={{ opacity: resolveChartOptions(node.chart).showValues ? 1 : 0 }} />
                Value labels
              </button>
            )}
            {chartCapabilities(node.chart.kind).gridLines && (
              <button
                type="button"
                className="ctx-popover__action"
                role="switch"
                aria-checked={resolveChartOptions(node.chart).showGrid}
                onClick={() =>
                  updateChart(node.id, { ...node.chart, showGrid: !resolveChartOptions(node.chart).showGrid })
                }
              >
                <Check size={14} style={{ opacity: resolveChartOptions(node.chart).showGrid ? 1 : 0 }} />
                Grid lines
              </button>
            )}
            {chartCapabilities(node.chart.kind).gradient && (
              <button
                type="button"
                className="ctx-popover__action"
                role="switch"
                aria-checked={Boolean(node.chart.gradient)}
                onClick={() => updateChart(node.id, { ...node.chart, gradient: !node.chart.gradient })}
              >
                <Check size={14} style={{ opacity: node.chart.gradient ? 1 : 0 }} />
                Fade the fill
              </button>
            )}
          </div>
          {resolveChartOptions(node.chart).showLegend && (
            <>
              <span className="ctx-popover__label">Legend</span>
              <SegmentedControl
                fill
                ariaLabel="Legend position"
                value={node.chart.legendPosition === 'none' ? 'bottom' : node.chart.legendPosition ?? 'bottom'}
                onChange={(v) =>
                  updateChart(node.id, {
                    ...node.chart,
                    legendPosition: v === 'bottom' ? undefined : (v as 'top' | 'right'),
                  })
                }
                segments={[
                  { value: 'top', label: 'Top', icon: <RailLegendTop size={15} />, hint: 'Above the plot' },
                  { value: 'bottom', label: 'Bottom', icon: <RailLegendBottom size={15} />, hint: 'Below the plot' },
                  { value: 'right', label: 'Right', icon: <RailLegendRight size={15} />, hint: 'Beside the plot' },
                ]}
              />
            </>
          )}
        </RailPopover>

        {/* Only where there is a table to be CSV of */}
        {chartCapabilities(node.chart.kind).data && (
          <RailPopover label="Data as CSV" trigger={<Download size={15} />} align="start">
            <span className="ctx-popover__label">CSV</span>
            <button
              type="button"
              className="ctx-popover__action"
              onClick={() => {
                navigator.clipboard.writeText(chartToCsv(node.chart)).catch(() => {
                  downloadCsv(node.chart, csvFilename(node.chart.title));
                });
              }}
            >
              <Copy size={14} />
              Copy as CSV
            </button>
            <button
              type="button"
              className="ctx-popover__action"
              onClick={() => downloadCsv(node.chart, csvFilename(node.chart.title))}
            >
              <Download size={14} />
              Download CSV
            </button>
            {!isSampleKind(node.chart.kind) && (
              <button
                type="button"
                className="ctx-popover__action"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';
                  input.onchange = async () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    const data = parseChartData(await file.text());
                    if (data.categories.length > 0) updateChart(node.id, withChartData(node.chart, data));
                  };
                  input.click();
                }}
              >
                <RailImportIcon size={14} />
                Import a CSV file…
              </button>
            )}
          </RailPopover>
        )}
      </div>
      <Divider />
    </>
  );
};
