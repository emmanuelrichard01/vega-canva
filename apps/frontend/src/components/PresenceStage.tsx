import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Radio, X } from 'lucide-react';
import { followMode } from '../engine/presence/followMode';
import { presenceManager } from '../engine/presence/PresenceManager';
import { useCollaborators } from '../engine/presence/useCollaborators';
import { activeSpotlight, describeAudience, followersOf } from '../engine/presence/spotlight';
import { chipColorsFor } from '../engine/cursor/remoteCursor';
import { provider } from '../engine/document';

/**
 * The other half of presence: what the room is doing *about you*.
 *
 * Everything else in this directory answers "where is everyone" — cursors,
 * edge arrows, the radar, the avatar row. All of it points outward. This is
 * the return path, and without it a board is a room where you can see every
 * face but nobody can see yours:
 *
 * - **The audience.** `followMode` has always been able to lock your camera to
 *   someone, and that someone was never told. They narrate to a board while
 *   two people watch in silence, or pan away from the very thing being
 *   looked at. FigJam and Miro both show this; it is the difference between
 *   following someone and watching a recording of them.
 * - **The invitation.** Its inverse — a way to say *look at this* that is not
 *   "top left, near the blue frame, no, the other blue frame". One tap for the
 *   person offering, one tap for anyone who wants to come.
 *
 * ## Why an offer and not a summons
 *
 * Miro's "Bring everyone to me" moves other people's cameras outright, and
 * that is coherent there because a board has an owner and a meeting has a
 * floor. Here the link *is* the permission: everyone in the room holds exactly
 * the same authority, so no one person's click has any business seizing four
 * other screens mid-sentence. The offer costs one tap to take, lapses on its
 * own, and — because `followMode` exits on any gesture — is escapable by
 * simply panning, which is what everyone tries first anyway.
 */
export const PresenceStage: React.FC = () => {
  const collaborators = useCollaborators();
  const followingId = useSyncExternalStore(followMode.subscribe, followMode.getSnapshot, followMode.getSnapshot);
  const me = provider.awareness?.clientID;

  const presenting = useSyncExternalStore(
    presenceManager.subscribeSpotlight,
    presenceManager.isSpotlighting,
    presenceManager.isSpotlighting
  );
  const [dismissed, setDismissed] = useState<number | null>(null);

  const followers = followersOf(collaborators, me);
  const invite = activeSpotlight(collaborators, Date.now(), followingId);
  const showInvite = invite && invite.spotlightAt !== dismissed ? invite : null;

  // An offer with nobody left to hear it is not an offer. Someone who raises a
  // spotlight and is still "showing" after the last person has gone is being
  // told something untrue about their own board.
  useEffect(() => {
    if (presenting && collaborators.length === 0) presenceManager.setSpotlight(false);
  }, [presenting, collaborators.length]);

  return (
    <>
      {/*
        * Your audience.
        *
        * Shown only when there *is* one, or while you are asking for one. The
        * temptation is to park a permanent "Show everyone" button here, and
        * that is how a canvas fills up with furniture: a control that is
        * useful once a session does not earn a floating chip for the rest of
        * it. The action lives in the people menu in the header, beside the
        * faces it concerns; this surface is reserved for the thing you could
        * not otherwise find out.
        */}
      {(followers.length > 0 || presenting) && (
        <div className="stage-chip panel-surface" role="status" data-live={followers.length > 0 || undefined}>
          {followers.length > 0 && (
            <span className="stage-chip__faces" aria-hidden>
              {followers.slice(0, 3).map((person) => {
                const chip = chipColorsFor(person.color);
                return (
                  <span key={person.clientId} className="stage-chip__face" style={{ background: chip.fill, color: chip.ink }}>
                    {person.initials}
                  </span>
                );
              })}
            </span>
          )}

          <span className="stage-chip__label" title={followers.length > 1 ? describeAudience(followers) : undefined}>
            {followers.length === 0 ? (
              <>Showing your view — <span className="stage-chip__quiet">nobody has come yet</span></>
            ) : followers.length === 1 ? (
              <><strong>{followers[0].name}</strong> is following you</>
            ) : (
              <><strong>{followers.length} people</strong> are following you</>
            )}
          </span>

          {presenting && (
            <button
              type="button"
              className="stage-chip__present"
              onClick={() => presenceManager.setSpotlight(false)}
              aria-label="Stop offering your view to the board"
            >
              <Radio size={13} aria-hidden />
              Stop
            </button>
          )}
        </div>
      )}

      {/*
        * Somebody is showing something.
        *
        * Deliberately not a toast in the corner: a toast is for something that
        * has already happened and needs no answer, and this is a question. It
        * sits where the follow chip sits, in the leader's own colour, so that
        * accepting it and the state it produces are visibly the same thing.
        */}
      {showInvite && (
        <div className="stage-invite panel-surface" role="status" style={{ ['--person' as string]: showInvite.color }}>
          <span className="stage-invite__pulse" aria-hidden />
          <span className="stage-invite__label">
            <strong>{showInvite.name}</strong> is showing something
          </span>
          <button type="button" className="stage-invite__go" onClick={() => followMode.start(showInvite.clientId)}>
            Take a look
          </button>
          <button
            type="button"
            className="stage-invite__no"
            aria-label={`Dismiss. Stay where you are`}
            onClick={() => setDismissed(showInvite.spotlightAt)}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
    </>
  );
};
