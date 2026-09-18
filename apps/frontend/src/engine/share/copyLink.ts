/**
 * Putting a link on the clipboard in the shape its destination wants.
 *
 * A board link is almost never pasted somewhere that wants a bare URL. It goes
 * into a Slack message, a Notion page, a document, a ticket — all of which
 * render a titled link properly and all of which show a naked
 * `https://…/room/k3f9a2` when that is what they are given. So the copy carries
 * both: `text/html` for anything that understands rich text, and the plain URL
 * as `text/plain` for everything else and for the address bar.
 *
 * The person does not choose between them. Choosing is the editor's job — it
 * takes whichever flavour it can use — and asking someone which clipboard
 * format they would like is asking them to know something about their paste
 * target that they should not have to.
 *
 * ## Falling back, in order
 *
 * `ClipboardItem` is the only way to put two flavours on the clipboard at once
 * and it is not everywhere, and in some browsers it is refused outside a user
 * gesture. Below it, `writeText` with the plain URL, which is what this did
 * before and is never wrong, only plainer. Below *that*, the caller shows the
 * field and says to copy it by hand — which is why this reports what happened
 * rather than throwing.
 */

export type CopyOutcome = 'rich' | 'plain' | 'failed';

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/**
 * A titled link, as HTML.
 *
 * The title is escaped because it is the board's name, which a person typed
 * and which therefore contains whatever a person types. An unescaped `<` in a
 * board name would be a broken anchor at best and, in a target that renders
 * pasted HTML, something worse.
 */
export function linkHtml(url: string, title: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`;
}

export async function copyLink(url: string, title: string): Promise<CopyOutcome> {
  const trimmed = title.trim();

  if (trimmed && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([linkHtml(url, trimmed)], { type: 'text/html' }),
          'text/plain': new Blob([url], { type: 'text/plain' }),
        }),
      ]);
      return 'rich';
    } catch {
      /* Not permitted, or not supported for these types. The URL still works. */
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return 'plain';
  } catch {
    return 'failed';
  }
}

/**
 * Hand the link to the operating system's own share sheet, if there is one.
 *
 * Worth offering only where it is genuinely better than copying: on a phone it
 * is the difference between "copy, switch app, find the thread, paste" and one
 * tap. `false` means there was nothing to offer or the person dismissed it,
 * and in both cases the dialog's own copy button is still sitting there.
 */
export async function shareLink(url: string, title: string): Promise<boolean> {
  if (!navigator.share) return false;
  try {
    await navigator.share({ title, url });
    return true;
  } catch {
    // Dismissing the sheet rejects, and a dismissal is not a failure worth
    // reporting: the person decided not to share, which was the point of
    // showing them a sheet.
    return false;
  }
}

/**
 * Whether the share sheet is worth showing at all.
 *
 * Desktop Chrome exposes `navigator.share` and opens a sheet nobody wants when
 * a copy button is six pixels away, so presence of the API is not the
 * question — whether the device is one where a share sheet beats a clipboard
 * is. Coarse pointer and a narrow screen is that device.
 */
export function shareSheetWorthwhile(): boolean {
  if (typeof navigator === 'undefined' || !navigator.share) return false;
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
