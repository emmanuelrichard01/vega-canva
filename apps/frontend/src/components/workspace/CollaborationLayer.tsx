import React, { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { provider } from '../../engine/document';
import { AvatarStack } from '../ui/Avatar';
import { ProfileEditor } from '../ProfileEditor';
import { useRoomState } from '../../hooks/useSync';
import { followMode } from '../../engine/presence/followMode';
import { useCollaborators } from '../../engine/presence/useCollaborators';
import { PresenceRoster } from '../../engine/presence/PresenceRoster';
import { rosterOrder, rosterState } from '../../engine/presence/roster';

/** How many faces the header shows before the rest fold into a count. */
const SHOWN = 3;

/**
 * The people on this board, as one small stack of faces.
 *
 * Three faces at 20px, each ringed in its owner's colour, and a count for the
 * rest, so a room of fifty is the same width as a room of two. Your own comes
 * first, then whoever is doing something, so the faces that show are the ones
 * worth following. The stack is one button that opens the roster, where each
 * person can be followed or visited and you can bring everyone to your view.
 *
 * Who is here and what they are doing come from the collaborator store, which
 * publishes only when the roster changes, so a pointer moving across the board
 * never re-renders this.
 */
export const CollaborationLayer: React.FC = () => {
  const { awarenessUsers } = useRoomState();
  const others = useCollaborators();
  const [editingProfile, setEditingProfile] = useState(false);
  const [roster, setRoster] = useState<{ keyboard: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const followingId = useSyncExternalStore(followMode.subscribe, followMode.getSnapshot, followMode.getSnapshot);

  const myId = provider.awareness?.clientID;
  const mine = myId !== undefined ? awarenessUsers.get(myId)?.user : undefined;
  const me = mine ? { name: String(mine.name ?? 'You'), color: String(mine.color ?? '#6B7280') } : null;

  const faces = useMemo(
    () => [
      ...(me ? [{ key: 'me', name: me.name, color: me.color, you: true, title: `${me.name} (you)` }] : []),
      ...rosterOrder(others).map((p) => ({
        key: p.clientId,
        name: p.name,
        color: p.color,
        title: [p.name, rosterState(p).word, p.listening].filter(Boolean).join(' · '),
      })),
    ],
    // `me` is rebuilt each render from stable strings; compare by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [others, me?.name, me?.color]
  );

  if (faces.length === 0) return null;

  const following = others.find((p) => p.clientId === followingId);
  const summary = `${faces.length} ${faces.length === 1 ? 'person' : 'people'} on this board${following ? `, following ${following.name}` : ''}. Open the list`;

  return (
    <div className="hdr-people">
      <button
        ref={trigger}
        type="button"
        className="hdr-presence"
        data-following={following ? true : undefined}
        aria-haspopup="dialog"
        aria-expanded={Boolean(roster)}
        aria-label={summary}
        onClick={(e) => {
          if (roster) {
            setRoster(null);
            return;
          }
          setRoster({ keyboard: e.detail === 0 });
        }}
      >
        <AvatarStack people={faces} size={20} ring max={SHOWN} />
      </button>

      <PresenceRoster
        anchor={trigger}
        open={Boolean(roster)}
        keyboard={roster?.keyboard ?? false}
        me={me}
        onEditProfile={() => setEditingProfile(true)}
        onClose={() => setRoster(null)}
      />

      <ProfileEditor open={editingProfile} onClose={() => setEditingProfile(false)} />
    </div>
  );
};
