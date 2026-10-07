import { describe, expect, it } from 'vitest';
import {
  PENDING_MS,
  nextRepeat,
  overlay,
  pollDelay,
  reconcile,
  repeatFromSpotify,
  repeatToSpotify,
  retryAfterMs,
  snapshotFromApi,
  snapshotFromSdk,
  type Controls,
} from './playerSync';
import { clampSeek, clock, extrapolate, fractionOf, seekFromKey, seekFromPointer, volumeFromWheel } from '../playerMath';

const server: Controls = { shuffle: false, repeat: 'off', playing: true, liked: false };

describe('seek maths', () => {
  it('keeps a seek inside the track', () => {
    expect(clampSeek(-3, 200)).toBe(0);
    expect(clampSeek(250, 200)).toBe(200);
    expect(clampSeek(Number.NaN, 200)).toBe(0);
    expect(clampSeek(90, 0)).toBe(90);
  });

  it('maps a pointer to a position along the track', () => {
    expect(seekFromPointer(150, 100, 200, 240)).toBe(60);
    expect(seekFromPointer(50, 100, 200, 240)).toBe(0);
    expect(seekFromPointer(999, 100, 200, 240)).toBe(240);
    expect(seekFromPointer(150, 100, 0, 240)).toBe(0);
  });

  it('steps five seconds on the arrows and clamps at the ends', () => {
    expect(seekFromKey('ArrowRight', 10, 100)).toBe(15);
    expect(seekFromKey('ArrowLeft', 3, 100)).toBe(0);
    expect(seekFromKey('ArrowRight', 98, 100)).toBe(100);
    expect(seekFromKey('ArrowRight', 10, 100, true)).toBe(25);
    expect(seekFromKey('Home', 40, 100)).toBe(0);
    expect(seekFromKey('End', 40, 100)).toBe(100);
    expect(seekFromKey('a', 40, 100)).toBeNull();
  });

  it('formats clocks and fractions', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65.9)).toBe('1:05');
    expect(clock(3725)).toBe('1:02:05');
    expect(clock(-4)).toBe('0:00');
    expect(fractionOf(50, 200)).toBe(0.25);
    expect(fractionOf(5, 0)).toBe(0);
  });

  it('runs the clock forward only while playing, and not past the end', () => {
    expect(extrapolate(10_000, 1000, 3000, true, 60_000)).toBe(12_000);
    expect(extrapolate(10_000, 1000, 3000, false, 60_000)).toBe(10_000);
    expect(extrapolate(59_000, 0, 5000, true, 60_000)).toBe(60_000);
  });

  it('turns wheel notches into 5% volume steps', () => {
    expect(volumeFromWheel(0.5, -100)).toBeCloseTo(0.6);
    expect(volumeFromWheel(0.5, 20)).toBeCloseTo(0.45);
    expect(volumeFromWheel(0.98, -20)).toBe(1);
    expect(volumeFromWheel(0.02, 20)).toBe(0);
  });
});

describe('shuffle and repeat mapping', () => {
  it('maps both vocabularies of Spotify to the app and back', () => {
    expect(repeatFromSpotify('off')).toBe('off');
    expect(repeatFromSpotify('context')).toBe('all');
    expect(repeatFromSpotify('track')).toBe('one');
    expect(repeatFromSpotify(0)).toBe('off');
    expect(repeatFromSpotify(1)).toBe('all');
    expect(repeatFromSpotify(2)).toBe('one');
    expect(repeatFromSpotify(undefined)).toBe('off');
    for (const m of ['off', 'all', 'one'] as const) expect(repeatFromSpotify(repeatToSpotify(m))).toBe(m);
  });

  it('cycles off, all, one', () => {
    expect(nextRepeat('off')).toBe('all');
    expect(nextRepeat('all')).toBe('one');
    expect(nextRepeat('one')).toBe('off');
  });

  it('reads the in-tab player state', () => {
    const snap = snapshotFromSdk({
      paused: false,
      position: 12_000,
      duration: 200_000,
      shuffle: true,
      repeat_mode: 2,
      track_window: {
        current_track: { id: 'a', uri: 'spotify:track:a', name: 'Song', artists: [{ name: 'One' }, { name: 'Two' }], album: { name: 'LP', images: [{ url: 'u' }] } },
        next_tracks: [{ id: 'b', uri: 'spotify:track:b', name: 'Next', artists: [{ name: 'X' }] }, { id: null }],
      },
    });
    expect(snap).toMatchObject({ playing: true, shuffle: true, repeat: 'one', positionMs: 12_000, durationMs: 200_000 });
    expect(snap?.track).toMatchObject({ title: 'Song', artist: 'One, Two', album: 'LP', image: 'u' });
    expect(snap?.upNext.map((t) => t.title)).toEqual(['Next']);
    expect(snapshotFromSdk(null)).toBeNull();
    expect(snapshotFromSdk({ paused: true, track_window: {} })).toBeNull();
  });

  it('reads the Web API state and skips episodes', () => {
    const body = {
      is_playing: false,
      progress_ms: 5000,
      shuffle_state: true,
      repeat_state: 'context',
      device: { volume_percent: 40 },
      item: { id: 'a', uri: 'spotify:track:a', name: 'Song', duration_ms: 1000, type: 'track', artists: [{ name: 'A' }] },
    };
    expect(snapshotFromApi(body)).toMatchObject({ playing: false, shuffle: true, repeat: 'all', volume: 0.4, durationMs: 1000 });
    expect(snapshotFromApi({ ...body, item: { ...body.item, type: 'episode' } })).toBeNull();
    expect(snapshotFromApi(null)).toBeNull();
  });
});

describe('optimistic reconciliation', () => {
  it('shows the expectation at once, then the server value once it agrees', () => {
    const pending = { shuffle: { value: true, at: 1000 } };
    expect(overlay(server, pending, 1100).shuffle).toBe(true);
    expect(reconcile(pending, { shuffle: true }, 1500)).toEqual({});
    expect(overlay(server, reconcile(pending, { shuffle: true }, 1500), 1600).shuffle).toBe(false);
  });

  it('ignores a stale echo while the request is in flight', () => {
    const pending = { repeat: { value: 'all' as const, at: 1000 } };
    const after = reconcile(pending, { repeat: 'off' }, 1400);
    expect(after.repeat?.value).toBe('all');
    expect(overlay(server, after, 1500).repeat).toBe('all');
  });

  it('gives Spotify the last word once the window passes', () => {
    const pending = { playing: { value: false, at: 0 } };
    expect(overlay(server, pending, PENDING_MS + 1).playing).toBe(true);
    expect(reconcile(pending, { playing: true }, PENDING_MS + 1)).toEqual({});
  });

  it('keeps unrelated expectations independent', () => {
    const pending = { shuffle: { value: true, at: 0 }, liked: { value: true, at: 0 } };
    const after = reconcile(pending, { shuffle: true, liked: false }, 100);
    expect(after.shuffle).toBeUndefined();
    expect(after.liked?.value).toBe(true);
  });
});

describe('rate limits', () => {
  it('polls slower when paused and never sooner than Retry-After', () => {
    expect(pollDelay(true, 0)).toBe(4000);
    expect(pollDelay(false, 0)).toBe(15000);
    expect(pollDelay(true, 30_000)).toBe(30_000);
  });

  it('reads Retry-After in seconds, with a default and a ceiling', () => {
    expect(retryAfterMs('3')).toBe(3000);
    expect(retryAfterMs(null)).toBe(5000);
    expect(retryAfterMs('abc')).toBe(5000);
    expect(retryAfterMs('900')).toBe(60_000);
  });
});
