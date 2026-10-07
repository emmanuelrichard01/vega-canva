import React, { useId } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Turntable } from './Turntable';
import { CategoryCover } from './CategoryCover';
import { togglePlay, useMusic } from '../../engine/music/musicStore';
import { seekLibrary, skipLibrary, useLibrary } from '../../engine/music/library/libraryStore';
import { categoryLabel, formatDuration } from '../../engine/music/library/manifest';
import { creditFor, type Credit } from '../../engine/music/library/credits';
import { nextSpotifyTrack, pauseSpotify, previousSpotifyTrack, resumeSpotify, useSpotify } from '../../engine/music/spotify/spotifyStore';

/** Cover art for a track: its own artwork, or its station's drawn cover. */
export const TrackArt: React.FC<{ artwork: string | null; category: string; size: number; className?: string }> = ({ artwork, category, size, className }) =>
  artwork ? (
    <img className={`music-art ${className ?? ''}`} src={artwork} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" />
  ) : (
    <CategoryCover category={category} className={`music-art ${className ?? ''}`} />
  );

interface View {
  title: string;
  subtitle: string;
  art: React.ReactNode;
  playing: boolean;
  progress: { position: number; duration: number } | null;
  toggle: () => void;
  next: (() => void) | null;
  previous: (() => void) | null;
  status: string | null;
  /** Attribution for a recorded track; some licences require it wherever the track plays. */
  credit: Credit | null;
}

/** What the hero shows, from whichever source is selected. */
function useView(): View | null {
  const music = useMusic();
  const library = useLibrary();
  const spotify = useSpotify();

  if (music.source === 'stations') {
    const t = library.current;
    if (!t) return null;
    return {
      title: t.title,
      subtitle: `${t.artist} · ${categoryLabel(t.category)}`,
      art: <TrackArt artwork={t.artwork} category={t.category} size={64} />,
      playing: library.playing,
      progress: { position: library.position, duration: library.duration || t.duration },
      toggle: () => void togglePlay(),
      next: () => void skipLibrary(1),
      previous: () => void skipLibrary(-1),
      status: library.buffering ? 'Loading…' : null,
      credit: creditFor(t),
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
    previous: route?.kind === 'embed' ? null : () => void previousSpotifyTrack(),
    status: null,
    credit: null,
  };
}

/**
 * The top of the player: the turntable with the current art as its label,
 * what is playing, the transport, and the track's credit.
 */
export const NowPlaying: React.FC = () => {
  const view = useView();
  const music = useMusic();
  const spotify = useSpotify();
  const seekId = useId();

  // Nothing yet: a one-line prompt, so the choices below are the content. Spotify has none to offer until it is connected.
  if (!view) {
    if (music.source === 'spotify' && (!spotify.connected || spotify.limited)) return null;
    return (
      <p className="music-prompt" role="status">
        {music.source === 'stations' ? 'Pick a station to start.' : 'Pick a playlist to start.'}
      </p>
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
            <button type="button" className="btn-icon" aria-label="Next track" data-tooltip="Next track · →" onClick={view.next}>
              <SkipForward size={16} strokeWidth={1.75} aria-hidden="true" />
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
      {view.credit && <CreditLine credit={view.credit} />}
    </div>
  );
};

/** "Music: Title by Artist · Source", with the source linked when the licence names a page. */
export const CreditLine: React.FC<{ credit: Credit }> = ({ credit }) => (
  <p className="music-credit">
    Music: {credit.title} by {credit.artist} ·{' '}
    {credit.url ? (
      <a href={credit.url} target="_blank" rel="noopener noreferrer">
        {credit.source}
      </a>
    ) : (
      credit.source
    )}
  </p>
);
