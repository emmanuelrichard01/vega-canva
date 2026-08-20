import type { Tool, ToolContext } from './Tool';
import { pathEdit } from '../interaction/pathEdit';
import { useStore } from '../../hooks/useStore';

/**
 * Direct selection — the white arrow.
 *
 * ## Why this is a tool and not a mode on Select
 *
 * Anchor editing already existed, and it was reachable in exactly two ways:
 * double-clicking a path, or finding a button on the floating toolbar. Both are
 * *discoveries*, and both are unavailable when the thing you want to reshape is
 * one of forty objects you have not selected yet. Every vector editor puts this
 * on the toolbar next to Select and binds it to a letter for the same reason:
 * it is not an advanced mode of moving things, it is a different question about
 * what a click means, and the answer has to be visible before you click.
 *
 * With this armed, clicking a path opens it. Clicking a different path opens
 * that one instead — no exit gesture, no double-click, which is what makes
 * walking a drawing and correcting it feel like one activity rather than a
 * sequence of entries and escapes.
 *
 * ## What it deliberately does not do
 *
 * Marquee, anchor picking, handle dragging and insertion all live in
 * `PathEditor`, on Konva nodes that sit above the board. That is not a
 * division of convenience: those targets are drawn in the *node's* coordinate
 * space and are the only things that know where an anchor is on screen. A tool
 * re-deriving that from stage coordinates would be a second implementation of
 * the same hit test, and the two would disagree at the edges — which, for a
 * seven-pixel target, is most of it.
 */
export class DirectSelectTool implements Tool {
  id = 'direct-select';
  /**
   * A crosshair, not the default arrow.
   *
   * The one thing a person needs to know before clicking is that this click
   * means something different from the last one, and the pointer is where they
   * are already looking.
   */
  cursor = 'crosshair';

  onPointerDown(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    /**
     * Clicking the bare board leaves the path.
     *
     * Not merely deselecting: the mode itself ends, because a path open for
     * editing with nothing picked still shows every anchor, and a screenful of
     * handles over a drawing you have moved on from is noise.
     */
    if (e.target === stage) {
      pathEdit.exit();
      ctx.editor.select(null);
    }
  }

  /**
   * Nothing to track between down and up.
   *
   * The marquee belongs to `PathEditor`, which draws it in the node's own
   * coordinate space where the anchors are — see the note above. These exist
   * because the interface asks for them, and doing nothing is the honest body.
   */
  onPointerMove() {}
  onPointerUp() {}

  /**
   * Open whatever path was clicked.
   *
   * Called by the canvas when an object is selected while this tool is armed.
   * A non-path is left to ordinary selection, so the tool degrades to Select on
   * everything it cannot edit rather than swallowing the click — an editor that
   * appears inert on half the board is worse than one that does something
   * reasonable.
   */
  static open(id: string): boolean {
    const node = useStore.getState().objects[id];
    if (!node || node.type !== 'path' || node.geometry.kind === 'freehand') return false;
    pathEdit.enter(id);
    return true;
  }
}
