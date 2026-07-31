import { nanoid } from 'nanoid';
import type { Tool, ToolContext } from './Tool';
import type { StickyTheme } from '../model/schema';
import { localAuthor } from '../document';
import { requestEditOnMount } from '../interaction/pendingEdit';

const THEME_CYCLE: StickyTheme[] = [
  'yellow',
  'mint',
  'sky',
  'pink',
  'lavender',
  'peach',
  'white',
  'dark',
];

const STICKY_SIZE = 200;

let themeIndex = 0;

export class StickyTool implements Tool {
  id = 'sticky';
  cursor = 'crosshair';

  onPointerDown(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const pos = stage?.getPointerPosition();
    if (!pos) return;

    const { x, y } = ctx.camera.screenToWorld(pos.x, pos.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const theme = THEME_CYCLE[themeIndex % THEME_CYCLE.length];
    themeIndex++;

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
  }

  onPointerMove() {}
  onPointerUp() {}
}
