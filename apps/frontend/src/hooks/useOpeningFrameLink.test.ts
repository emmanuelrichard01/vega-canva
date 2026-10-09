import { beforeEach, describe, expect, it, vi } from 'vitest';

const cleanups: Array<() => void> = [];
vi.mock('react', () => {
  const useRef = (init: unknown) => ({ current: init });
  const useEffect = (fn: () => (() => void) | void) => {
    const c = fn();
    if (c) cleanups.push(c);
  };
  return { default: { useRef, useEffect }, useRef, useEffect };
});

vi.mock('../engine/CameraSystem', () => ({ cameraSystem: { measured: true, setPose: vi.fn() } }));
const zoomToFit = vi.fn();
const zoomToNodes = vi.fn();
vi.mock('../engine/api/EditorAPI', () => ({
  editor: { contentBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }), zoomToFit: () => zoomToFit(), zoomToNodes: (n: unknown) => zoomToNodes(n) },
}));
const objects: Record<string, unknown> = {};
vi.mock('./useStore', () => ({ useStore: { getState: () => ({ objects }) } }));

const { useOpeningFrame } = await import('./useOpeningFrame');

const replaceState = vi.fn();
function openAt(search: string) {
  vi.stubGlobal('window', {
    location: { search, pathname: '/room/abc', hash: '' },
    history: { state: null, replaceState },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  });
  vi.stubGlobal('CustomEvent', class {});
  useOpeningFrame('abc');
}

beforeEach(() => {
  cleanups.splice(0).forEach((c) => c());
  zoomToFit.mockClear();
  zoomToNodes.mockClear();
  replaceState.mockClear();
  for (const k of Object.keys(objects)) delete objects[k];
});

describe('opening on a frame link', () => {
  it('zooms to the named frame and drops the parameter from the address', () => {
    const frame = { id: 'f1', type: 'frame' };
    objects.f1 = frame;
    openAt('?frame=f1&x=1');
    expect(zoomToNodes).toHaveBeenCalledWith([frame]);
    expect(zoomToFit).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/room/abc?x=1');
  });

  it('fits the whole board when the frame is gone or is not a frame', () => {
    objects.n1 = { id: 'n1', type: 'shape' };
    openAt('?frame=missing');
    expect(zoomToFit).toHaveBeenCalledTimes(1);
    expect(zoomToNodes).not.toHaveBeenCalled();
    cleanups.splice(0).forEach((c) => c());
    openAt('?frame=n1');
    expect(zoomToNodes).not.toHaveBeenCalled();
  });
});
