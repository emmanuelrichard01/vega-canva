import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { updateNode, provider } from '../engine/document';
import { deleteNodesWithFrames } from '../engine/interaction/frameMembership';
import { useStore } from '../hooks/useStore';
import { editor } from '../engine/api/EditorAPI';
import { Type, Square, Image as ImageIcon, StickyNote, Mic, LayoutTemplate, MessageSquare, PenTool, Lock, Unlock, Copy, Trash2, Eye, EyeOff, Layers, FolderOpen, Ungroup } from 'lucide-react';
import { nanoid } from 'nanoid';
import { type AnyNode } from '../engine/model/schema';
import { nodeLabel } from '../engine/model/nodeLabel';
import { tagFilter } from '../engine/model/tagFilter';
import { tagCounts } from '../engine/model/tags';
import { useVirtualRows } from '../hooks/useVirtualRows';

/** Row pitch, in px. Uniform by design so the list can be windowed. */
const ROW_HEIGHT = 36;
const ROW_GAP = 4;

interface LayersPanelProps {
  selectedIds: string[];
  overrideObjects?: Record<string, any> | null;
  setSelectedId: (id: string | null) => void;
  setSelectedIds?: React.Dispatch<React.SetStateAction<string[]>>;
}

export const LayersPanel: React.FC<LayersPanelProps> = ({ selectedIds, overrideObjects, setSelectedId, setSelectedIds }) => {
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  // Was its own independent Yjs subscription (useCanvasObjects), parallel to
  // and redundant with the store every other panel reads from — same data,
  // maintained twice. Nothing kept the two in sync on purpose; they only ever
  // agreed because both ultimately mirror the same Yjs doc. Reading the
  // shared store here removes the duplicate subscription and guarantees this
  // panel can't momentarily disagree with Properties/Canvas/the toolbar.
  const liveObjects = useStore(state => state.objects);
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState('');
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

  const getIcon = (type: string, isSelected: boolean = false) => {
    // Selected rows sit on an amber-500 fill; the row label already switches
    // to amber-950 for contrast there (see renderRow) but this ternary always
    // returned the same value regardless of isSelected, so the icon silently
    // stayed on --text-primary and could end up low-contrast on the fill.
    const c = isSelected ? 'var(--amber-950)' : 'var(--text-primary)';
    switch (type) {
      case 'text': return <Type size={14} color={c} />;
      case 'shape': return <Square size={14} color={c} />;
      case 'path': return <PenTool size={14} color={c} />;
      case 'image': return <ImageIcon size={14} color={c} />;
      case 'sticky': return <StickyNote size={14} color={c} />;
      case 'audio': return <Mic size={14} color={c} />;
      case 'artboard': return <LayoutTemplate size={14} color={c} />;
      case 'comment': return <MessageSquare size={14} color={c} />;
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

  const handleDuplicate = (id: string) => {
    const obj = objects[id];
    if (!obj) return;
    const newId = nanoid();
    editor.createNode({
      ...obj,
      id: newId,
      x: obj.x + 40,
      y: obj.y + 40
    });
    setSelectedId(newId);
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

  const handleDelete = (id: string) => {
    deleteNodesWithFrames([id]);
    if (selectedId === id) setSelectedId(null);
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

  const handleRowClick = (e: React.MouseEvent, id: string) => {
    if (!setSelectedIds) {
      setSelectedId(id);
      return;
    }

    if (e.shiftKey && lastClickedRef.current) {
      const ids = sortedObjects.map(o => o.id);
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

  // Objects sharing a parentId render as one indented cluster under a group
  // header. The tree is flattened into a single list of uniform-height rows
  // (group headers and object rows alike) so the list can be virtualized —
  // rendering a DOM row per object measured at 27ms per document change with
  // 500 objects on canvas, against 3ms with the panel unmounted, making this
  // panel roughly 88% of the cost of moving a single object.
  type FlatRow =
    | { kind: 'object'; obj: AnyNode; indent: number }
    | { kind: 'group'; groupId: string; members: AnyNode[] };

  const flatRows: FlatRow[] = React.useMemo(() => {
    const rows: FlatRow[] = [];
    const seenGroups = new Set<string>();
    sortedObjects.forEach((obj) => {
      if (obj.parentId) {
        if (seenGroups.has(obj.parentId)) return;
        seenGroups.add(obj.parentId);
        const members = sortedObjects.filter((o) => o.parentId === obj.parentId);
        rows.push({ kind: 'group', groupId: obj.parentId, members });
        members.forEach((m) => rows.push({ kind: 'object', obj: m, indent: 20 }));
      } else {
        rows.push({ kind: 'object', obj, indent: 0 });
      }
    });
    return rows;
  }, [sortedObjects]);

  const { containerRef, window: vwindow } = useVirtualRows(flatRows.length, ROW_HEIGHT);
  const visibleRows = flatRows.slice(vwindow.start, vwindow.end);

  const renderRow = (obj: any, indent: number) => {
    const activeEditor = activeEditorsMap.get(obj.id);
    const isEditingThisTitle = editingTitleId === obj.id;
    const isSelected = selectedIds.includes(obj.id);
    const isHovered = hoveredId === obj.id;

    return (
      <div
        key={obj.id}
        draggable
        onDragStart={(e) => handleDragStart(e, obj.id)}
        onDragOver={(e) => handleDragOver(e, obj.id)}
        onDragLeave={() => setDragOverId(null)}
        onDrop={(e) => handleDrop(e, obj.id)}
        onClick={(e) => handleRowClick(e, obj.id)}
        onMouseEnter={() => setHoveredId(obj.id)}
        onMouseLeave={() => setHoveredId(null)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px',
          paddingLeft: `${12 + indent}px`,
          // Fixed height is what makes virtualization possible — see the
          // flattening above and useVirtualRows.
          height: ROW_HEIGHT - ROW_GAP,
          marginBottom: ROW_GAP,
          boxSizing: 'border-box',
          background: isSelected ? 'var(--amber-500)' : (isHovered ? 'var(--surface-hover)' : 'transparent'),
          color: isSelected ? 'var(--amber-950)' : (obj.locked ? 'var(--text-secondary)' : 'var(--text-primary)'),
          borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: isSelected ? 600 : 500,
          transition: 'background 0.2s',
          borderTop: dragOverId === obj.id ? '2px solid var(--amber-500)' : '2px solid transparent',
          opacity: obj.hidden ? 0.4 : (draggedId === obj.id ? 0.5 : 1)
        }}
      >
        {getIcon(obj.type, isSelected)}

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
            style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: obj.locked ? 'line-through' : 'none', color: isSelected ? 'var(--amber-950)' : 'inherit' }}
            data-tooltip="Double click to rename"
          >
            {getName(obj)}
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
          <div style={{ display: 'flex', gap: '6px', opacity: (isSelected || isHovered) ? 1 : 0, transition: 'opacity 0.2s' }}>
            <button
              onClick={(e) => { e.stopPropagation(); toggleVisibility(obj.id); }}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px', display: 'flex' }}
              data-tooltip={obj.hidden ? "Show layer" : "Hide layer"}
            >
              {obj.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); toggleLock(obj.id); }}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px', display: 'flex' }}
              data-tooltip={obj.locked ? "Unlock layer" : "Lock layer"}
            >
              {obj.locked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDuplicate(obj.id); }}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px', display: 'flex' }}
              data-tooltip="Duplicate layer"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(obj.id); }}
              style={{ background: 'transparent', border: 'none', color: Array.from((awarenessStates || new Map()).values()).some((u: any) => Array.isArray(u.selection) && u.selection.includes(obj.id)) ? (isSelected ? 'var(--amber-950)' : 'var(--text-secondary)') : '#EF4444', cursor: 'pointer', padding: '2px', display: 'flex' }}
              data-tooltip="Delete layer"
            >
              <Trash2 size={14} />
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
        style={{ padding: '8px', overflowY: 'auto', overflowX: 'hidden', flex: 1 }}
        className="custom-scrollbar"
      >
        {sortedObjects.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '40px', fontSize: '13px' }}>
            Canvas is empty
          </div>
        ) : (
          // The outer element carries the full scroll height so the scrollbar
          // is honest about the list length, while only the windowed slice is
          // actually in the DOM.
          <div style={{ height: vwindow.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${vwindow.offsetTop}px)` }}>
              {visibleRows.map((item) => {
                if (item.kind === 'object') return renderRow(item.obj, item.indent);

                const memberIds = item.members.map((m) => m.id);
                const groupSelected = memberIds.length > 0 && memberIds.every((id) => selectedIds.includes(id));
                const groupHovered = hoveredId === `group:${item.groupId}`;

                return (
                  <div
                    key={item.groupId}
                    role="treeitem"
                    aria-selected={groupSelected}
                    onClick={(e) => handleGroupClick(e, memberIds)}
                    onMouseEnter={() => setHoveredId(`group:${item.groupId}`)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px',
                      height: ROW_HEIGHT - ROW_GAP,
                      marginBottom: ROW_GAP,
                      boxSizing: 'border-box',
                      background: groupSelected ? 'var(--amber-500)' : (groupHovered ? 'var(--surface-hover)' : 'transparent'),
                      color: groupSelected ? 'var(--amber-950)' : 'var(--text-primary)',
                      borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                      transition: 'background 0.2s',
                    }}
                  >
                    <FolderOpen size={14} />
                    <span style={{ flex: 1 }}>Group ({item.members.length})</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUngroup(memberIds); }}
                      style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px', display: 'flex', opacity: (groupSelected || groupHovered) ? 1 : 0, transition: 'opacity 0.2s' }}
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
