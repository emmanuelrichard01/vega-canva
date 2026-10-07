import React, { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Crosshair, Eye, Radio, Target, UserRound } from 'lucide-react';
import { Popover } from '../../components/ui/Popover';
import { Avatar } from '../../components/ui/Avatar';
import { tooltipProps } from '../../components/ui/Tooltip';
import { cameraSystem } from '../CameraSystem';
import { prefersReducedMotion } from '../cameraMotion';
import { followMode } from './followMode';
import { presenceManager } from './PresenceManager';
import { useCollaborators } from './useCollaborators';
import { inMyView, poseToReach, rosterOrder, rosterState, type MyView } from './roster';
import './presence.css';

interface Props {
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Opened from the keyboard: put focus on the first row. */
  keyboard: boolean;
  me: { name: string; color: string } | null;
  onEditProfile: () => void;
}

const myView = (): MyView => ({
  x: cameraSystem.x,
  y: cameraSystem.y,
  zoom: cameraSystem.zoom,
  width: cameraSystem.width,
  height: cameraSystem.height,
});

/**
 * Who is on the board, what they are doing, and the two things you do about it:
 * follow them, or go and look.
 *
 * Follow is one press on a row. "Go to" is a one-off glide to where they are
 * working and leaves your camera yours. Both are real buttons, so each is
 * reachable by Tab and named for the person it acts on.
 */
export const PresenceRoster: React.FC<Props> = ({ anchor, open, onClose, keyboard, me, onEditProfile }) => {
  const people = useCollaborators();
  const followingId = useSyncExternalStore(followMode.subscribe, followMode.getSnapshot, followMode.getSnapshot);
  const presenting = useSyncExternalStore(
    presenceManager.subscribeSpotlight,
    presenceManager.isSpotlighting,
    presenceManager.isSpotlighting
  );
  const listRef = useRef<HTMLDivElement>(null);

  // Whether each person is on your screen is read when the list opens and when
  // the roster changes, never on a timer: panning while it is open does not
  // reshuffle the words under the cursor.
  const view = useMemo(() => (open ? myView() : null), [open, people]);
  const ordered = useMemo(() => rosterOrder(people), [people]);

  useEffect(() => {
    if (!open || !keyboard) return;
    const id = window.setTimeout(() => listRef.current?.querySelector<HTMLElement>('button')?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open, keyboard]);

  const total = people.length + (me ? 1 : 0);

  const goTo = (clientId: number) => {
    const person = people.find((p) => p.clientId === clientId);
    if (!person?.viewport) return;
    // A glide is a gesture of your own, so it ends any follow you had.
    followMode.stop();
    const pose = poseToReach(person.viewport, myView());
    cameraSystem.animateTo(pose.x, pose.y, pose.zoom, { duration: prefersReducedMotion() ? 0 : 320 });
  };

  const pingHere = () => {
    const centre = cameraSystem.screenToWorld(cameraSystem.width / 2, cameraSystem.height / 2);
    presenceManager.ping(centre.x, centre.y);
    onClose();
  };

  return (
    <Popover anchor={anchor} open={open} onClose={onClose} label="Everyone on this board" align="end" className="pr">
      <div className="pr__head">
        <span className="pr__title">
          {total} {total === 1 ? 'person' : 'people'} on this board
        </span>
      </div>

      <div className="pr__list" ref={listRef}>
        {me && (
          <div className="pr__row" data-me>
            <Avatar name={me.name} color={me.color} size={28} you />
            <span className="pr__who">
              <span className="pr__name">{me.name} (you)</span>
              <span className="pr__doing">Visible to everyone here</span>
            </span>
            <button
              type="button"
              className="pr__act"
              aria-label="Edit your name and colour"
              onClick={() => {
                onClose();
                onEditProfile();
              }}
              {...tooltipProps({ label: 'Edit your profile', side: 'left' })}
            >
              <UserRound size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {ordered.map((p) => {
          const status = rosterState(p);
          const here = view ? inMyView(p.viewport, view) : null;
          const following = followingId === p.clientId;
          const details = [
            status.word,
            p.listening,
            here === false ? 'Off screen' : null,
          ].filter(Boolean);
          return (
            <div className="pr__row" key={p.clientId} data-state={status.state} data-following={following || undefined}>
              <span className="pr__face">
                <Avatar name={p.name} color={p.color} size={28} />
                <span className="pr__dot" aria-hidden="true" />
              </span>
              <span className="pr__who">
                <span className="pr__name">{p.name}</span>
                <span className="pr__doing">{details.join(' · ')}</span>
              </span>
              <button
                type="button"
                className="pr__follow"
                aria-pressed={following}
                aria-label={following ? `Stop following ${p.name}` : `Follow ${p.name}`}
                onClick={() => followMode.toggle(p.clientId)}
              >
                <Eye size={13} aria-hidden="true" />
                {following ? 'Following' : 'Follow'}
              </button>
              <button
                type="button"
                className="pr__act"
                aria-label={p.viewport ? `Go to where ${p.name} is working` : `${p.name} has not shared a view yet`}
                disabled={!p.viewport}
                onClick={() => goTo(p.clientId)}
                {...tooltipProps({ label: p.viewport ? 'Go to them' : 'No view to go to yet', side: 'left' })}
              >
                <Crosshair size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      {total > 1 && (
        <div className="pr__foot">
          <button
            type="button"
            className="pr__item"
            aria-pressed={presenting}
            onClick={() => presenceManager.setSpotlight(!presenting)}
          >
            <Radio size={15} aria-hidden="true" />
            <span className="pr__item-text">
              <span className="pr__item-label">{presenting ? 'Stop presenting' : 'Bring everyone to me'}</span>
              <span className="pr__doing">
                {presenting ? 'They were offered a way to follow you' : 'Asks each person, and they choose whether to come'}
              </span>
            </span>
          </button>
          <button type="button" className="pr__item" onClick={pingHere}>
            <Target size={15} aria-hidden="true" />
            <span className="pr__item-text">
              <span className="pr__item-label">Ping the middle of my screen</span>
              <span className="pr__doing">Or hold Shift and Alt and click anywhere on the board</span>
            </span>
          </button>
        </div>
      )}
    </Popover>
  );
};
