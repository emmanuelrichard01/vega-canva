import React, { useRef, useCallback } from 'react';
import { notify, type NoticeTone } from '../engine/ui/notices';

/**
 * What a copy actually took.
 *
 * The ids matter because **cut must delete exactly what it copied**, and the
 * two sets are not the same: `writeClipboard` refuses comments, so a cut of a
 * selection containing one used to copy everything else and then delete the
 * comment along with it. A pin destroyed by a gesture that claimed to have put
 * it on the clipboard is the worst kind of data loss — silent, and discovered
 * only when the paste comes back short.
 */
export interface CopyResult {
  written: boolean;
  ids: string[];
}
import { nanoid } from 'nanoid';
import type { AnyNode } from '../engine/model/schema';
import {
  pasteNodes,
  pasteOrigin,
  writeClipboard,
  type ClipboardPayload,
} from '../engine/clipboard/clipboard';
import { importSvg } from '../engine/clipboard/svgImport';
import { createPastedTextNode } from '../engine/clipboard/externalText';
import { cameraSystem } from '../engine/CameraSystem';
import { doc, applyGroupPlan } from '../engine/document';
import { editor } from '../engine/api/EditorAPI';
import { useStore } from './useStore';

export interface UseRoomClipboardOptions {
  diagramObjects: Record<string, AnyNode>;
  selectionRef: React.MutableRefObject<string[]>;
  setSelectedIds: (ids: string[]) => void;
}

export function useRoomClipboard({
  diagramObjects,
  selectionRef,
  setSelectedIds,
}: UseRoomClipboardOptions) {
  /**
   * A short, self-clearing confirmation.
   *
   * Paste is the one gesture in this app whose result can be off screen — an
   * SVG converts to twelve objects, or to nine with the text left out, and
   * without a word about it the difference between "worked" and "partly
   * worked" is something you have to go and check. `role="status"` so it is
   * announced as well as shown.
   */
  /**
   * One line into the shared notice stack.
   *
   * This used to own a piece of state and a timer, which made it the *third*
   * place in the app that could put a sentence on screen, with its own
   * geometry and its own three-second rule for everything including errors.
   * `engine/ui/notices.ts` owns all of that now — including the fact that an
   * error should not disappear on a timer — so this is only the shorthand the
   * existing callers already say.
   */
  const showToast = useCallback((message: string, tone?: NoticeTone) => {
    notify(tone ? { message, tone } : message);
  }, []);

  /** The last copy, so the menu can say whether there is anything to paste. */
  const clipboardRef = useRef<ClipboardPayload | null>(null);

  /**
   * Copy, paste and SVG paste — one implementation, reached three ways.
   *
   * The keyboard, the right-click menu and the object toolbar all end up here.
   */
  const copySelection = useCallback(
    (event?: ClipboardEvent): CopyResult => {
      const nodes = selectionRef.current
        .map((id) => diagramObjects[id])
        .filter(Boolean) as AnyNode[];
      const payload = writeClipboard(nodes);
      if (!payload) return { written: false, ids: [] };

      clipboardRef.current = payload;
      const text = JSON.stringify(payload);

      /**
       * Inside a real `copy` event, write through the event.
       *
       * This used to call `navigator.clipboard.writeText` while the handler
       * also called `preventDefault()`, which is a combination that cannot be
       * relied on. `preventDefault` tells the browser to put nothing on the
       * clipboard, and the async write then races to fill the gap from outside
       * the gesture — needing a permission the synchronous path never needs,
       * and rejecting outright in browsers that require the write to happen
       * inside the user gesture. Its failure went into a bare `.catch(() => {})`,
       * so the visible result was a Ctrl+C that silently did nothing and a
       * Ctrl+V that pasted whatever had been on the clipboard beforehand.
       *
       * `setData` is what `preventDefault` exists to be paired with: it is
       * synchronous, it needs no permission, and it cannot half-succeed.
       */
      if (event?.clipboardData) {
        event.clipboardData.setData('text/plain', text);
        return { written: true, ids: payload.nodes.map((n) => String(n.id)) };
      }

      /**
       * A menu or toolbar press has no event to write into, so the async API is
       * the only route — and this time its failure is reported rather than
       * swallowed. The in-memory copy still works, so this is a warning about
       * what will not work (another tab), not an error about what just failed.
       */
      void navigator.clipboard?.writeText?.(text).catch(() => {
        notify({
          message: 'Copied here, but not to the system clipboard — pasting into another tab will not work',
          tone: 'warning',
        });
      });
      return { written: true, ids: payload.nodes.map((n) => String(n.id)) };
    },
    [diagramObjects, selectionRef]
  );

  /** Where a paste lands when nothing more specific says otherwise. */
  const viewportCentre = useCallback(
    () => cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2),
    []
  );

  const pasteObjects = useCallback(
    (payload: ClipboardPayload, at?: { x: number; y: number }) => {
      /**
       * With no pointer behind it, a paste lands beside the original when the
       * original is on screen and in the middle of the view when it is not.
       * `pasteOrigin` owns that rule and says why; the viewport is measured
       * here because only this layer knows where the camera is.
       */
      const topLeft = cameraSystem.screenToWorld(0, 0);
      const bottomRight = cameraSystem.screenToWorld(window.innerWidth, window.innerHeight);
      const target =
        at ??
        pasteOrigin(payload, {
          x: topLeft.x,
          y: topLeft.y,
          width: bottomRight.x - topLeft.x,
          height: bottomRight.y - topLeft.y,
        });
      const { nodes, ids, groups } = pasteNodes(payload, target, useStore.getState().groups);
      if (nodes.length === 0) return;
      doc.transact(() => {
        for (const record of groups) {
          applyGroupPlan({ nodes: [], groups: [], create: record, remove: [] });
        }
        nodes.forEach((node) => editor.createNode(node as never));
      });
      setSelectedIds(ids);
      showToast(`Pasted ${ids.length} object${ids.length === 1 ? '' : 's'}`);
    },
    [setSelectedIds, showToast]
  );

  const pasteSvg = useCallback(
    (text: string) => {
      const art = importSvg(text);
      if (!art) {
        showToast('That SVG could not be read');
        return;
      }
      const centre = viewportCentre();
      const originX = centre.x - art.width / 2;
      const originY = centre.y - art.height / 2;

      const made: string[] = [];
      doc.transact(() => {
        art.nodes.forEach((node) => {
          const id = nanoid();
          made.push(id);
          editor.createNode({
            ...node,
            id,
            x: (node.x as number) + originX,
            y: (node.y as number) + originY,
          } as never);
        });
      });
      setSelectedIds(made);

      const noun = `${made.length} object${made.length === 1 ? '' : 's'}`;
      showToast(
        art.skipped.length > 0
          ? `Pasted ${noun}. Not converted: ${art.skipped.join(', ')}`
          : `Pasted ${noun} from SVG`
      );
    },
    [setSelectedIds, showToast, viewportCentre]
  );

  const pasteText = useCallback(
    (rawText: string, at?: { x: number; y: number }) => {
      const centre = at ?? viewportCentre();
      const node = createPastedTextNode(rawText, centre);
      if (!node) return;
      editor.createNode(node as never);
      setSelectedIds([node.id]);
      showToast('Pasted text');
    },
    [setSelectedIds, showToast, viewportCentre]
  );

  return {
    showToast,
    clipboardRef,
    copySelection,
    pasteObjects,
    pasteSvg,
    pasteText,
    viewportCentre,
  };
}
