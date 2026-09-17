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
    `stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>` +
    `</g>`
  );
}

function svgWrap(inner: string): string {
  return (
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" ` +
    `viewBox="0 0 ${SIZE} ${SIZE}" fill="none" ` +
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
 * The open hand — four fingers and a thumb, in a 24-unit box.
 *
 * ## One drawing, two uses
 *
 * The dock's Hand seat and this pointer are the same hand, so they are the
 * same path: the dock *strokes* it (see `HandIcon`), and the pointer fills it
 * and outlines it. They used to be two drawings -- a stock icon on the seat and
 * this art under the pointer -- and they disagreed about how many fingers a
 * hand has, how wide they are and where the thumb goes, which is the "picture
 * as a second fact" failure `HANDOFF.md` keeps finding.
 *
 * ## Why the previous one looked wrong
 *
 * Its fingers were separated by valleys 0.35 units wide, under an outline 1.7
 * wide -- so the outline filled every valley and the four fingers fused into a
 * mitten with ridges on it. The thumb was a round bulb hung off the palm, and
 * the whole hand sat below and left of the box's centre, which is the hotspot.
 *
 * ## How this one is built
 *
 * Four fingers of equal width on one knuckle line, their tips on a gentle arch
 * (middle highest, little finger lowest), a palm that is a quarter circle into
 * the heel, and a thumb that leaves the palm on one straight axis and ends in
 * a round tip. The fingers are separated by *zero-width* slits: the outline
 * runs down between two fingers to the knuckle line and back up the same line,
 * which encloses no area -- so the fill is one piece -- and draws exactly one
 * separating line. Real gaps would need a width the outline cannot leave open
 * at this size; slits need none.
 */
export const HAND_OPEN =
  'M6.5 13.2V7a1.5 1.5 0 0 1 3 0v4V5.5a1.5 1.5 0 0 1 3 0V11V6.5a1.5 1.5 0 0 1 3 0V11V9a1.5 1.5 0 0 1 3 0v5.5a6.5 6.5 0 0 1-6.5 6.5c-2.2 0-4.02-1.17-5.13-2.59L2.56 12.89a1.45 1.45 0 0 1 2.28-1.78z';

/**
 * The closed hand, for a pan in progress.
 *
 * The same palm, with the fingers curled down to stubs above the knuckle line
 * and the thumb drawn in along the same axis. The heel and the hotspot stay
 * exactly where they were, so the hand reads as *closing* rather than as being
 * swapped for a different picture. The thumb has to come in: left out at full
 * length beside curled fingers, the first version read as a baseball glove.
 */
export const HAND_CLOSED =
  'M6.5 14.1V10.5a1.5 1.5 0 0 1 3 0V12V10a1.5 1.5 0 0 1 3 0V12V10.3a1.5 1.5 0 0 1 3 0V12V11a1.5 1.5 0 0 1 3 0v3.5a6.5 6.5 0 0 1-6.5 6.5c-2.2 0-4.29-.68-5.21-1.86L3.46 14.89a1.45 1.45 0 0 1 2.28-1.78z';

/**
 * Seats the 24-unit hand in the pointer's box, centred on the hotspot.
 *
 * The hand's own bounds centre on about (11.2, 12.5); at 1.12 that lands on
 * the box's middle, and it makes the fingers wide enough that each keeps a
 * visible body inside its outline. Stroke widths below are divided by the
 * scale so the outline matches the arrow's weight rather than growing with it.
 */
const HAND_FIT = 'translate(1.5 0) scale(1.12)';

function hand(d: string, p: CursorPalette): string {
  return (
    `<g transform="${HAND_FIT}">` +
    `<path d="${d}" fill="${p.body}" stroke="${p.body}" stroke-width="3.9" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="${p.body}" stroke="${p.edge}" stroke-width="1.35" stroke-linejoin="round"/>` +
    `</g>`
  );
}

/**
 * The eraser, which had no art of its own and wore a crosshair.
 *
 * Worth naming because the drawn cursor was *worse* than the CSS fallback it
 * replaced: `index.css` has always carried a real eraser bitmap for this mode,
 * and the drawn version showed a tightened crosshair — a shape that says "aim
 * here", when the whole point of an eraser is that it has a *width* and takes
 * out what it passes over.
 */
function eraser(p: CursorPalette): string {
  const body =
    'M7.8 19.6 4.3 16.1a1.9 1.9 0 0 1 0-2.7l8.5-8.5a1.9 1.9 0 0 1 2.7 0l3.6 3.6a1.9 1.9 0 0 1 0 2.7l-8.5 8.5z';
  return (
    `<g transform="translate(1 -1)">` +
    `<path d="${body}" fill="${p.body}" stroke="${p.body}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="${body}" fill="${p.body}" stroke="${p.edge}" stroke-width="1.7" stroke-linejoin="round"/>` +
    `<path d="M9.6 8.6 16.9 16" stroke="${p.edge}" stroke-width="1.4" opacity="0.55"/>` +
    `</g>`
  );
}

/** The hotspot for arrow-shaped art: its tip. */
const TIP: Hotspot = { x: 2, y: 1 };
/** The hotspot for centred art: the middle of the box. */
const CENTRE: Hotspot = { x: SIZE / 2, y: SIZE / 2 };

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
  dark = false
): CursorVisual {
  const glyph = glyphFor(tool, mode);
  const pal = paletteFor(dark);
  // Every input that changes the markup is named, or the DOM write is skipped
  // on a change it cannot see — which is how a theme switch would have left
  // the old pointer in place until the next tool change.
  const id = `${mode}:${tool ?? ''}:${accent}:${dark ? 'd' : 'l'}`;
  const at = (h: Hotspot, svg: string): CursorVisual => ({
    id,
    svg,
    offsetX: -h.x,
    offsetY: -h.y,
  });

  switch (mode) {
    case 'pan':
      /**
       * Both hands, and CSS decides which is showing.
       *
       * The hand has to close on press — it is the only gesture on the board
       * with no visible result of its own until the canvas moves, so the hand
       * closing is the entire acknowledgement that the press landed. The
       * `grab` mode exists to say that and **nothing ever set it**: the pan
       * gesture is tracked in a `ref`, which by construction cannot drive a
       * render, so `cursorModeForTool`'s `panning` input had no caller and the
       * closed hand was unreachable art.
       *
       * Emitting both and switching with `[data-pressed]` needs no render at
       * all, which is the only way this can be right — a pointer that waits
       * for React to tell it the button went down is a pointer that closes
       * late. It is also exactly what the native path already does one line
       * away in `index.css`, with `[data-cursor-mode="pan"]:active`.
       */
      return at(
        CENTRE,
        svgWrap(
          `<g class="cursor-hand-open">${hand(HAND_OPEN, pal)}</g>` +
            `<g class="cursor-hand-closed">${hand(HAND_CLOSED, pal)}</g>`
        )
      );
    case 'grab':
      return at(CENTRE, svgWrap(hand(HAND_CLOSED, pal)));
    case 'aim':
      return at(CENTRE, svgWrap(cross(3.4, 7, pal, accent)));
    case 'erase':
      // Its hotspot is the tip of the nib, not the middle of the block.
      return at({ x: 5.3, y: 19.5 }, svgWrap(eraser(pal)));
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
export function chromeVisual(context: CursorContext, dark = false): CursorVisual {
  const pal = paletteFor(dark);
  const id = `chrome:${context}:${dark ? 'd' : 'l'}`;
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
export function rotateVisual(facingDeg: number, dark = false): CursorVisual {
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
    id: `rotate:${turn}:${dark ? 'd' : 'l'}`,
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
export function resizeVisual(angleDeg: number, dark = false): CursorVisual {
  const p = paletteFor(dark);
  // A shaft with a head at each end, drawn along the vertical and then turned,
  // so one construction serves every angle.
  const d = 'M14 7.5v13M14 6l-3.2 3.4M14 6l3.2 3.4M14 22l-3.2-3.4M14 22l3.2-3.4';
  return {
    id: `resize:${Math.round(angleDeg)}:${dark ? 'd' : 'l'}`,
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

export function precisionVisual(dark = false): CursorVisual {
  const p = paletteFor(dark);
  const gap = 4;
  const arm = PRECISION_REACH - gap;
  const c = SIZE / 2;
  const d =
    `M${c} ${c - gap - arm}v${arm}M${c} ${c + gap}v${arm}` +
    `M${c - gap - arm} ${c}h${arm}M${c + gap} ${c}h${arm}`;
  return {
    id: `precise:${dark ? 'd' : 'l'}`,
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
export type PenAction = 'add' | 'remove' | 'convert';

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
export function penVisual(action: PenAction, dark = false): CursorVisual {
  const p = paletteFor(dark);
  // A fountain-pen nib: a tapered body to a point at the top-left, with a slit.
  const nib = 'M3 3 8.6 17.4 13.2 12.8Z';
  const slit = 'M5.6 5.6 10 10';
  const sign =
    action === 'add'
      ? 'M19 13.5v7M15.5 17h7'
      : action === 'remove'
        ? 'M15.5 17h7'
        // Convert: a caret, which is the shape a corner point *is*.
        : 'M15.5 20 19 15.5 22.5 20';
  return {
    id: `pen:${action}:${dark ? 'd' : 'l'}`,
    svg: svgWrap(
      `<path d="${nib}" fill="${p.body}" stroke="${p.edge}" stroke-width="1.7" stroke-linejoin="round"/>` +
        `<path d="${slit}" stroke="${p.edge}" stroke-width="1.2" opacity="0.55"/>` +
        `<path d="${sign}" fill="none" stroke="${p.body}" stroke-width="4"/>` +
        `<path d="${sign}" fill="none" stroke="${p.edge}" stroke-width="1.8"/>`
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
export function typeVisual(dark = false): CursorVisual {
  const p = paletteFor(dark);
  const beam = 'M14 8v12M11.6 8h4.8M11.6 20h4.8';
  const box = 'M5.5 4.5h17v19h-17z';
  return {
    id: `type:${dark ? 'd' : 'l'}`,
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
export function shearVisual(angleDeg: number, dark = false): CursorVisual {
  const p = paletteFor(dark);
  // Upper shaft runs right, lower shaft runs left.
  const d =
    'M6 11h13M16 8l3.5 3-3.5 3' +
    'M22 17H9M12 14l-3.5 3 3.5 3';
  return {
    id: `shear:${Math.round(angleDeg)}:${dark ? 'd' : 'l'}`,
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
export function moveVisual(dark = false): CursorVisual {
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
    id: `move:${dark ? 'd' : 'l'}`,
    svg: svgWrap(
      `<path d="${d}" fill="none" stroke="${p.body}" stroke-width="4"/>` +
        `<path d="${d}" fill="none" stroke="${p.edge}" stroke-width="1.7"/>`
    ),
    offsetX: -c,
    offsetY: -c,
  };
}
