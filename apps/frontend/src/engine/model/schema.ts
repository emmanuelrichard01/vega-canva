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

/**
 * Every node type, as a value rather than only a type.
 *
 * The read boundary has to decide at *runtime* whether a `type` string off the
 * wire is one it knows, and a hand-kept second copy of this list is a silent
 * failure waiting to happen: `connector` was added to the union and missed in
 * the boundary's copy, so every connector was quietly rewritten into a shape —
 * no error, no missing node, just the wrong one. Deriving the union from the
 * array means there is one list, and adding to it is the only edit.
 */
export const NODE_TYPES = [
  'text',
  'shape',
  'sticky',
  'image',
  'audio',
  'path',
  'frame',
  'comment',
  'connector',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

/** Re-exported so a node's own type is readable without a second import. */
export type { EndCapKind } from './connectorEnds';
import type { EndCapKind } from './connectorEnds';

/**
 * Current schema revision, stamped into document metadata by the migration.
 *
 * Bumped to 3 on 2026-08-12 so `TextNode.autoHeight` is actually removed from
 * documents rather than merely ignored. The normalizer maps it to `resize` on
 * every read, so nothing breaks without the bump — but the migration is what
 * deletes the key, and it only runs when the stored version is behind. Leaving
 * a superseded field lying in the CRDT is how the next reader comes to believe
 * it means something.
 */
export const SCHEMA_VERSION = 3;

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
export type { LineProfile } from './linePath';
export type { EndAlign } from './connectorEnds';
import type { EndAlign } from './connectorEnds';
import type { LineProfile } from './linePath';
export type { ColorCycle, CycleUnit } from '../text/colorCycle';
import type { ColorCycle } from '../text/colorCycle';
import type { Paint } from './paint';

/** Connector geometry lives in `model/connector`, re-exported here so the
 *  schema still reads as one description of the document. */
export type { ConnectorEnd, Port, Routing } from './connector';
import type { ConnectorEnd, Routing } from './connector';

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

/** How hand-drawn a sketched shape is. Defined with the generator that reads it. */
export type { SketchLevel, FillStyle } from './rough';
import type { SketchLevel, FillStyle } from './rough';

export type LineCap = 'butt' | 'round' | 'square';

/**
 * How two segments of a stroke meet.
 *
 * Absent is `miter`, which is what a canvas draws by default and therefore
 * what every stroke in every existing document already is.
 */
export type LineJoin = 'miter' | 'round' | 'bevel';

/**
 * How far a miter may run past the corner before it is cut off, as a multiple
 * of the stroke width.
 *
 * A miter grows without bound as the angle between two segments closes, so at
 * a sharp enough corner it becomes a spike arbitrarily far from the shape.
 * Every renderer therefore has a limit past which the join falls back to a
 * bevel; ten is SVG's and Canvas2D's default, and the same number is used here
 * so a document that never touches the control exports unchanged.
 */
export const DEFAULT_MITER_LIMIT = 10;
export const MIN_MITER_LIMIT = 1;
export const MAX_MITER_LIMIT = 60;

/**
 * Where a stroke sits relative to the path it follows.
 *
 * Absent is `center`, which is the only thing a canvas draws natively and what
 * every stroke in every existing document already is. Inside and outside are
 * drawn by clipping a double-weight stroke to one side — see `ShapeEffects` —
 * so they need a path, which is why they are offered on shapes and not on a
 * pencil blob whose "path" is already an outline.
 */
export type StrokeAlign = 'center' | 'inside' | 'outside';

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
  /**
   * How two segments meet at a corner. Absent is `miter`.
   *
   * Only visible on a shape with corners — which, now that the join can be
   * set, is the reason it ships alongside the polygon side count rather than
   * on its own.
   */
  join?: LineJoin;
  /** Miter cutoff, as a multiple of the width. Absent is `DEFAULT_MITER_LIMIT`. */
  miterLimit?: number;
  /** Where the line sits on the path. Absent is `center`. */
  align?: StrokeAlign;
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
  /**
   * A shadow cast inward, as though the shape were a hole in the page.
   *
   * The same parameters as `shadow` and a completely different construction:
   * a drop shadow is a property Konva has, an inner shadow is a clip and an
   * inverse fill. Kept as its own field rather than a flag on `shadow`,
   * because an object can want both — a card that is raised off the page and
   * inset at its edges is an ordinary thing to draw.
   */
  innerShadow?: Shadow;
  /**
   * Gaussian blur of whatever is *behind* this object, in world units.
   *
   * Frosted glass. Distinct from `blur`, which diffuses the object itself:
   * this leaves the object sharp and softens the board through it, so it is
   * only visible paired with a fill that is not fully opaque.
   *
   * Cheaper than it sounds. Konva draws one layer in z-order, so at the moment
   * a node paints, the layer's canvas already holds everything below it and
   * nothing above — which is the definition of a backdrop. See `BackdropBlur`.
   */
  backdropBlur?: number;
  /**
   * Whether this object is drawn by hand. Absent is a crisp, ruled shape.
   *
   * Per object rather than a board-wide mode: a diagram that is *mostly* neat
   * with two things circled by hand is the case this is for, and a document
   * switch cannot express it. It lives on `appearance` because it is a fact
   * about how the shape is painted, not about what shape it is — `geometry`
   * stays the true outline, and turning it off returns the exact rectangle
   * rather than an approximation of one.
   *
   * **Three hands, not three amplitudes.** An earlier version was a single
   * number and it did not work, because scaling the displacement is the one
   * axis that cannot produce three usable looks — turn it up and the shape
   * reads as broken rather than drawn. The levels differ in *how the pen
   * behaves*: `light` is one confident pass, `medium` goes round twice (the
   * look people recognise), `heavy` goes round twice and crosses well past
   * every corner. See `PROFILES` in `engine/model/rough.ts` for what each one
   * varies and why.
   *
   * The sketch is seeded from the node id, so it is stable across renders,
   * reloads, collaborators and exports.
   */
  sketch?: SketchLevel;
  /**
   * How a sketched shape's interior is shaded. Absent is `solid`.
   *
   * Only meaningful alongside `sketch`: hachure is pen shading, and shading a
   * crisp machine-drawn rectangle with hand strokes is a mixed metaphor. The
   * panel therefore offers it only when a sketch level is set, which is also
   * why it lives here beside it rather than in the fill block.
   */
  fillStyle?: FillStyle;
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
/**
 * A case shown rather than typed.
 *
 * A presentation transform, never applied to the stored string. Rewriting the
 * text would make the control destructive — switching to upper case and back
 * would return `HELLO` rather than `Hello` — and would leave the editor
 * showing something other than what the author wrote.
 */
export type TextCase = 'none' | 'upper' | 'lower' | 'title';

/** How each paragraph in a block is marked. Absent is no list at all. */
export const LIST_STYLES = ['bullet', 'dash', 'circle', 'number', 'letter'] as const;
export type ListStyle = (typeof LIST_STYLES)[number];

/**
 * How a text box takes its size from its contents.
 *
 * - `width` grows sideways and never wraps: the box is as wide as the longest
 *   line, which is what a label wants.
 * - `height` wraps at a width you set and grows downward.
 * - `fixed` is both, and lets the text overflow.
 *
 * This replaces `TextNode.autoHeight`, which was declared, written by the
 * normalizer and the text tool, and **read by nothing** — the tenth dead field
 * this work has turned up. It could only express two of these three, which is
 * part of why nothing ever consumed it.
 */
export type TextResize = 'width' | 'height' | 'fixed';

export interface Typography {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  /**
   * Separate from `underline` rather than one `decoration` field, because
   * Canvas2D and SVG both let a run carry both at once and a single-valued
   * field would silently make them exclusive.
   */
  strikethrough: boolean;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  lineHeight: number;
  letterSpacing: number;
  color: string;
  /** Absent is `none`, which is every existing document. */
  textCase?: TextCase;
  /**
   * Bullets or numbering, applied to every paragraph in the block.
   *
   * Per-*block* rather than per-paragraph, and that is a real decision rather
   * than a shortcut. A per-paragraph list needs the list state to live in the
   * text itself — markup, or a parallel array indexed by paragraph that every
   * edit has to keep in step — and this model stores text as a plain string on
   * purpose, because that is what makes the CRDT merge sanely and the editor a
   * `<textarea>`. A sticky note or a label is a list or it is not; mixing the
   * two inside one box is a document-editor feature, not a canvas one.
   *
   * Absent is no list, which is every existing document.
   */
  list?: ListStyle;
  /**
   * A ramp of colours spread across the block, a letter or a word at a time.
   *
   * Overrides `color` while it is set, and is deliberately not merged with it:
   * "the text is this colour" and "the text runs through these colours" are
   * different statements, and a blend of the two has no meaning anyone could
   * predict. Clearing it returns the block to `color`, untouched.
   *
   * See `engine/text/colorCycle.ts` — the spread is proportional to the length
   * of the text, so editing it re-spaces the ramp rather than stranding it.
   */
  colorCycle?: ColorCycle;
  /**
   * Extra space between paragraphs only, in world units. Absent is none.
   *
   * Distinct from `lineHeight`, which is leading *within* a block of prose.
   * Raising the multiplier to separate two paragraphs opens up every line
   * inside them as well, which is why this is its own field rather than a
   * value someone is expected to fake.
   */
  paragraphSpacing?: number;
  /** The rounded ribbon painted behind the words. Absent is none. */
  highlight?: TextHighlight;
  /** A stroke around the letterforms. Absent is none. */
  outline?: TextOutline;
  /** A soft halo behind the letterforms. Absent is none. */
  glow?: TextGlow;
}

/**
 * The rounded background that breaks and clones around each wrapped line.
 *
 * The social-media treatment: every line gets its own rounded rectangle sized
 * to that line's measured advance, so the shape describes the words rather
 * than the box they happen to sit in. A single rectangle behind the whole
 * paragraph is a different, much blunter effect — it leaves a ragged line
 * floating in dead colour, which is exactly what this does not do.
 *
 * Needs per-line boxes, which is why it could not exist before
 * `engine/text/layout.ts`.
 */
export interface TextHighlight {
  color: string;
  /** Corner radius of each line's plate, in world units. */
  radius: number;
  /** Horizontal breathing room either side of the line's glyphs. */
  paddingX: number;
  /** Vertical padding, which also decides how far consecutive plates overlap. */
  paddingY: number;
  /**
   * Whether consecutive lines are welded into one ribbon with tucked corners,
   * or left as separate plates.
   *
   * `ribbon` is the treatment people recognise: where a long line is followed
   * by a short one, the corner between them curls *inward* rather than
   * stopping flat, so the block reads as one continuous shape that happens to
   * be ragged. `plates` keeps them visibly separate, which suits a caption set
   * in short even lines.
   */
  join: 'ribbon' | 'plates';
  /**
   * Let the text colour be chosen from the highlight rather than authored.
   *
   * A highlight is picked for how it looks against the board; the words then
   * have to stay legible against *it*, which is a different question and one
   * people reliably get wrong. When set, the renderer picks ink or paper by
   * contrast against `color`. See `readableInkOn`.
   */
  autoContrast?: boolean;
}

export interface TextOutline {
  color: string;
  /** Stroke weight on the letterforms, in world units. */
  width: number;
}

export interface TextGlow {
  color: string;
  /** Blur radius of the halo, in world units. */
  blur: number;
}

/**
 * The default ink for anything drawn on the board with no colour of its own.
 *
 * A **document** value, deliberately not a `--token` from `index.css`. Those
 * describe the application's chrome and resolve per viewer's theme; this is
 * content, and content cannot resolve differently per viewer — two people
 * looking at one board would see two different drawings. It is the same
 * reasoning that keeps the cursor art on fixed colours: ink sits over the
 * work, not over an app surface.
 *
 * Named because it was written out longhand at eight fallback sites across
 * three renderers, the pen tool and the SVG exporter — the "second list that
 * agrees today" shape that invariant 7 exists to catch. Authored content in
 * `templates.ts` keeps its own literals: those are a designer's choices, not
 * this default.
 */
export const DEFAULT_INK = '#1F2937';

/**
 * The ink a newly switched-on shadow is cast in.
 *
 * Black, and a **document** value for the same reason as `DEFAULT_INK`: a
 * shadow is content on the user's board, not chrome, and it cannot resolve per
 * viewer's theme or two collaborators would see two different drawings. The
 * darkness is modulated by `Shadow.opacity` rather than baked into the colour,
 * so the control that adjusts it has something to adjust.
 */
export const DEFAULT_SHADOW_COLOR = '#000000';

/**
 * The ink a connector draws in when it has no stroke colour of its own.
 *
 * A step lighter than `DEFAULT_INK`, and deliberately: on a flowchart the boxes
 * are the content and the arrows are the grammar joining them. Drawing both in
 * the same weight of black makes the connections compete with the things they
 * connect, which is why every diagramming tool greys its default edge.
 */
export const DEFAULT_CONNECTOR_INK = '#64748B';

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontFamily: 'Inter',
  fontSize: 24,
  fontWeight: 400,
  italic: false,
  underline: false,
  strikethrough: false,
  align: 'left',
  verticalAlign: 'top',
  lineHeight: 1.4,
  letterSpacing: 0,
  color: DEFAULT_INK,
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
  /**
   * Shear, in **degrees**, about the node's centre. Absent is none.
   *
   * Degrees rather than Konva's matrix coefficient, for the same reason
   * `rotation` is: it is what the control shows and what Illustrator's Shear
   * Tool asks for, and a coefficient is a renderer's private convention that
   * would silently re-interpret every document if Konva ever changed it. The
   * `tan()` that turns one into the other happens in the renderer, once.
   *
   * Kept off `scaleX`/`scaleY` and out of `geometry` deliberately: shear is a
   * property of how the node is *placed*, like rotation, not of what shape it
   * is. Baking it into geometry would make it destructive and would stop it
   * applying to text and images at all.
   */
  skewX?: number;
  skewY?: number;
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

/**
 * The primitives a shape can be.
 *
 * `polygon` replaced the separate `triangle` and `hexagon` kinds, which were
 * two hard-coded side counts where the specification asks for any of them —
 * pentagon, heptagon, octagon and up. They survive as *tool presets*: the dock
 * still offers a triangle and a hexagon, because those are the two people
 * reach for, and both now create a polygon with `sides` set. Legacy documents
 * are mapped by the normalizer, which already did exactly this for the older
 * `rectangle`/`circle`/`oval` names.
 *
 * `line` and `arrow` are open shapes, and the only two here with no interior.
 * They run corner to corner of the node's box, which keeps `width`/`height` the
 * single source of bounds — the alternative, storing two endpoints, would be a
 * second place a shape records its size.
 */
/**
 * Every shape kind, as values rather than only as a type.
 *
 * The type is derived from this list rather than written beside it, because a
 * type cannot be iterated and the things that need to *check* a kind at
 * runtime were therefore maintaining their own copies. One of them —
 * `SHAPE_KIND_ALIASES` in the normalizer — falls back to `rect` for anything
 * it does not recognise, so adding `heart` to the type gave every heart a
 * silent rewrite into a rectangle at the CRDT boundary: the tool worked, the
 * document was written, and a rectangle came back. Nothing failed.
 *
 * With the values here, a test can hold the copies against this list, which is
 * invariant 7 in the handoff and the third time this exact shape of bug has
 * been paid for.
 */
export const SHAPE_KIND_VALUES = [
  'rect',
  'ellipse',
  'polygon',
  'star',
  'heart',
  'line',
  'arrow',
] as const;

export type ShapeKind = (typeof SHAPE_KIND_VALUES)[number];

/** Shapes with no interior: no fill, no corner radius, no inside stroke. */
export const OPEN_SHAPE_KINDS: ShapeKind[] = ['line', 'arrow'];
export const isOpenShape = (kind: ShapeKind): boolean => OPEN_SHAPE_KINDS.includes(kind);

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

/**
 * The bounds a polygon's side count is clamped to.
 *
 * Two sides is a degenerate line and one is a point; past sixty a polygon is
 * indistinguishable from the ellipse primitive at any size this canvas draws,
 * and the ellipse is cheaper and smoother. Same reasoning, and the same
 * enforcement point, as the star's limits above.
 */
export const MIN_POLYGON_SIDES = 3;
export const MAX_POLYGON_SIDES = 60;

/** Arrowhead size as a multiple of the stroke weight. */
export const ARROW_HEAD_SCALE = 4;

export interface ShapeGeometry {
  kind: ShapeKind;
  /**
   * How many points a star has, or how many sides a polygon has.
   *
   * One field, because it is one number with one control: a hexagon's six and
   * a six-pointed star's six are the same quantity, and a second field named
   * `sides` beside this one would be two names for it that could disagree.
   * Clamped to `MIN_STAR_POINTS`..`MAX_STAR_POINTS` for a star and
   * `MIN_POLYGON_SIDES`..`MAX_POLYGON_SIDES` for a polygon.
   */
  points?: number;
  /**
   * Line and arrow only: the shape the run makes on its way across.
   *
   * A *profile*, not a kind — see `linePath.ts`. Absent is straight, which is
   * every line ever drawn before this existed.
   */
  lineProfile?: LineProfile;
  /** How many repeats the profile makes across the run. Absent is six. */
  lineWaves?: number;
  /**
   * Whether a marker sits inside the run's length or projects beyond it.
   *
   * Absent means **`extend` for a profiled line and `inside` for a straight
   * one**, which is not fence-sitting: the two modes exist because the right
   * answer genuinely differs. A straight line loses nothing by giving its last
   * few pixels to the head. A wave, zigzag or coil trimmed by a head loses a
   * crest or a corner at exactly the end being looked at, and a shortened
   * zigzag stops mid-stroke — which is what makes a profiled arrow look
   * broken. See `EndAlign`.
   */
  endAlign?: EndAlign;
  /**
   * Star only: inner radius as a fraction of the outer radius, clamped to
   * `MIN_STAR_RATIO`..`MAX_STAR_RATIO`. At 1 the points vanish and the shape
   * becomes a regular polygon of twice the point count, which is a legitimate
   * end of the range rather than a broken state.
   */
  innerRatio?: number;
  /**
   * What sits at each end of a line or arrow — see `EndCapKind`.
   *
   * The same six shapes a connector offers, and deliberately the same field
   * names. A line and a connector are both a run with two ends; giving one of
   * them six styles and the other a pair of booleans meant the arrow you could
   * draw depended on which tool happened to have made it, and the properties
   * panel had to grow two different controls saying the same thing.
   */
  endStart?: import('./connectorEnds').EndCapKind;
  endEnd?: import('./connectorEnds').EndCapKind;
  /**
   * How big both ends are, as a multiple of the size derived from the stroke.
   * Absent is 1 — the proportional default every existing line already draws.
   */
  endScale?: number;
  /** @deprecated Superseded by `endStart`/`endEnd`. Read at the boundary only. */
  arrowStart?: boolean;
  /** Line and arrow: a head at the end. An `arrow` is created with this set. */
  arrowEnd?: boolean;
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

/**
 * Anchor-and-handle (Pen) paths.
 *
 * Each segment describes *the curve arriving at that anchor*: `cp1` is the
 * control leaving the previous anchor, `cp2` the one arriving at this. On a
 * closed path the curve arriving at anchor 0 is the run home from the last
 * anchor, so `segments[0]`'s controls are the closing curve's — which is what
 * lets a closed path round its final join instead of always cutting straight
 * across it. See `engine/model/pathGeometry.ts`.
 */
export interface BezierGeometry {
  kind: 'bezier';
  segments: BezierSegment[];
  closed: boolean;
}

/**
 * Several closed contours filled as one shape.
 *
 * What a boolean operation produces and the only thing that can hold its
 * result: subtracting a disc from the middle of a square gives a square with a
 * hole, and a hole is a second contour — there is no single run of anchors
 * that describes it. Cutting a bar across a disc gives two disjoint pieces,
 * which needs the same thing for the opposite reason.
 *
 * Filled `evenodd`, so a contour inside another is a hole regardless of which
 * way round it was wound. The nonzero rule would give the same answer for a
 * freshly computed result — the clipper winds holes the other way — and a
 * different one the moment anybody reversed a contour by hand.
 */
export interface CompoundGeometry {
  kind: 'compound';
  subpaths: BezierGeometry[];
}

export type PathGeometry = FreehandGeometry | BezierGeometry | CompoundGeometry;

// ---------------------------------------------------------------------------
// Node variants
// ---------------------------------------------------------------------------

export interface TextNode extends BaseNode {
  type: 'text';
  text: string;
  typography: Typography;
  /** Which of the box's dimensions follow the text. See `TextResize`. */
  resize: TextResize;
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

/**
 * The sticky palette, as a value as well as a type.
 *
 * Same reasoning as `NODE_TYPES`: the read boundary has to decide at runtime
 * whether a stored theme is one it knows, and it was keeping a private copy of
 * this list to do it. Two hand-maintained lists of the same thing is how the
 * connector type came to be silently rewritten into a shape.
 */
export const STICKY_THEMES = [
  'yellow',
  'mint',
  'sky',
  'pink',
  'lavender',
  'peach',
  'white',
  'dark',
] as const;

export type StickyTheme = (typeof STICKY_THEMES)[number];

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

/**
 * A line that joins two objects.
 *
 * The one node type whose geometry is **derived rather than stored**. `from`
 * and `to` hold node ids and a side; the points are recomputed on every read
 * from wherever those objects currently are. That is what makes a flowchart
 * survive being rearranged — the arrow never knew a coordinate to forget.
 *
 * `width`/`height` on the base node are still the only source of bounds, and
 * are kept in step by the renderer, because culling, the radar and marquee
 * selection all read them and a stale box is an arrow that vanishes at the
 * edge of the viewport.
 */
export interface ConnectorNode extends BaseNode {
  type: 'connector';
  from: ConnectorEnd;
  to: ConnectorEnd;
  routing: Routing;
  appearance?: Appearance;
  /**
   * What sits at each end — see `EndCapKind`.
   *
   * The pair of booleans below is the ancestor of these, and is kept only so
   * documents authored before end styles existed still read correctly. The
   * normalizer maps them across; nothing writes them any more.
   */
  endStart?: EndCapKind;
  endEnd?: EndCapKind;
  /** How big both ends are, as a multiple of the stroke-derived size. Absent is 1. */
  endScale?: number;
  /** @deprecated Superseded by `endStart`/`endEnd`. Read at the boundary only. */
  arrowStart?: boolean;
  /** @deprecated Superseded by `endStart`/`endEnd`. Read at the boundary only. */
  arrowEnd?: boolean;
  /** A word or two riding the middle of the run — "yes", "no", "retry". */
  label?: string;
}

export type AnyNode =
  | TextNode
  | ShapeNode
  | StickyNode
  | ImageNode
  | AudioNode
  | PathNode
  | CommentNode
  | FrameNode
  | ConnectorNode;

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
