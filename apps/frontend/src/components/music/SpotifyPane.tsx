import React, { useEffect } from 'react';
import { ExternalLink, Heart, X } from 'lucide-react';
import { beginSpotifySignIn, spotifyConfigured } from '../../engine/music/spotify/auth';
import {
  dismissSpotifyError,
  loadLibrary,
  playPlaylist,
  settleSpotifyNotice,
  signOutOfSpotify,
  useSpotify,
} from '../../engine/music/spotify/spotifyStore';
import type { SpotifyPlaylist } from '../../engine/music/spotify/api';

/**
 * The Spotify side of the player.
 *
 * Three states: not configured on this deployment (explained, no button),
 * not connected (one Connect button), and connected (the library, with
 * playback routed to this tab, a device, or Spotify's embed player).
 */
export const SpotifyPane: React.FC<{ volume: number }> = ({ volume }) => {
  const spotify = useSpotify();

  useEffect(() => {
    void settleSpotifyNotice();
  }, []);

  useEffect(() => {
    if (spotify.connected && !spotify.profile && !spotify.loading && !spotify.error) void loadLibrary();
  }, [spotify.connected, spotify.profile, spotify.loading, spotify.error]);

  if (!spotifyConfigured()) {
    return (
      <div className="music-spotify music-spotify--empty">
        <p className="music-spotify__lede">Spotify isn't set up on this deployment.</p>
        <p className="music-note">An administrator can enable it by adding a Spotify app ID. Until then, the stations play here.</p>
      </div>
    );
  }

  if (!spotify.connected) {
    return (
      <div className="music-spotify music-spotify--empty">
        <p className="music-spotify__lede">Play your own playlists while you work.</p>
        <p className="music-note">With Premium it plays here in the board. Other accounts play on a device where Spotify is open, or as previews.</p>
        {spotify.error && <ErrorLine message={spotify.error} />}
        <button type="button" className="music-connect" onClick={() => void beginSpotifySignIn().catch(() => {})}>
          Connect Spotify
        </button>
      </div>
    );
  }

  return (
    <div className="music-spotify">
      <div className="music-spotify__account">
        <span className="music-spotify__who">
          {spotify.profile ? `Signed in as ${spotify.profile.name}` : 'Connected to Spotify'}
          {spotify.profile?.product === 'premium' && <span className="music-spotify__tier">Premium</span>}
        </span>
        <button type="button" className="music-textbtn" onClick={signOutOfSpotify}>
          Disconnect
        </button>
      </div>

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

      {spotify.error && <ErrorLine message={spotify.error} />}

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
        {spotify.playlists.map((p) => (
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

      <a className="music-textbtn music-textbtn--link" href="https://www.spotify.com/account/apps/" target="_blank" rel="noopener noreferrer">
        Manage Spotify access
        <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
      </a>
    </div>
  );
};

const ErrorLine: React.FC<{ message: string }> = ({ message }) => (
  <div className="music-error" role="alert">
    <span>{message}</span>
    <button type="button" className="btn-icon btn-icon--sm" aria-label="Dismiss" onClick={dismissSpotifyError}>
      <X size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>
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
