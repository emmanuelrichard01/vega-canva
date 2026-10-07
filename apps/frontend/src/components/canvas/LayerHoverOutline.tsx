import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { Group, Rect } from 'react-konva';
import type Konva from 'konva';
import { layerHover } from '../../engine/interaction/layerHover';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../hooks/useStore';
import { useCameraZoom } from '../../engine/useCameraZoom';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import type { AnyNode } from '../../engine/model/schema';

const EMPTY: readonly string[] = [];

/** Ink at half strength, the hover language of the board. */
function hoverInk(): string {
  if (typeof document === 'undefined') return 'rgba(17, 24, 39, 0.5)';
  return document.body.classList.contains('dark-theme') ? 'rgba(250, 250, 250, 0.55)' : 'rgba(17, 24, 39, 0.5)';
}

/** The nearest Konva ancestor (or self) whose id is an object on the board. */
function objectIdAt(target: Konva.Node | null, objects: Record<string, AnyNode>): string | null {
  let node: Konva.Node | null = target;
  while (node) {
    const id = node.id();
    if (id && objects[id]) return id;
    node = node.getParent();
  }
  return null;
}

/**
 * Both directions of the Layers hover link.
 *
 * - A row hovered (or reached by the tree's keyboard cursor) outlines its
 *   object here, drawn with the object's own rotation and size, at 1px on
 *   screen, in the chrome layer and never exported. A group row outlines
 *   every member.
 * - An object hovered on the board is published back, so its row lights up.
 */
export const LayerHoverOutline: React.FC = () => {
  const hover = useSyncExternalStore(layerHover.subscribe, layerHover.getSnapshot, layerHover.getSnapshot);
  const ids = hover?.source === 'panel' ? hover.ids : EMPTY;
  // Only the hovered objects, so an edit elsewhere on the board does not re-render this.
  const hovered = useStore(useShallow((s) => ids.map((id) => s.objects[id])));
  const zoom = useCameraZoom();
  const groupRef = useRef<Konva.Group>(null);

  useEffect(() => {
    const stage = groupRef.current?.getStage();
    if (!stage) return;
    const over = (e: Konva.KonvaEventObject<MouseEvent>) =>
      layerHover.setFromCanvas(objectIdAt(e.target, useStore.getState().objects));
    const out = () => layerHover.setFromCanvas(null);
    stage.on('mouseover.layerhover', over);
    stage.on('mouseleave.layerhover', out);
    return () => {
      stage.off('mouseover.layerhover');
      stage.off('mouseleave.layerhover');
      layerHover.setFromCanvas(null);
    };
  }, []);

  const shown = hovered.filter((n): n is AnyNode => Boolean(n) && !n.hidden);
  const ink = hoverInk();
  const pad = 2 / zoom;

  return (
    <Group ref={groupRef} name={EXPORT_CHROME} listening={false}>
      {shown.map((node) => {
        const w = node.width * Math.abs(node.scaleX || 1);
        const h = node.height * Math.abs(node.scaleY || 1);
        return (
          <Rect
            key={node.id}
            x={node.x + w / 2}
            y={node.y + h / 2}
            offsetX={w / 2 + pad}
            offsetY={h / 2 + pad}
            width={w + pad * 2}
            height={h + pad * 2}
            rotation={node.rotation || 0}
            stroke={ink}
            strokeWidth={1 / zoom}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })}
    </Group>
  );
};
