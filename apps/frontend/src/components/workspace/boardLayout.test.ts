// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { boardRegions, nextRegion } from './boardLayout';

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
