import React, { useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { stationTint } from '../../engine/music/tint';
import { Turntable } from './Turntable';
import { TrackArt } from './TrackArt';
import { SeekBar } from './SeekBar';
import { LikeButton, Transport, type TransportProps } from './Transport';
import { VolumeControl } from './VolumeControl';
import { DeviceChip } from './DeviceChip';
import { SpotifyUpNext, StationUpNext } from './UpNext';
import { useNow } from './hooks';
import { togglePlay, useMusic } from '../../engine/music/musicStore';
import { cycleLibraryRepeat, seekLibrary, skipLibrary, toggleLibraryShuffle, useLibrary } from '../../engine/music/library/libraryStore';
import { categoryLabel } from '../../engine/music/library/manifest';
import { creditFor, type Credit } from '../../engine/music/library/credits';
import {
  canLikeTracks,
  connectSpotify,
  cycleSpotifyRepeat,
  nextSpotifyTrack,
  pauseSpotify,
  previousSpotifyTrack,
  resumeSpotify,
  seekSpotify,
  spotifyPositionMs,
  toggleSpotifyLike,
  toggleSpotifyShuffle,
  useSpotify,
} from '../../engine/music/spotify/spotifyStore';
import { setMiniMode, useMiniMode } from '../../engine/music/playingSignal';
import './nowplaying.css';

/** Whether anything is loaded in the selected source, so the panel knows to show the player or its prompt. */
export function useHasNowPlaying(): boolean {
  const music = useMusic();
  const library = useLibrary();
  const spotify = useSpotify();
  return music.source === 'stations' ? library.current !== null : spotify.current !== null;
}

/** The compact bar replaces the lists only when it can do the whole job: Spotify's own embedded player needs its space. */
export function useCompactPlayer(): boolean {
  const music = useMusic();
  const spotify = useSpotify();
  const mini = useMiniMode();
  const has = useHasNowPlaying();
  return mini && has && !(music.source === 'spotify' && spotify.route?.kind === 'embed');
}

/** The title on one line; on hover it slides to show the rest. Still under reduced motion, where the full text is in the tooltip. */
const Marquee: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => setOverflow(Math.max(0, Math.ceil(i.scrollWidth - o.clientWidth)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div
      ref={outer}
      className={`np-marquee ${className ?? ''}${overflow > 0 ? ' is-overflowing' : ''}`}
      title={text}
      style={{ '--overflow': `${overflow}px`, '--overflow-n': overflow } as React.CSSProperties}
    >
      <span ref={inner} className="np-marquee__inner">
        {text}
      </span>
    </div>
  );
};

/** Everything the player shows for the current track, whichever source it comes from. */
interface Model {
  kind: 'stations' | 'spotify';
  title: string;
  subtitle: string;
  source: string;
  /** The large art (or the turntable) and the small tile for the compact bar. */
  stage: React.ReactNode;
  tile: React.ReactNode;
  /** An image to blur into the ambient glow. */
  glow: string | null;
  playing: boolean;
  status: string | null;
  transport: TransportProps | null;
  seek: { position: number; duration: number; buffered?: number; onSeek: (s: number) => void; reason: string | null } | null;
  like: React.ReactNode;
  /** In place of the transport, when the controls live elsewhere. */
  note: string | null;
  credit: Credit | null;
  upNext: React.ReactNode;
  device: React.ReactNode;
}

function useStationModel(): Model | null {
  const library = useLibrary();
  const t = library.current;
  if (!t) return null;
  const position = library.position;
  const duration = library.duration || t.duration;
  return {
    kind: 'stations',
    title: t.title,
    subtitle: t.artist,
    source: `${categoryLabel(t.category)} station`,
    stage: <Turntable playing={library.playing} progress={duration > 0 ? position / duration : null} label={<TrackArt artwork={t.artwork} category={t.category} size={64} />} size={148} tint={stationTint(t.category)} />,
    tile: <TrackArt artwork={t.artwork} category={t.category} size={44} />,
    glow: null,
    playing: library.playing,
    status: library.buffering ? 'Loading…' : null,
    transport: {
      playing: library.playing,
      onToggle: () => void togglePlay(),
      onPrevious: () => void skipLibrary(-1),
      onNext: () => void skipLibrary(1),
      skipReason: null,
      shuffle: { on: library.shuffle, onToggle: toggleLibraryShuffle, reason: null },
      repeat: { mode: library.repeat, onCycle: cycleLibraryRepeat, reason: null },
    },
    seek: { position, duration, buffered: library.buffered, onSeek: seekLibrary, reason: null },
    like: null,
    note: null,
    credit: creditFor(t),
    upNext: <StationUpNext />,
    device: null,
  };
}

function useSpotifyModel(): Model | null {
  const music = useMusic();
  const spotify = useSpotify();
  const route = spotify.route;
  const running = spotify.playing && (route?.kind === 'sdk' || route?.kind === 'device');
  const now = useNow(running);
  const playlist = spotify.current;
  if (!playlist) return null;

  const track = spotify.track;
  const embed = route?.kind === 'embed';
  const art = track?.image ?? playlist.image;
  const starting = !route && !spotify.error;
  const wait = 'Waiting for Spotify';
  const canLike = canLikeTracks();

  const transport: TransportProps | null = embed
    ? null
    : {
        playing: spotify.playing,
        starting,
        onToggle: () => void (spotify.playing ? pauseSpotify() : resumeSpotify(music.volume)),
        onPrevious: route ? () => void previousSpotifyTrack() : null,
        onNext: route ? () => void nextSpotifyTrack() : null,
        skipReason: wait,
        shuffle: { on: spotify.shuffle, onToggle: () => void toggleSpotifyShuffle(), reason: route ? null : wait },
        repeat: { mode: spotify.repeat, onCycle: () => void cycleSpotifyRepeat(), reason: route ? null : wait },
      };

  const duration = spotify.durationMs / 1000;
  return {
    kind: 'spotify',
    title: track?.title ?? playlist.name,
    subtitle: track ? track.artist : starting ? 'Starting…' : '',
    source: track ? playlist.name : 'Spotify',
    stage: <TrackArt artwork={art} category={null} size={156} label={playlist.name} className="np-art" />,
    tile: <TrackArt artwork={art} category={null} size={44} label={playlist.name} />,
    glow: art,
    playing: spotify.playing,
    status: null,
    transport,
    seek: embed
      ? null
      : {
          position: spotifyPositionMs(spotify, now) / 1000,
          duration,
          onSeek: (s) => void seekSpotify(s),
          reason: duration > 0 ? null : wait,
        },
    like:
      embed || !track?.id ? null : !canLike ? (
        <LikeButton on={null} onClick={() => void connectSpotify()} reason={null} label="Reconnect Spotify to save songs" />
      ) : (
        <LikeButton on={spotify.liked} onClick={() => void toggleSpotifyLike()} reason={spotify.liked === null ? 'Checking Liked Songs…' : null} />
      ),
    note: embed ? 'Playback controls are in the Spotify player below.' : null,
    credit: null,
    upNext: embed ? null : <SpotifyUpNext />,
    device: embed ? null : <DeviceChip volume={music.volume} />,
  };
}

/**
 * The top of the player. Stations and Spotify share one layout: art (the
 * turntable for stations, the album for Spotify, glowing softly into the
 * panel), the track, a seek bar, and the transport. A compact mode folds it
 * into one row.
 */
export const NowPlaying: React.FC = () => {
  const music = useMusic();
  const spotify = useSpotify();
  const stationModel = useStationModel();
  const spotifyModel = useSpotifyModel();
  const mini = useCompactPlayer();
  const model = music.source === 'stations' ? stationModel : spotifyModel;
  const library = useLibrary();
  const problem = music.source === 'stations' ? library.error : spotify.error;

  // Nothing yet: a one-line prompt, so the choices below are the content. Spotify has none to offer until it is connected.
  if (!model) {
    if (music.source === 'spotify' && (!spotify.connected || spotify.limited)) return null;
    return (
      <p className="music-prompt" role="status">
        {music.source === 'stations' ? 'Pick a station to start.' : 'Pick a playlist to start.'}
      </p>
    );
  }

  const toggleMini = (
    <button
      type="button"
      className="btn-icon btn-icon--sm np__size"
      aria-label={mini ? 'Expand the player' : 'Compact player'}
      data-tooltip={mini ? 'Expand the player' : 'Compact player'}
      aria-pressed={mini}
      onClick={() => setMiniMode(!mini)}
    >
      {mini ? <Maximize2 size={14} strokeWidth={1.75} aria-hidden="true" /> : <Minimize2 size={14} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );

  const live = (
    <span className="sr-only" role="status" aria-live="polite">
      {model.playing ? `Playing ${model.title}${model.subtitle ? ` by ${model.subtitle}` : ''}` : ''}
    </span>
  );

  if (mini) {
    return (
      <section className="np np--mini" aria-label="Now playing" data-kind={model.kind}>
        <div className="np-mini__row">
          <div className="np-mini__tile">{model.tile}</div>
          <div className="np__text">
            <Marquee text={model.title} className="np__title np__title--mini" />
            <div className="np__subtitle" title={model.subtitle}>
              {model.subtitle || model.source}
            </div>
          </div>
          {model.transport && <MiniTransport transport={model.transport} />}
          {toggleMini}
        </div>
        {model.seek && <SeekBar position={model.seek.position} duration={model.seek.duration} buffered={model.seek.buffered} onSeek={model.seek.onSeek} disabledReason={model.seek.reason} />}
        {problem && (
          <div className="music-error" role="alert">
            <span>{problem}</span>
          </div>
        )}
        {live}
      </section>
    );
  }

  return (
    <section className="np np--full" aria-label="Now playing" data-kind={model.kind}>
      <div className="np__stage">
        {model.glow && <img className="np__glow" src={model.glow} alt="" aria-hidden="true" referrerPolicy="no-referrer" />}
        <div className="np__art">{model.stage}</div>
        {!model.note && toggleMini}
      </div>
      <div className="np__meta">
        <div className="np__text">
          <Marquee text={model.title} className="np__title" />
          <div className="np__subtitle" title={model.subtitle}>
            {model.subtitle || ' '}
          </div>
          <div className="np__source" title={model.source}>
            {model.status ?? model.source}
          </div>
        </div>
        {model.like}
      </div>
      {model.seek && <SeekBar position={model.seek.position} duration={model.seek.duration} buffered={model.seek.buffered} onSeek={model.seek.onSeek} disabledReason={model.seek.reason} />}
      {model.transport && <Transport {...model.transport} />}
      {model.note && <p className="music-note np__note">{model.note}</p>}
      {!model.note && (
        <div className="np__aux">
          <VolumeControl />
          {model.device}
        </div>
      )}
      {model.upNext}
      {model.credit && <CreditLine credit={model.credit} />}
      {live}
    </section>
  );
};

/** Previous, play or pause, next: the compact bar's controls. */
const MiniTransport: React.FC<{ transport: TransportProps }> = ({ transport: t }) => {
  return (
    <div className="np-mini__controls">
      <Transport {...t} shuffle={null} repeat={null} />
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
