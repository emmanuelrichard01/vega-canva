import React, { useEffect, useId, useRef } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { setMusicVolume, toggleMute, useMusic } from '../../engine/music/musicStore';
import { volumeFromWheel } from '../../engine/music/playerMath';

/** A mute toggle and a slider. Scrolling over either adjusts the volume in 5% steps. */
export const VolumeControl: React.FC = () => {
  const { volume: v } = useMusic();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const volume = useRef(v);
  volume.current = v;
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2;

  // React attaches wheel listeners as passive; this one must be able to stop the panel scrolling.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      setMusicVolume(volumeFromWheel(volume.current, e.deltaY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div ref={root} className="music-volume">
      <button
        type="button"
        className="btn-icon btn-icon--sm"
        aria-label={v === 0 ? 'Unmute' : 'Mute'}
        aria-pressed={v === 0}
        data-tooltip={v === 0 ? 'Unmute · M' : 'Mute · M'}
        onClick={toggleMute}
      >
        <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <label htmlFor={id} className="sr-only">
        Volume
      </label>
      <input
        id={id}
        className="music-range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(v * 100)}
        onChange={(e) => setMusicVolume(Number(e.target.value) / 100)}
        style={{ '--fill': `${Math.round(v * 100)}%` } as React.CSSProperties}
        aria-valuetext={`${Math.round(v * 100)}%`}
      />
    </div>
  );
};
