import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET,
  defaultSuffix,
  nextPreset,
  planJobs,
  presetsFor,
  sanitizeStoredPresets,
  withPresets,
  type ExportPreset,
} from './exportPresets';
import { frameLink, readFrameTarget, withoutFrameParam } from './frameLink';

/** Per-object export settings: what is remembered, and what one press of Export produces. */

const p = (id: string, format: ExportPreset['format'], scale: number, suffix?: string): ExportPreset =>
  suffix === undefined ? { id, format, scale } : { id, format, scale, suffix };

describe('remembered presets', () => {
  it('start from one 2× PNG', () => {
    const stored = sanitizeStoredPresets(null);
    expect(presetsFor(stored, 'frame-1')).toEqual([DEFAULT_PRESET]);
  });

  it('are kept per object, and the last list used is offered to the next one', () => {
    let stored = sanitizeStoredPresets(null);
    stored = withPresets(stored, 'hero', [p('a', 'png', 1), p('b', 'svg', 1)]);
    expect(presetsFor(stored, 'hero').map((x) => x.format)).toEqual(['png', 'svg']);
    expect(presetsFor(stored, 'other').map((x) => x.format)).toEqual(['png', 'svg']);
    stored = withPresets(stored, 'other', [p('c', 'jpeg', 3)]);
    expect(presetsFor(stored, 'hero').map((x) => x.format)).toEqual(['png', 'svg']);
  });

  it('survive a round trip through storage and drop what is not valid', () => {
    const raw = JSON.parse(
      JSON.stringify({
        byNode: { hero: [p('a', 'png', 2, '-retina'), { id: 'x', format: 'gif', scale: 2 }, { format: 'webp', scale: 7 }] },
        last: 'nonsense',
      })
    );
    const stored = sanitizeStoredPresets(raw);
    const hero = presetsFor(stored, 'hero');
    expect(hero.map((x) => [x.format, x.scale, x.suffix])).toEqual([
      ['png', 2, '-retina'],
      ['webp', 1, undefined],
    ]);
    expect(stored.last).toEqual([DEFAULT_PRESET]);
  });
});

describe('planning an export', () => {
  it('makes one file per preset per target, named from the target with each suffix', () => {
    const jobs = planJobs(
      [
        { name: 'Launch hero', options: { frameId: 'f1' } },
        { name: 'Pricing', options: { frameId: 'f2' } },
      ],
      [p('a', 'png', 1), p('b', 'png', 2), p('c', 'svg', 1, '-vector')],
      { background: 'transparent' }
    );
    expect(jobs.map((j) => j.filename)).toEqual([
      'launch-hero.png',
      'launch-hero@2x.png',
      'launch-hero-vector.svg',
      'pricing.png',
      'pricing@2x.png',
      'pricing-vector.svg',
    ]);
    expect(jobs[1].options).toMatchObject({ frameId: 'f1', scale: 2, background: 'transparent' });
  });

  it('suggests the next scale not yet listed, and shows the density as the default suffix', () => {
    const next = nextPreset([p('a', 'png', 1), p('b', 'png', 2)]);
    expect([next.format, next.scale]).toEqual(['png', 3]);
    expect(defaultSuffix({ format: 'png', scale: 2 })).toBe('@2x');
    expect(defaultSuffix({ format: 'svg', scale: 2 })).toBe('');
  });
});

describe('frame links', () => {
  it('point at the board by its room id, never at an invite', () => {
    expect(frameLink('https://vega.example', 'abc123', 'frame_9')).toBe('https://vega.example/room/abc123?frame=frame_9');
  });

  it('read back only a plausible frame id, and can be removed from the address', () => {
    expect(readFrameTarget('?frame=frame_9&x=1')).toBe('frame_9');
    expect(readFrameTarget('?frame=<script>')).toBeNull();
    expect(readFrameTarget('')).toBeNull();
    expect(withoutFrameParam('?frame=f1&follow=u2')).toBe('?follow=u2');
    expect(withoutFrameParam('?frame=f1')).toBe('');
  });
});
