import { useCallback, useEffect, useRef } from 'react';
import { useStore } from './useStore';
import { canSelectWith, opensPathWith } from '../engine/tools/shortcuts';
import { DirectSelectTool } from '../engine/tools/DirectSelectTool';
import { pathEdit } from '../engine/interaction/pathEdit';
import { groupToEnter, nodesInGroup, selectionWithin } from '../engine/model/groupTree';
import { anchorNear } from '../engine/model/pathEditing';
import { cameraSystem } from '../engine/CameraSystem';
import { applyMarquee, expandToUnits, marqueeHits, type MarqueeMode } from '../engine/interaction/marquee';
import { nextBehind, stackAt } from '../engine/interaction/pick';
import { selectSimilar, type SimilarKey } from '../engine/interaction/selectSimilar';
import { clientToWorld } from '../engine/interaction/clientToWorld';
import { travelledEnough } from '../engine/interaction/altDuplicate';

export interface CanvasSelectionOptions {
  activeTool: string;
  selectedIds?: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
}

type NodeTable = Record<string, { id: string; parentId?: string }>;

const MARQUEE_MODES: readonly MarqueeMode[] = ['replace', 'add', 'subtract', 'intersect'];

/**
 * How the select tools turn clicks and marquees into a selection.
 *
 * - **Click** selects the outermost group the object belongs to (or, inside an
 *   entered group, the next level down). Double-click steps one level in.
 * - **Shift+click** adds or removes that unit.
 * - **Ctrl/Cmd+click** is deep select: it reaches the object itself through
 *   any number of groups, as in Figma. With Shift as well, it toggles it.
 * - **Alt+click** selects the object behind the current one at that point;
 *   repeated Alt+clicks walk down the pile. An Alt+*drag* still duplicates,
 *   so the choice is made on release, by whether the pointer travelled.
 * - **Marquee** catches whole units too, and combines by mode: replace, add
 *   (Shift), subtract (Alt) or intersect (Shift+Alt).
 */
export function useCanvasSelection({
  activeTool,
  selectedIds,
  setSelectedIds,
}: CanvasSelectionOptions) {
  const enteredGroupRef = useRef<string | null>(null);
  /** The selection as of the last render, for gestures that compare against it. */
  const selectedRef = useRef<readonly string[]>(selectedIds ?? []);
  selectedRef.current = selectedIds ?? selectedRef.current;

  // Global event listeners for node selection and marquee
  useEffect(() => {
    const handleSelectNode = (e: any) => {
      const id = e.detail?.id ?? null;
      const additive = Boolean(e.detail?.additive);
      if (id) {
        if (additive) {
          setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
        } else {
          setSelectedIds([id]);
        }
      } else {
        setSelectedIds([]);
      }
    };

    const handleSelectNodes = (e: any) => {
      const ids = e.detail?.ids;
      if (Array.isArray(ids)) setSelectedIds(ids);
    };

    const handleMarqueeSelect = (e: any) => {
      const d = e.detail || {};
      const minX = d.minX !== undefined ? d.minX : (d.box ? d.box.x : 0);
      const minY = d.minY !== undefined ? d.minY : (d.box ? d.box.y : 0);
      const maxX = d.maxX !== undefined ? d.maxX : (d.box ? d.box.x + d.box.width : 0);
      const maxY = d.maxY !== undefined ? d.maxY : (d.box ? d.box.y + d.box.height : 0);
      const mode: MarqueeMode = MARQUEE_MODES.includes(d.mode) ? d.mode : d.additive ? 'add' : 'replace';

      const { objects, groups } = useStore.getState();
      const hits = marqueeHits(Object.values(objects), { minX, minY, maxX, maxY });
      // A marquee touching one member of a group catches the group, the same
      // unit a click on that member would select.
      const order = Object.keys(objects);
      const caught = expandToUnits(hits, (id) =>
        selectionWithin(order, objects as NodeTable, groups, id, enteredGroupRef.current)
      );

      setSelectedIds((prev) => applyMarquee(prev, caught, mode));
    };

    const handleSelectSimilar = (e: any) => {
      const key = e.detail?.key as SimilarKey | undefined;
      if (key !== 'type' && key !== 'fill' && key !== 'stroke' && key !== 'font') return;
      const { objects } = useStore.getState();
      setSelectedIds((prev) => selectSimilar(Object.values(objects), prev, key));
    };

    const handleExitGroup = () => {
      if (enteredGroupRef.current) {
        const { groups } = useStore.getState();
        const parent = groups[enteredGroupRef.current]?.parentId ?? null;
        enteredGroupRef.current = parent;
        useStore.getState().setEnteredGroupId(parent);
      }
    };

    const handleDeselectAll = () => {
      enteredGroupRef.current = null;
      useStore.getState().setEnteredGroupId(null);
    };

    document.addEventListener('requestSelectNode', handleSelectNode);
    document.addEventListener('selectNode', handleSelectNode);
    window.addEventListener('requestSelectNodes', handleSelectNodes);
    document.addEventListener('marqueeSelect', handleMarqueeSelect);
    window.addEventListener('requestSelectSimilar', handleSelectSimilar);
    window.addEventListener('exitGroupIsolation', handleExitGroup);
    document.addEventListener('exitGroupIsolation', handleExitGroup);
    document.addEventListener('deselectAll', handleDeselectAll);

    return () => {
      document.removeEventListener('requestSelectNode', handleSelectNode);
      document.removeEventListener('selectNode', handleSelectNode);
      window.removeEventListener('requestSelectNodes', handleSelectNodes);
      document.removeEventListener('marqueeSelect', handleMarqueeSelect);
      window.removeEventListener('requestSelectSimilar', handleSelectSimilar);
      window.removeEventListener('exitGroupIsolation', handleExitGroup);
      document.removeEventListener('exitGroupIsolation', handleExitGroup);
      document.removeEventListener('deselectAll', handleDeselectAll);
    };
  }, [setSelectedIds]);

  /**
   * Alt+click: decided on release, so an Alt+drag can still duplicate the
   * object that was pressed. Compared against the selection from *before* the
   * press, which is what "the next one down" is relative to.
   */
  const armSelectBehind = useCallback(
    (evt: MouseEvent | PointerEvent | undefined, before: readonly string[]) => {
      if (!evt || typeof window === 'undefined') return;
      const startX = evt.clientX;
      const startY = evt.clientY;
      const onUp = (up: PointerEvent | MouseEvent) => {
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('mouseup', onUp, true);
        if (travelledEnough(up.clientX - startX, up.clientY - startY, 1)) return;
        const world = clientToWorld(up.clientX, up.clientY);
        const { objects } = useStore.getState();
        const stack = stackAt(Object.values(objects), world.x, world.y, 2 / (cameraSystem.zoom || 1));
        const next = nextBehind(stack, before);
        if (next) setSelectedIds([next]);
      };
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('mouseup', onUp, true);
    },
    [setSelectedIds]
  );

  // Armed from a capture listener rather than from `handleObjectSelect`: a
  // press on an object that is already selected never reaches the click path,
  // and walking down from the selected object is the main use.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!canSelectWith(activeTool) || opensPathWith(activeTool)) return;
    const onDown = (evt: PointerEvent) => {
      if (!evt.altKey || evt.shiftKey || evt.ctrlKey || evt.metaKey || evt.button !== 0) return;
      const target = evt.target as Element | null;
      if (!target?.closest?.('.konvajs-content')) return;
      armSelectBehind(evt, selectedRef.current);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [activeTool, armSelectBehind]);

  const handleObjectSelect = useCallback(
    (id: string, e?: any) => {
      if (!canSelectWith(activeTool)) return;
      const evt = e?.evt as (MouseEvent & { detail?: number }) | undefined;
      const shift = Boolean(evt?.shiftKey);
      const deep = Boolean(evt?.ctrlKey || evt?.metaKey);
      const isAdditive = shift || deep;

      // Direct select opens path/shape for editing, or selects leaf node inside groups
      if (opensPathWith(activeTool)) {
        const openedId = DirectSelectTool.open(id);
        if (openedId) {
          setSelectedIds([openedId]);
          const node = useStore.getState().objects[openedId];
          if (node && node.type === 'path' && node.geometry.kind !== 'freehand' && e?.target) {
            const stage = e.target.getStage?.();
            if (stage) {
              const ptr = stage.getPointerPosition?.();
              if (ptr) {
                const worldX = (ptr.x - cameraSystem.x) / cameraSystem.zoom;
                const worldY = (ptr.y - cameraSystem.y) / cameraSystem.zoom;
                const localX = worldX - node.x;
                const localY = worldY - node.y;
                const near = anchorNear(node.geometry, { x: localX, y: localY }, 20 / cameraSystem.zoom);
                if (near) {
                  pathEdit.select([near]);
                }
              }
            }
          }
          return;
        }
        pathEdit.exit();
        // Direct-select targets the clicked leaf node directly without group encapsulation
        if (isAdditive) {
          setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
          );
        } else {
          setSelectedIds([id]);
        }
        return;
      }

      // Deep select: the object itself, through every group around it.
      if (deep) {
        if (shift) {
          setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
        } else {
          setSelectedIds([id]);
        }
        return;
      }

      const { objects, groups } = useStore.getState();

      // Double-click steps one level into nested group
      const table = objects as NodeTable;
      if (evt?.detail === 2) {
        const step = groupToEnter(table, groups, id, enteredGroupRef.current);
        if (step) {
          enteredGroupRef.current = step;
          useStore.getState().setEnteredGroupId(step);
        }
      } else if (
        enteredGroupRef.current &&
        !nodesInGroup(Object.keys(objects), table, groups, enteredGroupRef.current).includes(id)
      ) {
        enteredGroupRef.current = null;
        useStore.getState().setEnteredGroupId(null);
      }

      const groupIds = selectionWithin(
        Object.keys(objects),
        table,
        groups,
        id,
        enteredGroupRef.current
      );

      if (shift) {
        setSelectedIds((prev) => {
          const allIn = groupIds.every((gid) => prev.includes(gid));
          return allIn
            ? prev.filter((x) => !groupIds.includes(x))
            : Array.from(new Set([...prev, ...groupIds]));
        });
      } else {
        setSelectedIds(groupIds);
      }
    },
    [activeTool, setSelectedIds]
  );

  return {
    enteredGroupRef,
    handleObjectSelect,
  };
}
