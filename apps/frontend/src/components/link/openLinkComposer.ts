import type { LinkNode } from '../../engine/model/schema';
import { cameraSystem } from '../../engine/CameraSystem';
import { useStore } from '../../hooks/useStore';

/**
 * Open the link composer to change the address of an existing card.
 *
 * It opens just under the card on screen — under the rail instead when the
 * rail is showing, so the form never covers the controls that opened it — and
 * the card keeps its place: a new address changes what the card says, not
 * where it sits.
 */
export function openLinkComposerFor(node: LinkNode): void {
  const zoom = cameraSystem.zoom || 1;
  const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
  const rail = document.querySelector('.ctx-toolbar')?.getBoundingClientRect();
  const cardBottom = (stage?.top ?? 0) + (node.y + node.height) * zoom + cameraSystem.y;
  const cardCentre = (stage?.left ?? 0) + (node.x + node.width / 2) * zoom + cameraSystem.x;
  const railBelow = rail && rail.top >= cardBottom - 1;
  useStore.getState().setLinkComposer({
    clientX: railBelow ? rail.left + rail.width / 2 : cardCentre,
    clientY: Math.min(railBelow ? rail.bottom : cardBottom + 8, window.innerHeight - 120),
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
    replaceId: node.id,
  });
}
