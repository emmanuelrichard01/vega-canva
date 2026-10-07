import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cameraSystem } from '../engine/CameraSystem';
import { useCollaborators, usePresenceFrame } from '../engine/presence/useCollaborators';
import { PING_MS, onLocalPing, placePing, stepPings, type LivePing } from '../engine/presence/ping';
import { chipColorsFor } from '../engine/cursor/remoteCursor';
import { provider } from '../engine/document';
import { useRoomState } from '../hooks/useSync';
import '../engine/presence/presence.css';

/** The local sender is not in the collaborator list, so it plays under this id. */
const SELF = -1;

interface Shown extends LivePing {
  name: string;
  color: string;
}

/**
 * "Look here", drawn.
 *
 * A ping is a pair of rings that expand from a point on the board and then
 * fade, with the sender's name on a tag. Off screen it is pinned to the edge
 * with an arrow, so it still says which way to look.
 *
 * React decides which pings exist (a handful of times a minute at most); the
 * frame loop decides where they are, because the camera can move under a ping
 * while it plays.
 */
export const PingLayer: React.FC = () => {
  const people = useCollaborators();
  const { awarenessUsers } = useRoomState();
  const [shown, setShown] = useState<Shown[]>([]);
  const seen = useRef(new Map<number, number>());
  const playing = useRef<LivePing[]>([]);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const sweep = useRef(0);

  const myId = provider.awareness?.clientID;
  const mine = myId !== undefined ? awarenessUsers.get(myId)?.user : undefined;
  const myName = String(mine?.name ?? 'You');
  const myColor = String(mine?.color ?? '#6B7280');

  const publish = useCallback(
    (next: LivePing[]) => {
      playing.current = next;
      const byId = new Map(people.map((p) => [p.clientId, p]));
      setShown(
        next.map((p) => {
          const who = byId.get(p.from);
          return {
            ...p,
            name: p.from === SELF ? myName : who?.name ?? 'Someone',
            color: p.from === SELF ? myColor : who?.color ?? '#6B7280',
          };
        })
      );
      window.clearTimeout(sweep.current);
      if (next.length > 0) {
        sweep.current = window.setTimeout(() => publish(stepPings(playing.current, seen.current, people, performance.now())), PING_MS + 40);
      }
    },
    [people, myName, myColor]
  );

  useEffect(() => {
    const next = stepPings(playing.current, seen.current, people, performance.now());
    if (next.length !== playing.current.length || next.some((p, i) => p !== playing.current[i])) publish(next);
  }, [people, publish]);

  useEffect(
    () =>
      onLocalPing((point) => {
        const at = Date.now();
        publish([...playing.current, { from: SELF, at, point, startedAt: performance.now() }]);
      }),
    [publish]
  );

  useEffect(() => () => window.clearTimeout(sweep.current), []);

  usePresenceFrame(() => {
    const w = cameraSystem.width;
    const h = cameraSystem.height;
    for (const ping of playing.current) {
      const node = nodes.current.get(`${ping.from}:${ping.at}`);
      if (!node) continue;
      const screen = { x: ping.point.x * cameraSystem.zoom + cameraSystem.x, y: ping.point.y * cameraSystem.zoom + cameraSystem.y };
      const placed = placePing(screen, w, h);
      node.style.transform = `translate3d(${placed.x}px, ${placed.y}px, 0)`;
      node.dataset.edge = placed.inside ? '' : '1';
      node.dataset.flip = placed.x > w / 2 ? 'l' : '';
      node.style.setProperty('--ping-angle', `${placed.angle}deg`);
    }
  }, shown.length > 0);

  if (shown.length === 0) return null;
  const latest = shown[shown.length - 1];

  return (
    <>
      <span className="sr-only" role="status">
        {latest.from === SELF ? 'You pinged a spot on the board' : `${latest.name} pinged a spot on the board`}
      </span>
      <div className="ping-layer" aria-hidden="true">
      {shown.map((p) => {
        const chip = chipColorsFor(p.color);
        const key = `${p.from}:${p.at}`;
        return (
          <div
            key={key}
            className="ping"
            ref={(el) => {
              if (el) nodes.current.set(key, el);
              else nodes.current.delete(key);
            }}
            style={{ ['--who' as string]: p.color, ['--who-fill' as string]: chip.fill, ['--who-ink' as string]: chip.ink }}
          >
            <span className="ping__ring" />
            <span className="ping__ring ping__ring--late" />
            <span className="ping__dot" />
            <span className="ping__arrow" />
            <span className="ping__tag">{p.name}</span>
          </div>
        );
      })}
      </div>
    </>
  );
};
