import { beforeEach, describe, expect, it, vi } from 'vitest';

const camera = { x: 0, y: 0, zoom: 1, width: 1000, height: 800, zoomLimits: { minZoom: 0.1, maxZoom: 8 }, setPose: vi.fn() };
const people = new Map<number, { clientId: number; viewport: unknown }>();
let frame: ((dt: number) => void) | null = null;
const updateFollowing = vi.fn();

vi.mock('../CameraSystem', () => ({ cameraSystem: camera }));
vi.mock('./PresenceManager', () => ({ presenceManager: { updateFollowing } }));
vi.mock('./collaboratorStore', () => ({
  collaboratorStore: {
    find: (id: number) => people.get(id),
    onFrame: (fn: (dt: number) => void) => {
      frame = fn;
      return () => {
        frame = null;
      };
    },
  },
}));

const { followMode } = await import('./followMode');

const viewport = { x: 500, y: 400, width: 1000, height: 800, zoom: 1 };

beforeEach(() => {
  followMode.stop();
  people.clear();
  people.set(7, { clientId: 7, viewport });
  camera.x = 0;
  camera.y = 0;
  camera.zoom = 1;
  camera.setPose.mockReset();
  camera.setPose.mockImplementation((x: number, y: number, zoom: number) => {
    camera.x = x;
    camera.y = y;
    camera.zoom = zoom;
  });
  updateFollowing.mockReset();
});

describe('follow mode', () => {
  it('attaches, says so to the room, and drives the camera', () => {
    followMode.start(7);
    expect(followMode.getSnapshot()).toBe(7);
    expect(updateFollowing).toHaveBeenCalledWith(7);
    frame?.(16);
    expect(camera.setPose).toHaveBeenCalled();
  });

  it('stops by itself when the viewer moves the camera', () => {
    followMode.start(7);
    frame?.(16);
    // A pan the driver did not write.
    camera.x += 240;
    frame?.(16);
    expect(followMode.getSnapshot()).toBeNull();
    expect(followMode.lastReason()).toBe('manual');
    expect(updateFollowing).toHaveBeenLastCalledWith(null);
  });

  it('stops when the person leaves the room', () => {
    followMode.start(7);
    people.delete(7);
    frame?.(16);
    expect(followMode.getSnapshot()).toBeNull();
    expect(followMode.lastReason()).toBe('left');
  });

  it('holds position, and keeps following, while they have no view yet', () => {
    people.set(7, { clientId: 7, viewport: null });
    followMode.start(7);
    frame?.(16);
    expect(followMode.getSnapshot()).toBe(7);
    expect(camera.setPose).not.toHaveBeenCalled();
  });

  it('toggles off on a second press and detaches its frame callback', () => {
    followMode.toggle(7);
    followMode.toggle(7);
    expect(followMode.getSnapshot()).toBeNull();
    expect(frame).toBeNull();
  });
});
