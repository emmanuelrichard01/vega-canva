import { create } from 'zustand';
import { normalizeNode, objectsMap, observeNodes, provider, scheduleMigration } from '../engine/document';
import type { AnyNode } from '../engine/model/schema';
import { sceneGraph } from '../engine/SceneGraph';

interface StoreState {
  /** Latest snapshot of every node, keyed by id. */
  objects: Record<string, AnyNode>;
  /** Bumped on every applied change, for coarse subscriptions. */
  version: number;
  isReplaying: boolean;
  setIsReplaying: (val: boolean) => void;
  setObjects: (objects: Record<string, AnyNode>) => void;
  zenMode: boolean;
  setZenMode: (val: boolean) => void;
  /** Global physics on/off, persisted so turning it off sticks across visits. */
  physicsEnabled: boolean;
  setPhysicsEnabled: (val: boolean) => void;
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
  isReplaying: false,
  setIsReplaying: (val) => set({ isReplaying: val }),
  setObjects: (objects) => set({ objects }),
  zenMode: false,
  setZenMode: (val) => set({ zenMode: val }),
  physicsEnabled: loadBoolPref('vega_physics_enabled', true),
  setPhysicsEnabled: (val) => {
    window.localStorage.setItem('vega_physics_enabled', String(val));
    set({ physicsEnabled: val });
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
  useStore.setState({ objects: initialObjects, version: 1 });

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

      return { objects, version: state.version + 1 };
    });
  });

  // Converge the stored document too, once the server state has arrived.
  migrationDisposer = scheduleMigration(provider as any);
};
