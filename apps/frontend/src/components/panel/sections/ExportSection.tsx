import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Link2, Minus, X } from 'lucide-react';
import { Note, Section, Select } from '../grammar';
import type { AnyNode } from '../../../engine/model/schema';
import { FORMAT_SPECS } from '../../../engine/export/ExportTypes';
import { exportScope } from '../../../engine/export/exportScope';
import { slugify } from '../../../engine/export/filenames';
import { downloadTableCsv } from '../../../engine/table/tableModel';
import { downloadCsv } from '../../../engine/chart/chartCsv';
import { roomId } from '../../../engine/document';
import { useStore } from '../../../hooks/useStore';
import { storageGetJson, storageSet } from '../../../utils/safeStorage';
import {
  MAX_PRESETS,
  PRESET_FORMATS,
  PRESET_SCALES,
  defaultSuffix,
  nextPreset,
  planJobs,
  presetsFor,
  presetsKey,
  sanitizeStoredPresets,
  withPresets,
  type ExportPreset,
  type ExportTarget,
  type PresetFormat,
} from '../../export/exportPresets';
import { frameLink } from '../../export/frameLink';
import '../../export/exportSection.css';

/**
 * Export, in the properties panel: Figma's per-layer export settings.
 *
 * The selection carries a list of presets (scale, suffix, format) and one
 * button renders them all. A frame exports as its page; several selected
 * frames export a set each; anything else exports as the selection. More than
 * one file arrives as a ZIP named after the subject. The presets are kept
 * per object in this browser, so a frame set up once exports the same way
 * next time.
 *
 * Exporting reads the board and writes nothing to it, so every role may.
 */

const SCALE_OPTIONS = PRESET_SCALES.map((s) => ({ value: String(s), label: `${s}×` }));
const FORMAT_OPTIONS = PRESET_FORMATS.map((f) => ({ value: f, label: FORMAT_SPECS[f].label, detail: FORMAT_SPECS[f].blurb }));

type Run = { controller: AbortController; done: number; total: number };

function readStored() {
  return sanitizeStoredPresets(storageGetJson(presetsKey(roomId), null));
}

export const ExportSection: React.FC<{ nodes: AnyNode[] }> = ({ nodes }) => {
  const exportable = useMemo(() => nodes.filter((n) => n.type !== 'comment'), [nodes]);
  const ids = useMemo(() => exportable.map((n) => n.id), [exportable]);
  const key = ids.length === 1 ? ids[0] : 'selection';
  const [stored, setStored] = useState(readStored);
  const presets = presetsFor(stored, key);
  const [run, setRun] = useState<Run | null>(null);
  const [said, setSaid] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const runRef = useRef<Run | null>(null);
  runRef.current = run;

  // A new subject clears the last outcome; a run in flight keeps going.
  useEffect(() => setSaid(null), [key]);
  useEffect(() => () => runRef.current?.controller.abort(), []);

  const frames = exportable.filter((n) => n.type === 'frame');
  const allFrames = frames.length > 0 && frames.length === exportable.length;

  if (exportable.length === 0) return null;

  const save = (next: ExportPreset[]) => {
    const updated = withPresets(stored, key, next);
    setStored(updated);
    storageSet(presetsKey(roomId), JSON.stringify(updated));
  };
  const patch = (id: string, change: Partial<ExportPreset>) => save(presets.map((p) => (p.id === id ? { ...p, ...change } : p)));

  /**
   * What one press of Export renders: a frame per target, or the selection as
   * one. `whole` resolves the selection against the board (a selected frame
   * brings its contents); without it only the names are worked out, which is
   * what a render needs and costs nothing per frame of a drag.
   */
  const targets = (whole: boolean): ExportTarget[] => {
    if (allFrames) {
      return frames.map((f) => ({ name: f.title?.trim() || 'Frame', options: { frameId: f.id } }));
    }
    const objects = whole ? useStore.getState().objects : Object.fromEntries(exportable.map((n) => [n.id, n]));
    const scope = exportScope(objects, ids, 'Selection');
    return [{ name: scope.filenameBase, options: { selectedOnly: true, selectedIds: scope.ids ?? ids, padding: 0 } }];
  };

  const subjectName = allFrames && frames.length === 1 ? frames[0].title?.trim() || 'Frame' : allFrames ? `${frames.length} frames` : 'Selection';
  const fileCount = (allFrames ? frames.length : 1) * presets.length;
  // One file is named outright, so the suffix field's effect is visible before exporting.
  const onlyFile = fileCount === 1 ? planJobs(targets(false), presets)[0]?.filename : undefined;

  const start = async () => {
    if (run) return;
    const controller = new AbortController();
    const jobs = planJobs(targets(true), presets, {
      background: 'transparent',
      stage: (window as unknown as { _konva_stage?: unknown })._konva_stage,
    });
    setSaid(null);
    setRun({ controller, done: 0, total: jobs.length });
    try {
      const { ExportService } = await import('../../../engine/export');
      const result = await ExportService.exportFiles(jobs, {
        archiveName: `${subjectName.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'export'}`,
        signal: controller.signal,
        onProgress: (p) => setRun((r) => (r ? { ...r, done: p.done } : r)),
      });
      setSaid({ tone: 'ok', text: result.archive ? `Saved ${result.files} files as a ZIP` : 'Saved' });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') setSaid({ tone: 'ok', text: 'Export cancelled' });
      else setSaid({ tone: 'bad', text: error instanceof Error && error.message ? error.message : 'The export did not finish.' });
    } finally {
      setRun(null);
    }
  };

  /** A single table or chart also exports its data, as a spreadsheet reads it. */
  const data = exportable.length === 1 && (exportable[0].type === 'table' || exportable[0].type === 'chart') ? exportable[0] : null;
  const downloadData = () => {
    if (!data) return;
    const name = slugify(data.title?.trim() || (data.type === 'table' ? 'table' : 'chart'));
    if (data.type === 'table') downloadTableCsv(data.table, name);
    else if (data.type === 'chart') downloadCsv(data.chart, name);
    setSaid({ tone: 'ok', text: 'Data saved as CSV' });
  };

  const copyLink = async () => {
    if (frames.length !== 1 || !allFrames) return;
    try {
      await navigator.clipboard.writeText(frameLink(window.location.origin, roomId, frames[0].id));
      setSaid({ tone: 'ok', text: 'Link to this frame copied' });
    } catch {
      setSaid({ tone: 'bad', text: 'The clipboard is blocked here. Allow clipboard access for this site.' });
    }
  };

  return (
    <Section
      id="export"
      title="Export"
      onAdd={presets.length < MAX_PRESETS ? () => save([...presets, nextPreset(presets)]) : undefined}
      addLabel="Add export setting"
      empty={presets.length === 0}
    >
      <div className="pg-list" role="list" aria-label="Export settings">
        {presets.map((preset) => (
          <div key={preset.id} className="xp-preset" role="listitem">
            <Select
              label="Scale"
              value={String(preset.scale)}
              options={FORMAT_SPECS[preset.format].raster ? SCALE_OPTIONS : [{ value: String(preset.scale), label: '—' }]}
              disabledReason={FORMAT_SPECS[preset.format].raster ? undefined : `${FORMAT_SPECS[preset.format].label} is vector; it has no scale`}
              onChange={(v) => patch(preset.id, { scale: Number(v) })}
            />
            <input
              className="xp-suffix"
              type="text"
              spellCheck={false}
              aria-label="Filename suffix"
              placeholder={defaultSuffix(preset) || 'Suffix'}
              value={preset.suffix ?? ''}
              maxLength={24}
              onChange={(e) => patch(preset.id, { suffix: e.target.value === '' ? undefined : e.target.value })}
            />
            <Select<PresetFormat>
              label="Format"
              value={preset.format}
              options={FORMAT_OPTIONS}
              onChange={(format) => patch(preset.id, { format })}
            />
            <button
              type="button"
              className="pg-icon-btn"
              aria-label={`Remove ${FORMAT_SPECS[preset.format].label} ${preset.scale}× export`}
              data-tooltip="Remove"
              onClick={() => save(presets.filter((p) => p.id !== preset.id))}
            >
              <Minus size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <div className="xp-actions">
        {run ? (
          <div className="xp-run" role="status" aria-live="polite">
            <span className="xp-run__text">
              Exporting {Math.min(run.done + 1, run.total)} of {run.total}
            </span>
            <span className="xp-run__bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${run.done / Math.max(1, run.total)})` }} />
            </span>
            <button type="button" className="pg-icon-btn" aria-label="Cancel export" data-tooltip="Cancel" onClick={() => run.controller.abort()}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button type="button" className="xp-button" onClick={() => void start()} disabled={presets.length === 0}>
            <Download size={14} aria-hidden="true" />
            <span className="xp-button__label">Export {subjectName}</span>
          </button>
        )}
        {data && !run && (
          <button
            type="button"
            className="pg-icon-btn xp-link"
            aria-label={`Download the ${data.type === 'table' ? 'table' : 'chart data'} as CSV`}
            data-tooltip="Download data as CSV"
            onClick={downloadData}
          >
            <FileSpreadsheet size={14} aria-hidden="true" />
          </button>
        )}
        {allFrames && frames.length === 1 && !run && (
          <button type="button" className="pg-icon-btn xp-link" aria-label="Copy link to this frame" data-tooltip="Copy link to frame" onClick={() => void copyLink()}>
            <Link2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {said?.tone === 'bad' ? (
        <div className="pg-alert" role="alert">
          <AlertTriangle size={14} aria-hidden="true" className="pg-alert__icon" />
          <p className="pg-alert__text">{said.text}</p>
          <button type="button" className="pg-alert__action" onClick={() => void start()}>
            Try again
          </button>
        </div>
      ) : (
        <Note>
          <span aria-live="polite">
            {said?.text ?? (fileCount > 1 ? `${fileCount} files, saved as one ZIP.` : onlyFile ?? 'One file.')}
          </span>
        </Note>
      )}
    </Section>
  );
};
