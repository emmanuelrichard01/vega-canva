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

    /** Declared before `attempt`, which calls it. */
    let stop = () => {};

    const attempt = () => {
      if (cancelled || framed.current === roomId) return;
      // The viewport has to be real. `width`/`height` default to 800x600,
      // which would otherwise be framed against as though it were a window.
      if (!cameraSystem.measured) return;

      const bounds = editor.contentBounds();
      if (!bounds) return; // Nothing yet — an empty board, or still loading.

      /**
       * Stand down *before* moving the camera, not after.
       *
       * `setPose` emits `CameraChanged` synchronously, and this listens for
       * `CameraChanged` — so fitting from inside the handler re-entered this
       * function before the "done" flag was set, fitted again, and recursed
       * until the stack blew. The camera never ended up fitted at all, which
       * is how a re-entrancy bug disguises itself as a feature that does
       * nothing.
       *
       * Marking done first makes the re-entrant call a no-op, and removing the
       * listeners first means there is no re-entrant call to make.
       */
      framed.current = roomId;
      stop();
      editor.zoomToFit();
    };

    /**
     * Content can arrive before this mounts or long after it, and it does not
     * announce itself — so both edges are covered: try now, and try again on
     * every scene change until one of them has something to frame.
     */
    const onScene = () => attempt();
    // `VisibleSetUpdated` is the one that fires once the scene graph has
    // actually processed what arrived; `ObjectAdded` catches the first node on
    // a board being created here rather than loaded; `CameraChanged` covers
    // the case where the content was already there and only the *viewport*
    // was still missing.
    const WATCH = ['VisibleSetUpdated', 'ObjectAdded', 'CameraChanged'] as const;
    for (const event of WATCH) engineEvents.on(event, onScene);

    stop = () => {
      for (const event of WATCH) engineEvents.off(event, onScene);
    };

    attempt();

    /**
     * The empty-board case, which has no first content to wait for.
     *
     * Left alone it would leave the listeners armed for the life of the room,
     * and the first object anyone drew would then yank the camera to frame it.
     * So after a grace period long enough for a document to load, an empty
     * board is put at the origin and the framing is considered done.
     */
    const settle = setTimeout(() => {
      if (cancelled || framed.current === roomId) return;
      if (!editor.contentBounds()) {
        // Same order, for the same reason: `setPose` emits into the listeners
        // this is about to remove.
        framed.current = roomId;
        stop();
        cameraSystem.setPose(0, 0, 1);
      }
    }, 2500);

    return () => {
      cancelled = true;
      clearTimeout(settle);
      stop();
    };
  }, [roomId]);
}
