import React, { useEffect, useRef } from 'react';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Switch } from '../ui/Switch';
import { NowPlaying, useCompactPlayer, useHasNowPlaying } from './NowPlaying';
import { VolumeControl } from './VolumeControl';
import { StationsPane } from './StationsPane';
import { SpotifyPane } from './SpotifyPane';
import { setShareListening, switchSource, useMusic, type MusicSource } from '../../engine/music/musicStore';
import { spotifyAvailable } from '../../engine/music/spotify/auth';
import { keyBelongsToControl, runTransportKey, transportKeyAction } from '../../engine/music/transport';
import '../../engine/music/signalBridge';
import './music.css';

/**
 * The player: now playing, the source tabs, the source's own list, and volume.
 * While it has focus: Space plays or pauses, Left and Right skip, Up and Down
 * set the volume, S shuffles, R repeats, L likes, M mutes. A focused control
 * that needs a key (a slider, a field, a menu) keeps it.
 */
const MusicPanel: React.FC<{ autoFocus?: boolean }> = ({ autoFocus = true }) => {
  const music = useMusic();
  const root = useRef<HTMLDivElement>(null);
  const compact = useCompactPlayer();

  useEffect(() => {
    if (autoFocus) root.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const action = transportKeyAction(e.key);
    if (!action || keyBelongsToControl(e.target, e.key)) return;
    e.preventDefault();
    runTransportKey(action);
  };

  const segments = [
    { value: 'stations', label: 'Stations' },
    { value: 'spotify', label: 'Spotify' },
  ];

  return (
    <div ref={root} className={`music${compact ? ' music--mini' : ''}`} tabIndex={-1} onKeyDown={onKeyDown} aria-label="Music player">
      <NowPlaying />
      {!compact && spotifyAvailable() && (
        <div className="music__source">
          <SegmentedControl ariaLabel="Music source" fill value={music.source} segments={segments} onChange={(v) => switchSource(v as MusicSource)} />
        </div>
      )}
      {!compact && (music.source === 'stations' ? <StationsPane /> : <SpotifyPane volume={music.volume} />)}
      {!compact && <Footer />}
    </div>
  );
};

export default MusicPanel;

const Footer: React.FC = () => {
  const music = useMusic();
  const playing = useHasNowPlaying();
  // Spotify has no share line, and its volume lives with the transport once something plays.
  if (playing && music.source === 'spotify') return null;
  return (
    <div className="music-foot">
      {/* Once something plays, volume sits with the transport above. */}
      {!playing && <VolumeControl />}
      {music.source !== 'spotify' && (
        <div className="music-share">
          <span className="music-share__label">Listen together: show what I'm playing</span>
          <Switch checked={music.shareListening} onChange={setShareListening} tooltip="Shows the station you're playing beside your name, for people in this board" />
        </div>
      )}
    </div>
  );
};
