import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  ArrowLeftRight,
  ClipboardPaste,
  Copy,
  Download,
  Activity,
  Globe,
  RefreshCw,
  Table as TableIcon,
  Check,
} from 'lucide-react';
import { useStore } from '../hooks/useStore';
import type { ChartNode } from '../engine/model/schema';
import type { ChartSpec, ChartSeries, ChartDataSource } from '../engine/chart/chartTypes';
import { updateChart } from '../engine/chart/chartApply';
import {
  chartToCsv,
  csvFilename,
  downloadCsv,
  parseChartData,
  parseNumber,
  withChartData,
} from '../engine/chart/chartCsv';
import { ColorPickerPopover } from './ui/ColorPickerPopover';

interface Props {
  nodeId: string;
  onClose: () => void;
}

export const ChartDataModal: React.FC<Props> = ({ nodeId, onClose }) => {
  const node = useStore((s) => s.objects[nodeId]) as ChartNode | undefined;
  const [activeTab, setActiveTab] = useState<'grid' | 'live'>('grid');
  const [pasteText, setPasteText] = useState('');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Keyboard navigation refs
  const cellInputsRef = useRef<Map<string, HTMLInputElement>>(new Map());

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showPasteBox) {
          setShowPasteBox(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showPasteBox]);

  if (!node || node.type !== 'chart') {
    return null;
  }

  const spec = node.chart;
  const categories = spec.categories || [];
  const seriesList = spec.series || [];

  const commit = (next: Partial<ChartSpec>) => {
    updateChart(nodeId, { ...spec, ...next });
  };

  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    colIndex: number, // -1 is category name, 0..N-1 is series
    totalRows: number,
    totalCols: number
  ) => {
    let nextRow = rowIndex;
    let nextCol = colIndex;

    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      nextRow = Math.min(totalRows - 1, rowIndex + 1);
    } else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault();
      nextRow = Math.max(0, rowIndex - 1);
    } else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
      if (e.key === 'Tab') e.preventDefault();
      if (colIndex < totalCols - 1) {
        nextCol = colIndex + 1;
      } else if (rowIndex < totalRows - 1) {
        nextRow = rowIndex + 1;
        nextCol = -1;
      }
    } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
      if (e.key === 'Tab') e.preventDefault();
      if (colIndex > -1) {
        nextCol = colIndex - 1;
      } else if (rowIndex > 0) {
        nextRow = rowIndex - 1;
        nextCol = totalCols - 1;
      }
    }

    if (nextRow !== rowIndex || nextCol !== colIndex) {
      const key = `${nextRow}:${nextCol}`;
      const target = cellInputsRef.current.get(key);
      target?.focus();
      target?.select();
    }
  };

  // Cell updates
  const setCategory = (index: number, val: string) => {
    const nextCategories = [...categories];
    nextCategories[index] = val;
    commit({ categories: nextCategories });
  };

  const setCellValue = (seriesIndex: number, rowIndex: number, rawVal: string) => {
    const num = parseNumber(rawVal);
    const nextSeries = seriesList.map((s, si) => {
      if (si !== seriesIndex) return s;
      const nextValues = [...s.values];
      nextValues[rowIndex] = num;
      return { ...s, values: nextValues };
    });
    commit({ series: nextSeries });
  };

  const setSeriesName = (seriesIndex: number, name: string) => {
    const nextSeries = seriesList.map((s, i) => (i === seriesIndex ? { ...s, name } : s));
    commit({ series: nextSeries });
  };

  const setSeriesColor = (seriesIndex: number, color: string) => {
    const nextSeries = seriesList.map((s, i) => (i === seriesIndex ? { ...s, color } : s));
    commit({ series: nextSeries });
  };

  // Add/remove rows and series
  const addRow = () => {
    const nextCategories = [...categories, `Item ${categories.length + 1}`];
    const nextSeries = seriesList.map((s) => ({
      ...s,
      values: [...s.values, 0],
    }));
    commit({ categories: nextCategories, series: nextSeries });
  };

  const deleteRow = (rowIndex: number) => {
    if (categories.length <= 1) return;
    const nextCategories = categories.filter((_, i) => i !== rowIndex);
    const nextSeries = seriesList.map((s) => ({
      ...s,
      values: s.values.filter((_, i) => i !== rowIndex),
    }));
    commit({ categories: nextCategories, series: nextSeries });
  };

  const addSeries = () => {
    const newIndex = seriesList.length + 1;
    const nextSeries = [
      ...seriesList,
      {
        name: `Series ${newIndex}`,
        values: categories.map(() => 0),
      },
    ];
    commit({ series: nextSeries });
  };

  const deleteSeries = (seriesIndex: number) => {
    if (seriesList.length <= 1) return;
    const nextSeries = seriesList.filter((_, i) => i !== seriesIndex);
    commit({ series: nextSeries });
  };

  // Transpose rows and columns
  const transpose = () => {
    if (categories.length === 0 || seriesList.length === 0) return;
    const newCategories = seriesList.map((s) => s.name);
    const newSeries: ChartSeries[] = categories.map((cat, catIdx) => ({
      name: cat,
      values: seriesList.map((s) => s.values[catIdx] ?? 0),
    }));
    commit({ categories: newCategories, series: newSeries });
  };

  // CSV I/O
  const handleCopyCsv = () => {
    const csv = chartToCsv(spec);
    navigator.clipboard.writeText(csv);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadCsv = () => {
    downloadCsv(spec, csvFilename(spec.title));
  };

  const handleApplyPaste = () => {
    if (!pasteText.trim()) return;
    const parsed = parseChartData(pasteText);
    if (parsed.categories.length > 0 || parsed.series.length > 0) {
      commit(withChartData(spec, parsed));
      setShowPasteBox(false);
      setPasteText('');
    }
  };

  // Live Data Connector (Recommendation 5)
  const dataSource = spec.dataSource || { mode: 'manual' };

  const updateDataSource = (patch: Partial<ChartDataSource>) => {
    commit({ dataSource: { ...dataSource, ...patch } });
  };

  const fetchRestData = async () => {
    if (!dataSource.url) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch(dataSource.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const text = await res.text();
      let parsed = parseChartData(text);
      if (parsed.categories.length === 0 && text.startsWith('{')) {
        const json = JSON.parse(text);
        const dataArray = dataSource.dataPath
          ? dataSource.dataPath.split('.').reduce((acc: any, part: string) => acc?.[part], json)
          : json;
        if (Array.isArray(dataArray) && dataArray.length > 0) {
          const keys = Object.keys(dataArray[0]).filter((k) => typeof dataArray[0][k] === 'number');
          const catKey = Object.keys(dataArray[0]).find((k) => typeof dataArray[0][k] === 'string') || 'id';
          parsed = {
            categories: dataArray.map((d: any) => String(d[catKey] ?? '')),
            series: keys.map((k) => ({
              name: k,
              values: dataArray.map((d: any) => parseNumber(String(d[k]))),
            })),
          };
        }
      }
      if (parsed.categories.length > 0) {
        commit({
          ...withChartData(spec, parsed),
          dataSource: {
            ...dataSource,
            lastSyncedAt: Date.now(),
            syncError: undefined,
          },
        });
        setSyncMessage(`Successfully synced ${parsed.categories.length} records.`);
      } else {
        throw new Error('No valid categories or series recognized in payload');
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to fetch REST endpoint';
      updateDataSource({ syncError: errMsg });
      setSyncMessage(`Sync error: ${errMsg}`);
    } finally {
      setSyncing(false);
    }
  };

  // Simulated live ticker generator
  const triggerSimulatedTick = () => {
    if (seriesList.length === 0) return;
    const now = new Date();
    const timeLabel = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const maxWindow = 12;
    const nextCategories = [...categories.slice(-(maxWindow - 1)), timeLabel];

    const nextSeries = seriesList.map((s) => {
      const lastVal = Number(s.values[s.values.length - 1] ?? 100);
      const delta = (Math.random() - 0.48) * (Math.abs(lastVal) * 0.08 || 5);
      const nextVal = Math.round((lastVal + delta) * 100) / 100;
      return {
        ...s,
        values: [...s.values.slice(-(maxWindow - 1)), nextVal],
      };
    });

    commit({
      categories: nextCategories,
      series: nextSeries,
      dataSource: {
        ...dataSource,
        lastSyncedAt: Date.now(),
      },
    });
  };

  return (
    <div className="export-scrim" onPointerDown={onClose} role="presentation">
      <div
        className="chart-data-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Chart Data & Spreadsheet Grid"
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(94vw, 920px)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--surface-elevated, #1e1e24)',
          color: 'var(--text-primary, #f3f4f6)',
          borderRadius: 12,
          border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
          boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          zIndex: 1000,
        }}
      >
        {/* Head */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                color: '#60A5FA',
              }}
            >
              <TableIcon size={18} />
            </span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Chart Data & Spreadsheet</h3>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    padding: '2px 8px',
                    borderRadius: 12,
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    color: 'var(--text-secondary, #9ca3af)',
                  }}
                >
                  {spec.kind}
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary, #9ca3af)' }}>
                {categories.length} {categories.length === 1 ? 'row' : 'rows'} · {seriesList.length}{' '}
                {seriesList.length === 1 ? 'series' : 'series'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Tabs */}
            <div
              style={{
                display: 'flex',
                padding: 3,
                borderRadius: 8,
                backgroundColor: 'var(--surface-sunken, rgba(0,0,0,0.25))',
                border: '1px solid var(--border-color, rgba(255,255,255,0.06))',
              }}
            >
              <button
                type="button"
                className="btn-text"
                onClick={() => setActiveTab('grid')}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  backgroundColor: activeTab === 'grid' ? 'var(--accent, #3b82f6)' : 'transparent',
                  color: activeTab === 'grid' ? '#fff' : 'inherit',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Spreadsheet
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => setActiveTab('live')}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  backgroundColor: activeTab === 'live' ? 'var(--accent, #3b82f6)' : 'transparent',
                  color: activeTab === 'live' ? '#fff' : 'inherit',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Globe size={13} />
                Live Connector
              </button>
            </div>

            <button
              type="button"
              className="btn-icon"
              onClick={onClose}
              aria-label="Close modal"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary, #9ca3af)',
                cursor: 'pointer',
                padding: 6,
                borderRadius: 6,
              }}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Action Bar */}
        {activeTab === 'grid' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 20px',
              borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.06))',
              backgroundColor: 'rgba(255,255,255,0.02)',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={addRow}
                className="btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  cursor: 'pointer',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'inherit',
                }}
              >
                <Plus size={14} /> Add Row
              </button>
              <button
                type="button"
                onClick={addSeries}
                className="btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  cursor: 'pointer',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'inherit',
                }}
              >
                <Plus size={14} /> Add Series
              </button>
              <button
                type="button"
                onClick={transpose}
                title="Swap rows and columns"
                className="btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  cursor: 'pointer',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'inherit',
                }}
              >
                <ArrowLeftRight size={14} /> Transpose
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={() => setShowPasteBox((v) => !v)}
                className="btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  cursor: 'pointer',
                  background: showPasteBox ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.04)',
                  color: 'inherit',
                }}
              >
                <ClipboardPaste size={14} /> Paste CSV / Sheets
              </button>
              <button
                type="button"
                onClick={handleCopyCsv}
                className="btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  cursor: 'pointer',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'inherit',
                }}
              >
                {copied ? <Check size={14} color="#10B981" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy CSV'}
              </button>
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  cursor: 'pointer',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'inherit',
                }}
              >
                <Download size={14} /> Download .csv
              </button>
            </div>
          </div>
        )}

        {/* Paste Area Overlay */}
        {showPasteBox && (
          <div
            style={{
              padding: '12px 20px',
              backgroundColor: 'var(--surface-sunken, rgba(0,0,0,0.3))',
              borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary, #9ca3af)' }}>
                Paste CSV or range copied from Excel / Google Sheets:
              </span>
              <button
                type="button"
                onClick={() => setShowPasteBox(false)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 12 }}
              >
                Cancel
              </button>
            </div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste data here (e.g. Region&#9;Q1&#9;Q2&#10;North&#9;100&#9;150)..."
              rows={4}
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: 12,
                fontFamily: 'monospace',
                backgroundColor: 'rgba(0,0,0,0.2)',
                border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
                borderRadius: 6,
                color: 'inherit',
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={handleApplyPaste}
                style={{
                  padding: '6px 14px',
                  backgroundColor: 'var(--accent, #3b82f6)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Apply Data
              </button>
            </div>
          </div>
        )}

        {/* Content Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {activeTab === 'grid' ? (
            <div
              style={{
                border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                borderRadius: 8,
                overflow: 'hidden',
                backgroundColor: 'rgba(0,0,0,0.12)',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                  textAlign: 'left',
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ width: 44, padding: '8px 12px', color: 'var(--text-secondary, #9ca3af)', fontWeight: 500 }}>
                      #
                    </th>
                    <th style={{ minWidth: 150, padding: '8px 12px', fontWeight: 600 }}>Category / Dimension</th>
                    {seriesList.map((series, sIdx) => (
                      <th
                        key={sIdx}
                        style={{
                          minWidth: 130,
                          padding: '6px 12px',
                          fontWeight: 600,
                          borderLeft: '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                            <ColorPickerPopover
                              color={series.color || '#3B82F6'}
                              onChange={(c) => setSeriesColor(sIdx, c)}
                            />
                            <input
                              type="text"
                              value={series.name}
                              onChange={(e) => setSeriesName(sIdx, e.target.value)}
                              aria-label={`Series ${sIdx + 1} Name`}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'inherit',
                                fontWeight: 600,
                                fontSize: 12,
                                width: '100%',
                                padding: '2px 4px',
                                borderRadius: 4,
                              }}
                            />
                          </div>
                          {seriesList.length > 1 && (
                            <button
                              type="button"
                              onClick={() => deleteSeries(sIdx)}
                              title="Delete this series"
                              aria-label={`Delete series ${series.name}`}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-secondary, #9ca3af)',
                                cursor: 'pointer',
                                padding: 2,
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </th>
                    ))}
                    <th style={{ width: 40, padding: '8px' }} />
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category, rIdx) => (
                    <tr
                      key={rIdx}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        backgroundColor: rIdx % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '6px 12px', color: 'var(--text-secondary, #9ca3af)', fontSize: 11 }}>
                        {rIdx + 1}
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input
                          ref={(el) => {
                            if (el) cellInputsRef.current.set(`${rIdx}:-1`, el);
                          }}
                          type="text"
                          value={category}
                          onChange={(e) => setCategory(rIdx, e.target.value)}
                          onKeyDown={(e) =>
                            handleCellKeyDown(e, rIdx, -1, categories.length, seriesList.length)
                          }
                          aria-label={`Row ${rIdx + 1} Category`}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '6px 8px',
                            backgroundColor: 'rgba(255,255,255,0.03)',
                            border: '1px solid transparent',
                            borderRadius: 4,
                            color: 'inherit',
                            fontSize: 12,
                          }}
                        />
                      </td>
                      {seriesList.map((series, sIdx) => {
                        const val = series.values[rIdx];
                        const displayVal = typeof val === 'number' ? String(val) : '';
                        return (
                          <td
                            key={sIdx}
                            style={{
                              padding: '4px 8px',
                              borderLeft: '1px solid rgba(255,255,255,0.06)',
                            }}
                          >
                            <input
                              ref={(el) => {
                                if (el) cellInputsRef.current.set(`${rIdx}:${sIdx}`, el);
                              }}
                              type="text"
                              value={displayVal}
                              onChange={(e) => setCellValue(sIdx, rIdx, e.target.value)}
                              onKeyDown={(e) =>
                                handleCellKeyDown(e, rIdx, sIdx, categories.length, seriesList.length)
                              }
                              aria-label={`Row ${rIdx + 1} Series ${series.name}`}
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '6px 8px',
                                backgroundColor: 'rgba(255,255,255,0.03)',
                                border: '1px solid transparent',
                                borderRadius: 4,
                                color: 'inherit',
                                fontSize: 12,
                                textAlign: 'right',
                                fontFamily: 'monospace',
                              }}
                            />
                          </td>
                        );
                      })}
                      <td style={{ padding: '4px', textAlign: 'center' }}>
                        {categories.length > 1 && (
                          <button
                            type="button"
                            onClick={() => deleteRow(rIdx)}
                            title="Delete this row"
                            aria-label={`Delete row ${rIdx + 1}`}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-secondary, #9ca3af)',
                              cursor: 'pointer',
                              padding: 4,
                              opacity: 0.6,
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* Live Data Connector Tab */
            <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div
                style={{
                  padding: 16,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
                }}
              >
                <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Data Source Mode</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {[
                    { mode: 'manual', label: 'Static Spreadsheet', desc: 'Embedded document state' },
                    { mode: 'url', label: 'REST API Polling', desc: 'Syncs from JSON endpoint' },
                    { mode: 'stream', label: 'Live Stream Ticker', desc: 'Real-time telemetry' },
                  ].map((item) => (
                    <button
                      key={item.mode}
                      type="button"
                      onClick={() => updateDataSource({ mode: item.mode as any })}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        padding: 12,
                        borderRadius: 8,
                        backgroundColor:
                          (dataSource.mode || 'manual') === item.mode
                            ? 'rgba(59, 130, 246, 0.15)'
                            : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${
                          (dataSource.mode || 'manual') === item.mode
                            ? 'var(--accent, #3b82f6)'
                            : 'rgba(255,255,255,0.08)'
                        }`,
                        color: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{item.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary, #9ca3af)' }}>{item.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {dataSource.mode === 'url' && (
                <div
                  style={{
                    padding: 16,
                    borderRadius: 8,
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>REST API Configuration</h4>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#9ca3af' }}>
                      API URL (GET endpoint returning CSV or JSON)
                    </label>
                    <input
                      type="url"
                      value={dataSource.url || ''}
                      onChange={(e) => updateDataSource({ url: e.target.value })}
                      placeholder="https://api.example.com/analytics/summary"
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '8px 10px',
                        borderRadius: 6,
                        backgroundColor: 'rgba(0,0,0,0.2)',
                        border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
                        color: 'inherit',
                        fontSize: 13,
                      }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#9ca3af' }}>
                        JSON Data Path (optional)
                      </label>
                      <input
                        type="text"
                        value={dataSource.dataPath || ''}
                        onChange={(e) => updateDataSource({ dataPath: e.target.value })}
                        placeholder="e.g. data.records"
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '8px 10px',
                          borderRadius: 6,
                          backgroundColor: 'rgba(0,0,0,0.2)',
                          border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
                          color: 'inherit',
                          fontSize: 13,
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#9ca3af' }}>
                        Poll Interval
                      </label>
                      <select
                        value={dataSource.pollInterval || 0}
                        onChange={(e) => updateDataSource({ pollInterval: Number(e.target.value) })}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '8px 10px',
                          borderRadius: 6,
                          backgroundColor: 'rgba(0,0,0,0.2)',
                          border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
                          color: 'inherit',
                          fontSize: 13,
                        }}
                      >
                        <option value={0}>Manual Only</option>
                        <option value={5}>Every 5 seconds</option>
                        <option value={15}>Every 15 seconds</option>
                        <option value={60}>Every 1 minute</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                    <button
                      type="button"
                      disabled={syncing || !dataSource.url}
                      onClick={fetchRestData}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 16px',
                        backgroundColor: 'var(--accent, #3b82f6)',
                        color: '#fff',
                        borderRadius: 6,
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: syncing || !dataSource.url ? 'not-allowed' : 'pointer',
                        opacity: syncing || !dataSource.url ? 0.6 : 1,
                      }}
                    >
                      <RefreshCw size={14} className={syncing ? 'spin' : ''} />
                      {syncing ? 'Fetching...' : 'Fetch & Sync Now'}
                    </button>

                    {dataSource.lastSyncedAt && (
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>
                        Last synced: {new Date(dataSource.lastSyncedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>

                  {syncMessage && (
                    <div
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        backgroundColor: syncMessage.includes('error')
                          ? 'rgba(239, 68, 68, 0.15)'
                          : 'rgba(16, 185, 129, 0.15)',
                        color: syncMessage.includes('error') ? '#EF4444' : '#10B981',
                      }}
                    >
                      {syncMessage}
                    </div>
                  )}
                </div>
              )}

              {dataSource.mode === 'stream' && (
                <div
                  style={{
                    padding: 16,
                    borderRadius: 8,
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Simulated Real-time Telemetry Stream</h4>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary, #9ca3af)', lineHeight: 1.5 }}>
                    Simulates a live streaming financial ticker, server CPU monitor, or sensor feed. Pushing new data
                    points dynamically rolls older observations off the left, keeping an active live window on the
                    board.
                  </p>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                      type="button"
                      onClick={triggerSimulatedTick}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 16px',
                        backgroundColor: 'var(--accent, #3b82f6)',
                        color: '#fff',
                        borderRadius: 6,
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      <Activity size={15} /> Push Next Live Tick
                    </button>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #9ca3af)' }}>
                      Window: rolling last 12 readings
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))',
            backgroundColor: 'rgba(0,0,0,0.15)',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-secondary, #9ca3af)' }}>
            Tip: Press <kbd style={{ padding: '2px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.1)' }}>Tab</kbd> or{' '}
            <kbd style={{ padding: '2px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.1)' }}>Enter</kbd> to jump between cells.
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 20px',
              backgroundColor: 'var(--accent, #3b82f6)',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
};
