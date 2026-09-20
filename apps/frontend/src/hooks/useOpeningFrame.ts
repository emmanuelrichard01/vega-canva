import { useEffect, useRef } from 'react';
import { cameraSystem } from '../engine/CameraSystem';
import { editor } from '../engine/api/EditorAPI';
import { engineEvents } from '../engine/EventBus';

/**
 * Where a board is looking the moment you open it.
 *
 * ## The bug
 *
 * `cameraSystem` is a module singleton, and a singleton outlives a route
 * change. So opening board A, panning across it, going back and opening board
 * B put you at **board A's** camera — a position that means nothing on this
 * board and usually shows either empty space or one arbitrary object filling
 * the screen. Reported as "it appears zoomed into any random object
 * somewhere", which is exactly what it is: the last thing you were looking at
 * somewhere else.
 *
 * A hard reload has the mirror of the same fault. The camera starts at the
 * origin at 100%, which is only the right answer if the board's content
 * happens to be near world (0, 0). Anyone who worked a few thousand units out
 * — which the infinite canvas invites — reopens their board on blank grid,
 * with no indication that anything exists or which way it lies.
 *
 * ## The rule
 *
 * Frame the content, once, when the board opens. Three details make that
 * behave rather than merely happen:
 *
 * **It fits, and never magnifies.** `fitPose` caps at 1:1 already, and that
 * cap is load-bearing here: a board holding one sticky note would otherwise
 * open with that note blown up to fill the window, which is "fit" by the
 * arithmetic and useless to look at. Fitting may zoom out as far as it likes.
 *
 * **An empty board opens at the origin at 100%,** which is where `0` resets to
 * and where a fresh board has always started. There is nothing to frame, and
 * inventing a pose for an empty board would only make the first object anyone
 * draws land somewhere unexpected.
 *
 * **It happens exactly once, and only when there is something to frame.** The
 * document arrives over the network *after* mount, so framing at mount frames
 * nothing; and re-framing on later changes would drag the camera out from
 * under someone every time a collaborator dropped a shape off-screen. So it
 * waits for the first content and then stands down for the life of the room.
 *
 * ## Why not restore where you were last time
 *
 * It was the other candidate and it is a worse default. A remembered viewport
 * is only right while the board is unchanged — come back to one a colleague
 * has reorganised and it restores you to a rectangle that is now empty, which
 * is the bug above wearing a different hat. Fit is the pose that is correct
 * for whatever the board turned out to become. Per-room memory would be a good
 * *addition* later, layered on top with a fit as its fallback.
 */
export function useOpeningFrame(roomId: string | undefined): void {
  const framed = useRef<string | null>(null);

  useEffect(() => {
    if (!roomId) return;
    // Keyed by room, so navigating between boards frames each one — the whole
    // point, given the camera is what carried across.
    if (framed.current === roomId) return;
    framed.current = null;

    let cancelled = false;
    let stop = () => {};
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const performFit = () => {
      if (cancelled || framed.current === roomId) return;
      if (!cameraSystem.measured) return;

      const bounds = editor.contentBounds();
      if (!bounds) return;

      // Mark framed and detach listeners BEFORE calling zoomToFit, so
      // CameraChanged emitted by zoomToFit cannot re-trigger anything.
      framed.current = roomId;
      stop();

      editor.zoomToFit();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('boardArriving'));
      }
    };

    const attempt = (immediate = false) => {
      if (cancelled || framed.current === roomId) return;
      if (!cameraSystem.measured) return;

      const bounds = editor.contentBounds();
      if (!bounds) return;

      if (immediate) {
        performFit();
        return;
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        performFit();
      }, 75);
    };

    const onScene = () => attempt(false);
    const WATCH = ['VisibleSetUpdated', 'ObjectAdded', 'CameraChanged'] as const;
    for (const event of WATCH) engineEvents.on(event, onScene);

    const onUserInteraction = () => {
      // Stand down immediately if user starts interacting manually
      framed.current = roomId;
      stop();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', onUserInteraction, { passive: true, capture: true });
      window.addEventListener('wheel', onUserInteraction, { passive: true, capture: true });
    }

    stop = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      for (const event of WATCH) engineEvents.off(event, onScene);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', onUserInteraction);
        window.removeEventListener('wheel', onUserInteraction);
      }
    };

    // If content is already present and viewport is measured on mount, frame immediately
    if (editor.contentBounds() && cameraSystem.measured) {
      attempt(true);
    }

    const settle = setTimeout(() => {
      if (cancelled || framed.current === roomId) return;
      if (!editor.contentBounds()) {
        framed.current = roomId;
        stop();
        cameraSystem.setPose(0, 0, 1);
      } else {
        performFit();
      }
    }, 2500);

    return () => {
      cancelled = true;
      clearTimeout(settle);
      stop();
    };
  }, [roomId]);
}
