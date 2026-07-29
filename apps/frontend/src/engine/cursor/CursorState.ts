import type { CursorStateId } from './CursorTypes';

class CursorStateManager {
  private currentState: CursorStateId = 'idle';

  get state(): CursorStateId {
    return this.currentState;
  }

  set state(newState: CursorStateId) {
    this.currentState = newState;
  }
}

export const cursorState = new CursorStateManager();
