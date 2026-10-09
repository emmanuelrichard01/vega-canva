/**
 * Dot voting, kept in the document so it survives a reload.
 *
 * The session is one JSON value; each voter's dots are their own key. Two
 * people voting at once therefore write different keys and nothing is lost,
 * which a shared array or counter could not promise. Counts are derived.
 */

export interface VoteSession {
  id: string;
  perPerson: number;
  by: string;
  startedAt: number;
  /** Results are shown to everyone once this is true. */
  revealed: boolean;
}

export const VOTE_KEY = 'workshop.vote';
export const MAX_VOTES_PER_PERSON = 20;
export const dotsKey = (sessionId: string, voterId: string) => `workshop.dots.${sessionId}.${voterId}`;
export const dotsPrefix = (sessionId: string) => `workshop.dots.${sessionId}.`;

export function readSession(raw: unknown): VoteSession | null {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as Partial<VoteSession>;
    if (typeof v.id !== 'string' || !v.id || !Number.isFinite(v.perPerson)) return null;
    return {
      id: v.id,
      perPerson: Math.max(1, Math.min(MAX_VOTES_PER_PERSON, Math.floor(v.perPerson as number))),
      by: typeof v.by === 'string' ? v.by : '',
      startedAt: Number.isFinite(v.startedAt) ? (v.startedAt as number) : 0,
      revealed: v.revealed === true,
    };
  } catch {
    return null;
  }
}

export function readDots(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * A click on an object: add a dot if the voter has one left, otherwise take
 * back one they already put there. Returns a copy either way.
 */
export function clickDot(current: readonly string[], objectId: string, perPerson: number): string[] {
  if (current.length < perPerson) return [...current, objectId];
  const at = current.lastIndexOf(objectId);
  if (at === -1) return current.slice();
  return [...current.slice(0, at), ...current.slice(at + 1)];
}

export interface Tally {
  counts: Map<string, number>;
  /** Highest first; ties keep a stable order by id. */
  ranked: Array<{ id: string; count: number }>;
  voters: number;
  total: number;
}

/**
 * Count dots. A voter over their allowance (a modified client, or an allowance
 * lowered after the fact) is counted only up to it, and dots on objects that no
 * longer exist are dropped.
 */
export function tallyVotes(
  dotsByVoter: Record<string, readonly string[]>,
  perPerson: number,
  exists: (id: string) => boolean = () => true
): Tally {
  const counts = new Map<string, number>();
  let voters = 0;
  let total = 0;
  for (const dots of Object.values(dotsByVoter)) {
    let used = 0;
    for (const id of dots) {
      if (used >= perPerson) break;
      if (!exists(id)) continue;
      used++;
      total++;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (used > 0) voters++;
  }
  const ranked = [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1));
  return { counts, ranked, voters, total };
}

interface Pickable {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
}

const NOT_VOTABLE = new Set(['connector', 'comment']);

/** The object a click lands on: the smallest one containing the point, then the highest. */
export function pickVoteTarget(objects: readonly Pickable[], p: { x: number; y: number }): string | null {
  let best: Pickable | null = null;
  let bestArea = Infinity;
  for (const o of objects) {
    if (NOT_VOTABLE.has(o.type) || !(o.width > 0) || !(o.height > 0)) continue;
    if (p.x < o.x || p.y < o.y || p.x > o.x + o.width || p.y > o.y + o.height) continue;
    const area = o.width * o.height;
    if (area < bestArea || (area === bestArea && (o.zIndex ?? 0) > (best?.zIndex ?? 0))) {
      best = o;
      bestArea = area;
    }
  }
  return best?.id ?? null;
}
