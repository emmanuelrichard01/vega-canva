import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { cameraSystem } from '../CameraSystem';
import { collaboratorStore } from '../presence/collaboratorStore';
import { useCollaborators, useKeyedRef, usePresenceFrame } from '../presence/useCollaborators';
import { ACTIVITY_LABEL } from '../presence/collaborators';
import { chipColorsFor, placeChip, type ChipColors } from './remoteCursor';
import { ToolBadge } from './cursorArt';
import { ARROW_D, ARROW_SCALE, ARROW_TIP, CURSOR_SIZE } from './cursorArtData';
import { cursorModeForTool } from './toolCursor';
import { useStore } from '../../hooks/useStore';
import { RULER_SIZE } from '../../components/canvas/Rulers';

/**
 * Other people's pointers.
 *
 * Your own pointer is drawn by `LocalCursor`; these are the same arrow in
 * someone else's colour. They are **content**, not chrome — which is why they
 * survive presentation mode and why they are custom-drawn rather than deferred
 * to anything native.
 *
 * Three rules hold here, each of them a bug that was fixed:
 *
 * 1. **React mounts and unmounts; the frame loop moves.** Position is written
 *    straight to the DOM. Re-rendering the tree at broadcast rate to move a
 *    22px arrow is how a presence layer starts costing more than the document.
 * 2. **React owns visibility.** When the frame loop owned it, a cursor stayed
 *    at `opacity: 0` until the next animation frame — and in a throttled tab
 *    that frame can be a second away or never arrive, so the room looked empty.
 *    The one thing that must never depend on a frame is *whether someone is
 *    there*.
 * 3. **Nothing here writes awareness.** It used to, from a `window` mousemove
 *    that fired over every panel and disagreed with `Canvas` about what
 *    leaving the canvas meant. `presenceManager` is the only writer.
 *
 * Interpolation lives in `collaboratorStore` and runs in **world** space. It
 * used to run here in screen space, which meant panning your own canvas
 * dragged everybody else's pointer along a fifth of a second behind the
 * content it was sitting on.
 */

/**
 * Same box, same scale, same hotspot as your own pointer.
 *
 * Not a coincidence and not worth "optimising" to a smaller arrow: a
 * collaborator's pointer should be the same object as yours, differing only in
 * colour. Sharing the geometry is also what lets it wear the same tool badge.
 */
const HOTSPOT = ARROW_TIP;

const ENTER_MS = 200;
/** Exits are faster than entrances; a lingering ghost reads as lag. */
const EXIT_MS = 120;
/** Confident deceleration. Not a bounce — a bounce on a pointer reads as broken. */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * How long a name stays up after its owner stops moving.
 *
 * Six people in a room is six name tags permanently covering the work. Figma,
 * Miro and every other board of this kind fade the label and keep the arrow,
 * because the arrow is the information and the name is the introduction. A
 * label that says what someone is *doing* is exempt — that is information
 * again, so it stays until they stop doing it.
 *
 * Six seconds, not the two and a half this started at. Two and a half is long
 * enough to read a name you are already looking at, and too short for the case
 * that actually matters: following a marker across the board to find someone,
 * and arriving after their label has already gone.
 */
const LABEL_HOLD_MS = 6000;

/** World distance that counts as "they moved", not float noise in a broadcast. */
const MOVE_EPSILON = 0.5;

/**
 * A collaborator's pointer: your arrow in their colour, badged with the tool
 * in their hand.
 *
 * The badge takes its disc and glyph from `chipColorsFor`, which is the same
 * pair that keeps their name legible — so a bright identity colour gets a dark
 * glyph and a deep one gets a light glyph, without ever moving the arrow away
 * from the colour that identifies them. The white ring is what separates the
 * badge from whatever it happens to be sitting on.
 */
const Arrow = ({
  color,
  colors,
  tool,
}: {
  color: string;
  colors: ChipColors;
  tool: string | null;
}) => (
  <svg
    width={CURSOR_SIZE}
    height={CURSOR_SIZE}
    viewBox={`0 0 ${CURSOR_SIZE} ${CURSOR_SIZE}`}
    fill="none"
    // Offset *and* blur, so the arrow separates from content of any colour —
    // including content in exactly this colour.
    style={{
      display: 'block',
      overflow: 'visible',
      filter: 'drop-shadow(0 1.5px 3px rgba(0,0,0,0.38))',
    }}
    aria-hidden="true"
  >
    <g transform={`scale(${ARROW_SCALE})`}>
      <path d={ARROW_D} fill={color} stroke="#FFFFFF" strokeWidth={1.7} strokeLinejoin="round" />
    </g>
    <ToolBadge
      mode={cursorModeForTool(tool ?? undefined)}
      tool={tool ?? undefined}
      fill={colors.fill}
      ink={colors.ink}
      ring="#FFFFFF"
    />
  </svg>
);

interface Registration {
  root: HTMLElement | null;
  chip: HTMLElement | null;
  /** Measured once per label change; `placeChip` needs a real width to flip. */
  size: { width: number; height: number };
  /** Last broadcast position and when it last actually changed. */
  lastX: number;
  lastY: number;
  movedAt: number;
}

export const RemoteCursors: React.FC = () => {
  const remotes = useCollaborators();
  const nodes = useRef(new Map<number, Registration>());

  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Registered by ref rather than looked up with `querySelector` every frame:
  // one DOM query per person per frame is a real cost at 60Hz, and it silently
  // stops working the moment a wrapper element is added.
  //
  // Every registration goes through `ensure`, because **React runs ref
  // callbacks child-first**. Having the chip's callback look up an entry the
  // parent's callback had not created yet meant the chip was never registered,
  // so its offset was never written and it sat directly on top of the arrow —
  // hiding the pointer behind its own name tag. That is exactly the class of
  // bug that only rendering it finds.
  const ensure = useCallback((clientId: number): Registration => {
    let entry = nodes.current.get(clientId);
    if (!entry) {
      entry = {
        root: null,
        chip: null,
        size: { width: 0, height: 0 },
        lastX: NaN,
        lastY: NaN,
        movedAt: 0,
      };
      nodes.current.set(clientId, entry);
    }
    return entry;
  }, []);

  const registerRoot = useCallback(
    (clientId: number, el: HTMLElement | null) => {
      if (!el) {
        nodes.current.delete(clientId);
        return;
      }
      ensure(clientId).root = el;
    },
    [ensure]
  );

  const registerChip = useCallback(
    (clientId: number, el: HTMLElement | null) => {
      ensure(clientId).chip = el;
    },
    [ensure]
  );

  const rootRef = useKeyedRef(registerRoot);
  const chipRef = useKeyedRef(registerChip);

  const palettes = useMemo(() => {
    const map = new Map<number, ChipColors>();
    for (const person of remotes) map.set(person.clientId, chipColorsFor(person.color));
    return map;
  }, [remotes]);

  /** Names that stay up regardless of stillness, because they carry a state. */
  const persistentLabels = useMemo(() => {
    const set = new Set<number>();
    for (const person of remotes) if (person.activity || person.away) set.add(person.clientId);
    return set;
  }, [remotes]);

  const labelSignature = remotes
    .map((r) => `${r.clientId}:${r.name}:${r.activity ?? ''}:${r.away ? 1 : 0}`)
    .join('|');

  const paint = useCallback(
    (now: number, snap = false) => {
      const zoom = cameraSystem.zoom;
      const camX = cameraSystem.x;
      const camY = cameraSystem.y;
      const showRulers = useStore.getState().showRulers;
      const rulerInset = showRulers ? RULER_SIZE : 0;
      const viewport = { width: window.innerWidth, height: window.innerHeight };

      for (const person of collaboratorStore.live()) {
        const entry = nodes.current.get(person.clientId);
        if (!entry?.root) continue;

        const world = person.smoothed ?? person.cursor;
        if (!world) continue;

        const screenX = world.x * zoom + camX + rulerInset;
        const screenY = world.y * zoom + camY + rulerInset;
        entry.root.style.transform = `translate3d(${screenX - HOTSPOT.x}px, ${
          screenY - HOTSPOT.y
        }px, 0)`;

        // Idle detection reads the *broadcast* position, not the smoothed one:
        // smoothing is still converging for a moment after someone stops, and
        // treating that as movement holds every label up permanently.
        const target = person.cursor;
        if (target) {
          const moved =
            !Number.isFinite(entry.lastX) ||
            Math.abs(target.x - entry.lastX) > MOVE_EPSILON ||
            Math.abs(target.y - entry.lastY) > MOVE_EPSILON;
          if (moved) {
            entry.lastX = target.x;
            entry.lastY = target.y;
            entry.movedAt = now;
          }
        }

        const chip = entry.chip;
        if (!chip) continue;

        // `placeChip` clamps a chip back inside the viewport so a name near an
        // edge is never lost. For a pointer that is *fully* off screen that
        // rescue becomes a lie: the arrow is clipped away by the overlay and
        // the label alone slides into the corner, so the room appears to
        // contain a floating name that belongs to nothing. Someone who is off
        // screen is the edge markers' job.
        const onScreen =
          screenX >= -40 && screenX <= viewport.width + 40 &&
          screenY >= -40 && screenY <= viewport.height + 40;
        if (!onScreen) {
          chip.style.opacity = '0';
          continue;
        }

        if (entry.size.width > 0) {
          const placed = placeChip({ x: screenX, y: screenY }, entry.size, viewport);
          chip.style.transform = `translate3d(${placed.left - screenX + HOTSPOT.x}px, ${
            placed.top - screenY + HOTSPOT.y
          }px, 0)`;
        }

        // Defaults to shown. If frames never come — a throttled tab — every
        // name simply stays up, which is the harmless failure. The opposite
        // default would hide the room.
        const holding = persistentLabels.has(person.clientId) || now - entry.movedAt < LABEL_HOLD_MS;
        chip.style.opacity = holding ? '1' : '0';
        if (snap) chip.style.transitionDuration = '0ms';
        else if (chip.style.transitionDuration === '0ms') chip.style.transitionDuration = '';
      }
    },
    [persistentLabels]
  );

  /**
   * Measure the chips and place everyone immediately.
   *
   * Before paint, so a cursor that has just mounted is already at its owner's
   * position on the first frame it is visible, rather than appearing at the
   * origin and sliding across the screen to where they actually are.
   */
  useLayoutEffect(() => {
    for (const [, entry] of nodes.current) {
      if (entry.chip) {
        entry.size = { width: entry.chip.offsetWidth, height: entry.chip.offsetHeight };
      }
    }
    paint(performance.now(), true);
  }, [labelSignature, remotes, paint]);

  usePresenceFrame(() => paint(performance.now()));

  return ReactDOM.createPortal(
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        // Above every panel. A pointer that renders behind the UI is a pointer
        // that disappears exactly when someone reaches for a control.
        zIndex: 999999999,
      }}
    >
      {remotes.map((person) => {
        const colors = palettes.get(person.clientId)!;
        // Only the activities you cannot see for yourself get words. See
        // `ACTIVITY_LABEL` for why drawing and moving are not among them.
        const note = person.away ? 'Away' : person.activity ? ACTIVITY_LABEL[person.activity] : null;
        const visible = !!person.cursor;

        return (
          <div
            key={person.clientId}
            ref={rootRef(person.clientId)}
            style={{ position: 'absolute', top: 0, left: 0, willChange: 'transform' }}
          >
            {/* Position lives on the parent and appearance on this child, so a
                per-frame translate never fights an enter/exit transition. */}
            <div
              style={{
                opacity: visible ? (person.away ? 0.5 : 1) : 0,
                transform: visible ? 'scale(1)' : 'scale(0.8)',
                transformOrigin: `${HOTSPOT.x}px ${HOTSPOT.y}px`,
                transitionProperty: 'opacity, transform',
                transitionTimingFunction: EASE,
                transitionDuration: reducedMotion ? '0ms' : `${visible ? ENTER_MS : EXIT_MS}ms`,
                willChange: 'opacity, transform',
              }}
            >
              <Arrow color={colors.outline} colors={colors} tool={person.tool} />

              <div
                ref={chipRef(person.clientId)}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  display: 'flex',
                  alignItems: 'center',
                  // Tight. The name and the state are one label; 8px on either
                  // side of the hairline reads as two separate badges.
                  gap: 'var(--space-1)',
                  maxWidth: 220,
                  padding: '3px var(--space-2)',
                  // A tight radius, not a pill: this labels a precise point.
                  borderRadius: 'var(--radius-md)',
                  background: colors.fill,
                  color: colors.ink,
                  // Edged in the raw identity colour, which puts the true
                  // colour back when the fill had to move to stay readable —
                  // and, more importantly, is what separates the chip from the
                  // canvas at all. `chipColorsFor` solves text-on-chip
                  // contrast, so a deep colour is deepened further: Violet
                  // becomes near-black, which on a dark board is a label you
                  // cannot see the edges of. The raw colour is by definition
                  // not near-black, so the ring carries that job. 1.5px,
                  // because at 1px it reads as an artefact rather than a
                  // border.
                  boxShadow: `0 0 0 1.5px ${colors.outline}, 0 2px 8px rgba(0,0,0,0.35)`,
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  lineHeight: 1.4,
                  letterSpacing: '0.005em',
                  whiteSpace: 'nowrap',
                  transition: reducedMotion
                    ? 'none'
                    : `opacity 260ms ${EASE}`,
                  willChange: 'transform, opacity',
                }}
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    // A long name must not push the state out of the chip.
                    maxWidth: note ? 120 : 200,
                  }}
                >
                  {person.name}
                </span>
                {note && (
                  <>
                    {/* One chip with a hairline, not two stacked badges. Who
                        they are and what they are doing is one fact. */}
                    <span
                      style={{
                        width: 1,
                        alignSelf: 'stretch',
                        background: 'currentColor',
                        opacity: 0.28,
                      }}
                    />
                    <span
                      style={{
                        fontWeight: 'var(--weight-medium)',
                        // Tinted down from the ink rather than set to gray, so
                        // the chip stays one material.
                        opacity: 0.72,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 90,
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
