// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup } from '@testing-library/react';
import Konva from 'konva';
import { nodesOf, renderInStage } from '../../test/konvaHarness';
import { RotateZones } from '../../components/canvas/RotateZones';
import { cameraSystem } from '../CameraSystem';
import { reachAt, rotateZones, type Box } from './rotateHandle';

/**
 * `RotateZones` must place its zones from the `box` it is given and start a
 * turn from the `rotation` it is given, never from the transformer's proxy.
 *
 * The proxy is positioned by its centre (with an offset so Konva turns it
 * about its middle) and is reset to rotation 0 between gestures. Read as a
 * top-left it puts every zone half a box down and to the right; read as a
 * start angle it throws a turned object back to square before turning it.
 * Here the proxy deliberately disagrees with the props on both counts.
 */

const BOX: Box = { x: 100, y: 50, width: 200, height: 100 };

/** A proxy that is wrong in exactly the way the real one is. */
function centredProxy(): Konva.Rect {
  return new Konva.Rect({
    x: BOX.x + BOX.width / 2,
    y: BOX.y + BOX.height / 2,
    width: BOX.width,
    height: BOX.height,
    offsetX: BOX.width / 2,
    offsetY: BOX.height / 2,
    rotation: 0,
  });
}

function mount(rotation: number) {
  const proxy = centredProxy();
  const handlers = { onStart: vi.fn(), onMove: vi.fn(), onEnd: vi.fn() };
  const stage = renderInStage(
    createElement(RotateZones, {
      box: BOX,
      rotation,
      proxyRef: { current: proxy },
      transforming: false,
      ...handlers,
    })
  );
  const zones = nodesOf<Konva.Rect>(stage, 'Rect').filter((r) => r.fill() === 'transparent');
  return { stage, proxy, zones, ...handlers };
}

afterEach(cleanup);

describe('RotateZones', () => {
  it('places its zones from the box prop', () => {
    const { zones } = mount(0);
    const expected = rotateZones(BOX, reachAt(cameraSystem.zoom));
    expect(zones).toHaveLength(expected.length);
    zones.forEach((zone, i) => {
      expect({ x: zone.x(), y: zone.y(), width: zone.width(), height: zone.height() }).toEqual(expected[i]);
    });
  });

  it('starts a turn from the rotation prop, not from the proxy', () => {
    const { stage, proxy, zones, onStart, onMove } = mount(30);
    expect(proxy.rotation()).toBe(0);

    // Press on the top-left zone, then move the pointer a hair.
    const press = { clientX: BOX.x, clientY: BOX.y };
    stage.setPointersPositions(press as unknown as MouseEvent);
    act(() => {
      zones[0].fire('mousedown', { evt: new MouseEvent('mousedown', press) }, true);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: BOX.x + 1, clientY: BOX.y }) as PointerEvent);
    });

    expect(onStart).toHaveBeenCalledWith('rotate');
    expect(onMove).toHaveBeenCalled();
    // A one-pixel move turns the object by well under a degree from where it
    // was. Starting from the proxy would put it near 0 instead.
    expect(Math.abs(proxy.rotation() - 30)).toBeLessThan(2);

    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup'));
    });
  });
});
