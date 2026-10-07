import { provider } from './doc';
import { canEditObjects, subscribeRoomRole } from '../model/permissions';

/**
 * Which one client in the room performs automatic writes.
 *
 * Reflows, sweeps and membership repairs react to the document. If every
 * client ran them, each would write the same patch: N copies of every write on
 * the wire and in the update log. Instead the editor with the lowest awareness
 * clientID does it. Clients advertise `canWrite` in awareness, and only one
 * that says `true` can be chosen. That matters beyond wasted work: the server
 * refuses a viewer's or commenter's writes outside the roots their role allows,
 * and because a client's updates are causally chained, one refused update means
 * every later one from that client is refused until it reloads.
 *
 * Elections are local and can briefly disagree while awareness propagates.
 * That is harmless: the writes are idempotent, so the worst case is the same
 * patch written twice.
 */
type AwarenessLike = {
  clientID: number;
  getStates: () => Map<number, Record<string, unknown>>;
  setLocalStateField: (field: string, value: unknown) => void;
};

function awareness(): AwarenessLike | null {
  return (provider as unknown as { awareness?: AwarenessLike | null })?.awareness ?? null;
}

function advertise(): void {
  awareness()?.setLocalStateField('canWrite', canEditObjects());
}

if (typeof window !== 'undefined') {
  advertise();
  subscribeRoomRole(advertise);
}

/** Pure rule, exported for tests. */
export function electedClient(states: Map<number, Record<string, unknown>>): number | null {
  let best: number | null = null;
  states.forEach((state, clientId) => {
    if (state?.canWrite !== true) return;
    if (best === null || clientId < best) best = clientId;
  });
  return best;
}

export function isElectedWriter(): boolean {
  if (!canEditObjects()) return false;
  const a = awareness();
  if (!a) return true;
  const states = a.getStates();
  // Before awareness has published even our own state, we are alone.
  if (!states.has(a.clientID)) return true;
  return electedClient(states) === a.clientID;
}
