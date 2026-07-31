import React from 'react';
import { Check, Trash2 } from 'lucide-react';
import { formatClock } from '../engine/model/audioPlayback';

interface Props {
  elapsedMs: number;
  level: number;
  levels: number[];
  remainingMs?: number;
  onStop: () => void;
  onCancel?: () => void;
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
 *    caught in the first second instead of after the meeting.
 * 4. **How to end it**, two ways: keep it, or throw it away.
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
 * - **No decorative effects.** A mask fade on the meter's leading edge read as
 *   the trace being clipped rather than flowing — a subtle effect that misfires
 *   looks like a rendering bug, which is worse than not having it.
 * - **Nothing here is destructive by accident.** Done keeps the take, Discard
 *   throws it away and says so, and Escape does the same.
 */
export const AudioRecordingHUD: React.FC<Props> = ({
  elapsedMs,
  levels,
  remainingMs,
  onStop,
  onCancel,
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
      <div className="rec-hud-panel panel-surface">
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
                // A 0.1 floor (2px of the meter's 20px) keeps a continuous
                // thread through the quiet parts, so silence reads as a quiet
                // line rather than the meter breaking into islands.
                //
                // Expressed as a scale rather than a height: the tick is
                // already full height, and animating height here re-laid out
                // the whole meter row on every audio frame for the duration of
                // the recording.
                transform: `scaleY(${Math.max(0.1, Math.min(v * 2.2, 1))})`,
                opacity: 0.32 + Math.min(v * 2, 1) * 0.68,
              }}
            />
          ))}
        </div>

        {nearLimit && <span className="rec-hud-warn">{formatClock(remainingMs!)} left</span>}

        <span className="rec-hud-rule" aria-hidden="true" />

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

      {/* Announced separately so a screen reader gets the time without the
          meter, which is decoration to anyone not looking at it. */}
      <span className="sr-only" role="status" aria-live="polite">
        Recording, {formatClock(elapsedMs)}
      </span>

      <span className="rec-hud-hint">Esc to discard</span>
    </div>
  );
};
