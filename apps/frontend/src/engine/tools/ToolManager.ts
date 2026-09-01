import type {  Tool, ToolContext  } from './Tool';
import * as React from 'react';
import { canUseTool, FALLBACK_TOOL } from '../model/permissions';

export class ToolManager {
  private tools: Map<string, Tool> = new Map();
  private activeToolId: string = 'select';
  private context: ToolContext;

  constructor(context: ToolContext) {
    this.context = context;
  }

  registerTool(tool: Tool) {
    this.tools.set(tool.id, tool);
  }

  setActiveTool(id: string) {
    if (!this.tools.has(id)) return;

    /**
     * The one gate view mode needs.
     *
     * Every route to a tool -- the dock, the keyboard shortcuts, the command
     * palette, a lesson arming one for you -- ends in this call, so refusing
     * here is refusing everywhere. Gating the dock buttons instead would have
     * left the shortcuts working, which is the usual way a disabled control
     * turns out not to be.
     *
     * It falls back to Select rather than doing nothing: a click that leaves
     * the previous tool armed reads as a broken button, and if the previous
     * tool was itself refused there would be nothing in hand at all.
     */
    if (!canUseTool(id)) {
      if (this.activeToolId !== FALLBACK_TOOL && this.tools.has(FALLBACK_TOOL)) {
        this.setActiveTool(FALLBACK_TOOL);
      }
      return;
    }

    const prevTool = this.getActiveTool();
    if (prevTool?.onDeactivate) prevTool.onDeactivate(this.context);
    
    this.activeToolId = id;
    
    const newTool = this.getActiveTool();
    if (newTool?.onActivate) newTool.onActivate(this.context);
  }

  getActiveTool(): Tool | undefined {
    return this.tools.get(this.activeToolId);
  }

  getCursor(): string {
    return this.getActiveTool()?.cursor || 'default';
  }

  handlePointerDown(e: any) {
    this.getActiveTool()?.onPointerDown(this.context, e);
  }

  handlePointerMove(e: any) {
    this.getActiveTool()?.onPointerMove(this.context, e);
  }

  handlePointerUp(e: any) {
    this.getActiveTool()?.onPointerUp(this.context, e);
  }

  handleKeyDown(e: KeyboardEvent) {
    this.getActiveTool()?.onKeyDown?.(this.context, e);
  }
  
  handleKeyUp(e: KeyboardEvent) {
    this.getActiveTool()?.onKeyUp?.(this.context, e);
  }

  renderOverlay(overlayState: any): React.ReactNode {
    return this.getActiveTool()?.renderOverlay?.(this.context, overlayState) || null;
  }
}
// Trigger HMR cache clear
