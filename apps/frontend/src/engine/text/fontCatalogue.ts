/**
 * Every typeface board text can be set in, and how each one arrives.
 *
 * ## Why this is a manifest rather than a longer list in the picker
 *
 * The catalogue was thirteen families in an array inside `FontSelector`, and
 * five of them were fetched by a `<link>` in `index.html` — which means every
 * visitor downloaded all five on every visit, whether they set a single word
 * in them or never opened the picker at all.
 *
 * That arrangement makes "add more fonts" a straight trade against load time,
 * and it is the wrong trade: most people use two faces, and the fortieth one
 * on the list is precisely the one nobody is waiting for. Adding thirty more
 * the same way would have made the app slower for everybody in exchange for a
 * list they scroll past.
 *
 * So a face is **fetched the first time it is actually needed** — when a row
 * scrolls into view in the picker, when a font is applied, or when a board that
 * uses it is opened. `ensureFamilyStylesheet` is the whole mechanism, and
 * `measure.ts`'s `ensureFontLoaded` calls it, which is why almost nothing else
 * had to change: every renderer already asks for its family on every render, so
 * a document arriving with text in a face this browser has never seen loads it
 * without anybody adding a call.
 *
 * Three things follow from that and are worth knowing before editing this file:
 *
 * - **The interface never depends on a lazy face.** Chrome is set in Inter and
 *   Caveat, both bundled through `@fontsource` and compiled into the app's own
 *   CSS. Nothing here is on the path to first paint.
 * - **Arriving late is a repaint, not a wrong layout.** `fontEpoch.ts` notices
 *   a face landing and drops the measurement probe, so text measured against a
 *   fallback is re-measured against the real thing. That mechanism is what
 *   makes lazy loading safe for a canvas, where the layout is ours rather than
 *   the browser's.
 * - **A `spec` Google rejects fails silently.** The stylesheet 404s, no error
 *   reaches the page, and the family quietly renders in its fallback — which
 *   looks like a design choice rather than a bug. Every spec in this file was
 *   fetched and checked for a real `@font-face` before it shipped; treat a new
 *   one as unverified until it has been.
 */

export type FontSource =
  /** Compiled into the app's CSS via `@fontsource`. Always present, no fetch. */
  | 'bundled'
  /** Fetched from Google Fonts on first use. */
  | 'google'
  /** Whatever the operating system has. No fetch, and no guarantee. */
  | 'system';

export type FontCategory =
  | 'sans'
  | 'geometric'
  | 'humanist'
  | 'condensed'
  | 'serif'
  | 'display'
  | 'slab'
  | 'mono'
  | 'hand';

/**
 * The order categories appear in, and what each is *for*.
 *
 * Ordered by how often a board needs one rather than by any typographic
 * taxonomy: the neutral workhorses first, then the ones chosen for a reason.
 * Condensed sits high because this is a canvas — text goes inside boxes, and
 * the old catalogue had nothing narrow in it at all, which is the single most
 * useful thing missing from a diagramming tool's font list.
 */
export const CATEGORIES: { id: FontCategory; label: string; hint: string }[] = [
  { id: 'sans', label: 'Neutral sans', hint: 'Workhorses. Quiet at any size.' },
  { id: 'geometric', label: 'Geometric sans', hint: 'Circular forms, even colour.' },
  { id: 'humanist', label: 'Humanist sans', hint: 'Warmer, with calligraphic bones.' },
  { id: 'condensed', label: 'Condensed', hint: 'Narrow. For labels in tight boxes.' },
  { id: 'serif', label: 'Text serif', hint: 'Built to be read in paragraphs.' },
  { id: 'display', label: 'Display', hint: 'High contrast. Made for size.' },
  { id: 'slab', label: 'Slab', hint: 'Serifs with the weight of the stem.' },
  { id: 'mono', label: 'Monospace', hint: 'Fixed width. Code, data, tables.' },
  { id: 'hand', label: 'Hand & marker', hint: 'Drawn, not set.' },
];

export interface FontEntry {
  family: string;
  category: FontCategory;
  source: FontSource;
  /** What to fall back to while the face is in flight, or if it never comes. */
  generic: 'sans-serif' | 'serif' | 'monospace' | 'cursive';
  /**
   * Names tried before the generic. `@fontsource` variable packages register a
   * `… Variable` family alongside the plain one, so naming both is what keeps
   * canvas 2D and the DOM resolving to the same face.
   */
  aliases?: string[];
  /** The `family=` value for Google's css2 endpoint. Google-hosted faces only. */
  spec?: string;
  /**
   * The weights this face genuinely has.
   *
   * Read off Google's own stylesheet for every hosted family rather than
   * guessed, because the cost of guessing is invisible: a weight the face does
   * not have is *synthesised* — the browser thickens or thins the outlines —
   * and the result still renders, still looks like type, and is no longer the
   * typeface. A picker offering nine weights for Bebas Neue, which has one, is
   * lying eight times.
   */
  weights: number[];
  /**
   * Whether a true italic exists.
   *
   * Same reasoning. Without one the browser slants the upright, which is a
   * different thing from an italic — the letterforms of a real italic are
   * drawn, not sheared. The panel says so rather than silently shipping the
   * shear.
   */
  italic: boolean;
}

/**
 * The nine standard weights, filtered to the range a variable face covers.
 *
 * Variable fonts advertise a continuous range — `font-weight: 100 900` — and
 * every step inside it renders as a real instance, so the ladder is the honest
 * list of what a person can choose. Static families carry their weights
 * explicitly instead, because offering Light for a face that has only Regular
 * and Bold produces a *synthesised* light: the browser thins the outlines and
 * the result is not the typeface any more.
 */
const LADDER = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const L = (min: number, max: number) => LADDER.filter((w) => w >= min && w <= max);

const G = (
  family: string,
  category: FontCategory,
  generic: FontEntry['generic'],
  spec: string,
  weights: number[],
  italic: boolean,
): FontEntry => ({ family, category, source: 'google', generic, spec, weights, italic });

export const FONTS: FontEntry[] = [
  // ---- Neutral sans -------------------------------------------------------
  { family: 'Inter', category: 'sans', source: 'bundled', generic: 'sans-serif', aliases: ['Inter Variable'], weights: L(100, 900), italic: true },
  { family: 'Roboto', category: 'sans', source: 'bundled', generic: 'sans-serif', aliases: ['Roboto Variable'], weights: L(100, 900), italic: true },
  G('DM Sans', 'sans', 'sans-serif', 'DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000', L(100,900), true),
  G('Plus Jakarta Sans', 'sans', 'sans-serif', 'Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800', L(200,800), true),
  G('Public Sans', 'sans', 'sans-serif', 'Public+Sans:ital,wght@0,100..900;1,100..900', L(100,900), true),
  G('Figtree', 'sans', 'sans-serif', 'Figtree:ital,wght@0,300..900;1,300..900', L(300,900), true),
  G('Manrope', 'sans', 'sans-serif', 'Manrope:wght@200..800', L(200,800), false),

  // ---- Geometric sans -----------------------------------------------------
  { family: 'Outfit', category: 'geometric', source: 'bundled', generic: 'sans-serif', aliases: ['Outfit Variable'], weights: L(100, 900), italic: false },
  { family: 'Space Grotesk', category: 'geometric', source: 'bundled', generic: 'sans-serif', aliases: ['Space Grotesk Variable'], weights: L(300, 700), italic: false },
  G('Poppins', 'geometric', 'sans-serif', 'Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,600', [300,400,500,600,700], true),
  G('Montserrat', 'geometric', 'sans-serif', 'Montserrat:ital,wght@0,100..900;1,100..900', L(100,900), true),
  G('Sora', 'geometric', 'sans-serif', 'Sora:wght@100..800', L(100,800), false),

  // ---- Humanist sans ------------------------------------------------------
  G('Source Sans 3', 'humanist', 'sans-serif', 'Source+Sans+3:ital,wght@0,200..900;1,200..900', L(200,900), true),
  G('Work Sans', 'humanist', 'sans-serif', 'Work+Sans:ital,wght@0,100..900;1,100..900', L(100,900), true),
  G('Nunito Sans', 'humanist', 'sans-serif', 'Nunito+Sans:ital,opsz,wght@0,6..12,200..1000;1,6..12,200..1000', L(200,900), true),
  G('Karla', 'humanist', 'sans-serif', 'Karla:ital,wght@0,200..800;1,200..800', L(200,800), true),

  // ---- Condensed ----------------------------------------------------------
  G('Barlow Condensed', 'condensed', 'sans-serif', 'Barlow+Condensed:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,700', [300,400,500,600,700], true),
  G('Archivo Narrow', 'condensed', 'sans-serif', 'Archivo+Narrow:ital,wght@0,400..700;1,400..700', L(400,700), true),
  G('Oswald', 'condensed', 'sans-serif', 'Oswald:wght@200..700', L(200,700), false),
  G('Fira Sans Condensed', 'condensed', 'sans-serif', 'Fira+Sans+Condensed:ital,wght@0,300;0,400;0,500;0,700;1,400;1,700', [300,400,500,700], true),

  // ---- Text serif ---------------------------------------------------------
  G('Lora', 'serif', 'serif', 'Lora:ital,wght@0,400..700;1,400..700', L(400,700), true),
  G('Source Serif 4', 'serif', 'serif', 'Source+Serif+4:ital,opsz,wght@0,8..60,200..900;1,8..60,200..900', L(200,900), true),
  G('Libre Baskerville', 'serif', 'serif', 'Libre+Baskerville:ital,wght@0,400;0,700;1,400', [400,700], true),
  G('Crimson Pro', 'serif', 'serif', 'Crimson+Pro:ital,wght@0,200..900;1,200..900', L(200,900), true),
  G('EB Garamond', 'serif', 'serif', 'EB+Garamond:ital,wght@0,400..800;1,400..800', L(400,800), true),
  { family: 'Georgia', category: 'serif', source: 'system', generic: 'serif', weights: [400, 700], italic: true },

  // ---- Display ------------------------------------------------------------
  G('Playfair Display', 'display', 'serif', 'Playfair+Display:ital,wght@0,400..900;1,400..900', L(400,900), true),
  G('DM Serif Display', 'display', 'serif', 'DM+Serif+Display:ital@0;1', [400], true),
  G('Bodoni Moda', 'display', 'serif', 'Bodoni+Moda:ital,opsz,wght@0,6..96,400..900;1,6..96,400..900', L(400,900), true),
  G('Abril Fatface', 'display', 'serif', 'Abril+Fatface', [400], false),
  G('Bebas Neue', 'display', 'sans-serif', 'Bebas+Neue', [400], false),
  G('Anton', 'display', 'sans-serif', 'Anton', [400], false),

  // ---- Slab ---------------------------------------------------------------
  G('Roboto Slab', 'slab', 'serif', 'Roboto+Slab:wght@100..900', L(100,900), false),
  G('Zilla Slab', 'slab', 'serif', 'Zilla+Slab:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,700', [300,400,500,600,700], true),
  G('Bitter', 'slab', 'serif', 'Bitter:ital,wght@0,100..900;1,100..900', L(100,900), true),

  // ---- Monospace ----------------------------------------------------------
  G('JetBrains Mono', 'mono', 'monospace', 'JetBrains+Mono:ital,wght@0,100..800;1,100..800', L(100,800), true),
  G('IBM Plex Mono', 'mono', 'monospace', 'IBM+Plex+Mono:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,600', [300,400,500,600,700], true),
  G('Space Mono', 'mono', 'monospace', 'Space+Mono:ital,wght@0,400;0,700;1,400;1,700', [400,700], true),
  { family: 'Courier New', category: 'mono', source: 'system', generic: 'monospace', weights: [400, 700], italic: true },

  // ---- Hand & marker ------------------------------------------------------
  { family: 'Caveat', category: 'hand', source: 'bundled', generic: 'cursive', weights: [400, 600, 700], italic: false },
  { family: 'Architects Daughter', category: 'hand', source: 'bundled', generic: 'cursive', weights: [400], italic: false },
  G('Patrick Hand', 'hand', 'cursive', 'Patrick+Hand', [400], false),
  G('Kalam', 'hand', 'cursive', 'Kalam:wght@300;400;700', [300,400,700], false),
  G('Permanent Marker', 'hand', 'cursive', 'Permanent+Marker', [400], false),
  G('Gloria Hallelujah', 'hand', 'cursive', 'Gloria+Hallelujah', [400], false),
];

const BY_FAMILY = new Map(FONTS.map((f) => [f.family, f]));

export function fontEntry(family: string | undefined): FontEntry | undefined {
  return family ? BY_FAMILY.get(family) : undefined;
}

/** The last resort, appended to every stack. */
const GENERIC_TAIL: Record<FontEntry['generic'], string> = {
  'sans-serif': "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  monospace: "ui-monospace, SFMono-Regular, Menlo, 'Courier New', monospace",
  cursive: "'Segoe Script', cursive",
};

/**
 * The CSS `font-family` value for a family name.
 *
 * Built rather than listed. This was a 26-case `switch` in the renderer, which
 * is a second catalogue kept in step with the first by hand — a font added to
 * the picker and forgotten there rendered in the default, with nothing to say
 * it had happened.
 */
export function fontStack(family: string | undefined): string {
  const entry = fontEntry(family);
  if (!entry) {
    // An unknown family is still honoured: a document may carry a face this
    // build has never heard of, and quoting the name lets the OS supply it if
    // it can. Falling back to the default would silently rewrite the board.
    const safe = family ? family.replace(/['"\\]/g, '') : '';
    const quoted = safe ? `'${safe}', ` : '';
    return `${quoted}'Inter', 'Inter Variable', ${GENERIC_TAIL['sans-serif']}`;
  }
  const names = [entry.family, ...(entry.aliases ?? [])].map((n) => `'${n}'`).join(', ');
  return `${names}, ${GENERIC_TAIL[entry.generic]}`;
}

const GOOGLE_BASE = 'https://fonts.googleapis.com/css2?family=';
const sheets = new Map<string, Promise<void>>();
const READY = Promise.resolve();

/**
 * Make sure the browser has the *stylesheet* that defines a family, and say
 * when it has it.
 *
 * ## Why this returns a promise, which the first version did not
 *
 * It used to append the `<link>` and return, and `ensureFontLoaded` called
 * `requestFont` on the very next statement. At that moment the stylesheet has
 * not been fetched, let alone parsed, so there is no `@font-face` rule for the
 * family — `document.fonts.load` matches nothing, resolves with an empty list,
 * and `requestFont` correctly reads that as "nothing to redo" and leaves the
 * epoch alone.
 *
 * The face still arrived eventually, because drawing it is itself a request.
 * What never arrived was the **bump**: text measured against the fallback was
 * never re-measured against the real face, so the layout kept the widths of a
 * font that was no longer on screen. That is the exact failure the epoch
 * exists to prevent, reintroduced underneath it.
 *
 * And it could not recover, because `requestFont` records a spec in `asked`
 * before it does anything with it — so the one no-op attempt permanently
 * blocked the real one.
 *
 * Measured in the browser: the link appeared, the face never applied, and the
 * widths did not move.
 *
 * The append is still synchronous, so the browser starts fetching immediately;
 * only the *answer* is deferred. `error` resolves rather than rejects: a
 * family that fails to load leaves the fallback standing, and the measurements
 * taken against it are correct — there is nothing for a caller to handle.
 */
export function ensureFamilyStylesheet(family: string | undefined): Promise<void> {
  if (typeof document === 'undefined') return READY;
  const entry = fontEntry(family);
  // Bundled and system faces are already present; there is nothing to wait for.
  if (!entry || entry.source !== 'google' || !entry.spec) return READY;

  const existing = sheets.get(entry.family);
  if (existing) return existing;

  const pending = new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${GOOGLE_BASE}${entry.spec}&display=swap`;
    link.dataset.font = entry.family;
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    document.head.appendChild(link);
  });
  sheets.set(entry.family, pending);
  return pending;
}

/** For diagnostics: which families have been asked for so far. */
export function requestedFamilies(): string[] {
  return [...sheets.keys()];
}

/**
 * Families matching a query, in catalogue order.
 *
 * Matches the category label and its hint as well as the name, so "narrow"
 * finds the condensed group and "code" finds the monospaces — somebody looking
 * for a font usually knows the job before they know the name.
 */
export function searchFonts(query: string): FontEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return FONTS;
  const labels = new Map(CATEGORIES.map((c) => [c.id, `${c.label} ${c.hint}`.toLowerCase()]));
  return FONTS.filter(
    (f) => f.family.toLowerCase().includes(q) || (labels.get(f.category) ?? '').includes(q),
  );
}

/**
 * What each weight is called.
 *
 * The names people actually use, and the ones every type tool shows: a panel
 * that says `600` is asking somebody to hold a mapping in their head that the
 * control could simply have told them. The number is still what is stored —
 * `Typography.fontWeight` is a number and CSS wants one — so this is a label,
 * not a second representation.
 */
export const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

export function weightName(weight: number): string {
  return WEIGHT_NAMES[weight] ?? String(weight);
}

/** The weights a family genuinely has. Unknown families get the full ladder. */
export function weightsFor(family: string | undefined): number[] {
  return fontEntry(family)?.weights ?? LADDER;
}

/** Whether a family has a drawn italic, rather than one the browser shears. */
export function hasTrueItalic(family: string | undefined): boolean {
  const entry = fontEntry(family);
  // An unknown family is given the benefit of the doubt: it came from a
  // document rather than this catalogue, and warning about a face we know
  // nothing about would be inventing a problem.
  return entry ? entry.italic : true;
}

/**
 * The closest weight a family actually has to the one asked for.
 *
 * Switching face is where this matters. Text set in Inter Thin and changed to
 * Libre Baskerville — which has Regular and Bold and nothing else — would
 * otherwise keep `fontWeight: 100` and be *synthesised* thin: the same
 * document, quietly rendered in a face nobody chose. Snapping to the nearest
 * real weight keeps the intention (as light as this face goes) and drops the
 * fiction.
 *
 * Ties go heavier, because the ladder is perceptually uneven at the light end
 * and the heavier of two neighbours is the one that still reads at small
 * sizes.
 */
export function nearestWeight(family: string | undefined, want: number): number {
  const list = weightsFor(family);
  if (list.includes(want)) return want;
  return list.reduce((best, w) =>
    Math.abs(w - want) < Math.abs(best - want) ||
    (Math.abs(w - want) === Math.abs(best - want) && w > best)
      ? w
      : best,
  );
}

/**
 * The weight the Bold shortcut should land on for a family.
 *
 * `700` where it exists, which is almost everywhere, and the heaviest thing
 * the face has otherwise. Bold used to be a hard-coded 700: on a family whose
 * range stops at 600 that asked for a weight it did not have and got a
 * synthesised one, and on a single-weight display face it did nothing visible
 * while the button showed as on.
 */
export function boldWeightFor(family: string | undefined): number {
  const list = weightsFor(family);
  return list.includes(700) ? 700 : Math.max(...list);
}

/** Whether a family can go bolder than its regular at all. */
export function canBold(family: string | undefined): boolean {
  const list = weightsFor(family);
  return Math.max(...list) > 400;
}
