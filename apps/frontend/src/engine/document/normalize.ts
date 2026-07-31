import {
  DEFAULT_TYPOGRAPHY,
  MAX_STAR_POINTS,
  MAX_STAR_RATIO,
  MIN_STAR_POINTS,
  MIN_STAR_RATIO,
  type AnyNode,
  type Appearance,
  type Author,
  type LineCap,
  type NodeType,
  type Paint,
  type PathGeometry,
  type Point,
  type ShapeGeometry,
  type ShapeKind,
  type StickyTheme,
  type Stroke,
  type TextAlign,
  type Typography,
} from '../model/schema';

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

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const str = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** Legacy shape names that no longer exist as distinct kinds. */
const SHAPE_KIND_ALIASES: Record<string, ShapeKind> = {
  rect: 'rect',
  rectangle: 'rect',
  square: 'rect',
  circle: 'ellipse',
  ellipse: 'ellipse',
  oval: 'ellipse',
  triangle: 'triangle',
  polygon: 'triangle', // The old "polygon" tool always drew a 3-sided RegularPolygon.
  hexagon: 'hexagon',
  star: 'star',
};

const STICKY_THEMES: StickyTheme[] = [
  'yellow',
  'mint',
  'sky',
  'pink',
  'lavender',
  'peach',
  'white',
  'dark',
];

function toPaintArray(value: unknown, legacyColor: unknown): Paint[] | undefined {
  if (Array.isArray(value)) {
    const paints = value
      .map((entry): Paint | null => {
        if (typeof entry === 'string') return { type: 'solid', color: entry };
        if (entry && typeof entry === 'object' && typeof (entry as any).color === 'string') {
          return {
            type: 'solid',
            color: (entry as any).color,
            opacity: typeof (entry as any).opacity === 'number' ? (entry as any).opacity : undefined,
          };
        }
        return null;
      })
      .filter((p): p is Paint => p !== null);
    if (paints.length) return paints;
  }
  // Pre-v2 shapes stored a bare hex string in `content.fill`.
  if (typeof legacyColor === 'string' && legacyColor) {
    return [{ type: 'solid', color: legacyColor }];
  }
  return undefined;
}

const LINE_CAPS = new Set<LineCap>(['butt', 'round', 'square']);

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

  if (source.shadow && typeof source.shadow === 'object') {
    appearance.shadow = {
      color: str(source.shadow.color, 'rgba(0,0,0,0.2)'),
      blur: num(source.shadow.blur, 8),
      offsetX: num(source.shadow.offsetX, 0),
      offsetY: num(source.shadow.offsetY, 2),
    };
  }

  // cornerRadius lived on geometry for shapes and content for images.
  const radius = source.cornerRadius ?? raw?.geometry?.cornerRadius ?? legacy.cornerRadius;
  if (typeof radius === 'number' && Number.isFinite(radius)) {
    appearance.cornerRadius = Math.max(0, radius);
  }

  return appearance;
}

function normalizeAlign(value: unknown, fallback: TextAlign): TextAlign {
  return value === 'left' || value === 'center' || value === 'right' ? value : fallback;
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
    fontSize: num(t.fontSize ?? c.fontSize, overrides.fontSize ?? DEFAULT_TYPOGRAPHY.fontSize),
    fontWeight:
      typeof legacyWeight === 'number'
        ? legacyWeight
        : legacyStyle.includes('bold')
          ? 700
          : overrides.fontWeight ?? DEFAULT_TYPOGRAPHY.fontWeight,
    italic: bool(t.italic, legacyStyle.includes('italic')),
    underline: bool(t.underline, str(c.textDecoration, '') === 'underline'),
    align: normalizeAlign(
      t.align ?? c.textAlign ?? c.align,
      overrides.align ?? DEFAULT_TYPOGRAPHY.align
    ),
    verticalAlign:
      t.verticalAlign === 'top' || t.verticalAlign === 'middle' || t.verticalAlign === 'bottom'
        ? t.verticalAlign
        : overrides.verticalAlign ?? DEFAULT_TYPOGRAPHY.verticalAlign,
    lineHeight: num(t.lineHeight ?? c.lineHeight, overrides.lineHeight ?? DEFAULT_TYPOGRAPHY.lineHeight),
    letterSpacing: num(
      t.letterSpacing ?? c.letterSpacing,
      overrides.letterSpacing ?? DEFAULT_TYPOGRAPHY.letterSpacing
    ),
    color: str(t.color ?? c.color, overrides.color ?? DEFAULT_TYPOGRAPHY.color),
  };
}

function normalizeAuthor(raw: any): Author {
  const meta = raw?.metadata ?? {};
  const author = raw?.author ?? {};
  return {
    id: str(author.id ?? meta.authorId ?? raw?.createdBy, 'unknown'),
    name: str(author.name ?? meta.authorName ?? raw?.createdByName, 'Unknown'),
    color: str(author.color ?? meta.authorColor ?? raw?.createdByColor, '#3B82F6'),
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
  const kind = SHAPE_KIND_ALIASES[rawKind] ?? 'rect';
  const geometry: ShapeGeometry = { kind };
  if (kind === 'star') {
    // Clamped at the boundary, like every other value that reaches a renderer.
    // Konva draws a "star" with two points as a pair of crossed spikes and one
    // with zero inner radius as a set of lines to the centre — both are
    // degenerate rather than merely ugly, and neither is recoverable from the
    // control once stored. 60 is past the point where more points read as a
    // disc at any size this canvas draws.
    geometry.points = Math.round(clamp(num(raw?.geometry?.points, 5), MIN_STAR_POINTS, MAX_STAR_POINTS));
    geometry.innerRatio = clamp(num(raw?.geometry?.innerRatio, 0.5), MIN_STAR_RATIO, MAX_STAR_RATIO);
  }
  return geometry;
}

function normalizePathGeometry(raw: any): PathGeometry {
  // Bezier paths stored `segments`/`closed` at the top level; freehand
  // strokes stored `content.svgPath`/`content.points`/`content.strokeSize`.
  const segments = raw?.geometry?.segments ?? raw?.segments;
  if (Array.isArray(segments) && segments.length > 0) {
    return {
      kind: 'bezier',
      segments: segments.map((s: any) => ({
        x: num(s?.x, 0),
        y: num(s?.y, 0),
        cp1x: typeof s?.cp1x === 'number' ? s.cp1x : undefined,
        cp1y: typeof s?.cp1y === 'number' ? s.cp1y : undefined,
        cp2x: typeof s?.cp2x === 'number' ? s.cp2x : undefined,
        cp2y: typeof s?.cp2y === 'number' ? s.cp2y : undefined,
      })),
      closed: bool(raw?.geometry?.closed ?? raw?.closed, false),
    };
  }

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
  const known: NodeType[] = ['text', 'shape', 'sticky', 'image', 'audio', 'path', 'frame', 'comment'];
  return (known as string[]).includes(t) ? (t as NodeType) : 'shape';
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
    opacity: num(raw?.opacity, 1),
    zIndex: num(raw?.zIndex, 0),
    parentId: typeof raw?.parentId === 'string' ? raw.parentId : undefined,
    locked: bool(raw?.locked, false),
    // Pre-v2 tools wrote `visible: true`, which nothing read; the renderer and
    // Layers panel have always gated on `hidden`.
    hidden: bool(raw?.hidden, raw?.visible === false),
    title: typeof raw?.title === 'string' ? raw.title : undefined,
    // Absent means "this type's default material", so documents written before
    // materials existed keep behaving exactly as they did.
    material: typeof raw?.material === 'string' ? raw.material : undefined,
    createdBy: str(raw?.createdBy, 'unknown'),
    createdByName: typeof raw?.createdByName === 'string' ? raw.createdByName : raw?.metadata?.authorName,
    createdByColor:
      typeof raw?.createdByColor === 'string' ? raw.createdByColor : raw?.metadata?.authorColor,
    createdAt: num(raw?.createdAt, now),
    updatedAt: num(raw?.updatedAt, num(raw?.createdAt, now)),
  };

  switch (type) {
    case 'text':
      return {
        ...base,
        type: 'text',
        text: normalizeText(raw),
        typography: normalizeTypography(raw),
        autoHeight: bool(raw?.autoHeight, true),
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
      return {
        ...base,
        type: 'sticky',
        text: normalizeText(raw),
        theme: STICKY_THEMES.includes(theme) ? theme : 'yellow',
        fontSize: num(raw?.fontSize ?? raw?.content?.fontSize, 16),
        author: normalizeAuthor(raw),
        reactions: normalizeReactions(raw?.reactions ?? raw?.metadata?.reactions),
        tags: Array.isArray(raw?.tags) ? raw.tags : Array.isArray(raw?.metadata?.tags) ? raw.metadata.tags : [],
        pinned: bool(raw?.pinned, bool(raw?.metadata?.pinned, false)),
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
        filters: raw?.filters,
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

    case 'frame':
    default:
      return {
        ...base,
        type: 'frame',
        appearance: normalizeAppearance(raw),
        layout: raw?.layout,
      };
  }
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
    typeof raw.width === 'number' &&
    typeof raw.height === 'number' &&
    typeof raw.hidden === 'boolean' &&
    typeof raw.opacity === 'number'
  );
}
