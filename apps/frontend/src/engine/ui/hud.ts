/**
 * The board's heads-up readouts: one API for every live number a gesture shows.
 *
 * A tool or a gesture says what it is measuring and where; the HUD layer
 * (`components/hud/HudLayer.tsx`) decides how it looks and where the pill goes.
 * So every readout on the board shares one pill, one type scale with tabular
 * figures, one colour logic and one placement rule, and no tool draws its own.
 *
 * ```ts
 * import { hud } from '../ui/hud';
 *
 * // While dragging out a shape: the size, under the box being drawn.
 * hud.show({ source: 'shape', kind: 'size', value: { width, height }, at: pointer, box });
 * // While drawing a line: length and angle beside the pointer.
 * hud.show({ source: 'line', kind: 'length', value: { length, angle }, at: end, snapped });
 * // When the gesture ends or is cancelled.
 * hud.hide('shape');
 * ```
 *
 * - **World coordinates in.** `at` and `box` are board units. The layer turns
 *   them into screen pixels and follows the camera, so a pan or zoom mid-gesture
 *   keeps the pill attached.
 * - **Channels.** Each caller names a `source`, so the transform badge and a
 *   tool can never hide each other's readout. `hide(source)` removes only that
 *   one. Several channels can be visible at once.
 * - **Cheap to call on every pointer move.** A call that changes nothing is
 *   dropped, and the layer writes the DOM directly rather than re-rendering
 *   React.
 * - **Colour logic.** `object` (blue) describes the thing being drawn or
 *   transformed: its size, length, angle, position. `measure` (magenta) is a
 *   distance between things, the same family as the smart guides and the Alt
 *   measurement. `distance` readouts default to `measure`; everything else to
 *   `object`.
 * - **Snap.** `snapped: true` shows a tick in the pill and pulses it once on
 *   the frame the value lands on a snap (an angle on 15°, a length on the
 *   grid). Reduced motion keeps the tick and drops the pulse.
 */

import { formatHud, type HudReadout, type HudText } from './hudFormat';
import type { HudPlacement } from './hudPlace';

export type { HudReadout, HudKind } from './hudFormat';
export type { HudPlacement } from './hudPlace';

export interface HudWorldBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type HudTone = 'object' | 'measure';

export type HudShowInput = HudReadout & {
  /** The board point the reading belongs to: the pointer, or the end being placed. */
  at: { x: number; y: number };
  /** The board box being measured. With a box the pill sits under it (flipping above near the edge). */
  box?: HudWorldBox | null;
  /** `below` a box or beside the `pointer`. Defaults to `below` with a box, `pointer` without. */
  placement?: HudPlacement;
  tone?: HudTone;
  /** The value sits on a snap: shows the tick, and pulses once on arrival. */
  snapped?: boolean;
  /** Which caller this readout belongs to. Defaults to `'draw'`. */
  source?: string;
};

/** A readout as the layer draws it. */
export interface HudEntry {
  source: string;
  readout: HudReadout;
  at: { x: number; y: number };
  box: HudWorldBox | null;
  placement: HudPlacement;
  tone: HudTone;
  snapped: boolean;
  /** Bumped each time `snapped` turns on, so the layer can pulse exactly once per snap. */
  snapCount: number;
}

type Listener = () => void;

const DEFAULT_SOURCE = 'draw';

const listeners = new Set<Listener>();
let entries: ReadonlyMap<string, HudEntry> = new Map();

function emit() {
  listeners.forEach((fn) => fn());
}

function sameReadout(a: HudReadout, b: HudReadout): boolean {
  if (a.kind !== b.kind) return false;
  if (typeof a.value !== 'object' || typeof b.value !== 'object') return a.value === b.value;
  const av = a.value as unknown as Record<string, number | undefined>;
  const bv = b.value as unknown as Record<string, number | undefined>;
  const keys = new Set([...Object.keys(av), ...Object.keys(bv)]);
  for (const k of keys) if (av[k] !== bv[k]) return false;
  return true;
}

const sameBox = (a: HudWorldBox | null, b: HudWorldBox | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

export const hud = {
  /** Show or update a readout. Safe to call on every pointer move. */
  show(input: HudShowInput): void {
    const source = input.source ?? DEFAULT_SOURCE;
    const box = input.box ?? null;
    const readout = { kind: input.kind, value: input.value } as HudReadout;
    const tone: HudTone = input.tone ?? (input.kind === 'distance' ? 'measure' : 'object');
    const placement: HudPlacement = input.placement ?? (box ? 'below' : 'pointer');
    const snapped = Boolean(input.snapped);
    const prev = entries.get(source);

    if (
      prev &&
      prev.tone === tone &&
      prev.placement === placement &&
      prev.snapped === snapped &&
      prev.at.x === input.at.x &&
      prev.at.y === input.at.y &&
      sameBox(prev.box, box) &&
      sameReadout(prev.readout, readout)
    ) {
      return;
    }

    const snapCount = (prev?.snapCount ?? 0) + (snapped && !prev?.snapped ? 1 : 0);
    const next = new Map(entries);
    next.set(source, {
      source,
      readout,
      at: { x: input.at.x, y: input.at.y },
      box: box ? { ...box } : null,
      placement,
      tone,
      snapped,
      snapCount,
    });
    entries = next;
    emit();
  },

  /** Take a readout down. Without a source, the default `'draw'` channel. */
  hide(source: string = DEFAULT_SOURCE): void {
    if (!entries.has(source)) return;
    const next = new Map(entries);
    next.delete(source);
    entries = next;
    emit();
  },

  /** Take every readout down: a tool switch, a board leaving. */
  clear(): void {
    if (entries.size === 0) return;
    entries = new Map();
    emit();
  },

  /** What is showing, keyed by source. Immutable: a new map on every change. */
  get(): ReadonlyMap<string, HudEntry> {
    return entries;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** The text a readout would show, for callers that need the same words elsewhere (an aria-label, a test). */
export function hudText(readout: HudReadout, zoom = 1): HudText {
  return formatHud(readout, zoom);
}

export type { HudText };
