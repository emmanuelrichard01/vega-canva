// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { normalizeNode } from '../../../engine/document/normalize';
import { useStore } from '../../../hooks/useStore';
import { cameraSystem } from '../../../engine/CameraSystem';
import { useRailPlacement } from './useRailPlacement';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

/** Frames run only when the test says so. */
let frames: FrameRequestCallback[] = [];
const runFrame = () => {
  const due = frames;
  frames = [];
  due.forEach((fn) => fn(performance.now()));
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.assign(cameraSystem, { x: 0, y: 0, zoom: 1 });
  useStore.setState({
    objects: { s: normalizeNode({ id: 's', type: 'shape', x: 300, y: 300, width: 100, height: 60, geometry: { kind: 'rect' } }) },
  } as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A host that, like the real bars, renders the rail only once it should show. */
const Host: React.FC = () => {
  const { anchorRef, railRef, isVisible } = useRailPlacement({
    activeId: 's',
    isBulk: false,
    selectedIds: ['s'],
    sidebarsVisible: true,
  });
  if (!isVisible) return null;
  return (
    <div ref={anchorRef} data-testid="anchor">
      <div ref={railRef}>rail</div>
    </div>
  );
};

describe('useRailPlacement', () => {
  it('places the rail in the commit that mounts it, without waiting for another trigger', () => {
    const { queryByTestId } = render(<Host />);
    expect(queryByTestId('anchor')).toBeNull();
    // The first frame decides the rail should show; the rail mounts on that.
    act(() => runFrame());
    const anchor = queryByTestId('anchor');
    expect(anchor).not.toBeNull();
    // No further frame has run, and nothing else moved: it is already placed.
    expect(anchor!.style.transform).toMatch(/^translate3d\(\d+px, \d+px, 0\)$/);
  });
});
