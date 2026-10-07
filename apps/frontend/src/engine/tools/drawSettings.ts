import { storageGetJson, storageSet } from '../../utils/safeStorage';
import { isBrush, type Brush } from './brushes';

/**
 * Drawing preferences that are this person's, not the board's.
 *
 * The brush, the ink and whether a held stroke snaps to a shape are choices
 * about the *next* mark, so they live with the tool rather than in the
 * document, and persist per browser. What a finished stroke looks like is
 * written onto the stroke itself when the pen lifts.
 */
export interface DrawSettings {
  brush: Brush;
  /** Ink for the pen and marker. `null` is the theme's ink, which flips with the theme. */
  ink: string | null;
  /** Ink for the highlighter, which is always a colour. */
  highlight: string;
  /** Hold still at the end of a stroke to turn it into a clean shape. */
  recognizeShapes: boolean;
  /** Brush wipes what the nib passes over; lasso removes what a drawn loop encloses. Alt swaps them for one gesture. */
  eraser: EraserMode;
}

export type EraserMode = 'brush' | 'lasso';

const KEY = 'vega.draw.settings';

const DEFAULTS: DrawSettings = {
  brush: 'pen',
  ink: null,
  highlight: '#FDE047',
  recognizeShapes: true,
  eraser: 'brush',
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function load(): DrawSettings {
  const raw = storageGetJson<Partial<DrawSettings>>(KEY, {});
  return {
    brush: isBrush(raw.brush) ? raw.brush : DEFAULTS.brush,
    ink: typeof raw.ink === 'string' && HEX.test(raw.ink) ? raw.ink : null,
    highlight: typeof raw.highlight === 'string' && HEX.test(raw.highlight) ? raw.highlight : DEFAULTS.highlight,
    recognizeShapes: typeof raw.recognizeShapes === 'boolean' ? raw.recognizeShapes : DEFAULTS.recognizeShapes,
    eraser: raw.eraser === 'lasso' ? 'lasso' : 'brush',
  };
}

let state: DrawSettings = load();
const listeners = new Set<() => void>();

export const drawSettings = {
  get(): DrawSettings {
    return state;
  },
  set(patch: Partial<DrawSettings>): void {
    state = { ...state, ...patch };
    storageSet(KEY, JSON.stringify(state));
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** Ink colours offered for the pen and marker, after the theme ink. */
export const INK_SWATCHES: readonly { color: string; name: string }[] = [
  { color: '#E03131', name: 'Red' },
  { color: '#F08C00', name: 'Orange' },
  { color: '#2F9E44', name: 'Green' },
  { color: '#1971C2', name: 'Blue' },
  { color: '#7048E8', name: 'Violet' },
];

/** Highlighter inks. Light, saturated hues, because they are laid down translucent. */
export const HIGHLIGHT_SWATCHES: readonly { color: string; name: string }[] = [
  { color: '#FDE047', name: 'Yellow' },
  { color: '#86EFAC', name: 'Green' },
  { color: '#F9A8D4', name: 'Pink' },
  { color: '#7DD3FC', name: 'Blue' },
  { color: '#FDBA74', name: 'Orange' },
];
