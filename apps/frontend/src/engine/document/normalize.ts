import { normalizeRecipe } from '../grid/gridNode';
import { LIST_STYLES } from '../model/schema';
import { CYCLE_UNITS } from '../text/colorCycle';
import { LINE_PROFILES, MAX_AMPLITUDE_SCALE, MAX_WAVES, MIN_AMPLITUDE_SCALE, MIN_WAVES } from '../model/linePath';
import {
  BLEND_MODES,
  DEFAULT_MITER_LIMIT,
  DEFAULT_TYPOGRAPHY,
  MAX_MITER_LIMIT,
  MAX_POLYGON_SIDES,
  MAX_STAR_POINTS,
  MAX_STAR_RATIO,
  MIN_MITER_LIMIT,
  MIN_POLYGON_SIDES,
  MIN_STAR_POINTS,
  MIN_STAR_RATIO,
  NODE_TYPES,
  STICKY_THEMES,
  type AnyNode,
  type Appearance,
  type Author,
  type FrameNode,
  type GradientStop,
  type BezierGeometry,
  type LineCap,
  type LineJoin,
  type NodeType,
  type TextCase,
  type TextResize,
  type Paint,
  type PathGeometry,
  type Point,
  type ShapeGeometry,
  type ShapeKind,

  type Shadow,
  type Stroke,
  type StrokeAlign,
  type TextAlign,
  type Typography,
  type TextGlow,
  type TextHighlight,
  type TextOutline,
} from '../model/schema';
import { END_CAP_KINDS, MAX_END_SCALE, MIN_END_SCALE, type EndCapKind } from '../model/connectorEnds';
import { FILL_STYLES, SKETCH_LEVELS } from '../model/rough';
import { normalizeBends, normalizeVertices } from '../model/polyline';
import { getColorForUser } from '../presence/ColorPalette';
import { MATERIAL_IDS, type MaterialId } from '../../utils/behaviorSystem';

/** Whether a raw value names a material the simulation actually knows. */
function isMaterialId(value: unknown): value is MaterialId {
  return typeof value === 'string' && (MATERIAL_IDS as readonly string[]).includes(value);
}
import { packAdjustments, readAdjustments } from '../model/imageAdjustments';

/**
 * Legacy -> canonical mapping.
 *
 * Applied at the CRDT boundary so nothing downstream ever sees a pre-v2
 * field. This is what allows the renderer, tools, panels, physics and
 * exporters to read a single unambiguous shape instead of each carrying its
 * own `obj.geometry?.width ?? obj.width ?? obj.content?.width ?? 100` chain.
 *
 * Every function here is **total** — it never throws and never returns
 * undefined for a required field. A document that has been round-tripped
 * through an older client, hand-edited, or partially written during an
 * interrupted sync still has to render.
 */

/**
 * The colour a stored shadow falls back to when it has none of its own.
 *
 * Semi-transparent black, and it keeps its alpha inline rather than deferring
 * to `Shadow.opacity`, because it is a **read** fallback for documents written
 * before that field existed. `DEFAULT_SHADOW_COLOR` is the opaque ink a *new*
 * shadow is seeded with; these are two different questions and collapsing them
 * would darken every legacy shadow on the board.
 */
const LEGACY_SHADOW_COLOR = 'rgba(0,0,0,0.2)';

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const str = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/**
 * A frame's safe-area insets, or undefined for "no guide".
 *
 * Undefined rather than four zeroes, so a frame with no safe area stores
 * nothing: the alternative writes a dead object onto every frame ever drawn
 * and makes "has a guide" a question about four numbers rather than one field.
 *
 * Negative insets are clamped away. They would place the guide outside the
 * frame, which reads as bleed — a different thing, with different export
 * rules — and the guide is drawn as a plain rectangle either way, so the
 * reader would have no way to tell which they were looking at.
 */
function normalizeSafeArea(raw: unknown): FrameNode['safeArea'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const inset = {
    top: Math.max(0, num(source.top, 0)),
    right: Math.max(0, num(source.right, 0)),
    bottom: Math.max(0, num(source.bottom, 0)),
    left: Math.max(0, num(source.left, 0)),
  };
  if (!inset.top && !inset.right && !inset.bottom && !inset.left) return undefined;
  return inset;
}

/** Legacy shape names that no longer exist as distinct kinds. */
/**
 * Legacy and preset names, and the side count each implies.
 *
 * `triangle` and `hexagon` stopped being kinds when `polygon` gained a side
 * count — they are two hard-coded numbers where the specification asks for any
 * of them. Both remain as *names*, here and in the tool dock, because they are
 * what people reach for; they simply resolve to a polygon now. Every document
 * ever written still opens, which is the whole job of this file.
 */
export const SHAPE_KIND_ALIASES: Record<string, { kind: ShapeKind; sides?: number }> = {
  rect: { kind: 'rect' },
  rectangle: { kind: 'rect' },
  square: { kind: 'rect' },
  circle: { kind: 'ellipse' },
  ellipse: { kind: 'ellipse' },
  oval: { kind: 'ellipse' },
  star: { kind: 'star' },
  heart: { kind: 'heart' },
  squircle: { kind: 'squircle' },
  superellipse: { kind: 'squircle' },
  line: { kind: 'line' },
  arrow: { kind: 'arrow' },
  polygon: { kind: 'polygon' },
  triangle: { kind: 'polygon', sides: 3 },
  quadrilateral: { kind: 'polygon', sides: 4 },
  pentagon: { kind: 'polygon', sides: 5 },
  hexagon: { kind: 'polygon', sides: 6 },
  heptagon: { kind: 'polygon', sides: 7 },
  octagon: { kind: 'polygon', sides: 8 },
};

/** A unit-space point, defaulted, for gradient geometry. */
function toUnitPoint(value: unknown, fallback: Point): Point {
  const p = value as { x?: unknown; y?: unknown } | undefined;
  if (!p || typeof p !== 'object') return fallback;
  return { x: num(p.x, fallback.x), y: num(p.y, fallback.y) };
}

/**
 * Gradient stops, or nothing.
 *
 * Offsets are clamped and colours are required. A stop with no colour is not a
 * stop with a default colour — it is a stop nobody meant to write, and
 * inventing one for it puts a band of some arbitrary hue into the middle of
 * somebody's gradient. `sortedStops` supplies a usable pair when the list
 * comes back empty, so dropping bad entries here is safe.
 */
function toStops(value: unknown): GradientStop[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const stops = value
    .map((entry): GradientStop | null => {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as Record<string, unknown>;
      if (typeof e.color !== 'string' || !e.color) return null;
      return {
        offset: clamp(num(e.offset, 0), 0, 1),
        color: e.color,
        opacity: typeof e.opacity === 'number' ? clamp(e.opacity, 0, 1) : undefined,
      };
    })
    .filter((s): s is GradientStop => s !== null);
  return stops.length ? stops : undefined;
}

/**
 * One paint, of whichever kind it declares.
 *
 * An unrecognised `type` falls through to solid rather than being dropped.
 * A document written by a newer client with a paint kind this one has never
 * heard of should render the shape in *some* colour — a missing fill reads as
 * a deleted object, and this is a CRDT: the two clients are looking at the
 * same board at the same time.
 */
function toPaint(entry: unknown): Paint | null {
  if (typeof entry === 'string') return entry ? { type: 'solid', color: entry } : null;
  if (!entry || typeof entry !== 'object') return null;

  const e = entry as Record<string, any>;
  const opacity = typeof e.opacity === 'number' ? clamp(e.opacity, 0, 1) : undefined;
  const stops = toStops(e.stops);

  if (stops) {
    switch (e.type) {
      case 'linear':
        return {
          type: 'linear',
          stops,
          opacity,
          from: toUnitPoint(e.from, { x: 0.5, y: 0 }),
          to: toUnitPoint(e.to, { x: 0.5, y: 1 }),
        };
      case 'radial':
        return {
          type: 'radial',
          stops,
          opacity,
          center: toUnitPoint(e.center, { x: 0.5, y: 0.5 }),
          radius: Math.max(0, num(e.radius, 0.5)),
        };
      case 'conic':
        return {
          type: 'conic',
          stops,
          opacity,
          center: toUnitPoint(e.center, { x: 0.5, y: 0.5 }),
          angle: num(e.angle, 0),
        };
      case 'diamond':
        return {
          type: 'diamond',
          stops,
          opacity,
          center: toUnitPoint(e.center, { x: 0.5, y: 0.5 }),
          radius: Math.max(0, num(e.radius, 0.5)),
        };
    }
    // Stops but no kind we know: the first stop is the colour it most nearly is.
    return { type: 'solid', color: stops[0].color, opacity };
  }

  if (typeof e.color === 'string') return { type: 'solid', color: e.color, opacity };
  return null;
}

function toPaintArray(value: unknown, legacyColor: unknown): Paint[] | undefined {
  if (Array.isArray(value)) {
    const paints = value.map(toPaint).filter((p): p is Paint => p !== null);
    if (paints.length) return paints;
  }
  // Pre-v2 shapes stored a bare hex string in `content.fill`.
  if (typeof legacyColor === 'string' && legacyColor) {
    return [{ type: 'solid', color: legacyColor }];
  }
  return undefined;
}

const LINE_CAPS = new Set<LineCap>(['butt', 'round', 'square']);
const LINE_JOINS = new Set<LineJoin>(['miter', 'round', 'bevel']);
const TEXT_RESIZES = new Set<TextResize>(['width', 'height', 'fixed']);
const TEXT_CASES = new Set<TextCase>(['none', 'upper', 'lower', 'title']);
const STROKE_ALIGNS = new Set<StrokeAlign>(['center', 'inside', 'outside']);

/**
 * A shadow, drop or inner. Both carry identical parameters and differ only in
 * how they are drawn, so reading them twice would be two chances to clamp
 * differently.
 */
function toShadow(raw: unknown): Shadow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  return {
    // Carries its own alpha, unlike `DEFAULT_SHADOW_COLOR`, and deliberately:
    // this is the *read* fallback for a stored shadow that has no colour at
    // all, which predates `Shadow.opacity` existing. Swapping it for the
    // opaque default would darken every legacy shadow that relied on it.
    color: str(s.color, LEGACY_SHADOW_COLOR),
    // A negative blur or spread is not a smaller shadow; a canvas reads the
    // first as a very large positive one and the second inverts the stroke
    // that draws it.
    blur: Math.max(0, num(s.blur, 8)),
    offsetX: num(s.offsetX, 0),
    offsetY: num(s.offsetY, 2),
    spread: Math.max(0, num(s.spread, 0)),
    opacity: clamp(num(s.opacity, 1), 0, 1),
  };
}

/**
 * A dash pattern, or nothing.
 *
 * Every entry has to be a finite, non-negative number before this reaches a
 * canvas: `setLineDash` throws on a negative or non-finite segment, and one
 * bad entry from a corrupt document would take down the whole render, not just
 * that node's outline. `Array.isArray` alone — which is what this used to
 * do — checks the container and never the contents.
 *
 * An all-zero pattern is dropped rather than kept. It is not a dash, it is an
 * invisible line, and it would leave a stroke that cannot be seen with no
 * indication of why.
 */
function toDash(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const clean = value.filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  );
  if (clean.length !== value.length) return undefined;
  return clean.some((n) => n > 0) ? clean : undefined;
}

function toStroke(value: unknown, legacyColor: unknown, legacyWidth: unknown): Stroke | undefined {
  if (value && typeof value === 'object') {
    const s = value as any;
    if (typeof s.color === 'string') {
      const stroke: Stroke = { color: s.color, width: num(s.width, 2) };
      // Assigned only when present, never set to `undefined`. A literal
      // `undefined` inside a nested plain value survives `toJSON()` and
      // defeats the `?? fallback` reads downstream.
      const dash = toDash(s.dash);
      if (dash) stroke.dash = dash;
      if (LINE_CAPS.has(s.cap)) stroke.cap = s.cap;
      // `miter` is stored as absent for the same reason `center` is: it is
      // what every stroke already draws, so the default costs no bytes.
      if (LINE_JOINS.has(s.join) && s.join !== 'miter') stroke.join = s.join;
      // Clamped rather than dropped when out of range — a limit below 1 is
      // geometrically meaningless (a miter is never shorter than a bevel) and
      // an enormous one is a spike, but both are somebody's slider having
      // travelled too far, not a corrupt document.
      if (typeof s.miterLimit === 'number' && Number.isFinite(s.miterLimit)) {
        const limit = clamp(s.miterLimit, MIN_MITER_LIMIT, MAX_MITER_LIMIT);
        if (limit !== DEFAULT_MITER_LIMIT) stroke.miterLimit = limit;
      }
      // `center` is stored as absent, so the case every existing stroke in
      // every existing document is stays the one that costs nothing.
      if (STROKE_ALIGNS.has(s.align) && s.align !== 'center') stroke.align = s.align;
      return stroke;
    }
  }
  if (typeof legacyColor === 'string' && legacyColor && legacyColor !== 'transparent') {
    return { color: legacyColor, width: num(legacyWidth, 2) };
  }
  return undefined;
}

function normalizeAppearance(raw: any): Appearance {
  const legacy = raw?.content ?? {};
  const source = raw?.appearance ?? {};

  const appearance: Appearance = {};

  const fill = toPaintArray(source.fill ?? source.fills, legacy.fill);
  if (fill) appearance.fill = fill;

  const stroke = toStroke(source.stroke ?? source.strokes?.[0], legacy.stroke, legacy.strokeWidth);
  if (stroke) appearance.stroke = stroke;

  const shadow = toShadow(source.shadow);
  if (shadow) appearance.shadow = shadow;

  const innerShadow = toShadow(source.innerShadow);
  if (innerShadow) appearance.innerShadow = innerShadow;

  // cornerRadius lived on geometry for shapes and content for images.
  const radius = source.cornerRadius ?? raw?.geometry?.cornerRadius ?? legacy.cornerRadius;
  if (typeof radius === 'number' && Number.isFinite(radius)) {
    appearance.cornerRadius = Math.max(0, radius);
  }

  // `normal` is stored as absent, so the common case costs no bytes and
  // "has a blend mode" stays a question about presence rather than value.
  if (BLEND_MODES.includes(source.blendMode) && source.blendMode !== 'normal') {
    appearance.blendMode = source.blendMode;
  }

  // Zero is absent for the same reason, and a negative radius is one Konva's
  // blur filter reads as a very large positive one.
  const blur = num(source.blur, 0);
  if (blur > 0) appearance.blur = blur;

  const backdropBlur = num(source.backdropBlur, 0);
  if (backdropBlur > 0) appearance.backdropBlur = backdropBlur;

  // Absent unless on, so an object that has never been sketched stores nothing.
  // Two legacy forms are read: `sketch: true` from the boolean this replaced,
  // and a numeric `roughness` from the one before that. Both map to `medium`,
  // which is what each of them drew.
  if (SKETCH_LEVELS.includes(source.sketch)) appearance.sketch = source.sketch;
  else if (source.sketch === true || num(source.roughness, 0) > 0) appearance.sketch = 'medium';

  // Absent is `solid`, so a shape that has never been shaded stores nothing —
  // and only stored at all when there is a sketch for it to describe, since
  // hachure on a crisp shape is a setting with no effect.
  if (appearance.sketch && FILL_STYLES.includes(source.fillStyle) && source.fillStyle !== 'solid') {
    appearance.fillStyle = source.fillStyle;
  }

  return appearance;
}

function normalizeAlign(value: unknown, fallback: TextAlign): TextAlign {
  return value === 'left' || value === 'center' || value === 'right' || value === 'justify' ? value : fallback;
}

function normalizeTypography(raw: any, overrides: Partial<Typography> = {}): Typography {
  // Text styling lived under `content` with two competing alignment keys
  // (`textAlign` written by the UI, `align` read by the renderer) and slant
  // encoded as a free-form `fontStyle` string.
  const c = raw?.content ?? {};
  const t = raw?.typography ?? {};
  const legacyStyle = str(c.fontStyle ?? t.fontStyle, '');
  const legacyWeight = c.fontWeight ?? t.fontWeight;

  return {
    fontFamily: str(t.fontFamily ?? c.fontFamily, overrides.fontFamily ?? DEFAULT_TYPOGRAPHY.fontFamily),
    // Whole points. A resize drag multiplies by an arbitrary real factor, so
    // documents carry sizes like 24.424470292956038; rounding here means no
    // consumer — the panel, the canvas, an export — ever sees one, and the
    // panel's reading agrees with what is actually drawn.
    fontSize: Math.round(num(t.fontSize ?? c.fontSize, overrides.fontSize ?? DEFAULT_TYPOGRAPHY.fontSize)),
    fontWeight:
      typeof legacyWeight === 'number'
        ? legacyWeight
        : legacyStyle.includes('bold')
          ? 700
          : overrides.fontWeight ?? DEFAULT_TYPOGRAPHY.fontWeight,
    italic: bool(t.italic, legacyStyle.includes('italic')),
    underline: bool(t.underline, str(c.textDecoration, '').includes('underline')),
    strikethrough: bool(t.strikethrough, str(c.textDecoration, '').includes('line-through')),
    align: normalizeAlign(
      t.align ?? c.textAlign ?? c.align,
      overrides.align ?? DEFAULT_TYPOGRAPHY.align
    ),
    verticalAlign:
      t.verticalAlign === 'top' || t.verticalAlign === 'middle' || t.verticalAlign === 'bottom'
        ? t.verticalAlign
        : overrides.verticalAlign ?? DEFAULT_TYPOGRAPHY.verticalAlign,
    lineHeight: num(t.lineHeight ?? c.lineHeight, overrides.lineHeight ?? DEFAULT_TYPOGRAPHY.lineHeight),
    ...(TEXT_CASES.has(t.textCase) && t.textCase !== 'none' ? { textCase: t.textCase } : null),
    // Absent is no list, so an unrecognised value is dropped rather than
    // defaulted — a document should not acquire bullets it never had.
    ...((LIST_STYLES as readonly string[]).includes(t.list) ? { list: t.list } : null),
    // A ramp needs at least one colour and a unit it can be divided by.
    // Anything short of that is dropped rather than repaired: a half-formed
    // cycle would override `color` and leave the text an unexplained black.
    ...(CYCLE_UNITS.includes(t.colorCycle?.unit) && Array.isArray(t.colorCycle?.colors)
      && t.colorCycle.colors.length > 0
      ? {
          colorCycle: {
            unit: t.colorCycle.unit,
            colors: t.colorCycle.colors.filter((c: unknown) => typeof c === 'string').slice(0, 12),
          },
        }
      : null),
    letterSpacing: num(
      t.letterSpacing ?? c.letterSpacing,
      overrides.letterSpacing ?? DEFAULT_TYPOGRAPHY.letterSpacing
    ),
    color: str(t.color ?? c.color, overrides.color ?? DEFAULT_TYPOGRAPHY.color),
    // The four block-level fields below are all *absent by default*, and stay
    // absent rather than being written as a zero or an empty object. Every
    // existing document has none of them, and a stored `paragraphSpacing: 0`
    // or a highlight with no colour would cost bytes in the CRDT and emit
    // attributes in every export to say "nothing here".
    ...(Number.isFinite(t.paragraphSpacing) && t.paragraphSpacing > 0
      ? { paragraphSpacing: t.paragraphSpacing }
      : null),
    ...normalizeTextHighlight(t.highlight),
    ...normalizeTextOutline(t.outline),
    ...normalizeTextGlow(t.glow),
  };
}

/** The rounded ribbon behind the words. Absent unless it has a colour to draw. */
function normalizeTextHighlight(raw: any): { highlight?: TextHighlight } {
  if (!raw || typeof raw.color !== 'string') return {};
  return {
    highlight: {
      color: raw.color,
      radius: Math.max(0, num(raw.radius, 8)),
      paddingX: Math.max(0, num(raw.paddingX, 10)),
      paddingY: Math.max(0, num(raw.paddingY, 4)),
      // `ribbon` is the default because it is the treatment people mean when
      // they ask for this; `plates` is the deliberate opt-out.
      join: raw.join === 'plates' ? 'plates' : 'ribbon',
      ...(raw.autoContrast ? { autoContrast: true } : null),
    },
  };
}

/** A stroke on the letterforms. A zero weight is no outline, not an outline of nothing. */
function normalizeTextOutline(raw: any): { outline?: TextOutline } {
  if (!raw || typeof raw.color !== 'string') return {};
  const width = num(raw.width, 0);
  if (!(width > 0)) return {};
  return { outline: { color: raw.color, width } };
}

/** A halo behind the letterforms. Same rule: no radius is no glow. */
function normalizeTextGlow(raw: any): { glow?: TextGlow } {
  if (!raw || typeof raw.color !== 'string') return {};
  const blur = num(raw.blur, 0);
  if (!(blur > 0)) return {};
  return { glow: { color: raw.color, blur } };
}

function normalizeAuthor(raw: any): Author {
  const meta = raw?.metadata ?? {};
  const author = raw?.author ?? {};
  return {
    id: str(author.id ?? meta.authorId ?? raw?.createdBy, 'unknown'),
    name: str(author.name ?? meta.authorName ?? raw?.createdByName, 'Unknown'),
    // Through the palette that already answers "what colour is this person",
    // rather than a literal repeated here. A second opinion about identity
    // colour is how one author ends up two colours in two surfaces.
    color: str(
      author.color ?? meta.authorColor ?? raw?.createdByColor,
      getColorForUser(str(author.id ?? meta.authorId ?? raw?.createdBy, ''))
    ),
  };
}

/** Text lived in `content.text` for some types and top-level `text` for others. */
function normalizeText(raw: any): string {
  const fromContent = raw?.content?.text;
  const fromTop = raw?.text;
  const value = typeof fromContent === 'string' ? fromContent : fromTop;
  if (typeof value !== 'string') return '';
  // Placeholder strings were persisted as real content by older tools.
  if (value === 'Double click to edit' || value === 'Write something...' || value === 'Add comment...') {
    return '';
  }
  return value;
}

function normalizeShapeGeometry(raw: any): ShapeGeometry {
  const rawKind = str(raw?.geometry?.kind ?? raw?.content?.shapeType ?? raw?.shapeType, 'rect');
  const alias = SHAPE_KIND_ALIASES[rawKind] ?? { kind: 'rect' as ShapeKind };
  const geometry: ShapeGeometry = { kind: alias.kind };

  if (alias.kind === 'line' || alias.kind === 'arrow') {
    // Absent is straight, which is every line written before profiles existed.
    // An unrecognised profile is dropped rather than defaulted to something
    // decorative: a document should not acquire a zigzag it never had.
    const profile = raw?.geometry?.lineProfile;
    if ((LINE_PROFILES as readonly string[]).includes(profile) && profile !== 'straight') {
      geometry.lineProfile = profile;
    }
    if (Number.isFinite(raw?.geometry?.lineWaves)) {
      geometry.lineWaves = Math.max(MIN_WAVES, Math.min(MAX_WAVES, Math.round(raw.geometry.lineWaves)));
    }
    if (Number.isFinite(raw?.geometry?.lineAmplitude) && raw.geometry.lineAmplitude !== 1) {
      geometry.lineAmplitude = clamp(raw.geometry.lineAmplitude, MIN_AMPLITUDE_SCALE, MAX_AMPLITUDE_SCALE);
    }
    // Absent is the profile's own default — see `defaultEndAlign`. Storing it
    // only when it disagrees keeps every existing line untouched and keeps the
    // document from carrying a value that just restates the rule.
    if (raw?.geometry?.endAlign === 'inside' || raw?.geometry?.endAlign === 'extend') {
      geometry.endAlign = raw.geometry.endAlign;
    }
    /**
     * The two endpoints, when the document has them.
     *
     * Absent is the **legacy form**, and it is deliberately not repaired here.
     * A line written before endpoints existed runs corner to corner of its box
     * and `localRunEnds` still reads it that way, so it opens and draws exactly
     * as it always did. Inventing endpoints at the boundary would also have to
     * invent a *box* — the old one is the diagonal, not the drawn extent — and
     * normalization is not allowed to move objects on somebody's board.
     *
     * It converts the first time the line is edited, because that is the moment
     * a correct box can be computed from a real gesture rather than guessed.
     */
    const pt = (v: unknown): { x: number; y: number } | null =>
      v && typeof v === 'object' && Number.isFinite((v as any).x) && Number.isFinite((v as any).y)
        ? { x: (v as any).x, y: (v as any).y }
        : null;
    const a = pt(raw?.geometry?.a);
    const b = pt(raw?.geometry?.b);
    // Both or neither: one endpoint alone describes nothing, and a half-stored
    // pair would send `localRunEnds` down the stored branch with a hole in it.
    if (a && b) {
      geometry.a = a;
      geometry.b = b;
    }
    /**
     * The run of vertices, when the line has more than two.
     *
     * Validated here rather than trusted, because `geometry` is one
     * last-write-wins value in the CRDT: a client that adds a vertex and one
     * that removes another write whole objects, so a `bends` list of the wrong
     * length for its `vertices` is reachable without either client doing
     * anything wrong. `normalizeBends` pads or trims rather than throwing — the
     * alternative to a slightly wrong curve is a line that does not render at
     * all, on somebody else's screen, for a write they cannot see.
     *
     * A run of fewer than two points is dropped entirely, which falls back to
     * `a`/`b` and then to the legacy box. Every form below this one is still a
     * line; a one-point run is not.
     */
    const run = normalizeVertices(raw?.geometry?.vertices);
    if (run) {
      geometry.vertices = run;
      const bends = normalizeBends(run.length, raw?.geometry?.bends);
      // Stored only when it says something. An all-straight list is what the
      // reader assumes anyway, and writing it would put a field on every
      // multi-point line that nothing ever reads.
      if (bends.some((bend) => bend !== null)) geometry.bends = bends;
      // Stored only when true, so a line that was never smoothed does not carry
      // a field restating the default.
      if (raw?.geometry?.smooth === true) geometry.smooth = true;
    }
  }

  if (alias.kind === 'star') {
    // Clamped at the boundary, like every other value that reaches a renderer.
    // Konva draws a "star" with two points as a pair of crossed spikes and one
    // with zero inner radius as a set of lines to the centre — both are
    // degenerate rather than merely ugly, and neither is recoverable from the
    // control once stored. 60 is past the point where more points read as a
    // disc at any size this canvas draws.
    geometry.points = Math.round(clamp(num(raw?.geometry?.points, 5), MIN_STAR_POINTS, MAX_STAR_POINTS));
    geometry.innerRatio = clamp(num(raw?.geometry?.innerRatio, 0.5), MIN_STAR_RATIO, MAX_STAR_RATIO);
  }

  if (alias.kind === 'polygon') {
    // The alias' own side count is the *fallback*, not an override: a document
    // that says `triangle` and then stores six sides was edited after it was
    // created, and the edit is the more recent statement of intent.
    const stored = num(raw?.geometry?.points, alias.sides ?? 3);
    geometry.points = Math.round(clamp(stored, MIN_POLYGON_SIDES, MAX_POLYGON_SIDES));
  }

  if (alias.kind === 'line' || alias.kind === 'arrow') {
    // An `arrow` with no stored head is one this build created before it could
    // say so; a `line` with no stored head is a plain line. The kind carries
    // the default so neither has to be rewritten.
    // Read through the same `endCap` the connector uses, so a line and a
    // connector cannot disagree about what "arrow" means. The two booleans are
    // the legacy form and map straight across; the kind still carries the
    // default, so an `arrow` drawn before end styles existed keeps its head.
    geometry.endStart = endCap(raw?.geometry?.endStart, bool(raw?.geometry?.arrowStart, false));
    geometry.endEnd = endCap(
      raw?.geometry?.endEnd,
      bool(raw?.geometry?.arrowEnd, alias.kind === 'arrow')
    );
    // Absent is the proportional default, so an untouched line stores nothing.
    const endScale = num(raw?.geometry?.endScale, 1);
    if (endScale !== 1) geometry.endScale = clamp(endScale, MIN_END_SCALE, MAX_END_SCALE);
  }

  return geometry;
}

/** One run of anchors. Shared by the plain bezier path and each contour of a compound one. */
function toBezier(rawSegments: unknown, closed: unknown): BezierGeometry | null {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) return null;
  return {
    kind: 'bezier',
    segments: rawSegments.map((s: any) => ({
      x: num(s?.x, 0),
      y: num(s?.y, 0),
      cp1x: typeof s?.cp1x === 'number' ? s.cp1x : undefined,
      cp1y: typeof s?.cp1y === 'number' ? s.cp1y : undefined,
      cp2x: typeof s?.cp2x === 'number' ? s.cp2x : undefined,
      cp2y: typeof s?.cp2y === 'number' ? s.cp2y : undefined,
    })),
    closed: bool(closed, false),
  };
}

function normalizePathGeometry(raw: any): PathGeometry {
  // A boolean result: several contours filled as one. Read before `segments`,
  // because a compound path has none of its own.
  const subpaths = raw?.geometry?.subpaths;
  if (Array.isArray(subpaths)) {
    const contours = subpaths
      .map((s: any) => toBezier(s?.segments, s?.closed))
      .filter((s): s is BezierGeometry => s !== null);
    // A compound path with one contour is a plain path wearing a costume, and
    // one with none is nothing at all. Collapsing here means the rest of the
    // app never has to ask whether a `compound` is really compound.
    if (contours.length > 1) return { kind: 'compound', subpaths: contours };
    if (contours.length === 1) return contours[0];
  }

  // Bezier paths stored `segments`/`closed` at the top level; freehand
  // strokes stored `content.svgPath`/`content.points`/`content.strokeSize`.
  const bezier = toBezier(raw?.geometry?.segments ?? raw?.segments, raw?.geometry?.closed ?? raw?.closed);
  if (bezier) return bezier;

  const svgPath = str(raw?.geometry?.svgPath ?? raw?.content?.svgPath, '');
  const rawPoints = raw?.geometry?.points ?? raw?.content?.points;
  const points: Point[] = Array.isArray(rawPoints)
    ? rawPoints
        .map((p: any) =>
          typeof p?.x === 'number' && typeof p?.y === 'number' ? { x: p.x, y: p.y } : null
        )
        .filter((p: Point | null): p is Point => p !== null)
    : [];

  return {
    kind: 'freehand',
    svgPath,
    points,
    strokeSize: num(raw?.geometry?.strokeSize ?? raw?.content?.strokeSize, 6),
  };
}

function normalizeType(raw: any): NodeType {
  const t = str(raw?.type, 'shape');
  // `artboard` was a pre-v2 alias for a frame.
  if (t === 'artboard') return 'frame';
  return (NODE_TYPES as readonly string[]).includes(t) ? (t as NodeType) : 'shape';
}

/**
 * Separator inside a stored reaction entry. A control character, because an
 * emoji and an author id can both contain almost anything printable.
 */
const REACTION_SEP = '\u0000';

/** `👍` + `ada` → the single string actually stored in the document. */
export function encodeReaction(emoji: string, authorId: string): string {
  return `${emoji}${REACTION_SEP}${authorId}`;
}

/**
 * Sticky reactions, from any shape they have ever been stored in.
 *
 * Three shapes exist and all three are read:
 *
 * 1. **`string[]` of `emoji\0authorId`** — current. One flat list, because it
 *    is the only structure where the container is created exactly once (see
 *    `reactions.ts`).
 * 2. **`Record<emoji, string[]>`** — the intermediate nested form.
 * 3. **`Record<emoji, number>`** — original. A bare count cannot be attributed
 *    after the fact, so it is preserved as synthetic reactor ids rather than
 *    thrown away: `legacy:👍:0`, `legacy:👍:1`, … Those can never equal a real
 *    author id, so a room keeps the tally it had, nobody can un-react on
 *    behalf of someone who was never recorded, and a real reaction simply
 *    joins the same list.
 */
export function normalizeReactions(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') return {};

  const out: Record<string, string[]> = {};
  const add = (emoji: string, id: string) => {
    if (!emoji || !id) return;
    const ids = (out[emoji] ??= []);
    if (!ids.includes(id)) ids.push(id);
  };

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'string') continue;
      const at = entry.indexOf(REACTION_SEP);
      if (at <= 0) continue;
      add(entry.slice(0, at), entry.slice(at + 1));
    }
    return out;
  }

  for (const [emoji, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const id of value) if (typeof id === 'string') add(emoji, id);
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      // Bounded: a corrupt or hostile count must not build a huge array.
      const count = Math.min(Math.floor(value), 99);
      for (let i = 0; i < count; i++) add(emoji, `legacy:${emoji}:${i}`);
    }
  }
  return out;
}

/** Sizes were stored in up to three places, with per-module precedence. */
function resolveSize(raw: any): { width: number; height: number } {
  const width = raw?.width ?? raw?.geometry?.width ?? raw?.content?.width;
  const height = raw?.height ?? raw?.geometry?.height ?? raw?.content?.height;
  return { width: Math.max(1, num(width, 100)), height: Math.max(1, num(height, 100)) };
}

/**
 * Map any persisted node — current or legacy — onto the canonical model.
 */
export function normalizeNode(raw: any, id?: string): AnyNode {
  const type = normalizeType(raw);
  const { width, height } = resolveSize(raw);
  const now = Date.now();

  const base = {
    id: str(raw?.id ?? id, ''),
    type,
    x: num(raw?.x, 0),
    y: num(raw?.y, 0),
    width,
    height,
    rotation: num(raw?.rotation, 0),
    scaleX: num(raw?.scaleX, 1),
    scaleY: num(raw?.scaleY, 1),
    // Absent rather than zero when unsheared. Every document written before
    // shear existed has neither key, and writing `skewX: 0` onto all of them
    // would cost CRDT bytes and an exported attribute to say "no shear".
    ...(num(raw?.skewX, 0) !== 0 ? { skewX: num(raw.skewX, 0) } : null),
    ...(num(raw?.skewY, 0) !== 0 ? { skewY: num(raw.skewY, 0) } : null),
    opacity: num(raw?.opacity, 1),
    zIndex: num(raw?.zIndex, 0),
    parentId: typeof raw?.parentId === 'string' ? raw.parentId : undefined,
    frameId: typeof raw?.frameId === 'string' ? raw.frameId : undefined,
    locked: bool(raw?.locked, false),
    // Pre-v2 tools wrote `visible: true`, which nothing read; the renderer and
    // Layers panel have always gated on `hidden`.
    hidden: bool(raw?.hidden, raw?.visible === false),
    title: typeof raw?.title === 'string' ? raw.title : undefined,
    /**
     * Absent means "this type's default material", so documents written before
     * materials existed keep behaving exactly as they did.
     *
     * Checked against the real set rather than accepting any string. The
     * schema now types this as `MaterialId`, and a boundary that lets an
     * arbitrary string through would be handing every consumer a value the type
     * says cannot exist — which is the one thing this file promises not to do.
     * An unrecognised material becomes absent, so the node falls back to its
     * type's default instead of carrying a name nothing can look up.
     */
    material: isMaterialId(raw?.material) ? raw.material : undefined,
    createdBy: str(raw?.createdBy, 'unknown'),
    createdByName: typeof raw?.createdByName === 'string' ? raw.createdByName : raw?.metadata?.authorName,
    createdByColor:
      typeof raw?.createdByColor === 'string' ? raw.createdByColor : raw?.metadata?.authorColor,
    createdAt: num(raw?.createdAt, now),
    updatedAt: num(raw?.updatedAt, num(raw?.createdAt, now)),
    /**
     * Left absent rather than defaulted to the creator.
     *
     * A node written before `updatedBy` existed genuinely has no answer, and
     * filling it in with `createdBy` would manufacture a fact — the panel would
     * then state that Ada made the last edit on every node in every old
     * document, which is exactly the confident wrong answer this boundary is
     * supposed to prevent. Absent means "not recorded", and the panel says so.
     */
    updatedBy: typeof raw?.updatedBy === 'string' ? raw.updatedBy : undefined,
    updatedByName: typeof raw?.updatedByName === 'string' ? raw.updatedByName : undefined,
  };

  switch (type) {
    case 'text':
      return {
        ...base,
        type: 'text',
        text: normalizeText(raw),
        typography: normalizeTypography(raw),
        // `autoHeight` was the old two-state version of this and was read by
        // nothing. `true` was the default it was always written with, and it
        // means the same thing as `height`.
        resize: TEXT_RESIZES.has(raw?.resize)
          ? raw.resize
          : bool(raw?.autoHeight, true)
            ? 'height'
            : 'fixed',
        appearance: normalizeAppearance(raw),
      };

    case 'shape': {
      const text = normalizeText(raw);
      return {
        ...base,
        type: 'shape',
        geometry: normalizeShapeGeometry(raw),
        appearance: normalizeAppearance(raw),
        text: text || undefined,
        typography: text
          ? normalizeTypography(raw, { align: 'center', verticalAlign: 'middle', color: '#FFFFFF' })
          : undefined,
      };
    }

    case 'sticky': {
      const theme = raw?.theme ?? raw?.appearance?.theme;
      const app = normalizeAppearance(raw);
      const hasAppearance = Boolean(
        app.sketch || app.blur || app.shadow || app.innerShadow || app.backdropBlur || app.blendMode || app.stroke
      );
      return {
        ...base,
        type: 'sticky',
        text: normalizeText(raw),
        theme: (STICKY_THEMES as readonly string[]).includes(theme) ? theme : 'yellow',
        fontSize: num(raw?.fontSize ?? raw?.content?.fontSize, 16),
        author: normalizeAuthor(raw),
        reactions: normalizeReactions(raw?.reactions ?? raw?.metadata?.reactions),
        tags: Array.isArray(raw?.tags) ? raw.tags : Array.isArray(raw?.metadata?.tags) ? raw.metadata.tags : [],
        pinned: bool(raw?.pinned, bool(raw?.metadata?.pinned, false)),
        ...(hasAppearance ? { appearance: app } : null),
      };
    }

    case 'image':
      return {
        ...base,
        type: 'image',
        // `assetId` held the URL; `content.url` held it too, and the two could
        // disagree after an upload completed.
        src: str(raw?.src ?? raw?.assetId ?? raw?.content?.url, ''),
        naturalWidth: typeof raw?.naturalWidth === 'number' ? raw.naturalWidth : undefined,
        naturalHeight: typeof raw?.naturalHeight === 'number' ? raw.naturalHeight : undefined,
        appearance: normalizeAppearance(raw),
        crop: raw?.crop,
        // Clamped and stripped at the boundary like everything else. These
        // were passed straight through, which was harmless only because
        // nothing read them: a `NaN` reaching Konva's pixel loop does not
        // throw, it turns every channel it touches into transparent black —
        // so a bad value would present as "the image failed to load".
        filters: packAdjustments(readAdjustments(raw?.filters)),
      };

    case 'audio':
      return {
        ...base,
        type: 'audio',
        src: str(raw?.src ?? raw?.assetId ?? raw?.content?.url, ''),
        durationMs: num(raw?.durationMs ?? raw?.content?.durationMs, 0),
        waveform: Array.isArray(raw?.waveform) ? raw.waveform.filter((n: unknown) => typeof n === 'number') : [],
        transcript: typeof raw?.transcript === 'string' ? raw.transcript : undefined,
        author: normalizeAuthor(raw),
      };

    case 'path':
      return {
        ...base,
        type: 'path',
        geometry: normalizePathGeometry(raw),
        appearance: normalizeAppearance(raw),
      };

    case 'comment':
      return {
        ...base,
        type: 'comment',
        text: normalizeText(raw),
        author: normalizeAuthor(raw),
        resolved: bool(raw?.resolved, false),
      };

    case 'connector':
      return {
        ...base,
        type: 'connector',
        // Both ends are normalised to *something* rather than left possibly
        // undefined: every reader downstream treats an end as present, and a
        // connector with half an end is a crash waiting for the first
        // malformed document.
        from: normalizeConnectorEnd(raw?.from),
        to: normalizeConnectorEnd(raw?.to),
        routing:
          raw?.routing === 'straight' || raw?.routing === 'curved' ? raw.routing : 'orthogonal',
        appearance: normalizeAppearance(raw),
        /**
         * End styles, with the old booleans as their fallback.
         *
         * A document written before end styles existed says `arrowEnd: true`
         * and nothing else; mapping that to `'arrow'` here means every older
         * connector keeps exactly the head it had, and no reader downstream
         * needs to know the booleans ever existed.
         */
        endStart: endCap(raw?.endStart, bool(raw?.arrowStart, false)),
        endEnd: endCap(raw?.endEnd, bool(raw?.arrowEnd, true)),
        ...(num(raw?.endScale, 1) !== 1
          ? { endScale: clamp(num(raw.endScale, 1), MIN_END_SCALE, MAX_END_SCALE) }
          : null),
        label: typeof raw?.label === 'string' ? raw.label : undefined,
      };

    /**
     * A grid keeps only its box and its recipe; the modules are derived.
     *
     * The stored spec's own box is **discarded and replaced** with the node's,
     * rather than merged or trusted. That is the invariant the whole node type
     * exists to hold: two copies of one fact cannot disagree if the boundary
     * refuses to let a second copy through.
     */
    case 'grid':
      return {
        ...base,
        type: 'grid',
        grid: normalizeRecipe(raw?.grid, width, height),
      };

    case 'frame':
    default:
      return {
        ...base,
        type: 'frame',
        appearance: normalizeAppearance(raw),
        layout: raw?.layout,
        safeArea: normalizeSafeArea(raw?.safeArea),
      };
  }
}

/**
 * One end of a connector.
 *
 * `nodeId` absent means loose; `x`/`y` are kept regardless, because they are
 * what a *detached* end falls back to when the object it pointed at is gone.
 * Storing both is the difference between a deleted box leaving its arrows
 * where they were and leaving them collapsed on the origin.
 */
/** A stored end style, or the arrow/none the old boolean implied. */
function endCap(raw: any, legacyOn: boolean): EndCapKind {
  return (END_CAP_KINDS as string[]).includes(raw) ? (raw as EndCapKind) : legacyOn ? 'arrow' : 'none';
}

function normalizeConnectorEnd(raw: any): {
  nodeId?: string;
  port?: any;
  anchor?: { u: number; v: number };
  x?: number;
  y?: number;
} {
  const end: { nodeId?: string; port?: any; anchor?: { u: number; v: number }; x?: number; y?: number } = {};
  if (typeof raw?.nodeId === 'string' && raw.nodeId) end.nodeId = raw.nodeId;
  const port = raw?.port;
  if (port === 'top' || port === 'right' || port === 'bottom' || port === 'left' || port === 'auto') {
    end.port = port;
  }
  // Clamped here rather than trusted, because an anchor out of range is not a
  // recoverable value further downstream — it is a coordinate off the edge of
  // the object, and every consumer would have to guard for it separately.
  // Only accepted alongside a node id: a ratio of nothing has no meaning.
  if (end.nodeId && Number.isFinite(raw?.anchor?.u) && Number.isFinite(raw?.anchor?.v)) {
    end.anchor = {
      u: Math.min(1, Math.max(0, raw.anchor.u)),
      v: Math.min(1, Math.max(0, raw.anchor.v)),
    };
  }
  if (Number.isFinite(raw?.x)) end.x = raw.x;
  if (Number.isFinite(raw?.y)) end.y = raw.y;
  return end;
}

/**
 * True when a node is already canonical, i.e. normalizing it is a no-op.
 * Used by the migration to avoid rewriting nodes that need no change.
 */
export function isCanonical(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false;
  // The presence of any pre-v2 carrier field means it still needs mapping.
  return (
    raw.content === undefined &&
    raw.metadata === undefined &&
    raw.assetId === undefined &&
    raw.visible === undefined &&
    raw.segments === undefined &&
    raw.closed === undefined &&
    raw.appearance?.theme === undefined &&
    // `autoHeight` is the two-state ancestor of `resize`. A text node still
    // carrying it has not been through the mapping that reads it.
    raw.autoHeight === undefined &&
    typeof raw.width === 'number' &&
    typeof raw.height === 'number' &&
    typeof raw.hidden === 'boolean' &&
    typeof raw.opacity === 'number'
  );
}
