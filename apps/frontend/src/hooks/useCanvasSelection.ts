import { useCallback, useEffect, useRef } from 'react';
import { useStore } from './useStore';
import { canSelectWith, opensPathWith } from '../engine/tools/shortcuts';
import { DirectSelectTool } from '../engine/tools/DirectSelectTool';
import { pathEdit } from '../engine/interaction/pathEdit';
import { groupToEnter, nodesInGroup, selectionWithin } from '../engine/model/groupTree';
import { anchorNear } from '../engine/model/pathEditing';
import { cameraSystem } from '../engine/CameraSystem';

export interface CanvasSelectionOptions {
  activeTool: string;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
}

export function useCanvasSelection({
  activeTool,
  selectedIds,
  setSelectedIds,
}: CanvasSelectionOptions) {
  const enteredGroupRef = useRef<string | null>(null);

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
      const additive = Boolean(d.additive);

      const storeObjects = Object.values(useStore.getState().objects);
      const found = storeObjects
        .filter((obj) => {
          if (!obj || obj.locked || (obj as any).hidden) return false;
          const w = obj.width || 0;
          const h = obj.height || 0;
          return (
            obj.x < maxX &&
            obj.x + w > minX &&
            obj.y < maxY &&
            obj.y + h > minY
          );
        })
        .map((obj) => obj.id);

      if (additive) {
        setSelectedIds((prev) => Array.from(new Set([...prev, ...found])));
      } else {
        setSelectedIds(found);
      }
    };

    document.addEventListener('requestSelectNode', handleSelectNode);
    document.addEventListener('selectNode', handleSelectNode);
    window.addEventListener('requestSelectNodes', handleSelectNodes);
    document.addEventListener('marqueeSelect', handleMarqueeSelect);

    return () => {
      document.removeEventListener('requestSelectNode', handleSelectNode);
      document.removeEventListener('selectNode', handleSelectNode);
      window.removeEventListener('requestSelectNodes', handleSelectNodes);
      document.removeEventListener('marqueeSelect', handleMarqueeSelect);
    };
  }, [setSelectedIds]);

  const handleObjectSelect = useCallback(
    (id: string, e?: any) => {
      if (!canSelectWith(activeTool)) return;
      const isAdditive = Boolean(e?.evt?.shiftKey || e?.evt?.ctrlKey || e?.evt?.metaKey);

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

      const { objects, groups } = useStore.getState();

      // Double-click steps one level into nested group
      const table = objects as Record<string, { id: string; parentId?: string }>;
      if (e?.evt?.detail === 2) {
        const step = groupToEnter(table, groups, id, enteredGroupRef.current);
        if (step) enteredGroupRef.current = step;
      } else if (
        enteredGroupRef.current &&
        !nodesInGroup(Object.keys(objects), table, groups, enteredGroupRef.current).includes(id)
      ) {
        enteredGroupRef.current = null;
      }

      const groupIds = selectionWithin(
        Object.keys(objects),
        table,
        groups,
        id,
        enteredGroupRef.current
      );

      if (isAdditive) {
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
