export type EngineEventType = 
  | 'CameraChanged'
  | 'ObjectAdded'
  | 'ObjectRemoved'
  | 'ObjectMoved'
  | 'ObjectModified'
  | 'VisibleSetUpdated'
  | 'SelectionChanged'
  | 'PresenceUpdated'
  | 'PhysicsStarted'
  | 'PhysicsStopped'
  | 'PhysicsTick'
  | 'RenderTick'
  | 'ActiveToolChanged'
  | 'CommentDraftRequested';

export class EventBus {
  private listeners: Map<EngineEventType, Set<Function>> = new Map();

  on<T = any>(event: EngineEventType, callback: (payload: T) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.off(event, callback);
  }

  off<T = any>(event: EngineEventType, callback: (payload: T) => void) {
    this.listeners.get(event)?.delete(callback);
  }

  emit<T = any>(event: EngineEventType, payload?: T) {
    this.listeners.get(event)?.forEach(cb => cb(payload));
  }
}

// Singleton instance for the whole engine
export const engineEvents = new EventBus();
