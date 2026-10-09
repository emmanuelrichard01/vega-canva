import React, { Suspense, lazy, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useFloatingPanel } from '../ui/useFloatingPanel';
import { PORTAL_SURFACE_ATTR } from '../ui/portalSurface';
import { VinylGlyph } from './VinylGlyph';
import { useMiniMode, usePlayingSignal } from '../../engine/music/playingSignal';
import { usePhone } from '../workspace/usePhone';
import './trigger.css';

const loadPanel = () => import('./MusicPanel');
const MusicPanel = lazy(loadPanel);

/**
 * Intent to open the player: fetch its code, the manifest and a connection to
 * the music host while the pointer is still on its way to the click, so the
 * panel opens drawn and the first station starts without a cold round trip.
 */
let warmed = false;
function warmMusic() {
  if (warmed) return;
  warmed = true;
  void loadPanel().catch(() => { warmed = false; });
  void import('../../engine/music/library/libraryStore').then((m) => m.warmLibrary()).catch(() => undefined);
}

/**
 * The record beside your avatar: always there, still when idle, turning at
 * 33⅓ rpm with a quiet ring while music plays. Its tooltip says what is
 * playing, and in the compact player the title sits beside it. It imports only the playing-state signal; the player, its engine
 * and Spotify load the first time it is opened.
 */
export const MusicButton: React.FC<{ className?: string }> = ({ className }) => {
  const { playing, line, tint } = usePlayingSignal();
  const mini = useMiniMode();
  const showLine = mini && playing && line !== null;
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const phone = usePhone();
  // On a phone the player is a full-height sheet with its own Close: a press
  // outside it is a finger on the board mid-gesture, not a request to leave.
  const close = useCallback(
    (reason?: 'outside' | 'escape') => {
      if (phone && reason === 'outside') return;
      setOpen(false);
    },
    [phone]
  );
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
        onPointerEnter={warmMusic}
        onFocus={warmMusic}
        aria-pressed={playing}
        aria-label="Music"
        data-tooltip={open ? undefined : tooltip}
        data-tooltip-pos="bottom"
        onClick={() => setOpen((v) => !v)}
      >
        <VinylGlyph spinning={playing} size={18} arm tint={tint} />
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
            data-sheet={phone ? '' : undefined}
            style={{ left: spot?.x ?? 0, top: spot?.y ?? 0, maxHeight: spot?.maxHeight, visibility: spot ? 'visible' : 'hidden' }}
          >
            {phone && (
              <div className="music-panel__head">
                <span className="music-panel__title">Music</span>
                <button
                  type="button"
                  className="music-panel__close"
                  aria-label="Close music"
                  onClick={() => {
                    setOpen(false);
                    trigger?.focus({ preventScroll: true });
                  }}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
            )}
            <Suspense fallback={<div className="music-loading" aria-busy="true" aria-label="Loading the player" />}>
              <MusicPanel />
            </Suspense>
          </div>,
          document.body
        )}
    </>
  );
};
