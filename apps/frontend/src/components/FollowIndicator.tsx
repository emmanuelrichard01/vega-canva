import React, { useEffect, useSyncExternalStore } from 'react';
import { followMode } from '../engine/presence/followMode';
import { useCollaborators } from '../engine/presence/useCollaborators';
import { chipColorsFor } from '../engine/cursor/remoteCursor';

/**
 * "You are following someone", and the way out.
 *
 * Follow mode takes control of the camera, which is the single most alarming
 * thing an interface can do without saying so: the canvas moves on its own,
 * and with no explanation the first reading is that the app has broken. So the
 * state is named, attributed, and exits three ways — this button, Escape, or
 * simply panning, which is what everyone tries first.
 *
 * Two surfaces, one for each question:
 *
 * - **The ring** answers "why is my canvas moving" from the corner of the eye.
 *   It is drawn in the leader's raw identity colour, like the remote cursor
 *   arrow and unlike the chip: it sits over arbitrary content rather than over
 *   a theme surface, and it is the thing that ties the state to a person.
 * - **The chip** answers "who, and how do I stop". Its fill goes through
 *   `chipColorsFor` for the same reason the cursor name chips do — half the
 *   palette fails AA with white text and the other half fails with black, and
 *   sign-in lets people choose an arbitrary colour.
 */
export const FollowIndicator: React.FC = () => {
  const followingId = useSyncExternalStore(
    followMode.subscribe,
    followMode.getSnapshot,
    followMode.getSnapshot
  );
  const collaborators = useCollaborators();
  const leader = followingId === null ? null : collaborators.find((c) => c.clientId === followingId);

  // Escape leaves follow mode the way it leaves every other mode in this app.
  // A mode you can only exit by finding the right button is a mode people feel
  // stuck in, and this is the one that moves the canvas underneath them.
  useEffect(() => {
    if (followingId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement?.tagName;
      if (el === 'INPUT' || el === 'TEXTAREA') return;
      followMode.stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [followingId]);

  // `followMode` drops the follow itself when someone leaves, so a missing
  // leader here is the frame between their departure and that landing.
  if (followingId === null || !leader) return null;

  const chip = chipColorsFor(leader.color);

  return (
    <>
      <div className="follow-ring" style={{ borderColor: leader.color }} aria-hidden="true" />

      <div className="follow-chip panel-surface" role="status">
        <span className="follow-chip__who" style={{ background: chip.fill, color: chip.ink }}>
          {leader.initials}
        </span>
        <span className="follow-chip__label">
          Following <strong>{leader.name}</strong>
        </span>
        <button
          type="button"
          className="follow-chip__stop"
          onClick={() => followMode.stop()}
          /* Names the action, not the state. "Following" on a button would
             read as a thing you are about to do. */
          aria-label={`Stop following ${leader.name}`}
        >
          Stop
          <kbd>Esc</kbd>
        </button>
      </div>
    </>
  );
};
