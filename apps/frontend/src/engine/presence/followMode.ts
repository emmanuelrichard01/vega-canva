/**
 * Following someone: locking your camera to what they can see.
 *
 * The feature existed in source and could never run. `Room.tsx` held
 * `const [followingClientId] = useState<number | null>(null)` — declared
 * without a setter, so the value was permanently `null` and the correct
 * navigation effect underneath it was unreachable. Meanwhile the avatar row's
 * tooltip said "Click to follow" and clicking performed a single jump, so the
 * one control that named the feature did something else.
 *
 * ## Where this state lives, and why not in the document or in awareness
 *
 * Following is **a way of looking**, exactly like the tag filter: it changes
 * what *you* see and nothing about the board. In the CRDT it would enter
 * history and drag other people's cameras around. It is not persisted either —
 * a session that reopens still attached to someone who left is a canvas that
 * appears frozen.
 *
 * (Broadcasting "N people are following you" back to the leader is a real
 * feature and deliberately not this one. It would ride awareness, through
 * `PresenceManager`, which is the only writer.)
 *
 * ## Why the camera is driven from the frame loop
 *
 * A viewport update does not change the roster, so it never reaches React —
 * `collaboratorStore` mutates positions in place on purpose and only publishes
 * roster changes. Reading the leader's viewport inside the shared frame loop
 * is therefore both the only place it is reliably current and the place the
 * codebase already puts motion: positions go to the DOM and to the camera,
 * never through a component tree at broadcast rate.
 */

import { cameraSystem } from '../CameraSystem';
import { smoothingFactor } from '../cursor/remoteCursor';
import { collaboratorStore } from './collaboratorStore';
import { easePose, followPose, poseWasDisturbed, type CameraPose } from './followCamera';

/** Why a follow ended. Only `manual` and `left` are surfaced to the user. */
export type FollowEndReason = 'stopped' | 'manual' | 'left';

type Listener = () => void;

const listeners = new Set<Listener>();

let followingClientId: number | null = null;
let detachFrame: (() => void) | null = null;
/** The pose the driver last wrote, to tell its own writes from a real gesture. */
let lastWritten: CameraPose | null = null;
let lastEndReason: FollowEndReason | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

/**
 * Follow a little faster than a cursor is smoothed.
 *
 * The leader's viewport arrives at the presence throttle (15Hz), and the whole
 * screen moving is far more noticeable than a 22px arrow moving. Too slow and
 * you are permanently behind what they are talking about; too fast and every
 * one of their small pans is a lurch. This is roughly a tenth of a second to
 * cover half the remaining distance.
 */
const FOLLOW_HALF_LIFE_MS = 90;

function tick(dtMs: number) {
  if (followingClientId === null) return;

  const person = collaboratorStore.find(followingClientId);
  // They closed the tab, or dropped off awareness. Following an absent person
  // is a camera that has silently stopped responding to anything.
  if (!person) {
    stop('left');
    return;
  }

  // No viewport yet — they have just joined, or are on a build that does not
  // publish one. Hold position rather than dropping the follow: this resolves
  // itself on their next camera change, and ending the follow for it would
  // look like a bug at exactly the moment someone arrives.
  if (!person.viewport) return;

  const live: CameraPose = { x: cameraSystem.x, y: cameraSystem.y, zoom: cameraSystem.zoom };

  // Taking the wheel is how you leave follow mode. Detecting it by comparing
  // the camera against what this driver last wrote means no input path has to
  // know follow mode exists — a pan, a pinch, a minimap drag, the zoom row, or
  // a handler written next year all break the follow without being told to.
  if (lastWritten && poseWasDisturbed(live, lastWritten)) {
    stop('manual');
    return;
  }

  const target = followPose(
    person.viewport,
    cameraSystem.width,
    cameraSystem.height,
    cameraSystem.zoomLimits
  );
  if (!target) return;

  const next = easePose(live, target, smoothingFactor(dtMs, FOLLOW_HALF_LIFE_MS));
  cameraSystem.setPose(next.x, next.y, next.zoom);
  // Read back rather than storing `next`: the camera clamps zoom, so the two
  // differ at the ends of the range and the difference would read as a gesture
  // on the very next frame.
  lastWritten = { x: cameraSystem.x, y: cameraSystem.y, zoom: cameraSystem.zoom };
}

function stop(reason: FollowEndReason) {
  if (followingClientId === null) return;
  followingClientId = null;
  lastEndReason = reason;
  lastWritten = null;
  detachFrame?.();
  detachFrame = null;
  emit();
}

export const followMode = {
  getSnapshot: (): number | null => followingClientId,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  isFollowing: (clientId: number) => followingClientId === clientId,

  /**
   * Start following someone.
   *
   * Following yourself is meaningless and following the person you are already
   * following is a no-op rather than a restart, so a second click on the same
   * avatar does not reset the easing.
   */
  start(clientId: number) {
    if (clientId === followingClientId) return;
    followingClientId = clientId;
    lastEndReason = null;
    // Cleared so the first frame cannot mistake the distance between where the
    // camera is now and where it is going for a gesture.
    lastWritten = null;
    detachFrame?.();
    detachFrame = collaboratorStore.onFrame(tick);
    emit();
  },

  stop(reason: FollowEndReason = 'stopped') {
    stop(reason);
  },

  toggle(clientId: number) {
    if (followingClientId === clientId) stop('stopped');
    else followMode.start(clientId);
  },

  /** Why the last follow ended, for the surface that says so. */
  lastReason: (): FollowEndReason | null => lastEndReason,
};
