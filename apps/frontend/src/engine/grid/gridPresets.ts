import type { GridKind, GridSpec } from './gridLayout';

/**
 * Grids people ask for by name.
 *
 * ## What the kind picker does not give you
 *
 * The eleven systems answer *arrangement* — columns, bento, masonry, a dial —
 * and each arrives at `KIND_DEFAULTS`, which are chosen to show that kind at
 * its best rather than to be any particular layout. That is the right default
 * and it is not a configuration.
 *
 * Proportion is the other half, and it is where the named grids live. A
 * twelve-column, 24-gutter web grid is the most-used layout in the world and
 * reaching it means four separate edits: switch kind, set columns to twelve,
 * set the gap, set the margin. Every one of those is a number somebody has to
 * already know, and none of them is discoverable from the panel.
 *
 * So: a short list of configurations that have names, and the discipline is the
 * same one `frames.ts` states — a picker with forty entries is a search
 * problem. These are the ones where the numbers *are* the point.
 *
 * ## Why they are patches and not whole specs
 *
 * A grid already has a position and a size, and picking "Twelve column" is a
 * statement about its tracks, not about where it sits or how big it is.
 * Returning a partial spec means applying one never moves or resizes the grid
 * you are looking at — which is what makes trying three of them in a row a
 * comparison rather than a series of accidents.
 */
export interface GridPreset {
  id: string;
  label: string;
  /** What it is *for*, in one line. The picker shows this. */
  hint: string;
  kind: GridKind;
  patch: Partial<Pick<GridSpec, 'rows' | 'columns' | 'gutterX' | 'gutterY' | 'margin' | 'variation'>>;
}

export const GRID_PRESETS: GridPreset[] = [
  {
    id: 'twelve',
    label: 'Twelve column',
    hint: 'The web layout standard. Divides by two, three, four and six.',
    kind: 'columns',
    // Twelve is the number because of what it *factors* into: halves, thirds,
    // quarters and sixths all land on a track boundary, which is the whole
    // reason the web settled on it rather than on ten.
    patch: { rows: 1, columns: 12, gutterX: 24, gutterY: 24, margin: 48, variation: 0 },
  },
  {
    id: 'eight',
    label: 'Eight column',
    hint: 'Tablet width. Halves and quarters, without twelve slivers.',
    kind: 'columns',
    patch: { rows: 1, columns: 8, gutterX: 20, gutterY: 20, margin: 40, variation: 0 },
  },
  {
    id: 'four',
    label: 'Four column',
    hint: 'Phone width, and the coarsest grid that still divides.',
    kind: 'columns',
    patch: { rows: 1, columns: 4, gutterX: 16, gutterY: 16, margin: 24, variation: 0 },
  },
  {
    id: 'thirds',
    label: 'Rule of thirds',
    hint: 'Three by three. Where a composition puts its subject.',
    kind: 'modular',
    // No gutter and no margin, deliberately: the thirds are a *measure* laid
    // over a whole picture, and a gap between them would be a gap in the
    // picture. It is the one preset here whose cells are meant to touch.
    patch: { rows: 3, columns: 3, gutterX: 0, gutterY: 0, margin: 0, variation: 0 },
  },
  {
    id: 'contact-sheet',
    label: 'Contact sheet',
    hint: 'Five across, four down, even gaps. For comparing many things at once.',
    kind: 'modular',
    patch: { rows: 4, columns: 5, gutterX: 12, gutterY: 12, margin: 24, variation: 0 },
  },
  {
    id: 'swiss',
    label: 'Swiss',
    hint: 'Six columns on a deep margin. Room to breathe, and a strong left edge.',
    kind: 'modular',
    // Six columns and four rows over a generous margin is the Müller-Brockmann
    // arrangement: enough divisions to place anything, few enough that the
    // page reads as ordered rather than as a mesh.
    patch: { rows: 4, columns: 6, gutterX: 16, gutterY: 16, margin: 72, variation: 0 },
  },
  {
    id: 'manuscript',
    label: 'Manuscript',
    hint: 'One block, wide margins. For a single thing that deserves the page.',
    kind: 'manuscript',
    patch: { rows: 1, columns: 1, gutterX: 0, gutterY: 0, margin: 96, variation: 0 },
  },
];

export function gridPreset(id: string | undefined): GridPreset | undefined {
  return id ? GRID_PRESETS.find((p) => p.id === id) : undefined;
}

/**
 * The preset a spec currently matches, if any.
 *
 * Exact on every field the preset sets, and blind to the ones it does not — a
 * preset says nothing about position, size or seed, so a grid that has been
 * moved or reseeded is still the preset it was built from.
 *
 * Exact rather than approximate, for the reason `presetMatching` is in
 * `frames.ts`: a grid one unit off a preset has been adjusted deliberately,
 * and naming it anyway would be the panel claiming something the numbers do
 * not say.
 */
export function gridPresetMatching(spec: GridSpec): GridPreset | undefined {
  return GRID_PRESETS.find((preset) => {
    if (preset.kind !== spec.kind) return false;
    return (Object.keys(preset.patch) as (keyof typeof preset.patch)[]).every(
      (key) => preset.patch[key] === spec[key],
    );
  });
}
