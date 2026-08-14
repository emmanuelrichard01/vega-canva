import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { updateNode, applyNodePatches, provider } from '../engine/document';
import { deleteNodesWithFrames } from '../engine/interaction/frameMembership';
import { useStore } from '../hooks/useStore';
import { editor } from '../engine/api/EditorAPI';
import { Type, Square, Image as ImageIcon, StickyNote, Mic, LayoutTemplate, MessageSquare, PenTool, Lock, Unlock, Copy, Trash2, Eye, EyeOff, Layers, FolderOpen, Ungroup, Frame as FrameIcon, ChevronRight, ChevronDown, Search, X, PanelLeftClose, Spline } from 'lucide-react';
import { nanoid } from 'nanoid';
import { type AnyNode, type NodeType } from '../engine/model/schema';
import { nodeLabel } from '../engine/model/nodeLabel';
import { paintColor } from '../engine/model/paint';
import { readableOn } from '../engine/model/color';
import { THEMES } from './canvas/renderers/StickyRenderer';
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

/** Node types, in the order their chips are offered. Frames first, because that is where people look. */
const TYPE_ORDER: NodeType[] = ['frame', 'text', 'shape', 'path', 'image', 'sticky', 'audio', 'comment'];

const TYPE_LABEL: Partial<Record<NodeType, string>> = {
  frame: 'Frames',
  text: 'Text',
  shape: 'Shapes',
  path: 'Paths',
  image: 'Images',
  sticky: 'Notes',
  audio: 'Audio',
  comment: 'Comments',
};

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
  const [dragOverId, setDragOverId] = useState<string | null>(null);
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
          color: state.user.color || '#EC4899',
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

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id !== draggedId) setDragOverId(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) return;

    const newOrder = [...sortedObjects];
    const draggedIndex = newOrder.findIndex(o => o.id === draggedId);
    const draggedItem = newOrder[draggedIndex];
    newOrder.splice(draggedIndex, 1);

    const targetIndex = newOrder.findIndex(o => o.id === targetId);
    newOrder.splice(targetIndex, 0, draggedItem);

    newOrder.forEach((obj, index) => {
      if (obj.zIndex !== newOrder.length - index) {
        updateNode(obj.id, { zIndex: newOrder.length - index });
      }
    });
    setDraggedId(null);
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
    | { kind: 'group'; groupId: string; members: AnyNode[]; indent: number };

  /**
   * Indent per level of frame nesting, in px.
   *
   * Smaller than the group cluster's 20 because frames nest and groups do not:
   * three levels deep at 20px leaves no room for a name in a 260px panel.
   */
  const FRAME_INDENT = 16;

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

    const rows: FlatRow[] = [];
    // `frameForNode` cannot produce a cycle, but a hand-edited or concurrently
    // merged document is not bound by that, and a cycle here would hang the tab
    // rather than mis-indent a rectangle.
    const openFrames = new Set<string>();

    const emit = (list: AnyNode[], indent: number) => {
      const seenGroups = new Set<string>();
      list.forEach((obj: any) => {
        if (obj.parentId) {
          if (seenGroups.has(obj.parentId)) return;
          seenGroups.add(obj.parentId);
          const members = list.filter((o: any) => o.parentId === obj.parentId);
          rows.push({ kind: 'group', groupId: obj.parentId, members, indent });
          members.forEach((m) => rows.push({ kind: 'object', obj: m, indent: indent + 20 }));
          return;
        }

        if (obj.type === 'frame' && !openFrames.has(obj.id)) {
          const children = childrenOf.get(obj.id) ?? [];
          rows.push({ kind: 'frame', obj, indent, childCount: children.length });
          if (children.length > 0 && !collapsedFrames.has(obj.id)) {
            openFrames.add(obj.id);
            emit(children, indent + FRAME_INDENT);
            openFrames.delete(obj.id);
          }
          return;
        }

        rows.push({ kind: 'object', obj, indent });
      });
    };

    emit(roots, 0);
    return rows;
  }, [sortedObjects, objects, collapsedFrames, matches]);

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

  const handleUngroup = (memberIds: string[]) => {
    editor.ungroupNodes(memberIds);
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
  const restack = (direction: 'up' | 'down') => {
    const chosen = selectedIds.length > 0 ? selectedIds : cursorId ? [cursorId] : [];
    if (chosen.length === 0) return;
    const step = direction === 'up' ? 1 : -1;
    applyNodePatches(
      chosen.map((id) => {
        const node = objects[id];
        return node ? { id, changes: { zIndex: node.zIndex + step } } : { id, changes: {} };
      })
    );
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

    const mod = e.metaKey || e.ctrlKey;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (mod) restack('up');
        else moveCursor(1, e.shiftKey);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (mod) restack('down');
        else moveCursor(-1, e.shiftKey);
        return;
      case 'ArrowRight':
        // Fold and unfold act on frames only; on anything else the key is
        // free to do nothing rather than being swallowed.
        if (cursorId && collapsedFrames.has(cursorId)) {
          e.preventDefault();
          toggleFrameCollapsed(cursorId);
        }
        return;
      case 'ArrowLeft':
        if (cursorId && objects[cursorId]?.type === 'frame' && !collapsedFrames.has(cursorId)) {
          e.preventDefault();
          toggleFrameCollapsed(cursorId);
        }
        return;
      case 'Enter':
        if (cursorId) {
          e.preventDefault();
          setEditingTitleId(cursorId);
        }
        return;
      case ' ':
      case 'Spacebar':
        if (cursorId) {
          e.preventDefault();
          toggleVisibility(cursorId);
        }
        return;
      case 'Delete':
      case 'Backspace':
        if (selectedIds.length > 0) {
          e.preventDefault();
          handleBulkDelete();
        }
        return;
      case 'a':
      case 'A':
        if (mod && setSelectedIds) {
          e.preventDefault();
          setSelectedIds(visibleObjectIds);
        }
        return;
      case 'Escape':
        e.preventDefault();
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
        onDragLeave={() => setDragOverId(null)}
        onDrop={(e) => handleDrop(e, obj.id)}
        onClick={(e) => handleRowClick(e, obj.id)}
        className={`layer-row${isSelected ? ' is-selected' : ''}`}
        style={{
          padding: '0 8px 0 ' + (12 + indent) + 'px',
          // Fixed height is what makes virtualization possible — see the
          // flattening above and useVirtualRows.
          height: ROW_HEIGHT - ROW_GAP,
          marginBottom: ROW_GAP,
          color: obj.locked ? 'var(--text-secondary)' : 'var(--text-primary)',
          borderTop: dragOverId === obj.id ? '2px solid var(--brand-orange)' : '2px solid transparent',
          opacity: obj.hidden ? 0.45 : (draggedId === obj.id ? 0.5 : 1),
        }}
      >
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
            style={{ flex: 1, background: 'var(--surface-primary)', border: '1px solid var(--border-focus)', borderRadius: '4px', padding: '2px 6px', color: 'var(--text-primary)', fontSize: '12px', outline: 'none' }}
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
              color: 'white', padding: '2px 6px', borderRadius: '10px', fontSize: '10px', fontWeight: 600
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
              onClick={(e) => { e.stopPropagation(); toggleVisibility(obj.id); }}
              data-tooltip={obj.hidden ? 'Show' : 'Hide'}
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
        <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '13px', flex: 1 }}>Layers</span>
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
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>{selectedIds.length} selected</span>
            <button className="btn-icon" style={{ padding: '4px' }} onClick={handleBulkDuplicate} data-tooltip="Duplicate selected (Cmd+D)">
              <Copy size={14} />
            </button>
            <button className="btn-icon" style={{ padding: '4px', color: '#ef4444' }} onClick={handleBulkDelete} data-tooltip="Delete selected (Del)">
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
        style={{ padding: '8px', overflowY: 'auto', overflowX: 'hidden', flex: 1, outline: 'none' }}
        className="custom-scrollbar"
      >
        {sortedObjects.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '40px', fontSize: '13px' }}>
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

                return (
                  <div
                    key={item.groupId}
                    role="treeitem"
                    aria-selected={groupSelected}
                    onClick={(e) => handleGroupClick(e, memberIds)}
                    className={`layer-row${groupSelected ? ' is-selected' : ''}`}
                    style={{
                      padding: '0 8px 0 ' + (12 + item.indent) + 'px',
                      height: ROW_HEIGHT - ROW_GAP,
                      marginBottom: ROW_GAP,
                      fontWeight: 'var(--weight-semibold)',
                    }}
                  >
                    <span aria-hidden />
                    <span className="layer-row__icon"><FolderOpen size={14} /></span>
                    <span className="layer-row__name">Group ({item.members.length})</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUngroup(memberIds); }}
                      className="layer-row__btn"
                      data-tooltip="Ungroup (Cmd+Shift+G)"
                      aria-label="Ungroup"
                    >
                      <Ungroup size={14} />
                    </button>
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
