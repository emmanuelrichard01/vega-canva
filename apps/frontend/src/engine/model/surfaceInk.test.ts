import { describe, expect, it } from 'vitest';
import { groundOf, inkOn, textInkOnSurface, wantsLightInk } from './surfaceInk';
import { chartInkFor } from '../chart/chartInk';
import { DEFAULT_INK, type AnyNode } from './schema';

const frame = (id: string, color: string | null, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'frame',
    appearance: { fill: color ? [{ type: 'solid', color }] : [] },
    ...extra,
  }) as unknown as AnyNode;
const chart = (id: string, frameId?: string) => ({ id, type: 'chart', frameId }) as unknown as AnyNode;
const index = (...nodes: AnyNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n]));

describe('surface ink', () => {
  it('chooses light ink on dark ground and dark ink on light ground', () => {
    expect(inkOn('#0B0B0F')).toBe('#FFFFFF');
    expect(inkOn('#FFFFFF')).toBe('#111827');
  });

  it('a chart on a white frame on a dark board stays dark-on-light', () => {
    const f = frame('f', '#FFFFFF');
    const c = chart('c', 'f');
    const objects = index(f, c);
    expect(groundOf(c, objects)).toBe('#FFFFFF');
    const light = wantsLightInk(c, objects, true);
    expect(light).toBe(false);
    expect(chartInkFor(light).ink).toBe(chartInkFor(false).ink);
  });

  it('a chart on the bare dark board takes light ink', () => {
    const c = chart('c');
    expect(wantsLightInk(c, index(c), true)).toBe(true);
  });

  it('a frame with no fill passes through to the outer frame, then the board', () => {
    const outer = frame('o', '#101010');
    const inner = frame('i', null, { frameId: 'o' });
    const c = chart('c', 'i');
    const objects = index(outer, inner, c);
    expect(groundOf(c, objects)).toBe('#101010');
    expect(wantsLightInk(c, objects, false)).toBe(true);
    expect(groundOf(c, index(inner, c))).toBeNull();
  });

  it('survives a membership cycle', () => {
    const a = frame('a', null, { frameId: 'b' });
    const b = frame('b', null, { frameId: 'a' });
    expect(groundOf(chart('c', 'a'), index(a, b))).toBeNull();
  });

  it('derives only the default text ink; a chosen colour stays', () => {
    const f = frame('f', '#111111');
    const t = { id: 't', type: 'text', frameId: 'f' } as unknown as AnyNode;
    const objects = index(f, t);
    expect(textInkOnSurface(DEFAULT_INK, t, objects, false)).toBe('#FFFFFF');
    expect(textInkOnSurface('#FF0000', t, objects, false)).toBe('#FF0000');
    const bare = { id: 'b', type: 'text' } as unknown as AnyNode;
    expect(textInkOnSurface(DEFAULT_INK, bare, index(bare), true)).toBe('#F9FAFB');
    expect(textInkOnSurface(DEFAULT_INK, bare, index(bare), false)).toBe(DEFAULT_INK);
  });
});
