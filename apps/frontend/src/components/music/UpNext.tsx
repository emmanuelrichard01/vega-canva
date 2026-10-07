import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { loadUpNext, useSpotify } from '../../engine/music/spotify/spotifyStore';
import { useLibrary } from '../../engine/music/library/libraryStore';
import { categoryLabel } from '../../engine/music/library/manifest';
import { TrackArt } from './TrackArt';

interface Item {
  key: string;
  title: string;
  artist: string;
  image: string | null;
  category: string | null;
}

/** A disclosure with the next few tracks: Spotify's queue, or the station's play order. */
const UpNext: React.FC<{ items: Item[]; onOpen?: () => void; hint?: string }> = ({ items, onOpen, hint }) => {
  const [open, setOpen] = useState(false);
  if (items.length === 0 && !onOpen) return null;
  return (
    <div className="music-next">
      <button
        type="button"
        className="music-next__head"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((v) => !v);
        }}
      >
        <span>Up next</span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <ol className="music-next__list">
          {items.length === 0 && <li className="music-note">{hint ?? 'Nothing queued.'}</li>}
          {items.map((t) => (
            <li key={t.key} className="music-next__item">
              <TrackArt artwork={t.image} category={t.category} size={28} label={t.title} />
              <span className="music-next__text">
                <span className="music-next__title">{t.title}</span>
                <span className="music-next__artist">{t.artist}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export const SpotifyUpNext: React.FC = () => {
  const { upNext } = useSpotify();
  const items = useMemo(() => upNext.slice(0, 5).map((t, i) => ({ key: `${t.uri}-${i}`, title: t.title, artist: t.artist, image: t.image, category: null })), [upNext]);
  return <UpNext items={items} onOpen={() => void loadUpNext()} hint="Spotify has nothing queued." />;
};

export const StationUpNext: React.FC = () => {
  const lib = useLibrary();
  const items = useMemo(() => {
    const q = lib.queue;
    if (!q) return [];
    const byId = new Map(lib.tracks.map((t) => [t.id, t]));
    const ids = q.order.slice(q.index + 1, q.index + 4);
    return ids
      .map((id) => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => ({ key: t.id, title: t.title, artist: `${t.artist} · ${categoryLabel(t.category)}`, image: t.artwork, category: t.category }));
  }, [lib.queue, lib.tracks]);
  return <UpNext items={items} hint="This is the last track of the round." />;
};
