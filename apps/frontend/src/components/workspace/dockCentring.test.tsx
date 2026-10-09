// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { FLYOUT_EDGE, NOTCH_CLEARANCE, centreOnDock, useDockCentred, useFreeStrip } from './boardLayout';

afterEach(cleanup);

const base = { dockCentre: 720, width: 408, viewport: 1440, insets: { left: 0, right: 0 } };

describe('centreOnDock', () => {
  it.each([200, 480, 720, 900, 1300])('lands the flyout on the dock centre from a seat at %i', (seat) => {
    const { dx } = centreOnDock({ ...base, anchorCentre: seat });
    const centre = seat + dx;
    expect(Math.abs(centre - base.dockCentre)).toBeLessThanOrEqual(0.5);
  });

  it('shows no notch for a seat under the centre', () => {
    expect(centreOnDock({ ...base, anchorCentre: 720 }).notch).toBeNull();
    expect(centreOnDock({ ...base, anchorCentre: 721 }).notch).toBeNull();
  });

  it('points the notch at the seat, measured from the flyout edge', () => {
    const left = 720 - 204;
    expect(centreOnDock({ ...base, anchorCentre: 600 }).notch).toBeCloseTo(600 - left);
    expect(centreOnDock({ ...base, anchorCentre: 900 }).notch).toBeCloseTo(900 - left);
  });

  it('keeps the notch off the rounded corners', () => {
    expect(centreOnDock({ ...base, anchorCentre: 100 }).notch).toBe(NOTCH_CLEARANCE);
    expect(centreOnDock({ ...base, anchorCentre: 1400 }).notch).toBe(base.width - NOTCH_CLEARANCE);
  });

  it('holds the flyout inside the free strip with 8px to spare', () => {
    const insets = { left: 300, right: 300 };
    const { dx } = centreOnDock({ ...base, insets, dockCentre: 400, anchorCentre: 400 });
    expect(400 + dx - base.width / 2).toBe(insets.left + FLYOUT_EDGE);
    const right = centreOnDock({ ...base, insets, dockCentre: 1100, anchorCentre: 1100 });
    expect(1100 + right.dx + base.width / 2).toBe(1440 - insets.right - FLYOUT_EDGE);
  });
});

/** jsdom has no layout: give each element the box the test says it has. */
function box(el: Element, left: number, width: number) {
  el.getBoundingClientRect = () => ({ left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON() {} }) as DOMRect;
}

const Fixture: React.FC<{ seats: number[] }> = ({ seats }) => {
  const ref = useDockCentred(true);
  return (
    <div className="tool-dock" data-testid="dock">
      {seats.map((s, i) => (
        <div key={i} className="dock-slot" data-seat={s}>
          {i === 0 && <div ref={ref} className="dock-flyout" data-testid="flyout" />}
        </div>
      ))}
    </div>
  );
};

describe('useDockCentred', () => {
  it('puts the flyout on the dock centre and the notch on the seat', () => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 408 });
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    const { getByTestId, container } = render(<Fixture seats={[300]} />);
    // Re-run the measurement with real boxes: dock 400..1040 (centre 720), seat centre 600.
    const dock = getByTestId('dock');
    const slot = container.querySelector('.dock-slot')!;
    box(dock, 400, 640);
    box(slot, 576, 48);
    const flyout = getByTestId('flyout');
    // The observers do not fire in jsdom: a resize re-measures.
    window.dispatchEvent(new Event('resize'));
    const dx = parseFloat(flyout.style.getPropertyValue('--fly-dx'));
    // Natural centre is the seat's (600); centred on the dock means 720.
    expect(Math.abs(600 + dx - 720)).toBeLessThanOrEqual(0.5);
    expect(flyout.hasAttribute('data-notch')).toBe(true);
    const notch = parseFloat(flyout.style.getPropertyValue('--notch-x'));
    expect(notch).toBeCloseTo(600 - (720 - 204));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
  });
});

describe('useFreeStrip', () => {
  it('is the window less the open columns, and follows a column opening', async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    const seen: number[] = [];
    const Probe: React.FC = () => {
      seen.push(useFreeStrip());
      return null;
    };
    const left = document.createElement('div');
    left.className = 'hierarchy-panel';
    left.getBoundingClientRect = () => ({ left: 0, right: 288, width: 288 }) as DOMRect;
    const right = document.createElement('div');
    right.className = 'context-inspector';
    right.getBoundingClientRect = () => ({ left: 800, right: 1024, width: 224 }) as DOMRect;
    document.body.append(left, right);
    render(<Probe />);
    expect(seen[seen.length - 1]).toBe(1024);
    act(() => {
      document.documentElement.dataset.leftPanel = 'open';
      document.documentElement.dataset.rightPanel = 'open';
      window.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => expect(seen[seen.length - 1]).toBe(1024 - 288 - 224));
    left.remove();
    right.remove();
    delete document.documentElement.dataset.leftPanel;
    delete document.documentElement.dataset.rightPanel;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
  });
});
