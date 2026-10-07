import type { CursorMode } from './toolCursor';
import { contrastRatio } from './remoteCursor';

/**
 * What the pointer looks like, as a value.
 *
 * ## Why this is data and not a component
 *
 * The art used to be `render: () => React.ReactNode`, called during
 * `LocalCursor`'s render. Every press, every release, every Alt tap and every
 * entry into the canvas was a React state change, so the whole SVG tree was
 * rebuilt and reconciled in the middle of a click. A pointer is the one
 * element on the screen that may never do that: it is the thing the eye is
 * locked to, and a hitch in it reads as the application stalling.
 *
 * As data, the art is resolved once per *tool*, turned into a string of markup
 * once, and after that a press is one class toggle and a move is one
 * transform. Nothing re-renders.
 *
 * ## Why the palette is fixed at the core and adaptive at the edge
 *
 * A cursor sits over **content**, not over the background. A `--surface-primary`
 * fill is invisible against a dark shape in a light theme and against the board
 * in a dark one, so the arrow's own body has to be a guaranteed pair — white
 * body, near-black outline — which reads over a photograph, a black rectangle
 * and an empty board alike. That much the previous implementation had right and
 * it is kept.
 *
 * What it got wrong was concluding from that that the cursor cannot be theme
 * aware at all. The *badge* is not load-bearing for legibility — it sits inside
 * a disc the arrow already carries — so it can follow the theme, and it should,
 * because a badge in the product's accent is what makes the pointer look like
 * part of this application rather than a stock asset. `inkFor` below picks the
 * glyph ink by measured contrast against whatever disc colour it is given,
 * rather than assuming a dark disc, which is what let the accent in at all.
 */

/**
 * The two colours a pointer is ever made of.
 *
 * A pointer is a **pair**, never a single colour, and that is what makes it
 * legible over arbitrary content: whichever of the two the body takes, the
 * other outlines it, so there is a hard edge against a photograph, a black
 * rectangle and an empty board alike. The previous implementation had this
 * right and drew the conclusion that a cursor therefore cannot be theme aware
 * at all.
 *
 * It does not follow. The pair guarantees legibility; the *theme* decides which
 * of the two reads as the cursor first, because the theme is the best available
 * prediction of what is behind it. A white-bodied arrow on a dark board is the
 * brightest thing on the screen and glares; a dark-bodied one with a light
 * outline is the same shape, equally legible, and stops shouting. This is what
 * every native pointer on both platforms does, and it is the difference between
 * a cursor that belongs to the application and one pasted on top of it.
 */
export const PAPER = '#FFFFFF';
export const INK = '#141821';

/** Which colour is the body and which the outline, for a theme. */
export interface CursorPalette {
  body: string;
  edge: string;
}

/**
 * Which of the pair is the body, for a theme.
 *
 * **Light theme takes the dark body**, which is Figma's arrow and every native
 * pointer on both platforms: a near-black shape with a white outline. The
 * outline is what carries it over dark content, so legibility does not depend
 * on which way round they are — but weight does, and a white-bodied arrow is
 * the brightest thing on the screen whatever is behind it.
 *
 * This was the other way round, and the tell was that the rotate arc — which
 * draws its *stroke* in `edge` — looked right while the arrow beside it did
 * not. Two marks in one set reading at different weights is the sign that the
 * roles are the wrong way round rather than that one of them is wrong.
 */
export function paletteFor(dark: boolean): CursorPalette {
  return dark ? { body: PAPER, edge: INK } : { body: INK, edge: PAPER };
}

/**
 * The theme every pointer is drawn in, unless a caller names one.
 *
 * `LocalCursor` keeps this current. Handles elsewhere (resize, rotate, the pen
 * signs) claim cursors without knowing the theme, and used to get the light
 * palette in dark mode; reading it here fixes all of them at once.
 *
 * `weight` is the enhanced-contrast stroke scale: outlines and halos thicken
 * by it, so a pointer stays separable from busy content.
 */
export const cursorTheme: { dark: boolean; weight: number } = { dark: false, weight: 1 };

export function setCursorTheme(next: Partial<{ dark: boolean; weight: number }>): void {
  if (next.dark !== undefined) cursorTheme.dark = next.dark;
  if (next.weight !== undefined && next.weight > 0) cursorTheme.weight = next.weight;
}

/** An id that also names the stroke weight, so a contrast change redraws. */
const tagged = (id: string) => (cursorTheme.weight === 1 ? id : `${id}:w${cursorTheme.weight}`);

/** Thicken every stroke by the contrast weight. Geometry is unchanged. */
function weighted(svg: string): string {
  const w = cursorTheme.weight;
  if (w === 1) return svg;
  // A badge glyph keeps its drawing weight: thickening the inside of a 9px
  // disc closes it up. Its disc outline and every edge and halo still thicken.
  return svg.replace(/(?<!data-fixed="1" )stroke-width="([0-9.]+)"/g, (_, n) => `stroke-width="${esc(Number(n) * w)}"`);
}

/**
 * The glyph ink for a disc of this colour, by measured contrast.
 *
 * A lookup table would have been enough while the disc was always `#141821`.
 * It is not enough once the disc can be the accent — and the accent is a
 * runtime value a user can influence, so there is no set of colours to
 * enumerate. This is the same reasoning `chipColorsFor` records for the remote
 * name chips, and it is the same function doing the measuring.
 */
export function inkFor(disc: string): string {
  return contrastRatio(disc, PAPER) >= contrastRatio(disc, INK) ? PAPER : INK;
}

/** Where the art's active point sits, in the art's own coordinates. */
export interface Hotspot {
  x: number;
  y: number;
}

export interface CursorVisual {
  /** Identifies the art, so the DOM is only rewritten when it really changes. */
  id: string;
  /** SVG markup for the whole pointer, hotspot at the origin of the viewBox. */
  svg: string;
  /** The offset from the pointer position to the art's top-left, in px. */
  offsetX: number;
  offsetY: number;
  /** Box size in CSS px when it is not `CURSOR_SIZE` (the eraser ring). */
  size?: number;
}

export const CURSOR_SIZE = 28;
const SIZE = CURSOR_SIZE;

/**
 * The arrow, unchanged in shape across every tool that wears one.
 *
 * Deliberate: the hotspot is its tip, and a pointer whose *shape* changed with
 * the tool would appear to move the hotspot every time you pressed a key. What
 * changes is the badge in its tail, which is empty space on the arrow and
 * costs no precision.
 */
export const ARROW_D =
  'M5.65376 21.2183L2.36881 2.50576C2.17937 1.42629 3.32766 0.584311 4.30138 1.08742L21.2335 9.83549C22.2599 10.366 22.1802 11.8315 21.1011 12.2612L13.8821 15.1363C13.5604 15.2644 13.3082 15.5146 13.1782 15.8361L10.2828 23.0132C9.84996 24.0864 8.38466 24.1565 7.86311 23.1239L5.65376 21.2183Z';

export const ARROW_SCALE = 0.82;

/**
 * The arrow's tip inside its box — the hotspot, shared by both pointers.
 *
 * Remote pointers need it to place a collaborator's arrow so the *tip* lands
 * on their reported position rather than the box's corner, which is a four
 * pixel lie about where somebody is pointing.
 */
export const ARROW_TIP = { x: 2, y: 1 };

/**
 * The badge glyphs, by tool.
 *
 * ## The dead half of the old implementation
 *
 * `GLYPH_BY_TOOL` existed, held twelve tool-specific glyphs, and **the local
 * cursor never showed one of them.** The badge was built by a helper that
 * called `glyphForTool(undefined, mode)` — hard-coding `undefined` for the
 * tool — so it always fell through to the mode glyph. A rectangle, an ellipse,
 * a star and a hexagon all wore the same generic pencil, while a *collaborator*
 * watching you use them saw the right shape, because `RemoteCursors` passed the
 * tool through.
 *
 * The README states the rule those two surfaces were meant to share: "your own
 * pointer already wears a small glyph for the tool in your hand; a
 * collaborator's pointer wears the same glyph in their colour. Nothing has to
 * be learned twice." It was true of one of them. This is the ninth dead field
 * in this codebase's ledger and it is the first that was dead on the surface
 * the user looks at most.
 *
 * ## The drawing rule, which is a constraint and not a preference
 *
 * These are drawn into a 9px disc at a heavy stroke weight, so each must be
 * **two or three strokes with no small features**. A lucide-weight pencil
 * became a diagonal slash in a circle, which reads as a prohibition sign; an
 * outlined hand became a blob. Both were caught by rendering the set at 4× and
 * looking at it. Anything added here gets the same check.
 */
const GLYPHS: Record<string, string> = {
  /* --- by tool, where the tool is more specific than its mode ------------ */
  shape: '<path d="M4 5h16v14H4z"/>',
  'shape-rect': '<path d="M4 5h16v14H4z"/>',
  'shape-ellipse': '<ellipse cx="12" cy="12" rx="8.5" ry="7"/>',
  'shape-triangle': '<path d="M12 4 21 20H3z"/>',
  'shape-hexagon': '<path d="M12 3.5l7.4 4.3v8.4L12 20.5l-7.4-4.3V7.8z"/>',
  'shape-star': '<path d="M12 3.5l2.7 6 6.3.5-4.8 4.2 1.5 6.1L12 17l-5.7 3.3 1.5-6.1L3 9.9l6.3-.5z"/>',
  'shape-line': '<path d="M4 20 20 4"/>',
  'shape-arrow': '<path d="M4 20 20 4M20 4h-7M20 4v7"/>',
  connector: '<path d="M4 6h9a5 5 0 0 1 0 10H8m0 0 3.5-3.5M8 16l3.5 3.5"/>',
  grid: '<path d="M4 4h16v16H4zM4 12h16M12 4v16"/>',
  /**
   * Three bars, and nothing else.
   *
   * The chart tool fell through to `draw` -- the pencil stroke -- which says
   * the next gesture will draw freehand, and it will not. Three uprights of
   * different heights is the most reduced thing that still reads as a chart at
   * 9px, and it is three strokes with no small features, which is the rule this
   * set is held to. An axis was tried and lost: the L of the axis plus three
   * bars is five strokes and closes up into a solid block.
   */
  chart: '<path d="M6 20V13M12 20V5M18 20V9"/>',
  /**
   * A box, its header rule and one column rule — three strokes.
   *
   * Grid's glyph is a box quartered through the middle; a table is told apart
   * by the rule sitting high (the header) and the column rule sitting left
   * (the label column), which is also how a table is recognised at any size.
   */
  table: '<path d="M4 5h16v14H4zM4 10h16M10 10v9"/>',
  frame:'<path d="M4 8h16M4 16h16M8 4v16M16 4v16"/>',
  image: '<path d="M3.5 5h17v14h-17zM3.5 16l5-5 4 4 3-3 5 5"/>',
  audio: '<path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11a6.5 6.5 0 0 0 13 0"/>',
  'direct-select': '<path d="M5 18C6 10 11 8 19 5"/><circle cx="5" cy="18" r="2.6"/><circle cx="19" cy="5" r="2.6"/>',
  'bezier-pen': '<path d="M4 19c0-8 7-13 15-14"/><rect x="2" y="17" width="4.5" height="4.5"/><rect x="17.5" y="3" width="4.5" height="4.5"/>',
  pen: '<path d="M4 19c2-8 8-12 15-13.5"/>',
  eraser: '<path d="M7.5 19.5 4 16a1.8 1.8 0 0 1 0-2.6l8.4-8.4a1.8 1.8 0 0 1 2.6 0l4 4a1.8 1.8 0 0 1 0 2.6l-7 7z"/><path d="M19.5 19.5H8"/>',

  /**
   * Not a tool — the modifier state of one.
   *
   * Alt on a select drag duplicates rather than moves, and that is a different
   * outcome for the same gesture, so it has to be said on the pointer. It is a
   * glyph rather than a colour because the pointer already spends its one
   * colour on the aim point.
   */
  'alt-duplicate': '<path d="M12 5v14M5 12h14"/>',

  /* --- by mode, for tools with nothing more specific to say -------------- */
  draw: '<path d="M4 19c2-8 8-12 15-13.5"/>',
  text: '<path d="M4.5 7.5V4.5h15v3M12 4.5v15M9 19.5h6"/>',
  note: '<path d="M4.5 4.5h15v10l-5 5h-10z"/><path d="M19.5 14.5h-5v5"/>',
  comment: '<path d="M20.5 14a2 2 0 0 1-2 2H9l-4.5 4V5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
  place: '<path d="M4 5h16v14H4z"/><path d="M12 9v6M9 12h6"/>',
  aim: '<circle cx="12" cy="12" r="5"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/>',
};

/** The glyph a tool wears: its own, or its mode's, or none. */
export function glyphFor(tool: string | undefined, mode: CursorMode): string | undefined {
  return (tool && GLYPHS[tool]) || GLYPHS[mode];
}

const esc = (n: number) => String(Math.round(n * 100) / 100);

/**
 * The badge disc in the arrow's tail.
 *
 * Set back and small on purpose. The first attempt made it two thirds the
 * arrow's size, which read as two icons colliding rather than as one pointer
 * that knows what it is holding.
 *
 * **The disc takes the edge colour, not the accent**, and that is a design
 * decision rather than a limitation. `DESIGN.md` opens by describing this
 * product as "a quiet neutral instrument, one warm brand voice" — a brand-
 * coloured disc riding every pointer at all times spends that voice on the one
 * element that is on screen continuously and says nothing while it does. The
 * accent is kept for the pointer's *state* signals, where colour means
 * something: the aim point, and the Alt-duplicate badge.
 *
 * The glyph ink is still chosen by measured contrast rather than assumed,
 * because the disc colour now depends on the theme and a hard-coded pair would
 * be right in one of them.
 */
function badge(glyph: string, p: CursorPalette): string {
  return (
    `<g transform="translate(19.6 19.6)">` +
    `<circle r="7.6" fill="${p.edge}" stroke="${p.body}" stroke-width="1.7"/>` +
    `<g transform="translate(-4.55 -4.55) scale(0.379)" fill="none" stroke="${inkFor(p.edge)}" ` +
    `data-fixed="1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>` +
    `</g>`
  );
}

function svgWrap(inner: string, size = SIZE): string {
  return weighted(
    /**
     * `xmlns` is not optional here, and leaving it out is silent.
     *
     * Inline SVG in an HTML document inherits the SVG namespace from the
     * parser, so this markup renders correctly anywhere it is embedded — which
     * is how it looked right in every test and every preview. A
     * `data:image/svg+xml` cursor is not embedded: it is decoded as a
     * **standalone XML document**, where a missing namespace is a parse
     * failure and the image simply does not exist.
     *
     * The browser then drops the whole `cursor` declaration and falls back to
     * the keyword after the comma — so every drawn pointer in the product was
     * quietly showing its fallback. It surfaced as "I see an open hand when I
     * want to rotate", because `grab` is what the rotate cursor falls back to,
     * and `grab` *is* an open hand.
     *
     * Nothing errors, nothing warns, and the fallbacks were chosen to be
     * sensible — which is exactly what made it invisible.
     */
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}" fill="none" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ` +
    `style="display:block;overflow:visible">${inner}</svg>`
  );
}

const arrow = (p: CursorPalette) =>
  `<g transform="scale(${ARROW_SCALE})"><path d="${ARROW_D}" fill="${p.body}" stroke="${p.edge}" ` +
  `stroke-width="1.7" stroke-linejoin="round"/></g>`;

/**
 * The crosshair, for the modes whose job is to hit a *point* rather than to
 * indicate a direction.
 *
 * The gap in the middle is the whole reason a crosshair beats an arrow here:
 * an arrow occludes the thing you are aiming at with its own body, and the
 * point you are placing is under the tip where you cannot see it.
 */
function cross(gap: number, arm: number, p: CursorPalette, accent?: string): string {
  const c = SIZE / 2;
  const d =
    `M${c} ${esc(c - gap - arm)}v${esc(arm)}M${c} ${esc(c + gap)}v${esc(arm)}` +
    `M${esc(c - gap - arm)} ${c}h${esc(arm)}M${esc(c + gap)} ${c}h${esc(arm)}`;
  return (
    `<path d="${d}" stroke="${p.body}" stroke-width="3.6"/>` +
    `<path d="${d}" stroke="${p.edge}" stroke-width="1.5"/>` +
    // The one dot of accent on the whole pointer, and it marks the exact point
    // the next press lands on — colour where colour means something.
    `<circle cx="${c}" cy="${c}" r="1.6" fill="${accent ?? p.edge}" stroke="${p.body}" stroke-width="1.1"/>`
  );
}

/**
 * The open hand: four fingers and a thumb, on a 24-unit grid.
 *
 * ## One drawing, two uses
 *
 * The dock's Hand seat strokes this path (see `HandIcon`) and the pointer fills
 * and outlines it, so the seat and the cursor it gives you are one hand.
 *
 * ## How it is built
 *
 * Drawn the way macOS and Figma draw it: a broad palm with a wrist cut, and
 * four fingers that fan slightly from a knuckle line, each tapering to a round
 * tip, with the middle finger tallest and the little finger shortest and most
 * splayed. The fingers touch at the knuckles and part towards the tips, so the
 * valleys between them read as separation without needing gaps the outline
 * would fill. The thumb leaves the lower palm at about 40° with a full round
 * tip, rather than hanging off the side as a bulb.
 */
export const HAND_OPEN =
  'M8.1 22.7C6.9 21.3 6.0 19.9 5.25 18.65L2.55 14.6A1.62 1.62 0 0 1 5.2 12.75L6.73 14.55L6.74 12.58L6.16 5.92A1.6 1.6 0 0 1 9.34 5.58L10.11 10.72Q10.17 11.82 10.22 10.72L10.14 4.38A1.66 1.66 0 0 1 13.46 4.32L13.68 10.62Q13.76 11.72 13.83 10.62L14.25 5.02A1.6 1.6 0 0 1 17.45 5.18L17.17 11.58Q17.23 12.68 17.3 11.58L18.11 7.54A1.45 1.45 0 0 1 20.99 7.96L20.25 13.52C20.35 16.2 19.9 19.0 18.75 20.75C18.2 21.55 17.7 22.2 17.3 22.7Z';

/**
 * The closed hand, for a pan in progress.
 *
 * Not a shrunken open hand: the fingers fold over the palm and show as four
 * knuckle bumps, and the thumb tucks in along the palm's edge. The wrist, the
 * palm's outer edge and the overall width are the open hand's, so pressing
 * reads as the hand *closing* in place rather than being swapped.
 */
export const HAND_CLOSED =
  'M8.1 22.7C6.9 21.3 6.0 19.9 5.4 18.35C4.7 16.6 4.95 14.6 6.0 13.45L6.63 11.15L6.63 10.55A1.72 1.72 0 0 1 10.07 10.55Q10.07 11.1 10.07 9.75A1.78 1.78 0 0 1 13.63 9.75Q13.68 10.6 13.73 10.05A1.72 1.72 0 0 1 17.17 10.05Q17.18 11.9 17.2 11.35A1.55 1.55 0 0 1 20.3 11.35C20.35 13.6 20.25 16.6 19.6 18.4C19.0 20.0 18.1 21.6 17.3 22.7Z';

/**
 * The fist's inner lines: a short fold below each valley between curled
 * fingers, and the tucked thumb lying across under the first two knuckles.
 * Stroked lighter than the outline, so they read as detail, not as edges.
 */
export const HAND_CLOSED_FOLDS =
  'M10.07 11.1v1.5M13.68 10.6v1.5M17.19 11.9v1.5M6.0 13.45C7.5 14.2 9.4 14.35 11.25 13.85';

/**
 * Seats the 24-unit hand in the pointer's box.
 *
 * The palm's centre, (12, 14) on the hand's grid, lands on the box's centre,
 * which is the hotspot for both hands, so switching between them never moves
 * the point being dragged.
 */
const HAND_FIT = 'translate(0.8 -1.4) scale(1.1)';

/**
 * A hand as a pointer: a white hand with a dark outline, in both themes.
 *
 * Every native hand cursor is drawn this way, and a dark-bodied hand reads as a
 * silhouette rather than a hand. A white halo under the outline separates it
 * from dark and busy content; on a light board the halo disappears and the
 * outline carries it.
 */
function hand(d: string, folds = ''): string {
  return (
    `<g transform="${HAND_FIT}" stroke-linejoin="round" stroke-linecap="round">` +
    `<path d="${d}" fill="${PAPER}" stroke="${PAPER}" stroke-width="3.6" stroke-opacity="0.9"/>` +
    `<path d="${d}" fill="${PAPER}" stroke="${INK}" stroke-width="1.3"/>` +
    (folds ? `<path d="${folds}" fill="none" stroke="${INK}" stroke-width="1.05" opacity="0.85"/>` : '') +
    `</g>`
  );
}

/** The hotspot for arrow-shaped art: its tip. */
const TIP: Hotspot = { x: 2, y: 1 };
/** The hotspot for centred art: the middle of the box. */
const CENTRE: Hotspot = { x: SIZE / 2, y: SIZE / 2 };

/* ------------------------------------------------------- the tool set */

/**
 * Tools that drag out a region: a crosshair, badged with what the region
 * becomes.
 *
 * An arrow says the next drag selects. These drags draw a box, and the corner
 * of that box lands on the pixel under the hotspot, so the hotspot has to be
 * a point the eye can see past. The badge still names the tool, so a
 * rectangle and a table stay distinguishable at a glance.
 */
export const REGION_TOOLS: ReadonlySet<string> = new Set([
  'shape', 'shape-rect', 'shape-ellipse', 'shape-triangle', 'shape-hexagon', 'shape-star',
  'shape-line', 'shape-arrow', 'frame', 'grid', 'chart', 'table', 'code', 'connector',
]);

/** Where the region crosshair centres, up and left of the badge. */
const REGION_HOT: Hotspot = { x: 10, y: 10 };

function regionCross(p: CursorPalette): string {
  const { x: c } = REGION_HOT;
  const gap = 2.6;
  const arm = 5.4;
  const d =
    `M${c} ${esc(c - gap - arm)}v${arm}M${c} ${esc(c + gap)}v${arm}` +
    `M${esc(c - gap - arm)} ${c}h${arm}M${esc(c + gap)} ${c}h${arm}`;
  return (
    `<path d="${d}" stroke="${p.edge}" stroke-width="3.6"/>` +
    `<path d="${d}" stroke="${p.body}" stroke-width="1.5"/>`
  );
}

/** The direct-select arrow: the same arrow, hollow, so it reads as "the parts". */
const hollowArrow = (p: CursorPalette) =>
  `<g transform="scale(${ARROW_SCALE})"><path d="${ARROW_D}" fill="${p.edge}" stroke="${p.body}" ` +
  `stroke-width="1.7" stroke-linejoin="round"/></g>`;

/** The largest eraser ring drawn as a pointer, in CSS px (Chrome caps cursors at 128 device px). */
export const ERASER_RING_MAX = 56;

/**
 * The eraser as the area it takes out.
 *
 * A ring the width of the eraser, centred on the hotspot, which is how
 * Excalidraw and paint programs show it: the question an eraser raises is
 * "what will this touch", and a ring answers it before the press. A faint veil
 * inside separates the area from the content under it. Rings wider than a
 * cursor may be drawn are capped; the stroke still erases at full width.
 */
export function eraserVisual(sizePx = 20, dark = cursorTheme.dark): CursorVisual {
  const p = paletteFor(dark);
  const d = Math.max(8, Math.min(ERASER_RING_MAX, Math.round(sizePx)));
  const box = Math.max(SIZE, d + 8 + ((d + 8) % 2));
  const c = box / 2;
  const r = d / 2;
  return {
    id: tagged(`erase:${d}:${dark ? 'd' : 'l'}`),
    svg: svgWrap(
      `<circle cx="${c}" cy="${c}" r="${r}" fill="${p.edge}" fill-opacity="0.22" stroke="${p.edge}" stroke-width="3.2"/>` +
        `<circle cx="${c}" cy="${c}" r="${r}" stroke="${p.body}" stroke-width="1.4"/>` +
        `<circle cx="${c}" cy="${c}" r="1.1" fill="${p.body}" stroke="${p.edge}" stroke-width="0.9"/>`,
      box
    ),
    offsetX: -c,
    offsetY: -c,
    size: box,
  };
}

/**
 * The comment pointer: the pin it is about to drop.
 *
 * A round bubble with one square corner, and the corner is the hotspot, which
 * is exactly where the comment's pin will sit. The plus says a press adds one.
 */
export function commentVisual(dark = cursorTheme.dark): CursorVisual {
  const p = paletteFor(dark);
  const bubble = 'M3 25V14a11 11 0 1 1 11 11z';
  const plus = 'M14 9.6v8.8M9.6 14h8.8';
  return {
    id: tagged(`comment:${dark ? 'd' : 'l'}`),
    svg: svgWrap(
      `<path d="${bubble}" fill="${p.body}" stroke="${p.edge}" stroke-width="1.7" stroke-linejoin="round"/>` +
        `<path d="${plus}" stroke="${p.edge}" stroke-width="2"/>`
    ),
    offsetX: -3,
    offsetY: -25,
  };
}

/** The magnifier, for zooming in or out by click. Its hotspot is the lens centre. */
export function zoomVisual(direction: 'in' | 'out', dark = cursorTheme.dark): CursorVisual {
  const p = paletteFor(dark);
  const lens = 'M11.5 4a7.5 7.5 0 1 0 0 15a7.5 7.5 0 1 0 0-15z';
  const handle = 'M17.1 17.1 23.5 23.5';
  const sign = direction === 'in' ? 'M11.5 8.2v6.6M8.2 11.5h6.6' : 'M8.2 11.5h6.6';
  return {
    id: tagged(`zoom:${direction}:${dark ? 'd' : 'l'}`),
    svg: svgWrap(
      `<path d="${handle}" stroke="${p.edge}" stroke-width="5.4"/>` +
        `<path d="${lens}" fill="${p.edge}" fill-opacity="0.35" stroke="${p.edge}" stroke-width="4"/>` +
        `<path d="${handle}" stroke="${p.body}" stroke-width="3"/>` +
        `<path d="${lens}" stroke="${p.body}" stroke-width="1.8"/>` +
        `<path d="${sign}" stroke="${p.body}" stroke-width="1.8"/>`
    ),
    offsetX: -11.5,
    offsetY: -11.5,
  };
}

/** Badge glyphs for pointer states rather than tools. */
const STATE_GLYPHS = {
  'not-allowed': '<circle cx="12" cy="12" r="7.6"/><path d="M6.8 17.2 17.2 6.8"/>',
  busy: '<path d="M6 12h.01M12 12h.01M18 12h.01"/>',
} as const;

export type PointerState = keyof typeof STATE_GLYPHS;

/**
 * The arrow with a state on it: "you can't do that here" or "working on it".
 *
 * A CSS cursor cannot animate, so busy is three dots rather than a spinner;
 * the native spinner would be the one foreign pointer in the set.
 */
export function stateVisual(state: PointerState, dark = cursorTheme.dark): CursorVisual {
  const p = paletteFor(dark);
  return {
    id: tagged(`state:${state}:${dark ? 'd' : 'l'}`),
    svg: svgWrap(arrow(p) + badge(STATE_GLYPHS[state], p)),
    offsetX: -TIP.x,
    offsetY: -TIP.y,
  };
}

/** The brushes the pen tool holds. Mirrors `engine/tools/brushes.ts`. */
export type DrawBrush = 'pen' | 'marker' | 'highlighter';

/**
 * Each brush as an implement, drawn upright with its tip at the origin.
 *
 * Original art in the pointer's own language: a filled body in the theme's
 * body colour, outlined in its edge colour, and the parts that carry ink in
 * the ink it will lay down. Turned 45° so the tip is the bottom-left corner
 * and the body reaches up-right, out of the way of the stroke.
 */
const IMPLEMENTS: Record<DrawBrush, { body: string; tip: string; band: string }> = {
  // A fineliner: a slim barrel, a short cone, a needle point.
  pen: {
    body: 'M-2.6 -7.4h5.2V-24.8a2.6 2.6 0 0 1-5.2 0z',
    tip: 'M0 0-2.6-7.4h5.2z',
    band: 'M-2.6 -7.4h5.2v-2.2h-5.2z',
  },
  // A marker: a broad barrel and a felt bullet tip.
  marker: {
    body: 'M-3.6 -8h7.2V-23.2a3.6 3.6 0 0 1-7.2 0z',
    tip: 'M-1.6 0a1.6 1.6 0 0 0 3.2 0l2-8h-7.2z',
    band: 'M-3.6 -20.4h7.2v-2.8h-7.2z',
  },
  // A highlighter: the widest barrel and a flat chisel.
  highlighter: {
    body: 'M-4.2 -7.2h8.4V-22.6a4.2 4.2 0 0 1-8.4 0z',
    tip: 'M-3.2 0h6.4l1-7.2h-8.4z',
    band: 'M-4.2 -7.2h8.4v-2.4h-8.4z',
  },
};

/** The tip of a drawing implement, in the pointer's box: the hotspot. */
export const DRAW_TIP: Hotspot = { x: 4, y: 24 };

/**
 * The pen tool's pointer: the brush in hand, its tip in the current ink.
 *
 * The ink is the one live colour on any pointer, and it earns it: it answers
 * "what colour will this be" before the stroke starts, which a swatch in a
 * panel answers only if you look there. Built per ink and cached by id, so a
 * palette change costs one string.
 */
export function drawVisual(brush: DrawBrush, ink: string, dark = cursorTheme.dark): CursorVisual {
  const p = paletteFor(dark);
  const art = IMPLEMENTS[brush] ?? IMPLEMENTS.pen;
  const shapes = [art.body, art.band, art.tip];
  const halo = shapes
    .map((d) => `<path d="${d}" fill="${p.edge}" stroke="${p.edge}" stroke-width="3.2"/>`)
    .join('');
  const fills =
    `<path d="${art.body}" fill="${p.body}" stroke="${p.edge}" stroke-width="1.1"/>` +
    `<path d="${art.band}" fill="${ink}" stroke="${p.edge}" stroke-width="1.1"/>` +
    `<path d="${art.tip}" fill="${ink}" stroke="${p.edge}" stroke-width="1.1"/>`;
  return {
    id: tagged(`draw:${brush}:${ink}:${dark ? 'd' : 'l'}`),
    svg: svgWrap(
      `<g transform="translate(${DRAW_TIP.x} ${DRAW_TIP.y}) rotate(45)" stroke-linejoin="round">${halo}${fills}</g>`
    ),
    offsetX: -DRAW_TIP.x,
    offsetY: -DRAW_TIP.y,
  };
}

/** Options for the board pointer that only some tools read. */
export interface CursorOptions {
  /** The pen tool's brush and ink. */
  brush?: DrawBrush;
  ink?: string;
  /** The eraser's width in screen px. */
  eraserSize?: number;
}

/**
 * The art for a mode and tool, in a theme's accent.
 *
 * `id` is what `LocalCursor` compares to decide whether to touch the DOM at
 * all, so it has to name every input that changes the markup — the tool as
 * well as the mode, and the accent, since a theme switch changes the badge.
 */
export function cursorVisual(
  mode: CursorMode,
  tool: string | undefined,
  accent: string,
  dark = cursorTheme.dark,
  options: CursorOptions = {}
): CursorVisual {
  // The pen and the eraser are drawn from live settings, so they have their
  // own builders and their own ids.
  if (tool === 'pen' && mode === 'draw') {
    return drawVisual(options.brush ?? 'pen', options.ink ?? (dark ? PAPER : INK), dark);
  }
  if (mode === 'erase') return eraserVisual(options.eraserSize ?? 20, dark);
  if (mode === 'comment') return commentVisual(dark);
  if (tool === 'bezier-pen') return penVisual('place', dark);

  const glyph = glyphFor(tool, mode);
  const pal = paletteFor(dark);
  // Every input that changes the markup is named, or the DOM write is skipped
  // on a change it cannot see — which is how a theme switch would have left
  // the old pointer in place until the next tool change.
  const id = tagged(`${mode}:${tool ?? ''}:${accent}:${dark ? 'd' : 'l'}`);
  const at = (h: Hotspot, svg: string): CursorVisual => ({
    id,
    svg,
    offsetX: -h.x,
    offsetY: -h.y,
  });

  switch (mode) {
    case 'pan':
      /**
       * The open hand, and only the open hand.
       *
       * A `url()` cursor is decoded as a standalone document, so the page's
       * CSS cannot reach inside it to hide one of two drawings: art carrying
       * both hands showed both, overlaid. The hand closes on press because the
       * pressed state is a *different cursor value*: `LocalCursor` writes the
       * closed hand to `--cursor-grab`, and `index.css` swaps to it with
       * `[data-cursor-mode="pan"]:active`, so no render is involved.
       */
      return at(CENTRE, svgWrap(hand(HAND_OPEN)));
    case 'grab':
      return at(CENTRE, svgWrap(hand(HAND_CLOSED, HAND_CLOSED_FOLDS)));
    case 'aim':
      return at(CENTRE, svgWrap(cross(3.4, 7, pal, accent)));
    case 'text': {
      /**
       * The one tool whose pointer is not an arrow, because the click lands
       * *between two characters* and an arrow occludes the gap it is aimed
       * into. See `typeVisual`.
       */
      const t = typeVisual(dark);
      return { id, svg: t.svg, offsetX: t.offsetX, offsetY: t.offsetY };
    }
    default:
      /**
       * An arrow, badged with whatever the tool is holding.
       *
       * `select` has no glyph and gets no badge, deliberately: selecting is the
       * default state, so badging it decorates every pointer with the
       * information that nothing in particular is happening. `direct-select`
       * resolves to this same mode and *does* have one, which is the case that
       * makes the rule worth stating as "the glyph is the tool's, not the
       * mode's".
       */
      if (mode === 'draw' && tool && REGION_TOOLS.has(tool)) {
        return at(REGION_HOT, svgWrap(regionCross(pal) + (glyph ? badge(glyph, pal) : '')));
      }
      if (tool === 'direct-select') {
        return at(TIP, svgWrap(hollowArrow(pal) + (glyph ? badge(glyph, pal) : '')));
      }
      return at(TIP, svgWrap(arrow(pal) + (glyph ? badge(glyph, pal) : '')));
  }
}

/* ------------------------------------------------------- outside the board */

/**
 * Which pointer a surface outside the board gets.
 *
 * ## Why this is a type and not a function any more
 *
 * There was a `cursorContextFor(target)` here that read an event's target and
 * decided, on every raw pointer update, whether the pointer was over the
 * board, a text field or chrome. It was needed while the pointer was a drawn
 * element, because a drawn element has to be told what it is over.
 *
 * A `url()` cursor does not. CSS already resolves "what is under the pointer",
 * for free, correctly, and with none of the caveats that function carried — no
 * per-event tag test, no realm problem, no walking the tree. The board's rule
 * names the Konva canvases, a text field's names `input, textarea,
 * [contenteditable]`, and the arrow sits on `html` for everything else.
 *
 * Deleting it rather than leaving it is the point. It had tests and it read as
 * finished, which is exactly what makes a dead function expensive: the next
 * person adds a case to it and wonders why nothing changes.
 */
export type CursorContext = 'ui' | 'text';

/**
 * The I-beam, for a text field.
 *
 * Drawn rather than borrowed because everything else is: a native I-beam
 * beside a drawn arrow is the seam this whole approach exists to remove, and
 * the native one is a different weight and has no shadow.
 *
 * The crossbars matter more than they look. A bare vertical line disappears
 * against a line of text, which is the one place this cursor is ever used —
 * the serifs are what separate it from the strokes of the letters behind it.
 */
function ibeam(p: CursorPalette): string {
  const d = 'M14 5.5v17M11.4 5.5h5.2M11.4 22.5h5.2';
  return (
    `<path d="${d}" stroke="${p.body}" stroke-width="3.6"/>` +
    `<path d="${d}" stroke="${p.edge}" stroke-width="1.5"/>`
  );
}

/**
 * The pointer for everything that is not the board.
 *
 * The same arrow the board uses, with no badge: a badge names the tool that
 * would act on a press, and over a panel no tool would. It is the arrow rather
 * than a hand over buttons for the same reason Figma, Illustrator and
 * Photoshop all show an arrow there — the hand is a *canvas* affordance in an
 * application whose canvas is the point, and spending it on chrome makes it
 * mean less where it matters.
 */
export function chromeVisual(context: CursorContext, dark = cursorTheme.dark): CursorVisual {
  const pal = paletteFor(dark);
  const id = tagged(`chrome:${context}:${dark ? 'd' : 'l'}`);
  if (context === 'text') {
    return { id, svg: svgWrap(ibeam(pal)), offsetX: -CENTRE.x, offsetY: -CENTRE.y };
  }
  return { id, svg: svgWrap(arrow(pal)), offsetX: -TIP.x, offsetY: -TIP.y };
}

/* ----------------------------------------------------------------- rotate */

/**
 * The rotate pointer, turned to the corner it is offered at.
 *
 * ## Why this had to exist before the rotate handle could be removed
 *
 * The selection box drops Konva's protruding ninth control and puts rotation
 * in the ring just outside each corner, which is what Figma and Illustrator
 * do. The risk in that is discoverability: a stalk with a knob on it
 * advertises itself and an invisible hot zone does not. What those apps
 * replace it with is exactly this — the pointer changes the instant you enter
 * the zone. **The cursor is the affordance**, so removing the handle without
 * one would have been a regression dressed as polish.
 *
 * ## Why it is angled
 *
 * A curved arrow has a direction, so one drawn at a fixed angle is right at
 * one corner and visibly wrong at the other three. It is turned to the
 * corner's own diagonal plus the object's rotation, so it always lies
 * tangential to the arc that corner is about to travel — which is the same
 * reasoning `cursorForAnchor` already applies to the eight resize arrows, and
 * the same reason it reads the rotation at hover time rather than closing over
 * it.
 */
/**
 * The rotate pointer's geometry, built once from the circle it describes.
 *
 * ## Why this is computed and not written out
 *
 * The first version was hand-authored path data — `M6.4 16.6 a8 8 0 1 1 3.2 4.4`
 * with a two-stroke chevron near it — and it was wrong in three ways that are
 * invisible in a string and obvious in a construction:
 *
 * 1. **The arc was not centred on the hotspot.** An SVG `A` command places a
 *    circle from two endpoints and a radius, so its centre falls where the
 *    arithmetic puts it. `rotateVisual` then turns the whole mark about
 *    (14,14) — the hotspot — so as the corner angle changed the arrow *orbited*
 *    the point instead of spinning in place. Building it from an explicit
 *    centre makes that impossible.
 * 2. **The sweep was not what the comment said.** `large-arc=1, sweep=1` on
 *    that chord is about 320°, which reads as a ring with a nick in it; the
 *    comment beside it claimed 200°.
 * 3. **The head was at the wrong end and not tangential.** It sat near the
 *    arc's *start*, at whatever angle two hand-picked line segments happened
 *    to make. An arrowhead that is a few degrees off its tangent does not look
 *    like a mistake — it looks like a cheap asset, which is worse.
 *
 * ## The design
 *
 * One arc of 235° with a single **filled** head, which is what Illustrator,
 * Figma and Canva all show. Photoshop's double-headed version says "either
 * way", which is true, but at 28px two heads on one small arc lose the gap
 * that makes it read as an arrow rather than a ring — and one head is already
 * unambiguous, since nothing else in this product is a circular arrow.
 *
 * The gap is load-bearing: at 320° the mark closes up and reads as a
 * *refresh* glyph, which is a button, not a direction.
 *
 * The head is a filled triangle rather than two strokes, for the same reason
 * the main pointer is a filled arrow: at this size a stroked chevron reads as
 * two marks and a solid one reads as a point.
 */
const ROTATE = (() => {
  const R = 7.6;
  const C = CENTRE.x;
  // A shallow arc, not most of a ring: with a head at each end a longer sweep
  // closes into a circle and stops reading as an arrow.
  const START = 200;
  const SWEEP = 140;
  const rad = (d: number) => (d * Math.PI) / 180;
  const at = (deg: number) => ({ x: C + R * Math.cos(rad(deg)), y: C + R * Math.sin(rad(deg)) });

  const a0 = START;
  const a1 = START + SWEEP;
  // The arc stops short at both ends so the filled heads cap it rather than
  // poking out through their points.
  const p0 = at(a0 + 5);
  const p1 = at(a1 - 5);
  const arc =
    `M${esc(p0.x)} ${esc(p0.y)} A${R} ${R} 0 ${SWEEP > 180 ? 1 : 0} 1 ${esc(p1.x)} ${esc(p1.y)}`;

  const FWD = 3.2;
  const BACK = 2.4;
  const HALF = 3.0;

  /**
   * One head, tangential by construction and pointing *out* of the arc.
   *
   * `dir` is +1 at the end the arc runs towards and −1 at the end it comes
   * from, so the two heads point opposite ways round the circle — which is
   * what makes it a double-headed arrow and says "turns either way" rather
   * than "turns this way".
   */
  const head = (deg: number, dir: 1 | -1) => {
    const t = { x: -Math.sin(rad(deg)) * dir, y: Math.cos(rad(deg)) * dir };
    const out = { x: Math.cos(rad(deg)), y: Math.sin(rad(deg)) };
    const on = at(deg);
    const tip = { x: on.x + t.x * FWD, y: on.y + t.y * FWD };
    const base = { x: on.x - t.x * BACK, y: on.y - t.y * BACK };
    const b1 = { x: base.x + out.x * HALF, y: base.y + out.y * HALF };
    const b2 = { x: base.x - out.x * HALF, y: base.y - out.y * HALF };
    return `M${esc(tip.x)} ${esc(tip.y)} L${esc(b1.x)} ${esc(b1.y)} L${esc(b2.x)} ${esc(b2.y)}Z`;
  };

  /**
   * Which way the mark *already* points, before any rotation is applied.
   *
   * The middle of the arc, which is the direction the whole glyph reads as
   * facing. Callers ask for a facing in board terms — "point at the top-left
   * corner" — and the difference between that and this is the rotation to
   * apply. Without it the art is turned by the raw compass bearing and lands
   * a quarter turn out at every corner, which is what "the icon positioning
   * is wrong" was.
   */
  return {
    arc,
    heads: [head(a1, 1), head(a0, -1)],
    radius: R,
    tipAngle: a1,
    sweep: SWEEP,
    facing: START + SWEEP / 2,
  };
})();

/** The arc and head of the rotate pointer, for the test that checks them. */
export const ROTATE_GEOMETRY = ROTATE;

/**
 * The rotate pointer, turned to the corner it is offered at.
 *
 * ## Why this had to exist before the rotate handle could be removed
 *
 * The selection box drops Konva's protruding ninth control and puts rotation
 * in the ring just outside each corner, which is what Figma and Illustrator
 * do. The risk in that is discoverability: a stalk with a knob on it
 * advertises itself and an invisible hot zone does not. What those apps
 * replace it with is exactly this — the pointer changes the instant you enter
 * the zone. **The cursor is the affordance**, so removing the handle without
 * one would have been a regression dressed as polish.
 *
 * ## Why it is angled
 *
 * A curved arrow has a direction, so one drawn at a fixed angle is right at
 * one corner and visibly wrong at the other three. It is turned to the
 * corner's own diagonal plus the object's rotation, so it always lies
 * tangential to the arc that corner is about to travel — the same reasoning
 * `cursorForAnchor` applies to the eight resize arrows, and the same reason it
 * reads the rotation at hover time rather than closing over it.
 *
 * Because the arc is centred on the hotspot, turning it is a true spin about
 * the point being held: the mark rotates and never drifts.
 */
/**
 * The rotate pointer, aimed at a corner.
 *
 * `facingDeg` is where the mark should point **in board terms** — the corner's
 * own outward diagonal, plus whatever the object is turned by — measured
 * clockwise from east like every other angle in this codebase.
 *
 * The art is not drawn facing east, so that bearing is not the rotation to
 * apply: the arc's own middle points at `ROTATE.facing`, and the turn is the
 * difference. Rotating by the raw bearing put every corner's arrow a quarter
 * turn out, which reads as an arrow pointing at nothing in particular — the
 * kind of wrong that looks like carelessness rather than like a bug.
 */
export function rotateVisual(facingDeg: number, dark = cursorTheme.dark): CursorVisual {
  const p = paletteFor(dark);
  const turn = Math.round(facingDeg - ROTATE.facing);
  const marks = [ROTATE.arc, ...ROTATE.heads];
  const pass = (stroke: string, width: number, filled: boolean) =>
    marks
      .map(
        (d, i) =>
          `<path d="${d}" fill="${i === 0 ? 'none' : filled ? stroke : 'none'}" stroke="${stroke}" ` +
          `stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
      )
      .join('');
  return {
    id: tagged(`rotate:${turn}:${dark ? 'd' : 'l'}`),
    svg: svgWrap(
      `<g transform="rotate(${turn} ${CENTRE.x} ${CENTRE.y})">` +
        // The halo, in the body colour, so the mark separates from any content.
        pass(p.body, 3.8, true) +
        // The mark itself.
        pass(p.edge, 1.7, true) +
        `</g>`
    ),
    offsetX: -CENTRE.x,
    offsetY: -CENTRE.y,
  };
}

/* --------------------------------------------------------- scale, precision */

/**
 * The scale pointer: a double-headed arrow along the axis the edge will travel.
 *
 * ## Why drawn, when the OS already has eight of these
 *
 * `nwse-resize` and its seven siblings are real cursors and they were what the
 * handles used. Two things are wrong with them here, and only one is cosmetic.
 *
 * The cosmetic one: they are the only pointers left in the product that are not
 * ours, so the set breaks precisely at the moment of most careful work.
 *
 * The one that matters: **there are only eight of them.** A resize cursor is
 * supposed to point along the direction the edge travels, and the OS set is
 * 45° apart — so `cursorForAnchor` has to snap to the nearest eighth of a turn.
 * On an object rotated 20° every handle's arrow is up to 22.5° off the drag it
 * describes. Drawn, the angle is continuous and the arrow points exactly along
 * the motion at any rotation, which is the difference between a canvas that
 * feels precise and one that feels approximately right.
 *
 * The snapped keyword is still what the `url()` falls back to, so a browser
 * that cannot use the image gets the nearest real one rather than an arrow.
 */
export function resizeVisual(angleDeg: number, dark = cursorTheme.dark): CursorVisual {
  const p = paletteFor(dark);
  // A shaft with a head at each end, drawn along the vertical and then turned,
  // so one construction serves every angle.
  const d = 'M14 7.5v13M14 6l-3.2 3.4M14 6l3.2 3.4M14 22l-3.2-3.4M14 22l3.2-3.4';
  return {
    id: tagged(`resize:${Math.round(angleDeg)}:${dark ? 'd' : 'l'}`),
    svg: svgWrap(
      `<g transform="rotate(${Math.round(angleDeg)} 14 14)">` +
        `<path d="${d}" fill="none" stroke="${p.body}" stroke-width="4.2"/>` +
        `<path d="${d}" fill="none" stroke="${p.edge}" stroke-width="1.7"/>` +
        `</g>`
    ),
    offsetX: -CENTRE.x,
    offsetY: -CENTRE.y,
  };
}

/**
 * The precision crosshair, for Caps Lock.
 *
 * Photoshop's convention, and it earns its place for a reason the other
 * pointers cannot meet: every cursor in this set is a *shape*, and a shape
 * covers the thing you are aiming at. When the job is to put a point on an
 * exact pixel — aligning to a corner, starting a stroke on a join — the
 * pointer itself is in the way.
 *
 * So this is deliberately the thinnest, largest mark in the product: long thin
 * arms, a real gap in the middle, and no badge, no fill, no glyph. Nothing to
 * identify the tool with, because Caps Lock is held for a moment and the tool
 * has not changed — the pointer has stopped describing it in order to get out
 * of the way.
 *
 * The gap is the whole point and it is why this is not simply the `aim` cross
 * at a lighter weight: the pixel under the hotspot must be visible, and a
 * crosshair that meets in the middle covers it with its own join.
 */
/**
 * How far the crosshair reaches from its centre — as large as the box allows.
 *
 * The centre sits at 14 in a 28px box, so 13 leaves a pixel of margin. The
 * first draft used 15 and the arms were **cut off**: an SVG in a page can
 * overflow its viewBox, and this file sets `overflow: visible`, but a cursor
 * image is clipped to its declared size. It looked right everywhere except
 * where it is used.
 */
export const PRECISION_REACH = 13;

export function precisionVisual(dark = cursorTheme.dark): CursorVisual {
  const p = paletteFor(dark);
  const gap = 4;
  const arm = PRECISION_REACH - gap;
  const c = SIZE / 2;
  const d =
    `M${c} ${c - gap - arm}v${arm}M${c} ${c + gap}v${arm}` +
    `M${c - gap - arm} ${c}h${arm}M${c + gap} ${c}h${arm}`;
  return {
    id: tagged(`precise:${dark ? 'd' : 'l'}`),
    svg: svgWrap(
      `<path d="${d}" stroke="${p.body}" stroke-width="3"/>` +
        `<path d="${d}" stroke="${p.edge}" stroke-width="1.1"/>`
    ),
    offsetX: -CENTRE.x,
    offsetY: -CENTRE.y,
  };
}

/* ------------------------------------------------------------- pen, type */

/** What a pen pointer is about to do to the path under it. */
export type PenAction = 'add' | 'remove' | 'convert' | 'place';

/**
 * The pen, with a sign for what the next click does.
 *
 * Illustrator's convention, and it is worth copying because these three
 * gestures happen in the *same* place — over a path — and are told apart only
 * by what is under the pointer. A segment adds, an anchor removes, a handle
 * converts. Without the sign the pointer says "you are near a path" three
 * times and the user finds out which by clicking.
 *
 * Every one of these is a gesture this editor really has: `insertAnchor` for
 * add, the Delete path for remove, `setAnchorsMode` for convert. That is the
 * bar for drawing a cursor at all — a pointer promising an action the code
 * cannot perform is the same dead-capability failure as a panel control the
 * renderer ignores, and it is worse, because it fires under the hand.
 *
 * The nib points up-left so its tip is the hotspot, and the sign sits clear of
 * it in the opposite corner where it cannot obscure what is being aimed at.
 */
export function penVisual(action: PenAction, dark = cursorTheme.dark): CursorVisual {
  const p = paletteFor(dark);
  // A fountain-pen nib: a tapered body to a point at the top-left, with a slit.
  const nib = 'M3 3 8.6 17.4 13.2 12.8Z';
  const slit = 'M5.6 5.6 10 10';
  const sign =
    action === 'place'
      ? ''
      : action === 'add'
      ? 'M19 13.5v7M15.5 17h7'
      : action === 'remove'
        ? 'M15.5 17h7'
        // Convert: a caret, which is the shape a corner point *is*.
        : 'M15.5 20 19 15.5 22.5 20';
  return {
    id: tagged(`pen:${action}:${dark ? 'd' : 'l'}`),
    svg: svgWrap(
      `<path d="${nib}" fill="${p.body}" stroke="${p.edge}" stroke-width="1.7" stroke-linejoin="round"/>` +
        `<path d="${slit}" stroke="${p.edge}" stroke-width="1.2" opacity="0.55"/>` +
        (sign
          ? `<path d="${sign}" fill="none" stroke="${p.body}" stroke-width="4"/>` +
            `<path d="${sign}" fill="none" stroke="${p.edge}" stroke-width="1.8"/>`
          : '')
    ),
    offsetX: -3,
    offsetY: -3,
  };
}

/**
 * The type pointer: an I-beam in a dotted box.
 *
 * The arrow-with-a-badge it replaces was wrong in a way the other tools are
 * not. Every other tool *places* something and an arrow tip is a sensible
 * hotspot for that. Text is different: the click lands **between two
 * characters**, and an arrow occludes the gap it is being aimed into with its
 * own body.
 *
 * The box is Illustrator's, and it is not decoration either — it is what
 * distinguishes the tool that will *create* a text object from the ordinary
 * I-beam that means "there is already text here to select". One says a drag
 * makes a box; the other says a drag makes a selection.
 */
export function typeVisual(dark = cursorTheme.dark): CursorVisual {
  const p = paletteFor(dark);
  const beam = 'M14 8v12M11.6 8h4.8M11.6 20h4.8';
  const box = 'M5.5 4.5h17v19h-17z';
  return {
    id: tagged(`type:${dark ? 'd' : 'l'}`),
    svg: svgWrap(
      `<path d="${box}" fill="none" stroke="${p.body}" stroke-width="3" stroke-dasharray="2.4 2.4"/>` +
        `<path d="${box}" fill="none" stroke="${p.edge}" stroke-width="1.1" stroke-dasharray="2.4 2.4" opacity="0.75"/>` +
        `<path d="${beam}" stroke="${p.body}" stroke-width="3.4"/>` +
        `<path d="${beam}" stroke="${p.edge}" stroke-width="1.5"/>`
    ),
    offsetX: -CENTRE.x,
    offsetY: -CENTRE.y,
  };
}

/**
 * The shear pointer: two arrows sliding past each other.
 *
 * ## Why not the resize double-arrow
 *
 * They would be the same picture for two different outcomes, on handles a few
 * pixels apart. A resize moves an edge and keeps the box rectangular; a shear
 * *slides* one edge past the opposite one and leaves it a parallelogram. So
 * the mark is two arrows on **offset** shafts pointing opposite ways — the
 * shape of one thing sliding across another, which is what the gesture does
 * and what no single arrow can say.
 *
 * Turned to the edge it belongs to, and to the object's rotation, for the same
 * reason the rotate and resize pointers are: an arrow that does not lie along
 * the motion describes a different gesture.
 */
export function shearVisual(angleDeg: number, dark = cursorTheme.dark): CursorVisual {
  const p = paletteFor(dark);
  // Upper shaft runs right, lower shaft runs left.
  const d =
    'M6 11h13M16 8l3.5 3-3.5 3' +
    'M22 17H9M12 14l-3.5 3 3.5 3';
  return {
    id: tagged(`shear:${Math.round(angleDeg)}:${dark ? 'd' : 'l'}`),
    svg: svgWrap(
      `<g transform="rotate(${Math.round(angleDeg)} 14 14)">` +
        `<path d="${d}" fill="none" stroke="${p.body}" stroke-width="4"/>` +
        `<path d="${d}" fill="none" stroke="${p.edge}" stroke-width="1.6"/>` +
        `</g>`
    ),
    offsetX: -CENTRE.x,
    offsetY: -CENTRE.y,
  };
}

/**
 * The move pointer: a four-way arrow.
 *
 * ## Why this exists after all
 *
 * It was argued against and left out, on the grounds that everything on a
 * board can be moved, so announcing it on every hover is the least surprising
 * fact available — "do not label what the screen already says", which is the
 * product's own first principle.
 *
 * That reasoning holds for hovering *anything*. It does not hold for hovering
 * something **already selected**, which is a much narrower and more useful
 * claim: a selected object is surrounded by handles that resize it and a ring
 * outside them that turns it, so the one question its middle actually raises
 * is what *that* part does. Illustrator, Photoshop and Canva all answer it the
 * same way, and the reference this was built against shows exactly that.
 *
 * So it is shown over a selection and nowhere else. The distinction is the
 * point: over an unselected object the arrow still means "this will select",
 * which is true and is different.
 */
export function moveVisual(dark = cursorTheme.dark): CursorVisual {
  const p = paletteFor(dark);
  const c = SIZE / 2;
  // A cross with a head on each arm, drawn as one path so the outline pass
  // traces the whole silhouette rather than four separate marks.
  const d =
    `M${c} 4.5 L${c - 3} 8 M${c} 4.5 L${c + 3} 8 M${c} 4.5 V${c + 9.5}` +
    `M${c} 23.5 L${c - 3} 20 M${c} 23.5 L${c + 3} 20` +
    `M4.5 ${c} L8 ${c - 3} M4.5 ${c} L8 ${c + 3} M4.5 ${c} H${c + 9.5}` +
    `M23.5 ${c} L20 ${c - 3} M23.5 ${c} L20 ${c + 3}`;
  return {
    id: tagged(`move:${dark ? 'd' : 'l'}`),
    svg: svgWrap(
      `<path d="${d}" fill="none" stroke="${p.body}" stroke-width="4"/>` +
        `<path d="${d}" fill="none" stroke="${p.edge}" stroke-width="1.7"/>`
    ),
    offsetX: -c,
    offsetY: -c,
  };
}
