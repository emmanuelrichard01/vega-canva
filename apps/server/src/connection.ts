/**
 * What a client says about itself on the WebSocket handshake.
 *
 * ## Two unrelated things share one slot
 *
 * Hocuspocus gives a connection exactly one `token`, and this deployment has
 * two things to put in it, so they travel as one JSON object:
 *
 * - **`secret`** is `AUTH_SECRET`: a single shared token for the whole
 *   deployment, a front door for a private instance. It is checked. It is
 *   still not authorization -- it cannot express "this person, this board".
 * - **`role`** is the client's *view mode*, and it is a statement of intent.
 *   It is not checked, because there is nothing to check it against.
 *
 * ## Why the role is not a permission, said once, here
 *
 * There are no accounts in this application. The room id is the whole of the
 * capability (`rooms.ts`), so anyone who can open a board at all can edit it.
 * A `role` the client picks is therefore a request the server grants as a
 * courtesy: it stops a tab that has put its own tools away from syncing edits
 * anyway, and it stops nothing else.
 *
 * This previously arrived as a `role` claim inside a JWT whose signature was
 * never verified, with an `exp` enforced from that same unverified payload.
 * That is not weak authorization; it is decoration shaped like authorization,
 * and it was believed downstream -- the share dialog went on to promise users
 * that "mutation packets are rejected server-side". Anything added here that
 * looks stronger than what it is will be believed the same way.
 *
 * Real per-board roles need accounts, a membership table, and a token this
 * server signed and verifies. See `docs/GOING-LIVE.md` section 2, stage 3.
 */

export type DeclaredRole = 'editor' | 'commenter' | 'viewer';

export interface ConnectionClaim {
  /** What the client asked for. Honoured, never trusted. */
  role: DeclaredRole;
  /** The shared secret, if one was supplied. Checked by the caller. */
  secret: unknown;
  /**
   * A signed invite token, if the client presented one.
   *
   * Passed through unverified on purpose: this module parses, it does not
   * decide. `verifyShareToken` is the only thing that may read a role out of
   * it, and the caller checks the room binding as well as the signature.
   */
  invite?: string;
}

/** Spellings accepted for each mode, so a hand-typed URL behaves. */
const ROLE_WORDS: Record<string, DeclaredRole> = {
  viewer: 'viewer',
  view: 'viewer',
  readonly: 'viewer',
  commenter: 'commenter',
  comment: 'commenter',
  editor: 'editor',
  edit: 'editor',
};

function toRole(value: unknown): DeclaredRole | null {
  if (typeof value !== 'string') return null;
  return ROLE_WORDS[value.toLowerCase()] ?? null;
}

/**
 * @param token  the handshake token: JSON from this app's client, or a bare
 *               string from a script sending only the shared secret.
 * @param queryRole  `?role=` on the connection URL, which wins if present --
 *               it is the more explicit of the two and the easier to debug.
 */
export function readConnectionClaim(token: unknown, queryRole?: unknown): ConnectionClaim {
  let role: DeclaredRole = 'editor';
  let secret: unknown = token;
  let invite: string | undefined;

  if (typeof token === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(token);
    } catch {
      // Not JSON: a bare shared secret. `secret` already holds it.
      parsed = null;
    }

    if (parsed && typeof parsed === 'object') {
      const body = parsed as Record<string, unknown>;
      role = toRole(body.role) ?? role;
      if (typeof body.invite === 'string' && body.invite) invite = body.invite;
      // A JSON token that carries no secret leaves `secret` undefined rather
      // than the JSON itself, so a deployment with AUTH_SECRET set rejects it
      // instead of comparing the whole envelope against the secret.
      secret = typeof body.secret === 'string' ? body.secret : undefined;
    }
  }

  return { role: toRole(queryRole) ?? role, secret, ...(invite ? { invite } : {}) };
}
