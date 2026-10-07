/**
 * Live transcription of a voice note, where the browser can do it.
 *
 * ## What this is, honestly
 *
 * The Web Speech API's `SpeechRecognition`, and nothing else: no dependency, no
 * server of ours. It exists in Chromium browsers and Safari and not in Firefox.
 * Where it exists it is the *browser's* speech service — Chrome sends the audio
 * to Google to recognise it — so it is off until the person turns it on, the
 * choice is remembered on this device only, and the interface says where the
 * audio goes before it is switched on.
 *
 * Where it does not exist, nothing pretends: the control says transcription is
 * not available in this browser, and a voice note is simply a recording.
 *
 * ## Why the session restarts itself
 *
 * Chrome ends a "continuous" recognition after a stretch of silence or about a
 * minute of speech, and fires `end`. A voice note runs up to five minutes and
 * has pauses in it, so an `end` while the session is meant to be running is
 * answered by starting again. Pause stops it on purpose and is not restarted.
 */

/** The transcript kept on a note. A remark, not minutes of a meeting. */
export const MAX_TRANSCRIPT = 6000;

const PREF_KEY = 'vega:voice-transcribe';

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function transcriptionSupported(): boolean {
  return recognitionCtor() !== null;
}

/** Whether this person has turned transcription on, on this device. */
export function transcriptionWanted(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setTranscriptionWanted(on: boolean): void {
  try {
    if (on) localStorage.setItem(PREF_KEY, 'on');
    else localStorage.removeItem(PREF_KEY);
  } catch {
    /* private window or blocked storage: the choice lasts this take only */
  }
}

/** Collapse whitespace, join phrases with single spaces, cap the length. */
export function joinTranscript(finals: readonly string[], interim = ''): string {
  const text = [...finals, interim]
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
  return text.length > MAX_TRANSCRIPT ? `${text.slice(0, MAX_TRANSCRIPT - 1).trimEnd()}…` : text;
}

/** The tail of a transcript that fits a one-line caption, cut at a word. */
export function captionTail(text: string, max = 72): string {
  if (text.length <= max) return text;
  const tail = text.slice(-max);
  const space = tail.indexOf(' ');
  return `…${space > 0 && space < 20 ? tail.slice(space + 1) : tail}`;
}

export type TranscriberError = 'blocked' | 'network' | 'unavailable';

export interface Transcriber {
  start(): void;
  pause(): void;
  /** Stops for good and returns everything heard. */
  finish(): string;
  /** Abandons the session without a result. */
  cancel(): void;
  text(): string;
}

/**
 * One recording's recognition session, or null where the browser has none.
 * `onChange` hears the running text (finals plus the phrase in progress) and
 * any error that ends the session.
 */
export function createTranscriber(
  onChange: (text: string, error?: TranscriberError) => void,
  lang = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
): Transcriber | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;

  let recognition: Recognition | null = null;
  let running = false;
  let dead = false;
  const finals: string[] = [];
  let interim = '';

  const emit = (error?: TranscriberError) => onChange(joinTranscript(finals, interim), error);

  const boot = () => {
    if (dead) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;
    r.onresult = (e) => {
      let next = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const said = result[0]?.transcript ?? '';
        if (result.isFinal) finals.push(said);
        else next += said;
      }
      interim = next;
      emit();
    };
    r.onerror = (e) => {
      // `no-speech` and `aborted` are the ordinary end of a quiet stretch or a
      // pause, and the restart below covers them. The rest end the session.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      dead = true;
      running = false;
      emit(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'blocked' : e.error === 'network' ? 'network' : 'unavailable');
    };
    r.onend = () => {
      // A phrase still in progress when the service stopped is kept as said.
      if (interim) {
        finals.push(interim);
        interim = '';
      }
      if (running && !dead && recognition === r) {
        try {
          r.start();
        } catch {
          boot();
        }
      }
    };
    recognition = r;
    try {
      r.start();
    } catch {
      dead = true;
      running = false;
      emit('unavailable');
    }
  };

  return {
    start() {
      if (running || dead) return;
      running = true;
      if (recognition) {
        try {
          recognition.start();
        } catch {
          boot();
        }
      } else boot();
    },
    pause() {
      if (!running) return;
      running = false;
      recognition?.stop();
    },
    finish() {
      running = false;
      dead = true;
      recognition?.stop();
      recognition = null;
      if (interim) {
        finals.push(interim);
        interim = '';
      }
      return joinTranscript(finals);
    },
    cancel() {
      running = false;
      dead = true;
      recognition?.abort();
      recognition = null;
    },
    text: () => joinTranscript(finals, interim),
  };
}
