import React, { useEffect, useId, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Switch } from '../ui/Switch';
import { NowPlaying } from './NowPlaying';
import { StationsPane } from './StationsPane';
import { SpotifyPane } from './SpotifyPane';
import { setMusicVolume, setShareListening, switchSource, useMusic, type MusicSource } from '../../engine/music/musicStore';
import { spotifyAvailable } from '../../engine/music/spotify/auth';
import { useSpotify } from '../../engine/music/spotify/spotifyStore';
import { keyBelongsToControl, transportSkip, transportToggle } from '../../engine/music/transport';
import '../../engine/music/signalBridge';
import './music.css';

/**
 * The player: now playing on a turntable, the source tabs, the source's own
 * list, and volume. While it has focus, Space plays or pauses and the arrow
 * keys skip, unless the focused control needs those keys itself.
 */
const MusicPanel: React.FC<{ autoFocus?: boolean }> = ({ autoFocus = true }) => {
  const music = useMusic();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) root.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!(e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    if (keyBelongsToControl(e.target, e.key)) return;
    e.preventDefault();
    if (e.key === ' ') transportToggle();
    else transportSkip(e.key === 'ArrowRight' ? 1 : -1);
  };

  const segments = [
    { value: 'stations', label: 'Stations' },
    { value: 'spotify', label: 'Spotify' },
  ];

  return (
    <div ref={root} className="music" tabIndex={-1} onKeyDown={onKeyDown} aria-label="Music player">
      <NowPlaying />
      {spotifyAvailable() && (
        <div className="music__source">
          <SegmentedControl ariaLabel="Music source" fill value={music.source} segments={segments} onChange={(v) => switchSource(v as MusicSource)} />
        </div>
      )}
      {music.source === 'stations' ? <StationsPane /> : <SpotifyPane volume={music.volume} />}
      <Footer />
    </div>
  );
};

export default MusicPanel;

const Footer: React.FC = () => {
  const music = useMusic();
  const spotify = useSpotify();
  const id = useId();
  const [restore, setRestore] = useState<number | null>(null);
  const v = music.volume;
  // The embedded player has its own volume, which this slider cannot reach.
  const embedVolume = music.source === 'spotify' && spotify.route?.kind === 'embed';
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2;

  useEffect(() => {
    if (v > 0 && restore !== null) setRestore(null);
  }, [v, restore]);

  return (
    <div className="music-foot">
      {embedVolume ? (
        <p className="music-note">Volume is set in the Spotify player above.</p>
      ) : (
        <div className="music-volume">
          <button
            type="button"
            className="btn-icon btn-icon--sm"
            aria-label={v === 0 ? 'Unmute' : 'Mute'}
            data-tooltip={v === 0 ? 'Unmute' : 'Mute'}
            onClick={() => {
              if (v === 0) setMusicVolume(restore ?? 0.6);
              else {
                setRestore(v);
                setMusicVolume(0);
              }
            }}
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
          <span className="music-volume__value" aria-hidden="true">
            {Math.round(v * 100)}
          </span>
        </div>
      )}
      {music.source !== 'spotify' && (
        <div className="music-share">
          <span className="music-share__label">Listen together: show what I'm playing</span>
          <Switch checked={music.shareListening} onChange={setShareListening} tooltip="Shows the station you're playing beside your name, for people in this board" />
        </div>
      )}
    </div>
  );
};
