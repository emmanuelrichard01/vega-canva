import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ExternalLink, Heart, MoreHorizontal, RefreshCw, X } from 'lucide-react';
import { spotifyConfigured } from '../../engine/music/spotify/auth';
import {
  chooseDevice,
  connectSpotify,
  dismissSpotifyError,
  loadLibrary,
  playPlaylist,
  settleSpotifyNotice,
  signOutOfSpotify,
  useSpotify,
} from '../../engine/music/spotify/spotifyStore';
import { openInSpotifyUrl, type SpotifyPlaylist, type SpotifyProfile } from '../../engine/music/spotify/api';
import { DEV_MODE_MESSAGE } from '../../engine/music/spotify/messages';

/** Show the search field once a library is long enough to need it. */
const SEARCH_FROM = 6;

/**
 * The Spotify side of the player.
 *
 * Before connecting it is one line and one button. Once connected it shows
 * the account, the playlists and Liked Songs, and says how the music plays
 * only when that is not simply "here, in full".
 */
export const SpotifyPane: React.FC<{ volume: number }> = ({ volume }) => {
  const spotify = useSpotify();

  useEffect(() => {
    void settleSpotifyNotice();
  }, []);

  useEffect(() => {
    if (spotify.connected && !spotify.profile && !spotify.loading && !spotify.error && !spotify.limited) void loadLibrary();
  }, [spotify.connected, spotify.profile, spotify.loading, spotify.error, spotify.limited]);

  if (!spotifyConfigured()) {
    // Production hides the tab entirely; this is for a developer who has not set the app ID up.
    return (
      <div className="music-spotify">
        <p className="music-note">Spotify isn't configured.</p>
      </div>
    );
  }

  if (!spotify.connected) return <Intro error={spotify.error} />;

  return (
    <div className="music-spotify">
      <Account profile={spotify.profile} />

      {spotify.limited ? (
        <div className="music-notice" role="status">
          <span>{DEV_MODE_MESSAGE}</span>
          <button type="button" className="music-textbtn" onClick={() => void loadLibrary()}>
            Check again
          </button>
        </div>
      ) : (
        <Library volume={volume} />
      )}
    </div>
  );
};

/** Before connecting: what it is, one button, and a quiet "Learn more". */
const Intro: React.FC<{ error: string | null }> = ({ error }) => {
  const [busy, setBusy] = useState(false);
  return (
    <div className="music-spotify music-spotify--intro">
      <p className="music-spotify__lede">Play your playlists while you work.</p>
      {error && <ErrorLine message={error} />}
      <button
        type="button"
        className="music-connect"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void connectSpotify().finally(() => setBusy(false));
        }}
      >
        {error ? 'Try again' : 'Connect Spotify'}
      </button>
      <details className="music-more">
        <summary>Learn more</summary>
        <p className="music-note">Sign in with Spotify to play your playlists and Liked Songs here. Only you hear it, and the board never sees your account.</p>
      </details>
    </div>
  );
};

/** The signed-in person, with a menu that holds Disconnect. */
const Account: React.FC<{ profile: SpotifyProfile | null }> = ({ profile }) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const name = profile?.name ?? 'Spotify';
  return (
    <div className="music-spotify__account" ref={root}>
      <span className="music-spotify__who">
        {profile?.image ? (
          <img className="music-account__avatar" src={profile.image} alt="" width={24} height={24} referrerPolicy="no-referrer" />
        ) : (
          <span className="music-account__avatar music-account__avatar--blank" aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="music-account__name">{name}</span>
      </span>
      <button
        type="button"
        className="btn-icon btn-icon--sm"
        aria-label="Spotify account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} className="music-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="music-menu__item"
            autoFocus
            onClick={() => {
              setOpen(false);
              signOutOfSpotify();
            }}
          >
            Disconnect
          </button>
          <a className="music-menu__item" role="menuitem" href="https://www.spotify.com/account/apps/" target="_blank" rel="noopener noreferrer">
            Manage access in Spotify
            <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
};

/** Playlists and Liked Songs, with the play-state notice and device choice. */
const Library: React.FC<{ volume: number }> = ({ volume }) => {
  const spotify = useSpotify();
  const [query, setQuery] = useState('');
  const searchId = useId();
  const premium = spotify.profile?.product === 'premium';

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? spotify.playlists.filter((p) => p.name.toLowerCase().includes(q)) : spotify.playlists;
  }, [spotify.playlists, query]);

  const route = spotify.route;
  const deviceId = route?.kind === 'device' ? route.deviceId : '';

  return (
    <>
      {spotify.embed && (
        <iframe
          className="music-embed"
          title={`Spotify player: ${spotify.current?.name ?? 'playlist'}`}
          src={spotify.embed}
          height={152}
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        />
      )}

      {spotify.notice && (
        <div className="music-notice" role="status">
          <span>{spotify.notice.text}</span>
          {spotify.notice.reconnect && (
            <button type="button" className="music-textbtn" onClick={() => void connectSpotify()}>
              Reconnect
            </button>
          )}
          {spotify.notice.action === 'open' && spotify.current && (
            <a className="music-textbtn" href={openInSpotifyUrl(spotify.current)} target="_blank" rel="noopener noreferrer">
              Open in Spotify
              <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
            </a>
          )}
        </div>
      )}

      {premium && spotify.current && spotify.devices.length > 0 && (
        <label className="music-device">
          <span>Play on</span>
          <select
            className="music-select"
            value={deviceId}
            onChange={(e) => {
              const device = spotify.devices.find((d) => d.id === e.target.value);
              if (device) void chooseDevice(device, volume);
            }}
          >
            {deviceId === '' && <option value="">This board</option>}
            {spotify.devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {spotify.error && (
        <ErrorLine message={spotify.error} onRetry={spotify.playlists.length === 0 || !spotify.profile ? () => void loadLibrary() : undefined} />
      )}

      {spotify.playlists.length >= SEARCH_FROM && (
        <div className="music-search">
          <label htmlFor={searchId} className="sr-only">
            Search playlists
          </label>
          <input
            id={searchId}
            type="search"
            className="music-search__input"
            placeholder="Search playlists"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      <div className="music-library" role="list" aria-label="Your playlists" aria-busy={spotify.loading}>
        {spotify.loading && spotify.playlists.length === 0 && (
          <>
            <div className="music-row music-row--skeleton" aria-hidden="true" />
            <div className="music-row music-row--skeleton" aria-hidden="true" />
            <div className="music-row music-row--skeleton" aria-hidden="true" />
          </>
        )}
        {!spotify.loading && spotify.playlists.length === 0 && !spotify.error && (
          <p className="music-note">No playlists yet. Playlists you create or follow in Spotify appear here.</p>
        )}
        {spotify.playlists.length > 0 && shown.length === 0 && <p className="music-note">No playlists match.</p>}
        {shown.map((p) => (
          <div role="listitem" key={p.id}>
            <button
              type="button"
              className={`music-row${spotify.current?.id === p.id ? ' is-selected' : ''}`}
              aria-current={spotify.current?.id === p.id ? 'true' : undefined}
              onClick={() => void playPlaylist(p, volume)}
            >
              <PlaylistArt playlist={p} size={32} />
              <span className="music-row__text">
                <span className="music-row__name">{p.name}</span>
                <span className="music-row__meta">
                  {p.tracks} {p.tracks === 1 ? 'track' : 'tracks'}
                  {p.owner && p.kind === 'playlist' ? ` · ${p.owner}` : ''}
                </span>
              </span>
            </button>
          </div>
        ))}
      </div>
    </>
  );
};

const ErrorLine: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="music-error" role="alert">
    <span>{message}</span>
    <span className="music-error__tools">
      {onRetry && (
        <button type="button" className="music-textbtn" onClick={onRetry}>
          <RefreshCw size={12} strokeWidth={2} aria-hidden="true" />
          Retry
        </button>
      )}
      <button type="button" className="btn-icon btn-icon--sm" aria-label="Dismiss" onClick={dismissSpotifyError}>
        <X size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </span>
  </div>
);

const PlaylistArt: React.FC<{ playlist: SpotifyPlaylist; size: number }> = ({ playlist, size }) =>
  playlist.image ? (
    <img className="music-art" src={playlist.image} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" />
  ) : (
    <span className="music-art music-art--blank" style={{ width: size, height: size }} aria-hidden="true">
      {playlist.kind === 'liked' ? <Heart size={Math.round(size * 0.45)} strokeWidth={1.75} /> : playlist.name.slice(0, 1).toUpperCase()}
    </span>
  );
