import { describe, expect, it } from 'vitest';
import { GestureRecognizer, LONG_PRESS_MS, type GestureEffect, type GestureInput } from './gestures';

const ev = (
  kind: GestureInput['kind'],
  id: number,
  x: number,
  y: number,
  t: number,
  pointerType: GestureInput['pointerType'] = 'touch'
): GestureInput => ({ kind, id, x, y, t, pointerType });

const types = (effects: GestureEffect[]) => effects.map((e) => e.type);

/** Sum every camera effect into one net pan and zoom. */
function net(effects: GestureEffect[]) {
  let panX = 0;
  let panY = 0;
  let scale = 1;
  for (const e of effects) {
    if (e.type !== 'camera') continue;
    panX += e.panX;
    panY += e.panY;
    scale *= e.scale;
  }
  return { panX, panY, scale };
}

describe('GestureRecognizer', () => {
  it('gives a single finger to the tool', () => {
    const g = new GestureRecognizer();
    expect(g.handle(ev('down', 1, 100, 100, 0))).toEqual([]);
    expect(g.owner).toBe('touch');
    expect(g.handle(ev('move', 1, 160, 100, 20))).toEqual([]);
    expect(g.navigating).toBe(false);
  });

  it('cancels the one-finger action when a second finger lands', () => {
    const g = new GestureRecognizer();
    g.handle(ev('down', 1, 100, 100, 0));
    g.handle(ev('move', 1, 140, 100, 30));
    expect(types(g.handle(ev('down', 2, 300, 100, 60)))).toEqual(['cancel-primary']);
    expect(g.owner).toBe('none');
    expect(g.navigating).toBe(true);
  });

  it('pans with two fingers and does not jump when the second arrives', () => {
    const g = new GestureRecognizer();
    g.handle(ev('down', 1, 100, 100, 0));
    // The landing itself moves nothing.
    expect(g.handle(ev('down', 2, 200, 100, 5)).filter((e) => e.type === 'camera')).toEqual([]);
    // Within the slop: nothing yet.
    expect(g.handle(ev('move', 1, 105, 100, 10))).toEqual([]);
    // The browser moves one finger per event; the pan must still be a pan.
    const out: GestureEffect[] = [];
    for (let k = 1; k <= 10; k++) {
      out.push(...g.handle(ev('move', 1, 100 + k * 8, 100 + k * 5, 10 + k * 16)));
      out.push(...g.handle(ev('move', 2, 200 + k * 8, 100 + k * 5, 10 + k * 16)));
    }
    const { panX, panY, scale } = net(out);
    // The board follows the fingers from where they landed.
    expect(panX).toBeCloseTo(80);
    expect(panY).toBeCloseTo(50);
    expect(scale).toBeCloseTo(1);
  });

  it('pinch-zooms about the centroid', () => {
    const g = new GestureRecognizer();
    g.handle(ev('down', 1, 100, 100, 0));
    g.handle(ev('down', 2, 200, 100, 0));
    // Spread symmetrically: the centroid stays at 150.
    const out = [
      ...g.handle(ev('move', 1, 80, 100, 20)),
      ...g.handle(ev('move', 2, 220, 100, 20)),
      ...g.handle(ev('move', 1, 45, 100, 40)),
      ...g.handle(ev('move', 2, 255, 100, 40)),
    ];
    const { panX, scale } = net(out);
    // Finger 1 clears the slop on its first move; the span goes 100 -> 210.
    expect(scale).toBeCloseTo(210 / 100);
    expect(panX).toBeCloseTo(0);
    const last = out.filter((e) => e.type === 'camera').pop();
    expect(last).toMatchObject({ cx: 150, cy: 100 });
  });

  it('re-baselines when a finger lifts, so the others do not jump', () => {
    const g = new GestureRecognizer();
    g.handle(ev('down', 1, 100, 100, 0));
    g.handle(ev('down', 2, 300, 100, 0));
    g.handle(ev('move', 1, 120, 100, 400));
    g.handle(ev('up', 2, 300, 100, 420));
    // Centroid was 210; with one finger it is 120. No camera effect for that.
    expect(g.handle(ev('move', 1, 120, 100, 440))).toEqual([]);
    expect(net(g.handle(ev('move', 1, 130, 100, 460))).panX).toBeCloseTo(10);
  });

  it('long-press cancels the press and asks for the menu', () => {
    const g = new GestureRecognizer();
    g.handle(ev('down', 1, 50, 60, 1000));
    g.handle(ev('move', 1, 54, 62, 1100)); // within the slop
    expect(g.nextDeadline()).toBe(1000 + LONG_PRESS_MS);
    expect(g.tick(1000 + LONG_PRESS_MS - 1)).toEqual([]);
    const out = g.tick(1000 + LONG_PRESS_MS);
    expect(out).toEqual([{ type: 'cancel-primary' }, { type: 'long-press', x: 54, y: 62 }]);
    expect(g.owner).toBe('none');
    // Nothing more comes of the same finger.
    expect(g.handle(ev('move', 1, 200, 200, 1600))).toEqual([]);
    expect(g.handle(ev('up', 1, 200, 200, 1700))).toEqual([]);
    expect(g.navigating).toBe(false);
  });

  it('a press that travels is not a long-press', () => {
    const g = new GestureRecognizer();
    g.handle(ev('down', 1, 50, 60, 0));
    g.handle(ev('move', 1, 70, 60, 100));
    expect(g.nextDeadline()).toBeNull();
    expect(g.tick(LONG_PRESS_MS * 2)).toEqual([]);
  });

  it('reports a double-tap, and not for two distant taps', () => {
    const g = new GestureRecognizer();
    g.handle(ev('down', 1, 100, 100, 0));
    expect(g.handle(ev('up', 1, 100, 100, 80))).toEqual([]);
    g.handle(ev('down', 2, 104, 102, 200));
    expect(g.handle(ev('up', 2, 104, 102, 260))).toEqual([{ type: 'double-tap', x: 104, y: 102 }]);

    const far = new GestureRecognizer();
    far.handle(ev('down', 1, 100, 100, 0));
    far.handle(ev('up', 1, 100, 100, 80));
    far.handle(ev('down', 2, 300, 300, 200));
    expect(far.handle(ev('up', 2, 300, 300, 260))).toEqual([]);
  });

  it('two-finger tap is undo, three-finger tap is redo', () => {
    const two = new GestureRecognizer();
    two.handle(ev('down', 1, 100, 100, 0));
    two.handle(ev('down', 2, 200, 100, 30));
    two.handle(ev('up', 1, 100, 100, 120));
    expect(types(two.handle(ev('up', 2, 200, 100, 140)))).toEqual(['undo']);

    const three = new GestureRecognizer();
    three.handle(ev('down', 1, 100, 100, 0));
    three.handle(ev('down', 2, 200, 100, 10));
    three.handle(ev('down', 3, 300, 100, 20));
    three.handle(ev('up', 1, 100, 100, 150));
    three.handle(ev('up', 2, 200, 100, 150));
    expect(types(three.handle(ev('up', 3, 300, 100, 160)))).toEqual(['redo']);
  });

  it('a pinch is never also an undo', () => {
    const g = new GestureRecognizer();
    g.handle(ev('down', 1, 100, 100, 0));
    g.handle(ev('down', 2, 200, 100, 0));
    g.handle(ev('move', 2, 260, 100, 50));
    g.handle(ev('up', 1, 100, 100, 100));
    expect(g.handle(ev('up', 2, 260, 100, 120))).toEqual([]);
  });

  it('a slow two-finger hold is not an undo', () => {
    const g = new GestureRecognizer();
    g.handle(ev('down', 1, 100, 100, 0));
    g.handle(ev('down', 2, 200, 100, 0));
    g.handle(ev('up', 1, 100, 100, 900));
    expect(g.handle(ev('up', 2, 200, 100, 900))).toEqual([]);
  });

  it('ignores the mouse entirely', () => {
    const g = new GestureRecognizer();
    expect(g.handle(ev('down', 1, 0, 0, 0, 'mouse'))).toEqual([]);
    expect(g.handle(ev('move', 1, 50, 0, 10, 'mouse'))).toEqual([]);
    expect(g.nextDeadline()).toBeNull();
    expect(g.owner).toBe('none');
  });

  describe('pen versus touch', () => {
    it('gives the pen the tool and ignores a resting palm', () => {
      const g = new GestureRecognizer();
      g.handle(ev('down', 9, 10, 10, 0, 'pen'));
      expect(g.owner).toBe('pen');
      // Palm lands while drawing: no tool, no camera, no undo.
      expect(g.handle(ev('down', 1, 400, 400, 20))).toEqual([]);
      expect(g.handle(ev('move', 1, 420, 430, 40))).toEqual([]);
      expect(g.handle(ev('up', 1, 420, 430, 60))).toEqual([]);
      expect(g.owner).toBe('pen');
    });

    it('cancels what a palm started before the pen arrived', () => {
      const g = new GestureRecognizer();
      g.handle(ev('down', 1, 400, 400, 0));
      expect(types(g.handle(ev('down', 9, 10, 10, 30, 'pen')))).toEqual(['cancel-primary']);
      expect(g.tick(LONG_PRESS_MS * 3)).toEqual([]);
    });

    it('once a pen has been used, one finger pans', () => {
      const g = new GestureRecognizer();
      g.handle(ev('down', 9, 10, 10, 0, 'pen'));
      g.handle(ev('up', 9, 10, 10, 50, 'pen'));
      g.handle(ev('down', 1, 100, 100, 100));
      expect(g.owner).toBe('none');
      expect(g.penMode).toBe(true);
      expect(net(g.handle(ev('move', 1, 130, 90, 120)))).toMatchObject({ panX: 30, panY: -10, scale: 1 });
      expect(g.nextDeadline()).toBeNull();
    });
  });
});
