import type { AnyNode, Appearance, StickyTheme, Typography } from './schema';
import type { NodePatch } from './selection';
import { THEMES } from './stickyThemes';

/**
 * Copying how something looks, and putting that look on something else.
 *
 * Excalidraw's Copy styles / Paste styles, Figma's Copy / Paste properties and
 * Lucidchart's format painter are the same idea: the fastest way to make six
 * boxes match is to point at the one that is right. Here it was a trip to the
 * properties panel per property per object.
 *
 * ## What travels, and what does not
 *
 * A style is **paint and type**, never geometry or content. Fill, stroke,
 * shadow, blur, sketch and shading; the whole typography block; a note's paper;
 * a connector's route and ends; opacity. Not size, not position, not text, not
 * a shape's kind — pasting a style onto a hexagon must leave a hexagon.
 *
 * ## Only what the target can draw
 *
 * Each type takes the parts of a style it renders, and nothing else. A
 * connector has no interior, so a fill is not written to it; a corner radius is
 * drawn on rectangles, frames and pictures and ignored everywhere else. Writing
 * a field the renderer ignores is the defect this codebase keeps finding and
 * removing — it looks like it worked, and then it silently reappears the day
 * the object is turned into something that *does* read it.
 */

export interface StyleSnapshot {
  /** What it was copied from, for the words on the menu. */
  sourceType: AnyNode['type'];
  /** Which object, so the rail does not offer to paste a style back onto its source. */
  sourceId: string;
  /** A colour that stands for the style, for the swatch beside Paste style. */
  swatch: string | null;
  appearance?: Appearance;
  typography?: Typography;
  theme?: StickyTheme;
  connector?: {
    routing?: unknown;
    endStart?: unknown;
    endEnd?: unknown;
    endScale?: unknown;
  };
  opacity: number;
}

/** Appearance keys that describe paint. `sketchSeed` is identity, not style. */
const PAINT_KEYS: readonly (keyof Appearance)[] = [
  'fill',
  'stroke',
  'shadow',
  'innerShadow',
  'cornerRadius',
  'blendMode',
  'blur',
  'backdropBlur',
  'sketch',
  'fillStyle',
  'shadingDensity',
  'shadingAngle',
];

/** Which paint each type renders. Absent means the type takes none. */
function paintKeysFor(node: AnyNode): ReadonlySet<keyof Appearance> {
  const all = new Set(PAINT_KEYS);
  switch (node.type) {
    case 'shape': {
      // Corner radius is a rectangle's; a hexagon would store it and ignore it.
      if (node.geometry.kind !== 'rect') all.delete('cornerRadius');
      return all;
    }
    case 'path':
      all.delete('cornerRadius');
      return all;
    case 'frame':
      all.delete('sketch');
      all.delete('fillStyle');
      all.delete('shadingDensity');
      all.delete('shadingAngle');
      return all;
    case 'connector':
      return new Set<keyof Appearance>(['stroke', 'shadow', 'blendMode', 'blur', 'sketch']);
    case 'image':
      return new Set<keyof Appearance>([
        'stroke', 'shadow', 'innerShadow', 'cornerRadius', 'blendMode', 'blur',
      ]);
    case 'text':
      return new Set<keyof Appearance>(['shadow', 'blendMode', 'blur']);
    case 'chart':
      return new Set<keyof Appearance>(['sketch']);
    default:
      return new Set();
  }
}

function hasTypography(node: AnyNode): node is Extract<AnyNode, { typography?: Typography }> {
  return node.type === 'text' || node.type === 'shape';
}

function swatchOf(node: AnyNode): string | null {
  if (node.type === 'sticky') return THEMES[node.theme]?.bg ?? null;
  const appearance = (node as { appearance?: Appearance }).appearance;
  const fill = appearance?.fill?.[0];
  if (fill) return fill.type === 'solid' ? fill.color : fill.stops[0]?.color ?? null;
  if (appearance?.stroke?.color && (appearance.stroke.width ?? 0) > 0) return appearance.stroke.color;
  if (node.type === 'text') return node.typography.color;
  return null;
}

/** Take the style off one object. */
export function extractStyle(node: AnyNode): StyleSnapshot {
  const snapshot: StyleSnapshot = {
    sourceType: node.type,
    sourceId: node.id,
    swatch: swatchOf(node),
    opacity: node.opacity ?? 1,
  };

  const appearance = (node as { appearance?: Appearance }).appearance;
  if (appearance) {
    const picked: Appearance = {};
    for (const key of PAINT_KEYS) {
      if (appearance[key] !== undefined) {
        (picked as Record<string, unknown>)[key] = structuredCloneSafe(appearance[key]);
      }
    }
    snapshot.appearance = picked;
  }
  if (hasTypography(node) && node.typography) {
    // A shape with no words still has a typography block, and it is the one its
    // first words will be set in — so it is part of how that shape looks.
    snapshot.typography = structuredCloneSafe(node.typography);
  }
  if (node.type === 'sticky') snapshot.theme = node.theme;
  if (node.type === 'connector') {
    snapshot.connector = {
      routing: node.routing,
      endStart: node.endStart,
      endEnd: node.endEnd,
      endScale: node.endScale,
    };
  }
  return snapshot;
}

function structuredCloneSafe<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * The patches that put `style` on `targets`, each taking only what it can draw.
 *
 * The target's own appearance is merged into rather than replaced: a paint key
 * the source did not set is left alone, so pasting the style of a plain box
 * onto a shape with a shadow keeps the shadow. That is the reading Figma's
 * Paste properties takes, and the one that never destroys something the source
 * had no opinion about.
 */
export function applyStylePatches(targets: readonly AnyNode[], style: StyleSnapshot): NodePatch[] {
  const patches: NodePatch[] = [];

  for (const node of targets) {
    if (node.locked) continue;
    const changes: Record<string, unknown> = {};

    if (style.appearance) {
      const allowed = paintKeysFor(node);
      const incoming: Record<string, unknown> = {};
      for (const key of allowed) {
        const value = style.appearance[key];
        if (value !== undefined) incoming[key] = structuredCloneSafe(value);
      }
      // A fill only means something to a type with an interior; a sketched
      // hand only means something to a type that has the fill to shade.
      if (Object.keys(incoming).length > 0) {
        const current = (node as { appearance?: Appearance }).appearance ?? {};
        changes.appearance = { ...current, ...incoming };
      }
    }

    if (style.typography && hasTypography(node)) {
      changes.typography = structuredCloneSafe(style.typography);
    }

    if (style.theme && node.type === 'sticky') changes.theme = style.theme;

    if (style.connector && node.type === 'connector') {
      for (const [key, value] of Object.entries(style.connector)) {
        if (value !== undefined) changes[key] = value;
      }
    }

    // Opacity is a property of every object, so it always travels — but only
    // alongside something else. A style that could give a table nothing but
    // its opacity is not a style the table can take.
    if (Object.keys(changes).length > 0 && (node.opacity ?? 1) !== style.opacity) {
      changes.opacity = style.opacity;
    }

    if (Object.keys(changes).length > 0) patches.push({ id: node.id, changes });
  }

  return patches;
}

/** Whether pasting `style` would change anything about `targets`. */
export function canPasteStyle(targets: readonly AnyNode[], style: StyleSnapshot | null): boolean {
  if (!style || targets.length === 0) return false;
  return applyStylePatches(targets, style).length > 0;
}

// ---------------------------------------------------------------- the holder

/**
 * The copied style, for this tab.
 *
 * A module holder with a subscription rather than React state, because three
 * surfaces read it — the menu, the rail, the keyboard — and none of them owns
 * the others. The same shape as `cropMode` and `pathEdit`.
 */
let current: StyleSnapshot | null = null;
const listeners = new Set<() => void>();

export const styleClipboard = {
  get: (): StyleSnapshot | null => current,
  set(next: StyleSnapshot | null) {
    current = next;
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
