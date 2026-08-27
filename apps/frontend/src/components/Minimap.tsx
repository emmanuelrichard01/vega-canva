import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Radar as RadarIcon, Minus, Plus, Maximize2, ChevronDown, ScanEye } from 'lucide-react';
import { RadarEngine } from '../engine/presence/RadarEngine';
import { useCollaborators } from '../engine/presence/useCollaborators';
import { ACTIVITY_LABEL } from '../engine/presence/collaborators';
import { followMode } from '../engine/presence/followMode';
import { viewportCenter } from '../engine/presence/PresenceTypes';
import { useStore } from '../hooks/useStore';
import { cameraSystem } from '../engine/CameraSystem';
import { engineEvents } from '../engine/EventBus';

/**
 * The Radar — the whole board at a glance, with everyone on it.
 *
 * The shell only. Everything that draws or reacts to a pointer is in
 * `RadarEngine`; this owns the panel, the collapsed state and the zoom row.
 *
 * Two decisions worth keeping:
 *
 * - **Collapsed, it still shows who is here.** Putting the radar away used to
 *   cost you the only ambient answer to "is anyone else in this room?", which
 *   made collapsing it feel like leaving.
 * - **The zoom control lives here.** Until now the app had no visible zoom
 *   indicator anywhere: the only ways to change zoom were the wheel, a pinch,
 *   and a command-palette entry, and the only way to know what zoom you were
 *   at was to guess. This is the surface that is already about "where am I".
 */

const COLLAPSED_KEY = 'vega_radar_collapsed';

/**
 * Ownership of the collapsed state moved up to `Room`.
 *
 * The radar was a permanent 260x214 block — always-on chrome for a surface you
 * glance at every few minutes — and the left panel had to reserve its height
 * whether or not it was showing. Room now decides, because the panel above it
 * has to lay out against the answer; when `onCollapse` is supplied this
 * component never renders its own collapsed state, so there is exactly one
 * source of truth rather than two that can disagree.
 */
interface MinimapProps {
  onCollapse?: () => void;
}

export const Minimap: React.FC<MinimapProps> = ({ onCollapse }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<RadarEngine | null>(null);

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const collaborators = useCollaborators();
  const darkTheme = useStore((s) => s.darkTheme);
  // Counted, not the map itself: subscribing to `objects` would re-render the
  // radar shell on every drag frame, and the canvas paints from its own loop.
  const objectCount = useStore((s) => Object.keys(s.objects).length);

  // The zoom readout is the one thing here that has to re-render, and it does
  // so at camera rate — so it is rounded to a whole percent first, which turns
  // a stream of continuous pinch deltas into a handful of state updates.
  const [zoomPercent, setZoomPercent] = useState(() => Math.round(cameraSystem.zoom * 100));
  useEffect(() => {
    const sync = () => setZoomPercent((prev) => {
      const next = Math.round(cameraSystem.zoom * 100);
      return next === prev ? prev : next;
    });
    sync();
    engineEvents.on('CameraChanged', sync);
    return () => engineEvents.off('CameraChanged', sync);
  }, []);

  const navigate = useCallback((x: number, y: number, zoom?: number) => {
    window.dispatchEvent(
      new CustomEvent('navigateViewport', { detail: { x, y, zoom: zoom ?? cameraSystem.zoom } })
    );
  }, []);

  useEffect(() => {
    if (collapsed || !canvasRef.current) return;
    const engine = new RadarEngine(canvasRef.current);
    engine.onNavigate = navigate;
    engineRef.current = engine;
    // Debug hatch, in the same spirit as `window.__physics` and
    // `window.objectsMap`. The radar only paints from `requestAnimationFrame`,
    // which never fires in an offscreen automation tab — `__radar.draw()`
    // makes it paint one frame on demand so the drawing can be looked at.
    (window as any).__radar = engine;
    return () => {
      engine.destroy();
      if ((window as any).__radar === engine) (window as any).__radar = null;
      engineRef.current = null;
    };
  }, [collapsed, navigate]);

  // Tokens are resolved once and cached in the engine, so a theme switch has
  // to tell it to look again.
  useEffect(() => {
    engineRef.current?.refreshTheme();
  }, [darkTheme]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* private mode; the panel just forgets between sessions */
    }
  }, [collapsed]);

  const zoomBy = (factor: number) =>
    cameraSystem.zoomBy(factor, cameraSystem.width / 2, cameraSystem.height / 2);

  const resetZoom = () => {
    const centre = cameraSystem.screenToWorld(cameraSystem.width / 2, cameraSystem.height / 2);
    navigate(centre.x, centre.y, 1);
  };

  /**
   * Pan and zoom from the keyboard.
   *
   * A step is a fraction of the viewport rather than a fixed number of world
   * units, so one press moves the same *visible* distance whatever the zoom —
   * at 10% a 100px step would not appear to move at all, and at 400% it would
   * fly off the board.
   */
  const onRadarKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const STEP = 0.25;
    const centre = cameraSystem.screenToWorld(cameraSystem.width / 2, cameraSystem.height / 2);
    const dx = (cameraSystem.width / cameraSystem.zoom) * STEP;
    const dy = (cameraSystem.height / cameraSystem.zoom) * STEP;

    switch (e.key) {
      case 'ArrowLeft': navigate(centre.x - dx, centre.y); break;
      case 'ArrowRight': navigate(centre.x + dx, centre.y); break;
      case 'ArrowUp': navigate(centre.x, centre.y - dy); break;
      case 'ArrowDown': navigate(centre.x, centre.y + dy); break;
      case '+': case '=': zoomBy(1.25); break;
      case '-': case '_': zoomBy(1 / 1.25); break;
      case '0': navigate(centre.x, centre.y, 1); break;
      // The same fit actions the canvas and buttons offer
      case 'Home': case '!': case '1': engineRef.current?.fitToContent(); break;
      default: return;
    }
    // Only once a key was actually handled — otherwise Tab and Escape would be
    // swallowed and the canvas would become a focus trap.
    e.preventDefault();
  }, [navigate]);

  /**
   * What the radar is, in words.
   *
   * The picture conveys "where is everything, and who else is here", which is
   * unavailable to anyone not looking at it. Rebuilt from the live counts so
   * it stays true rather than describing the room as it was on mount.
   */
  const radarLabel = [
    'Board overview.',
    `${objectCount} ${objectCount === 1 ? 'object' : 'objects'}.`,
    collaborators.length > 0
      ? `${collaborators.length} other ${collaborators.length === 1 ? 'person' : 'people'} here.`
      : 'No one else here.',
    'Arrow keys pan, plus and minus zoom, Shift+1 or Home fits everything.',
  ].join(' ');

  /**
   * Who, if anyone, this client is currently following.
   *
   * Subscribed rather than read once: the follow can end without this panel
   * doing anything — the person leaves, or the camera is moved by hand — and a
   * button stuck on "Following" after that is worse than no button.
   */
  const followingId = useSyncExternalStore(
    followMode.subscribe,
    followMode.getSnapshot,
    followMode.getSnapshot
  );

  const faces = collaborators.slice(0, 3);

  if (collapsed && !onCollapse) {
    return (
      <div className="radar-dock">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="panel-surface radar-toggle"
          aria-label={
            collaborators.length > 0
              ? `Open Radar. ${collaborators.length} other ${
                  collaborators.length === 1 ? 'person' : 'people'
                } in this workspace.`
              : 'Open Radar'
          }
        >
          <RadarIcon size={16} />
          {collaborators.length > 0 ? (
            <span className="radar-faces">
              {faces.map((person) => (
                <span
                  key={person.clientId}
                  className="radar-face"
                  style={{ background: person.color }}
                  title={person.name}
                >
                  {person.initials}
                </span>
              ))}
              {collaborators.length > faces.length && (
                <span
                  className="radar-face"
                  style={{ background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}
                >
                  +{collaborators.length - faces.length}
                </span>
              )}
            </span>
          ) : (
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>Radar</span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="radar-dock">
      <div className="panel-surface radar-panel">
        <div className="radar-head">
          <span className="radar-title">
            <RadarIcon size={13} color="var(--text-primary)" aria-hidden="true" />
            Radar
            {collaborators.length > 0 && (
              <span className="radar-count">
                <span
                  aria-hidden="true"
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: 'var(--status-online)',
                  }}
                />
                {collaborators.length}
              </span>
            )}
          </span>

          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              type="button"
              className="btn-icon"
              style={{ padding: 5 }}
              onClick={() => engineRef.current?.fitToContent()}
              aria-label="Fit everything on screen"
              data-tooltip="Fit to content"
            >
              <Maximize2 size={13} />
            </button>
            <button
              type="button"
              className="btn-icon"
              style={{ padding: 5 }}
              onClick={() => (onCollapse ? onCollapse() : setCollapsed(true))}
              aria-label="Collapse Radar"
            >
              <ChevronDown size={14} />
            </button>
          </span>
        </div>

        {/* The board's spatial navigator, and until now the one control in the
            app that could not be operated without a pointer: it was a bare
            `aria-hidden` canvas with pointer listeners, so panning the board
            from the keyboard was simply not possible.

            `role="application"` is deliberate and is the right role here — it
            tells a screen reader to pass arrow keys through to the widget
            instead of using them to move its own reading cursor, which is
            exactly what a pan control needs. The label says what the keys do,
            because nothing about a canvas can. */}
        <canvas
          ref={canvasRef}
          className="radar-canvas"
          role="application"
          tabIndex={0}
          aria-label={radarLabel}
          onKeyDown={onRadarKeyDown}
        />

        {/* Who is here, and the two things you want to do about it.

            The expanded panel used to show a bare count — "3" — beside the
            title, while the collapsed one showed faces. So opening the radar
            told you *less* about who was in the room than leaving it shut, and
            following someone meant going back to the header avatars, which are
            nowhere near the picture showing you where everyone is.

            Two verbs per person, because they are genuinely different: **jump**
            takes you to them once and leaves you free, **follow** keeps your
            camera tied to theirs until you stop. Conflating them is why a
            single click on a radar dot was never enough. */}
        {collaborators.length > 0 && (
          <div className="radar-people-wrap">
            {/*
              No "you are following X" strip here, though one was written and
              then removed.

              The argument for it was that a latched row scrolls out of view and
              takes the only sign of the mode with it. That argument was wrong:
              `FollowIndicator` already states it at the top of the screen, with
              Stop and Esc, and it is visible whether or not the radar is even
              open. A second copy in here said the same thing twice, four
              inches apart, and would have had to be kept in step with it.

              The row keeps its own latched state, because that answers a
              different question — *which* of these people am I tied to — and
              the banner cannot.
            */}
            <div className="radar-people" role="list" aria-label="People in this workspace">
              {collaborators.map((person) => {
                const isFollowed = followingId === person.clientId;
                const where = person.cursor ?? (person.viewport ? viewportCenter(person.viewport) : null);
                return (
                  <div
                    className={`radar-person ${isFollowed ? 'is-followed' : ''}`}
                    role="listitem"
                    key={person.clientId}
                  >
                    <button
                      type="button"
                      className="radar-person__jump"
                      disabled={!where}
                      onClick={() => where && navigate(where.x, where.y)}
                      data-tooltip={where ? `Jump to ${person.name}` : `${person.name} is not on the board`}
                      aria-label={where ? `Jump to ${person.name}` : `${person.name}, position unknown`}
                    >
                      <span
                        className="radar-person__face"
                        style={{ background: person.color }}
                        data-away={person.away || undefined}
                      >
                        {person.initials}
                      </span>
                      <span className="radar-person__label">
                        <span className="radar-person__name">{person.name}</span>
                        {/* What they are doing, on its own line rather than
                            fighting the name for one. Absent rather than
                            "idle": a column of "idle" is noise that hides the
                            one row carrying a real signal. "Away" is the
                            exception worth saying outright — a faded avatar
                            alone is a difference nobody can name. */}
                        {(person.away || (person.activity && ACTIVITY_LABEL[person.activity])) && (
                          <span className="radar-person__doing">
                            {person.away ? 'Away' : ACTIVITY_LABEL[person.activity!]}
                          </span>
                        )}
                      </span>
                    </button>

                    {/*
                      Revealed on hover, or when it is on.

                      It used to sit on every row wearing a crossed-out eye,
                      which is the glyph this app uses for *hidden* — so a room
                      of four people showed four "hidden" marks and the one row
                      that mattered had to be found among them. A control that
                      is off does not need to announce itself on every row; the
                      row it is *on* does, and that one stays.
                    */}
                    <button
                      type="button"
                      className={`radar-person__follow ${isFollowed ? 'is-on' : ''}`}
                      aria-pressed={isFollowed}
                      onClick={() => followMode.toggle(person.clientId)}
                      data-tooltip={isFollowed ? `Stop following ${person.name}` : `Follow ${person.name}`}
                      aria-label={isFollowed ? `Stop following ${person.name}` : `Follow ${person.name}`}
                    >
                      <ScanEye size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="radar-foot">
          <button
            type="button"
            className="btn-icon"
            style={{ padding: 5 }}
            onClick={() => zoomBy(1 / 1.25)}
            aria-label="Zoom out"
          >
            <Minus size={13} />
          </button>
          <button
            type="button"
            className="radar-zoom"
            onClick={resetZoom}
            aria-label={`Zoom ${zoomPercent} percent. Reset to 100 percent.`}
            data-tooltip="Reset zoom"
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            className="btn-icon"
            style={{ padding: 5 }}
            onClick={() => zoomBy(1.25)}
            aria-label="Zoom in"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
