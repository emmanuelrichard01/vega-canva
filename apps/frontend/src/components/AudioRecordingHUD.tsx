import React from 'react';
import { Check, MicOff, Pause, Play, Trash2 } from 'lucide-react';
import { formatClock } from '../engine/model/audioPlayback';

interface Props {
  elapsedMs: number;
  levels: number[];
  remainingMs?: number;
  paused?: boolean;
  /** True once a sustained run of near-silence says nothing is being heard. */
  silent?: boolean;
  onStop: () => void;
  onCancel?: () => void;
  onTogglePause?: () => void;
}

/** Hairlines in the meter. Their width is fixed in CSS; these divide it. */
const BAR_COUNT = 20;

/** Start counting down when the cap is this close. */
const WARN_AT_MS = 30_000;

/**
 * The HUD shown while a voice note is being recorded.
 *
 * ## What it has to say, in order
 *
 * 1. **You are recording.** The red dot, which is the one universally
 *    understood symbol here and needs no support.
 * 2. **For how long.** The elapsed time, tabular so it does not jitter.
 * 3. **It is hearing you.** The live meter — the difference between "recording"
 *    and "recording *something*", and the reason a muted-microphone take gets
 *    caught in the first seconds instead of after the meeting.
 * 4. **How to change your mind**, three ways: hold, keep, or throw away.
 *
 * ## Pause is not a nicety
 *
 * Without it a voice note is a single unbroken take, so an interruption — a
 * door, a question, losing the thread — leaves you either talking through it or
 * discarding a good recording to start again. It is the one transport control
 * every recorder has, and it was the one this did not.
 *
 * ## Saying when nothing is being heard
 *
 * A muted microphone produces a perfectly valid recording of silence, and the
 * only cheap moment to discover that is while you are still talking. The meter
 * has always shown it to anyone watching; this says it in words for anyone who
 * is not. It waits for a sustained run rather than a quiet moment, because a
 * warning that fires during a pause for breath is one you learn to ignore.
 *
 * ## Rules this follows
 *
 * - **It is a panel like every other floating panel.** An earlier version used
 *   the inverse surface, borrowing the macOS menu-bar recording pill. In dark
 *   theme that resolves to a *light* capsule, so the HUD was the only white
 *   object on the board while the radar, the tool dock and the comment inbox
 *   were all dark. Borrowing another platform's motif at the cost of internal
 *   consistency is the wrong trade; the red dot already carries the meaning.
 * - **The meter has a fixed footprint.** Chrome that changes width as the
 *   signal moves drags the eye off the canvas, and a status readout has no
 *   business being wider than the tool dock.
 * - **Nothing here is destructive by accident.** Done keeps the take, Discard
 *   throws it away and says so, and Escape does the same.
 */
export const AudioRecordingHUD: React.FC<Props> = ({
  elapsedMs,
  levels,
  remainingMs,
  paused,
  silent,
  onStop,
  onCancel,
  onTogglePause,
}) => {
  /**
   * Padded to a fixed count, newest on the right.
   *
   * Left short, the trace would grow in from nothing over the first second and
   * read as a loading state rather than a level meter.
   */
  const recent = levels.slice(-BAR_COUNT);
  const bars = [...new Array(Math.max(0, BAR_COUNT - recent.length)).fill(0), ...recent];

  const nearLimit = remainingMs !== undefined && remainingMs <= WARN_AT_MS;

  return (
    <div className="rec-hud">
      <div className={`rec-hud-panel panel-surface ${paused ? 'is-paused' : ''}`}>
        <span className="rec-hud-status">
          <span className="rec-hud-dot" aria-hidden="true" />
          <span className="rec-hud-elapsed">{formatClock(elapsedMs)}</span>
        </span>

        <div className="rec-hud-meter" aria-hidden="true">
          {bars.map((v, i) => (
            <span
              key={i}
              className="rec-hud-tick"
              style={{
                // A 0.1 floor keeps a continuous thread through the quiet
                // parts, so silence reads as a quiet line rather than the
                // meter breaking into islands.
                //
                // Expressed as a scale rather than a height: the tick is
                // already full height, and animating height here re-laid out
                // the whole meter row on every audio frame for the duration of
                // the recording.
                //
                // No multiplier on `v` any more. The old meter needed one
                // because it was averaging frequency bins, which reads far
                // lower than the signal actually is; a proper RMS level uses
                // its full range on its own.
                transform: `scaleY(${Math.max(0.1, Math.min(v, 1))})`,
                opacity: 0.32 + Math.min(v, 1) * 0.68,
              }}
            />
          ))}
        </div>

        {/* Only one of these ever shows. They compete for the same slot and the
            same attention, and "you have 20 seconds left" matters more than
            "we cannot hear you" once the cap is that close. */}
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
          <button
            type="button"
            className="rec-hud-discard"
            onClick={onCancel}
            data-tooltip="Discard (Esc)"
            aria-label="Discard recording"
          >
            <Trash2 size={14} />
          </button>
        )}

        <button type="button" className="rec-hud-done" onClick={onStop}>
          <Check size={14} />
          Done
        </button>
      </div>

      {/* Announced separately so a screen reader gets the state without the
          meter, which is decoration to anyone not looking at it. */}
      <span className="sr-only" role="status" aria-live="polite">
        {paused ? 'Recording paused' : 'Recording'}, {formatClock(elapsedMs)}
        {silent && !paused ? ', no sound is being picked up' : ''}
      </span>

      <span className="rec-hud-hint">Space to pause · Esc to discard</span>
    </div>
  );
};
