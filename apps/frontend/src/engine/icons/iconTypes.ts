/**
 * The shapes of icon pack files. Written by `scripts/icons/build-icon-packs.mjs`.
 *
 * A path record is the whole of an icon's artwork: no markup survives the
 * build, so there is nothing here that can carry a script or a reference.
 */
export interface IconPathRecord {
  /** SVG path data. */
  d: string;
  /** Fill, `#rrggbb`. Absent means unfilled. */
  f?: string;
  /** Fill opacity, 0..1. Absent is opaque. */
  fo?: number;
  /** Even-odd fill rule. */
  eo?: 1;
  /** Stroke, `#rrggbb`. */
  s?: string;
  /** Stroke width in the artwork's units, already scaled by `m`. */
  sw?: number;
  /** Stroke opacity. */
  so?: number;
  lc?: string;
  lj?: string;
  /** Affine matrix `[a, b, c, d, e, f]` applied to `d`. */
  m?: number[];
}

export interface IconEntry {
  /** Id within its category. */
  i: string;
  /** Display name. */
  n: string;
  /** `[width, height]` of the artwork's coordinate space. */
  v: [number, number];
  p: IconPathRecord[];
}

export interface IconCategoryInfo {
  id: string;
  name: string;
  count: number;
  file: string;
}

export interface IconPackInfo {
  id: string;
  name: string;
  version: string;
  licence: string;
  licenceUrl: string;
  source: string;
  attribution: string;
  count: number;
  cats: IconCategoryInfo[];
  catalogue: string;
}

export interface IconPackIndex {
  v: number;
  packs: IconPackInfo[];
  /** Packs the build could not ship, and why. */
  unavailable: Array<{ id: string; name: string; reason: string }>;
}

/** The search catalogue: `[iconId, name, keywords]` rows. */
export interface IconCatalogue {
  cats: Array<[string, string]>;
  icons: Array<[string, string, string]>;
}
