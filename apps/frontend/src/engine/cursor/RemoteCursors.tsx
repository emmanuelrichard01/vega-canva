import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { provider } from '../document';
import { cameraSystem } from '../CameraSystem';
import { chipColorsFor, placeChip, smoothingFactor, type ChipColors } from './remoteCursor';

/**
 * Other people's pointers.
 *
 * This is all that is left of the old cursor system. The local pointer used to
 * be a `rAF`-positioned `<div>` under `cursor: none`; it is now a real CSS
 * cursor (see `toolCursor.ts` and the `[data-cursor-mode]` rules in
 * `index.css`), which is a frame faster and keeps the OS accessibility
 * settings the div threw away.
 *
 * Remote cursors keep custom rendering because there is nothing native to
 * defer to — they are content, not pointers.
 *
 * Two rules hold here:
 *
 * 1. **React mounts and unmounts; `rAF` moves.** Position is written straight
 *    to the DOM. Re-rendering the tree at broadcast rate to move a 20px arrow
 *    is how a presence layer starts costing more than the document does.
 * 2. **This component does not write awareness.** It used to, from a `window`
 *    `mousemove` that fired over every panel and disagreed with `Canvas` about
 *    mouse-leave; `presenceManager` is now the only writer.
 */

/** The identity fields React needs. Position deliberately is not one of them. */
interface RemoteIdentity {
  clientId: number;
  name: string;
  color: string;
  activity: string | null;
  away: boolean;
}

/** Live interpolation state for one remote pointer. */
interface Track {
  x: number;
  y: number;
  /** False until the first broadcast arrives, so a cursor never flies in from 0,0. */
  seeded: boolean;
  /** Last opacity/scale written, so the loop only touches the DOM on change. */
  shown: boolean | null;
}

const OVERLAY_Z = 999999999;

/** Where the arrow's tip sits inside its 20px box — the scaling origin. */
const HOTSPOT = { x: 2, y: 1 };

const ENTER_MS = 220;
/** Exits are faster than entrances; a lingering ghost reads as lag. */
const EXIT_MS = 130;
/** Confident deceleration. Not a bounce — a bounce on a pointer reads as broken. */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

const RemotePointer = ({ colors }: { colors: ChipColors }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    // Offset and blur, so the arrow separates from content of any colour —
    // including content the same colour as the arrow.
    style={{ display: 'block', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.28))' }}
    aria-hidden="true"
  >
    <path
      d="M5.65376 21.2183L2.36881 2.50576C2.17937 1.42629 3.32766 0.584311 4.30138 1.08742L21.2335 9.83549C22.2599 10.366 22.1802 11.8315 21.1011 12.2612L13.8821 15.1363C13.5604 15.2644 13.3082 15.5146 13.1782 15.8361L10.2828 23.0132C9.84996 24.0864 8.38466 24.1565 7.86311 23.1239L5.65376 21.2183Z"
      fill={colors.outline}
      stroke="#FFFFFF"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

export const RemoteCursors: React.FC = () => {
  const [remotes, setRemotes] = useState<RemoteIdentity[]>([]);

  const tracks = useRef(new Map<number, Track>());
  const chipSizes = useRef(new Map<number, { width: number; height: number }>());
  const rootRef = useRef<HTMLDivElement>(null);

  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Awareness fires on every cursor broadcast from every peer. Only identity
  // changes need React, so compare a signature and let the rAF loop below read
  // positions straight from awareness.
  useEffect(() => {
    let signature = '';

    const read = () => {
      const states = provider.awareness?.getStates();
      if (!states) return;
      const mine = provider.awareness?.clientID;

      const next: RemoteIdentity[] = [];
      states.forEach((state: any, clientId: number) => {
        if (clientId === mine || !state.user) return;
        next.push({
          clientId,
          name: state.user.name || 'Guest',
          color: state.user.color || '#6B7280',
          activity: state.activity ?? null,
          away: state.status === 'away',
        });
      });
      next.sort((a, b) => a.clientId - b.clientId);

      const nextSignature = next
        .map((r) => `${r.clientId}:${r.name}:${r.color}:${r.activity}:${r.away}`)
        .join('|');
      if (nextSignature === signature) return;
      signature = nextSignature;

      // Drop interpolation state for anyone who left, so a client reconnecting
      // on the same id does not inherit a stale position and streak across.
      const live = new Set(next.map((r) => r.clientId));
      for (const id of tracks.current.keys()) if (!live.has(id)) tracks.current.delete(id);
      for (const id of chipSizes.current.keys()) if (!live.has(id)) chipSizes.current.delete(id);

      setRemotes(next);
    };

    provider.awareness?.on('change', read);
    read();
    return () => provider.awareness?.off('change', read);
  }, []);

  // Measure each chip once per content change. `placeChip` needs a real width
  // to know whether the chip would run off the edge, and guessing from
  // character count is wrong for exactly the long names that need flipping.
  const labelSignature = remotes.map((r) => `${r.clientId}:${r.name}:${r.activity}:${r.away}`).join('|');
  useEffect(() => {
    for (const remote of remotes) {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-chip="${remote.clientId}"]`);
      if (el) chipSizes.current.set(remote.clientId, { width: el.offsetWidth, height: el.offsetHeight });
    }
  }, [labelSignature, remotes]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);

      const dt = now - last;
      last = now;
      const root = rootRef.current;
      const states = provider.awareness?.getStates();
      if (!root || !states) return;

      // Snapping is the honest reading of "reduce motion" here: interpolation
      // exists to smooth network jitter, and smoothing *is* the motion.
      const alpha = reducedMotion ? 1 : smoothingFactor(dt);
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const mine = provider.awareness?.clientID;

      states.forEach((state: any, clientId: number) => {
        if (clientId === mine || !state.user) return;
        const node = root.querySelector<HTMLElement>(`[data-cursor="${clientId}"]`);
        if (!node) return;

        const body = node.firstElementChild as HTMLElement | null;
        const chip = node.querySelector<HTMLElement>(`[data-chip="${clientId}"]`);
        if (!body) return;

        // No cursor field means they are off the canvas — over a panel, or
        // gone from the window. Fade out, but hold position so returning to
        // roughly where they left does not look like a teleport.
        const present = !!state.cursor;
        if (present) {
          const targetX = state.cursor.x * cameraSystem.zoom + cameraSystem.x;
          const targetY = state.cursor.y * cameraSystem.zoom + cameraSystem.y;

          let track = tracks.current.get(clientId);
          if (!track || !track.seeded) {
            track = { x: targetX, y: targetY, seeded: true, shown: track?.shown ?? null };
            tracks.current.set(clientId, track);
          } else {
            track.x += (targetX - track.x) * alpha;
            track.y += (targetY - track.y) * alpha;
          }

          node.style.transform = `translate3d(${track.x}px, ${track.y}px, 0)`;

          if (chip) {
            const size = chipSizes.current.get(clientId);
            if (size) {
              const placement = placeChip({ x: track.x, y: track.y }, size, viewport);
              chip.style.transform = `translate3d(${placement.left - track.x}px, ${placement.top - track.y}px, 0)`;
            }
          }
        }

        const track = tracks.current.get(clientId);
        // Re-seed on the way out, so someone who leaves at one edge and comes
        // back at the other fades in where they are rather than sliding there.
        if (track && !present) track.seeded = false;

        if (track && track.shown !== present) {
          track.shown = present;
          body.style.transitionDuration = reducedMotion ? '0ms' : `${present ? ENTER_MS : EXIT_MS}ms`;
          body.style.opacity = present ? (state.status === 'away' ? '0.45' : '1') : '0';
          body.style.transform = present ? 'scale(1)' : 'scale(0.82)';
        } else if (track && present) {
          // Away can flip without presence changing.
          const wanted = state.status === 'away' ? '0.45' : '1';
          if (body.style.opacity !== wanted) body.style.opacity = wanted;
        }
      });
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion]);

  const palettes = useMemo(() => {
    const map = new Map<number, ChipColors>();
    for (const r of remotes) map.set(r.clientId, chipColorsFor(r.color));
    return map;
  }, [remotes]);

  return ReactDOM.createPortal(
    <div
      ref={rootRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: OVERLAY_Z,
      }}
    >
      {remotes.map((remote) => {
        const colors = palettes.get(remote.clientId)!;
        const note = remote.away ? 'Away' : remote.activity;
        return (
          <div
            key={remote.clientId}
            data-cursor={remote.clientId}
            style={{ position: 'absolute', top: 0, left: 0, willChange: 'transform' }}
          >
            {/* Position lives on the parent and appearance on this child, so
                the per-frame translate is never fighting a transition. */}
            <div
              style={{
                opacity: 0,
                transform: 'scale(0.82)',
                transformOrigin: `${HOTSPOT.x}px ${HOTSPOT.y}px`,
                transitionProperty: 'opacity, transform',
                transitionTimingFunction: EASE,
                transitionDuration: `${ENTER_MS}ms`,
                willChange: 'opacity, transform',
              }}
            >
              <RemotePointer colors={colors} />

              <div
                data-chip={remote.clientId}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  display: 'flex',
                  alignItems: 'center',
                  // Tight. The name and the state are one label, and 8px on
                  // either side of the hairline reads as two.
                  gap: 'var(--space-1)',
                  maxWidth: '220px',
                  padding: '3px var(--space-2)',
                  // A tight radius, not a pill: this labels a precise point.
                  borderRadius: 'var(--radius-md)',
                  background: colors.fill,
                  color: colors.ink,
                  // Edged in the raw identity colour, which both separates the
                  // chip from a pale canvas and puts the true colour back when
                  // the fill had to move to stay readable.
                  boxShadow: `0 0 0 1px ${colors.outline}, var(--shadow-sm)`,
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  lineHeight: 1.4,
                  letterSpacing: '0.005em',
                  whiteSpace: 'nowrap',
                  willChange: 'transform',
                }}
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    // A long name must not push the state out of the chip.
                    maxWidth: note ? '120px' : '200px',
                  }}
                >
                  {remote.name}
                </span>
                {note && (
                  <>
                    {/* One chip with a hairline, not two stacked badges. The
                        name and what they are doing are one fact. */}
                    <span
                      style={{ width: 1, alignSelf: 'stretch', background: 'currentColor', opacity: 0.28 }}
                    />
                    <span
                      style={{
                        fontWeight: 'var(--weight-medium)',
                        // Tinted down from the ink rather than set to gray, so
                        // the chip stays one material.
                        opacity: 0.72,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '90px',
                      }}
                    >
                      {note}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>,
    document.body
  );
};
