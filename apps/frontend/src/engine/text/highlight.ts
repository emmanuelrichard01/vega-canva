/**
 * The rounded background that breaks and clones around each wrapped line.
 *
 * ## What makes this read as the real thing
 *
 * The naive version — one rounded rectangle per line — is most of the way
 * there and looks wrong in one specific, very visible way. Where a long line
 * is followed by a short one, the two plates meet at a step, and the step has
 * two square outside corners jammed against each other. Every implementation
 * people recognise (Instagram, WhatsApp, the caption tools) curls that corner
 * **inward** instead: the ribbon bulges out over the narrower line below it,
 * so the block reads as one continuous shape that happens to be ragged rather
 * than as a stack of separate cards.
 *
 * That inward curl is the whole effect, and it is why this is a path generator
 * rather than a loop drawing rectangles.
 *
 * ## How it is built
 *
 * The ribbon is traced as one closed outline: down the right-hand edge of
 * every line from top to bottom, then back up the left-hand edge. At each
 * step between two lines the turn is either a normal outside corner (rounding
 * away from the ink) or an inside corner (rounding back toward it), decided
 * purely by whether the next line is wider or narrower. Tracing it as a single
 * outline rather than unioning rectangles is what keeps the joins exact — an
 * overlap-and-union approach leaves hairline seams wherever two plates share
 * an edge, and they show as soon as the fill is anything but fully opaque.
 *
 * Pure, so it runs without a canvas.
 */

import type { TextHighlight } from '../model/schema';
import type { TextLine } from './layout';

export interface Plate {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The padded box behind one line.
 *
 * Vertical padding is *not* added to both edges of every line's advance —
 * that would make consecutive plates overlap by `2 * paddingY` and the ribbon
 * would be taller than the text by a whole line. It grows the block at the top
 * and the bottom only, which the caller handles by insetting the run.
 */
export function platesFor(lines: readonly TextLine[], highlight: TextHighlight): Plate[] {
  const { paddingX, paddingY } = highlight;
  return lines.map((line, i) => ({
    x: line.x - paddingX,
    // Only the first line pays for the top padding, and only the last for the
    // bottom; the lines between simply abut, so the ribbon is continuous.
    y: line.y - (i === 0 ? paddingY : 0),
    width: line.width + paddingX * 2,
    height: line.height + (i === 0 ? paddingY : 0) + (i === lines.length - 1 ? paddingY : 0),
  }));
}

/** An empty line has no words, so it gets no plate — a blank line in a ribbon is a gap. */
function visiblePlates(lines: readonly TextLine[], highlight: TextHighlight): Plate[] {
  return platesFor(lines, highlight).filter((p, i) => lines[i].text.trim() !== '');
}

/**
 * Split into runs of consecutive lines.
 *
 * A blank line breaks the ribbon in two, because the words either side of it
 * are not touching and welding them would draw a band of colour across empty
 * space.
 */
function runsOf(lines: readonly TextLine[], highlight: TextHighlight): Plate[][] {
  const runs: Plate[][] = [];
  let current: Plate[] = [];
  const all = platesFor(lines, highlight);
  all.forEach((plate, i) => {
    if (lines[i].text.trim() === '') {
      if (current.length) runs.push(current);
      current = [];
    } else {
      current.push(plate);
    }
  });
  if (current.length) runs.push(current);
  return runs;
}

/** Corner radius that can never exceed what the two edges meeting there can pay for. */
function clampRadius(radius: number, ...limits: number[]): number {
  return Math.max(0, Math.min(radius, ...limits.map((l) => Math.abs(l) / 2)));
}

/**
 * One run of touching plates as a single closed SVG subpath.
 *
 * Traced clockwise: down the right edge, across the bottom, up the left edge.
 * At every step the horizontal move between two lines is rounded at both ends,
 * and the *direction* of the second rounding is what produces the inward curl.
 */
function ribbonPath(run: readonly Plate[], radius: number): string {
  if (run.length === 0) return '';
  const first = run[0];
  const last = run[run.length - 1];

  // A single line is an ordinary rounded rectangle; the general tracer below
  // would give the same answer but this is the common case and is worth not
  // walking.
  if (run.length === 1) {
    const r = clampRadius(radius, first.width, first.height);
    return roundedRect(first, r);
  }

  const d: string[] = [];
  const right = (p: Plate) => p.x + p.width;

  // --- down the right-hand side -------------------------------------------
  const r0 = clampRadius(radius, first.width, first.height);
  d.push(`M ${first.x + r0} ${first.y}`);
  d.push(`L ${right(first) - r0} ${first.y}`);
  d.push(`A ${r0} ${r0} 0 0 1 ${right(first)} ${first.y + r0}`);

  for (let i = 0; i < run.length - 1; i++) {
    const a = run[i];
    const b = run[i + 1];
    const bottom = a.y + a.height;
    const step = right(b) - right(a);
    const r = clampRadius(radius, step, a.height, b.height);

    if (Math.abs(step) < 0.01) {
      // Same width: no corner at all, the edge simply continues.
      continue;
    }
    if (step < 0) {
      // The next line is narrower. Round *out* into the gap it leaves, then
      // curl back *in* against the shorter line — this is the tuck.
      d.push(`L ${right(a)} ${bottom - r}`);
      d.push(`A ${r} ${r} 0 0 1 ${right(a) - r} ${bottom}`);
      d.push(`L ${right(b) + r} ${bottom}`);
      d.push(`A ${r} ${r} 0 0 0 ${right(b)} ${bottom + r}`);
    } else {
      // The next line is wider: the ribbon steps outward, so both corners
      // round the ordinary way round.
      d.push(`L ${right(a)} ${bottom - r}`);
      d.push(`A ${r} ${r} 0 0 0 ${right(a) + r} ${bottom}`);
      d.push(`L ${right(b) - r} ${bottom}`);
      d.push(`A ${r} ${r} 0 0 1 ${right(b)} ${bottom + r}`);
    }
  }

  // --- across the bottom ---------------------------------------------------
  const rl = clampRadius(radius, last.width, last.height);
  d.push(`L ${right(last)} ${last.y + last.height - rl}`);
  d.push(`A ${rl} ${rl} 0 0 1 ${right(last) - rl} ${last.y + last.height}`);
  d.push(`L ${last.x + rl} ${last.y + last.height}`);
  d.push(`A ${rl} ${rl} 0 0 1 ${last.x} ${last.y + last.height - rl}`);

  // --- up the left-hand side ----------------------------------------------
  for (let i = run.length - 1; i > 0; i--) {
    const b = run[i];
    const a = run[i - 1];
    const top = b.y;
    const step = b.x - a.x;
    const r = clampRadius(radius, step, a.height, b.height);

    if (Math.abs(step) < 0.01) continue;
    /**
     * The sweep flags here are the mirror of the right-hand side's, and
     * getting that wrong is what put a bulge and a clipped notch down the
     * left edge of every centre-aligned block.
     *
     * The outline is traced clockwise, so a convex corner sweeps 1 and a
     * concave one sweeps 0. Mirroring a corner reverses its orientation —
     * so the pair that reads `1` then `0` while travelling *down* the right
     * edge must read `0` then `1` travelling *up* the left. Both branches
     * below had the right-hand side's flags copied across unchanged.
     *
     * It survived because a **left-aligned** block has a straight left edge:
     * every step is zero, the `continue` above fires, and these two branches
     * never run. Only centring (or right-aligning) a block makes the left
     * edge ragged enough to reach them, which is exactly the case it was
     * reported from.
     */
    if (step > 0) {
      // Travelling up, the line above starts further left: the ribbon widens.
      d.push(`L ${b.x} ${top + r}`);
      d.push(`A ${r} ${r} 0 0 0 ${b.x - r} ${top}`);
      d.push(`L ${a.x + r} ${top}`);
      d.push(`A ${r} ${r} 0 0 1 ${a.x} ${top - r}`);
    } else {
      // The line above starts further right: the ribbon narrows going up.
      d.push(`L ${b.x} ${top + r}`);
      d.push(`A ${r} ${r} 0 0 1 ${b.x + r} ${top}`);
      d.push(`L ${a.x - r} ${top}`);
      d.push(`A ${r} ${r} 0 0 0 ${a.x} ${top - r}`);
    }
  }

  d.push(`L ${first.x} ${first.y + r0}`);
  d.push(`A ${r0} ${r0} 0 0 1 ${first.x + r0} ${first.y}`);
  d.push('Z');
  return d.join(' ');
}

function roundedRect(p: Plate, r: number): string {
  return [
    `M ${p.x + r} ${p.y}`,
    `L ${p.x + p.width - r} ${p.y}`,
    `A ${r} ${r} 0 0 1 ${p.x + p.width} ${p.y + r}`,
    `L ${p.x + p.width} ${p.y + p.height - r}`,
    `A ${r} ${r} 0 0 1 ${p.x + p.width - r} ${p.y + p.height}`,
    `L ${p.x + r} ${p.y + p.height}`,
    `A ${r} ${r} 0 0 1 ${p.x} ${p.y + p.height - r}`,
    `L ${p.x} ${p.y + r}`,
    `A ${r} ${r} 0 0 1 ${p.x + r} ${p.y}`,
    'Z',
  ].join(' ');
}

/**
 * The highlight behind a laid-out block, as one SVG `d` string.
 *
 * `plates` gives each line its own separate rounded rectangle; `ribbon` welds
 * consecutive lines with the tucked corner described at the top of this file.
 * Both return a single string, so the renderer draws one path either way.
 */
export function highlightPath(
  lines: readonly TextLine[],
  highlight: TextHighlight
): string {
  if (lines.length === 0) return '';
  if (highlight.join === 'plates') {
    return visiblePlates(lines, highlight)
      .map((p) => roundedRect(p, clampRadius(highlight.radius, p.width, p.height)))
      .join(' ');
  }
  return runsOf(lines, highlight)
    .map((run) => ribbonPath(run, highlight.radius))
    .filter(Boolean)
    .join(' ');
}
