import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { updateNode, applyNodePatches, applyGroupPlan, renameGroup, provider } from '../engine/document';
import { deleteNodesWithFrames } from '../engine/interaction/frameMembership';
import { useStore } from '../hooks/useStore';
import { editor } from '../engine/api/EditorAPI';
import { Type, Square, Image as ImageIcon, StickyNote, Mic, LayoutTemplate, MessageSquare, PenTool, Lock, Unlock, Copy, Trash2, Eye, EyeOff, Layers, Folder, FolderOpen, Ungroup, Frame as FrameIcon, ChevronRight, ChevronDown, Search, X, PanelLeftClose, Spline, LayoutGrid } from 'lucide-react';
import { GRID_LABELS } from '../engine/grid/gridLayout';
import { nanoid } from 'nanoid';
import { type AnyNode, type NodeType } from '../engine/model/schema';
import { nodeLabel } from '../engine/model/nodeLabel';
import { paintColor } from '../engine/model/paint';
import { readableOn } from '../engine/model/color';
import { getColorForUser } from '../engine/presence/ColorPalette';
import { dropZone, planLayerDrop, type DropRow, type DropWhere } from '../engine/model/layerDrop';
import { childGroups, nodesInGroup, planUngroup } from '../engine/model/groupTree';
import { THEMES } from '../engine/model/stickyThemes';
import { tagFilter } from '../engine/model/tagFilter';
import { tagCounts } from '../engine/model/tags';
import {
  highlightRuns,
  isFiltering,
  matchNode,
  type LayerMatch,
  type LayerTypeFilter,
} from '../engine/model/layerSearch';
import { useVirtualRows } from '../hooks/useVirtualRows';
// Shared, and typed so a new node type cannot go chip-less again.
import { TYPE_LABEL, TYPE_ORDER } from '../engine/model/nodeLabel';

/** Row pitch, in px. Uniform by design so the list can be windowed. */
const ROW_HEIGHT = 36;
const ROW_GAP = 4;

interface LayersPanelProps {
  selectedIds: string[];
  overrideObjects?: Record<string, any> | null;
  setSelectedId: (id: string | null) => void;
  setSelectedIds?: React.Dispatch<React.SetStateAction<string[]>>;
  /** Collapse this panel to its rail, handing the width back to the canvas. */
  onCollapse?: () => void;
}

export const LayersPanel: React.FC<LayersPanelProps> = ({ selectedIds, overrideObjects, setSelectedId, setSelectedIds, onCollapse }) => {
  // Was its own independent Yjs subscription (useCanvasObjects), parallel to
  // and redundant with the store every other panel reads from — same data,
  // maintained twice. Nothing kept the two in sync on purpose; they only ever
  // agreed because both ultimately mirror the same Yjs doc. Reading the
  // shared store here removes the duplicate subscription and guarantees this
  // panel can't momentarily disagree with Properties/Canvas/the toolbar.
  const liveObjects = useStore(state => state.objects);
  /**
   * The group tree.
   *
   * Its own slice of the store rather than a field on the nodes, because a
   * group holds no geometry and nothing that renders the board reads it — so a
   * reparent re-renders this panel and nothing else.
   */
  const groups = useStore(state => state.groups);
  const darkTheme = useStore(state => state.darkTheme);
  const objects = overrideObjects || liveObjects;

  const activeTags = useSyncExternalStore(
    tagFilter.subscribe,
    tagFilter.getSnapshot,
    tagFilter.getSnapshot
  ) as Set<string>;
  const allTags = useMemo(() => tagCounts(Object.values(objects)), [objects]);

  // A tag whose last note was deleted stays selected and invisible otherwise,
  // and the board filters to nothing with no visible cause.
  useEffect(() => {
    tagFilter.prune(allTags.map((t) => t.tag));
  }, [allTags]);

  // The search field, and the type it is narrowed to. Both are a way of
  // looking rather than a fact about the board, so neither goes near the CRDT
  // — the same rule the frame-collapse set follows.
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<LayerTypeFilter>('all');
  const searchRef = useRef<HTMLInputElement>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  /**
   * The row the drag is over, and which of its three zones.
   *
   * One piece of state rather than two, because "which row" and "which edge of
   * it" are never meaningfully known apart — a row id with a stale edge is the
   * insertion line pointing at the wrong gap, which is worse than none.
   */
  const [dropHint, setDropHint] = useState<{ id: string; where: DropWhere } | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState('');
  // Which frames are folded shut. A way of looking, not a fact about the
  // document — collapsing a frame to get it out of your way must not fold it
  // for everyone else in the room, so this never goes near the CRDT.
  const [collapsedFrames, setCollapsedFrames] = useState<Set<string>>(() => new Set());
  // Shift-range-select anchor — the last item clicked without a modifier key.
  const lastClickedRef = useRef<string | null>(null);

  // Filter out non-document objects and sort by zIndex descending
  const sortedObjects = Object.values(objects)
    .filter((obj: any) => obj.type !== 'eraser_tool' && obj.type !== 'selection_box')
    .sort((a: any, b: any) => (b.zIndex || 0) - (a.zIndex || 0));

  // Determine active collaborators editing objects
  const awarenessStates = provider.awareness?.getStates();
  const myClientId = provider.awareness?.clientID;
  const activeEditorsMap = new Map<string, { name: string; color: string }>();

  (awarenessStates || new Map()).forEach((state: any, clientId: number) => {
    // Canvas.tsx broadcasts the local selection as `selection` (an array —
    // peers can multi-select too), never a singular `selectedId`. Reading
    // that field name meant this map was always empty and the "so-and-so is
    // editing this" badge below never rendered for anyone.
    if (clientId !== myClientId && state.user && Array.isArray(state.selection)) {
      state.selection.forEach((id: string) => {
        activeEditorsMap.set(id, {
          name: state.user.name || 'Peer',
          // Derived from the peer's own id rather than a literal pink, so a
          // peer whose colour has not arrived yet still gets the colour every
          // other surface will show for them a moment later.
          color: state.user.color || getColorForUser(String(clientId)),
        });
      });
    }
  });

  /**
   * The colour that stands for an object in the list.
   *
   * Its own fill wherever it has one, so a panel of default-named objects —
   * six rows all reading "Shape" — is scannable by the thing that actually
   * distinguishes them on the board. Falls back to a neutral for the types
   * that have no colour of their own rather than inventing one.
   */
  const layerTint = (node: any): string => {
    const raw = (() => {
      if (node.type === 'sticky') return THEMES[node.theme as keyof typeof THEMES]?.bg ?? '#FDE047';
      const paint = node.appearance;
      const fill = paint?.fill?.[0];
      if (fill) return paintColor(fill, '');
      if (paint?.stroke?.color) return paint.stroke.color;
      if (node.type === 'text') return node.typography?.color ?? '';
      return '';
    })();
    // No colour of its own: inherit the row's, rather than inventing one.
    if (!raw || !raw.startsWith('#')) return 'var(--text-secondary)';
    // A near-black object on a dark panel produced an icon that was correct
    // and invisible. Lifted until it clears a minimum contrast, in HSV so the
    // hue survives — a dark blue stays blue instead of becoming grey.
    return readableOn(raw, darkTheme);
  };

  const getIcon = (type: string) => {
    // `currentColor`, so the glyph takes the tint its wrapper carries — which
    // is the object's own fill. This used to take a colour argument chosen
    // from whether the row was selected, back when selection was a solid
    // amber slab that the icon had to stay legible against.
    const c = 'currentColor';
    switch (type) {
      case 'text': return <Type size={14} color={c} />;
      case 'shape': return <Square size={14} color={c} />;
      case 'path': return <PenTool size={14} color={c} />;
      case 'image': return <ImageIcon size={14} color={c} />;
      case 'sticky': return <StickyNote size={14} color={c} />;
      case 'audio': return <Mic size={14} color={c} />;
      case 'artboard': return <LayoutTemplate size={14} color={c} />;
      case 'frame': return <FrameIcon size={14} color={c} />;
      case 'comment': return <MessageSquare size={14} color={c} />;
      case 'connector': return <Spline size={14} color={c} />;
      default: return <Square size={14} color={c} />;
    }
  };

  // Naming lives in engine/model/nodeLabel so the session timeline describes
  // objects with exactly the words this panel uses.
  const getName = nodeLabel;

  /**
   * Dragging rows: reorder, and move between groups.
   *
   * ## Three zones, not one target
   *
   * A row is not one drop target but three, which is how Photoshop and
   * Illustrator both work and the reason their layer panels feel exact:
   *
   *  - its **top edge** — land above it, as its sibling
   *  - its **bottom edge** — land below it, as its sibling
   *  - the **middle of a group** — go inside it
   *
   * The version this replaces asked only "which row did you drop on?" and read
   * membership off that row's parent. That makes position and parent the same
   * answer, and so leaves no gesture at all for "put this at the top level,
   * between two grouped rows" — every row you could aim at was in a group, so
   * every drop joined one. Getting an object *out* meant finding an ungrouped
   * row elsewhere to aim at, and on a board that had none it could not be done.
   *
   * Out of a group is now the group header's own top edge: above the folder,
   * therefore not in it. Always on screen, and it means one thing.
   *
   * The arithmetic is `planLayerDrop`, which is pure and tested — including the
   * cases that are tedious to reach by hand, like dropping the last row of a
   * group or dropping a folder onto itself.
   */

  /**
   * What is being dragged, captured at `dragstart`.
   *
   * A ref rather than state because the drop handler needs it *now*: reading
   * `selectedIds` at drop time worked only because React had flushed the
   * selection the group header sets when you pick it up, which is a race that
   * happened to be winnable rather than a rule.
   */
  const dragPayloadRef = useRef<string[]>([]);
  /**
   * The folder being dragged, when the drag began on a header.
   *
   * What separates "move these five objects" from "move this folder". Without
   * it a folder drag would rewrite its members' `parentId` and dissolve the
   * folder into wherever it landed — the exact flattening nesting exists to end.
   */
  const dragGroupRef = useRef<string | null>(null);

  const dragIdsFor = (id: string): string[] => {
    // Dragging one of several selected rows moves the whole selection, which
    // is what makes reordering a multi-select possible at all.
    if (selectedIds.includes(id) && selectedIds.length > 1) return [...selectedIds];
    return [id];
  };

  const beginDrag = (e: React.DragEvent, ids: string[], label: string, groupId?: string) => {
    dragPayloadRef.current = ids;
    dragGroupRef.current = groupId ?? null;
    setDraggedId(ids[0] ?? null);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox refuses to start a drag without payload.
    e.dataTransfer.setData('text/plain', label);
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    beginDrag(e, dragIdsFor(id), id);
  };

  /**
   * Scroll the list while a drag hovers its edges.
   *
   * Without this a virtualized list is a trap: the row you want to drop on is
   * not merely off screen, it is not in the DOM, so there is nothing to hover
   * and no way to reach it — a drag can only ever land within one screenful of
   * where it started. HTML5 drag suppresses wheel scrolling over the source, so
   * the panel has to do it.
   *
   * Speed scales with how far into the margin the pointer is, which is what
   * makes it controllable: rest at the edge to creep, push past it to travel.
   */
  const autoScrollRef = useRef<number | null>(null);
  const scrollVelocityRef = useRef(0);

  const stopAutoScroll = () => {
    if (autoScrollRef.current !== null) cancelAnimationFrame(autoScrollRef.current);
    autoScrollRef.current = null;
    scrollVelocityRef.current = 0;
  };

  const stepAutoScroll = () => {
    const el = containerRef.current;
    if (!el || scrollVelocityRef.current === 0) {
      autoScrollRef.current = null;
      return;
    }
    el.scrollTop += scrollVelocityRef.current;
    autoScrollRef.current = requestAnimationFrame(stepAutoScroll);
  };

  const updateAutoScroll = (clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const MARGIN = 44;
    const MAX_SPEED = 18;
    let v = 0;
    if (clientY < box.top + MARGIN) v = -MAX_SPEED * Math.min(1, (box.top + MARGIN - clientY) / MARGIN);
    else if (clientY > box.bottom - MARGIN) v = MAX_SPEED * Math.min(1, (clientY - (box.bottom - MARGIN)) / MARGIN);
    scrollVelocityRef.current = v;
    if (v !== 0 && autoScrollRef.current === null) autoScrollRef.current = requestAnimationFrame(stepAutoScroll);
    if (v === 0) stopAutoScroll();
  };

  /**
   * Open a folder the drag has been resting on.
   *
   * A shut group can only take a drop as a whole — there is no way to say
   * "third from the top, inside" when you cannot see its members. Hovering to
   * open it is the gesture every file manager uses, and the delay is what keeps
   * it from firing on every folder a drag merely passes over.
   */
  const springRef = useRef<{ id: string; timer: number } | null>(null);

  const cancelSpring = () => {
    if (springRef.current) window.clearTimeout(springRef.current.timer);
    springRef.current = null;
  };

  const armSpring = (id: string) => {
    if (springRef.current?.id === id) return;
    cancelSpring();
    if (!collapsedFrames.has(id)) return;
    springRef.current = {
      id,
      timer: window.setTimeout(() => {
        springRef.current = null;
        setCollapsedFrames((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 600),
    };
  };

  /**
   * @param isContainer Whether this row can be dropped *into*. Groups can;
   *   frames deliberately cannot — a frame owns its children through `frameId`,
   *   which is maintained from the board's geometry, so writing it from here
   *   would claim membership of a frame the object is nowhere near.
   */
  const handleDragOver = (e: React.DragEvent, id: string, isContainer = false) => {
    e.preventDefault();
    // The tree itself handles the empty space past the last row; a row that
    // let the event through would have its answer overwritten by that one.
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    updateAutoScroll(e.clientY);
    if (dragPayloadRef.current.includes(id)) {
      setDropHint(null);
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const where = dropZone(e.clientY - box.top, box.height, isContainer);
    if (isContainer && where === 'inside') armSpring(id);
    else cancelSpring();
    setDropHint((prev) => (prev?.id === id && prev.where === where ? prev : { id, where }));
  };

  /** A cancelled drag must not leave a row stranded at half opacity. */
  const handleDragEnd = () => {
    setDraggedId(null);
    setDropHint(null);
    dragPayloadRef.current = [];
    dragGroupRef.current = null;
    stopAutoScroll();
    cancelSpring();
  };

  /**
   * Nothing survives the panel closing mid-drag.
   *
   * Collapsing the panel while a row is in the air leaves an rAF loop
   * scrolling a detached element and a timer about to unfold a group that is
   * no longer rendered — neither visible, both real. Both closures here read
   * only refs, so the ones captured on the first render stay correct.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { stopAutoScroll(); cancelSpring(); }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const moving = dragPayloadRef.current;
    const target = dropHint;
    handleDragEnd();
    if (!target || moving.length === 0) return;

    const plan = planLayerDrop({
      order: sortedObjects.map((o) => o.id),
      objects,
      rows: dropRows,
      moving,
      target,
      groups,
      movingGroup: dragGroupRef.current ?? undefined,
    });

    /**
     * Both halves, and the group half first.
     *
     * A folder's new parent and its contents' new stacking order are one act —
     * applied apart, a peer receiving them in between sees the folder in its
     * new place with its contents still drawn in the old one. `applyGroupPlan`
     * runs its own transaction; the node patches run in theirs, and the order
     * matters only in that the tree is consistent the moment anything reads it.
     */
    if (plan.groups.length > 0) {
      applyGroupPlan({ nodes: [], groups: plan.groups, remove: [] });
    }
    if (plan.nodes.length > 0) {
      applyNodePatches(plan.nodes as { id: string; changes: Record<string, unknown> }[]);
    }
  };

  const toggleLock = (id: string) => {
    const obj = objects[id];
    if (!obj) return;
    updateNode(id, { locked: !obj.locked });
  };

  const toggleVisibility = (id: string) => {
    const obj = objects[id];
    if (!obj) return;
    updateNode(id, { hidden: !obj.hidden });
  };

  /**
   * Show only this, or put everything back.
   *
   * Alt-clicking an eye is the gesture Photoshop has had for thirty years, and
   * it is the fastest way to answer "which of these forty things is the one I
   * am looking at" — the question a layers panel exists for. One press
   * isolates, a second restores, because a solo you cannot undo in the same
   * motion is a solo nobody uses twice.
   *
   * One transaction, so the whole board changing state is one undo step rather
   * than forty.
   */
  const soloVisibility = (id: string) => {
    const others = sortedObjects.filter((o: AnyNode) => o.id !== id);
    const alreadySolo = others.every((o: AnyNode) => o.hidden) && !objects[id]?.hidden;
    applyNodePatches([
      { id, changes: { hidden: false } },
      ...others.map((o: AnyNode) => ({ id: o.id, changes: { hidden: !alreadySolo } })),
    ]);
  };

  /**
   * Hide or show every member of a group at once.
   *
   * The group row had a fold and an ungroup and no eye, so hiding a cluster
   * meant hiding each object in it one row at a time — the exact chore the
   * group exists to remove.
   *
   * "Are they hidden?" is answered by *all* of them being hidden, not by any:
   * a group with one hidden member is a group you can still see, so the toggle
   * offers to hide it. That also makes the action idempotent in the direction
   * people expect — press once to hide everything, press again to show it.
   */
  const toggleGroupVisibility = (ids: string[]) => {
    const nodes = ids.map((id) => objects[id]).filter(Boolean);
    if (nodes.length === 0) return;
    const allHidden = nodes.every((n) => n.hidden);
    applyNodePatches(nodes.map((n) => ({ id: n.id, changes: { hidden: !allHidden } })));
  };

  const handleBulkDelete = () => {
    deleteNodesWithFrames(selectedIds);
    setSelectedIds?.([]);
  };

  const handleBulkDuplicate = () => {
    const newIds = selectedIds.map(id => {
      const obj = objects[id];
      if (!obj) return null;
      const newId = nanoid();
      editor.createNode({ ...obj, id: newId, x: obj.x + 40, y: obj.y + 40 });
      return newId;
    }).filter(Boolean) as string[];
    setSelectedIds?.(newIds);
  };

  // Objects sharing a parentId render as one indented cluster under a group
  // header, and a frame's contents render indented under the frame itself. The
  // tree is flattened into a single list of uniform-height rows (frames, group
  // headers and object rows alike) so the list can be virtualized — rendering a
  // DOM row per object measured at 27ms per document change with 500 objects on
  // canvas, against 3ms with the panel unmounted, making this panel roughly 88%
  // of the cost of moving a single object.
  type FlatRow =
    | { kind: 'object'; obj: AnyNode; indent: number }
    | { kind: 'frame'; obj: AnyNode; indent: number; childCount: number }
    | { kind: 'group'; groupId: string; members: AnyNode[]; indent: number; name?: string };

  /**
   * Indent per level of frame nesting, in px.
   *
   * Smaller than the group cluster's 20 because frames nest and groups do not:
   * three levels deep at 20px leaves no room for a name in a 260px panel.
   */
  const FRAME_INDENT = 16;

  /**
   * Indent per level of *group* nesting, in px.
   *
   * Wider than a frame's, because a group's whole visual job is to read as a
   * container at a glance and nothing else distinguishes its members — a frame
   * at least has its own row on the board.
   */
  const GROUP_INDENT = 18;

  /**
   * Search results, keyed by id, or null when nothing is being filtered.
   *
   * Null rather than an empty map, so the tree below can tell "no filter" from
   * "a filter that matched nothing" — the first shows the document and the
   * second has to show an empty state, and they are not the same screen.
   */
  const matches = React.useMemo(() => {
    if (!isFiltering(query, typeFilter)) return null;
    const found = new Map<string, LayerMatch>();
    for (const obj of sortedObjects) {
      const match = matchNode(obj as AnyNode, query, typeFilter);
      if (match) found.set(obj.id, match);
    }
    return found;
  }, [sortedObjects, query, typeFilter]);

  const flatRows: FlatRow[] = React.useMemo(() => {
    // While filtering, the tree is set aside for a flat ranked list.
    //
    // Filtering a hierarchy raises a question with no good answer — whether to
    // show the unmatched parent of a matched child, and at what indent — and
    // every answer produces a list where the rows you asked for are not the
    // rows you can see. A ranked flat list has one job and does it: best match
    // first, nothing else present.
    if (matches) {
      return sortedObjects
        .filter((obj: any) => matches.has(obj.id))
        .sort((a: any, b: any) => (matches.get(b.id)!.score) - (matches.get(a.id)!.score))
        .map((obj: any) => ({ kind: 'object' as const, obj, indent: 0 }));
    }
    // Children keyed by owning frame. A `frameId` pointing at something that is
    // no longer a frame — deleted, or merged away by a concurrent edit — is
    // treated as no owner at all, so the object stays visible at the top level
    // rather than disappearing from the panel while sitting on the canvas.
    const childrenOf = new Map<string, AnyNode[]>();
    const roots: AnyNode[] = [];
    sortedObjects.forEach((obj: any) => {
      const owner = obj.frameId && objects[obj.frameId]?.type === 'frame' ? obj.frameId : null;
      if (!owner || owner === obj.id) {
        roots.push(obj);
        return;
      }
      const siblings = childrenOf.get(owner);
      if (siblings) siblings.push(obj);
      else childrenOf.set(owner, [obj]);
    });

    const order = sortedObjects.map((o: AnyNode) => o.id);

    /**
     * Where a group sits in the stack: the front-most thing inside it.
     *
     * A group has no z of its own — it has no geometry at all — so it has to
     * take one from its contents, and "front-most" is the only choice that
     * puts a folder above a loose object it is drawn over. Computed once for
     * every group rather than per comparison, because it is a walk of the
     * whole subtree and the sort would otherwise repeat it O(n log n) times.
     */
    const groupZ = new Map<string, number>();
    for (const id of Object.keys(groups)) {
      const inside = nodesInGroup(order, objects, groups, id);
      groupZ.set(id, inside.length === 0 ? -Infinity : Math.max(...inside.map((n) => objects[n]?.zIndex ?? 0)));
    }

    const rows: FlatRow[] = [];
    // `frameForNode` cannot produce a cycle, but a hand-edited or concurrently
    // merged document is not bound by that, and a cycle here would hang the tab
    // rather than mis-indent a rectangle.
    const openFrames = new Set<string>();

    /**
     * One level of the tree, in stacking order.
     *
     * The old version of this could only ever draw one level: it scanned for
     * distinct `parentId` values and emitted a header for each, with the
     * members flat underneath. Groups holding groups were not merely
     * unsupported, they were unrepresentable — so this is recursive now, and
     * a level is a mixed run of *folders and objects* that has to be ordered
     * against each other rather than folders-then-objects.
     */
    const emitLevel = (groupId: string | undefined, pool: AnyNode[], indent: number) => {
      const poolIds = new Set(pool.map((o) => o.id));

      type Entry = { z: number; render: () => void };
      const entries: Entry[] = [];

      for (const child of childGroups(groups, groupId)) {
        const inside = nodesInGroup(order, objects, groups, child).filter((id) => poolIds.has(id));
        // A group whose contents all live in another frame is that frame's to
        // draw, not this level's.
        if (inside.length === 0) continue;
        entries.push({
          z: groupZ.get(child) ?? -Infinity,
          render: () => emitGroup(child, pool, indent),
        });
      }

      for (const obj of pool) {
        /**
         * The level a node belongs to, with an unknown parent read as the root.
         *
         * This used to `continue` on any node with a `parentId` at all, on the
         * reasoning that its folder would draw it -- which skipped the members
         * of the folder being drawn *right now*, so expanding a group showed
         * nothing. Every grouped object was invisible in this panel.
         *
         * A `parentId` naming a group that no longer exists resolves to the
         * root rather than nowhere: an object stranded by a concurrent delete
         * belongs somewhere in the list, and the board is still drawing it.
         */
        const parent = obj.parentId && groups[obj.parentId] ? obj.parentId : undefined;
        if (parent !== (groupId ?? undefined)) continue;
        entries.push({ z: obj.zIndex ?? 0, render: () => emitNode(obj, pool, indent) });
      }

      entries.sort((a, b) => b.z - a.z);
      for (const entry of entries) entry.render();
    };

    const emitGroup = (id: string, pool: AnyNode[], indent: number) => {
      const members = nodesInGroup(order, objects, groups, id)
        .map((n) => objects[n])
        .filter(Boolean) as AnyNode[];
      rows.push({ kind: 'group', groupId: id, members, indent, name: groups[id]?.name });
      // Foldable, like a frame. A board with a few grouped clusters otherwise
      // buries everything else under their members, and finding one object
      // among many is the panel's whole job. The same collapse set serves both:
      // to a reader they are the same gesture on the same kind of thing.
      if (!collapsedFrames.has(id)) emitLevel(id, pool, indent + GROUP_INDENT);
    };

    const emitNode = (obj: AnyNode, _pool: AnyNode[], indent: number) => {
      if (obj.type === 'frame' && !openFrames.has(obj.id)) {
        const children = childrenOf.get(obj.id) ?? [];
        rows.push({ kind: 'frame', obj, indent, childCount: children.length });
        if (children.length > 0 && !collapsedFrames.has(obj.id)) {
          openFrames.add(obj.id);
          emitLevel(undefined, children, indent + FRAME_INDENT);
          openFrames.delete(obj.id);
        }
        return;
      }
      rows.push({ kind: 'object', obj, indent });
    };

    emitLevel(undefined, roots, 0);
    return rows;
  }, [sortedObjects, objects, groups, collapsedFrames, matches]);

  /**
   * The displayed rows, as the drop planner needs to see them.
   *
   * The planner cannot work from the node table alone: a group header is a row
   * but not a node — a group is only ever the `parentId` its members share —
   * and whether it is folded shut changes what its bottom edge means. Shut,
   * nothing sits between that edge and the next row, so dropping there lands
   * *below the whole group*; open, its own first child is directly beneath, so
   * the same gesture lands *inside*.
   */
  const dropRows: DropRow[] = React.useMemo(
    () =>
      flatRows.map((row) =>
        row.kind === 'group'
          ? { id: row.groupId, kind: 'group' as const, collapsed: collapsedFrames.has(row.groupId) }
          : { id: row.obj.id, kind: 'object' as const }
      ),
    [flatRows, collapsedFrames]
  );

  /**
   * The object rows in the order they are *shown*.
   *
   * Shift-range has to follow the list you can see. Ranging over the flat
   * z-order instead would, once frames nest, select objects between two rows
   * that are nowhere near each other on screen.
   */
  const visibleObjectIds = React.useMemo(
    () => flatRows.filter((r) => r.kind !== 'group').map((r) => (r as { obj: AnyNode }).obj.id),
    [flatRows]
  );

  /**
   * Whether a row can be folded at all.
   *
   * Derived from the rows themselves rather than from a second list of types,
   * so a new kind of foldable row is foldable by the keyboard the moment it can
   * be folded by the chevron. The two disagreed before: `←` asked whether the
   * node was a frame, which is false for a group cluster, whose id belongs to
   * no node at all.
   */
  const isFoldable = React.useCallback(
    (id: string) =>
      flatRows.some(
        (row) =>
          (row.kind === 'group' && row.groupId === id) ||
          (row.kind === 'frame' && row.obj.id === id)
      ),
    [flatRows]
  );

  const toggleFrameCollapsed = (id: string) => {
    setCollapsedFrames((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRowClick = (e: React.MouseEvent, id: string) => {
    if (!setSelectedIds) {
      setSelectedId(id);
      return;
    }

    if (e.shiftKey && lastClickedRef.current) {
      const ids = visibleObjectIds;
      const anchorIdx = ids.indexOf(lastClickedRef.current);
      const targetIdx = ids.indexOf(id);
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
        setSelectedIds(ids.slice(start, end + 1));
        return; // Shift-range doesn't move the anchor, matching Explorer/Finder.
      }
    }

    if (e.metaKey || e.ctrlKey) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    } else {
      setSelectedIds([id]);
    }
    lastClickedRef.current = id;
  };

  // Row clicks support Cmd/Ctrl-toggle and Shift-range; group headers only had
  // a plain click that always replaced the whole selection, so Cmd-clicking a
  // group to add it to an existing selection silently discarded that
  // selection instead. Shift-range across a group boundary is left as a
  // deliberate scope cut — "range" is ambiguous once some rows represent one
  // object and others represent N — but additive toggle has an unambiguous,
  // expected meaning and is worth matching.
  const handleGroupClick = (e: React.MouseEvent, memberIds: string[]) => {
    if (!setSelectedIds) {
      setSelectedId(memberIds[0] ?? null);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds(prev => {
        const allIn = memberIds.every(id => prev.includes(id));
        return allIn ? prev.filter(id => !memberIds.includes(id)) : Array.from(new Set([...prev, ...memberIds]));
      });
    } else {
      setSelectedIds(memberIds);
    }
    lastClickedRef.current = null;
  };

  /**
   * Take apart *this* folder, not the outermost one holding it.
   *
   * `editor.ungroupNodes` takes member ids and resolves upward to the whole
   * assembly, which is right for the canvas — a selection there is the outer
   * group. It is wrong here: the panel draws every level, and pressing Ungroup
   * on an inner row has to mean that row. The row knows its own id, so it says so.
   */
  const handleUngroup = (groupId: string) => {
    const plan = planUngroup(sortedObjects.map((o: AnyNode) => o.id), objects, groups, groupId);
    if (plan) applyGroupPlan(plan);
  };

  /** The node types this document actually contains, in a stable order. */
  const presentTypes = React.useMemo(() => {
    const seen = new Set<NodeType>();
    for (const obj of sortedObjects) seen.add((obj as AnyNode).type);
    return TYPE_ORDER.filter((t) => seen.has(t));
  }, [sortedObjects]);

  const { containerRef, window: vwindow } = useVirtualRows(flatRows.length, ROW_HEIGHT);
  const visibleRows = flatRows.slice(vwindow.start, vwindow.end);

  /**
   * Driving the panel from the keyboard.
   *
   * The brief asks for the power-user path explicitly, and there was none: the
   * panel handled exactly three keys, all of them inside the rename field and
   * the search box. Everything below is therefore new, and it is deliberately
   * the shape people already know from a file tree — ↑/↓ to move, ←/→ to fold,
   * Enter to rename, Space to hide, Cmd+↑/↓ to restack.
   *
   * The cursor is the last row touched, which is what `lastClickedRef` already
   * tracked for shift-ranging. Reusing it rather than adding a second notion of
   * "current row" keeps the mouse and the keyboard on one anchor — two would
   * drift apart the moment you clicked one row and arrowed from another.
   */
  const cursorId = lastClickedRef.current ?? selectedIds[selectedIds.length - 1] ?? null;

  /**
   * Bring a row into view after the keyboard moves to it.
   *
   * The list is virtualized, so a row the cursor moves to may not be in the
   * DOM at all — there is nothing to call `scrollIntoView` on. Scrolling the
   * container by the row's index is the only thing that works for a row that
   * does not yet exist, and it works for one that does.
   */
  const revealRow = (id: string) => {
    const index = flatRows.findIndex((r) => r.kind !== 'group' && (r as { obj: AnyNode }).obj.id === id);
    const el = containerRef.current;
    if (index < 0 || !el) return;
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  };

  const moveCursor = (delta: number, extend: boolean) => {
    const ids = visibleObjectIds;
    if (ids.length === 0) return;
    const from = cursorId ? ids.indexOf(cursorId) : -1;
    // From nowhere, ↓ starts at the top and ↑ starts at the bottom, so the
    // first press always lands somewhere visible rather than doing nothing.
    const next = from === -1 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, from + delta));
    const id = ids[next];

    if (extend && setSelectedIds) {
      // Extending keeps the anchor where it was, matching the shift-click
      // behaviour above and every file tree people already use.
      const anchor = lastClickedRef.current ?? id;
      const a = ids.indexOf(anchor);
      const [start, end] = a < next ? [a, next] : [next, a];
      setSelectedIds(ids.slice(start, end + 1));
    } else {
      if (setSelectedIds) setSelectedIds([id]);
      else setSelectedId(id);
      lastClickedRef.current = id;
    }
    revealRow(id);
  };

  /** Restack the selection one place, without collapsing it into one slot. */
  /**
   * Move the chosen rows one place up or down the stack.
   *
   * ## Why this swaps rather than adds one
   *
   * It used to write `zIndex ± 1`, which only reorders anything when the stack
   * happens to be consecutive. It is not: `nextZIndex` returns one above the
   * maximum, so deleting objects leaves gaps, and "send to back" writes a value
   * well below everything. With a gap of five, pressing restack four times did
   * nothing at all and the fifth press suddenly jumped — a control that appears
   * broken and then appears to overshoot.
   *
   * Swapping with the neighbour is what "move one place" actually means, and it
   * is exact whatever the numbers are.
   *
   * `direction` is in **stack** terms: `up` means nearer the front, which is
   * also nearer the top of this list, because the list is sorted by descending
   * z-index.
   */
  const restack = (direction: 'up' | 'down') => {
    const chosen = selectedIds.length > 0 ? selectedIds : cursorId ? [cursorId] : [];
    if (chosen.length === 0) return;

    // Front to back, matching the list. `up` walks toward index 0.
    const order = sortedObjects.map((o: AnyNode) => o.id);
    const chosenSet = new Set(chosen);
    const step = direction === 'up' ? -1 : 1;

    /**
     * Moved nearest-edge first, so a multi-row selection keeps its order and
     * cannot have one member leapfrog another it is being moved with.
     */
    const moving = order
      .map((id, index) => ({ id, index }))
      .filter(({ id }) => chosenSet.has(id));
    if (direction === 'down') moving.reverse();

    const patches: { id: string; changes: Record<string, unknown> }[] = [];
    for (const { id, index } of moving) {
      const neighbour = order[index + step];
      // Already at the edge, or the thing next to it is coming along anyway.
      if (!neighbour || chosenSet.has(neighbour)) continue;
      const a = objects[id];
      const b = objects[neighbour];
      if (!a || !b) continue;
      patches.push({ id, changes: { zIndex: b.zIndex } });
      patches.push({ id: neighbour, changes: { zIndex: a.zIndex } });
    }

    if (patches.length > 0) applyNodePatches(patches);
  };

  const handleTreeKeyDown = (e: React.KeyboardEvent) => {
    // While a row is being renamed the keyboard belongs to that input — ↑ and
    // ↓ move the caret, and Escape cancels the rename rather than the
    // selection.
    if (editingTitleId) return;
    // A key that reached here from the search box or a row's own control is
    // that control's to handle.
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    /**
     * A key this panel handles must not reach the canvas as well.
     *
     * Both bind Cmd+G, and the canvas listens on `window` -- above the root
     * React delegates from -- so grouping from the layers panel ran the whole
     * gesture twice: a group was made, and then that group was immediately
     * nested inside a second one. Delete fired twice too, which is two history
     * entries for one press.
     *
     * Every branch below already calls `preventDefault`; stopping propagation
     * beside it is what makes "this panel handled it" true rather than merely
     * "the browser will not scroll".
     */
    const mod = e.metaKey || e.ctrlKey;

    switch (e.key) {
      /**
       * The modified arrows were **inverted**.
       *
       * This list is sorted by descending z-index, so the front of the stack is
       * the top of the list. `Cmd+↓` called `restack('up')` and `Cmd+↑` called
       * `restack('down')`, so the row moved the opposite way from the key in
       * both directions — and the help screen simply says "Restack", which is
       * true of any behaviour and therefore checks nothing.
       */
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        if (mod) restack('down');
        else moveCursor(1, e.shiftKey);
        return;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        if (mod) restack('up');
        else moveCursor(-1, e.shiftKey);
        return;
      /**
       * Fold and unfold, on anything that folds.
       *
       * Frames fold and so do group clusters, and the help screen says so —
       * but `←` tested `type === 'frame'` while `→` tested only whether the id
       * was already collapsed. A group could therefore be opened with `→` and
       * never closed again with `←`, which is the asymmetry you find by trying
       * it and cannot find by reading either key on its own.
       */
      case 'ArrowRight':
        if (cursorId && isFoldable(cursorId) && collapsedFrames.has(cursorId)) {
          e.preventDefault();
        e.stopPropagation();
          toggleFrameCollapsed(cursorId);
        }
        return;
      case 'ArrowLeft':
        if (cursorId && isFoldable(cursorId) && !collapsedFrames.has(cursorId)) {
          e.preventDefault();
        e.stopPropagation();
          toggleFrameCollapsed(cursorId);
        }
        return;
      case 'Enter':
        if (cursorId) {
          e.preventDefault();
        e.stopPropagation();
          setEditingTitleId(cursorId);
        }
        return;
      case ' ':
      case 'Spacebar':
        if (cursorId) {
          e.preventDefault();
        e.stopPropagation();
          toggleVisibility(cursorId);
        }
        return;
      case 'Delete':
      case 'Backspace':
        if (selectedIds.length > 0) {
          e.preventDefault();
        e.stopPropagation();
          handleBulkDelete();
        }
        return;
      case 'Home':
      case 'End': {
        // The two keys every list has and this one did not. On a board with
        // four hundred layers, "the top of the stack" was a scroll.
        const ids = visibleObjectIds;
        if (ids.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const id = e.key === 'Home' ? ids[0] : ids[ids.length - 1];
        if (e.shiftKey && setSelectedIds && cursorId) {
          const a = ids.indexOf(lastClickedRef.current ?? cursorId);
          const b = ids.indexOf(id);
          const [start, end] = a < b ? [a, b] : [b, a];
          setSelectedIds(ids.slice(start, end + 1));
        } else if (setSelectedIds) {
          setSelectedIds([id]);
          lastClickedRef.current = id;
        }
        revealRow(id);
        return;
      }
      case 'a':
      case 'A':
        if (mod && setSelectedIds) {
          e.preventDefault();
        e.stopPropagation();
          setSelectedIds(visibleObjectIds);
        }
        return;
      /**
       * Group and ungroup, from the panel that draws groups.
       *
       * They were on the canvas and nowhere else, so the one surface whose
       * entire subject is the hierarchy could not create a level of it — you
       * had to click back onto the board, group there, and come back. Same
       * keys as the canvas and as every other tool: Cmd+G, Cmd+Shift+G.
       */
      case 'g':
      case 'G': {
        if (!mod) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          if (selectedIds.length > 0) editor.ungroupNodes(selectedIds);
          return;
        }
        if (selectedIds.length > 1) editor.groupNodes(selectedIds);
        return;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        // A drag in flight is the thing Escape most obviously cancels, and
        // clearing the selection out from under it would be the wrong answer
        // to the wrong question.
        if (draggedId) {
          handleDragEnd();
          return;
        }
        setSelectedIds?.([]);
        lastClickedRef.current = null;
        return;
      default:
    }
  };

  const renderRow = (obj: any, indent: number, disclosure?: React.ReactNode) => {
    const activeEditor = activeEditorsMap.get(obj.id);
    const isEditingThisTitle = editingTitleId === obj.id;
    const isSelected = selectedIds.includes(obj.id);
    // A plain row has no `inside`, so the hint is always an edge.
    const rowEdge = dropHint && dropHint.id === obj.id ? dropHint.where : null;

    return (
      <div
        key={obj.id}
        // What `aria-activedescendant` on the tree points at, so a screen
        // reader follows the keyboard cursor to a row that is never itself
        // focused.
        id={`layer-row-${obj.id}`}
        draggable
        onDragStart={(e) => handleDragStart(e, obj.id)}
        onDragOver={(e) => handleDragOver(e, obj.id)}
        onDragLeave={() => cancelSpring()}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        onClick={(e) => handleRowClick(e, obj.id)}
        className={`layer-row${isSelected ? ' is-selected' : ''}${obj.id === cursorId ? ' is-cursor' : ''}`}
        style={{
          padding: '0 8px 0 ' + (12 + indent) + 'px',
          // Fixed height is what makes virtualization possible — see the
          // flattening above and useVirtualRows.
          height: ROW_HEIGHT - ROW_GAP,
          marginBottom: ROW_GAP,
          color: obj.locked ? 'var(--text-secondary)' : 'var(--text-primary)',
          opacity: obj.hidden ? 0.45 : (draggedId === obj.id ? 0.4 : 1),
        }}
      >
        {/**
          * Where the row would land, drawn in the gap rather than on the row.
          *
          * It was a `2px solid transparent` border reserved on *every* row so
          * the real one would not shift the layout when it appeared — and a
          * transparent border is not nothing, it is a two-pixel strip through
          * which the panel shows, across the top of a row that has its own
          * background. Every selected and every hovered row therefore wore a
          * pale line along its top edge, permanently, for a drag that was not
          * happening.
          *
          * Absolutely positioned, so it costs no layout at all and can be
          * *indented to the level it would insert at* — which is the part that
          * makes it readable: the line's left edge says which group you are
          * dropping into as clearly as its vertical position says where.
          */}
        {rowEdge && (
          <span
            className="layer-drop-line"
            data-edge={rowEdge}
            style={{ left: 12 + indent }}
            aria-hidden
          />
        )}
        {/* Every row reserves the twisty slot, whether or not it has one, so a
            frame's icon sits on the same vertical line as its siblings' rather
            than shunted right by the width of a chevron. */}
        {disclosure ?? <span aria-hidden />}
        <span
          className="layer-row__icon"
          style={{ color: layerTint(obj), background: `color-mix(in srgb, ${layerTint(obj)} 16%, transparent)` }}
        >
          {getIcon(obj.type)}
        </span>

        {isEditingThisTitle ? (
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={() => {
              if (titleInput.trim()) updateNode(obj.id, { title: titleInput.trim() });
              setEditingTitleId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (titleInput.trim()) updateNode(obj.id, { title: titleInput.trim() });
                setEditingTitleId(null);
              }
            }}
            autoFocus
            style={{ flex: 1, background: 'var(--surface-primary)', border: '1px solid var(--border-focus)', borderRadius: 'var(--radius-sm)', padding: '2px 6px', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none' }}
          />
        ) : (
          <span
            onDoubleClick={() => {
              setEditingTitleId(obj.id);
              setTitleInput(getName(obj));
            }}
            className="layer-row__name"
            style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: obj.locked ? 'line-through' : 'none' }}
            data-tooltip="Double click to rename"
          >
            {/* The matched characters are marked, which is what makes a
                subsequence match legible: `sbm` finding "Submit Button" reads
                as a bug until you can see which letters it matched. */}
            {highlightRuns(getName(obj), matches?.get(obj.id)?.positions ?? []).map((run, i) =>
              run.hit ? (
                <mark
                  key={i}
                  style={{
                    background: 'transparent',
                    color: 'var(--brand-orange)',
                    fontWeight: 700,
                  }}
                >
                  {run.text}
                </mark>
              ) : (
                <React.Fragment key={i}>{run.text}</React.Fragment>
              )
            )}
          </span>
        )}

        {/* Live Collaborator Presence Indicator Badge */}
        {activeEditor && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '4px', background: activeEditor.color,
              /**
               * Ink chosen against the badge, not assumed to be white.
               *
               * Presence colours span the whole palette, so a fixed white label
               * sat at roughly 1.4:1 on the lighter half of it — the amber and
               * the lime were effectively unreadable. `readableOn` is already
               * imported here for the type icons and answers the same question.
               */
              color: readableOn(activeEditor.color, darkTheme),
              padding: '2px 6px',
              borderRadius: 'var(--radius-pill)',
              fontSize: 'var(--text-2xs)',
              fontWeight: 600,
            }}
            title={`${activeEditor.name} is currently editing this item`}
          >
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'white' }} />
            {activeEditor.name}
          </div>
        )}

        {!isEditingThisTitle && (
          /* Two toggles, not four buttons.
             Visibility and lock are *state* — they belong on the row because
             the row is where you read that state. Duplicate and delete are
             commands that show nothing, are already on the floating toolbar,
             the bulk header and the keyboard (Cmd+D, Del), and cost every row
             two slots for the privilege of putting a destructive action one
             stray click from the name you were aiming at. */
          <div className="layer-row__actions" data-sticky={obj.hidden || obj.locked}>
            <button
              className="layer-row__btn"
              onClick={(e) => {
                e.stopPropagation();
                if (e.altKey) soloVisibility(obj.id);
                else toggleVisibility(obj.id);
              }}
              data-tooltip={obj.hidden ? 'Show (Alt: show only this)' : 'Hide (Alt: show only this)'}
              aria-label={obj.hidden ? `Show ${getName(obj)}` : `Hide ${getName(obj)}`}
              aria-pressed={obj.hidden}
            >
              {obj.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              className="layer-row__btn"
              onClick={(e) => { e.stopPropagation(); toggleLock(obj.id); }}
              data-tooltip={obj.locked ? 'Unlock' : 'Lock'}
              aria-label={obj.locked ? `Unlock ${getName(obj)}` : `Lock ${getName(obj)}`}
              aria-pressed={obj.locked}
            >
              {obj.locked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', userSelect: 'none', background: 'var(--surface-primary)' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '16px', borderBottom: '1px solid var(--border-divider)', background: 'var(--surface-elevated)', position: 'sticky', top: 0, zIndex: 10 }}>
        <Layers size={16} color="var(--text-secondary)" />
        <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--text-sm)', flex: 1 }}>Layers</span>
        {onCollapse && selectedIds.length <= 1 && (
          <button
            className="btn-icon"
            style={{ padding: '4px' }}
            onClick={onCollapse}
            data-tooltip="Collapse panel"
            aria-label="Collapse the layers panel"
          >
            <PanelLeftClose size={15} />
          </button>
        )}
        {selectedIds.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)', fontWeight: 600 }}>{selectedIds.length} selected</span>
            <button className="btn-icon" style={{ padding: '4px' }} onClick={handleBulkDuplicate} data-tooltip="Duplicate selected (Cmd+D)">
              <Copy size={14} />
            </button>
            <button className="btn-icon" style={{ padding: '4px', color: 'var(--status-danger)' }} onClick={handleBulkDelete} data-tooltip="Delete selected (Del)">
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Search.
          Subsequence matching, so `sbm` finds "Submit Button" — the behaviour
          every command palette has and the one people arrive expecting. The
          type chips beside it answer the other half of the question the brief
          asks: "show me only the text layers". */}
      <div className="layer-search">
        <Search size={13} className="layer-search__icon" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          className="layer-search__input"
          placeholder="Search layers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Escape clears before it blurs: the first press should undo the
            // filter, which is what you want when you cannot find the thing
            // you were looking for.
            if (e.key === 'Escape') {
              if (query) {
                e.stopPropagation();
                setQuery('');
              } else {
                e.currentTarget.blur();
              }
            }
            // Enter selects everything the search found, which turns a search
            // into a selection in one keystroke.
            if (e.key === 'Enter' && matches && matches.size > 0 && setSelectedIds) {
              e.preventDefault();
              setSelectedIds(Array.from(matches.keys()));
            }
            // The canvas listens for plain keys as tool shortcuts. Without
            // this, typing "r" into the box also picks the rectangle tool.
            e.stopPropagation();
          }}
          aria-label="Search layers by name"
        />
        {isFiltering(query, typeFilter) && (
          <button
            type="button"
            className="layer-search__clear"
            onClick={() => {
              setQuery('');
              setTypeFilter('all');
            }}
            aria-label="Clear search and type filter"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Only the types actually present. A chip for a node type nobody has
          used is a filter guaranteed to return nothing. */}
      {presentTypes.length > 1 && (
        <div className="layer-type-filter">
          {(['all', ...presentTypes] as LayerTypeFilter[]).map((t) => (
            <button
              key={t}
              type="button"
              className="layer-type-chip"
              data-active={typeFilter === t || undefined}
              aria-pressed={typeFilter === t}
              onClick={() => setTypeFilter(t)}
            >
              {t === 'all' ? 'All' : TYPE_LABEL[t] ?? t}
            </button>
          ))}
        </div>
      )}

      {/* Tag filter.
          Tags were on the schema for the project's whole life with nothing to
          act on them, which made them decoration. This is the thing that makes
          them worth typing: pick tags and the board dims everything else, so
          you can see the matches *in place* rather than as a list somewhere. */}
      {allTags.length > 0 && (
        <div className="tag-filter">
          <div className="tag-filter-row">
            {allTags.map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                className="tag-filter-chip"
                data-active={activeTags.has(tag) || undefined}
                aria-pressed={activeTags.has(tag)}
                onClick={() => tagFilter.toggle(tag)}
              >
                {tag}
                <span className="tag-filter-count">{count}</span>
              </button>
            ))}
          </div>
          {activeTags.size > 0 && (
            <button type="button" className="tag-filter-clear" onClick={() => tagFilter.clear()}>
              Clear filter
            </button>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        role="tree"
        aria-label="Layers"
        // Focusable, so the arrow keys have somewhere to arrive. Without this
        // the tree could be clicked but never driven: keyboard focus skipped
        // straight from the search box to the first row's eye toggle.
        tabIndex={0}
        aria-activedescendant={cursorId ? `layer-row-${cursorId}` : undefined}
        onKeyDown={handleTreeKeyDown}
        /**
         * The empty space below the last row is a drop target too.
         *
         * "Send it to the back" is one of the two things anyone drags a layer
         * for, and aiming at the last row's bottom sliver to say it is a
         * precision task for something that should be the easiest drop on the
         * panel. Releasing anywhere in the space beneath the list means it.
         */
        onDragOver={(e) => {
          if (dragPayloadRef.current.length === 0) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          updateAutoScroll(e.clientY);
          cancelSpring();
          const last = [...dropRows].reverse().find((r) => !dragPayloadRef.current.includes(r.id));
          if (!last) return;
          setDropHint((prev) =>
            prev?.id === last.id && prev.where === 'after' ? prev : { id: last.id, where: 'after' }
          );
        }}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        style={{ padding: '8px', overflowY: 'auto', overflowX: 'hidden', flex: 1 }}
        className="custom-scrollbar layers-tree"
      >
        {sortedObjects.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '40px', fontSize: 'var(--text-sm)' }}>
            Canvas is empty
          </div>
        ) : flatRows.length === 0 ? (
          /* A filter that matched nothing is a different screen from an empty
             canvas, and saying so is the difference between "there is nothing
             here" and "there is nothing here *that matches*" — only one of
             which tells you to clear the filter. */
          <div className="layer-search-empty">
            No layers match{query.trim() ? ` “${query.trim()}”` : ' this filter'}.
          </div>
        ) : (
          // The outer element carries the full scroll height so the scrollbar
          // is honest about the list length, while only the windowed slice is
          // actually in the DOM.
          <div style={{ height: vwindow.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${vwindow.offsetTop}px)` }}>
              {visibleRows.map((item) => {
                if (item.kind === 'object') return renderRow(item.obj, item.indent);

                if (item.kind === 'frame') {
                  const collapsed = collapsedFrames.has(item.obj.id);
                  return renderRow(
                    item.obj,
                    item.indent,
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleFrameCollapsed(item.obj.id); }}
                      // An empty frame has nothing to fold, so its twisty is a
                      // dead control — present for alignment, invisible and
                      // unreachable by keyboard.
                      disabled={item.childCount === 0}
                      aria-expanded={item.childCount === 0 ? undefined : !collapsed}
                      aria-label={collapsed ? `Expand ${getName(item.obj)}` : `Collapse ${getName(item.obj)}`}
                      style={{
                        background: 'transparent', border: 'none', padding: 0, display: 'flex',
                        color: 'inherit', width: 14, flexShrink: 0,
                        cursor: item.childCount === 0 ? 'default' : 'pointer',
                        visibility: item.childCount === 0 ? 'hidden' : 'visible',
                      }}
                    >
                      {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                  );
                }

                const memberIds = item.members.map((m) => m.id);
                const groupSelected = memberIds.length > 0 && memberIds.every((id) => selectedIds.includes(id));
                /**
                 * A grid is a group, and it should not read as one.
                 *
                 * Every group row said "Group" with a folder on it, so a
                 * composition the grid tool had just built was indistinguishable
                 * from twelve objects somebody had happened to select. The
                 * recipe on the group already knows what it is; the row just has
                 * to say so.
                 */
                const grid = groups[item.groupId]?.grid;
                const hint = dropHint && dropHint.id === item.groupId ? dropHint.where : null;
                const groupEdge = hint === 'inside' ? null : hint;
                // Every member hidden, matching what the toggle acts on.
                const groupHidden = item.members.length > 0 && item.members.every((m) => m.hidden);

                return (
                  <div
                    key={item.groupId}
                    role="treeitem"
                    aria-selected={groupSelected}
                    /**
                     * A group is a drop target and a drag source.
                     *
                     * It was neither, so a group could not be moved in the
                     * stack and nothing could be dragged into one — the panel
                     * drew a hierarchy it gave you no way to change. Dropping
                     * onto this row is how an object *joins* the group.
                     */
                    draggable
                    onDragStart={(e) => {
                      // Picking up the header moves the whole group, which is
                      // what grabbing a folder means everywhere else.
                      beginDrag(e, memberIds, item.groupId, item.groupId);
                      if (setSelectedIds) setSelectedIds(memberIds);
                    }}
                    onDragOver={(e) => handleDragOver(e, item.groupId, true)}
                    onDragLeave={() => cancelSpring()}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    onClick={(e) => handleGroupClick(e, memberIds)}
                    className={`layer-row layer-row--group${groupSelected ? ' is-selected' : ''}${
                      hint === 'inside' ? ' is-drop-into' : ''
                    }`}
                    style={{
                      padding: '0 8px 0 ' + (12 + item.indent) + 'px',
                      height: ROW_HEIGHT - ROW_GAP,
                      marginBottom: ROW_GAP,
                      fontWeight: 'var(--weight-semibold)',
                      opacity: memberIds.includes(draggedId ?? '') ? 0.4 : 1,
                    }}
                  >
                    {/* The folder's top edge is how something leaves the group:
                        above the folder is not in the folder. Its bottom edge
                        means inside when open and below-the-whole-group when
                        shut, which is what the eye reads in each case. */}
                    {groupEdge && (
                      <span
                        className="layer-drop-line"
                        data-edge={groupEdge}
                        // Its bottom edge indents to the members' level when
                        // the folder is open, because that is where the drop
                        // would land — inside, at the top.
                        style={{
                          left:
                            12 + item.indent +
                            (groupEdge === 'after' && !collapsedFrames.has(item.groupId) ? 20 : 0),
                        }}
                        aria-hidden
                      />
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFrameCollapsed(item.groupId); }}
                      className="layer-row__btn"
                      aria-label={collapsedFrames.has(item.groupId) ? 'Expand group' : 'Collapse group'}
                      aria-expanded={!collapsedFrames.has(item.groupId)}
                      style={{ padding: 0 }}
                    >
                      <ChevronRight
                        size={12}
                        style={{
                          transform: collapsedFrames.has(item.groupId) ? 'none' : 'rotate(90deg)',
                          transition: 'transform var(--motion-hover)',
                        }}
                      />
                    </button>
                    <span
                      className="layer-row__icon"
                      // Grids take the accent the grid tool uses, because a
                      // generated composition is a different kind of thing from
                      // a folder somebody made by selecting and pressing Group.
                      style={grid ? { color: 'var(--brand-orange)' } : undefined}
                    >
                      {grid
                        ? <LayoutGrid size={14} />
                        : collapsedFrames.has(item.groupId) ? <Folder size={14} /> : <FolderOpen size={14} />}
                    </span>
                    {editingTitleId === item.groupId ? (
                      <input
                        type="text"
                        value={titleInput}
                        onChange={(e) => setTitleInput(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => { renameGroup(item.groupId, titleInput); setEditingTitleId(null); }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') { renameGroup(item.groupId, titleInput); setEditingTitleId(null); }
                          if (e.key === 'Escape') setEditingTitleId(null);
                        }}
                        autoFocus
                        style={{ flex: 1, minWidth: 0, background: 'var(--surface-primary)', border: '1px solid var(--border-focus)', borderRadius: 'var(--radius-sm)', padding: '2px 6px', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none' }}
                      />
                    ) : (
                      <span
                        className="layer-row__name"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingTitleId(item.groupId);
                          setTitleInput(item.name ?? '');
                        }}
                        data-tooltip="Double click to rename"
                      >
                        {/* A named folder beats a counted one the moment there
                            are two of them. The count stays as a subtitle
                            because it is the thing you check when deciding
                            whether the folder is the one you meant. */}
                        {item.name || (grid ? GRID_LABELS[grid.spec.kind] : 'Group')}
                        {/* The system, then the count. "Bento 12" says what it
                            is and how big; "Group (12)" says neither. */}
                        <span style={{ marginLeft: 6, opacity: 0.6, fontWeight: 'var(--weight-medium)' }}>
                          {grid && !item.name ? 'grid' : ''} {item.members.length}
                        </span>
                      </span>
                    )}
                    <div className="layer-row__actions" data-sticky={groupHidden || undefined}>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleGroupVisibility(memberIds); }}
                        className="layer-row__btn"
                        data-tooltip={groupHidden ? 'Show group' : 'Hide group'}
                        aria-label={groupHidden ? 'Show group' : 'Hide group'}
                        aria-pressed={groupHidden}
                      >
                        {groupHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleUngroup(item.groupId); }}
                        className="layer-row__btn"
                        data-tooltip={grid ? 'Break the grid apart' : 'Ungroup (Cmd+Shift+G)'}
                        aria-label={grid ? 'Break the grid apart' : 'Ungroup'}
                      >
                        <Ungroup size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
