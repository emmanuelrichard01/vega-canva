import { SHAPE_BY_PRESET, SHAPE_CATEGORIES, type ShapePreset } from './shapeCatalog';

/**
 * What the shape library shows and how it is navigated, without the DOM.
 *
 * Everything here is a pure function of the catalogue and a few lists of
 * presets, so the rules the sheet lives by (each shape once per family, no
 * shape twice in a search, recents that do not repeat a pin) are testable on
 * their own and cannot drift between the sheet and its tests.
 */

/**
 * The quick row: the eight shapes a board reaches for first, fixed rather than
 * learned so they never move under a pointer that has learned where they are.
 */
export const QUICK_SHAPES: readonly ShapePreset[] = [
  'rect',
  'rounded_rect',
  'ellipse',
  'diamond',
  'triangle',
  'capsule',
  'hexagon',
  'star',
];

/** The families, in the order the jump control and the scroll show them. */
const FAMILY_ORDER = ['basic', 'flowchart', 'advanced', 'arrows', 'annotation'] as const;

export interface LibrarySection {
  id: string;
  label: string;
  presets: readonly ShapePreset[];
  /** A family, which the jump control can scroll to and the heading sticks for. */
  family?: boolean;
}

/**
 * One section per family, each shape under the first family that lists it.
 *
 * The catalogue cross-lists (a diamond is Basic *and* Flowchart), which is
 * right for a search and for the rail's swapper. On one scroll it only means
 * meeting the diamond twice.
 */
export const FAMILY_SECTIONS: readonly LibrarySection[] = (() => {
  const seen = new Set<ShapePreset>();
  return FAMILY_ORDER.flatMap((id) => {
    const category = SHAPE_CATEGORIES.find((c) => c.id === id);
    if (!category) return [];
    const presets = category.groups
      .flatMap((g) => g.presets)
      .filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
    return presets.length ? [{ id, label: category.name, presets, family: true }] : [];
  });
})();

/** Every shape the library offers, once each. */
export const LIBRARY_PRESETS: readonly ShapePreset[] = FAMILY_SECTIONS.flatMap((s) => s.presets);

const OFFERED: ReadonlySet<string> = new Set(LIBRARY_PRESETS);

/**
 * The sheet's sections when nothing is typed: the quick row, the pins, the
 * recents, then every family.
 *
 * Pins and recents are filtered to what this sheet offers (a line placed from
 * its own seat is recent too, but it is not a tile here) and the recents skip
 * anything already pinned or already in the quick row, so the top of the sheet
 * never shows one shape twice.
 */
export function librarySections(recent: readonly string[], pinned: readonly string[]): LibrarySection[] {
  const pins = unique(pinned).filter((p): p is ShapePreset => OFFERED.has(p));
  const above = new Set<string>([...QUICK_SHAPES, ...pins]);
  const recents = unique(recent)
    .filter((p): p is ShapePreset => OFFERED.has(p) && !above.has(p))
    .slice(0, 8);
  return [
    { id: 'quick', label: 'Common', presets: QUICK_SHAPES },
    ...(pins.length ? [{ id: 'pinned', label: 'Pinned', presets: pins }] : []),
    ...(recents.length ? [{ id: 'recent', label: 'Recent', presets: recents }] : []),
    ...FAMILY_SECTIONS,
  ];
}

function unique(list: readonly string[]): string[] {
  return Array.from(new Set(list));
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * The sheet's measurements, which the stylesheet reads as custom properties.
 *
 * Eight 40px tiles on a 2px gap make a 334px grid inside a 344px sheet. The
 * scroll reaches out through the flyout panel's 8px padding to its edges and
 * reserves the scrollbar's gutter on *both* sides, then centres the grid in
 * what is left. So the grid sits the same distance from the panel's left and
 * right edges whatever the platform's scrollbar is: none (an overlay
 * scrollbar), a thin one, or a classic one up to 13px.
 */
export const LIBRARY_LAYOUT = { cols: 8, tile: 40, gap: 2, width: 344, panelPad: 8 } as const;

export const LIBRARY_GRID = LIBRARY_LAYOUT.cols * LIBRARY_LAYOUT.tile + (LIBRARY_LAYOUT.cols - 1) * LIBRARY_LAYOUT.gap;

/** Where the grid's edges land inside the flyout panel, for a scrollbar gutter `scrollbar` px wide. */
export function libraryInsets(scrollbar: number): { left: number; right: number; fits: boolean } {
  const span = LIBRARY_LAYOUT.width + 2 * LIBRARY_LAYOUT.panelPad;
  const content = span - 2 * scrollbar;
  const left = scrollbar + (content - LIBRARY_GRID) / 2;
  return { left, right: span - left - LIBRARY_GRID, fits: content >= LIBRARY_GRID };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Optimal string alignment distance: insertions, deletions, substitutions and
 * one swap of neighbours, which is the typo a fast typist makes.
 */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** Whether every letter of `needle` appears in `hay`, in order. */
function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

/**
 * How well one typed word matches one word of a name. 0 is no match.
 *
 * Exact beats prefix beats infix. Below those, two forgiving matches, each held
 * to the first letter so they do not match everything: the letters in order
 * ("rrect" for rounded rectangle, "hxgn" for hexagon), and one typo in a word
 * long enough to have one ("hexgaon").
 */
function wordScore(token: string, word: string): number {
  if (word === token) return 100;
  if (word.startsWith(token)) return 85 - Math.min(15, word.length - token.length);
  if (token.length >= 2 && word.includes(token)) return 55;
  if (token.length >= 2 && token[0] === word[0] && isSubsequence(token, word)) return 40;
  if (token.length >= 4 && token[0] === word[0]) {
    const typo = Math.min(editDistance(token, word), editDistance(token, word.slice(0, token.length)));
    if (typo <= 1) return 35;
  }
  return 0;
}

interface Haystack {
  preset: ShapePreset;
  label: string[];
  keywords: string[];
  hint: string[];
}

const HAYSTACKS: readonly Haystack[] = LIBRARY_PRESETS.map((preset) => {
  const entry = SHAPE_BY_PRESET[preset];
  return {
    preset,
    label: words(entry.label),
    keywords: (entry.keywords ?? []).flatMap(words),
    hint: words(entry.hint),
  };
});

const best = (token: string, list: readonly string[]) => list.reduce((m, w) => Math.max(m, wordScore(token, w)), 0);

/**
 * The shapes matching a query, best first, each once.
 *
 * Every typed word has to match something. A word matches the name at full
 * weight, an alias at nearly full weight ("db" is a database as surely as
 * "database" is), and the one-line description at a third, so "decision"
 * finds the diamond first and the sort symbol, which is described as a split
 * decision, after it.
 */
export function searchShapes(query: string): ShapePreset[] {
  const tokens = words(query);
  if (tokens.length === 0) return [];
  const phrase = query.trim().toLowerCase();
  const scored: Array<{ preset: ShapePreset; score: number; order: number }> = [];
  HAYSTACKS.forEach((hay, order) => {
    let total = 0;
    for (const token of tokens) {
      const s = Math.max(best(token, hay.label), best(token, hay.keywords) * 0.9, best(token, hay.hint) * 0.35);
      if (s === 0) return;
      total += s;
    }
    if (SHAPE_BY_PRESET[hay.preset].label.toLowerCase().startsWith(phrase)) total += 25;
    scored.push({ preset: hay.preset, score: total, order });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((s) => s.preset);
}

/**
 * The nearest names to a query that matched nothing, for "did you mean".
 *
 * Measured against every word of every name and alias, normalised by length so
 * a long word with two typos ranks with a short one with one. A name further
 * off than about half its letters is not a suggestion, it is noise, so a query
 * like nothing in the catalogue gets an empty list rather than four random
 * shapes presented as near misses.
 */
export function suggestShapes(query: string, limit = 4): ShapePreset[] {
  const tokens = words(query);
  if (tokens.length === 0) return [];
  return HAYSTACKS.map((hay, order) => {
    const pool = [...hay.label, ...hay.keywords];
    const distance = tokens.reduce((sum, token) => {
      const nearest = pool.reduce(
        (m, w) => Math.min(m, editDistance(token, w.slice(0, token.length + 2)) / Math.max(token.length, 1)),
        Infinity
      );
      return sum + nearest;
    }, 0);
    return { preset: hay.preset, distance: distance / tokens.length, order };
  })
    .filter((s) => s.distance <= 0.5)
    .sort((a, b) => a.distance - b.distance || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.preset);
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export type GridKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

export type GridMove =
  | { to: number }
  /** Off the top or bottom of this section, from this column. */
  | { leave: 'up' | 'down'; column: number };

/**
 * One arrow press inside a section's grid of `count` tiles drawn `cols` across.
 *
 * Left and right walk the reading order and stop at the ends rather than
 * wrapping into another section, so a held key does not fly past a family.
 * Up and down move a whole row, landing on the last tile when the row below is
 * short; from the top or bottom row they leave the section and say which
 * column they left from, so the next section can be entered in that column.
 */
export function gridMove(index: number, count: number, cols: number, key: GridKey): GridMove {
  const last = count - 1;
  const col = index % cols;
  switch (key) {
    case 'ArrowLeft':
      return { to: Math.max(0, index - 1) };
    case 'ArrowRight':
      return { to: Math.min(last, index + 1) };
    case 'Home':
      return { to: 0 };
    case 'End':
      return { to: last };
    case 'ArrowUp':
      return index - cols >= 0 ? { to: index - cols } : { leave: 'up', column: col };
    case 'ArrowDown': {
      if (index + cols <= last) return { to: index + cols };
      // A short last row: Down from above its end lands on its last tile.
      const lastRow = Math.floor(last / cols);
      if (Math.floor(index / cols) < lastRow) return { to: last };
      return { leave: 'down', column: col };
    }
  }
}

/** The tile a section is entered on, coming from `column` of the section above or below. */
export function enterAt(count: number, cols: number, column: number, from: 'above' | 'below'): number {
  if (count === 0) return -1;
  if (from === 'above') return Math.min(column, count - 1);
  const lastRowStart = Math.floor((count - 1) / cols) * cols;
  return Math.min(lastRowStart + column, count - 1);
}

// ---------------------------------------------------------------------------
// Dropping on the board
// ---------------------------------------------------------------------------

/**
 * A pointer position in the window, as a point on the board.
 *
 * The camera's offset is measured from the stage's corner, and the stage does
 * not start at the window's corner: the rulers and the panels inset it. So the
 * stage's own position is taken off first, then the camera's pan and zoom.
 */
export function clientToBoard(
  client: { x: number; y: number },
  stage: { left: number; top: number },
  camera: { x: number; y: number; zoom: number }
): { x: number; y: number } {
  return {
    x: (client.x - stage.left - camera.x) / camera.zoom,
    y: (client.y - stage.top - camera.y) / camera.zoom,
  };
}
