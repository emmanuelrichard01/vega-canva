import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * React, reduced to the two hooks this file uses.
 *
 * The same shape `useCanvasNavigation.test.ts` uses, and for the same reason:
 * the behaviour under test is an effect body and a ref, not a render tree, and
 * a real renderer would add a dependency to assert something neither of them
 * needs.
 */
const refs: Array<{ current: unknown }> = [];
let cleanup: (() => void) | undefined;
vi.mock('react', () => {
  const useRef = (init: unknown) => {
    const ref = { current: init };
    refs.push(ref);
    return ref;
  };
  const useEffect = (fn: () => (() => void) | void) => {
    cleanup = fn() ?? undefined;
  };
  return { default: { useRef, useEffect }, useRef, useEffect };
});

const camera = { x: 0, y: 0, zoom: 1, measured: false, setPose: vi.fn() };
vi.mock('../engine/CameraSystem', () => ({ cameraSystem: camera }));

let bounds: { x: number; y: number; width: number; height: number } | null = null;
const zoomToFit = vi.fn();
vi.mock('../engine/api/EditorAPI', () => ({
  editor: {
    contentBounds: () => bounds,
    zoomToFit: () => zoomToFit(),
  },
}));

const { engineEvents } = await import('../engine/EventBus');
const { useOpeningFrame } = await import('./useOpeningFrame');

/**
 * The real fault: fitting emits `CameraChanged` synchronously, and this hook
 * listens for `CameraChanged`. Every mock of `zoomToFit` therefore has to emit
 * too, or the test cannot see the bug it exists to catch.
 */
const fitEmits = () => engineEvents.emit('CameraChanged');

beforeEach(() => {
  refs.length = 0;
  cleanup?.();
  cleanup = undefined;
  camera.measured = false;
  camera.setPose.mockClear();
  zoomToFit.mockClear();
  zoomToFit.mockImplementation(fitEmits);
  bounds = null;
  vi.useFakeTimers();
});

describe('framing a board when it opens', () => {
  it('fits once, and does not re-enter itself doing it', () => {
    /**
     * The bug this is here for. `attempt` marked itself done *after* calling
     * `zoomToFit`, and `zoomToFit` emits into the very listener that called
     * it — so the re-entrant call saw an unset flag, fitted again, and
     * recursed until the stack blew. The camera then ended up not fitted at
     * all, which is a re-entrancy bug wearing the costume of a feature that
     * silently does nothing.
     *
     * `toHaveBeenCalledTimes(1)` is the assertion; not throwing is the other
     * half, and an unguarded version cannot reach the assertion at all.
     */
    camera.measured = true;
    bounds = { x: 400, y: 100, width: 250, height: 200 };

    useOpeningFrame('room-a');

    expect(zoomToFit).toHaveBeenCalledTimes(1);
  });

  it('waits for the viewport before framing against a placeholder', () => {
    // `width`/`height` start at 800x600, which is a plausible window rather
    // than an obviously-absent one — framing against it puts the board
    // somewhere nobody chose.
    bounds = { x: 400, y: 100, width: 250, height: 200 };
    useOpeningFrame('room-a');
    expect(zoomToFit).not.toHaveBeenCalled();

    // ...and frames as soon as the canvas reports a real one.
    camera.measured = true;
    engineEvents.emit('CameraChanged');
    expect(zoomToFit).toHaveBeenCalledTimes(1);
  });

  it('waits for content, because the document arrives after the mount', () => {
    camera.measured = true;
    useOpeningFrame('room-a');
    expect(zoomToFit).not.toHaveBeenCalled();

    bounds = { x: 0, y: 0, width: 10, height: 10 };
    engineEvents.emit('VisibleSetUpdated');
    expect(zoomToFit).toHaveBeenCalledTimes(1);
  });

  it('does not drag the camera again once it has framed', () => {
    /**
     * Re-framing on every change would move the board out from under someone
     * each time a collaborator dropped a shape off-screen — which is a worse
     * bug than the one being fixed, because it happens while you are working
     * rather than before you start.
     */
    camera.measured = true;
    bounds = { x: 0, y: 0, width: 10, height: 10 };
    useOpeningFrame('room-a');
    zoomToFit.mockClear();

    bounds = { x: 0, y: 0, width: 5000, height: 5000 };
    engineEvents.emit('ObjectAdded');
    engineEvents.emit('VisibleSetUpdated');
    engineEvents.emit('CameraChanged');
    expect(zoomToFit).not.toHaveBeenCalled();
  });

  it('puts an empty board at the origin, and then stands down', () => {
    /**
     * An empty board has no first content to wait for, so without this the
     * listeners stayed armed for the life of the room and the first object
     * anyone drew yanked the camera to frame it.
     */
    camera.measured = true;
    bounds = null;
    useOpeningFrame('room-a');
    vi.advanceTimersByTime(3000);

    expect(camera.setPose).toHaveBeenCalledWith(0, 0, 1);

    bounds = { x: 900, y: 900, width: 40, height: 40 };
    engineEvents.emit('ObjectAdded');
    expect(zoomToFit).not.toHaveBeenCalled();
  });

  it('stops listening when the room is left', () => {
    // The listeners are on a module-level bus that outlives the component, so
    // a hook that forgets to detach leaks one per room visited.
    camera.measured = true;
    useOpeningFrame('room-a');
    cleanup?.();
    cleanup = undefined;

    bounds = { x: 0, y: 0, width: 10, height: 10 };
    engineEvents.emit('VisibleSetUpdated');
    expect(zoomToFit).not.toHaveBeenCalled();
  });
});
