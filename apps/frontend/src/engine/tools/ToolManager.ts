import type {  Tool, ToolContext  } from './Tool';
import * as React from 'react';

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
