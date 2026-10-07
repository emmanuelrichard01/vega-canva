import React from 'react';
import { Captions, CaptionsOff, Check, MicOff, Pause, Play, Trash2 } from 'lucide-react';
import { formatClock } from '../../engine/model/audioPlayback';
import { captionTail, type TranscriberError } from '../../engine/media/transcribe';
import './recording.css';

/** The overlay state `AudioTool` publishes while a voice note is recording. */
export interface RecordingOverlay {
  type: 'audio-recording';
  elapsedMs: number;
  maxMs?: number;
  remainingMs?: number;
  levels?: number[];
  paused?: boolean;
  silent?: boolean;
  transcription?: { supported: boolean; on: boolean; text: string; error: TranscriberError | null };
  onCancel?: () => void;
  onTogglePause?: () => void;
  onToggleTranscription?: () => void;
}

/** Hairlines in the meter. Their width is fixed in CSS; these divide it. */
const BAR_COUNT = 20;

/** Start counting down when the cap is this close. */
const WARN_AT_MS = 30_000;

const TRANSCRIBE_ERROR: Record<TranscriberError, string> = {
  blocked: 'Transcription was blocked by the browser',
  network: 'Transcription needs a connection',
  unavailable: 'Transcription stopped',
};

/**
 * The panel shown while a voice note is recording.
 *
 * In reading order it says: you are recording (the red dot); for how long, out
 * of how long (the clock against the cap, and a hairline filling towards it);
 * it is hearing you (the live meter); and how to change your mind — pause,
 * keep, or throw away. Transcription sits with the controls because it is a
 * choice, and its caption sits above the panel because it is output.
 *
 * Transcription is offered only where the browser has speech recognition. It
 * is off until switched on, the tooltip says where the audio goes before it is
 * switched on, and where the browser has none the control says so rather than
 * disappearing — a missing button is a feature nobody can find out about.
 */
export const RecordingHud: React.FC<{ overlay: RecordingOverlay; onStop: () => void }> = ({ overlay, onStop }) => {
  const {
    elapsedMs = 0,
    maxMs,
    remainingMs,
    levels = [],
    paused,
    silent,
    transcription,
    onCancel,
    onTogglePause,
    onToggleTranscription,
  } = overlay;

  // Padded to a fixed count, newest on the right, so the trace does not grow
  // in from nothing and read as a loading state.
  const recent = levels.slice(-BAR_COUNT);
  const bars = [...new Array(Math.max(0, BAR_COUNT - recent.length)).fill(0), ...recent];
  const nearLimit = remainingMs !== undefined && remainingMs <= WARN_AT_MS;
  const fraction = maxMs ? Math.min(1, Math.max(0, elapsedMs / maxMs)) : 0;

  const t = transcription;
  const caption = t?.on ? captionTail(t.text) : '';
  const transcribeLabel = !t?.supported
    ? 'Live transcription is not available in this browser'
    : t.on
      ? 'Stop transcribing'
      : 'Transcribe as you speak. Uses your browser’s speech service, which may send the audio to its provider.';

  return (
    <div className="rec-hud rec-hud--timed">
      {t?.on && (
        <div className="rec-caption" aria-hidden="true">
          {caption ? <span className="rec-caption__text">{caption}</span> : <span className="rec-caption__wait">Listening…</span>}
        </div>
      )}
      {t?.error && !t.on && <div className="rec-caption rec-caption--error">{TRANSCRIBE_ERROR[t.error]}</div>}

      <div className={`rec-hud-panel panel-surface rec-hud-panel--timed ${paused ? 'is-paused' : ''}`}>
        <span className="rec-hud-status">
          <span className="rec-hud-dot" aria-hidden="true" />
          <span className="rec-hud-elapsed">
            {formatClock(elapsedMs)}
            {maxMs ? <span className="rec-hud-cap"> / {formatClock(maxMs)}</span> : null}
          </span>
        </span>

        <div className="rec-hud-meter" aria-hidden="true">
          {bars.map((v, i) => (
            <span
              key={i}
              className="rec-hud-tick"
              style={{
                // A scale, not a height: the meter stays off the layout path.
                // The 0.1 floor keeps a quiet thread through silence.
                transform: `scaleY(${Math.max(0.1, Math.min(v, 1))})`,
                opacity: 0.32 + Math.min(v, 1) * 0.68,
              }}
            />
          ))}
        </div>

        {/* One status at a time, most urgent first. */}
        {nearLimit ? (
          <span className="rec-hud-warn">{formatClock(remainingMs!)} left</span>
        ) : paused ? (
          <span className="rec-hud-note">Paused</span>
        ) : silent ? (
          <span className="rec-hud-warn rec-hud-warn--quiet">
            <MicOff size={12} aria-hidden="true" />
            No sound
          </span>
        ) : null}

        <span className="rec-hud-rule" aria-hidden="true" />

        {onToggleTranscription && (
          <button
            type="button"
            className="rec-hud-pause rec-hud-transcribe"
            onClick={onToggleTranscription}
            disabled={!t?.supported}
            aria-pressed={t?.supported ? t.on : undefined}
            aria-label={t?.on ? 'Stop transcribing' : 'Transcribe'}
            data-tooltip={transcribeLabel}
          >
            {t?.supported ? <Captions size={15} /> : <CaptionsOff size={15} />}
          </button>
        )}

        {onTogglePause && (
          <button
            type="button"
            className="rec-hud-pause"
            onClick={onTogglePause}
            data-tooltip={paused ? 'Resume (Space)' : 'Pause (Space)'}
            aria-label={paused ? 'Resume recording' : 'Pause recording'}
          >
            {paused ? <Play size={14} fill="currentColor" className="rec-hud-play-glyph" /> : <Pause size={14} fill="currentColor" />}
          </button>
        )}

        {onCancel && (
          <button type="button" className="rec-hud-discard" onClick={onCancel} data-tooltip="Discard (Esc)" aria-label="Discard recording">
            <Trash2 size={14} />
          </button>
        )}

        <button type="button" className="rec-hud-done" onClick={onStop}>
          <Check size={14} />
          Keep
        </button>

        {maxMs ? (
          <span className="rec-hud-progress" aria-hidden="true">
            <span className="rec-hud-progress__fill" data-near={nearLimit || undefined} style={{ transform: `scaleX(${fraction})` }} />
          </span>
        ) : null}
      </div>

      {/* Announced separately, so a screen reader gets the state without the meter. */}
      <span className="sr-only" role="status" aria-live="polite">
        {paused ? 'Recording paused' : 'Recording'}, {formatClock(elapsedMs)}
        {maxMs ? ` of ${formatClock(maxMs)}` : ''}
        {silent && !paused ? ', no sound is being picked up' : ''}
      </span>

      <span className="rec-hud-hint">Space to pause · Esc to discard{maxMs ? ` · stops at ${formatClock(maxMs)}` : ''}</span>
    </div>
  );
};
