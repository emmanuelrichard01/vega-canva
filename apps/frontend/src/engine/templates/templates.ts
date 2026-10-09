import type { NewNodeInput } from '../document/mutations';
import type { AnyNode } from '../model/schema';
import { buildPreview, MAX_ITEMS_RICH, type BoardPreview } from '../model/boardPreview';
import { previewColorOf, previewPointsOf } from '../model/previewPaint';
import type { Tint } from './templateKit';
import { SYSTEMS } from './catalogue/systems';
import { PRODUCT } from './catalogue/product';
import { DIAGRAMS } from './catalogue/diagrams';
import { DESIGN } from './catalogue/design';
import { DATA } from './catalogue/data';
import { PHYSICS } from './catalogue/physics';
import { SLIDES } from './catalogue/slides';
import { ART } from './catalogue/art';

/**
 * Boards that already have something on them.
 *
 * An empty canvas asks you to know what the tool is for before you have used
 * it. A board that arrives with real work on it shows the features as results:
 * the fastest way to learn what a connector does is to drag the box it joins.
 * Each template opens as an ordinary, editable room that happens to start full.
 *
 * Templates are built in code from `NewNodeInput` rather than stored as JSON,
 * so a schema rename fails the type check instead of shipping malformed boards.
 *
 * The boards themselves live in `catalogue/<set>.ts`, one array per set; this
 * file is only the registry and the gallery's vocabulary.
 */

/**
 * What kind of thing a template is, grouped by the job someone arrives with
 * rather than by the tools involved.
 */
export type TemplateCategory =
  | 'systems'
  | 'product'
  | 'diagrams'
  | 'design'
  | 'data'
  | 'science'
  | 'physics'
  | 'slides'
  | 'art';

/** The order the gallery shows categories in. Editorial, not alphabetical. */
export const CATEGORIES: Array<{ id: TemplateCategory; label: string; blurb: string }> = [
  { id: 'systems', label: 'Systems & architecture', blurb: 'Real systems, drawn the way their engineers would.' },
  { id: 'product', label: 'Product & teams', blurb: 'Roadmaps, rituals and the boards a team lives in.' },
  { id: 'diagrams', label: 'Diagrams & thinking', blurb: 'Flows, maps and structures for working things out.' },
  { id: 'design', label: 'Web, UI & social', blurb: 'Landing pages, app screens, wireframes and kits.' },
  { id: 'data', label: 'Data & dashboards', blurb: 'Tables and the live charts that read from them.' },
  { id: 'science', label: 'Science & maths', blurb: 'Plots, distributions and models you can poke.' },
  { id: 'physics', label: 'Physics & play', blurb: 'Boards that move when you push them.' },
  { id: 'slides', label: 'Slides', blurb: 'Decks built from frames, ready to present.' },
  { id: 'art', label: 'Illustration', blurb: 'Drawing with objects, by hand and by formula.' },
];

export interface Template {
  /** `<category>-<slug>`, for example `systems-youtube`. Stable: rooms and onboarding refer to it. */
  id: string;
  category: TemplateCategory;
  name: string;
  /** One line, on the card. Says what the board is *for*, not what it contains. */
  blurb: string;
  /** The capabilities the board shows off, shown as chips. Two or three read best on a card. */
  teaches: string[];
  /**
   * Extra search terms that are not capabilities: the domain, the audience,
   * the names people type ("okr", "kubernetes", "pitch").
   */
  tags?: string[];
  /** A pale ground for the cover and the hero, from the shared palette. Defaults by category. */
  accent?: Tint;
  /**
   * Roughly how many objects it builds, when that is the point. A claim about
   * the engine belongs on the card where opening the board can check it.
   */
  objectCount?: number;
  /** Eligible for the gallery's hero showcase. Keep it to the strongest few. */
  featured?: boolean;
  /**
   * Built fresh each time, so two people opening one never share ids.
   *
   * `limit` is a hint honoured by boards that generate hundreds of objects:
   * covers need a recognisable silhouette, not the whole board.
   */
  build: (limit?: number) => NewNodeInput[];
}

/**
 * How many nodes a cover is allowed to ask for. Sits just above
 * `MAX_ITEMS_RICH`, so a generated board's picture is the whole of what it
 * built rather than the largest slice of it.
 */
const PREVIEW_NODE_LIMIT = 150;

/** Every board in the gallery, in the order the "All" view falls back to. */
export const TEMPLATES: Template[] = [
  ...SYSTEMS,
  ...PRODUCT,
  ...DIAGRAMS,
  ...DESIGN,
  ...DATA,
  ...PHYSICS,
  ...SLIDES,
  ...ART,
];

/**
 * The gallery's showcase, in order: ids of `featured` boards to lead with.
 * Featured boards not listed follow in category order, one per category.
 */
export const SHOWCASE: readonly string[] = ['art-vega-hero', 'systems-youtube', 'data-saas-metrics', 'slides-pitch', 'design-dashboard', 'systems-rag'];

/**
 * The board offered first to somebody with nothing yet: friendly, quick to
 * read and broad in what it shows. Falls back to the first showcase board.
 */
export const FIRST_BOARD: string | null = 'product-q3-planning';

const BY_ID = new Map<string, Template>();
TEMPLATES.forEach((template) => { if (!BY_ID.has(template.id)) BY_ID.set(template.id, template); });

export const templateById = (id: string): Template | undefined => BY_ID.get(id);

/**
 * The picture on a template's card, drawn from the template's own `build()` so
 * the cover is always the exact board you will get.
 *
 * Creation input leaves out the fields the CRDT boundary would fill in, so the
 * nodes are completed with `zIndex`, `hidden` and identity transforms first.
 */
export function templatePreview(template: Template): BoardPreview | null {
  const nodes = template.build(PREVIEW_NODE_LIMIT).map((node, i) => ({
    ...node,
    zIndex: i,
    hidden: false,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  })) as unknown as AnyNode[];

  const byId: Record<string, AnyNode> = {};
  nodes.forEach((node) => { byId[node.id] = node; });

  return buildPreview(nodes, previewColorOf, (node) => previewPointsOf(node, byId), MAX_ITEMS_RICH);
}
