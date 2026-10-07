import { useEffect } from 'react';
import { isPresenting } from '../../engine/tools/presenting';
import type React from 'react';
import { useStore } from '../../hooks/useStore';
import { applyNodePatches, updateNode } from '../../engine/document';
import { editor } from '../../engine/api/EditorAPI';
import { keyBelongsToFocus } from '../../engine/interaction/keyTarget';
import { lineEdit } from '../../engine/interaction/lineEdit';
import { deletePickedVertex } from '../../engine/interaction/lineVertexActions';
import { deleteNodesWithFrames } from '../../engine/interaction/frameMembership';
import { activateLink } from '../../engine/link/linkApply';
import { isLineLike } from '../../engine/model/lineEnds';
import { DEFAULT_TYPOGRAPHY, type ShapeNode } from '../../engine/model/schema';
import { nudgeDelta } from '../../engine/tools/nudge';
import { nudgeSlotFocus } from '../../engine/grid/gridSlotApply';

/**
 * The canvas's selection shortcuts: delete, group, nudge, the text styles,
 * and Enter to open the selected object.
 *
 * Every key passes the shared focus guard first, so none of these act while a
 * field, a select or a dialog has the keyboard.
 */
export function useCanvasShortcuts({
  selectedIds,
  setSelectedIds,
  canEditRef,
}: {
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  canEditRef: React.MutableRefObject<boolean>;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPresenting()) return;
      if (keyBelongsToFocus(e.key)) return;
      // Viewing history is read-only. The canvas is showing a past state while
      // the live document sits untouched behind it, so Delete or Cmd+D here
      // would edit objects the user cannot currently see. Read through
      // getState() rather than subscribing: this is an event-time question, and
      // a dependency would re-register the listener on every replay frame.
      if (useStore.getState().isReplaying) return;
      /**
       * View mode is the other read-only canvas, and it stands down here for
       * the same reason.
       *
       * Every key past this point mutates: Delete, Cmd+D, the arrow nudges,
       * the restack pair. Leaving them bound while the dock is gated would be
       * the classic half-disabled control -- the button greyed out and the
       * shortcut still live -- and on a board whose edits do not sync it would
       * be work thrown away silently.
       */
      if (!canEditRef.current) return;
      if (selectedIds.length === 0) return;

      /**
       * The line editor takes the keys that mean something to it, first.
       *
       * All three of these already meant something on the canvas, and in the
       * editor they mean the narrower thing — which is the rule every modal
       * surface here follows. `Escape` leaves the editor rather than clearing
       * the selection, so backing out of a mode does not also lose the object
       * you were working on. `Delete` removes the picked *vertex* rather than
       * the whole line, and falls through when there is no vertex picked or
       * when the line is down to its last two, so the key never silently does
       * nothing.
       */
      const editingLine = lineEdit.getSnapshot();
      if (editingLine) {
        const line = useStore.getState().objects[editingLine.nodeId] as ShapeNode | undefined;
        if (e.key === 'Escape') {
          e.preventDefault();
          lineEdit.end();
          return;
        }
        if ((e.key === 'Backspace' || e.key === 'Delete') && line) {
          if (deletePickedVertex(line, editingLine.vertex)) {
            e.preventDefault();
            return;
          }
        }
      }

      /**
       * Enter, or Ctrl/Cmd+Enter, opens a line for editing.
       *
       * Both, because both are in people's hands: Excalidraw uses
       * Ctrl+Enter and plain Enter is what "open the selected thing" means
       * nearly everywhere else. Only for a solo line-like selection — with two
       * objects selected there is no single run to edit, and Enter has no other
       * meaning there to displace.
       */
      if (e.key === 'Enter' && selectedIds.length === 1) {
        const only = useStore.getState().objects[selectedIds[0]];
        if (only && isLineLike(only) && !only.locked) {
          e.preventDefault();
          lineEdit.begin(only.id);
          return;
        }
        // Enter opens what double-click opens: the code editor, or the link.
        if (only?.type === 'code' && !only.locked) {
          e.preventDefault();
          useStore.getState().setCodeEditNodeId(only.id);
          return;
        }
        if (only?.type === 'link') {
          e.preventDefault();
          activateLink(only);
          return;
        }
      }

      if (e.key === 'Escape') {
        setSelectedIds([]);
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        // Through the frame-aware path: deleting a frame has to take its
        // contents, or they are stranded in place still pointing at it.
        deleteNodesWithFrames(selectedIds);
        setSelectedIds([]);
        return;
      }
      // Duplicate and the four restacks are bound in `useSelectionCommandKeys`,
      // to the same actions the menu runs. The copies that lived here cloned
      // connectors still bound to the originals and stepped `zIndex` by one
      // past ties -- see that hook.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        editor.ungroupNodes(selectedIds);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        editor.groupNodes(selectedIds);
        return;
      }

      /**
       * Nudge with the arrow keys.
       *
       * Three other components bind arrows — the Layers tree moves its cursor,
       * the minimap pans, the replay bar steps through history — and all three
       * are React handlers on a focused element, so their events bubble up to
       * this window listener too. Nudging is what the *board* means by an
       * arrow, so it only applies when the board is what has focus.
       *
       * Locked objects are skipped rather than the whole press being refused:
       * a selection that happens to include a pinned background should still
       * move everything else.
       */
      const delta = nudgeDelta(e.key, e.shiftKey);
      if (delta) {
        const objects = useStore.getState().objects;
        const movable = selectedIds
          .map((id) => objects[id])
          .filter((o): o is NonNullable<typeof o> => Boolean(o) && !(o as any).locked);

        /**
         * A picture in a grid module is nudged *inside* its module.
         *
         * Its box belongs to the grid, so moving it is not something an arrow
         * key can do — the reflow would put it straight back and the press
         * would appear to be swallowed, which is the dead-capability shape this
         * codebase keeps finding. What the gesture plainly means for a picture
         * in a frame is "move the picture within the frame", so that is what it
         * does: the object stays put and the content slides under it.
         *
         * Split rather than branched per object so a mixed selection still does
         * the right thing for each half in one transaction and one undo step.
         * `nudgeSlotFocus` returns nothing for a picture with no room to travel
         * — a module its source already fits exactly — which is why an empty
         * result here is not the same as "no slotted pictures were selected".
         */
        const slotted = movable.filter((o) => 'gridSlot' in o && o.gridSlot);
        const loose = movable.filter((o) => !('gridSlot' in o && o.gridSlot));

        const patches = [
          ...loose.map((o) => ({ id: o.id, changes: { x: o.x + delta.dx, y: o.y + delta.dy } })),
          ...nudgeSlotFocus(slotted.map((o) => o.id), delta.dx, delta.dy),
        ];
        // Still swallow the press when the only thing selected is content that
        // cannot travel any further: the alternative is the arrow escaping to
        // the page and scrolling the board out from under a pinned picture.
        if (patches.length === 0) {
          if (slotted.length > 0) e.preventDefault();
          return;
        }
        e.preventDefault();
        // One transaction, so a nudge is one press to undo however many
        // objects moved.
        applyNodePatches(patches);
        return;
      }

      // Everything below only makes sense for exactly one selected object.
      if (selectedIds.length !== 1) return;
      // Narrow to the sole id here rather than closing over a value derived up
      // in the component body. Identical result, but the dependency list can be
      // checked statically instead of resting on a reader noticing that the
      // outer value was a function of `selectedIds` all along.
      const soleId = selectedIds[0];
      const obj = useStore.getState().objects[soleId];
      if (!obj) return;

      // Typography lives in one canonical place now, so Cmd+B/I/U and the
      // Properties panel write the same fields — previously the shortcuts
      // wrote content.fontWeight/fontStyle/textDecoration while the renderer
      // read a different set, so none of the three had any visible effect.
      const styled = obj.type === 'text' || obj.type === 'shape' || obj.type === 'sticky';
      if (styled && (e.metaKey || e.ctrlKey) && 'biu'.includes(e.key.toLowerCase())) {
        const typography = (obj as any).typography ?? DEFAULT_TYPOGRAPHY;
        e.preventDefault();
        if (e.key.toLowerCase() === 'b') {
          updateNode(soleId, {
            typography: { ...typography, fontWeight: typography.fontWeight >= 600 ? 400 : 700 },
          });
        } else if (e.key.toLowerCase() === 'i') {
          updateNode(soleId, { typography: { ...typography, italic: !typography.italic } });
        } else {
          updateNode(soleId, { typography: { ...typography, underline: !typography.underline } });
        }
        return;
      }
      if (e.key === 'Enter') {
        if (obj.type === 'text' || obj.type === 'sticky' || obj.type === 'comment') {
          e.preventDefault();
          // We can't directly trigger isEditing inside ObjectRenderer from Canvas easily without an event or ref.
          // But since ObjectRenderer listens to global clicks, we can dispatch an event to the document that ObjectRenderer can catch.
          // For now we'll fire a custom event that ObjectRenderer can listen to.
          document.dispatchEvent(new CustomEvent('requestEditNode', { detail: { id: soleId } }));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, setSelectedIds, canEditRef]);
}
