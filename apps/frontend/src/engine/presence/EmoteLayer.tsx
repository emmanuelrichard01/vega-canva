import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cameraSystem } from '../CameraSystem';
import { provider } from '../document';
import { keyBelongsToFocus } from '../interaction/keyTarget';
import { chipColorsFor } from '../cursor/remoteCursor';
import { useCollaborators, usePresenceFrame } from './useCollaborators';
import { presenceManager } from './PresenceManager';
import {
  EMOTES,
  EMOTE_MS,
  announceLocalEmote,
  emoteById,
  emoteIndexAt,
  onLocalEmote,
  stepEmotes,
  type LiveEmote,
} from './emote';
import './presence.css';

/** The key that opens the wheel while it is held. */
export const EMOTE_KEY = 'w';
const SELF = -1;
const RADIUS = 66;

interface Shown extends LiveEmote {
  name: string;
  color: string;
}

/**
 * Emotes: hold W over the board, point at a slice, let go.
 *
 * The wheel is local and instant; only the release is sent. What arrives from
 * other people is played where they threw it, floating up and fading, with the
 * thrower's name so a room of emotes is still a room of people.
 */
export const EmoteLayer: React.FC = () => {
  const people = useCollaborators();
  const [wheel, setWheel] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(-1);
  const [tip, setTip] = useState(false);
  const [shown, setShown] = useState<Shown[]>([]);
  const pointer = useRef({ x: 0, y: 0, overBoard: false });
  const wheelRef = useRef<{ x: number; y: number } | null>(null);
  const activeRef = useRef(-1);
  const playing = useRef<LiveEmote[]>([]);
  const seen = useRef(new Map<number, number>());
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const sweep = useRef(0);

  const publish = useCallback(
    (next: LiveEmote[]) => {
      playing.current = next;
      const byId = new Map(people.map((p) => [p.clientId, p]));
      const me = provider.awareness?.getLocalState()?.user as { name?: string; color?: string } | undefined;
      setShown(
        next.map((e) => {
          const who = byId.get(e.from);
          return {
            ...e,
            name: e.from === SELF ? String(me?.name ?? 'You') : who?.name ?? 'Someone',
            color: e.from === SELF ? String(me?.color ?? '#6B7280') : who?.color ?? '#6B7280',
          };
        })
      );
      window.clearTimeout(sweep.current);
      if (next.length > 0) {
        sweep.current = window.setTimeout(() => publish(stepEmotes(playing.current, seen.current, people, performance.now())), EMOTE_MS + 40);
      }
    },
    [people]
  );

  useEffect(() => {
    const next = stepEmotes(playing.current, seen.current, people, performance.now());
    if (next.length !== playing.current.length || next.some((e, i) => e !== playing.current[i])) publish(next);
  }, [people, publish]);

  useEffect(
    () =>
      onLocalEmote((id, point) => {
        publish([...playing.current, { from: SELF, at: Date.now(), id, point, startedAt: performance.now() }]);
      }),
    [publish]
  );

  useEffect(() => () => window.clearTimeout(sweep.current), []);

  // The palette cannot hold a key for you, so it shows how.
  useEffect(() => {
    let t = 0;
    const show = () => {
      setTip(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setTip(false), 5000);
    };
    window.addEventListener("vega:emote-hint", show);
    return () => {
      window.removeEventListener("vega:emote-hint", show);
      window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const close = (fire: boolean) => {
      const at = wheelRef.current;
      const idx = activeRef.current;
      wheelRef.current = null;
      activeRef.current = -1;
      setWheel(null);
      setActive(-1);
      if (!fire || !at || idx < 0) return;
      const world = cameraSystem.screenToWorld(at.x, at.y);
      if (presenceManager.emote(EMOTES[idx].id, world.x, world.y)) announceLocalEmote(EMOTES[idx].id, world);
    };
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY, overBoard: !!(e.target as Element | null)?.closest?.('.canvas-container') };
      const at = wheelRef.current;
      if (!at) return;
      const idx = emoteIndexAt(e.clientX - at.x, e.clientY - at.y);
      if (idx !== activeRef.current) {
        activeRef.current = idx;
        setActive(idx);
      }
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== EMOTE_KEY || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (wheelRef.current || !pointer.current.overBoard || keyBelongsToFocus(e.key)) return;
      e.preventDefault();
      // Keep the wheel whole on screen near an edge.
      const m = RADIUS + 28;
      const at = {
        x: Math.min(window.innerWidth - m, Math.max(m, pointer.current.x)),
        y: Math.min(window.innerHeight - m, Math.max(m, pointer.current.y)),
      };
      wheelRef.current = at;
      setWheel(at);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === EMOTE_KEY && wheelRef.current) close(true);
      else if (e.key === 'Escape' && wheelRef.current) close(false);
    };
    const onBlur = () => wheelRef.current && close(false);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  usePresenceFrame(() => {
    for (const e of playing.current) {
      const node = nodes.current.get(`${e.from}:${e.at}`);
      if (!node) continue;
      const x = e.point.x * cameraSystem.zoom + cameraSystem.x;
      const y = e.point.y * cameraSystem.zoom + cameraSystem.y;
      node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, shown.length > 0);

  const latest = shown[shown.length - 1];
  const label = active >= 0 ? EMOTES[active].label : 'Move toward an emote, then release';

  return (
    <>
      {latest && (
        <span className="sr-only" role="status">
          {latest.from === SELF ? 'You sent' : `${latest.name} sent`} {emoteById(latest.id)?.label ?? 'an emote'}
        </span>
      )}

      {tip && !wheel && (
        <div className="emote-tip panel-surface" role="status">
          Hold <kbd>W</kbd> over the board, point at an emote, then release.
        </div>
      )}

      {wheel && (
        <div className="emote-wheel" style={{ left: wheel.x, top: wheel.y }} role="group" aria-label="Emotes">
          <span className="emote-wheel__hub" aria-hidden="true" />
          {EMOTES.map((emote, i) => {
            const a = (i / EMOTES.length) * Math.PI * 2;
            return (
              <span
                key={emote.id}
                className="emote-wheel__slice"
                data-active={i === active || undefined}
                style={{ transform: `translate(calc(-50% + ${Math.sin(a) * RADIUS}px), calc(-50% - ${Math.cos(a) * RADIUS}px))` }}
                aria-label={emote.label}
              >
                {emote.glyph}
              </span>
            );
          })}
          <span className="emote-wheel__label">{label}</span>
        </div>
      )}

      <div className="emote-layer" aria-hidden="true">
        {shown.map((e) => {
          const chip = chipColorsFor(e.color);
          const key = `${e.from}:${e.at}`;
          return (
            <div
              key={key}
              className="emote"
              ref={(el) => {
                if (el) nodes.current.set(key, el);
                else nodes.current.delete(key);
              }}
              style={{ ['--who-fill' as string]: chip.fill, ['--who-ink' as string]: chip.ink }}
            >
              <span className="emote__rise">
                <span className="emote__glyph">{emoteById(e.id)?.glyph}</span>
                <span className="emote__tag">{e.name}</span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
};
