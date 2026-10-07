import React, { useEffect, useId, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Switch } from '../ui/Switch';
import { StationCover } from './StationCover';
import { NowPlaying } from './NowPlaying';
import { LibraryPane } from './LibraryPane';
import { SpotifyPane } from './SpotifyPane';
import { VinylGlyph } from './Turntable';
import { STATIONS, type StationId } from '../../engine/music/stations';
import { selectStation, setMusicVolume, setShareListening, switchSource, useMusic, type MusicSource } from '../../engine/music/musicStore';
import { libraryConfigured } from '../../engine/music/library/libraryStore';
import { keyBelongsToControl, transportSkip, transportToggle } from '../../engine/music/transport';
import './music.css';

/**
 * The player: now playing on a turntable, the source tabs, the source's own
 * list, and volume. While it has focus, Space plays or pauses and the arrow
 * keys skip, unless the focused control needs those keys itself.
 */
const MusicPanel: React.FC<{ autoFocus?: boolean }> = ({ autoFocus = true }) => {
  const music = useMusic();
  const root = useRef<HTMLDivElement>(null);
  const hasLibrary = libraryConfigured();

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
    ...(hasLibrary ? [{ value: 'library', label: 'Library' }] : []),
    { value: 'spotify', label: 'Spotify' },
  ];

  return (
    <div ref={root} className="music" tabIndex={-1} onKeyDown={onKeyDown} aria-label="Music player">
      <NowPlaying />
      <div className="music__source">
        <SegmentedControl ariaLabel="Music source" fill value={music.source} segments={segments} onChange={(v) => switchSource(v as MusicSource)} />
      </div>
      {music.source === 'stations' && <StationsPane />}
      {music.source === 'library' && <LibraryPane />}
      {music.source === 'spotify' && <SpotifyPane volume={music.volume} />}
      <Footer />
    </div>
  );
};

export default MusicPanel;

const StationsPane: React.FC = () => <StationGrid />;

const COLUMNS = 3;

/** The station tiles as a radio group: arrows move, Space or Enter plays. */
const StationGrid: React.FC = () => {
  const music = useMusic();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = STATIONS.findIndex((s) => s.id === music.station);

  const move = (to: number) => refs.current[Math.max(0, Math.min(STATIONS.length - 1, to))]?.focus();

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const map: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS };
    if (e.key in map) {
      e.preventDefault();
      move(i + map[e.key]);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      move(e.key === 'Home' ? 0 : STATIONS.length - 1);
    }
  };

  return (
    <div className="music-grid" role="radiogroup" aria-label="Stations">
      {STATIONS.map((s, i) => {
        const selected = s.id === music.station;
        const live = selected && music.status === 'playing' && music.source === 'stations';
        return (
          <button
            key={s.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === (current < 0 ? 0 : current) ? 0 : -1}
            className={`music-tile${selected ? ' is-selected' : ''}${live ? ' is-live' : ''}`}
            onClick={() => void selectStation(s.id as StationId)}
            onKeyDown={(e) => onKey(e, i)}
            data-tooltip={s.blurb}
          >
            <span className="music-tile__art">
              <StationCover station={s.id} seed={selected ? music.seed : 1} size={84} fluid className="music-tile__cover" />
              {live && (
                <span className="music-tile__now">
                  <VinylGlyph spinning />
                </span>
              )}
            </span>
            <span className="music-tile__name">{s.name}</span>
          </button>
        );
      })}
    </div>
  );
};

const Footer: React.FC = () => {
  const music = useMusic();
  const id = useId();
  const [restore, setRestore] = useState<number | null>(null);
  const v = music.volume;
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2;

  useEffect(() => {
    if (v > 0 && restore !== null) setRestore(null);
  }, [v, restore]);

  return (
    <div className="music-foot">
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
      {music.source !== 'spotify' && (
        <div className="music-share">
          <span className="music-share__label">Listen together: show what I'm playing</span>
          <Switch checked={music.shareListening} onChange={setShareListening} tooltip="Shows the station or category beside your name, for people in this board" />
        </div>
      )}
    </div>
  );
};
