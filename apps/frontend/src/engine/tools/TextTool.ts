import { nanoid } from 'nanoid';
import type { Tool, ToolContext } from './Tool';
import { ThemeService } from '../ThemeService';
import { DEFAULT_TYPOGRAPHY } from '../model/schema';

export class TextTool implements Tool {
  id = 'text';
  cursor = 'text';

  onPointerDown(ctx: ToolContext, e: any) {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;

    const { x, y } = ctx.camera.screenToWorld(pos.x, pos.y);

    const nodeId = nanoid();
    ctx.editor.createNode({
      id: nodeId,
      type: 'text',
      x,
      y,
      width: 240,
      height: 40,
      text: '',
      resize: 'height',
      typography: {
        ...DEFAULT_TYPOGRAPHY,
        color: ThemeService.getDefaultTextColor(),
      },
    });

    // Select the node so it gets focus by firing a custom event to Canvas.tsx
    document.dispatchEvent(new CustomEvent('requestSelectNode', { detail: { id: nodeId } }));

    // Trigger edit mode by dispatching a custom event
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent('requestEditNode', { detail: { id: nodeId } }));
      window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'select' }));
    }, 50);
  }

  onPointerMove() {}
  onPointerUp() {}
}
