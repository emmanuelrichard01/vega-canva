import { nanoid } from 'nanoid';
import type { Tool, ToolContext } from './Tool';
import type { EditorAPI } from '../api/EditorAPI';
import { localAuthor } from '../document';
import { useStore } from '../../hooks/useStore';
import { requestEditOnMount } from '../interaction/pendingEdit';
import { finishCreation } from './toolModes';

export const STICKY_SIZE = 200;

/**
 * Put a note down centred on a world point, with its caret already open.
 *
 * Shared by the tool and by dragging a note off the dock, which are two
 * gestures for one act -- and a note placed one way must not differ from a
 * note placed the other in its size, its colour or whether you can type into
 * it straight away.
 */
export function placeSticky(editor: Pick<EditorAPI, 'createNode'>, x: number, y: number): string {
  /**
   * The colour you last worked in, not the next one along a list.
   *
   * This used to walk a fixed cycle on every placement, so dropping three
   * notes in a row gave three different colours and a deliberate colour code
   * was impossible to lay down. It also contradicted the Tab-chain, which
   * inherits its colour precisely so a train of thought looks like one.
   */
  const theme = useStore.getState().stickyTheme;

  const id = nanoid();

  // Claimed *before* the node exists, so the renderer picks it up on its
  // first render. A note you have to hunt down and double-click is a note
  // whose thought you have already lost. See `pendingEdit.ts` for why this
  // is a latch and not an event.
  requestEditOnMount(id);

  editor.createNode({
    id,
    type: 'sticky',
    // Centre the note on the point.
    x: x - STICKY_SIZE / 2,
    y: y - STICKY_SIZE / 2,
    width: STICKY_SIZE,
    height: STICKY_SIZE,
    text: '',
    theme,
    // Superseded by `stickyText.fitFontSize`, which sizes the type to the
    // note. Kept on the schema so older documents still normalize.
    fontSize: 16,
    author: localAuthor(),
    reactions: {},
    tags: [],
    pinned: false,
  });

  return id;
}

export class StickyTool implements Tool {
  id = 'sticky';
  cursor = 'crosshair';

  onPointerDown(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const pos = stage?.getPointerPosition();
    if (!pos) return;

    const { x, y } = ctx.camera.screenToWorld(pos.x, pos.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    placeSticky(ctx.editor, x, y);

    /**
     * Back to Select once the note is down -- unless the tool is being kept.
     *
     * Every other creation tool already does this — text, shape and frame all
     * hand the canvas back the moment they have made their object. Sticky was
     * the one that stayed armed, so finishing a note and clicking the canvas
     * placed *another* note instead of selecting, and there was no way out of
     * the tool except finding the dock again.
     *
     * Placing a run of notes is still one gesture each, on purpose: `Q` (or a
     * double-click on the seat) keeps the tool, and that is a choice somebody
     * makes rather than a default everybody pays for. See `toolModes`.
     *
     * The note's editor is opened by the `requestEditOnMount` latch rather
     * than by the tool, so changing tool here does not interrupt typing — the
     * caret is already in the note that was just placed.
     *
     * Tab-chaining is unaffected for the same reason: it is driven from inside
     * the editor, not from the armed tool.
     */
    finishCreation();
  }

  onPointerMove() {}
  onPointerUp() {}
}
