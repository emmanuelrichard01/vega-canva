import { describe, expect, it } from 'vitest';
import { cursorForAnchor } from './resizeCursor';

describe('cursorForAnchor', () => {
  it('points along the drag on an unrotated selection', () => {
    expect(cursorForAnchor('top-center', 0)).toBe('ns-resize');
    expect(cursorForAnchor('bottom-center', 0)).toBe('ns-resize');
    expect(cursorForAnchor('middle-left', 0)).toBe('ew-resize');
    expect(cursorForAnchor('middle-right', 0)).toBe('ew-resize');
    expect(cursorForAnchor('top-left', 0)).toBe('nwse-resize');
    expect(cursorForAnchor('bottom-right', 0)).toBe('nwse-resize');
    expect(cursorForAnchor('top-right', 0)).toBe('nesw-resize');
    expect(cursorForAnchor('bottom-left', 0)).toBe('nesw-resize');
  });

  it('follows the object round a quarter turn', () => {
    // The whole point: at 90° the top edge is now on the right, so the handle
    // that used to pull north/south pulls east/west. A fixed cursor here would
    // point across the drag rather than along it.
    expect(cursorForAnchor('top-center', 90)).toBe('ew-resize');
    expect(cursorForAnchor('middle-right', 90)).toBe('ns-resize');
    expect(cursorForAnchor('top-left', 90)).toBe('nesw-resize');
  });

  it('reads the same at a half turn, because these cursors are symmetric', () => {
    // A double-headed arrow has no front, so 180° must look identical to 0°.
    for (const name of ['top-center', 'middle-left', 'top-left', 'bottom-right']) {
      expect(cursorForAnchor(name, 180)).toBe(cursorForAnchor(name, 0));
    }
  });

  it('snaps to the nearest eighth rather than drifting', () => {
    // Anything short of 22.5° away should still resolve to the same cursor.
    expect(cursorForAnchor('top-center', 20)).toBe('ns-resize');
    expect(cursorForAnchor('top-center', -20)).toBe('ns-resize');
    // And past it, to the next one round.
    expect(cursorForAnchor('top-center', 46)).toBe('nesw-resize');
  });

  it('handles negative and over-wound rotations', () => {
    // Dragging anticlockwise produces negative degrees, and a node turned
    // several times can hold well over 360 — neither may index off the table.
    expect(cursorForAnchor('top-center', -90)).toBe('ew-resize');
    expect(cursorForAnchor('top-center', 450)).toBe('ew-resize');
    expect(cursorForAnchor('top-center', -450)).toBe('ew-resize');
  });

  it('gives rotation its own cursor and refuses unknown anchors', () => {
    expect(cursorForAnchor('rotater', 0)).toBe('grab');
    expect(cursorForAnchor('rotater', 137)).toBe('grab');
    expect(cursorForAnchor('not-an-anchor', 0)).toBe('default');
  });
});
