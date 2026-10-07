import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_TRANSCRIPT,
  captionTail,
  createTranscriber,
  joinTranscript,
  setTranscriptionWanted,
  transcriptionSupported,
  transcriptionWanted,
} from './transcribe';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  stopped = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.starts += 1;
  }
  stop() {
    this.stopped = true;
    this.onend?.();
  }
  abort() {
    this.stopped = true;
  }
  say(text: string, isFinal: boolean) {
    const result = Object.assign([{ transcript: text }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: Object.assign([result], { length: 1 }) });
  }
}

const win = globalThis as unknown as { window?: Record<string, unknown>; localStorage?: Storage };

beforeEach(() => {
  FakeRecognition.instances = [];
  win.window = { webkitSpeechRecognition: FakeRecognition };
  const store = new Map<string, string>();
  win.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

afterEach(() => {
  delete win.window;
});

describe('joinTranscript', () => {
  it('joins phrases with single spaces and drops empties', () => {
    expect(joinTranscript(['  hello  there', '', 'world '], ' and  more')).toBe('hello there world and more');
  });

  it('caps a runaway transcript with an ellipsis', () => {
    const out = joinTranscript(['word '.repeat(5000)]);
    expect(out.length).toBeLessThanOrEqual(MAX_TRANSCRIPT);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('captionTail', () => {
  it('keeps short text whole and cuts long text at a word', () => {
    expect(captionTail('short')).toBe('short');
    const tail = captionTail('the quick brown fox jumps over the lazy dog '.repeat(4).trim(), 30);
    expect(tail.startsWith('…')).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(31);
    expect(tail[1]).not.toBe(' ');
  });
});

describe('support and preference', () => {
  it('reports support only where the browser has recognition', () => {
    expect(transcriptionSupported()).toBe(true);
    win.window = {};
    expect(transcriptionSupported()).toBe(false);
    expect(createTranscriber(() => {})).toBeNull();
  });

  it('is off until turned on, and remembers the choice', () => {
    expect(transcriptionWanted()).toBe(false);
    setTranscriptionWanted(true);
    expect(transcriptionWanted()).toBe(true);
    setTranscriptionWanted(false);
    expect(transcriptionWanted()).toBe(false);
  });
});

describe('createTranscriber', () => {
  it('collects final phrases and shows the phrase in progress', () => {
    const heard: string[] = [];
    const t = createTranscriber((text) => heard.push(text))!;
    t.start();
    const r = FakeRecognition.instances[0];
    expect(r.continuous && r.interimResults).toBe(true);
    r.say('hello', true);
    r.say('wor', false);
    expect(heard.at(-1)).toBe('hello wor');
    expect(t.finish()).toBe('hello wor');
  });

  it('restarts when the service ends a quiet stretch, but not while paused', () => {
    const t = createTranscriber(() => {})!;
    t.start();
    const r = FakeRecognition.instances[0];
    r.onend?.();
    expect(r.starts).toBe(2);
    t.pause();
    const before = r.starts;
    r.onend?.();
    expect(r.starts).toBe(before);
  });

  it('ends the session and names the reason when the browser blocks it', () => {
    let error: string | undefined;
    const t = createTranscriber((_text, e) => (error = e))!;
    t.start();
    FakeRecognition.instances[0].onerror?.({ error: 'not-allowed' });
    expect(error).toBe('blocked');
    FakeRecognition.instances[0].onerror?.({ error: 'no-speech' });
    expect(error).toBe('blocked');
  });

  it('cancel keeps nothing', () => {
    const t = createTranscriber(() => {})!;
    t.start();
    FakeRecognition.instances[0].say('secret', true);
    t.cancel();
    expect(FakeRecognition.instances[0].stopped).toBe(true);
  });
});
