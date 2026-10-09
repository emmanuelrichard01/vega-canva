import { FORMAT_SPECS, type ExportFormat, type ExportOptions } from '../../engine/export/ExportTypes';
import { exportFilename } from '../../engine/export/filenames';
import type { ExportJob } from '../../engine/export/ExportService';

/**
 * Export presets: Figma's per-layer export settings.
 *
 * A preset is a format, a scale and an optional filename suffix. An object
 * (a frame, or whatever is selected) carries a list of them; Export renders
 * one file per preset per target, and more than one file goes out as a ZIP.
 *
 * Kept in this browser per board, keyed by the object, so a frame you set up
 * to export at 1× and 2× PNG plus an SVG still has those settings next time.
 * Pure: storage is read and written by the caller.
 */

export type PresetFormat = Extract<ExportFormat, 'png' | 'jpeg' | 'webp' | 'svg' | 'pdf'>;

export interface ExportPreset {
  id: string;
  format: PresetFormat;
  scale: number;
  /**
   * Appended to the file's name. Absent means the density marker (`@2x`) for
   * pixel formats and nothing otherwise; an empty string means no suffix.
   */
  suffix?: string;
}

export const PRESET_FORMATS: readonly PresetFormat[] = ['png', 'jpeg', 'webp', 'svg', 'pdf'];
export const PRESET_SCALES: readonly number[] = [0.5, 1, 1.5, 2, 3, 4];
export const MAX_PRESETS = 8;

export const DEFAULT_PRESET: ExportPreset = { id: 'p-default', format: 'png', scale: 2 };

export interface StoredPresets {
  /** Presets per object id. */
  byNode: Record<string, ExportPreset[]>;
  /** The list last used, offered to an object that has none of its own. */
  last: ExportPreset[];
}

export const presetsKey = (roomId: string) => `vega:export-presets:${roomId || 'local'}`;

/** Objects remembered per board, newest kept, so storage cannot grow without bound. */
const MAX_REMEMBERED = 200;

let counter = 0;
export const newPresetId = () => `p-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function sanitizePreset(raw: unknown): ExportPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const format = PRESET_FORMATS.includes(r.format as PresetFormat) ? (r.format as PresetFormat) : null;
  if (!format) return null;
  const scale = PRESET_SCALES.includes(r.scale as number) ? (r.scale as number) : 1;
  const id = typeof r.id === 'string' && r.id && r.id.length <= 40 ? r.id : newPresetId();
  const suffix = typeof r.suffix === 'string' ? r.suffix.slice(0, 24) : undefined;
  return suffix === undefined ? { id, format, scale } : { id, format, scale, suffix };
}

export function sanitizePresetList(raw: unknown): ExportPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: ExportPreset[] = [];
  const ids = new Set<string>();
  for (const item of raw.slice(0, MAX_PRESETS)) {
    const preset = sanitizePreset(item);
    if (!preset) continue;
    if (ids.has(preset.id)) preset.id = newPresetId();
    ids.add(preset.id);
    out.push(preset);
  }
  return out;
}

/** Stored presets, checked field by field: storage outlives builds and can be edited by hand. */
export function sanitizeStoredPresets(raw: unknown): StoredPresets {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const byNode: Record<string, ExportPreset[]> = {};
  const entries = r.byNode && typeof r.byNode === 'object' ? Object.entries(r.byNode as Record<string, unknown>) : [];
  for (const [id, list] of entries.slice(-MAX_REMEMBERED)) {
    if (typeof id !== 'string' || id.length > 64) continue;
    const presets = sanitizePresetList(list);
    if (presets.length) byNode[id] = presets;
  }
  const last = sanitizePresetList(r.last);
  return { byNode, last: last.length ? last : [DEFAULT_PRESET] };
}

/** The presets an object exports with: its own, else the last list used. */
export function presetsFor(stored: StoredPresets, key: string): ExportPreset[] {
  return stored.byNode[key] ?? stored.last;
}

/** `stored` with this object's list replaced (and remembered as the last used). */
export function withPresets(stored: StoredPresets, key: string, presets: readonly ExportPreset[]): StoredPresets {
  const byNode = { ...stored.byNode };
  delete byNode[key];
  const list = sanitizePresetList(presets);
  if (list.length) byNode[key] = list;
  const keys = Object.keys(byNode);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete byNode[old];
  return { byNode, last: list.length ? list : stored.last };
}

/** The suffix a preset will write, for showing as a placeholder. */
export function defaultSuffix(preset: Pick<ExportPreset, 'format' | 'scale'>): string {
  return FORMAT_SPECS[preset.format].raster && preset.scale !== 1 ? `@${preset.scale}x` : '';
}

/** The next preset to add: the largest scale not yet listed, as Figma steps 1×, 2×, 3×. */
export function nextPreset(presets: readonly ExportPreset[]): ExportPreset {
  const last = presets[presets.length - 1] ?? DEFAULT_PRESET;
  const used = new Set(presets.filter((p) => p.format === last.format).map((p) => p.scale));
  const scale = PRESET_SCALES.find((s) => Number.isInteger(s) && !used.has(s)) ?? last.scale;
  return { id: newPresetId(), format: last.format, scale };
}

export interface ExportTarget {
  /** Names the files, before slugifying: a frame's title, a note's words. */
  name: string;
  /** What to export: a frame id, or the selection's ids. */
  options: ExportOptions;
}

/** One job per preset per target, named from the target with each preset's suffix. */
export function planJobs(targets: readonly ExportTarget[], presets: readonly ExportPreset[], base: ExportOptions = {}): ExportJob[] {
  const jobs: ExportJob[] = [];
  for (const target of targets) {
    for (const preset of presets) {
      jobs.push({
        format: preset.format,
        options: { ...base, ...target.options, scale: preset.scale },
        filename: exportFilename(target.name, preset.format, preset.scale, preset.suffix),
      });
    }
  }
  return jobs;
}
