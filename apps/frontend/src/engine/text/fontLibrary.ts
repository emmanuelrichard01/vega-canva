import type { FontEntry } from './fontCatalogue';
import { CSS_FORMAT, type FontFormat } from './fontFile';
import { fontsArrived } from './fontEpoch';

/**
 * Families that are not in the built-in catalogue: fonts uploaded to this
 * board, and fonts installed on this device that the person chose to use.
 *
 * Both arrive at runtime, so they live here rather than in `FONTS`.
 * `fontCatalogue.fontEntry` consults this module after its own list, which is
 * what lets `fontStack`, `weightsFor` and the rest treat an uploaded family
 * exactly like a built-in one.
 *
 * This module only imports a type from the catalogue, so there is no import
 * cycle at runtime.
 */

export type DynamicSource = 'board' | 'local';

/** Where one face's bytes come from. */
export type FaceSource =
  | { kind: 'url'; url: string; format: FontFormat }
  | { kind: 'local'; postscriptName: string };

export interface DynamicFace {
  weight: number;
  italic: boolean;
  /** Set for a variable face: the range its weight axis covers. */
  weightMin?: number;
  weightMax?: number;
  source: FaceSource;
  /** The face's own style name, for the picker. */
  style: string;
}

export interface DynamicFamily {
  family: string;
  source: DynamicSource;
  faces: DynamicFace[];
}

const LADDER = [100, 200, 300, 400, 500, 600, 700, 800, 900];

let board = new Map<string, DynamicFamily>();
let local = new Map<string, DynamicFamily>();
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version += 1;
  entryCache.clear();
  listeners.forEach((fn) => fn());
}

/** For `useSyncExternalStore`: moves whenever either set of families changes. */
export const fontLibrary = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): number => version,
};

function sameFamilies(a: Map<string, DynamicFamily>, b: Map<string, DynamicFamily>): boolean {
  if (a.size !== b.size) return false;
  for (const [name, fam] of a) {
    const other = b.get(name);
    if (!other || JSON.stringify(other.faces) !== JSON.stringify(fam.faces)) return false;
  }
  return true;
}

/**
 * Replace the board's families.
 *
 * A family that renderers already asked for and could not find is loaded
 * here and announced, so text set in an uploaded face redraws in it as soon
 * as the registry syncs rather than on the next unrelated repaint.
 */
export function setBoardFamilies(families: DynamicFamily[]): void {
  const next = new Map(families.map((f) => [f.family, f]));
  if (sameFamilies(board, next)) return;
  board = next;
  changed();
  for (const family of wanted) {
    if (board.has(family)) void ensureDynamicFamily(family);
  }
}

/** Replace the families this device offers. Board families win a name clash. */
export function setLocalFamilies(families: DynamicFamily[]): void {
  const next = new Map(families.map((f) => [f.family, f]));
  if (sameFamilies(local, next)) return;
  local = next;
  changed();
}

export function boardFamilies(): DynamicFamily[] {
  return [...board.values()].sort((a, b) => a.family.localeCompare(b.family));
}

export function localFamilies(): DynamicFamily[] {
  return [...local.values()].sort((a, b) => a.family.localeCompare(b.family));
}

export function dynamicFamily(family: string | undefined): DynamicFamily | undefined {
  if (!family) return undefined;
  return board.get(family) ?? local.get(family);
}

/** The weights a set of faces genuinely covers, variable ranges expanded to the ladder. */
export function weightsOfFaces(faces: DynamicFace[]): number[] {
  const set = new Set<number>();
  for (const face of faces) {
    if (face.weightMin !== undefined && face.weightMax !== undefined) {
      LADDER.filter((w) => w >= face.weightMin! && w <= face.weightMax!).forEach((w) => set.add(w));
    } else {
      set.add(face.weight);
    }
  }
  const list = [...set].sort((a, b) => a - b);
  return list.length ? list : [400];
}

const entryCache = new Map<string, FontEntry>();

/** A catalogue entry for a runtime family, in the shape the rest of the app expects. */
export function dynamicEntry(family: string | undefined): FontEntry | undefined {
  const fam = dynamicFamily(family);
  if (!fam) return undefined;
  const cached = entryCache.get(fam.family);
  if (cached) return cached;
  const entry: FontEntry = {
    family: fam.family,
    category: 'sans',
    source: fam.source,
    generic: 'sans-serif',
    weights: weightsOfFaces(fam.faces),
    italic: fam.faces.some((f) => f.italic),
  };
  entryCache.set(fam.family, entry);
  return entry;
}

/** The face closest to a requested weight and slant. */
export function bestFace(faces: DynamicFace[], weight = 400, italic = false): DynamicFace | undefined {
  const score = (f: DynamicFace) => {
    const w =
      f.weightMin !== undefined && f.weightMax !== undefined && weight >= f.weightMin && weight <= f.weightMax
        ? 0
        : Math.abs(f.weight - weight);
    return w + (f.italic === italic ? 0 : 1000);
  };
  return [...faces].sort((a, b) => score(a) - score(b))[0];
}

/** The `src` descriptor for a face. */
export function faceSrc(source: FaceSource): string {
  if (source.kind === 'local') return `local("${source.postscriptName.replace(/["\\]/g, '')}")`;
  return `url("${source.url.replace(/["\\]/g, '')}") format("${CSS_FORMAT[source.format]}")`;
}

/** Each face is registered once per page, whatever asks for it. */
const loads = new Map<string, Promise<boolean>>();
/** Families asked for before the registry knew them; retried when it does. */
const wanted = new Set<string>();

type FontFaceCtor = new (
  family: string,
  source: string,
  descriptors?: { weight?: string; style?: string; display?: string }
) => { load(): Promise<unknown>; status?: string };

function faceKey(family: string, face: DynamicFace): string {
  const src = face.source.kind === 'url' ? face.source.url : `local:${face.source.postscriptName}`;
  return `${family}|${src}|${face.weight}|${face.italic ? 'i' : 'n'}`;
}

/**
 * Register and load every face of a runtime family.
 *
 * Resolves once the faces have loaded or failed; a failure leaves the
 * fallback standing, which is already what is drawn. When anything new did
 * load, the font epoch moves so measured text is laid out again in the real
 * face.
 */
export function ensureDynamicFamily(family: string | undefined): Promise<void> {
  if (!family) return Promise.resolve();
  const fam = dynamicFamily(family);
  if (!fam) {
    wanted.add(family);
    return Promise.resolve();
  }
  wanted.delete(family);

  const Ctor = (globalThis as { FontFace?: FontFaceCtor }).FontFace;
  const fontSet = typeof document !== 'undefined' ? (document.fonts as unknown as { add(f: unknown): void } | undefined) : undefined;
  if (!Ctor || !fontSet) return Promise.resolve();

  const pending = fam.faces.map((face) => {
    const key = faceKey(fam.family, face);
    const existing = loads.get(key);
    if (existing) return existing.then(() => false);
    const weight =
      face.weightMin !== undefined && face.weightMax !== undefined
        ? `${face.weightMin} ${face.weightMax}`
        : String(face.weight);
    const ff = new Ctor(fam.family, faceSrc(face.source), {
      weight,
      style: face.italic ? 'italic' : 'normal',
      display: 'swap',
    });
    fontSet.add(ff);
    const load = ff
      .load()
      .then(() => true)
      .catch(() => false);
    loads.set(key, load);
    return load;
  });

  return Promise.all(pending).then((results) => {
    if (results.some(Boolean)) fontsArrived();
  });
}

/** Whether a face of this family is loading, loaded or failed, for the picker. */
export function familyLoadState(family: string): 'idle' | 'loading' | 'ready' | 'failed' {
  const fam = dynamicFamily(family);
  if (!fam) return 'idle';
  const keys = fam.faces.map((f) => faceKey(fam.family, f));
  if (!keys.some((k) => loads.has(k))) return 'idle';
  return settled.get(fam.family) ?? 'loading';
}

const settled = new Map<string, 'ready' | 'failed'>();

/** Load a family and remember how it went, so the picker can say so. */
export async function loadFamilyForPicker(family: string): Promise<'ready' | 'failed'> {
  await ensureDynamicFamily(family);
  const fam = dynamicFamily(family);
  if (!fam) return 'failed';
  const results = await Promise.all(fam.faces.map((f) => loads.get(faceKey(fam.family, f)) ?? Promise.resolve(false)));
  const state = results.some(Boolean) ? 'ready' : 'failed';
  settled.set(fam.family, state);
  changed();
  return state;
}

/** Test seam: forget every registration. */
export function resetFontLibraryForTests(): void {
  board = new Map();
  local = new Map();
  loads.clear();
  wanted.clear();
  settled.clear();
  changed();
}
