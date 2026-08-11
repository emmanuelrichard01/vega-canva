/**
 * The canonical document model.
 *
 * ## Why this file was rewritten
 *
 * The previous schema described a model nothing in the codebase actually
 * persisted. It declared `ShapeNode.geometry = { kind, width, height }` and
 * `appearance.fill: Paint[]`, while the shape tool wrote
 * `content: { shapeType, fill, width, height }`. Neither the renderer, the
 * physics layer, the exporters nor the panels could rely on either shape, so
 * every one of them read sizes through a defensive chain like:
 *
 *     obj.geometry?.width ?? obj.width ?? obj.content?.width ?? 100
 *
 * — repeated in six modules, each with slightly different precedence and
 * different fallbacks. The three files that would have caught the divergence
 * (ObjectRenderer, ShapeTool, TextTool) all carried `@ts-nocheck`.
 *
 * ## The two rules that remove the ambiguity
 *
 * 1. **`width`/`height` on the base node are the only source of bounds.**
 *    Nothing else stores a size. `geometry` describes *what shape* a node is,
 *    never how big it is.
 * 2. **`geometry` is form, `appearance` is paint.** A reader that wants to
 *    know what to draw looks at `geometry`; a reader that wants to know what
 *    colour to draw it looks at `appearance`. Nothing is stored in both.
 *
 * Legacy documents are mapped onto this shape by `engine/document/normalize`,
 * which runs at the CRDT boundary, so no consumer ever sees a legacy field.
 */

export type NodeType =
  | 'text'
  | 'shape'
  | 'sticky'
  | 'image'
  | 'audio'
  | 'path'
  | 'frame'
  | 'comment';

/** Current schema revision, stamped into document metadata by the migration. */
export const SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------

/**
 * What fills a shape.
 *
 * Solid, linear, radial, conic and diamond. Defined in `model/paint.ts`
 * alongside the arithmetic that reads it, and re-exported here so the schema
 * still reads as one description of the document.
 */
export type { GradientStop, Paint, PaintType } from './paint';
import type { Paint } from './paint';

/**
 * How a layer's pixels combine with what is already beneath them.
 *
 * The names are Canvas2D's `globalCompositeOperation` values, not CSS's, so
 * the renderer forwards the stored string without a lookup table in between —
 * the two vocabularies agree on all sixteen of these and disagree on the
 * spelling of nothing that is here.
 */
export type BlendMode =
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'darken',
  'multiply',
  'color-burn',
  'lighten',
  'screen',
  'color-dodge',
  'overlay',
  'soft-light',
  'hard-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

export type LineCap = 'butt' | 'round' | 'square';

export type Stroke = {
  color: string;
  width: number;
  /**
   * Dash pattern, in absolute units, as SVG and Canvas2D define it. Absent is
   * a solid line; an empty array is not used.
   *
   * The patterns a user can pick are derived from the stroke weight — see
   * `engine/model/strokeStyle.ts`, which owns that arithmetic and the reason
   * for it. Arbitrary arrays from an older document still render.
   */
  dash?: number[];
  /**
   * How the line terminates, including at every dash gap.
   *
   * Present because a dotted line is not a pattern on its own: `[0, gap]`
   * draws a run of round caps around nothing, and draws literally nothing with
   * the default butt cap. The cap therefore travels with the dash rather than
   * waiting for a separate control.
   */
  cap?: LineCap;
};
/**
 * A drop shadow.
 *
 * This existed on `Appearance` from the first commit, the normalizer read and
 * wrote it, and five object types declared `supportsShadow: true` — while no
 * renderer ever looked at it. Every shadow visible on the canvas was a
 * hardcoded constant on the frame, the sticky and the comment pin. It is now
 * real.
 *
 * `spread` is the piece Konva has no equivalent for: it grows the shadow's
 * silhouette before the blur, which is what makes a shadow read as a shape
 * sitting above the page rather than as a smudge behind it.
 *
 * Deliberately one shadow rather than a list. Several at once is a genuinely
 * useful thing that Figma offers, but it needs an effects *list* in the panel
 * and one draw pass per shadow — Konva paints one shadow per shape — and that
 * is a larger change than making the field work at all.
 */
export type Shadow = {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
  /** Outset of the shadow's silhouette, in world units, before the blur. */
  spread?: number;
  /** 0..1, applied on top of any alpha in `color`. Absent is fully opaque. */
  opacity?: number;
};
export type Point = { x: number; y: number };

export interface Appearance {
  fill?: Paint[];
  stroke?: Stroke;
  shadow?: Shadow;
  /** Applies to rectangles and images. */
  cornerRadius?: number;
  /**
   * How this layer's pixels combine with what is beneath. Absent is `normal`.
   *
   * Stored on `appearance` rather than the base node because it is a property
   * of the paint — what the object *looks like* against its background —
   * rather than of the object's place on the board, which is what opacity and
   * z-index are.
   */
  blendMode?: BlendMode;
  /**
   * Gaussian blur applied to the whole layer, in world units. Absent is none.
   *
   * A layer blur, not a shadow blur: it diffuses the object itself. Konva
   * cannot filter an uncached node, so anything above zero puts the object on
   * its own bitmap — see `useLayerFilters`, which owns that lifecycle.
   */
  blur?: number;
}

export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/**
 * Text styling.
 *
 * `fontWeight` and `italic`/`underline` are kept as separate, orthogonal
 * fields rather than folded into a single CSS-ish `fontStyle` string. Konva
 * *does* want them combined ("bold italic"), and conflating the two is
 * precisely how the Bold control ended up doing nothing: the panel wrote
 * `fontWeight: 700` while the renderer forwarded only `fontStyle`. Composing
 * Konva's string is the renderer's job, done in exactly one place.
 */
export interface Typography {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  lineHeight: number;
  letterSpacing: number;
  color: string;
}

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontFamily: 'Inter',
  fontSize: 24,
  fontWeight: 400,
  italic: false,
  underline: false,
  align: 'left',
  verticalAlign: 'top',
  lineHeight: 1.4,
  letterSpacing: 0,
  color: '#1F2937',
};

/** Denormalised creator identity, so authorship survives the author leaving. */
export interface Author {
  id: string;
  name: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Base node
// ---------------------------------------------------------------------------

export interface BaseNode {
  id: string;
  type: NodeType;

  /** Top-left corner in world space. */
  x: number;
  y: number;
  /** Unrotated, unscaled size. The single source of truth for bounds. */
  width: number;
  height: number;

  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;

  zIndex: number;
  /** Shared synthetic id linking the members of a group. */
  parentId?: string;
  /**
   * The frame this node sits inside, by node id.
   *
   * **Deliberately not `parentId`.** That is a *synthetic* id shared by the
   * members of a group and belonging to no node at all, and the two answer
   * different questions: everything sharing a `parentId` is selected together
   * as one group, which is emphatically not what should happen when you click
   * one object inside a frame. Overloading it would also make the Layers
   * panel render a frame's contents as an anonymous group cluster.
   *
   * An object can therefore be in a group *and* in a frame, which is correct —
   * they are independent facts about it.
   */
  frameId?: string;

  locked: boolean;
  /** Renderer and Layers panel both gate on this. There is no `visible` field. */
  hidden: boolean;
  /**
   * How this object behaves under force — 'feather' | 'paper' | 'rubber' |
   * 'wood' | 'stone', from `utils/behaviorSystem`.
   *
   * Optional because behaviour used to be implied entirely by `type`. Absent
   * means "whatever this type defaults to", so existing documents keep the
   * behaviour they already had.
   */
  material?: string;
  /** User-supplied name shown in the Layers panel, if renamed. */
  title?: string;

  createdBy: string;
  createdByName?: string;
  createdByColor?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Geometry variants
// ---------------------------------------------------------------------------

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'hexagon' | 'star';

/**
 * The bounds a star's parameters are clamped to at the CRDT boundary.
 *
 * These live on the schema rather than in the panel because the normalizer
 * enforces them and the control has to agree — a control offering a value the
 * boundary silently rewrites is a control that appears broken. Both ends
 * import these.
 *
 * Two points draw a pair of crossed spikes and a zero inner radius draws lines
 * to the centre; both are degenerate rather than merely ugly, and neither is
 * recoverable from the control once it is stored. Past 60 points a star reads
 * as a disc at any size this canvas draws.
 */
export const MIN_STAR_POINTS = 3;
export const MAX_STAR_POINTS = 60;
export const MIN_STAR_RATIO = 0.05;
export const MAX_STAR_RATIO = 1;

export interface ShapeGeometry {
  kind: ShapeKind;
  /** Star only. Clamped to `MIN_STAR_POINTS`..`MAX_STAR_POINTS`. */
  points?: number;
  /**
   * Star only: inner radius as a fraction of the outer radius, clamped to
   * `MIN_STAR_RATIO`..`MAX_STAR_RATIO`. At 1 the points vanish and the shape
   * becomes a regular polygon of twice the point count, which is a legitimate
   * end of the range rather than a broken state.
   */
  innerRatio?: number;
}

export interface BezierSegment {
  x: number;
  y: number;
  cp1x?: number;
  cp1y?: number;
  cp2x?: number;
  cp2y?: number;
}

/** Freehand (Pencil) strokes: a filled outline plus the centreline that produced it. */
export interface FreehandGeometry {
  kind: 'freehand';
  /** Outline path, relative to the node origin. */
  svgPath: string;
  /** Centreline, relative to the node origin — what the Eraser splits on. */
  points: Point[];
  strokeSize: number;
}

/** Anchor-and-handle (Pen) paths. */
export interface BezierGeometry {
  kind: 'bezier';
  segments: BezierSegment[];
  closed: boolean;
}

export type PathGeometry = FreehandGeometry | BezierGeometry;

// ---------------------------------------------------------------------------
// Node variants
// ---------------------------------------------------------------------------

export interface TextNode extends BaseNode {
  type: 'text';
  text: string;
  typography: Typography;
  /** Height tracks the content rather than being set explicitly. */
  autoHeight: boolean;
  /**
   * Paint that is not the glyph colour: shadow, blend mode, layer blur.
   *
   * Text was the one type declaring `supportsShadow` with nowhere to put a
   * shadow — it had no `appearance` at all — so the capability was a promise
   * the schema could not keep. The letterforms' own colour stays in
   * `typography.color`, where the text tools already look for it; `appearance`
   * here is the same block every other visible type carries, so blend mode and
   * layer blur reach a text node for free.
   */
  appearance?: Appearance;
}

export interface ShapeNode extends BaseNode {
  type: 'shape';
  geometry: ShapeGeometry;
  appearance: Appearance;
  /** Optional centered label (double-click to edit). */
  text?: string;
  typography?: Typography;
}

export type StickyTheme =
  | 'yellow'
  | 'mint'
  | 'sky'
  | 'pink'
  | 'lavender'
  | 'peach'
  | 'white'
  | 'dark';

export interface StickyNode extends BaseNode {
  type: 'sticky';
  text: string;
  /** Closed set of presets — a sticky has no free fill colour. */
  theme: StickyTheme;
  /** Stickies render in a fixed handwriting face; only the size is variable. */
  fontSize: number;
  author: Author;
  /**
   * Emoji → the author ids who reacted with it.
   *
   * A list, not a count. A bare `Record<emoji, number>` incremented on click
   * cannot express the three things a reaction is actually for: it let one
   * person react five times, gave no way to take a reaction back except a
   * "clear" button that wiped everyone's, and recorded nobody. It also **lost
   * reactions** — two people reacting at the same moment each read the same
   * count and each wrote count + 1, so one of them silently vanished, which is
   * precisely the case a collaborative canvas exists to handle.
   */
  reactions: Record<string, string[]>;
  tags: string[];
  pinned: boolean;
}

export interface ImageNode extends BaseNode {
  type: 'image';
  /** Resolved URL of the stored asset. */
  src: string;
  naturalWidth?: number;
  naturalHeight?: number;
  appearance: Appearance;
  crop?: { x: number; y: number; width: number; height: number };
  /**
   * Non-destructive adjustments, each **-100..100 with 0 meaning untouched**
   * (blur has no negative half). Absent means nothing has been adjusted, and
   * an adjustment returned to 0 is removed rather than stored as 0 — see
   * `engine/model/imageAdjustments.ts`, which owns these units and is the only
   * thing that knows what Konva's filters want instead.
   *
   * Deliberately *not* Konva's own scales. Its filters disagree with each
   * other — `Brighten` takes ±1, `Contrast` takes ±100, `HSL` takes a power of
   * two — and storing a renderer's private conventions in the CRDT would mean
   * a Konva range change silently re-interpreting every document ever written.
   */
  filters?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    blur?: number;
  };
}

export interface AudioNode extends BaseNode {
  type: 'audio';
  src: string;
  durationMs: number;
  /** Precomputed peaks, 0..1. */
  waveform: number[];
  transcript?: string;
  author: Author;
}

export interface PathNode extends BaseNode {
  type: 'path';
  geometry: PathGeometry;
  appearance: Appearance;
}

export interface CommentNode extends BaseNode {
  type: 'comment';
  text: string;
  author: Author;
  resolved: boolean;
}

export interface FrameNode extends BaseNode {
  type: 'frame';
  appearance: Appearance;
  /**
   * Insets from the four edges marking where content is guaranteed to survive.
   *
   * Seeded from the preset the frame was made with and editable afterwards.
   * Purely a guide: it is drawn as interface, never exported, and nothing
   * clips or snaps to it. A frame that promises a safe area and then quietly
   * moved things into it would be worse than no guide at all.
   */
  safeArea?: { top: number; right: number; bottom: number; left: number };
  layout?: {
    direction: 'horizontal' | 'vertical';
    padding: number;
    gap: number;
  };
}

export type AnyNode =
  | TextNode
  | ShapeNode
  | StickyNode
  | ImageNode
  | AudioNode
  | PathNode
  | CommentNode
  | FrameNode;

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

export const isText = (n: AnyNode): n is TextNode => n.type === 'text';
export const isShape = (n: AnyNode): n is ShapeNode => n.type === 'shape';
export const isSticky = (n: AnyNode): n is StickyNode => n.type === 'sticky';
export const isImage = (n: AnyNode): n is ImageNode => n.type === 'image';
export const isAudio = (n: AnyNode): n is AudioNode => n.type === 'audio';
export const isPath = (n: AnyNode): n is PathNode => n.type === 'path';
export const isComment = (n: AnyNode): n is CommentNode => n.type === 'comment';
export const isFrame = (n: AnyNode): n is FrameNode => n.type === 'frame';

/**
 * Nodes carrying editable text, and the field it lives in.
 *
 * Every text-bearing type stores it as a top-level `text` string. The old
 * model had it in `content.text` for some types, a top-level `text` for
 * others, and *both* for stickies — where the renderer read one and the
 * editor wrote the other, so a sticky rendered blank the moment it was edited.
 */
export type TextBearingNode = TextNode | ShapeNode | StickyNode | CommentNode;

export const hasText = (n: AnyNode): n is TextBearingNode =>
  n.type === 'text' || n.type === 'shape' || n.type === 'sticky' || n.type === 'comment';
