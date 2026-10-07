import React from 'react';
import { Heart, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import type { RepeatMode } from '../../engine/music/library/queue';

/** A control that is unavailable says why in its tooltip, and keeps its place and focus. */
export interface Gate {
  /** Why it cannot be used right now; null when it can. */
  reason: string | null;
}

const REPEAT_LABEL: Record<RepeatMode, string> = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat this track' };

interface ToggleProps extends Gate {
  on: boolean;
  onClick: () => void;
}

export const ShuffleButton: React.FC<ToggleProps> = ({ on, onClick, reason }) => (
  <button
    type="button"
    className="btn-icon music-toggle music-toggle--mark"
    aria-pressed={on}
    aria-label="Shuffle"
    aria-disabled={reason ? true : undefined}
    data-tooltip={reason ?? (on ? 'Shuffle on · S' : 'Shuffle off · S')}
    onClick={reason ? undefined : onClick}
  >
    <Shuffle size={16} strokeWidth={1.75} aria-hidden="true" />
  </button>
);

export const RepeatButton: React.FC<{ mode: RepeatMode; onClick: () => void } & Gate> = ({ mode, onClick, reason }) => {
  const Icon = mode === 'one' ? Repeat1 : Repeat;
  return (
    <button
      type="button"
      className="btn-icon music-toggle music-toggle--mark"
      aria-pressed={mode !== 'off'}
      aria-label={REPEAT_LABEL[mode]}
      aria-disabled={reason ? true : undefined}
      data-tooltip={reason ?? `${REPEAT_LABEL[mode]} · R`}
      onClick={reason ? undefined : onClick}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
};

/** A heart that is filled when on, so state never rests on colour alone. */
export const LikeButton: React.FC<{ on: boolean | null; onClick: () => void; /** Replaces the name when the press does something else, such as asking for more access. */ label?: string } & Gate> = ({
  on,
  onClick,
  reason,
  label,
}) => (
  <button
    type="button"
    className={`btn-icon music-like${on ? ' is-on' : ''}`}
    aria-pressed={label ? undefined : (on ?? false)}
    aria-label={label ?? (on ? 'Remove from Liked Songs' : 'Save to Liked Songs')}
    aria-disabled={reason ? true : undefined}
    data-tooltip={reason ?? label ?? (on ? 'Saved · L' : 'Save to Liked Songs · L')}
    onClick={reason ? undefined : onClick}
  >
    <Heart size={17} strokeWidth={1.75} fill={on ? 'currentColor' : 'none'} aria-hidden="true" />
  </button>
);

export interface TransportProps {
  playing: boolean;
  onToggle: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  /** Why previous and next are unavailable. */
  skipReason: string | null;
  shuffle: { on: boolean; onToggle: () => void; reason: string | null } | null;
  repeat: { mode: RepeatMode; onCycle: () => void; reason: string | null } | null;
  /** The play button waits while a source is starting. */
  starting?: boolean;
}

/** Shuffle, previous, play or pause, next, repeat: one control language for every source. */
export const Transport: React.FC<TransportProps> = ({ playing, onToggle, onPrevious, onNext, skipReason, shuffle, repeat, starting }) => (
  <div className="music-transport" role="group" aria-label="Playback">
    {shuffle ? <ShuffleButton on={shuffle.on} onClick={shuffle.onToggle} reason={shuffle.reason} /> : <span className="music-transport__gap" />}
    <button
      type="button"
      className="btn-icon"
      aria-label="Previous"
      aria-disabled={onPrevious ? undefined : true}
      data-tooltip={onPrevious ? 'Previous · ←' : (skipReason ?? undefined)}
      onClick={onPrevious ?? undefined}
    >
      <SkipBack size={18} strokeWidth={1.75} fill="currentColor" aria-hidden="true" />
    </button>
    <button
      type="button"
      className="music-play"
      aria-label={playing ? 'Pause' : 'Play'}
      aria-busy={starting || undefined}
      data-tooltip={playing ? 'Pause · Space' : 'Play · Space'}
      onClick={onToggle}
    >
      {playing ? <Pause size={20} strokeWidth={1.75} fill="currentColor" aria-hidden="true" /> : <Play size={20} strokeWidth={1.75} fill="currentColor" aria-hidden="true" />}
    </button>
    <button
      type="button"
      className="btn-icon"
      aria-label="Next track"
      aria-disabled={onNext ? undefined : true}
      data-tooltip={onNext ? 'Next track · →' : (skipReason ?? undefined)}
      onClick={onNext ?? undefined}
    >
      <SkipForward size={18} strokeWidth={1.75} fill="currentColor" aria-hidden="true" />
    </button>
    {repeat ? <RepeatButton mode={repeat.mode} onClick={repeat.onCycle} reason={repeat.reason} /> : <span className="music-transport__gap" />}
  </div>
);
