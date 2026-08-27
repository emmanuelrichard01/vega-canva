/**
 * The colour that *is* someone, on a board where colour is the only thing that
 * says who.
 *
 * A cursor, a selection ring, an avatar disc, the "editing this" pill in the
 * layer panel and the radar's pings all carry one identity colour and no name.
 * So two people sharing a colour is not a cosmetic collision — it is two people
 * merged into one on every surface at once, and the only way to tell them apart
 * is to hover something.
 */

/**
 * Sixteen hues, spaced so that adjacent ones are told apart at a 12px cursor.
 *
 * Widened from ten. The palette size is a hard ceiling on how many people can
 * be distinct, and ten is well inside the size of a real session — the whole
 * point of a shared board is that a workshop can pile into it. These are the
 * Tailwind 500s, which are readable on both themes and were already the house
 * palette; the six additions fill the gaps rather than shading the existing
 * ten, because two blues at 12 pixels are one blue.
 */
const PALETTE = [
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#F97316', // Orange
  '#10B981', // Green
  '#06B6D4', // Cyan
  '#6366F1', // Indigo
  '#EF4444', // Red
  '#F59E0B', // Amber
  '#14B8A6', // Teal
  '#84CC16', // Lime
  '#D946EF', // Fuchsia
  '#0EA5E9', // Sky
  '#F43F5E', // Rose
  '#A16207', // Bronze
  '#65A30D', // Olive
];

/** How many people can hold distinct colours at once. */
export const PALETTE_SIZE = PALETTE.length;

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * The colour this person prefers, from their id alone.
 *
 * Stable for the life of an identity, which is what makes someone recognisable
 * from one session to the next and is why it stays a hash. It is a *preference*
 * and not an answer: see `resolvePresenceColor`.
 */
export function getColorForUser(userId: string): string {
  if (!userId) return PALETTE[0];
  return PALETTE[hashString(userId) % PALETTE.length];
}

/** One other person's claim on a colour. */
export interface ColorClaim {
  /** Yjs client id — the tie-break, and it must be the same one everywhere. */
  clientId: number;
  color: string;
}

/**
 * The colour to actually use in *this room*, given who else is in it.
 *
 * ## Why the hash was never enough
 *
 * `getColorForUser` maps an id into the palette, so two ids collide at the rate
 * the birthday problem dictates: with ten colours and four people in a room it
 * is worse than a coin toss, and it does not need a big team to happen — it
 * needs four. And the collision is silent. Nothing anywhere checked, because a
 * hash is a function of *one* person and uniqueness is a property of a *group*;
 * there was no code that could see the group.
 *
 * ## How this converges without anyone being in charge
 *
 * Awareness is a CRDT: there is no lock to take and no server to arbitrate, so
 * two people can pick simultaneously and both be right about what they saw. The
 * usual fix — ask a coordinator — does not exist here. So the rule is made
 * **deterministic and ordered** instead, and every participant can run it on
 * their own and reach the same answer:
 *
 *  1. Only peers with a **lower `clientId`** block a colour. That is a strict
 *     total order, so there is no cycle in which two people both step aside for
 *     each other and swap forever. Whoever was there first keeps what they
 *     have; the newcomer moves.
 *  2. The search starts at your preferred colour and walks the palette **from a
 *     rotation of your own id**. Two people displaced at the same moment
 *     therefore try different colours first, so they usually do not collide
 *     again on the way out of a collision.
 *  3. Everyone re-runs it whenever the roster changes, so a room that briefly
 *     disagrees settles as soon as the awareness update lands.
 *
 * Past `PALETTE_SIZE` people, some colour must repeat — that is arithmetic, not
 * a policy. The preferred colour is kept in that case, so the seventeenth
 * arrival is at least stable rather than thrashing.
 *
 * Pure, so the thing that is genuinely hard to observe — several browsers
 * joining at once — is asserted in Node instead of by opening tabs.
 */
export function resolvePresenceColor(
  userId: string,
  myClientId: number,
  peers: readonly ColorClaim[]
): string {
  const preferred = getColorForUser(userId);

  const taken = new Set<string>();
  for (const peer of peers) {
    // Ties go to the earlier client, which is the whole of the convergence
    // argument: a rule that is not a strict order lets two people swap places
    // forever, each politely yielding to the other.
    if (peer.clientId < myClientId && peer.color) taken.add(peer.color);
  }
  if (!taken.has(preferred)) return preferred;

  const start = hashString(userId) % PALETTE.length;
  for (let i = 1; i < PALETTE.length; i += 1) {
    const candidate = PALETTE[(start + i) % PALETTE.length];
    if (!taken.has(candidate)) return candidate;
  }

  // More people than colours. Something has to repeat; keep the one that is at
  // least stable and recognisable rather than picking an arbitrary duplicate.
  return preferred;
}
