// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { boardRegions, dockLeft, nextRegion, PANELS_CAP, PANELS_KEY, readPanelState, writePanelState } from './boardLayout';

function regions() {
  document.body.innerHTML = `
    <aside data-region="3"><button id="props">p</button></aside>
    <nav data-region="0"><button id="name">n</button></nav>
    <div data-region="1" tabindex="-1" role="application" id="canvas"></div>
    <div data-region="2"><button id="dock">d</button></div>`;
  return boardRegions();
}

describe('board regions', () => {
  it('reads regions in their declared order, not document order', () => {
    expect(regions().map((r) => r.dataset.region)).toEqual(['0', '1', '2', '3']);
  });

  it('moves forward and back from wherever focus is, wrapping at both ends', () => {
    const r = regions();
    const props = document.getElementById('props');
    expect(nextRegion(r, props, false)?.dataset.region).toBe('0');
    expect(nextRegion(r, props, true)?.dataset.region).toBe('2');
    expect(nextRegion(r, document.getElementById('name'), true)?.dataset.region).toBe('3');
  });

  it('starts at the first region when focus is outside all of them', () => {
    expect(nextRegion(regions(), document.body, false)?.dataset.region).toBe('0');
  });
});

describe('dock placement', () => {
  const DOCK = 517; // an odd width, which a half-width translate would put on half a pixel

  it('is centred on the window, on a whole pixel, whatever the columns do', () => {
    for (const viewport of [1440, 1280]) {
      const closed = dockLeft(viewport, DOCK, []);
      expect(Number.isInteger(closed)).toBe(true);
      expect(closed).toBe(Math.round((viewport - DOCK) / 2));
      // Columns open, at their narrowest and widest, beside the dock's row.
      for (const [left, right] of [[268, 240], [388, 360]]) {
        const open = dockLeft(viewport, DOCK, [
          { left: 28, right: left },
          { left: viewport - right, right: viewport },
        ]);
        expect(open).toBe(closed);
      }
    }
  });

  it('steps clear of a column it would run under, by the least that clears it', () => {
    // 1024 wide, a 288px inspector against the right edge: centred, the dock
    // would end at 770, past the inspector's 736.
    const left = dockLeft(1024, DOCK, [{ left: 736, right: 1024 }]);
    expect(left + DOCK).toBe(736 - 8);
  });

  it('stays centred when it cannot clear both columns', () => {
    expect(dockLeft(900, DOCK, [{ left: 0, right: 300 }, { left: 600, right: 900 }])).toBe(Math.round((900 - DOCK) / 2));
  });
});

function memory() {
  const data = new Map<string, string>();
  return { get: (k: string) => data.get(k) ?? null, set: (k: string, v: string) => data.set(k, v), data };
}

describe('panels per board', () => {
  it('starts a board never opened here with both columns closed', () => {
    expect(readPanelState('a', memory())).toEqual({ left: false, right: false });
  });

  it('remembers each board apart', () => {
    const m = memory();
    writePanelState('a', { left: true, right: false }, m);
    writePanelState('b', { left: false, right: true }, m);
    expect(readPanelState('a', m)).toEqual({ left: true, right: false });
    expect(readPanelState('b', m)).toEqual({ left: false, right: true });
  });

  it('starts a new board the way the last one was left', () => {
    const m = memory();
    writePanelState('a', { left: true, right: true }, m);
    expect(readPanelState('new', m)).toEqual({ left: true, right: true });
  });

  it('forgets the longest-unvisited boards past the cap', () => {
    const m = memory();
    for (let i = 0; i <= PANELS_CAP; i++) writePanelState(`b${i}`, { left: true, right: false }, m, i);
    const kept = JSON.parse(m.get(PANELS_KEY)!);
    expect(Object.keys(kept)).toHaveLength(PANELS_CAP);
    expect(kept.b0).toBeUndefined();
    expect(kept[`b${PANELS_CAP}`]).toBeDefined();
  });

  it('survives a corrupt record', () => {
    const m = memory();
    m.set(PANELS_KEY, '{not json');
    expect(readPanelState('a', m)).toEqual({ left: false, right: false });
    m.set(PANELS_KEY, JSON.stringify({ a: 'open', b: [1, 0, 5] }));
    expect(readPanelState('a', m)).toEqual({ left: false, right: false });
    expect(readPanelState('b', m)).toEqual({ left: true, right: false });
  });
});
