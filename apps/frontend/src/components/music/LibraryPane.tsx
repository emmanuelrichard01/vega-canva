import React, { useEffect } from 'react';
import { Repeat, Repeat1, Shuffle, X } from 'lucide-react';
import {
  cycleLibraryRepeat,
  dismissLibraryError,
  loadLibrary,
  playTrack,
  setLibraryCategory,
  toggleLibraryShuffle,
  tracksIn,
  useLibrary,
} from '../../engine/music/library/libraryStore';
import { categoryLabel, formatDuration } from '../../engine/music/library/manifest';
import { TrackArt } from './NowPlaying';
import { VinylGlyph } from './Turntable';

/**
 * Recorded tracks from the manifest: category filters, play order controls,
 * and the track list. Loads the manifest the first time it is shown.
 */
export const LibraryPane: React.FC = () => {
  const lib = useLibrary();

  useEffect(() => {
    if (lib.status === 'idle') void loadLibrary();
  }, [lib.status]);

  if (lib.status === 'loading' || lib.status === 'idle') {
    return (
      <div className="music-library" aria-busy="true" aria-label="Loading the library">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="music-row music-row--skeleton" aria-hidden="true" />
        ))}
      </div>
    );
  }

  if (lib.status === 'error') {
    return (
      <div className="music-empty">
        <p className="music-spotify__lede">The library didn't load.</p>
        <p className="music-note">{lib.error ?? 'Check your connection and try again.'} The stations still play without it.</p>
        <button type="button" className="music-connect" onClick={() => void loadLibrary()}>
          Try again
        </button>
      </div>
    );
  }

  if (lib.tracks.length === 0) {
    return (
      <div className="music-empty">
        <p className="music-spotify__lede">The library is empty.</p>
        <p className="music-note">Tracks listed in the music manifest appear here. Until then, the stations play.</p>
      </div>
    );
  }

  const visible = tracksIn(lib);
  const RepeatIcon = lib.repeat === 'one' ? Repeat1 : Repeat;
  const repeatLabel = lib.repeat === 'all' ? 'Repeat all' : lib.repeat === 'one' ? 'Repeat this track' : 'Repeat off';

  return (
    <div className="music-libpane">
      <div className="music-chips" role="group" aria-label="Category">
        <button type="button" className="music-chip" aria-pressed={lib.category === null} onClick={() => setLibraryCategory(null)}>
          All
        </button>
        {lib.categories.map((c) => (
          <button key={c} type="button" className="music-chip" aria-pressed={lib.category === c} onClick={() => setLibraryCategory(c)}>
            {categoryLabel(c)}
          </button>
        ))}
      </div>

      <div className="music-listhead">
        <span className="music-listhead__count">
          {visible.length} {visible.length === 1 ? 'track' : 'tracks'}
        </span>
        <span className="music-listhead__tools">
          <button
            type="button"
            className="btn-icon btn-icon--sm music-toggle"
            aria-pressed={lib.shuffle}
            aria-label="Shuffle"
            data-tooltip={lib.shuffle ? 'Shuffle on' : 'Shuffle off'}
            onClick={toggleLibraryShuffle}
          >
            <Shuffle size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon btn-icon--sm music-toggle"
            aria-pressed={lib.repeat !== 'off'}
            aria-label={repeatLabel}
            data-tooltip={repeatLabel}
            onClick={cycleLibraryRepeat}
          >
            <RepeatIcon size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
      </div>

      {lib.error && (
        <div className="music-error" role="alert">
          <span>{lib.error}</span>
          <button type="button" className="btn-icon btn-icon--sm" aria-label="Dismiss" onClick={dismissLibraryError}>
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="music-library" role="list" aria-label="Tracks">
        {visible.map((t, i) => {
          const current = lib.current?.id === t.id;
          return (
            <div role="listitem" key={t.id}>
              <button
                type="button"
                className={`music-row music-row--track${current ? ' is-selected' : ''}${lib.failed === t.id ? ' is-failed' : ''}`}
                aria-current={current ? 'true' : undefined}
                onClick={() => void playTrack(t.id)}
                title={`${t.title} · ${t.licence}`}
              >
                <span className="music-row__art">
                  <TrackArt artwork={t.artwork} category={t.category} seed={i * 7919 + 13} size={36} />
                  {current && lib.playing && (
                    <span className="music-row__now">
                      <VinylGlyph spinning />
                    </span>
                  )}
                </span>
                <span className="music-row__text">
                  <span className="music-row__name">{t.title}</span>
                  <span className="music-row__meta">{t.artist}</span>
                </span>
                <span className="music-row__duration">{formatDuration(t.duration)}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
