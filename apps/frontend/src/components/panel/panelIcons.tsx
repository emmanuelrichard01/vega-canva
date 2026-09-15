import React from 'react';
import {
  BarChart3,
  Frame,
  ImageIcon,
  LayoutGrid,
  MessageSquare,
  Mic,
  PenLine,
  Spline,
  Square,
  StickyNote,
  Type,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import type { NodeType } from '../../engine/model/schema';

/**
 * The glyph for each node type.
 *
 * ## Why this is components and a full `Record`
 *
 * It was `Record<string, React.ReactNode>` holding pre-rendered elements at a
 * fixed `size={16}` in a fixed colour, and it was missing three of the ten
 * types — `frame`, `connector`, and then `grid` when that was added. Both
 * problems come from the same two decisions.
 *
 * Keyed by `string`, so a missing entry is not an error, it is `undefined`, and
 * every caller carried its own `?? <LayoutTemplate/>` fallback — which is how
 * three types ended up silently wearing a stand-in glyph nobody chose for them.
 * Typed against `NodeType` with no `Partial`, adding a type to the schema now
 * fails the build here instead. `nodeLabel.ts` made the same call for the same
 * reason, and its header tells the story of the `connector` that went missing.
 *
 * Holding elements rather than components, so the size and colour were baked in
 * at 16px and `--text-secondary`. A 16px icon is right in a panel header and
 * too big in a 26px list row, so anywhere that wanted a different size had to
 * bypass this map and pick its own glyph — a second answer to "what does a
 * sticky look like", free to drift from the first.
 */
export const TYPE_ICON: Record<NodeType, LucideIcon> = {
  frame: Frame,
  grid: LayoutGrid,
  chart: BarChart3,
  table: Table2,
  text: Type,
  shape: Square,
  path: PenLine,
  connector: Spline,
  image: ImageIcon,
  sticky: StickyNote,
  audio: Mic,
  comment: MessageSquare,
};

/**
 * The panel header's icons, at the size and colour it wants them.
 *
 * Kept so the header does not have to render the component itself, and derived
 * from the map above so it cannot fall behind it.
 */
export const TYPE_ICONS: Record<NodeType, React.ReactNode> = Object.fromEntries(
  (Object.entries(TYPE_ICON) as Array<[NodeType, LucideIcon]>).map(([type, Icon]) => [
    type,
    // Keyed even though these are values in a map rather than a rendered list:
    // the linter cannot tell the difference, and a key on an element that is
    // never iterated costs nothing.
    <Icon key={type} size={16} color="var(--text-secondary)" />,
  ])
) as Record<NodeType, React.ReactNode>;
