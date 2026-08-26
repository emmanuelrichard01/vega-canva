/**
 * Writing an export to the system clipboard, and saying what happened.
 *
 * ## What was wrong with the old two lines
 *
 * `copyPng` called `ExportService.copyToClipboard(...)` inside a bare `void`,
 * and `copySvg` awaited `navigator.clipboard.writeText`. Neither had a `catch`,
 * neither told anyone anything, and both can fail for four ordinary reasons:
 *
 *  - the page is not in a secure context, so `navigator.clipboard` is undefined;
 *  - the browser has no `ClipboardItem` (every Firefox before 127);
 *  - the user, or an enterprise policy, denied clipboard write;
 *  - the render itself threw — no Konva stage, an unencodable format.
 *
 * In all four the menu item closed, nothing was copied, and the next Ctrl+V
 * pasted whatever had been on the clipboard beforehand. A copy that silently
 * does nothing is worse than one that refuses, because the failure surfaces
 * somewhere else entirely, as the wrong thing appearing in someone's document.
 *
 * So these return an outcome rather than throwing, and the message is written
 * for the person reading a toast rather than for a log.
 *
 * ## Why SVG goes on as two flavours
 *
 * An SVG is text, and everything that can receive one accepts text — so
 * `text/plain` is the flavour that must always be there. But a target that
 * understands `image/svg+xml` will take the vector rather than a wall of markup,
 * which is the difference between pasting *shapes* into Illustrator and pasting
 * a paragraph beginning `<svg`. Both are offered in one `ClipboardItem`, and
 * since an unsupported type rejects the *entire* write, the two-flavour attempt
 * falls back to plain text rather than failing the copy.
 */

export interface ClipboardResult {
  ok: boolean;
  /** One sentence, for a toast. Present on failure, absent on success. */
  message?: string;
}

const SUCCESS: ClipboardResult = { ok: true };

/** Why a clipboard write failed, in words that suggest what to do instead. */
function explain(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    // The name is the reliable part: browsers word the message differently and
    // some of them word it as the empty string.
    if (error.name === 'NotAllowedError') {
      return 'Your browser blocked the clipboard. Allow clipboard access, or use Export instead.';
    }
    if (error.message) return error.message;
  }
  return fallback;
}

/** Whether this browser can be handed an image at all. */
export function canCopyImage(): boolean {
  return (
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.clipboard?.write)
  );
}

/** Whether this browser can be handed text at all. */
export function canCopyText(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);
}

/**
 * Put a PNG on the clipboard.
 *
 * @param render called, not awaited, so the `ClipboardItem` is constructed
 *   inside the user's gesture. Safari ties a clipboard write to the gesture
 *   that started it and an `await` before `clipboard.write` ends it — which is
 *   why rendering first and writing second failed there with a bare
 *   `NotAllowedError` while working perfectly in Chrome. `ClipboardItem` takes
 *   a `Promise<Blob>` for exactly this.
 */
export async function copyImage(render: () => Promise<Blob>): Promise<ClipboardResult> {
  if (!canCopyImage()) {
    return { ok: false, message: 'This browser cannot copy images. Use Export instead.' };
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': render() })]);
    return SUCCESS;
  } catch (error) {
    return { ok: false, message: explain(error, 'Could not copy the image.') };
  }
}

/**
 * Put an SVG on the clipboard as vector where possible and as text always.
 *
 * The vector attempt is not a `canCopyImage()` question — a browser can support
 * `ClipboardItem` and still refuse `image/svg+xml`, and the only way to find
 * out is to try it. Which is fine, because the fallback is the flavour every
 * target accepts and the one the previous implementation used alone.
 */
export async function copyVector(markup: string): Promise<ClipboardResult> {
  if (canCopyImage()) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/svg+xml': new Blob([markup], { type: 'image/svg+xml' }),
          'text/plain': new Blob([markup], { type: 'text/plain' }),
        }),
      ]);
      return SUCCESS;
    } catch {
      // Refusing the type is expected, not exceptional. Fall through.
    }
  }

  if (!canCopyText()) {
    return { ok: false, message: 'This browser cannot copy to the clipboard. Use Export instead.' };
  }
  try {
    await navigator.clipboard.writeText(markup);
    return SUCCESS;
  } catch (error) {
    return { ok: false, message: explain(error, 'Could not copy the SVG.') };
  }
}
