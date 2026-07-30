/**
 * The arithmetic behind a remote cursor: how its colour is made readable, how
 * its label stays on screen, and how its motion is smoothed.
 *
 * All of it is pure, because none of it can be observed running — the physics
 * rebuild established the same rule for the same reason (see `HANDOFF.md` §3).
 * Colour contrast and edge flipping are exactly the sort of thing that looks
 * fine in the one screenshot you take and fails for the one teammate whose
 * name is long or whose colour is yellow.
 */

/** Where a collaborator's pointer is, in screen pixels. */
export interface Point {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

const clamp255 = (n: number) => Math.min(255, Math.max(0, Math.round(n)));

export function parseHex(hex: string): [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const toHex = ([r, g, b]: [number, number, number]) =>
  '#' + [r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('').toUpperCase();

/** sRGB channel → linear light. The WCAG transfer function. */
const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1:1 to 21:1. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The two luminances at which a name chip becomes readable.
 *
 * At or below `DEEP`, white text clears WCAG AA (4.5:1). At or above `BRIGHT`,
 * the hue-tinted dark ink below does. Between them is a band where *neither*
 * works — and almost every saturated mid-tone lands in it, which is why this
 * cannot be solved by picking a better text colour alone.
 *
 * The failure is real and current: the chip used the raw user colour with
 * white text, and half the palette came out under 3:1 — Amber `#F59E0B` at
 * about 2:1. A lookup table would not have fixed it either, because sign-in
 * lets people choose an arbitrary colour.
 */
const DEEP_LUMINANCE = 0.175;
const BRIGHT_LUMINANCE = 0.42;

/** Ink for a bright chip. See `chipColorsFor`. */
function tintedInkFor(fill: [number, number, number]): string {
  // The chip's own hue taken almost to black. Not `#111827`, and above all not
  // gray — gray text on a coloured surface is the fastest way to make a label
  // like this look cheap, and a neutral dark on a saturated fill reads dirty.
  // Keeping a trace of the hue makes the chip look like one material.
  return toHex(fill.map((c) => c * 0.1) as [number, number, number]);
}

/**
 * Binary search a mix of `rgb` toward `target` for the first blend whose
 * luminance satisfies `ok`. Luminance is monotonic in the blend amount, so
 * twenty steps land well inside a single 8-bit channel.
 */
function blendUntil(
  rgb: [number, number, number],
  target: number,
  ok: (luminance: number) => boolean
): [number, number, number] {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const mixed = rgb.map((c) => c + (target - c) * mid) as [number, number, number];
    if (ok(relativeLuminance(toHex(mixed)))) hi = mid;
    else lo = mid;
  }
  return rgb.map((c) => c + (target - c) * hi) as [number, number, number];
}

/** Fill, ink, and outline for one collaborator's name chip. */
export interface ChipColors {
  fill: string;
  ink: string;
  /** The raw user colour, so the chip is edged in the identity it stands for. */
  outline: string;
}

/**
 * Make a collaborator's colour carry their name legibly, moving it as little
 * as possible.
 *
 * A colour that is already deep keeps white text; one that is already bright
 * keeps dark text; both come back untouched. Only the unreadable middle moves,
 * and it moves whichever way is *nearer* — so deep blues and purples stay
 * saturated with white text while ambers, teals and greens stay bright with
 * dark text, each still recognisably the colour its owner picked.
 *
 * Whatever happens to the chip, the pointer arrow is drawn in the raw colour
 * and the chip is outlined in it, so the true identity colour is always
 * present next to the name.
 */
export function chipColorsFor(userColor: string): ChipColors {
  const rgb = parseHex(userColor);
  if (!rgb) return { fill: '#E5E7EB', ink: '#111827', outline: '#9CA3AF' };

  const outline = toHex(rgb);
  const luminance = relativeLuminance(outline);

  if (luminance <= DEEP_LUMINANCE) return { fill: outline, ink: '#FFFFFF', outline };
  if (luminance >= BRIGHT_LUMINANCE) return { fill: outline, ink: tintedInkFor(rgb), outline };

  if (luminance - DEEP_LUMINANCE <= BRIGHT_LUMINANCE - luminance) {
    const deepened = blendUntil(rgb, 0, (l) => l <= DEEP_LUMINANCE);
    return { fill: toHex(deepened), ink: '#FFFFFF', outline };
  }

  const brightened = blendUntil(rgb, 255, (l) => l >= BRIGHT_LUMINANCE);
  return { fill: toHex(brightened), ink: tintedInkFor(brightened), outline };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** How far the chip sits from the pointer's hotspot, in pixels. */
export const CHIP_OFFSET = { x: 13, y: 17 };

/** Keep-out band at the viewport edge, so a flipped chip is not flush. */
const EDGE_MARGIN = 8;

export interface ChipPlacement {
  left: number;
  top: number;
  /** Which side of the pointer the chip ended up on. */
  flippedX: boolean;
  flippedY: boolean;
}

/**
 * Place a name chip beside a pointer, flipping it across the pointer when it
 * would otherwise run off screen.
 *
 * The overlay clips its contents, so before this a collaborator near the right
 * edge simply lost their name — which is when you most want to know who is
 * about to edit the thing you are looking at.
 */
export function placeChip(
  cursor: Point,
  chip: { width: number; height: number },
  viewport: { width: number; height: number }
): ChipPlacement {
  const flippedX = cursor.x + CHIP_OFFSET.x + chip.width > viewport.width - EDGE_MARGIN;
  const flippedY = cursor.y + CHIP_OFFSET.y + chip.height > viewport.height - EDGE_MARGIN;

  const left = flippedX ? cursor.x - CHIP_OFFSET.x - chip.width : cursor.x + CHIP_OFFSET.x;
  const top = flippedY ? cursor.y - CHIP_OFFSET.y - chip.height : cursor.y + CHIP_OFFSET.y;

  return {
    // Flipping can only rescue one edge; clamp so a chip wider than the
    // viewport still starts on screen rather than off the left.
    left: Math.max(EDGE_MARGIN, Math.min(left, viewport.width - chip.width - EDGE_MARGIN)),
    top: Math.max(EDGE_MARGIN, Math.min(top, viewport.height - chip.height - EDGE_MARGIN)),
    flippedX,
    flippedY,
  };
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/**
 * Time for a remote cursor to close half the distance to its broadcast
 * position. Tuned to reproduce the feel of the old fixed `0.25` per frame at
 * 60Hz, which is the pacing the smoothing was originally judged against.
 */
export const SMOOTHING_HALF_LIFE_MS = 55;

/** A frame long enough that the tab was almost certainly asleep; snap instead. */
const MAX_FRAME_MS = 250;

/**
 * The interpolation factor for a frame of length `dtMs`.
 *
 * The old code lerped by a fixed fraction *per frame*, so a 144Hz display
 * converged nearly two and a half times faster than a 60Hz one: the same
 * network jitter produced visibly different motion on different machines, and
 * a dropped frame produced a lurch. Deriving the factor from elapsed time
 * makes the result depend only on how long the frame actually took.
 */
export function smoothingFactor(dtMs: number, halfLifeMs = SMOOTHING_HALF_LIFE_MS): number {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;
  if (dtMs >= MAX_FRAME_MS) return 1;
  return 1 - Math.pow(2, -dtMs / halfLifeMs);
}
