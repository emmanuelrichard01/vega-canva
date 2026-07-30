import { provider } from '../document';
import type { PresenceState } from "./PresenceTypes";

/**
 * The single writer of ephemeral presence.
 *
 * It was not, and that was a live bug. Two places wrote the awareness `cursor`
 * field: `Canvas` set it directly through `setLocalStateField` on stage
 * mousemove and set it to `null` on mouse-leave, while `CursorRenderer` called
 * `updateCursor` from a `window` mousemove that fired over panels, the header,
 * everywhere. They disagreed about leaving. `pushToAwareness` merges
 * `localState` *over* whatever is already there, so the moment any other
 * presence update went out — a selection, a tool change, the idle timer — it
 * put the stale cursor back, and a collaborator who had moved to a side panel
 * kept a ghost pointer parked on the canvas.
 *
 * Writing awareness anywhere else reintroduces that. Route it through here.
 */
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
  // 15Hz. This one gate now covers the cursor too, which used to have its own
  // throttle in `Canvas`; remote cursors are interpolated at frame rate on the
  // way in (`engine/cursor/remoteCursor.ts`), so the broadcast rate only has
  // to be high enough to describe the path, not to draw it.
  private THROTTLE_MS = 1000 / 15;
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

  /** World-space pointer position. Called only from the canvas surface. */
  public updateCursor(x: number, y: number) {
    this.localState.cursor = { x, y };
    this.resetIdleTimer();
    this.scheduleUpdate();
  }

  /**
   * The pointer left the canvas — over a panel, or out of the window.
   *
   * This has to clear `localState`, not just the published field: anything
   * that only cleared awareness would be undone by the next `pushToAwareness`.
   * It deliberately does not touch the idle timer, because moving onto a panel
   * is still working.
   */
  public clearCursor() {
    if (this.localState.cursor === null) return;
    this.localState.cursor = null;
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
