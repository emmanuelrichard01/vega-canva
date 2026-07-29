import { provider } from '../engine/document';

export interface Presence {
  userId: number;
  name: string;
  color: string;
  
  // Viewport
  viewport: { x: number; y: number; width: number; height: number; zoom: number } | null;
  
  // Interpolated Cursor
  cursor: {
    currentX: number;
    currentY: number;
    targetX: number;
    targetY: number;
  } | null;

  // Thrown objects flight paths
  throws?: Record<string, { x: number, y: number }>;
  
  // Activity state for Radar
  activity: 'idle' | 'moving' | 'drawing' | 'typing' | 'throwing';
  
  lastSeen: number;
}

class PresenceEngine {
  public users: Map<number, Presence> = new Map();
  private LERP_FACTOR = 0.2; // Adjust for smoothness vs responsiveness

  constructor() {
    this.init();
  }

  private init() {
    if (provider.awareness) {
      provider.awareness.on('change', this.handleAwarenessChange);
    } else {
      // In case provider.awareness isn't ready immediately
      setTimeout(() => this.init(), 100);
    }
  }

  private handleAwarenessChange = () => {
    const states = provider.awareness?.getStates();
    if (!states) return;
    
    const now = performance.now();
    const activeIds = new Set<number>();

    states.forEach((state: any, clientId: number) => {
      // Don't track ourselves in the remote presence store
      if (clientId === provider.awareness?.clientID) return;
      if (!state.user) return;

      activeIds.add(clientId);

      let presence = this.users.get(clientId);
      if (!presence) {
        presence = {
          userId: clientId,
          name: state.user.name,
          color: state.user.color,
          viewport: null,
          cursor: null,
          activity: 'idle',
          lastSeen: now,
          throws: {}
        };
        this.users.set(clientId, presence);
      }

      presence.name = state.user.name;
      presence.color = state.user.color;
      presence.lastSeen = now;
      presence.viewport = state.viewport || null;
      presence.throws = state.throws || {};

      // Determine activity. `activeThrower`/`activeSelectionId` were never
      // actually written by anything (dead awareness fields) — the real
      // signals are `throws` (usePhysics, non-empty while a thrown object of
      // theirs is still in flight) and `activity` (PresenceManager's
      // human-readable string, e.g. "✏️ Typing" / "🎤 Recording").
      if (state.throws && Object.keys(state.throws).length > 0) {
        presence.activity = 'throwing';
      } else if (typeof state.activity === 'string' && /typing/i.test(state.activity)) {
        presence.activity = 'typing';
      } else if (state.cursor) {
        presence.activity = 'moving';
      } else {
        presence.activity = 'idle';
      }

      if (state.cursor) {
        if (!presence.cursor) {
          presence.cursor = {
            currentX: state.cursor.x,
            currentY: state.cursor.y,
            targetX: state.cursor.x,
            targetY: state.cursor.y,
          };
        } else {
          presence.cursor.targetX = state.cursor.x;
          presence.cursor.targetY = state.cursor.y;
        }
      } else {
        presence.cursor = null;
      }
    });

    // Remove users who left
    for (const id of this.users.keys()) {
      if (!activeIds.has(id)) {
        this.users.delete(id);
      }
    }
  };

  /**
   * Called every frame by the MinimapEngine to step interpolation
   */
  public updateInterpolation() {
    this.users.forEach((presence) => {
      if (presence.cursor) {
        presence.cursor.currentX += (presence.cursor.targetX - presence.cursor.currentX) * this.LERP_FACTOR;
        presence.cursor.currentY += (presence.cursor.targetY - presence.cursor.currentY) * this.LERP_FACTOR;
      }
    });
  }

  public getActiveUsers(): Presence[] {
    return Array.from(this.users.values());
  }
}

export const presenceStore = new PresenceEngine();
