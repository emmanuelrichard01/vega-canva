import React, { useId } from 'react';
import { Pause, Play, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { Turntable } from './Turntable';
import { StationCover } from './StationCover';
import { stationById, type StationId } from '../../engine/music/stations';
import { keyName, variationTitle } from '../../engine/music/describe';
import { musicEngine } from '../../engine/music/engine';
import { nextVariation, togglePlay, useMusic } from '../../engine/music/musicStore';
import {
  seekLibrary,
  skipLibrary,
  toggleLibrary,
  useLibrary,
} from '../../engine/music/library/libraryStore';
import { categoryLabel, formatDuration } from '../../engine/music/library/manifest';
import { nextSpotifyTrack, pauseSpotify, previousSpotifyTrack, resumeSpotify, useSpotify } from '../../engine/music/spotify/spotifyStore';

const KNOWN: readonly string[] = ['ambient', 'piano', 'lofi', 'synth', 'house', 'retro'];

/** Cover art for a library track: its artwork, or the station art for its category. */
export const TrackArt: React.FC<{ artwork: string | null; category: string; seed: number; size: number; className?: string }> = ({
  artwork,
  category,
  seed,
  size,
  className,
}) =>
  artwork ? (
    <img className={`music-art ${className ?? ''}`} src={artwork} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" />
  ) : KNOWN.includes(category) ? (
    <StationCover station={category as StationId} seed={seed} size={size} fluid className={`music-art ${className ?? ''}`} />
  ) : (
    <span className={`music-art music-art--blank ${className ?? ''}`} aria-hidden="true">
      {categoryLabel(category).slice(0, 1)}
    </span>
  );

interface View {
  title: string;
  subtitle: string;
  art: React.ReactNode;
  playing: boolean;
  progress: { position: number; duration: number } | null;
  toggle: () => void;
  next: (() => void) | null;
  nextLabel: string;
  previous: (() => void) | null;
  status: string | null;
}

/** What the hero shows, from whichever source is selected. */
function useView(): View | null {
  const music = useMusic();
  const library = useLibrary();
  const spotify = useSpotify();

  if (music.source === 'stations') {
    const station = stationById(music.station);
    const playing = music.status === 'playing';
    const now = playing ? musicEngine().nowPlaying : null;
    return {
      title: variationTitle(music.station, music.seed),
      subtitle: now ? `${station.name} · ${keyName(now.key)} · ${now.bpm} BPM` : station.name,
      art: <StationCover station={music.station} seed={music.seed} size={64} fluid />,
      playing,
      progress: null,
      toggle: () => void togglePlay(),
      next: () => void nextVariation(),
      nextLabel: 'New variation',
      previous: null,
      status: music.autoPaused && !playing ? 'Paused while this tab was in the background' : null,
    };
  }

  if (music.source === 'library') {
    const t = library.current;
    if (!t) return null;
    return {
      title: t.title,
      subtitle: `${t.artist} · ${categoryLabel(t.category)}`,
      art: <TrackArt artwork={t.artwork} category={t.category} seed={t.title.length * 7919} size={64} />,
      playing: library.playing,
      progress: { position: library.position, duration: library.duration || t.duration },
      toggle: () => void toggleLibrary(),
      next: () => void skipLibrary(1),
      nextLabel: 'Next track',
      previous: () => void skipLibrary(-1),
      status: library.buffering ? 'Loading…' : null,
    };
  }

  const p = spotify.current;
  if (!p) return null;
  const route = spotify.route;
  return {
    title: p.name,
    subtitle: route?.kind === 'sdk' ? 'Spotify · in this tab' : route?.kind === 'device' ? `Spotify · on ${route.name}` : 'Spotify',
    art: p.image ? <img className="music-art" src={p.image} alt="" width={64} height={64} referrerPolicy="no-referrer" /> : <span className="music-art music-art--blank" aria-hidden="true">{p.name.slice(0, 1)}</span>,
    playing: spotify.playing,
    progress: null,
    toggle: () => void (spotify.playing ? pauseSpotify() : resumeSpotify(music.volume)),
    next: route?.kind === 'embed' ? null : () => void nextSpotifyTrack(),
    nextLabel: 'Next track',
    previous: route?.kind === 'embed' ? null : () => void previousSpotifyTrack(),
    status: null,
  };
}

/**
 * The top of the player: the turntable with the current art as its label,
 * what is playing, and the transport.
 */
export const NowPlaying: React.FC = () => {
  const view = useView();
  const seekId = useId();

  if (!view) {
    return (
      <div className="music-hero music-hero--empty">
        <Turntable playing={false} progress={null} label={<span className="music-art music-art--blank" />} size={112} />
        <div className="music-hero__text">
          <div className="music-hero__title">Nothing playing</div>
          <div className="music-hero__subtitle">Pick something below to start.</div>
        </div>
      </div>
    );
  }

  const fraction = view.progress && view.progress.duration > 0 ? view.progress.position / view.progress.duration : null;
  return (
    <div className="music-hero">
      <Turntable playing={view.playing} progress={fraction} label={view.art} size={112} />
      <div className="music-hero__body">
        <div className="music-hero__text" aria-live="polite">
          <div className="music-hero__title" title={view.title}>
            {view.title}
          </div>
          <div className="music-hero__subtitle" title={view.subtitle}>
            {view.subtitle}
          </div>
          {view.status && <div className="music-hero__status">{view.status}</div>}
        </div>
        <div className="music-transport">
          {view.previous && (
            <button type="button" className="btn-icon" aria-label="Previous" data-tooltip="Previous · ←" onClick={view.previous}>
              <SkipBack size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="music-play"
            aria-label={view.playing ? 'Pause' : 'Play'}
            data-tooltip={view.playing ? 'Pause · Space' : 'Play · Space'}
            onClick={view.toggle}
          >
            {view.playing ? <Pause size={17} strokeWidth={2} aria-hidden="true" /> : <Play size={17} strokeWidth={2} aria-hidden="true" />}
          </button>
          {view.next && (
            <button type="button" className="btn-icon" aria-label={view.nextLabel} data-tooltip={`${view.nextLabel} · →`} onClick={view.next}>
              {view.nextLabel === 'New variation' ? (
                <Shuffle size={16} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <SkipForward size={16} strokeWidth={1.75} aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>
      {view.progress && (
        <div className="music-progress">
          <span className="music-progress__time">{formatDuration(view.progress.position)}</span>
          <label htmlFor={seekId} className="sr-only">
            Position
          </label>
          <input
            id={seekId}
            className="music-range"
            type="range"
            min={0}
            max={Math.max(1, Math.round(view.progress.duration))}
            step={1}
            value={Math.round(view.progress.position)}
            onChange={(e) => seekLibrary(Number(e.target.value))}
            style={{ '--fill': `${Math.round((fraction ?? 0) * 100)}%` } as React.CSSProperties}
            aria-valuetext={`${formatDuration(view.progress.position)} of ${formatDuration(view.progress.duration)}`}
          />
          <span className="music-progress__time">−{formatDuration(Math.max(0, view.progress.duration - view.progress.position))}</span>
        </div>
      )}
    </div>
  );
};
