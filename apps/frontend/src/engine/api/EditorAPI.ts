import { commandManager, CreateNodeCommand, UpdateNodeCommand, DeleteNodeCommand } from '../services/CommandManager';
import { sceneGraph } from '../SceneGraph';
import type { AnyNode } from '../model/schema';
import { nanoid } from 'nanoid';
import { provider, type NewNodeInput } from '../document';
import { cameraSystem } from '../CameraSystem';
import { fitPose, type FitBounds } from '../cameraFit';

/**
 * The world box every visible node occupies, or `null` on an empty board.
 *
 * Hidden nodes are excluded for the same reason the exporter excludes them:
 * framing to something nobody can see strands the visible work in a corner.
 */
function sceneBounds(): FitBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  sceneGraph.nodes.forEach((node) => {
    if (node.hidden) return;
    const b = sceneGraph.getNodeBounds(node);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  });

  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export class EditorAPI {
  // --- Document Mutations --- //

  /**
   * Create a node and return the id the document assigned it.
   *
   * Callers may supply an `id` (tools do, so they can select the node they
   * just made) but must not supply `zIndex`, `createdAt`, `updatedAt` or
   * `createdBy` — the document layer stamps those, which is what guarantees
   * new objects actually land on top of the stack instead of every node in
   * the room sharing z-index 0.
   */
  createNode(node: NewNodeInput): string {
    const command = new CreateNodeCommand(node);
    commandManager.execute(command);
    return command.createdId ?? node.id ?? '';
  }

  updateNode(id: string, updates: Partial<AnyNode>) {
    commandManager.execute(new UpdateNodeCommand(id, updates as Record<string, unknown>));
  }

  deleteNode(id: string) {
    commandManager.execute(new DeleteNodeCommand(id));
  }

  // A group is its members sharing one synthetic `parentId` — the schema
  // already reserves this field for "Frames and Groups" and SceneGraph
  // already maintains a parentId-keyed hierarchy, but nothing ever actually
  // set it. (The previous implementation created a Command whose execute()
  // body was entirely commented out — `groupNodes()` looked wired up
  // end-to-end but silently did nothing at all.) No group node needs to
  // exist in objectsMap; this also piggybacks on the existing multi-select
  // machinery for free — selecting any member re-selects the whole group,
  // and dragging one drags all of them together.
  groupNodes(childIds: string[]): string | null {
    if (childIds.length < 2) return null;
    const groupId = nanoid();
    childIds.forEach(id => {
      commandManager.execute(new UpdateNodeCommand(id, { parentId: groupId }));
    });
    return groupId;
  }

  ungroupNodes(childIds: string[]) {
    childIds.forEach(id => {
      commandManager.execute(new UpdateNodeCommand(id, { parentId: undefined }));
    });
  }

  // --- Selection & Presence --- //
  
  select(id: string | null) {
    // Canvas.tsx owns the actual selection state and already broadcasts it to
    // awareness as `selection` on every change (click, marquee, tool-created
    // node). Dispatching the same event Canvas listens for elsewhere
    // (requestSelectNode) is what makes a tool's "auto-select the node I just
    // created" actually show selection handles / the properties panel —
    // writing a standalone `activeSelectionId` awareness field here did not,
    // since nothing that renders local selection ever read it.
    document.dispatchEvent(new CustomEvent('requestSelectNode', { detail: { id } }));
  }

  setEditingMode(nodeId: string | null, mode: string | null = null) {
    if (nodeId) {
      const node = sceneGraph.nodes.get(nodeId);
      const actionText = mode === 'recording' ? '🎤 Recording Audio' : `✏️ Editing ${node ? node.type.charAt(0).toUpperCase() + node.type.slice(1) : 'Object'}`;
      provider.awareness?.setLocalStateField("editing", { objectId: nodeId, mode, actionText });
    } else {
      provider.awareness?.setLocalStateField("editing", null);
    }
  }

  // --- Camera & Viewport --- //

  /**
   * Frame everything on the board.
   *
   * The arithmetic is `cameraFit.fitPose`, which exists because the version
   * that used to live here was wrong in three ways at once: it assigned a
   * *world* offset to a field the renderer multiplies by the zoom, it measured
   * `window.innerWidth` rather than the canvas the board is actually drawn in,
   * and it anchored the content to a corner instead of centring it. The first
   * of those meant that any fit which genuinely had to zoom put the content
   * off screen — the further from 1:1, the further off.
   *
   * `setPose` rather than three field writes: it clamps, and it emits one
   * `CameraChanged` instead of leaving the emit to be remembered separately.
   */
  zoomToFit() {
    const bounds = sceneBounds();
    if (!bounds) return; // Empty scene

    const pose = fitPose(bounds, cameraSystem.width, cameraSystem.height, {
      ...cameraSystem.zoomLimits,
    });
    if (pose) cameraSystem.setPose(pose.x, pose.y, pose.zoom);
  }

  // --- Utilities --- //
  
  undo() {
    commandManager.undo();
  }

  redo() {
    commandManager.redo();
  }
}

export const editor = new EditorAPI();
