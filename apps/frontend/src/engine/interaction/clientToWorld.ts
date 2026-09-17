import { cameraSystem } from '../CameraSystem';

/**
 * A point in the window, as a point on the board.
 *
 * `cameraSystem.screenToWorld` takes coordinates relative to the **stage**,
 * and the stage does not start at the window's corner: the rulers and the top
 * bar inset it. Passing it a raw `clientX` — which "Paste here" did — lands
 * everything up and to the left of the pointer by exactly that inset, so
 * pasting at the cursor never pasted at the cursor.
 *
 * The drop zone and the context menu's table import already subtracted the
 * stage's rect by hand; this is that arithmetic, once.
 */
export function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const stage =
    typeof document === 'undefined'
      ? null
      : document.querySelector('.konvajs-content')?.getBoundingClientRect() ?? null;
  return cameraSystem.screenToWorld(clientX - (stage?.left ?? 0), clientY - (stage?.top ?? 0));
}
