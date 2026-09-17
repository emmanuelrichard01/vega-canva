import React, { useRef, useState, useSyncExternalStore } from 'react';
import { provider } from '../../engine/document';
import { Avatar } from '../ui/Avatar';
import { ProfileEditor } from '../ProfileEditor';
import { useRoomState } from '../../hooks/useSync';
import { followMode } from '../../engine/presence/followMode';
import type { ActivityKind } from '../../engine/presence/collaborators';
import { Menu } from '../menu/Menu';
import type { MenuEntry } from '../menu/menuModel';

/** Every activity gets a word here: you came to this row to ask what someone is doing. */
const ROSTER_ACTIVITY: Record<ActivityKind, string> = {
  typing: 'Typing',
  recording: 'Recording',
  drawing: 'Drawing',
  moving: 'Moving objects',
};

/** How many faces the bar shows before the rest fold into a count. */
const SHOWN = 4;

interface Person {
  clientId: number;
  name: string;
  color: string;
  isMe: boolean;
  activity: ActivityKind | null;
}

/**
 * The people on this board.
 *
 * ## What changed
 *
 * - **The count opens the roster.** Past four people the rest were a grey "+3"
 *   that did nothing: the fifth person on a board could not be followed, or
 *   even named, from anywhere in the header. It opens the whole list now — the
 *   same menu as everywhere else, one row per person, what they are doing, and
 *   a check beside whoever you are following. Miro and FigJam both do this.
 * - **You come first, and the rest are ordered by who is doing something.**
 *   Your own disc is where you look to check how you appear; the people who are
 *   active are the ones worth following.
 * - **Activity shows without hovering.** A small live dot on a face that is
 *   typing, drawing, moving or recording — the question "is anyone else working
 *   right now" answered at a glance, not by pointing at four discs in turn.
 * - **The hover card is styled, not inline.** It was eleven inline properties,
 *   which is how it came to ignore the theme's own card.
 */
export const CollaborationLayer: React.FC = () => {
  const { awarenessUsers } = useRoomState();
  const [hovered, setHovered] = useState<number | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [roster, setRoster] = useState<DOMRect | null>(null);
  const justClosed = useRef(0);
  const followingId = useSyncExternalStore(followMode.subscribe, followMode.getSnapshot, followMode.getSnapshot);

  const me = provider.awareness?.clientID;
  const people: Person[] = Array.from(awarenessUsers.entries())
    .filter(([, u]) => u?.user)
    .map(([clientId, u]) => ({
      clientId,
      name: String(u.user.name ?? 'Guest'),
      color: String(u.user.color ?? '#6B7280'),
      isMe: clientId === me,
      activity: ((u as { activity?: ActivityKind | null }).activity ?? null) as ActivityKind | null,
    }))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe) || Number(Boolean(b.activity)) - Number(Boolean(a.activity)) || a.name.localeCompare(b.name));

  if (people.length === 0) return null;

  const act = (person: Person) => {
    if (person.isMe) setEditingProfile(true);
    else followMode.toggle(person.clientId);
  };

  const shown = people.slice(0, SHOWN);
  const rest = people.length - shown.length;

  const rosterEntries = (): MenuEntry[] => [
    { kind: 'heading', id: 'h', label: `${people.length} ${people.length === 1 ? 'person' : 'people'} on this board` },
    ...people.map<MenuEntry>((p) => ({
      kind: 'item',
      id: String(p.clientId),
      label: p.isMe ? `${p.name} (you)` : p.name,
      icon: <Avatar name={p.name} color={p.color} size={20} />,
      detail: p.isMe
        ? 'Edit your profile'
        : `${p.activity ? ROSTER_ACTIVITY[p.activity] : 'Viewing'} · ${followingId === p.clientId ? 'Following. Select to stop' : 'Select to follow'}`,
      trailing: followingId === p.clientId ? <span className="hdr-roster__following">Following</span> : undefined,
      onSelect: () => act(p),
    })),
  ];

  return (
    <div className="hdr-people" role="group" aria-label="People on this board">
      {shown.map((p, i) => {
        const isFollowed = followingId === p.clientId;
        const status = p.activity ? ROSTER_ACTIVITY[p.activity] : 'Viewing';
        return (
          <div
            key={p.clientId}
            className="hdr-person"
            data-followed={isFollowed || undefined}
            data-active={Boolean(p.activity) || undefined}
            style={{ zIndex: hovered === p.clientId || isFollowed ? 50 : 10 - i, ['--person' as string]: p.color }}
            onMouseEnter={() => setHovered(p.clientId)}
            onMouseLeave={() => setHovered(null)}
            role="button"
            tabIndex={0}
            aria-pressed={p.isMe ? undefined : isFollowed}
            aria-label={p.isMe ? 'Edit your profile' : `${isFollowed ? 'Stop following' : 'Follow'} ${p.name}. ${status}`}
            onFocus={() => setHovered(p.clientId)}
            onBlur={() => setHovered(null)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              act(p);
            }}
            onClick={() => act(p)}
          >
            <Avatar name={p.name} color={p.color} size={28} />
            {p.activity && <span className="hdr-person__live" aria-hidden />}

            {hovered === p.clientId && (
              <div className="hdr-card" role="tooltip">
                <div className="hdr-card__head">
                  <span className="hdr-card__dot" aria-hidden />
                  <span className="hdr-card__name">
                    {p.name}
                    {p.isMe && <span className="hdr-card__you"> · you</span>}
                  </span>
                </div>
                <div className="hdr-card__status">{status}</div>
                <div className="hdr-card__hint">
                  {p.isMe ? 'Click to edit your profile' : isFollowed ? 'Click to stop following' : 'Click to follow their view'}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {rest > 0 && (
        <button
          type="button"
          className="hdr-person hdr-person--more"
          aria-haspopup="menu"
          aria-expanded={Boolean(roster)}
          aria-label={`${rest} more. Show everyone on this board`}
          data-tooltip={roster ? undefined : 'Everyone on this board'}
          data-tooltip-pos="bottom"
          onClick={(e) => {
            if (performance.now() - justClosed.current < 300) return;
            setRoster(e.currentTarget.getBoundingClientRect());
          }}
        >
          +{rest}
        </button>
      )}

      {roster && (
        <Menu
          label="Everyone on this board"
          entries={rosterEntries()}
          anchor={{ kind: 'rect', rect: roster, prefer: 'below', align: 'end' }}
          onClose={() => {
            justClosed.current = performance.now();
            setRoster(null);
          }}
        />
      )}

      <ProfileEditor open={editingProfile} onClose={() => setEditingProfile(false)} />
    </div>
  );
};
