/**
 * A backup waiting to be poured into a room that does not exist yet.
 *
 * ## Why this needs a handoff at all
 *
 * Restoring from the rooms page means "make me a new board out of this file",
 * and the board has to exist before anything can be written into it. Navigation
 * is a full page load — `window.location.href`, the same as opening any other
 * room — so the parsed document cannot simply be passed down as a prop or held
 * in a store. It has to survive the load.
 *
 * ## Why sessionStorage
 *
 * `localStorage` would outlive the tab, so a restore abandoned halfway through
 * — the tab closed, the browser crashed — would ambush the next room opened in
 * a week's time. `sessionStorage` is scoped to this tab and this session, which
 * is exactly the lifetime of the intent.
 *
 * The text is stashed rather than the parsed document: `sessionStorage` holds
 * strings anyway, and re-parsing on arrival means the room validates the file
 * with the same code that accepted it, rather than trusting a shape that
 * travelled through serialisation.
 */

const KEY = 'vega_pending_restore';

/** Remember a backup to apply once the new room has loaded. */
export function stashPendingRestore(text: string): void {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // Quota, or storage disabled. The caller gets `false` from `hasPending`
    // afterwards and can say so, rather than navigating to a new empty room
    // and leaving the user wondering where their work went.
  }
}

/**
 * Take the pending backup, if there is one. Removes it in the same breath.
 *
 * Read-and-clear rather than read-then-clear-later, so a failed restore cannot
 * retry itself on every reload — a corrupt file would otherwise wipe and
 * re-wipe the room each time the page was refreshed.
 */
export function takePendingRestore(): string | null {
  try {
    const text = sessionStorage.getItem(KEY);
    if (text !== null) sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return null;
  }
}

export function hasPendingRestore(): boolean {
  try {
    return sessionStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * The same handoff, for a template.
 *
 * A template opens as a **new room**, so it faces exactly the problem a
 * restored backup does: the board has to exist before anything can be written
 * into it, and navigation is a full page load. Rather than inventing a second
 * mechanism, this reuses the one already proven for restores — down to the
 * `sessionStorage` scoping, so a template chosen and then abandoned cannot
 * ambush the next room opened next week.
 *
 * Only the id travels. The template is rebuilt from code on arrival, which
 * keeps ids unique per room and means a template improved in a later release
 * is the one you get, not a copy frozen at the moment you clicked.
 */
const TEMPLATE_KEY = 'vega_pending_template';

export function stashPendingTemplate(id: string): void {
  try {
    sessionStorage.setItem(TEMPLATE_KEY, id);
  } catch {
    /* storage disabled; the room simply opens empty */
  }
}

export function takePendingTemplate(): string | null {
  try {
    const id = sessionStorage.getItem(TEMPLATE_KEY);
    if (id !== null) sessionStorage.removeItem(TEMPLATE_KEY);
    return id;
  } catch {
    return null;
  }
}
