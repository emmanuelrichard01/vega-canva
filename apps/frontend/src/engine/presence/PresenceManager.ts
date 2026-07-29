import { provider } from '../document';
import type { PresenceState } from "./PresenceTypes";

class PresenceEngine {
  private localState: Partial<PresenceState> = {
    cursor: null,
    viewport: null,
    selection: [],
    tool: 'select',
    activity: null,
    status: 'online'
  };

  private pendingUpdate = false;
  private lastUpdateTime = 0;
  private THROTTLE_MS = 1000 / 30; // 30fps max
  private idleTimeout: any = null;
  private IDLE_MS = 60000; // 60 seconds

  private scheduleUpdate() {
    if (this.pendingUpdate) return;
    
    const now = Date.now();
    const timeSinceLast = now - this.lastUpdateTime;
    
    if (timeSinceLast >= this.THROTTLE_MS) {
      this.pushToAwareness();
    } else {
      this.pendingUpdate = true;
      setTimeout(() => {
        this.pushToAwareness();
        this.pendingUpdate = false;
      }, this.THROTTLE_MS - timeSinceLast);
    }
  }

  private pushToAwareness() {
    this.lastUpdateTime = Date.now();
    if (!provider.awareness) return;

    // Only set ephemeral fields; user (id, name, color) is set via Auth context once
    provider.awareness.setLocalState({
      ...provider.awareness.getLocalState(),
      ...this.localState
    });
  }

  private resetIdleTimer() {
    if (this.localState.status === 'away') {
      this.localState.status = 'online';
      this.scheduleUpdate();
    }
    
    if (this.idleTimeout) clearTimeout(this.idleTimeout);
    
    this.idleTimeout = setTimeout(() => {
      this.localState.status = 'away';
      this.scheduleUpdate();
    }, this.IDLE_MS);
  }

  public updateCursor(x: number, y: number) {
    this.localState.cursor = { x, y };
    this.resetIdleTimer();
    this.scheduleUpdate();
  }

  public updateViewport(x: number, y: number, zoom: number) {
    this.localState.viewport = { x, y, zoom };
    this.resetIdleTimer();
    this.scheduleUpdate();
  }

  public updateSelection(selection: string[]) {
    this.localState.selection = selection;
    this.resetIdleTimer();
    this.scheduleUpdate();
  }

  public updateTool(tool: string) {
    this.localState.tool = tool;
    this.resetIdleTimer();
    this.scheduleUpdate();
  }

  public updateActivity(activity: string | null) {
    this.localState.activity = activity;
    this.resetIdleTimer();
    this.scheduleUpdate();
  }
}

export const presenceManager = new PresenceEngine();
