import type * as Y from 'yjs';
import { doc, fontsMap } from './doc';
import { canEditObjects } from '../model/permissions';
import { cleanFamilyName, type FontFormat } from '../text/fontFile';
import { setBoardFamilies, type DynamicFamily } from '../text/fontLibrary';

/**
 * Fonts uploaded to this board.
 *
 * One entry per face, keyed by id, in the `fonts` map. A face is a plain
 * record rather than a nested Y.Map: it is written once at upload and never
 * edited, so last-writer-wins on the whole record is the right merge, and two
 * people uploading at the same moment add two keys that both survive.
 *
 * Every collaborator loads the faces through `FontFace` (see
 * `text/fontLibrary.ts`), which is what lets a board be set in a typeface
 * nobody in the room has installed.
 */

export interface BoardFont {
  id: string;
  family: string;
  style: string;
  weight: number;
  italic: boolean;
  weightMin?: number;
  weightMax?: number;
  url: string;
  format: FontFormat;
  sizeBytes: number;
  uploadedBy?: string;
  uploadedAt: number;
}

const FORMATS: ReadonlySet<string> = new Set(['woff2', 'woff', 'ttf', 'otf']);

const clampWeight = (n: unknown): number | undefined =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1000, Math.max(1, Math.round(n))) : undefined;

/**
 * A stored entry, checked.
 *
 * The map is written by clients, so every field is validated on the way out:
 * the URL must be http(s) (it ends up inside a `url()` in CSS), and the
 * family name is cleaned so it cannot break out of a quoted CSS string.
 */
export function normalizeBoardFont(raw: unknown): BoardFont | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.slice(0, 64) : '';
  const family = cleanFamilyName(typeof r.family === 'string' ? r.family : '');
  const url = typeof r.url === 'string' ? r.url : '';
  const format = typeof r.format === 'string' && FORMATS.has(r.format) ? (r.format as FontFormat) : null;
  if (!id || !family || !format) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  } catch {
    return null;
  }
  const weight = clampWeight(r.weight) ?? 400;
  const weightMin = clampWeight(r.weightMin);
  const weightMax = clampWeight(r.weightMax);
  return {
    id,
    family,
    style: cleanFamilyName(typeof r.style === 'string' ? r.style : '') || 'Regular',
    weight,
    italic: r.italic === true,
    ...(weightMin !== undefined && weightMax !== undefined && weightMax > weightMin ? { weightMin, weightMax } : {}),
    url,
    format,
    sizeBytes: typeof r.sizeBytes === 'number' && r.sizeBytes > 0 ? r.sizeBytes : 0,
    ...(typeof r.uploadedBy === 'string' ? { uploadedBy: r.uploadedBy.slice(0, 80) } : {}),
    uploadedAt: typeof r.uploadedAt === 'number' ? r.uploadedAt : 0,
  };
}

/** Every valid face in a fonts map, by family, then weight, then upright first. */
export function listBoardFonts(map: Y.Map<unknown>): BoardFont[] {
  const out: BoardFont[] = [];
  map.forEach((value) => {
    const font = normalizeBoardFont(value);
    if (font) out.push(font);
  });
  return out.sort(
    (a, b) =>
      a.family.localeCompare(b.family) ||
      a.weight - b.weight ||
      Number(a.italic) - Number(b.italic) ||
      a.id.localeCompare(b.id)
  );
}

/** Faces grouped into families, in the shape the font library takes. */
export function groupBoardFonts(fonts: BoardFont[]): DynamicFamily[] {
  const byFamily = new Map<string, DynamicFamily>();
  for (const f of fonts) {
    let fam = byFamily.get(f.family);
    if (!fam) {
      fam = { family: f.family, source: 'board', faces: [] };
      byFamily.set(f.family, fam);
    }
    // Two uploads of the same face keep the earlier one, so every client
    // picks the same file.
    if (fam.faces.some((face) => face.weight === f.weight && face.italic === f.italic)) continue;
    fam.faces.push({
      weight: f.weight,
      italic: f.italic,
      ...(f.weightMin !== undefined ? { weightMin: f.weightMin, weightMax: f.weightMax } : {}),
      source: { kind: 'url', url: f.url, format: f.format },
      style: f.style,
    });
  }
  return [...byFamily.values()];
}

/** Write a face into a fonts map. Pure, for tests and for `registerBoardFont`. */
export function putBoardFont(map: Y.Map<unknown>, font: BoardFont): void {
  const clean = normalizeBoardFont(font);
  if (clean) map.set(clean.id, clean);
}

/** Add an uploaded face to this board. Editors only. */
export function registerBoardFont(font: BoardFont): boolean {
  if (!canEditObjects()) return false;
  if (!normalizeBoardFont(font)) return false;
  doc.transact(() => putBoardFont(fontsMap, font));
  return true;
}

/** Remove a face from this board. Text set in it falls back. Editors only. */
export function removeBoardFont(id: string): boolean {
  if (!canEditObjects() || !fontsMap.has(id)) return false;
  doc.transact(() => fontsMap.delete(id));
  return true;
}

export function readBoardFonts(): BoardFont[] {
  return listBoardFonts(fontsMap);
}

let started = false;

/**
 * Keep the font library in step with the board's registry.
 *
 * Started once, when the document layer is first imported, so a board that
 * arrives with text in an uploaded face loads it without anybody opening the
 * font picker.
 */
export function startBoardFontSync(): void {
  if (started) return;
  started = true;
  const publish = () => setBoardFamilies(groupBoardFonts(listBoardFonts(fontsMap)));
  publish();
  fontsMap.observe(publish);
}

if (typeof window !== 'undefined') startBoardFontSync();
