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

export type Paint = { type: 'solid'; color: string; opacity?: number };
export type Stroke = { color: string; width: number; dash?: number[] };
export type Shadow = { color: string; blur: number; offsetX: number; offsetY: number };
export type Point = { x: number; y: number };

export interface Appearance {
  fill?: Paint[];
  stroke?: Stroke;
  shadow?: Shadow;
  /** Applies to rectangles and images. */
  cornerRadius?: number;
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

  locked: boolean;
  /** Renderer and Layers panel both gate on this. There is no `visible` field. */
  hidden: boolean;
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

export interface ShapeGeometry {
  kind: ShapeKind;
  /** Star only. */
  points?: number;
  /** Star only: inner radius as a fraction of the outer radius. */
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
  /** Emoji -> count. */
  reactions: Record<string, number>;
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
  filters?: { brightness?: number; contrast?: number; blur?: number };
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
