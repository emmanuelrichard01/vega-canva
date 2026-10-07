import { describe, expect, it } from 'vitest';
import {
  analyseCues,
  envelopeAt,
  fadeCurve,
  loopSchedule,
  planCrossfade,
  readGaplessInfo,
  retryDelay,
  trimWindow,
  type Envelope,
} from './gapless';
import { fadeLength, LOOP_FADE, TRACK_FADE } from './crossfade';
import { creditFor } from './credits';
import { KNOWN_CATEGORY_IDS, manifestLocation, parseManifest } from './manifest';
import realManifest from './fixtures/manifest.v1.json';

// ------------------------------------------------------------------ a minimal MP4

const box = (type: string, ...payload: Uint8Array[]): Uint8Array => {
  const size = 8 + payload.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let at = 8;
  for (const p of payload) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const u32s = (...values: number[]) => {
  const out = new Uint8Array(values.length * 4);
  values.forEach((v, i) => new DataView(out.buffer).setInt32(i * 4, v));
  return out;
};
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Version-0 boxes, laid out as ffmpeg writes them for the supplied tracks. */
function mp4(opts: { movieScale: number; segment: number; mediaScale: number; mediaDuration: number; edits: [number, number][]; handler?: string }) {
  const mvhd = box('mvhd', u32s(0, 0, 0, opts.movieScale, opts.segment));
  const hdlr = box('hdlr', u32s(0, 0), ascii(opts.handler ?? 'soun'), u32s(0, 0, 0), ascii('SoundHandler\0'));
  const mdhd = box('mdhd', u32s(0, 0, 0, opts.mediaScale, opts.mediaDuration));
  const elst = box('elst', u32s(0, opts.edits.length, ...opts.edits.flatMap(([seg, mt]) => [seg, mt, 0x10000])));
  const trak = box('trak', box('tkhd', u32s(0, 0, 0)), box('edts', elst), box('mdia', mdhd, hdlr));
  return new Uint8Array([...box('ftyp', ascii('M4A '), u32s(0)), ...box('moov', mvhd, trak), ...box('mdat', u32s(0))]);
}

/** Retro Arcade as encoded: 1024 priming samples, 2683008 real ones, 44.1 kHz. */
const RETRO = { movieScale: 44100, segment: 2683008, mediaScale: 44100, mediaDuration: 2684032, edits: [[2683008, 1024]] as [number, number][] };

describe('priming trim', () => {
  it('reads priming and duration from the edit list', () => {
    const info = readGaplessInfo(mp4(RETRO))!;
    expect(info.priming).toBeCloseTo(1024 / 44100, 9);
    expect(info.duration).toBeCloseTo(2683008 / 44100, 9);
  });

  it('skips an empty edit and reads the real one', () => {
    const info = readGaplessInfo(mp4({ ...RETRO, edits: [[441, -1], [2683008, 2112]] }))!;
    expect(info.priming).toBeCloseTo(2112 / 44100, 9);
  });

  it('returns null for files it cannot read', () => {
    expect(readGaplessInfo(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readGaplessInfo(mp4({ ...RETRO, handler: 'vide' }))).toBeNull();
    expect(readGaplessInfo(new ArrayBuffer(0))).toBeNull();
  });

  it('trims the priming when the decoder kept it', () => {
    const info = readGaplessInfo(mp4(RETRO))!;
    // Decoded with the priming and a partly padded last frame.
    const decoded = (1024 + 2683008 + 700) / 44100;
    const w = trimWindow(decoded, info);
    expect(w.start * 44100).toBeCloseTo(1024, 6);
    expect((w.end - w.start) * 44100).toBeCloseTo(2683008, 6);
  });

  it('leaves the start alone when the decoder trimmed it, and still cuts the padding', () => {
    const info = readGaplessInfo(mp4(RETRO))!;
    const w = trimWindow((2683008 + 700) / 44100, info);
    expect(w.start).toBe(0);
    expect(w.end * 44100).toBeCloseTo(2683008, 6);
    // Resampled to 48 kHz, the same seconds come out.
    const at48 = trimWindow(Math.round(((1024 + 2683008) / 44100) * 48000) / 48000, info);
    expect(at48.start).toBeCloseTo(1024 / 44100, 4);
  });

  it('plays an unknown file whole', () => {
    expect(trimWindow(12.5, null)).toEqual({ start: 0, end: 12.5 });
  });
});

// ------------------------------------------------------------------ cues

/** A synthetic track: `levels` in dBFS, one per 100 ms frame, as a sine at that RMS. */
function track(levels: number[], sampleRate = 8000): Float32Array {
  const frame = sampleRate / 10;
  const out = new Float32Array(levels.length * frame);
  levels.forEach((db, f) => {
    const amp = db <= -120 ? 0 : Math.SQRT2 * 10 ** (db / 20);
    for (let i = 0; i < frame; i++) out[f * frame + i] = amp * Math.sin((2 * Math.PI * 440 * (f * frame + i)) / sampleRate);
  });
  return out;
}
const repeat = (db: number, frames: number) => Array.from({ length: frames }, () => db);

describe('cues', () => {
  it('skips leading silence and ends the fade before a fading tail', () => {
    // 0.4 s of silence, 60 s of music, then a 6 s tail falling away.
    const tail = Array.from({ length: 60 }, (_, i) => -15 - i);
    const pcm = track([...repeat(-120, 4), ...repeat(-15, 600), ...tail]);
    const length = pcm.length / 8000;
    const cues = analyseCues([pcm], 8000, { start: 0, end: length });
    expect(cues.in).toBeCloseTo(0.4, 5);
    // The 1 s average stays within 9 dB of the median for 15 frames of the tail; half a second more plays under the fade.
    expect(cues.out).toBeCloseTo(60.4 + 1.5 + 0.5, 5);
    expect(cues.out).toBeLessThan(length);
  });

  it('keeps the whole track when it ends at full level', () => {
    const pcm = track(repeat(-14, 300));
    expect(analyseCues([pcm], 8000, { start: 0, end: 30 })).toEqual({ in: 0, out: 30 });
  });

  it('skips a quiet break at the start, so a loop never rises into near-silence', () => {
    // A loud half second, a near-silent break, then the music proper from 3 s.
    const pcm = track([...repeat(-15, 5), ...repeat(-50, 25), ...repeat(-15, 600)]);
    expect(analyseCues([pcm], 8000, { start: 0, end: 63 }).in).toBeCloseTo(3, 5);
  });

  it('never cuts more than 20 s of tail, nor skips more than 20 s of intro', () => {
    const pcm = track([...repeat(-75, 250), ...repeat(-14, 400), ...repeat(-45, 300)]);
    const cues = analyseCues([pcm], 8000, { start: 0, end: 95 });
    expect(cues.in).toBe(20);
    expect(cues.out).toBe(95 - 20);
  });
});

// ------------------------------------------------------------------ fades

describe('equal-power fades', () => {
  const fadeIn: Envelope = { t0: 10, t1: 15, from: 0, to: 1 };
  const fadeOut: Envelope = { t0: 10, t1: 15, from: 1, to: 0 };

  it('keeps total power constant through a crossfade', () => {
    for (let t = 9; t <= 16; t += 0.25) {
      expect(envelopeAt(fadeIn, t) ** 2 + envelopeAt(fadeOut, t) ** 2).toBeCloseTo(1, 9);
    }
    expect(envelopeAt(fadeIn, 12.5)).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('holds its ends outside the window', () => {
    expect(envelopeAt(fadeIn, 0)).toBe(0);
    expect(envelopeAt(fadeIn, 99)).toBe(1);
    expect(envelopeAt({ t0: 3, t1: 3, from: 0, to: 1 }, 2.9)).toBe(0);
    expect(envelopeAt({ t0: 3, t1: 3, from: 0, to: 1 }, 3)).toBe(1);
  });

  it('samples a curve from any point in the window', () => {
    const whole = fadeCurve(fadeIn, 0);
    expect(whole[0]).toBe(0);
    expect(whole[whole.length - 1]).toBeCloseTo(1, 9);
    const rest = fadeCurve(fadeIn, 12.5);
    expect(rest[0]).toBeCloseTo(Math.SQRT1_2, 6);
    for (let i = 1; i < rest.length; i++) expect(rest[i]).toBeGreaterThanOrEqual(rest[i - 1]);
  });
});

describe('crossfade timing', () => {
  it('ends the fade on the out cue', () => {
    expect(planCrossfade(100, 160, 166, 5)).toEqual({ start: 155, end: 160 });
  });

  it('squeezes a late fade instead of pushing it past the end of the audio', () => {
    // Seeked to 2 s before the cue: the fade starts now and ends on the cue.
    expect(planCrossfade(158, 160, 166, 5, 0.05)).toEqual({ start: 158.05, end: 160 });
    // Already past the cue: a short fade inside what audio is left.
    const late = planCrossfade(163, 160, 166, 5, 0.05);
    expect(late.start).toBeCloseTo(163.05);
    expect(late.end).toBeCloseTo(163.35);
    // Audio all but over: never later than its end.
    expect(planCrossfade(165.9, 160, 166, 5, 0.05).end).toBe(166);
  });

  it('fades 5 s between tracks and 3 s into a loop, within a third of the shorter track', () => {
    expect(fadeLength(150, 180, TRACK_FADE)).toBe(5);
    expect(fadeLength(60, 60, LOOP_FADE)).toBe(3);
    expect(fadeLength(6, 180, TRACK_FADE)).toBe(2);
  });

  it('loops a single track seamlessly into its own start', () => {
    // Retro Arcade: music from 0.42 s, full level to the end (60.84 s).
    const cues = { in: 0.42, out: 60.84 };
    const passes = loopSchedule(cues, 60.84, LOOP_FADE, 1000, 0, 4);
    passes.forEach((pass, i) => {
      // Each fade lasts exactly the loop window and ends on the out cue.
      expect(pass.fade.end - pass.fade.start).toBeCloseTo(LOOP_FADE, 9);
      expect(pass.fade.end).toBeCloseTo(pass.start + (cues.out - pass.offset), 9);
      const next = passes[i + 1];
      if (!next) return;
      // The next pass starts the moment the fade does, from the in cue: overlap, never a gap.
      expect(next.start).toBeCloseTo(pass.fade.start, 9);
      expect(next.offset).toBe(cues.in);
    });
    // Every pass after the first lasts out − in − fade.
    expect(passes[2].start - passes[1].start).toBeCloseTo(60.84 - 0.42 - 3, 9);
  });

  it('backs off retries up to 15 s', () => {
    expect([0, 1, 2, 3, 4, 9].map(retryDelay)).toEqual([1, 2, 4, 8, 15, 15]);
  });
});

// ------------------------------------------------------------------ the real library

describe('the supplied library', () => {
  const base = 'https://api.example.com/music/v1/manifest.json';
  const parsed = parseManifest(realManifest, base);

  it('parses without problems', () => {
    expect(parsed.problems).toEqual([]);
    expect(parsed.tracks).toHaveLength(9);
    expect(parsed.tracks.every((t) => t.url.startsWith('https://api.example.com/music/v1/') && t.url.endsWith('.m4a'))).toBe(true);
  });

  it('uses only the known category slugs', () => {
    expect(parsed.categories.every((c) => KNOWN_CATEGORY_IDS.includes(c))).toBe(true);
    const count = (c: string) => parsed.tracks.filter((t) => t.category === c).length;
    expect(KNOWN_CATEGORY_IDS.map(count)).toEqual([2, 1, 2, 1, 2, 1]);
  });

  it('credits every track', () => {
    for (const t of parsed.tracks) {
      const c = creditFor(t);
      expect(c.line).toBe(`Music: ${t.title} by ${t.artist} · ${c.source}`);
      expect(['freetouse.com', 'Pixabay']).toContain(c.source);
      expect(c.url).toMatch(/^https:\/\//);
    }
    const aylex = creditFor(parsed.tracks[0]);
    expect(aylex).toMatchObject({ source: 'freetouse.com', url: 'https://freetouse.com/music', licence: 'Free To Use' });
    const synth = creditFor(parsed.tracks.find((t) => t.category === 'synth')!);
    expect(synth).toMatchObject({
      line: 'Music: Synthwave by Alex Grohl · Pixabay',
      url: 'https://pixabay.com/service/license-summary/',
      licence: 'Pixabay Content License',
    });
  });

  it('credits an unknown source by its licence name', () => {
    expect(creditFor({ title: 'A', artist: 'B', licence: 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)' })).toMatchObject({
      source: 'CC BY 4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
    });
  });
});

describe('manifest location', () => {
  it('defaults to the server music route', () => {
    expect(manifestLocation({}, 'https://api.vega.example')).toBe('https://api.vega.example/music/v1/manifest.json');
    expect(manifestLocation({ VITE_MUSIC_BASE_URL: '  ' }, 'http://localhost:3000/')).toBe('http://localhost:3000/music/v1/manifest.json');
  });

  it('lets the environment override it', () => {
    expect(manifestLocation({ VITE_MUSIC_BASE_URL: 'https://cdn.example.com/music/' }, 'https://api.x')).toBe('https://cdn.example.com/music/manifest.json');
    expect(manifestLocation({ VITE_MUSIC_MANIFEST_URL: 'https://cdn.example.com/m.json', VITE_MUSIC_BASE_URL: 'https://a' }, 'https://api.x')).toBe(
      'https://cdn.example.com/m.json'
    );
  });
});
