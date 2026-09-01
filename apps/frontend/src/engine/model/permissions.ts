/**
 * View mode: which tools this browser tab offers, and nothing more.
 *
 * ## Read this before you rely on it
 *
 * **This is not access control.** It is a mode, in the same family as the
 * ruler toggle: a thing you turn on so you stop nudging shapes while you read
 * a board. There are no accounts in this application and the room id is the
 * whole of the capability -- see `docs/DEPLOYMENT.md` §1 -- so anyone who can
 * open a board at all can edit it.
 *
 * The mode is chosen by `?role=` on the URL, which means it is chosen by
 * whoever holds the URL. Deleting eight characters from the address bar turns
 * it off. That is not a hole to be plugged; it is what a client-side
 * preference *is*. The version that had a `role` claim inside an unverified
 * JWT was the same preference wearing a lanyard, and the lanyard was the
 * dangerous part -- it read as authorization to the next person to open the
 * file, so the share dialog went ahead and promised access control it could
 * not deliver.
 *
 * Real per-board permissions need accounts, a membership table, and a
 * server-signed token checked in `onAuthenticate`. That is `docs/GOING-LIVE.md`
 * §2 stage 3, and it is a product decision before it is a code one.
 *
 * ## What this *does* buy you
 *
 * A coherent read-only experience. The server honours the same mode the client
 * declares, so a viewer's edits would not sync anyway; without this module the
 * UI happily offered the full toolset and then dropped the results on the
 * floor, which is worse than no view mode at all. Every gate below exists to
 * make the interface agree with the outcome.
 */

export type RoomRole = 'editor' | 'commenter' | 'viewer';

export interface RoomPermissions {
  role: RoomRole;
  canEdit: boolean;
  canComment: boolean;
  canExport: boolean;
  canTransform: boolean;
  canDrag: boolean;
}

/**
 * Tools that move the viewport or the selection rather than the document.
 *
 * An allow-list rather than a deny-list on purpose: a new drawing tool added
 * next year is an edit until somebody says otherwise, and the failure of a
 * deny-list is that the new tool is silently permitted in a mode named for
 * not permitting it.
 */
export const NON_EDITING_TOOLS: ReadonlySet<string> = new Set(['select', 'hand']);

/** Additionally allowed for a commenter. */
export const COMMENT_TOOLS: ReadonlySet<string> = new Set(['comment']);

let activeRole: RoomRole = 'editor';
const roleListeners = new Set<(role: RoomRole) => void>();

/** Reads the mode out of `?role=` / `?permission=` on the current URL. */
export function resolveInitialRole(search?: string): RoomRole {
  const query =
    search ?? (typeof window !== 'undefined' && window.location ? window.location.search : '');
  if (!query) return 'editor';

  const roleParam = (new URLSearchParams(query).get('role') ||
    new URLSearchParams(query).get('permission') ||
    '').toLowerCase();

  if (roleParam === 'viewer' || roleParam === 'view' || roleParam === 'readonly') return 'viewer';
  if (roleParam === 'commenter' || roleParam === 'comment') return 'commenter';
  return 'editor';
}

activeRole = resolveInitialRole();

export function getRoomRole(): RoomRole {
  return activeRole;
}

export function setRoomRole(role: RoomRole): void {
  if (activeRole !== role) {
    activeRole = role;
    roleListeners.forEach((fn) => fn(activeRole));
  }
}

export function subscribeRoomRole(listener: (role: RoomRole) => void): () => void {
  roleListeners.add(listener);
  return () => roleListeners.delete(listener);
}

export function getPermissions(role: RoomRole = activeRole): RoomPermissions {
  const isEditor = role === 'editor';
  const isCommenter = role === 'commenter';

  return {
    role,
    canEdit: isEditor,
    canComment: isEditor || isCommenter,
    // Export reads the board and writes a local file. It touches nothing
    // shared, so there is no mode in which withholding it would help anyone.
    canExport: true,
    canTransform: isEditor,
    canDrag: isEditor,
  };
}

/**
 * Whether a tool may be picked up in the current mode.
 *
 * This is the gate `ToolManager` consults, which is why it is the only one
 * that has to be right: the dock, the keyboard shortcuts and the command
 * palette all arrive through it.
 */
export function canUseTool(toolId: string, role: RoomRole = activeRole): boolean {
  if (role === 'editor') return true;
  if (NON_EDITING_TOOLS.has(toolId)) return true;
  return role === 'commenter' && COMMENT_TOOLS.has(toolId);
}

/** The tool to fall back to when the armed one is not allowed here. */
export const FALLBACK_TOOL = 'select';

export const canEditObjects = () => activeRole === 'editor';
export const canPostComments = () => activeRole === 'editor' || activeRole === 'commenter';
export const isReadOnlyRole = () => activeRole === 'viewer';
