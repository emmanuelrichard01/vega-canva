import { create } from 'zustand';
import { normalizeNode, objectsMap, observeNodes, provider, scheduleMigration, updateNode } from '../engine/document';
import { STICKY_THEMES, type AnyNode, type StickyTheme } from '../engine/model/schema';
import { sceneGraph } from '../engine/SceneGraph';
import {
  DEFAULT_FORCE_RADIUS_SCALE,
  DEFAULT_FORCE_SCALE,
  FALLOFF_IDS,
  MAX_FORCE_RADIUS_SCALE,
  MAX_FORCE_SCALE,
  MIN_FORCE_RADIUS_SCALE,
  MIN_FORCE_SCALE,
  type FalloffId,
  FORCE_IDS,
  LATCH_SECONDS,
  DEFAULT_LATCH_SECONDS,
  type LatchSeconds,
  type ForceId,
} from '../engine/physics/forces';

interface StoreState {
  /** Latest snapshot of every node, keyed by id. */
  objects: Record<string, AnyNode>;
  /** Bumped on every applied change, for coarse subscriptions. */
  version: number;
  /**
   * Ids touched by the change that produced the current `version`.
   *
   * Published here so consumers that need a dirty set — physics rebuilding
   * Matter bodies, most of all — can react to what actually changed instead of
   * walking the whole document. `observe.ts` is still the only observer of
   * `objectsMap`; this just forwards the change set it already computes, rather
   * than each consumer registering its own `observeDeep`.
   */
  lastChangedIds: string[];
  lastRemovedIds: string[];
  isReplaying: boolean;
  setIsReplaying: (val: boolean) => void;
  setObjects: (objects: Record<string, AnyNode>) => void;
  /**
   * Show a Time Travel snapshot on the canvas, or `null` to return to live.
   *
   * This is the piece Time Travel was missing. `isReplaying` existed and the
   * live observer already deferred to it, but nothing ever *set* it and no
   * replayed state ever reached this store — the snapshot went only to the
   * Layers and Properties panels as `overrideObjects`. So scrubbing history
   * moved two side panels while the canvas kept rendering the live document,
   * which is the whole reason replay looked broken.
   */
  applyReplaySnapshot: (objects: Record<string, unknown> | null) => void;
  zenMode: boolean;
  setZenMode: (val: boolean) => void;
  /**
   * Whether a flick carries momentum when you let go of an object.
   *
   * This used to gate the force tools as well, which conflated two unrelated
   * questions: "does dragging throw?" and "do the force tools work?". One
   * persisted boolean silently changed what the canvas's most-used gesture
   * meant, and separately greyed out a whole tool group elsewhere in the UI.
   * Picking a force tool now turns force on by itself; this only governs throws.
   */
  physicsEnabled: boolean;
  setPhysicsEnabled: (val: boolean) => void;

  /**
   * Nib sizes for the two tools that draw with one.
   *
   * In the store rather than as statics on the tool classes, for two reasons:
   * a static cannot re-render the control that shows it, and these are working
   * preferences that should survive a reload the way the theme and the grid
   * setting do.
   */
  penSize: number;
  setPenSize: (val: number) => void;
  eraserSize: number;
  setEraserSize: (val: number) => void;

  /** User-facing strength multiplier applied to every force tool. */
  forceScale: number;
  setForceScale: (val: number) => void;

  /**
   * The colour a new sticky note gets.
   *
   * Remembered rather than cycled. The tool used to walk a fixed list on every
   * placement, so three notes dropped in a row came out three different
   * colours — which makes a deliberate colour code impossible and is the
   * opposite of what the Tab-chain already does, where a chained note inherits
   * the colour of the one it came from precisely so a train of thought looks
   * like one.
   */
  stickyTheme: StickyTheme;
  setStickyTheme: (theme: StickyTheme) => void;

  /** Multiplier on each force's own radius — the size of the effect area. */
  forceRadiusScale: number;
  setForceRadiusScale: (val: number) => void;

  /** How a force's strength fades from the centre of its field to the edge. */
  forceFalloff: FalloffId;
  setForceFalloff: (val: FalloffId) => void;

  /**
   * Restrict force to the current selection.
   *
   * Off by default, because force over everything is what the tool obviously
   * does and a mode that silently limits it would look broken.
   */
  forceSelectionOnly: boolean;
  setForceSelectionOnly: (val: boolean) => void;

  /**
   * Whether the rulers are drawn, and whether the dot grid is.
   *
   * Two flags rather than one "chrome" flag, because they answer different
   * questions: the rulers are for *measuring* and the grid is for *aligning*,
   * and plenty of work wants one without the other — a diagram wants the grid
   * and never the ruler, a print layout wants the ruler and finds the dots
   * noise.
   *
   * The ruler flag is structural, not cosmetic: the stage is inset by
   * `RULER_SIZE` so that screen coordinates and ruler marks describe the same
   * world position, and the panels clear it by the same amount. Turning them
   * off has to move all three or it leaves a dead margin down two edges.
   */
  /**
   * What the connector tool draws with, before anything is selected.
   *
   * Every other creating tool carries its own defaults — the pen its size,
   * the sticky its theme, the shape its kind — and the connector carried
   * none, so every connector on every board arrived in the same grey and the
   * only way to change one was to draw it and then go and find it again.
   */
  connectorColor: string;
  setConnectorColor: (val: string) => void;

  showRulers: boolean;
  setShowRulers: (val: boolean) => void;

  showGrid: boolean;
  setShowGrid: (val: boolean) => void;

  /**
   * Place a field and let it run, rather than holding the cursor on it.
   *
   * Off by default: press-and-hold is what a force tool obviously does, and a
   * mode that changed what a press means without being asked for would read
   * as the tool being broken.
   */
  forceLatch: boolean;
  setForceLatch: (val: boolean) => void;

  /** How long a latched field runs before it stops on its own. */
  forceLatchSeconds: LatchSeconds;
  setForceLatchSeconds: (val: LatchSeconds) => void;

  /**
   * The force you last used, so the dock can arm the mode in one press.
   *
   * The dock used to open a menu of six forces that the Forces bar then
   * offered again the moment you picked one — the same six names, twice, a
   * hundred pixels apart.
   */
  lastForce: ForceId;
  setLastForce: (id: ForceId) => void;

  /**
   * Whether a force tool is armed. Lives here rather than being threaded down
   * as a prop so each renderer can subscribe to the flip itself, instead of
   * every object on the canvas taking a new prop on every tool change.
   */
  forceToolActive: boolean;
  setForceToolActive: (val: boolean) => void;

  /**
   * Positions captured on entering a force tool, so the whole session can be
   * undone in one action.
   *
   * Force is destructive to layout in a way ordinary editing is not: one
   * shockwave rewrites the position of every object in range. Undo technically
   * covers it, but a settle commits many nodes across many transactions, so
   * unpicking it by hand is hopeless. Knowing there is a way back is what makes
   * the tools safe to play with at all.
   */
  layoutSnapshot: Record<string, { x: number; y: number; rotation: number }> | null;
  captureLayoutSnapshot: () => void;
  restoreLayout: () => void;
  clearLayoutSnapshot: () => void;
  /** Number of objects a restore would move back, for the bar's label. */
  layoutDriftCount: () => number;
  /**
   * Whether dragging snaps to the layout grid. Off by default: the previous
   * behaviour hard-snapped every drag to a 20px grid with no way to opt out,
   * so nothing could ever be placed precisely. Hold the grid modifier to snap
   * on demand instead.
   */
  snapToGrid: boolean;
  setSnapToGrid: (val: boolean) => void;
  /**
   * Dark mode. Persisted, and defaulting to the OS preference on a first
   * visit — this was local component state, so a user who chose dark mode was
   * handed light mode again on every single reload.
   */
  darkTheme: boolean;
  setDarkTheme: (val: boolean) => void;
}

const loadNumberPref = (key: string, fallback: number, min: number, max: number) => {
  if (typeof window === 'undefined') return fallback;
  const stored = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(stored) || stored === 0) return fallback;
  return Math.min(max, Math.max(min, stored));
};

const loadBoolPref = (key: string, fallback: boolean) => {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(key);
  return stored === null ? fallback : stored === 'true';
};

/** Honour the OS setting until the user makes an explicit choice. */
const prefersDarkScheme = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

export const useStore = create<StoreState>((set) => ({
  objects: {},
  version: 0,
  lastChangedIds: [],
  lastRemovedIds: [],
  isReplaying: false,
  setIsReplaying: (val) => set({ isReplaying: val }),
  setObjects: (objects) => set({ objects }),
  applyReplaySnapshot: (snapshot) => {
    const previous = useStore.getState().objects;

    if (!snapshot) {
      // Leaving replay: rebuild from the live document and clear the flag in
      // the *same* update. Done as two writes, whichever landed first would
      // leave one frame rendered under the wrong rule.
      const live: Record<string, AnyNode> = {};
      objectsMap.forEach((_ymap, id) => {
        const node = readCanonical(id);
        if (node) live[id] = node;
      });
      Object.keys(previous).forEach((id) => {
        if (!live[id]) sceneGraph.removeNode(id);
      });
      Object.entries(live).forEach(([id, node]) => sceneGraph.upsertNode(id, node));
      set((state) => ({
        objects: live,
        version: state.version + 1,
        lastChangedIds: Object.keys(live),
        lastRemovedIds: Object.keys(previous).filter((id) => !live[id]),
        isReplaying: false,
      }));
      return;
    }

    // Replayed nodes go through the same normalization as live ones, so a
    // snapshot from early in the room's life — written before the current
    // schema — renders exactly as it does after migration.
    const next: Record<string, AnyNode> = {};
    Object.entries(snapshot).forEach(([id, raw]) => {
      const node = normalizeNode(raw as Record<string, unknown>, id);
      if (node) next[id] = node;
    });

    // Keep the spatial index honest during replay rather than switching culling
    // off. The old code rendered every object in the document while replaying,
    // which turned Time Travel into a performance cliff on exactly the large
    // documents the rest of the engine is built to handle.
    Object.keys(previous).forEach((id) => {
      if (!next[id]) sceneGraph.removeNode(id);
    });
    Object.entries(next).forEach(([id, node]) => sceneGraph.upsertNode(id, node));

    set((state) => ({
      objects: next,
      version: state.version + 1,
      lastChangedIds: Object.keys(next),
      lastRemovedIds: Object.keys(previous).filter((id) => !next[id]),
      isReplaying: true,
    }));
  },
  zenMode: false,
  setZenMode: (val) => set({ zenMode: val }),
  // Off unless asked for. Throw changes what releasing a drag *means* —
  // the object keeps going instead of staying where you put it — and that is
  // a surprise to discover mid-gesture on a board you are trying to arrange.
  physicsEnabled: loadBoolPref('vega_physics_enabled', false),
  setPhysicsEnabled: (val) => {
    window.localStorage.setItem('vega_physics_enabled', String(val));
    set({ physicsEnabled: val });
  },
  penSize: loadNumberPref('vega_pen_size', 6, 1, 60),
  setPenSize: (val) => {
    const clamped = Math.min(60, Math.max(1, val));
    window.localStorage.setItem('vega_pen_size', String(clamped));
    set({ penSize: clamped });
  },
  eraserSize: loadNumberPref('vega_eraser_size', 15, 4, 200),
  setEraserSize: (val) => {
    const clamped = Math.min(200, Math.max(4, val));
    window.localStorage.setItem('vega_eraser_size', String(clamped));
    set({ eraserSize: clamped });
  },

  forceScale: loadNumberPref('vega_force_scale', DEFAULT_FORCE_SCALE, MIN_FORCE_SCALE, MAX_FORCE_SCALE),
  setForceScale: (val) => {
    const clamped = Math.min(MAX_FORCE_SCALE, Math.max(MIN_FORCE_SCALE, val));
    window.localStorage.setItem('vega_force_scale', String(clamped));
    set({ forceScale: clamped });
  },
  stickyTheme: ((): StickyTheme => {
    const stored = window.localStorage.getItem('vega_sticky_theme');
    // Validated rather than cast: `localStorage` is user-writable, and an
    // unknown theme would reach the renderer's lookup table and fall through
    // to a default on every paint instead of failing where it can be seen.
    return STICKY_THEMES.includes(stored as StickyTheme) ? (stored as StickyTheme) : 'yellow';
  })(),
  setStickyTheme: (theme) => {
    window.localStorage.setItem('vega_sticky_theme', theme);
    set({ stickyTheme: theme });
  },

  forceRadiusScale: loadNumberPref(
    'vega_force_radius_scale',
    DEFAULT_FORCE_RADIUS_SCALE,
    MIN_FORCE_RADIUS_SCALE,
    MAX_FORCE_RADIUS_SCALE
  ),
  setForceRadiusScale: (val) => {
    const clamped = Math.min(MAX_FORCE_RADIUS_SCALE, Math.max(MIN_FORCE_RADIUS_SCALE, val));
    window.localStorage.setItem('vega_force_radius_scale', String(clamped));
    set({ forceRadiusScale: clamped });
  },

  forceFalloff: ((): FalloffId => {
    const stored = window.localStorage.getItem('vega_force_falloff');
    // Validated rather than cast: `localStorage` is user-writable and a bad
    // value here would reach `falloffAt`, which would silently fall through to
    // its default on every frame instead of failing where it could be seen.
    return FALLOFF_IDS.includes(stored as FalloffId) ? (stored as FalloffId) : 'smooth';
  })(),
  setForceFalloff: (val) => {
    window.localStorage.setItem('vega_force_falloff', val);
    set({ forceFalloff: val });
  },

  forceSelectionOnly: false,
  setForceSelectionOnly: (val) => set({ forceSelectionOnly: val }),

  lastForce: ((): ForceId => {
    const stored = window.localStorage.getItem('vega_last_force');
    return FORCE_IDS.includes(stored as ForceId) ? (stored as ForceId) : 'magnet';
  })(),
  setLastForce: (id) => {
    window.localStorage.setItem('vega_last_force', id);
    set({ lastForce: id });
  },

  connectorColor: window.localStorage.getItem('vega_connector_color') || '',
  setConnectorColor: (val) => {
    window.localStorage.setItem('vega_connector_color', val);
    set({ connectorColor: val });
  },

  showRulers: loadBoolPref('vega_show_rulers', true),
  setShowRulers: (val) => {
    window.localStorage.setItem('vega_show_rulers', String(val));
    set({ showRulers: val });
  },

  showGrid: loadBoolPref('vega_show_grid', true),
  setShowGrid: (val) => {
    window.localStorage.setItem('vega_show_grid', String(val));
    set({ showGrid: val });
  },

  forceLatch: window.localStorage.getItem('vega_force_latch') === '1',
  setForceLatch: (val) => {
    window.localStorage.setItem('vega_force_latch', val ? '1' : '0');
    set({ forceLatch: val });
  },

  forceLatchSeconds: ((): LatchSeconds => {
    const stored = Number(window.localStorage.getItem('vega_force_latch_seconds'));
    // Validated against the offered set rather than clamped: `localStorage` is
    // user-writable, and an arbitrary number here would drive a field for a
    // duration no control can express or cancel.
    return (LATCH_SECONDS as readonly number[]).includes(stored)
      ? (stored as LatchSeconds)
      : DEFAULT_LATCH_SECONDS;
  })(),
  setForceLatchSeconds: (val) => {
    window.localStorage.setItem('vega_force_latch_seconds', String(val));
    set({ forceLatchSeconds: val });
  },

  forceToolActive: false,
  setForceToolActive: (val) => set({ forceToolActive: val }),
  layoutSnapshot: null,
  captureLayoutSnapshot: () => {
    const { objects } = useStore.getState();
    const snapshot: Record<string, { x: number; y: number; rotation: number }> = {};
    Object.values(objects).forEach((node) => {
      snapshot[node.id] = { x: node.x, y: node.y, rotation: node.rotation ?? 0 };
    });
    set({ layoutSnapshot: snapshot });
  },
  restoreLayout: () => {
    const { objects, layoutSnapshot } = useStore.getState();
    if (!layoutSnapshot) return;
    // Through the canonical write path, not straight into the Y.Map, so the
    // restore is one undo step and carries proper `updatedAt` stamps — and so
    // every collaborator watching sees the board snap back together.
    Object.entries(layoutSnapshot).forEach(([id, before]) => {
      const now = objects[id];
      if (!now) return; // deleted since; nothing to put back
      if (Math.abs(now.x - before.x) <= 1 && Math.abs(now.y - before.y) <= 1) return;
      updateNode(id, { x: before.x, y: before.y, rotation: before.rotation });
    });
  },
  clearLayoutSnapshot: () => set({ layoutSnapshot: null }),
  layoutDriftCount: () => {
    const { objects, layoutSnapshot } = useStore.getState();
    if (!layoutSnapshot) return 0;
    let moved = 0;
    Object.entries(layoutSnapshot).forEach(([id, before]) => {
      const now = objects[id];
      if (!now) return;
      // A whole pixel of tolerance: a settle rarely lands on exactly the
      // starting float, and offering to "restore" a layout nobody perceives as
      // changed would be noise.
      if (Math.abs(now.x - before.x) > 1 || Math.abs(now.y - before.y) > 1) moved++;
    });
    return moved;
  },
  snapToGrid: loadBoolPref('vega_snap_to_grid', false),
  setSnapToGrid: (val) => {
    window.localStorage.setItem('vega_snap_to_grid', String(val));
    set({ snapToGrid: val });
  },
  darkTheme: loadBoolPref('vega_dark_theme', prefersDarkScheme()),
  setDarkTheme: (val) => {
    window.localStorage.setItem('vega_dark_theme', String(val));
    set({ darkTheme: val });
  },
}));

let bridgeDisposer: (() => void) | null = null;
let migrationDisposer: (() => void) | null = null;

/**
 * Read one node from the document in canonical form.
 *
 * Normalization happens here, at the CRDT boundary, exactly once per changed
 * node — so every consumer downstream (renderer, tools, panels, physics,
 * exporters) reads the canonical schema and none of them needs a fallback
 * chain. A legacy document therefore renders correctly *before* the migration
 * has rewritten it, and keeps rendering correctly if an older peer writes a
 * legacy field back into it.
 */
function readCanonical(id: string): AnyNode | null {
  const ymap = objectsMap.get(id);
  if (!ymap) return null;
  return normalizeNode(ymap.toJSON(), id);
}

/**
 * Connect the document to the store and the scene graph.
 *
 * This is the *only* observer of `objectsMap`. There used to be a second one
 * in the sync module running the same parent-walk and calling
 * `sceneGraph.upsertNode` for the same node, so every edit was processed
 * twice and emitted two `ObjectMoved`/`ObjectModified` events — doubling
 * spatial-index churn and the full-map rebuild in `useVisibleSet` on every
 * drag and physics frame.
 *
 * Safe to call more than once (StrictMode double-invokes effects); any
 * previous subscription is torn down first.
 */
export const initSyncBridge = () => {
  bridgeDisposer?.();
  migrationDisposer?.();

  const initialObjects: Record<string, AnyNode> = {};
  objectsMap.forEach((_ymap, id) => {
    const node = readCanonical(id);
    if (node) {
      initialObjects[id] = node;
      sceneGraph.upsertNode(id, node);
    }
  });
  useStore.setState({
    objects: initialObjects,
    version: 1,
    lastChangedIds: Object.keys(initialObjects),
    lastRemovedIds: [],
  });

  bridgeDisposer = observeNodes(({ changed, removed }) => {
    // Time Travel drives the store directly from replayed snapshots; live
    // document traffic must not fight it for control of the canvas.
    if (useStore.getState().isReplaying) return;

    useStore.setState((state) => {
      const objects = { ...state.objects };

      removed.forEach((id) => {
        delete objects[id];
        sceneGraph.removeNode(id);
      });

      changed.forEach((id) => {
        const node = readCanonical(id);
        if (!node) return;
        objects[id] = node;
        sceneGraph.upsertNode(id, node);
      });

      return {
        objects,
        version: state.version + 1,
        lastChangedIds: [...changed],
        lastRemovedIds: [...removed],
      };
    });
  });

  // Converge the stored document too, once the server state has arrived.
  migrationDisposer = scheduleMigration(provider as any);
};
