import { nanoid } from 'nanoid';
import type { Tool, ToolContext } from './Tool';
import { localAuthor } from '../document';
import { useStore } from '../../hooks/useStore';
import { requestEditOnMount } from '../interaction/pendingEdit';

const STICKY_SIZE = 200;

export class StickyTool implements Tool {
  id = 'sticky';
  cursor = 'crosshair';

  onPointerDown(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const pos = stage?.getPointerPosition();
    if (!pos) return;

    const { x, y } = ctx.camera.screenToWorld(pos.x, pos.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

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

    ctx.editor.createNode({
      id,
      type: 'sticky',
      // Centre the note on the cursor.
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

    /**
     * Back to Select once the note is down.
     *
     * Every other creation tool already does this — text, shape and frame all
     * hand the canvas back the moment they have made their object. Sticky was
     * the one that stayed armed, so finishing a note and clicking the canvas
     * placed *another* note instead of selecting, and there was no way out of
     * the tool except finding the dock again.
     *
     * The note's editor is opened by the `requestEditOnMount` latch rather
     * than by the tool, so changing tool here does not interrupt typing — the
     * caret is already in the note that was just placed.
     *
     * Tab-chaining is unaffected for the same reason: it is driven from inside
     * the editor, not from the armed tool.
     */
    window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'select' }));
  }

  onPointerMove() {}
  onPointerUp() {}
}
