import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom';
import { X } from 'lucide-react';
import { useCollaborators } from '../../engine/presence/useCollaborators';
import { followMode } from '../../engine/presence/followMode';
import { presenceManager } from '../../engine/presence/PresenceManager';
import { Emoji } from '../emoji/Emoji';
import './slides.css';

/**
 * The room answering back while someone presents.
 *
 * Followers get a small bar of reactions under the slides; whatever they send
 * floats up the right-hand side of the presenter's screen and fades, so the
 * presenter can feel the room without the room talking over them. Reactions
 * travel on presence, which every collaborator already sends; nothing is
 * written to the board.
 */

/** Tools a presenting collaborator wears, so followers know it is a show. */
export const PRESENTING_TOOLS = new Set(['present', 'laser']);

export const REACTIONS = ['👏', '❤️', '😂', '🎉', '🤯', '👍'] as const;

const FLOAT_MS = 2600;

/** Reactions rising on the presenter's screen. */
export const ReactionStream: React.FC = () => {
  const people = useCollaborators();
  const seen = useRef(new Map<number, number>());
  const [floats, setFloats] = useState<Array<{ key: string; emoji: string; lane: number; name: string }>>([]);
  const timers = useRef(new Set<number>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  useEffect(() => {
    const fresh: Array<{ key: string; emoji: string; lane: number; name: string }> = [];
    for (const person of people) {
      const r = person.reaction;
      if (!r || seen.current.get(person.clientId) === r.timestamp) continue;
      seen.current.set(person.clientId, r.timestamp);
      // A reaction sent before the show began is not a reaction to it.
      if (Date.now() - r.timestamp > 4000) continue;
      fresh.push({ key: `${person.clientId}:${r.timestamp}`, emoji: r.emoji, lane: Math.random(), name: person.name });
    }
    if (fresh.length === 0) return;
    setFloats((prev) => [...prev, ...fresh].slice(-24));
    const keys = new Set(fresh.map((f) => f.key));
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      setFloats((prev) => prev.filter((f) => !keys.has(f.key)));
    }, FLOAT_MS);
    timers.current.add(t);
  }, [people]);

  if (floats.length === 0) return null;
  return (
    <div className="fp-reactions" aria-live="polite">
      {floats.map((f) => (
        <span key={f.key} className="fp-reaction" style={{ ['--lane' as string]: f.lane }}>
          <Emoji native={f.emoji} size={36} />
          <span className="sr-only">
            {f.name} reacted {f.emoji}
          </span>
        </span>
      ))}
    </div>
  );
};

/**
 * The bar a follower sees while following someone who is presenting: send a
 * reaction, or step out of the show.
 */
export const AudienceBar: React.FC = () => {
  const people = useCollaborators();
  const following = useSyncExternalStore(followMode.subscribe, followMode.getSnapshot, followMode.getSnapshot);
  const leader = following === null ? undefined : people.find((p) => p.clientId === following);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (!sent) return;
    const t = window.setTimeout(() => setSent(null), 900);
    return () => window.clearTimeout(t);
  }, [sent]);

  if (!leader || !leader.tool || !PRESENTING_TOOLS.has(leader.tool)) return null;

  return ReactDOM.createPortal(
    <div className="audience-bar" role="toolbar" aria-label={`${leader.name} is presenting`}>
      <span className="audience-bar__who">
        <span className="audience-bar__dot" style={{ background: leader.color }} aria-hidden="true" />
        <strong>{leader.name}</strong> is presenting
      </span>
      <span className="audience-bar__rule" aria-hidden="true" />
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="audience-bar__react"
          data-sent={sent === emoji || undefined}
          aria-label={`React ${emoji}`}
          onClick={() => {
            presenceManager.broadcastReaction(emoji);
            setSent(emoji);
          }}
        >
          <Emoji native={emoji} size={20} />
        </button>
      ))}
      <span className="audience-bar__rule" aria-hidden="true" />
      <button type="button" className="audience-bar__leave" onClick={() => followMode.stop('stopped')}>
        <X size={14} aria-hidden="true" />
        Stop following
      </button>
    </div>,
    document.body
  );
};
