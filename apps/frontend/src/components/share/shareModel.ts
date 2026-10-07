import type { RoomRole } from '../../engine/model/permissions';
import { withFollowParam } from '../../engine/presence/followLink';

/**
 * The Share dialog's decisions, apart from its drawing, so they can be tested:
 * which roles this tab may hand out and why not, what the server's answer
 * means, and which link (if any) may be shown.
 */

/** How much each role may do. A link is never offered above the tab's own. */
export const ROLE_RANK: Record<RoomRole, number> = { viewer: 0, commenter: 1, editor: 2 };

export const ROLE_WORD: Record<RoomRole, string> = { editor: 'edit', commenter: 'comment', viewer: 'view' };

/** Why this tab cannot hand out `role`, or `undefined` when it can. */
export function roleBlockedReason(role: RoomRole, ownRole: RoomRole): string | undefined {
  if (ROLE_RANK[role] <= ROLE_RANK[ownRole]) return undefined;
  return `You joined with a ${ROLE_WORD[ownRole]} link, so you can't give ${ROLE_WORD[role]} access.`;
}

export type MintState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'ready'; url: string; ttlSeconds: number; role: RoomRole }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string; status?: number };

/**
 * What the invite endpoint's answer means.
 *
 * 501 is a state, not a failure: the deployment has no signing key. Any other
 * refusal is shown in the server's own words, because a 403 can mean this
 * tab's invite caps the role, that the board only accepts signed links, or
 * that the invite has expired, and only the server knows which.
 */
export function readMintResponse(
  status: number,
  body: unknown,
  ctx: { origin: string; role: RoomRole; requestedTtl: number }
): MintState {
  const b = (body ?? {}) as { error?: unknown; token?: unknown; ttlSeconds?: unknown };
  if (status === 501) return { kind: 'unavailable' };
  if (status < 200 || status >= 300) {
    const message = typeof b.error === 'string' && b.error.trim() ? b.error.trim() : 'The link could not be created.';
    return { kind: 'error', message, status };
  }
  if (typeof b.token !== 'string' || !b.token) return { kind: 'error', message: 'The server sent back no link.', status };
  // The server caps a link's life at what is left of this tab's own invite,
  // so the expiry shown is the one it returns, not the one asked for.
  const ttl = typeof b.ttlSeconds === 'number' && Number.isFinite(b.ttlSeconds) ? b.ttlSeconds : ctx.requestedTtl;
  return { kind: 'ready', url: `${ctx.origin}/i/${b.token}`, ttlSeconds: ttl, role: ctx.role };
}

/** What a refusal means for the person reading it, after the server's own sentence. */
export function mintRecovery(state: MintState): string | null {
  if (state.kind !== 'error') return null;
  if (state.status === 401) return 'Ask whoever shared this board with you for a new link.';
  if (state.status === 403) return 'Ask someone who can edit this board to make the link.';
  if (state.status === undefined) return 'Check your connection, then try again.';
  return null;
}

/**
 * The link to show for `role`, or `null` while there is none.
 *
 * An edit link is the board's own address unless the server requires signed
 * links (`signed`). A signed link never falls back
 * to that address, even while its signed link is on its way or has failed:
 * showing it would hand out edit rights in a field labelled "view".
 */
export function linkToShow(role: RoomRole, fullAccessLink: string, mint: MintState, signed = role !== 'editor'): string | null {
  if (!signed) return fullAccessLink;
  return mint.kind === 'ready' && mint.role === role ? mint.url : null;
}

/** True when the server gave less time than was asked for (or a limit where none was asked). */
export function wasShortened(requestedTtl: number, grantedTtl: number): boolean {
  return grantedTtl > 0 && (requestedTtl === 0 || grantedTtl < requestedTtl);
}

/**
 * "7 days" as the day it stops working. The duration is the choice; the date
 * is what anyone needs to know afterwards.
 */
export function expiryDate(seconds: number, now = Date.now()): string | null {
  if (!seconds) return null;
  const when = new Date(now + seconds * 1000);
  const sameYear = when.getFullYear() === new Date(now).getFullYear();
  return when.toLocaleDateString(undefined, {
    weekday: seconds <= 7 * 24 * 60 * 60 ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  });
}

/**
 * Whether this server only lets people in with a signed link.
 *
 * It matters more than any other fact in the dialog, because it decides what
 * a link can honestly be called. The server does not announce it directly; its
 * board-status route answers `restricted` exactly when the setting is on, so
 * that answer is what is read here.
 */
export type Enforcement = 'unknown' | 'on' | 'off';

export function readEnforcement(status: number, body: unknown): Enforcement {
  if (status < 200 || status >= 300) return 'unknown';
  const restricted = (body as { restricted?: unknown } | null)?.restricted;
  if (restricted === true) return 'on';
  if (restricted === false) return 'off';
  return 'unknown';
}

/**
 * Whether the link for `role` must be signed.
 *
 * Restricted roles always are. An edit link is the board's own address, until
 * the server stops accepting bare addresses, when it too has to be signed.
 */
export function linkNeedsToken(role: RoomRole, enforcement: Enforcement): boolean {
  return role !== 'editor' || enforcement === 'on';
}

/** What a role lets someone do, said only as strongly as the server will back up. */
export function roleBlurb(role: RoomRole, enforcement: Enforcement): string {
  if (role === 'editor') return 'Draw, move and delete anything, and share the board onward.';
  const held = enforcement === 'on';
  if (role === 'commenter') return held ? 'Read the board and leave comments. The server refuses edits.' : 'Read the board and leave comments. Drawing tools stay hidden.';
  return held ? 'Look around and export. The server refuses edits.' : 'Look around and export. Editing is switched off.';
}

/**
 * The plain statement under the link about what it does and does not protect.
 *
 * Never stronger than the facts: with enforcement off, a board's bare address
 * still opens it with full access, so a view or comment link is a way to hand
 * someone a narrower door, not a lock on the others.
 */
export function securityNote(role: RoomRole, enforcement: Enforcement, signingAvailable: boolean): string {
  if (!signingAvailable) {
    return 'Comment and view links have to be signed by the server, and this one has no signing key. Only edit links can be shared until SHARE_SECRET is set.';
  }
  if (enforcement === 'on') {
    return role === 'editor'
      ? 'This server only opens boards with a signed link. Anyone with this one can edit, and a link that is out cannot be taken back.'
      : 'This server only opens boards with a signed link, so this one is held to its access. Expiry is checked by the server.';
  }
  if (role === 'editor') {
    return 'There are no accounts on this board, so the link is the key. Anyone who has it, or the board address, can edit, and a link that is out cannot be taken back.';
  }
  return 'Signed so it cannot be edited into an edit link. The board address still opens with full access on this server, so this narrows what you hand over, not who else can get in.';
}

/** The link with follow mode switched on, when there is someone to follow. */
export function presentLink(link: string | null, authorId: string | undefined, on: boolean): string | null {
  if (!link || !on || !authorId) return link;
  return withFollowParam(link, authorId);
}
