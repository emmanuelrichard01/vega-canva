import type {  Tool, ToolContext  } from './Tool';
import * as React from 'react';
import { canUseTool, FALLBACK_TOOL, getRoomRole } from '../model/permissions';
import { notify } from '../ui/notices';

/**
 * How long one refusal speaks for. Long enough that a run of thwarted clicks
 * is one message, short enough that coming back to it later is answered again.
 */
const REFUSAL_QUIET_MS = 8000;

export class ToolManager {
  /**
   * Static, not per-instance: the message is about the person's access to this
   * board, so two managers must not each get their own turn to say it.
   */
  private static lastRefusalAt = 0;

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
      /**
       * Say why, at the moment it is asked.
       *
       * This used to refuse in silence. A tool that does not arm, with no
       * message anywhere, is indistinguishable from a broken button -- and
       * silence is worst precisely here, because reaching for a tool *is* the
       * question "why can't I draw?" being asked out loud. The role chip in
       * the header is the standing answer; this is the answer at the moment
       * somebody wants it, which is a different job and the one people
       * actually notice.
       *
       * Throttled, because refusal arrives in bursts: pressing a shortcut
       * three times, or clicking along the dock, is one question and deserves
       * one answer rather than a stack of identical notices. `notify` already
       * collapses exact repeats inside its own window; this keeps the count
       * down at the source as well, since a stream of refusals a few seconds
       * apart is still one person asking one thing.
       */
      const now = Date.now();
      if (now - ToolManager.lastRefusalAt > REFUSAL_QUIET_MS) {
        ToolManager.lastRefusalAt = now;
        notify({
          tone: 'info',
          message:
            getRoomRole() === 'commenter'
              ? 'You have comment access on this board — the drawing tools are held back.'
              : 'You have view access on this board, so it cannot be edited from here.',
        });
      }

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
