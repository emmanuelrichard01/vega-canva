import type { AnyNode } from '../model/schema';

/**
 * What a selection affords, worked out from the selection itself.
 *
 * ## The problem this replaces
 *
 * Every surface that reacts to a selection — the context toolbar, the
 * properties panel, the right-click menu — decided what to show with its own
 * inline predicates: `bulkNodes.every((n) => FILLABLE_TYPES.has(n.type))` here,
 * a hand-kept type list there, a `hasConnector` flag somewhere else. Three
 * places answering the same question, none of them able to agree by
 * construction, and each only as clever as whoever last edited it.
 *
 * The visible cost was that a selection with an obvious subject got generic
 * controls. Select five connectors and the toolbar offered group, align,
 * opacity — because nobody had written a "these are all connectors" branch for
 * the multi-select rail, even though routing, end caps and sketch are the only
 * reasons anyone selects five connectors at once.
 *
 * ## The rule
 *
 * A selection is not a bag of nodes, it is a *statement about intent*, and the
 * strongest signal in it is *homogeneity*. When every node is the same type the
 * selection has a subject, and that type's own controls are the answer to "why
 * did I select these" — they should lead. When the types are mixed there is no
 * subject, only an intersection: what they all support, and nothing more.
 *
 * So this computes the facts once, asks each affordance whether it applies, and
 * returns them **ranked**. Every surface renders the same answer, in the same
 * order, at whatever length it has room for.
 *
 * Pure, so the thing that decides what a person is offered can be asserted
 * rather than clicked through.
 */

export type AffordanceId =
  // Type-specific: the ones that make a homogeneous selection worth having.
  | 'routing'
  | 'ends'
  | 'line-profile'
  | 'line-vertices'
  | 'corner-radius'
  | 'typography'
  | 'crop'
  | 'image-adjust'
  | 'sticky-theme'
  | 'frame-preset'
  | 'audio'
  // Shared paint, offered whenever every member has it.
  | 'fill'
  | 'stroke'
  | 'sketch'
  | 'opacity'
  | 'effects'
  // Structure, which is about the set rather than about the type.
  | 'group'
  | 'ungroup'
  | 'break-apart'
  | 'grid-fill'
  | 'grid-slot'
  | 'boolean'
  | 'to-path'
  | 'align'
  | 'distribute'
  | 'order'
  | 'lock'
  | 'visibility'
  | 'physics'
  | 'delete';

/** Where an affordance is allowed to appear. */
export type Surface = 'toolbar' | 'panel' | 'menu';

export interface Affordance {
  id: AffordanceId;
  label: string;
  /**
   * Ranking. Higher leads.
   *
   * Not a hand-assigned number per entry so much as three bands: what this
   * selection *is* (type-specific), how it is *painted* (shared), and what can
   * be *done to the set* (structure). Within a band the order is the order
   * someone reads them in.
   */
  weight: number;
  surfaces: readonly Surface[];
}

/** Everything the predicates need, computed once rather than per affordance. */
export interface SelectionFacts {
  count: number;
  /** Distinct node types present. */
  types: ReadonlySet<string>;
  /** The single type, when there is one. This is the homogeneity signal. */
  uniformType: string | null;
  /** Every member shares one `parentId`, and nothing outside the set has it. */
  isWholeGroup: boolean;
  /** At least one member is not in any group. */
  hasUngrouped: boolean;
  /** Shape kinds present, when the selection is shapes. */
  shapeKinds: ReadonlySet<string>;
  /** Path kinds present. Freehand, pen and boolean paths afford different things. */
  pathKinds: ReadonlySet<string>;
  /**
   * At least one line in the selection has corners or curves of its own.
   *
   * Which changes what a line affords: a profile — wavy, zigzag, coil — is
   * defined along *one* run from A to B, and a run of corners has several. See
   * `model/polyline.ts` for why that is a real exclusion rather than an
   * unfinished feature. Offering the control anyway and having the renderer
   * ignore it is the failure this file was written to stop.
   */
  hasMultiPointLine: boolean;
  /**
   * How many grids are in the selection, and how many pictures.
   *
   * Counts rather than a `types` lookup, because the rule that needs them —
   * placing pictures into a grid's modules — is only meaningful for **exactly
   * one** grid. `types` is a set, so it can say a grid is present and cannot
   * say there is one; offering the command for two grids would mean either
   * picking one arbitrarily or doing nothing, which is a menu entry that lies.
   */
  gridCount: number;
  imageCount: number;
  /** Every member sits in a grid module. The framing controls only mean anything then. */
  allSlotted: boolean;
  /** How many of those are pictures, which are the only ones with a source to pan. */
  slottedImages: number;
  locked: boolean;
}

const PAINTABLE = new Set(['shape', 'path', 'text', 'sticky', 'image', 'frame', 'connector']);
const FILLABLE = new Set(['shape', 'path', 'frame']);
/**
 * Sketchable includes `path`, but only freehand ones — see the rule below.
 *
 * The set alone cannot say that, which is exactly why the rule carries the
 * extra clause rather than the set carrying a lie.
 */
const SKETCHABLE = new Set(['shape', 'connector', 'path', 'sticky']);
const VECTORIZABLE = new Set(['shape', 'path']);
const TEXTUAL = new Set(['text', 'sticky', 'shape']);

/** Every fact the rules below read, derived from the nodes in one pass. */
export function selectionFacts(
  nodes: readonly AnyNode[],
  allObjects: Readonly<Record<string, AnyNode>> = {}
): SelectionFacts {
  const types = new Set<string>();
  const shapeKinds = new Set<string>();
  const pathKinds = new Set<string>();
  let hasUngrouped = false;
  let locked = nodes.length > 0;
  let hasMultiPointLine = false;
  let gridCount = 0;
  let imageCount = 0;
  let slottedCount = 0;
  let slottedImages = 0;

  for (const n of nodes) {
    types.add(n.type);
    if (n.type === 'grid') gridCount += 1;
    if (n.type === 'image') imageCount += 1;
    const slot = (n as { gridSlot?: unknown }).gridSlot;
    if (slot) {
      slottedCount += 1;
      if (n.type === 'image') slottedImages += 1;
    }
    if (!n.parentId) hasUngrouped = true;
    if (!n.locked) locked = false;
    const kind = (n as { geometry?: { kind?: string } }).geometry?.kind;
    if (n.type === 'shape' && kind) shapeKinds.add(kind);
    if (n.type === 'path' && kind) pathKinds.add(kind);
    if (n.type === 'shape' && (kind === 'line' || kind === 'arrow')) {
      const geometry = (n as {
        geometry?: { vertices?: unknown[]; bends?: unknown[]; smooth?: boolean };
      }).geometry;
      if ((geometry?.vertices?.length ?? 0) > 2) hasMultiPointLine = true;
      if (geometry?.bends?.some?.((bend) => bend != null)) hasMultiPointLine = true;
      if (geometry?.smooth === true) hasMultiPointLine = true;
    }
  }

  /**
   * A group is "whole" only when nothing outside the selection belongs to it.
   *
   * Offering Ungroup for half a group would silently dissolve the other half
   * too, which is a destructive answer to a question nobody asked.
   */
  const parent = nodes[0]?.parentId;
  const isWholeGroup =
    Boolean(parent) &&
    nodes.every((n) => n.parentId === parent) &&
    Object.values(allObjects).every((o) => o.parentId !== parent || nodes.some((n) => n.id === o.id));

  return {
    count: nodes.length,
    types,
    uniformType: types.size === 1 ? [...types][0] : null,
    isWholeGroup,
    hasUngrouped,
    shapeKinds,
    pathKinds,
    hasMultiPointLine,
    gridCount,
    imageCount,
    allSlotted: nodes.length > 0 && slottedCount === nodes.length,
    slottedImages,
    locked,
  };
}

/** True when every selected node's type is in `set`. */
const all = (facts: SelectionFacts, set: ReadonlySet<string>) =>
  facts.count > 0 && [...facts.types].every((t) => set.has(t));

/**
 * The rules, in one table.
 *
 * Ordering is by weight, and the three bands are deliberate:
 *
 *   90+  what the selection *is* — only ever unlocked by a uniform type
 *   50+  how it is painted — the intersection across whatever is selected
 *   10+  what can be done to the set — true of almost any selection
 *
 * A surface with room for four controls therefore shows the four most specific
 * things available, which for five connectors is routing, ends, profile and
 * sketch, and for a mixed bag is fill, opacity, align, group.
 */
const RULES: readonly (Affordance & { when: (f: SelectionFacts) => boolean })[] = [
  // ---------------------------------------------------------------- the type
  {
    id: 'routing', label: 'Routing', weight: 99, surfaces: ['toolbar', 'panel'],
    when: (f) => f.uniformType === 'connector',
  },
  {
    id: 'ends', label: 'Ends', weight: 98, surfaces: ['toolbar', 'panel'],
    when: (f) =>
      f.uniformType === 'connector' ||
      (f.uniformType === 'shape' && [...f.shapeKinds].every((k) => k === 'line' || k === 'arrow')),
  },
  {
    id: 'line-profile', label: 'Profile', weight: 97, surfaces: ['toolbar', 'panel'],
    when: (f) =>
      f.uniformType === 'shape' &&
      f.shapeKinds.size > 0 &&
      [...f.shapeKinds].every((k) => k === 'line' || k === 'arrow') &&
      // A run of corners takes its shape from its vertices and bends. See
      // `hasMultiPointLine`.
      !f.hasMultiPointLine,
  },
  {
    /**
     * The vertex editor, as a command rather than a gesture people have to know.
     *
     * Double-click and Ctrl+Enter both open it, and both are invisible. A line
     * that can be reshaped and gives no sign of it is a line most people will
     * redraw instead — which is what the old two-point tool trained everyone to
     * do.
     */
    id: 'line-vertices', label: 'Edit points', weight: 96, surfaces: ['toolbar', 'menu'],
    when: (f) =>
      f.count === 1 &&
      f.uniformType === 'shape' &&
      [...f.shapeKinds].every((k) => k === 'line' || k === 'arrow') &&
      f.shapeKinds.size > 0 &&
      !f.locked,
  },
  {
    id: 'typography', label: 'Type', weight: 96, surfaces: ['toolbar', 'panel'],
    when: (f) => f.uniformType !== null && TEXTUAL.has(f.uniformType),
  },
  {
    id: 'corner-radius', label: 'Corners', weight: 95, surfaces: ['toolbar', 'panel'],
    when: (f) =>
      f.uniformType === 'shape' &&
      f.shapeKinds.size > 0 &&
      [...f.shapeKinds].every((k) => k === 'rect'),
  },
  {
    id: 'crop', label: 'Crop', weight: 94, surfaces: ['toolbar'],
    // One image: cropping several at once has no single frame to drag.
    //
    // Toolbar only. Crop is a *mode* the canvas enters, with its own overlay
    // and its own commit, and only the canvas can start it — a menu item that
    // named it without being able to run it would be the resolver promising
    // something no surface delivers, which is the failure this file exists to
    // prevent.
    when: (f) => f.uniformType === 'image' && f.count === 1,
  },
  {
    id: 'image-adjust', label: 'Adjust', weight: 93, surfaces: ['toolbar', 'panel'],
    when: (f) => f.uniformType === 'image',
  },
  {
    id: 'sticky-theme', label: 'Colour', weight: 92, surfaces: ['toolbar', 'panel'],
    when: (f) => f.uniformType === 'sticky',
  },
  {
    id: 'frame-preset', label: 'Size', weight: 91, surfaces: ['toolbar', 'panel'],
    when: (f) => f.uniformType === 'frame',
  },
  {
    id: 'audio', label: 'Playback', weight: 90, surfaces: ['toolbar'],
    when: (f) => f.uniformType === 'audio',
  },

  // --------------------------------------------------------------- the paint
  {
    id: 'fill', label: 'Fill', weight: 59, surfaces: ['toolbar', 'panel'],
    when: (f) => all(f, FILLABLE),
  },
  {
    id: 'stroke', label: 'Stroke', weight: 58, surfaces: ['toolbar', 'panel'],
    when: (f) => all(f, PAINTABLE),
  },
  {
    id: 'sketch', label: 'Sketch', weight: 57, surfaces: ['toolbar', 'panel'],
    /**
     * Shapes and connectors mixed is the point: a flowchart is boxes and the
     * arrows joining them, and sketching both in one gesture is the reason.
     *
     * Freehand paths belong here and the first version of this rule left them
     * out — the properties panel already included them, which is precisely the
     * drift this resolver exists to end, and the panel was the one that had it
     * right. A pencil stroke looks hand-drawn but `perfect-freehand` renders it
     * as a smooth tapered ribbon; sketching redraws it from its centreline as a
     * run gone over twice, which is a different way to draw rather than a
     * filter over the first.
     *
     * Pen and boolean paths stay out. Their renderer strokes a curve and has no
     * centreline to go over, so the control would promise nothing.
     */
    when: (f) =>
      all(f, SKETCHABLE) &&
      (!f.types.has('path') || [...f.pathKinds].every((k) => k === 'freehand')),
  },
  {
    id: 'opacity', label: 'Opacity', weight: 56, surfaces: ['toolbar', 'panel'],
    when: (f) => f.count > 0,
  },
  {
    id: 'effects', label: 'Effects', weight: 55, surfaces: ['panel'],
    when: (f) => all(f, PAINTABLE),
  },

  // ----------------------------------------------------------- the structure
  {
    // Toolbar only: each of the four boolean ops is its own button, and one
    // menu item cannot ask which.
    id: 'boolean', label: 'Combine', weight: 19, surfaces: ['toolbar'],
    when: (f) => f.count > 1 && all(f, VECTORIZABLE),
  },
  {
    id: 'group', label: 'Group', weight: 18, surfaces: ['toolbar', 'menu'],
    when: (f) => f.count > 1 && !f.isWholeGroup,
  },
  {
    id: 'ungroup', label: 'Ungroup', weight: 18, surfaces: ['toolbar', 'menu'],
    when: (f) => f.isWholeGroup,
  },
  {
    /**
     * The way out of a generator.
     *
     * Sits at Ungroup's weight because it is the same gesture from the reader's
     * side -- "give me the pieces" -- and the two can never both apply, so they
     * never compete for the slot. It is what makes a grid being one object a
     * trade rather than a restriction: the moment you want to nudge one module
     * or recolour three, you convert, and from then on they are ordinary shapes.
     */
    id: 'break-apart', label: 'Break apart', weight: 18, surfaces: ['toolbar', 'menu'],
    when: (f) => f.uniformType === 'grid' && f.count === 1,
  },
  {
    /**
     * Drop a set of pictures into a grid's modules.
     *
     * Weighted above `break-apart` because it is the constructive thing you do
     * *to* a grid and break-apart is the one that ends it, and because a
     * selection holding both a grid and pictures has said quite specifically
     * what it is for.
     *
     * Exactly one grid and at least one picture, and nothing else: a mixed
     * selection carrying a sticky and a connector as well has not said that at
     * all, and quietly ignoring the parts it cannot use is how a command
     * becomes something you have to test before you trust.
     */
    /**
     * What you can do to something that is *in* a module.
     *
     * Weighted into the top band because it is the most specific thing true of
     * the selection: a picture in a grid is a picture whose box is not yours to
     * move, and the controls that follow from that — reframe it, take it out —
     * are the ones you actually reached for it to use.
     */
    id: 'grid-slot', label: 'In a grid', weight: 92, surfaces: ['toolbar', 'menu'],
    when: (f) => f.allSlotted,
  },
  {
    id: 'grid-fill', label: 'Place in grid', weight: 19, surfaces: ['toolbar', 'menu'],
    when: (f) =>
      f.gridCount === 1 && f.imageCount > 0 && f.count === f.gridCount + f.imageCount,
  },
  {
    /**
     * Turn a shape's outline into an editable path.
     *
     * ## Why a menu entry and not just the double-click it already had
     *
     * `flattenToPath` has existed and been reachable exactly one way: double
     * click a shape with the Direct Selection tool armed, and confirm a banner.
     * That is a discoverable path only for somebody who already knows the
     * feature exists -- which is to say, not a path at all. Every vector editor
     * puts this on the object menu, because "make this editable" is a thing you
     * decide about an object rather than a mode you enter.
     *
     * Shapes and text. A path is already one; everything else has no outline
     * to give. Text takes a different route -- its letterforms are read out of
     * the font binary rather than derived from the node, so `textToPath` is
     * asynchronous where `flattenToPath` is not -- but from here it is the same
     * decision about the same object, and splitting it into two menu entries
     * would make the user learn which kind of thing they had selected.
     */
    id: 'to-path', label: 'Convert to path', weight: 17, surfaces: ['menu'],
    when: (f) =>
      f.count === 1 && (f.uniformType === 'shape' || f.uniformType === 'text') && !f.locked,
  },
  {
    id: 'align', label: 'Align', weight: 17, surfaces: ['toolbar', 'menu'],
    when: (f) => f.count > 1,
  },
  {
    id: 'distribute', label: 'Distribute', weight: 16, surfaces: ['toolbar', 'menu'],
    // Two objects are already evenly spaced; the control would do nothing.
    when: (f) => f.count >= 3,
  },
  {
    id: 'order', label: 'Order', weight: 15, surfaces: ['toolbar', 'menu'],
    when: (f) => f.count > 0,
  },
  {
    id: 'physics', label: 'Material', weight: 14, surfaces: ['panel'],
    when: (f) => f.count > 0 && !f.types.has('comment') && !f.types.has('frame'),
  },
  {
    id: 'lock', label: 'Lock', weight: 12, surfaces: ['toolbar', 'menu'],
    when: (f) => f.count > 0,
  },
  {
    id: 'visibility', label: 'Hide', weight: 11, surfaces: ['menu'],
    when: (f) => f.count > 0,
  },
  {
    id: 'delete', label: 'Delete', weight: 10, surfaces: ['toolbar', 'menu'],
    when: (f) => f.count > 0,
  },
];

/**
 * What this selection affords, most specific first.
 *
 * @param surface Filters to what that surface is willing to show. A toolbar has
 *   room for a handful of controls; a panel can show every section; a menu
 *   carries the commands rather than the continuous controls.
 */
export function resolveAffordances(
  nodes: readonly AnyNode[],
  options: {
    surface?: Surface;
    allObjects?: Readonly<Record<string, AnyNode>>;
    facts?: SelectionFacts;
  } = {}
): Affordance[] {
  const facts = options.facts ?? selectionFacts(nodes, options.allObjects ?? {});
  if (facts.count === 0) return [];

  return RULES.filter((rule) => {
    if (options.surface && !rule.surfaces.includes(options.surface)) return false;
    return rule.when(facts);
  })
    .map(({ when: _when, ...affordance }) => affordance)
    // Stable within a weight, so two equal entries keep table order rather
    // than swapping about between renders.
    .sort((a, b) => b.weight - a.weight);
}

/** Convenience for a surface that just wants to ask about one thing. */
export function affords(
  nodes: readonly AnyNode[],
  id: AffordanceId,
  allObjects?: Readonly<Record<string, AnyNode>>
): boolean {
  return resolveAffordances(nodes, { allObjects }).some((a) => a.id === id);
}
