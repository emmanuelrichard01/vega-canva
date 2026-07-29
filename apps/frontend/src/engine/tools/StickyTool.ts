import { nanoid } from 'nanoid';
import type { Tool, ToolContext } from './Tool';
import type { StickyTheme } from '../model/schema';
import { localAuthor } from '../document';

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

    ctx.editor.createNode({
      id: nanoid(),
      type: 'sticky',
      // Centre the note on the cursor.
      x: x - STICKY_SIZE / 2,
      y: y - STICKY_SIZE / 2,
      width: STICKY_SIZE,
      height: STICKY_SIZE,
      text: '',
      theme,
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
