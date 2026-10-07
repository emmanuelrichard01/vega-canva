import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { cameraSystem } from '../CameraSystem';
import { collaboratorStore } from '../presence/collaboratorStore';
import { useCollaborators, useKeyedRef, usePresenceFrame } from '../presence/useCollaborators';
import { ACTIVITY_LABEL } from '../presence/collaborators';
import { CursorChatComposer } from '../presence/CursorChatComposer';
import { chipColorsFor, placeChip, type ChipColors } from './remoteCursor';
import { ARROW_D, ARROW_SCALE, ARROW_TIP, CURSOR_SIZE } from './cursorVisual';
import { ToolBadge } from './cursorArt';
import { useStore } from '../../hooks/useStore';
import { RULER_SIZE } from '../../components/canvas/Rulers';
import { canvasChromeContrast, useContrast } from '../ui/contrast';
import '../presence/presence.css';

/**
 * Other people's pointers.
 *
 * Your own pointer is the OS cursor (see `LocalCursor`); these are the same
 * arrow in someone else's colour, wearing the badge of the tool in their hand.
 * They are content, not chrome, which is why they survive presentation mode.
 *
 * Three rules hold here:
 *
 * 1. **React mounts and unmounts; the frame loop moves.** Position and the
 *    tag's state (shown, compact, idle) are written straight to the DOM from
 *    the shared presence frame, so nothing re-renders at broadcast rate.
 * 2. **React owns visibility.** Whether someone is shown never waits on a
 *    frame: in a throttled tab frames may not come, and the room must not look
 *    empty.
 * 3. **Nothing here writes awareness.** `presenceManager` is the only writer.
 *
 * Motion (prediction plus a critically damped spring) lives in
 * `collaboratorStore`, in world space; see `presence/cursorMotion.ts`.
 */

const HOTSPOT = ARROW_TIP;

/**
 * How long a name stays up after its owner stops moving. Long enough to follow
 * someone's marker across the board and still find their name on arrival.
 */
const LABEL_HOLD_MS = 6000;
/** Still for this long, the tag shows its quiet second line (what they listen to). */
const IDLE_AFTER_MS = 1400;
/** Screen speeds (px/s) at which the tag shrinks to a dot, and grows back. */
const COMPACT_ABOVE = 1100;
const EXPAND_BELOW = 320;

/** World distance that counts as "they moved", not float noise in a broadcast. */
const MOVE_EPSILON = 0.5;

const Arrow = ({ colors, tool, weight }: { colors: ChipColors; tool: string | null; weight: number }) => (
  <svg
    className="rc__arrow"
    width={CURSOR_SIZE}
    height={CURSOR_SIZE}
    viewBox={`0 0 ${CURSOR_SIZE} ${CURSOR_SIZE}`}
    fill="none"
    aria-hidden="true"
  >
    <g transform={`scale(${ARROW_SCALE})`}>
      <path d={ARROW_D} fill={colors.outline} stroke="#FFFFFF" strokeWidth={1.7 * weight} strokeLinejoin="round" />
    </g>
    {/* The same glyph table the local pointer reads, so a tool looks the same
        in your hand and in theirs. */}
    <ToolBadge tool={tool ?? undefined} fill={colors.fill} ink={colors.ink} />
  </svg>
);

interface Registration {
  root: HTMLElement | null;
  chip: HTMLElement | null;
  size: { width: number; height: number };
  lastX: number;
  lastY: number;
  movedAt: number;
  compact: boolean;
}

export const RemoteCursors: React.FC = () => {
  const remotes = useCollaborators();
  const nodes = useRef(new Map<number, Registration>());
  const { enhanced } = useContrast();
  const weight = canvasChromeContrast(enhanced).strokeScale;

  // Registrations go through `ensure` because React runs ref callbacks
  // child-first: the chip's ref fires before its parent's.
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
        compact: false,
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

  /** Tags that stay up regardless of stillness, because they carry a state. */
  const persistent = useMemo(() => {
    const set = new Set<number>();
    for (const person of remotes) if (person.activity || person.away || person.chat) set.add(person.clientId);
    return set;
  }, [remotes]);

  const labelSignature = remotes
    .map(
      (r) =>
        `${r.clientId}:${r.name}:${r.activity ?? ''}:${r.away ? 1 : 0}:${r.listening ?? ''}:${r.chat?.text ?? ''}:${r.chat?.open ? 1 : 0}`
    )
    .join('|');

  const paint = useCallback(
    (now: number, snap = false) => {
      const zoom = cameraSystem.zoom;
      const camX = cameraSystem.x;
      const camY = cameraSystem.y;
      const rulerInset = useStore.getState().showRulers ? RULER_SIZE : 0;
      const viewport = { width: window.innerWidth, height: window.innerHeight };

      for (const person of collaboratorStore.live()) {
        const entry = nodes.current.get(person.clientId);
        if (!entry?.root) continue;

        const world = person.smoothed ?? person.cursor;
        if (!world) continue;

        const screenX = world.x * zoom + camX + rulerInset;
        const screenY = world.y * zoom + camY + rulerInset;
        entry.root.style.transform = `translate3d(${screenX - HOTSPOT.x}px, ${screenY - HOTSPOT.y}px, 0)`;

        // Idle reads the broadcast position, not the smoothed one, which is
        // still settling for a moment after someone stops.
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

        // Someone fully off screen is the edge markers' job: a tag clamped
        // into the corner with no arrow would label nothing.
        const onScreen =
          screenX >= -40 && screenX <= viewport.width + 40 && screenY >= -40 && screenY <= viewport.height + 40;
        if (!onScreen) {
          chip.dataset.shown = '0';
          continue;
        }

        if (entry.size.width > 0) {
          const placed = placeChip({ x: screenX, y: screenY }, entry.size, viewport);
          chip.style.transform = `translate3d(${placed.left - screenX + HOTSPOT.x}px, ${
            placed.top - screenY + HOTSPOT.y
          }px, 0)`;
        }

        const holds = persistent.has(person.clientId);
        const shown = holds || now - entry.movedAt < LABEL_HOLD_MS;
        const idle = now - entry.movedAt > IDLE_AFTER_MS;

        // Hysteresis, so a pointer near the threshold does not flicker.
        const speed = collaboratorStore.speedOf(person.clientId);
        if (holds) entry.compact = false;
        else if (!entry.compact && speed > COMPACT_ABOVE) entry.compact = true;
        else if (entry.compact && speed < EXPAND_BELOW) entry.compact = false;

        const set = (key: string, value: string) => {
          if (chip.dataset[key] !== value) chip.dataset[key] = value;
        };
        set('shown', shown ? '1' : '0');
        set('idle', idle ? '1' : '0');
        set('compact', entry.compact ? '1' : '0');
        if (snap) chip.style.transitionDuration = '0ms';
        else if (chip.style.transitionDuration === '0ms') chip.style.transitionDuration = '';
      }
    },
    [persistent]
  );

  // Measure the tags and place everyone before paint, so a pointer that has
  // just mounted is already where its owner is on its first visible frame.
  useLayoutEffect(() => {
    for (const [, entry] of nodes.current) {
      if (entry.chip) entry.size = { width: entry.chip.offsetWidth, height: entry.chip.offsetHeight };
    }
    paint(performance.now(), true);
  }, [labelSignature, remotes, paint]);

  usePresenceFrame(() => paint(performance.now()));

  return ReactDOM.createPortal(
    <>
      <div className="rc-layer" aria-hidden="true">
        {remotes.map((person) => {
          const colors = palettes.get(person.clientId)!;
          const activity = person.activity ? ACTIVITY_LABEL[person.activity] : null;
          const note = person.away ? 'Away' : activity;
          const typing = person.activity === 'typing';
          const chat = person.chat;
          const visible = !!person.cursor;

          return (
            <div
              key={person.clientId}
              ref={rootRef(person.clientId)}
              className="rc"
              style={
                {
                  '--who': colors.outline,
                  '--who-fill': colors.fill,
                  '--who-ink': colors.ink,
                } as React.CSSProperties
              }
            >
              {/* Position on the parent, appearance on this child, so a per-frame
                  translate never fights an enter or exit transition. */}
              <div className="rc__body" data-visible={visible ? '1' : '0'} data-away={person.away ? '1' : '0'}>
                <Arrow colors={colors} tool={person.tool} weight={weight} />

                {person.reaction?.emoji && (
                  <div key={person.reaction.timestamp} className="rc__reaction">
                    {person.reaction.emoji}
                  </div>
                )}

                <div
                  ref={chipRef(person.clientId)}
                  className="rc__chip"
                  data-note={note ? '1' : '0'}
                  data-chat={chat ? '1' : '0'}
                  data-shown="1"
                >
                  <div className="rc__row">
                    <span className="rc__name">{person.name}</span>
                    {note && !chat && (
                      <>
                        <span className="rc__rule" />
                        <span className="rc__note">
                          {note}
                          {typing && (
                            <span className="rc__dots">
                              <i />
                              <i />
                              <i />
                            </span>
                          )}
                        </span>
                      </>
                    )}
                  </div>
                  {chat && (
                    <div className="rc__said">
                      {chat.text}
                      {chat.open && <span className="rc__caret" />}
                    </div>
                  )}
                  {!chat && person.listening && <div className="rc__listening">{person.listening}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <CursorChatComposer />
    </>,
    document.body
  );
};
