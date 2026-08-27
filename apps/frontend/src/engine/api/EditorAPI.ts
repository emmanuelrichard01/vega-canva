import { commandManager, CreateNodeCommand, UpdateNodeCommand, DeleteNodeCommand } from '../services/CommandManager';
import { sceneGraph } from '../SceneGraph';
import type { AnyNode } from '../model/schema';
import { nanoid } from 'nanoid';
import { applyGroupPlan, provider, type NewNodeInput } from '../document';
import { planGroup, planUngroup, rootGroupOf } from '../model/groupTree';
import { useStore } from '../../hooks/useStore';
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

  /**
   * Group a selection, nesting rather than flattening.
   *
   * ## What changed, and why it had to
   *
   * A group used to be nothing but a synthetic id its members shared in
   * `parentId`. That is elegant — no group object has to exist, selection and
   * dragging fall out for free — and it has one consequence with no way
   * around it: **a group could not contain a group**, because the only thing
   * that can hold a `parentId` is a node.
   *
   * So grouping a group with anything else silently destroyed it. Both sets of
   * members were rewritten to one new id and the inner structure was gone,
   * unrecoverably. Group the axis labels of a chart, group the bars, select
   * both and group those — the gesture every tool supports — and you got one
   * flat bag of twelve objects.
   *
   * `planGroup` decides what the selection actually names: a set of nodes that
   * happens to *be* a whole group is nested as that group, while a set that is
   * only part of one is taken out of it. Both are what the gesture means, and
   * telling them apart is why this is a tested pure function rather than a
   * loop here.
   *
   * @returns the new group's id, or `null` when the selection did not warrant
   *   one — fewer than two things, or exactly one group already.
   */
  groupNodes(childIds: string[]): string | null {
    const { objects, groups } = useStore.getState();
    const order = Object.keys(objects);
    const plan = planGroup(order, objects, groups, childIds, nanoid());
    if (!plan) return null;
    applyGroupPlan(plan);
    return plan.create?.id ?? null;
  }

  /**
   * Take a group apart, one level.
   *
   * Ungrouping is not recursive: pressing it once undoes one Group, and its
   * child groups survive as groups. Dismantling everything inside would make
   * the command unrepeatable in the direction people expect — there would be
   * nothing left to press it on.
   *
   * Accepts member ids because that is what a selection holds; the groups they
   * belong to are what actually comes apart. Outermost first, so ungrouping a
   * selection spanning a nest does not try to unwrap a folder that a previous
   * step has already lifted.
   */
  ungroupNodes(childIds: string[]) {
    const { objects, groups } = useStore.getState();
    const order = Object.keys(objects);

    const targets = new Set<string>();
    for (const id of childIds) {
      const parent = objects[id]?.parentId;
      if (parent && groups[parent]) targets.add(rootGroupOf(groups, parent));
    }
    if (targets.size === 0) return;

    for (const groupId of targets) {
      const plan = planUngroup(order, objects, groups, groupId);
      if (plan) applyGroupPlan(plan);
    }
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
  /**
   * The world box every visible node occupies, or `null` on an empty board.
   *
   * Exposed because "is there anything to look at yet" is the question the
   * opening fit has to answer before it can frame anything, and asking it by
   * calling `zoomToFit` and seeing whether the camera moved is not an answer —
   * a board already framed correctly would look identical to an empty one.
   */
  contentBounds(): FitBounds | null {
    return sceneBounds();
  }

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
