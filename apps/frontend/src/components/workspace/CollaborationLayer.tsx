import React, { useRef, useState, useSyncExternalStore } from 'react';
import { Radio } from 'lucide-react';
import { provider } from '../../engine/document';
import { Avatar, AvatarStack } from '../ui/Avatar';
import { ProfileEditor } from '../ProfileEditor';
import { useRoomState } from '../../hooks/useSync';
import { followMode } from '../../engine/presence/followMode';
import { presenceManager } from '../../engine/presence/PresenceManager';
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

/** How many faces the header shows before the rest fold into a count. */
const SHOWN = 3;

interface Person {
  clientId: number;
  name: string;
  color: string;
  isMe: boolean;
  activity: ActivityKind | null;
  /** What they are listening to, when they share it. See `listeningLine`. */
  listening: string | null;
}

/** What someone is doing, in the words their tooltip and roster row use. */
const doingOf = (p: Person) => (p.activity ? ROSTER_ACTIVITY[p.activity] : 'Viewing');

/** A person's tooltip: name, you, what they are doing and what they are listening to. */
function presenceTitle(p: Pick<Person, 'name' | 'isMe' | 'activity' | 'listening'>): string {
  return [
    p.isMe ? `${p.name} (you)` : p.name,
    p.activity ? ROSTER_ACTIVITY[p.activity] : null,
    p.listening,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The people on this board, as one small stack of faces.
 *
 * Three faces at 20px, each ringed in its owner's colour, and a count for the
 * rest; your own carries the online dot. Each face's tooltip says who, what
 * they are doing and what they are listening to, when they share it. The
 * stack is one button: it opens the roster, one row per person, where you
 * follow someone, show everyone your view, or edit your own profile.
 *
 * You come first, then whoever is doing something, so the faces that show
 * are the ones worth following.
 */
export const CollaborationLayer: React.FC = () => {
  const { awarenessUsers } = useRoomState();
  const [editingProfile, setEditingProfile] = useState(false);
  const [roster, setRoster] = useState<{ rect: DOMRect; keyboard: boolean } | null>(null);
  const justClosed = useRef(0);
  const followingId = useSyncExternalStore(followMode.subscribe, followMode.getSnapshot, followMode.getSnapshot);
  const spotlighting = useSyncExternalStore(
    presenceManager.subscribeSpotlight,
    presenceManager.isSpotlighting,
    presenceManager.isSpotlighting
  );

  const me = provider.awareness?.clientID;
  const people: Person[] = Array.from(awarenessUsers.entries())
    .filter(([, u]) => u?.user)
    .map(([clientId, u]) => {
      const state = u as { activity?: ActivityKind | null; listening?: unknown };
      return {
        clientId,
        name: String(u.user.name ?? 'Guest'),
        color: String(u.user.color ?? '#6B7280'),
        isMe: clientId === me,
        activity: (state.activity ?? null) as ActivityKind | null,
        listening: typeof state.listening === 'string' && state.listening ? state.listening : null,
      };
    })
    .sort((a, b) => Number(b.isMe) - Number(a.isMe) || Number(Boolean(b.activity)) - Number(Boolean(a.activity)) || a.name.localeCompare(b.name));

  if (people.length === 0) return null;

  const act = (person: Person) => {
    if (person.isMe) setEditingProfile(true);
    else followMode.toggle(person.clientId);
  };

  const rosterEntries = (): MenuEntry[] => [
    { kind: 'heading', id: 'h', label: `${people.length} ${people.length === 1 ? 'person' : 'people'} on this board` },
    /*
     * "Look at what I am looking at", from the place you already came to think
     * about the people in the room.
     *
     * It belongs here and not on a floating chip: it is used once or twice in
     * a session, and a canvas that grows a permanent button for every
     * occasional action stops being a canvas. Everyone else gets an offer they
     * can take in one tap — never a camera move they did not ask for. See
     * `PresenceStage`.
     */
    ...(people.length > 1
      ? [
          {
            kind: 'item',
            id: 'spotlight',
            label: spotlighting ? 'Stop showing your view' : 'Show everyone your view',
            icon: <Radio size={15} aria-hidden />,
            detail: spotlighting
              ? 'They were offered a one-tap ride here'
              : 'Offers everyone a one-tap ride to what you are looking at',
            onSelect: () => presenceManager.setSpotlight(!spotlighting),
          } satisfies MenuEntry,
          { kind: 'separator', id: 'sep-spotlight' } satisfies MenuEntry,
        ]
      : []),
    ...people.map<MenuEntry>((p) => ({
      kind: 'item',
      id: String(p.clientId),
      label: p.isMe ? `${p.name} (you)` : p.name,
      icon: <Avatar name={p.name} color={p.color} size={20} />,
      detail: [
        p.isMe ? 'Edit your profile' : doingOf(p),
        p.listening,
        p.isMe ? null : followingId === p.clientId ? 'Following. Select to stop' : 'Select to follow',
      ]
        .filter(Boolean)
        .join(' · '),
      trailing: followingId === p.clientId ? <span className="hdr-roster__following">Following</span> : undefined,
      onSelect: () => act(p),
    })),
  ];

  const following = people.find((p) => p.clientId === followingId);
  const summary = `${people.length} ${people.length === 1 ? 'person' : 'people'} on this board${following ? `, following ${following.name}` : ''}. Show everyone`;

  return (
    <div className="hdr-people">
      <button
        type="button"
        className="hdr-presence"
        data-following={following ? true : undefined}
        aria-haspopup="menu"
        aria-expanded={Boolean(roster)}
        aria-label={summary}
        onClick={(e) => {
          if (performance.now() - justClosed.current < 300) return;
          setRoster({ rect: e.currentTarget.getBoundingClientRect(), keyboard: e.detail === 0 });
        }}
      >
        <AvatarStack
          people={people.map((p) => ({ key: p.clientId, name: p.name, color: p.color, you: p.isMe, title: presenceTitle(p) }))}
          size={20}
          ring
          max={SHOWN}
        />
      </button>

      {roster && (
        <Menu
          label="Everyone on this board"
          entries={rosterEntries()}
          anchor={{ kind: 'rect', rect: roster.rect, prefer: 'below', align: 'end' }}
          focusFirst={roster.keyboard}
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
