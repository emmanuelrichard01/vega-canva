/**
 * Finding a layer in a document that has stopped fitting on screen.
 *
 * The panel already filters by tag, which is a property of sticky notes and of
 * nothing else. This is the general case: type a few characters, or ask for
 * one kind of object, and see only those.
 *
 * Pure, and separate from the panel, for the usual reason — the matching rules
 * below are the part that is easy to get subtly wrong and impossible to check
 * by looking at a list of rectangles.
 *
 * ## Matching is subsequence, not substring
 *
 * `sbm` finds "Submit Button". That is what every command palette and file
 * finder does, and it is the behaviour people arrive expecting; a substring
 * match makes you remember the exact wording you are searching for, which is
 * the thing you are searching *because* you have forgotten.
 *
 * The score exists so the ranking is not arbitrary. A run of consecutive
 * characters beats a scattered one, and a match at the start of a word beats a
 * match in the middle — so `but` puts "Button" above "Distribute".
 */

import type { AnyNode, NodeType } from './schema';
import { nodeLabel } from './nodeLabel';

/** What a row can be filtered down to. `all` is the absent case. */
export type LayerTypeFilter = NodeType | 'all';

export interface LayerMatch {
  /** Higher is better. Only meaningful relative to other matches of the same query. */
  score: number;
  /**
   * Indices into the label that were matched, so the panel can mark them.
   * Highlighting the matched characters is what makes a subsequence match
   * legible — without it, a hit on a name that does not visibly contain the
   * query reads as a bug.
   */
  positions: number[];
}

/**
 * A consecutive character is worth this much more than an isolated one, and
 * the bonus **compounds along the run**: the second character of a run is
 * worth twice this, the third three times.
 *
 * Flat, it does not work. Two word-start bonuses beat two flat consecutive
 * ones, so `but` ranked "Blue Utility" above "Button" — arithmetically
 * consistent and obviously wrong to anybody typing it. Compounding says what
 * is actually true: an unbroken run is not n independent pieces of evidence,
 * it is one strong one, and it gets stronger the longer it goes.
 */
const CONSECUTIVE_BONUS = 8;
/** A character at the start of a word is worth this much more. */
const WORD_START_BONUS = 10;
/** Every matched character is worth this much before bonuses. */
const BASE = 1;
/** Each character skipped before the first match costs this, so early matches rank higher. */
const LEADING_PENALTY = 0.5;

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1];
  if (prev === ' ' || prev === '-' || prev === '_' || prev === '/') return true;
  // A capital following a lower-case letter starts a word in `submitButton`.
  return prev === prev.toLowerCase() && text[index] !== text[index].toLowerCase();
}

/**
 * How far into a name the leading penalty keeps counting.
 *
 * Without a cap, a match on the first letter of a word twenty characters in
 * scores below a match on a stray letter at index 2 — the penalty overwhelms
 * the word-start bonus, and the ranking inverts on exactly the long names that
 * most need searching.
 */
const MAX_LEADING_PENALTY = 10;

/** One left-to-right pass. `preferWordStart` picks the boundary occurrence over the nearest one. */
function pass(q: string, t: string, text: string, preferWordStart: boolean): LayerMatch | null {
  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  /** How many characters the current unbroken run is already into. */
  let run = 0;

  for (let qi = 0; qi < q.length; qi++) {
    // Whitespace in the query is a separator, not something to find.
    if (q[qi] === ' ') continue;
    let first = -1;
    let boundary = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] !== q[qi]) continue;
      if (first === -1) first = i;
      if (isWordStart(text, i)) {
        boundary = i;
        break;
      }
    }
    const found = preferWordStart && boundary !== -1 ? boundary : first;
    if (found === -1) return null;

    score += BASE;
    if (isWordStart(text, found)) score += WORD_START_BONUS;
    if (positions.length > 0 && found === positions[positions.length - 1] + 1) {
      run += 1;
      score += CONSECUTIVE_BONUS * run;
    } else {
      run = 0;
    }
    positions.push(found);
    ti = found + 1;
  }

  if (positions.length === 0) return { score: 0, positions: [] };
  return { score: score - Math.min(positions[0], MAX_LEADING_PENALTY) * LEADING_PENALTY, positions };
}

/**
 * Score `query` against `text`, or null if the characters are not all present
 * in order.
 *
 * **Two greedy passes, best score wins.** One pass takes the nearest
 * occurrence of each character; the other prefers an occurrence at the start
 * of a word. Neither is right on its own, and the two failures are opposite:
 *
 * - Nearest-first matches `SB` against "Su**b**mit Button" — the *first* `b`
 *   is inside the first word, so the intended "**S**ubmit **B**utton" is
 *   never considered.
 * - Word-start-first matches `sub` against "**s**ub..." as `s`, `u`, then
 *   jumps to the `B` of "Button", throwing away a perfect consecutive run.
 *
 * Running both and keeping the higher score gets both cases right for the cost
 * of one extra linear scan. The alternative is the full dynamic-programming
 * alignment that fzf uses, which is a table over both strings — real work, and
 * a difference nobody can see on names this short.
 */
export function scoreLabel(query: string, text: string): LayerMatch | null {
  if (!query) return { score: 0, positions: [] };

  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const nearest = pass(q, t, text, false);
  // Feasibility is decided by the nearest-first pass: if the characters are
  // not all present in order there, no other choice of occurrences can help,
  // because taking a *later* occurrence only ever shortens what remains.
  if (!nearest) return null;
  const boundaries = pass(q, t, text, true);
  return boundaries && boundaries.score > nearest.score ? boundaries : nearest;
}

/**
 * Does this node pass the current filter, and how well.
 *
 * Returns null for "hide this row". The type filter is applied first and is
 * absolute — asking for text layers and getting a rectangle because its name
 * happened to match is not a filter.
 */
export function matchNode(
  node: AnyNode,
  query: string,
  type: LayerTypeFilter
): LayerMatch | null {
  if (type !== 'all' && node.type !== type) return null;
  return scoreLabel(query.trim(), nodeLabel(node));
}

/** Whether anything is actually being filtered, so the panel can skip the work and drop the "clear" affordance. */
export function isFiltering(query: string, type: LayerTypeFilter): boolean {
  return query.trim().length > 0 || type !== 'all';
}

/**
 * Split a label into matched and unmatched runs, in order.
 *
 * Runs rather than per-character spans: a name of thirty characters would
 * otherwise become thirty DOM nodes in a list that is virtualized precisely
 * because DOM nodes per row were the cost.
 */
export function highlightRuns(label: string, positions: readonly number[]): { text: string; hit: boolean }[] {
  if (positions.length === 0) return [{ text: label, hit: false }];
  const runs: { text: string; hit: boolean }[] = [];
  const hits = new Set(positions);
  let start = 0;
  let current = hits.has(0);
  for (let i = 1; i <= label.length; i++) {
    const hit = i < label.length && hits.has(i);
    if (hit !== current || i === label.length) {
      runs.push({ text: label.slice(start, i), hit: current });
      start = i;
      current = hit;
    }
  }
  return runs;
}
