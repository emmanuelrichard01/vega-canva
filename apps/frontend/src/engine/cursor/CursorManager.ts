import { cursorState } from './CursorState';
import type { CursorStateId } from './CursorTypes';

class CursorManagerImpl {
  private targetX = -100;
  private targetY = -100;
  private isVisible = false;

  public get x() { return this.targetX; }
  public get y() { return this.targetY; }
  public get visible() { return this.isVisible; }
  public get state() { return cursorState.state; }

  updatePosition(x: number, y: number) {
    this.targetX = x;
    this.targetY = y;
  }

  setVisibility(visible: boolean) {
    this.isVisible = visible;
  }

  setState(state: CursorStateId) {
    cursorState.state = state;
  }
}

export const cursorManager = new CursorManagerImpl();
