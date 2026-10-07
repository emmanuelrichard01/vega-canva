import React, { Suspense, lazy, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPanel } from '../ui/useFloatingPanel';
import { PORTAL_SURFACE_ATTR } from '../ui/portalSurface';
import { VinylGlyph } from './VinylGlyph';
import { useMiniMode, usePlayingSignal } from '../../engine/music/playingSignal';
import './trigger.css';

const MusicPanel = lazy(() => import('./MusicPanel'));

/**
 * The record beside your avatar: always there, still when idle, turning at
 * 33⅓ rpm with a quiet ring while music plays. Its tooltip says what is
 * playing, and in the compact player the title sits beside it. It imports only the playing-state signal; the player, its engine
 * and Spotify load the first time it is opened.
 */
export const MusicButton: React.FC<{ className?: string }> = ({ className }) => {
  const { playing, line } = usePlayingSignal();
  const mini = useMiniMode();
  const showLine = mini && playing && line !== null;
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const spot = useFloatingPanel({ open, trigger, panel, onClose: close });

  // The name never changes; what is playing is announced separately and shown in the tooltip.
  const tooltip = playing && line ? `Playing ${line}` : 'Music';

  return (
    <>
      <button
        ref={setTrigger}
        type="button"
        className={`btn-icon music-trigger${playing ? ' is-playing' : ''}${showLine ? ' music-trigger--line' : ''}${className ? ` ${className}` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={playing}
        aria-label="Music"
        data-tooltip={open ? undefined : tooltip}
        data-tooltip-pos="bottom"
        onClick={() => setOpen((v) => !v)}
      >
        <VinylGlyph spinning={playing} size={18} />
        {showLine && <span className="music-trigger__line">{line}</span>}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {playing && line ? `Playing ${line}` : ''}
      </span>
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
