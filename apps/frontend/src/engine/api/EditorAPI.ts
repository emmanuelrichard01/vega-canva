import { commandManager, CreateNodeCommand, UpdateNodeCommand, DeleteNodeCommand } from '../services/CommandManager';
import { sceneGraph } from '../SceneGraph';
import type { AnyNode } from '../model/schema';
import { nanoid } from 'nanoid';
import { provider, type NewNodeInput } from '../document';
import { cameraSystem } from '../CameraSystem';
import { engineEvents } from '../EventBus';

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

  zoomToFit() {
    // Basic implementation: find bounds of all root nodes and set camera
    const allBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    sceneGraph.nodes.forEach(node => {
      const b = sceneGraph.getNodeBounds(node);
      if (b.minX < allBounds.minX) allBounds.minX = b.minX;
      if (b.minY < allBounds.minY) allBounds.minY = b.minY;
      if (b.maxX > allBounds.maxX) allBounds.maxX = b.maxX;
      if (b.maxY > allBounds.maxY) allBounds.maxY = b.maxY;
    });

    if (allBounds.minX === Infinity) return; // Empty scene

    const w = allBounds.maxX - allBounds.minX;
    const h = allBounds.maxY - allBounds.minY;
    
    // Simplistic zoom to fit
    cameraSystem.x = -allBounds.minX + 50;
    cameraSystem.y = -allBounds.minY + 50;
    cameraSystem.zoom = Math.min(window.innerWidth / (w + 100), window.innerHeight / (h + 100));
    
    // Static import, and emitted synchronously with the camera write above.
    // This was a dynamic `import()`, which bought no code splitting — six
    // other modules import EventBus statically, so the chunk is already in
    // the graph and the bundler said so — and cost correctness: the camera
    // moved now while `CameraChanged` fired a microtask later, so anything
    // reading the camera in that gap saw the new position with no notice
    // that it had changed.
    engineEvents.emit('CameraChanged', cameraSystem);
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
