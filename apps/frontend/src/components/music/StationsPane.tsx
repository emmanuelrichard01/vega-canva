import React, { useEffect, useRef } from 'react';
import { RefreshCw, X } from 'lucide-react';
import {
  dismissLibraryError,
  loadLibrary,
  playTrack,
  reloadLibrary,
  tracksIn,
  useLibrary,
} from '../../engine/music/library/libraryStore';
import { categoryBlurb, categoryLabel, formatDuration } from '../../engine/music/library/manifest';
import { creditFor } from '../../engine/music/library/credits';
import { selectStation, stationIds, useMusic } from '../../engine/music/musicStore';
import { TrackArt } from './TrackArt';
import { CategoryCover } from './CategoryCover';
import { VinylGlyph } from './VinylGlyph';

const COLUMNS = 3;

/**
 * The stations: six cards with cover art, each playing that category's
 * recorded tracks; the chosen station's track list; and the credits every
 * track's licence asks for. Loads the manifest the first time it is shown.
 * When the music cannot load, it says so plainly and offers to retry.
 */
export const StationsPane: React.FC = () => {
  const lib = useLibrary();
  const music = useMusic();

  useEffect(() => {
    if (lib.status === 'idle') void loadLibrary();
  }, [lib.status]);

  if (lib.status === 'loading' || lib.status === 'idle') {
    return (
      <div className="music-grid" aria-busy="true" aria-label="Loading the stations">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="music-tile music-tile--skeleton" aria-hidden="true">
            <span className="music-tile__art" />
            <span className="music-tile__name">&nbsp;</span>
          </span>
        ))}
      </div>
    );
  }

  if (lib.status === 'error') {
    return (
      <div className="music-empty" role="status">
        <p className="music-spotify__lede">Music is unavailable right now.</p>
        <p className="music-note">The stations couldn't be reached. Check your connection, then try again.</p>
        <button type="button" className="music-connect" onClick={() => void reloadLibrary()}>
          <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }

  const station = music.station;
  const visible = tracksIn(lib, station);

  return (
    <div className="music-libpane">
      <StationGrid />

      {visible.length === 0 ? (
        <div className="music-empty" role="status">
          <p className="music-note">No tracks in {categoryLabel(station)} yet.</p>
          <button type="button" className="music-textbtn" onClick={() => void reloadLibrary()}>
            Check again
          </button>
        </div>
      ) : (
        <>
          <div className="music-listhead">
            <span className="music-listhead__count">
              {categoryLabel(station)} · {visible.length} {visible.length === 1 ? 'track' : 'tracks'}
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

          <div className="music-library" role="list" aria-label={`${categoryLabel(station)} tracks`}>
            {visible.map((t) => {
              const current = lib.current?.id === t.id;
              return (
                <div role="listitem" key={t.id}>
                  <button
                    type="button"
                    className={`music-row music-row--track${current ? ' is-selected' : ''}${lib.failed === t.id ? ' is-failed' : ''}`}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => void playTrack(t.id)}
                  >
                    <span className="music-row__art">
                      <TrackArt artwork={t.artwork} category={t.category} size={36} />
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
        </>
      )}

      {lib.tracks.length > 0 && <Credits />}
    </div>
  );
};

/** The station cards as a radio group: arrows move, Space or Enter plays. */
const StationGrid: React.FC = () => {
  const music = useMusic();
  const lib = useLibrary();
  const ids = stationIds(lib.categories);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = ids.indexOf(music.station);

  const move = (to: number) => refs.current[Math.max(0, Math.min(ids.length - 1, to))]?.focus();
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const map: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS };
    if (e.key in map) {
      e.preventDefault();
      move(i + map[e.key]);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      move(e.key === 'Home' ? 0 : ids.length - 1);
    }
  };

  return (
    <div className="music-grid" role="radiogroup" aria-label="Stations">
      {ids.map((id, i) => {
        const selected = id === music.station;
        const live = selected && lib.playing && lib.current?.category === id;
        const artwork = lib.tracks.find((t) => t.category === id && t.artwork)?.artwork ?? null;
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === (current < 0 ? 0 : current) ? 0 : -1}
            className={`music-tile${selected ? ' is-selected' : ''}${live ? ' is-live' : ''}`}
            onClick={() => void selectStation(id)}
            onKeyDown={(e) => onKey(e, i)}
            data-tooltip={categoryBlurb(id) ?? undefined}
          >
            <span className="music-tile__art">
              {artwork ? <img className="music-tile__cover" src={artwork} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <CategoryCover category={id} className="music-tile__cover" />}
              {live && (
                <span className="music-tile__now">
                  <VinylGlyph spinning />
                </span>
              )}
            </span>
            <span className="music-tile__name">{categoryLabel(id)}</span>
          </button>
        );
      })}
    </div>
  );
};

/** Every track's attribution, as its licence asks. */
const Credits: React.FC = () => {
  const lib = useLibrary();
  return (
    <details className="music-credits">
      <summary>Credits</summary>
      <ul>
        {lib.tracks.map((t) => {
          const c = creditFor(t);
          return (
            <li key={t.id}>
              <span className="music-credits__track">
                {c.title} by {c.artist}
              </span>
              <span className="music-credits__source">
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noopener noreferrer">
                    {c.source}
                  </a>
                ) : (
                  c.source
                )}
                {c.licence !== c.source && ` · ${c.licence}`}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
};
