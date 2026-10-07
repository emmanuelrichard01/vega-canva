import { describe, expect, it } from 'vitest';
import { inMyView, poseToReach, rosterOrder, rosterState } from './roster';

const view = { x: 0, y: 0, zoom: 1, width: 1000, height: 800 };

describe('rosterState', () => {
  it('says idle before anything else, since an idle person is not doing it', () => {
    expect(rosterState({ away: true, activity: 'drawing' })).toEqual({ state: 'idle', word: 'Idle' });
  });
  it('names the activity, and falls back to viewing', () => {
    expect(rosterState({ away: false, activity: 'recording' })).toEqual({ state: 'active', word: 'Recording' });
    expect(rosterState({ away: false, activity: null })).toEqual({ state: 'viewing', word: 'Viewing' });
  });
});

describe('rosterOrder', () => {
  it('puts people doing something first and the idle last, each by name', () => {
    const people = [
      { name: 'Zed', away: false, activity: null },
      { name: 'Bo', away: true, activity: null },
      { name: 'Yan', away: false, activity: 'typing' as const },
      { name: 'Ana', away: false, activity: null },
    ];
    expect(rosterOrder(people).map((p) => p.name)).toEqual(['Yan', 'Ana', 'Zed', 'Bo']);
  });
  it('does not reorder its input', () => {
    const people = [
      { name: 'B', away: false, activity: null },
      { name: 'A', away: false, activity: null },
    ];
    rosterOrder(people);
    expect(people[0].name).toBe('B');
  });
});

describe('inMyView', () => {
  it('is unknown without a viewport', () => {
    expect(inMyView(null, view)).toBeNull();
  });
  it('is true when their centre is on my screen and false when it is not', () => {
    expect(inMyView({ x: 100, y: 100, width: 400, height: 300, zoom: 1 }, view)).toBe(true);
    expect(inMyView({ x: 5000, y: 0, width: 400, height: 300, zoom: 1 }, view)).toBe(false);
  });
});

describe('poseToReach', () => {
  it('lands the middle of their screen in the middle of mine, keeping my zoom', () => {
    const pose = poseToReach({ x: 1000, y: 500, width: 400, height: 200, zoom: 2 }, { ...view, zoom: 0.5 });
    // Their centre in the world is (1100, 550).
    expect(pose.zoom).toBe(0.5);
    expect(1100 * pose.zoom + pose.x).toBeCloseTo(500);
    expect(550 * pose.zoom + pose.y).toBeCloseTo(400);
  });
});
