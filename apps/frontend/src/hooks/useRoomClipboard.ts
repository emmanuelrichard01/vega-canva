import React, { useRef, useCallback } from 'react';
import { notify, type NoticeTone } from '../engine/ui/notices';
import { nanoid } from 'nanoid';
import type { AnyNode } from '../engine/model/schema';
import {
  offsetOrigin,
  pasteNodes,
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
  const copySelection = useCallback((): boolean => {
    const nodes = selectionRef.current
      .map((id) => diagramObjects[id])
      .filter(Boolean) as AnyNode[];
    const payload = writeClipboard(nodes);
    if (!payload) return false;

    clipboardRef.current = payload;
    /**
     * Written to the real clipboard as well as remembered here.
     */
    void navigator.clipboard?.writeText?.(JSON.stringify(payload)).catch(() => {});
    return true;
  }, [diagramObjects, selectionRef]);

  /** Where a paste lands when nothing more specific says otherwise. */
  const viewportCentre = useCallback(
    () => cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2),
    []
  );

  const pasteObjects = useCallback(
    (payload: ClipboardPayload, at?: { x: number; y: number }) => {
      const target = at ?? offsetOrigin(payload);
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
