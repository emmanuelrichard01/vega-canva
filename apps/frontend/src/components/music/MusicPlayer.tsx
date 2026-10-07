import React, { Suspense, lazy, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Headphones } from 'lucide-react';
import { useFloatingPanel } from '../ui/useFloatingPanel';
import { PORTAL_SURFACE_ATTR } from '../ui/portalSurface';
import { VinylGlyph } from './Turntable';
import { stationById } from '../../engine/music/stations';
import { useMusic } from '../../engine/music/musicStore';
import { useLibrary } from '../../engine/music/library/libraryStore';
import { useSpotify } from '../../engine/music/spotify/spotifyStore';
import './music.css';

const MusicPanel = lazy(() => import('./MusicPanel'));

/**
 * The header's music control. Idle it is a headphones button; while anything
 * plays it becomes a small turning record. The player itself loads the first
 * time it is opened.
 */
export const MusicButton: React.FC<{ className?: string }> = ({ className }) => {
  const music = useMusic();
  const library = useLibrary();
  const spotify = useSpotify();
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const spot = useFloatingPanel({ open, trigger, panel, onClose: close });

  const playing =
    music.source === 'stations'
      ? music.status === 'playing'
      : music.source === 'library'
        ? library.playing
        : spotify.playing;
  const what =
    music.source === 'stations'
      ? stationById(music.station).name
      : music.source === 'library'
        ? library.current?.title ?? 'Library'
        : spotify.current?.name ?? 'Spotify';
  const label = playing ? `Music: ${what}, playing` : 'Music';

  return (
    <>
      <button
        ref={setTrigger}
        type="button"
        className={`btn-icon music-trigger${playing ? ' is-playing' : ''}${className ? ` ${className}` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        data-tooltip={label}
        data-tooltip-pos="bottom"
        onClick={() => setOpen((v) => !v)}
      >
        {playing ? <VinylGlyph spinning /> : <Headphones size={16} strokeWidth={1.75} aria-hidden="true" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={setPanel}
            role="dialog"
            aria-label="Music"
            className="music-panel"
            {...{ [PORTAL_SURFACE_ATTR]: 'music' }}
            data-side={spot?.side}
            style={{ left: spot?.x ?? 0, top: spot?.y ?? 0, maxHeight: spot?.maxHeight, visibility: spot ? 'visible' : 'hidden' }}
          >
            <Suspense fallback={<div className="music-loading" aria-busy="true" aria-label="Loading the player" />}>
              <MusicPanel />
            </Suspense>
          </div>,
          document.body
        )}
    </>
  );
};
