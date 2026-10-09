// @vitest-environment jsdom
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { normalizeNode } from '../../../engine/document/normalize';
import type { AnyNode } from '../../../engine/model/schema';
import type { Bounds, Rect } from '../../../engine/interaction/railPlacement';
import { MultiRail } from './MultiRail';
import { RailMenuButton } from '../RailBase';
import { setRailSubject } from '../railSubject';
import { setAlignKey } from '../../../engine/arrange/preview';
import { overlapArea } from './popoverPlacement';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

/**
 * jsdom lays nothing out, so the geometry the popover reads is given here: the
 * rail's box, the Align button's box, and the panel's natural size.
 */
const PANEL = { width: 268, height: 330 };
let railBox: Rect = { x: 0, y: 0, width: 0, height: 0 };
let triggerBox: Rect = { x: 0, y: 0, width: 0, height: 0 };

const domRect = (r: Rect) =>
  ({ x: r.x, y: r.y, left: r.x, top: r.y, width: r.width, height: r.height, right: r.x + r.width, bottom: r.y + r.height, toJSON() {} }) as DOMRect;

const original = {
  rect: HTMLElement.prototype.getBoundingClientRect,
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'),
};

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains('ctx-toolbar')) return domRect(railBox);
    if (this.querySelector(':scope > button[aria-label="Align and distribute"]')) return domRect(triggerBox);
    return domRect({ x: 0, y: 0, width: 0, height: 0 });
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('ctx-popover') ? PANEL.width : 0;
    },
  });
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) {
      return this.classList.contains('ctx-popover') ? PANEL.height : 0;
    },
  });
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = original.rect;
  if (original.offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', original.offsetWidth);
  if (original.scrollHeight) Object.defineProperty(Element.prototype, 'scrollHeight', original.scrollHeight);
});

afterEach(() => {
  cleanup();
  setRailSubject(null);
  setAlignKey({ target: 'selection', key: null, picking: null });
});

const shape = (id: string, x: number, y: number): AnyNode =>
  normalizeNode({ id, type: 'shape', x, y, width: 100, height: 60, geometry: { kind: 'rect' } });

/** Six objects, as the rail sees them. */
const nodes = [0, 1, 2, 3, 4, 5].map((i) => shape(`s${i}`, (i % 3) * 140, Math.floor(i / 3) * 100));

const ROOM: Bounds = { top: 8, left: 8, right: 1432, bottom: 900 - 211 - 8 };

/** Stand the rail above `subject` and open Align. Returns the panel's rect on screen. */
function openAlign(subject: Rect): Rect {
  railBox = { x: subject.x + subject.width / 2 - 180, y: subject.y - 66, width: 360, height: 40 };
  triggerBox = { x: railBox.x + 4, y: railBox.y + 4, width: 32, height: 32 };
  setRailSubject({ subject, bounds: ROOM, side: 'top', room: ROOM, obstacles: [] });
  const { getByLabelText, getByRole } = render(
    <div className="ctx-toolbar">
      <MultiRail nodes={nodes} ids={nodes.map((n) => n.id)} conditional={null} tail={<RailMenuButton entries={() => []} />} tailControls={1} />
    </div>
  );
  fireEvent.click(getByLabelText('Align and distribute'));
  const panel = getByRole('dialog', { name: 'Align and distribute' });
  const [dx, dy] = (panel.style.translate || '0px 0px').split(' ').map((v) => Number.parseFloat(v));
  const maxHeight = Number.parseFloat(panel.style.maxHeight);
  return { x: triggerBox.x + dx, y: triggerBox.y + dy, width: PANEL.width, height: Number.isFinite(maxHeight) ? maxHeight : PANEL.height };
}

describe('rail popover placement', () => {
  it('opens Align upward, off the selection, mid-board', () => {
    const subject = { x: 500, y: 420, width: 400, height: 220 };
    const panel = openAlign(subject);
    expect(panel.y + panel.height).toBeLessThanOrEqual(railBox.y);
    expect(overlapArea(panel, subject)).toBe(0);
  });

  it('stands Align beside the selection when there is no room above the rail', () => {
    const subject = { x: 500, y: 150, width: 400, height: 220 };
    const panel = openAlign(subject);
    expect(overlapArea(panel, subject)).toBe(0);
    // Clear by the live halo too: the ghosts and the Key tag draw there.
    expect(overlapArea(panel, { x: subject.x - 24, y: subject.y - 24, width: subject.width + 48, height: subject.height + 48 })).toBe(0);
    expect(panel.y).toBe(railBox.y);
  });
});
