import { cleanFamilyName, styleFromName } from './fontFile';
import { isBuiltInFamily } from './fontCatalogue';
import { setLocalFamilies, type DynamicFamily } from './fontLibrary';
import { storageGet, storageSet } from '../../utils/safeStorage';

/**
 * Fonts installed on this device, through the Local Font Access API.
 *
 * Chromium only, and only after the person asks: `queryLocalFonts()` needs a
 * user gesture the first time and shows a permission prompt. Once granted,
 * the list is read again silently on later visits.
 *
 * A local font exists only on this device. Nothing here uploads one; the
 * picker offers "Share with board" for that, and only on request.
 */

/** The parts of the API's `FontData` this module reads. */
interface FontDataLike {
  family: string;
  fullName?: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

type QueryLocalFonts = (options?: { postscriptNames?: string[] }) => Promise<FontDataLike[]>;

export type LocalFontsStatus = 'unsupported' | 'idle' | 'requesting' | 'granted' | 'denied' | 'error';

export interface LocalFontsState {
  status: LocalFontsStatus;
  families: DynamicFamily[];
  /** Shown under the action when the request failed for a reason other than refusal. */
  message?: string;
}

const GRANTED_KEY = 'vega_local_fonts_granted';

function query(): QueryLocalFonts | null {
  if (typeof window === 'undefined') return null;
  const fn = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
  return typeof fn === 'function' && window.isSecureContext !== false ? fn.bind(window) : null;
}

export function localFontAccessSupported(): boolean {
  return query() !== null;
}

let state: LocalFontsState = { status: localFontAccessSupported() ? 'idle' : 'unsupported', families: [] };
const listeners = new Set<() => void>();
let fontData: FontDataLike[] = [];

function set(next: LocalFontsState): void {
  state = next;
  listeners.forEach((fn) => fn());
}

export const localFontsStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): LocalFontsState => state,
};

/**
 * Faces grouped by family.
 *
 * Built-in families are left out: the catalogue already offers them, and two
 * rows named Inter would be one too many. Styles map to weights from their
 * names, because `FontData` reports "Semibold Italic", not a number.
 */
export function groupLocalFonts(fonts: Array<Pick<FontDataLike, 'family' | 'postscriptName' | 'style'>>): DynamicFamily[] {
  const byFamily = new Map<string, DynamicFamily>();
  for (const f of fonts) {
    const family = cleanFamilyName(f.family);
    if (!family || isBuiltInFamily(family)) continue;
    let fam = byFamily.get(family);
    if (!fam) {
      fam = { family, source: 'local', faces: [] };
      byFamily.set(family, fam);
    }
    const { weight, italic } = styleFromName(f.style);
    if (fam.faces.some((face) => face.weight === weight && face.italic === italic)) continue;
    fam.faces.push({ weight, italic, style: f.style, source: { kind: 'local', postscriptName: f.postscriptName } });
  }
  for (const fam of byFamily.values()) fam.faces.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic));
  return [...byFamily.values()].sort((a, b) => a.family.localeCompare(b.family));
}

async function read(): Promise<void> {
  const fn = query();
  if (!fn) {
    set({ status: 'unsupported', families: [] });
    return;
  }
  set({ ...state, status: 'requesting', message: undefined });
  try {
    fontData = await fn();
    const families = groupLocalFonts(fontData);
    setLocalFamilies(families);
    storageSet(GRANTED_KEY, '1');
    set({ status: 'granted', families });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      set({ status: 'denied', families: [] });
    } else {
      set({ status: 'error', families: [], message: 'This browser could not list the fonts on this device.' });
    }
  }
}

/** Ask for this device's fonts. Call from a click: the first call shows a prompt. */
export function requestLocalFonts(): Promise<void> {
  return read();
}

/**
 * Read the list again without a gesture, when permission was granted on an
 * earlier visit. Does nothing otherwise, so it never triggers a prompt.
 */
export async function restoreLocalFonts(): Promise<void> {
  if (state.status === 'granted' || state.status === 'requesting' || !query()) return;
  if (storageGet(GRANTED_KEY) !== '1') return;
  try {
    const perms = (navigator as unknown as { permissions?: { query(d: { name: string }): Promise<{ state: string }> } }).permissions;
    const status = await perms?.query({ name: 'local-fonts' });
    if (status?.state === 'granted') await read();
  } catch {
    // The permission name is unknown to this browser; leave it for a click.
  }
}

/**
 * The bytes of one local face, for an explicit "share with board" or for an
 * export the person opted into. Never called on its own initiative.
 */
export async function localFontBlob(family: string, weight = 400, italic = false): Promise<Blob | null> {
  const candidates = fontData.filter((f) => cleanFamilyName(f.family) === family);
  if (!candidates.length) return null;
  const score = (f: FontDataLike) => {
    const s = styleFromName(f.style);
    return Math.abs(s.weight - weight) + (s.italic === italic ? 0 : 1000);
  };
  const best = [...candidates].sort((a, b) => score(a) - score(b))[0];
  try {
    return await best.blob();
  } catch {
    return null;
  }
}

/** Every local face of a family, with its bytes, for sharing the whole family. */
export async function localFamilyBlobs(family: string): Promise<Array<{ style: string; blob: Blob }>> {
  const out: Array<{ style: string; blob: Blob }> = [];
  for (const f of fontData.filter((x) => cleanFamilyName(x.family) === family)) {
    try {
      out.push({ style: f.style, blob: await f.blob() });
    } catch {
      // A face the browser will not hand over is skipped, not fatal.
    }
  }
  return out;
}
