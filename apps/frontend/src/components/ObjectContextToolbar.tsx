import React, { useEffect, useState, useRef } from 'react';
import { objectsMap, updateNode, deleteNode, nextZIndex, lowestZIndex, toggleReaction, localAuthorId } from '../engine/document';
import { useStore } from '../hooks/useStore';
import { cameraSystem } from '../engine/CameraSystem';
import { engineEvents } from '../engine/EventBus';
import { Copy, Trash2, Type, Square, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, MessageSquarePlus, BringToFront, SendToBack, ImageIcon, StickyNote, Pin, SmilePlus, Mic, MessageSquare, PenLine, Layers, Group, Ungroup, Download } from 'lucide-react';
import { editor } from '../engine/api/EditorAPI';
import { nanoid } from 'nanoid';
import { ColorPickerPopover } from './ui/ColorPickerPopover';
import { NumberStepper } from './ui/NumberStepper';
import { SegmentedControl } from './ui/SegmentedControl';
import { FontSelector } from './ui/FontSelector';
import { THEMES, nearestTheme } from './canvas/renderers/StickyRenderer';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DEFAULT_TYPOGRAPHY,
  type Appearance,
  type TextAlign,
  type Typography,
} from '../engine/model/schema';

/** Small pressed-state toggle used by the typography row. */
const StyleToggle: React.FC<{ active: boolean; tooltip: string; onClick: () => void; children: React.ReactNode }> = ({ active, tooltip, onClick, children }) => (
  <button
    className="btn-icon"
    data-tooltip={tooltip}
    aria-label={tooltip}
    aria-pressed={active}
    onClick={onClick}
    style={{
      padding: '4px', borderRadius: '4px',
      background: active ? 'var(--surface-primary)' : 'transparent',
      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      boxShadow: active ? 'var(--shadow-sm)' : 'none',
    }}
  >
    {children}
  </button>
);

interface Props {
  selectedId: string | null;
  selectedIds?: string[];
  onDeselect: () => void;
  /** Whether the Layers/Properties sidebars and bottom tool dock are currently on screen — when the UI is hidden (\), the toolbar can use the full viewport width. */
  sidebarsVisible?: boolean;
}

// Matches .hierarchy-panel / .context-inspector in index.css: 16px inset + 260px wide.
const SIDEBAR_WIDTH = 276;
const BOTTOM_DOCK_HEIGHT = 76; // ToolWorkspace's floating dock + its bottom margin
const EDGE_MARGIN = 16;

/** Small, deliberately-limited reaction set — a full emoji picker is noise here. */
const REACTION_SET = ['👍', '❤️', '🎯', '🔥', '❓'];

const TYPE_ICON: Record<string, React.ReactNode> = {
  shape: <Square size={16} />,
  text: <Type size={16} />,
  image: <ImageIcon size={16} />,
  sticky: <StickyNote size={16} />,
  audio: <Mic size={16} />,
  comment: <MessageSquare size={16} />,
  path: <PenLine size={16} />,
};

export const ObjectContextToolbar: React.FC<Props> = ({ selectedId, selectedIds, onDeselect, sidebarsVisible = true }) => {
  const [position, setPosition] = useState({ x: -9999, y: -9999 });
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const [isVisible, setIsVisible] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const myAuthorId = localAuthorId();
  const isDraggingRef = useRef(false);
  const reactionsRef = useRef<HTMLDivElement>(null);
  // Mirrors state, read inside the RAF loop so it can skip setState (and the
  // re-render that comes with it) on frames where nothing actually moved —
  // the loop itself has to keep running unconditionally (it's the only thing
  // that tracks the toolbar smoothly during a live drag), but 60 renders/sec
  // of an idle, unchanged toolbar was pure waste.
  const lastRef = useRef({ x: -9999, y: -9999, placement: 'top' as 'top' | 'bottom', visible: false });

  // Multiple objects selected -> a reduced bulk-actions toolbar instead of the
  // full per-type editor below (mixed types have no coherent shared style panel).
  const isBulk = (selectedIds?.length || 0) > 1;
  const bulkIds = selectedIds || [];
  const activeId = isBulk ? null : selectedId;

  // Stable-identity mirror of the selection, read imperatively by the RAF loop
  // in the positioning effect below. That effect used to depend on
  // `bulkIds.join(',')` — a string rebuilt every render specifically to avoid
  // re-subscribing when the parent handed down a new array with identical
  // contents. It worked, but it hid `bulkIds` from the dependency checker and
  // made the whole listener set tear down and rebuild whenever the selection
  // changed. The loop recomputes bounds every frame anyway, so reading the
  // current selection from a ref is both cheaper and statically honest.
  // Keyed on the `selectedIds` prop, not on `bulkIds`: the latter is
  // `selectedIds || []`, so it is a brand-new array on any render where the
  // prop is absent, which would make this effect run every render.
  const bulkIdsRef = useRef(bulkIds);
  useEffect(() => {
    bulkIdsRef.current = selectedIds || [];
  }, [selectedIds]);

  // The single-select panel below used to read `objectsMap.get(activeId).toJSON()`
  // directly on every render — which only happens when this component's own state
  // changes (position/visibility), not when the Yjs doc does. So any edit made
  // elsewhere (Properties panel, another client) sat invisible here until something
  // unrelated (e.g. dragging the object) forced a re-render. Subscribing to the
  // same reactive store the Properties panel uses keeps this toolbar's controls
  // live instead of stale.
  const liveNode = useStore(state => (activeId ? state.objects[activeId] : undefined));

  useEffect(() => {
    if (!activeId && !isBulk) {
      setIsVisible(false);
      return;
    }

    const updatePosition = () => {
      if (isDraggingRef.current) {
        if (lastRef.current.visible) {
          lastRef.current.visible = false;
          setIsVisible(false);
        }
        return;
      }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const ids = isBulk ? bulkIdsRef.current : (activeId ? [activeId] : []);
      // Bounds come from the canonical store rather than raw Y.Maps, so a
      // legacy node reports the same size here as it renders at.
      const store = useStore.getState().objects;
      for (const id of ids) {
        const node = store[id];
        if (!node) continue;
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + node.width);
        maxY = Math.max(maxY, node.y + node.height);
      }
      if (minX === Infinity) {
        if (lastRef.current.visible) {
          lastRef.current.visible = false;
          setIsVisible(false);
        }
        return;
      }

      const screenX = (minX * cameraSystem.zoom) + cameraSystem.x;
      const screenY = (minY * cameraSystem.zoom) + cameraSystem.y;
      const screenW = (maxX - minX) * cameraSystem.zoom;
      const screenH = (maxY - minY) * cameraSystem.zoom;

      let y = screenY - 20;
      let currentPlacement: 'top' | 'bottom' = 'top';
      if (y < 80) {
        y = screenY + screenH + 20;
        currentPlacement = 'bottom';
      }
      // A 'bottom' placement can land the toolbar under the floating tool
      // dock when the selection sits near the bottom of the viewport — clamp
      // it back up rather than letting the two overlap.
      const dockLimit = window.innerHeight - (sidebarsVisible ? BOTTOM_DOCK_HEIGHT : EDGE_MARGIN);
      if (currentPlacement === 'bottom' && y > dockLimit) {
        y = dockLimit;
      }

      const leftBound = (sidebarsVisible ? SIDEBAR_WIDTH : EDGE_MARGIN) + 4;
      const rightBound = window.innerWidth - (sidebarsVisible ? SIDEBAR_WIDTH : EDGE_MARGIN) - 4;
      const x = Math.max(leftBound, Math.min(Math.max(leftBound, rightBound), screenX + (screenW / 2)));

      const rx = Math.round(x), ry = Math.round(y);
      const last = lastRef.current;
      if (last.x !== rx || last.y !== ry || last.placement !== currentPlacement || !last.visible) {
        lastRef.current = { x: rx, y: ry, placement: currentPlacement, visible: true };
        setPosition({ x: rx, y: ry });
        setPlacement(currentPlacement);
        setIsVisible(true);
      }
    };

    const handleCamera = () => updatePosition();
    const handleObjects = () => updatePosition();
    const handleDragStart = () => { isDraggingRef.current = true; lastRef.current.visible = false; setIsVisible(false); };
    const handleDragEnd = () => { isDraggingRef.current = false; updatePosition(); };

    engineEvents.on('CameraChanged', handleCamera);
    engineEvents.on('ObjectMoved', handleObjects);
    engineEvents.on('ObjectModified', handleObjects);
    window.addEventListener('canvas-drag-start', handleDragStart);
    window.addEventListener('canvas-drag-end', handleDragEnd);

    updatePosition();

    let frame: number;
    const loop = () => {
      updatePosition();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      engineEvents.off('CameraChanged', handleCamera);
      engineEvents.off('ObjectMoved', handleObjects);
      engineEvents.off('ObjectModified', handleObjects);
      window.removeEventListener('canvas-drag-start', handleDragStart);
      window.removeEventListener('canvas-drag-end', handleDragEnd);
      cancelAnimationFrame(frame);
    };
  }, [activeId, isBulk, sidebarsVisible]);

  // The reactions popover previously only closed when you picked an emoji or
  // hit its own clear button — clicking anywhere else on the canvas (or just
  // deselecting) left it floating open indefinitely.
  useEffect(() => {
    if (!showReactions) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (reactionsRef.current && !reactionsRef.current.contains(event.target as Node)) {
        setShowReactions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showReactions]);

  // Deselecting (Escape, clicking empty canvas, switching objects) should
  // always close any popover this toolbar has open, not leave it stranded.
  useEffect(() => {
    setShowReactions(false);
  }, [activeId, isBulk]);

  if ((!activeId && !isBulk) || !isVisible) return null;

  if (isBulk) {
    const handleBulkDuplicate = () => {
      bulkIds.forEach(id => {
        const ymap = objectsMap.get(id);
        if (!ymap) return;
        const node = ymap.toJSON() as any;
        editor.createNode({ ...node, id: nanoid(), x: node.x + 20, y: node.y + 20 });
      });
    };
    const handleBulkDelete = () => {
      bulkIds.forEach(id => deleteNode(id));
      onDeselect();
    };
    const handleBulkZ = (dir: 'front' | 'back') => {
      // See Canvas.tsx: reading `.zIndex` as a plain property off a Y.Map
      // always yields undefined, so this used to compute 0 for both bounds.
      const base = dir === 'front' ? nextZIndex() : lowestZIndex() - bulkIds.length;
      bulkIds.forEach((id, i) => updateNode(id, { zIndex: base + i }));
    };

    // The selection already *is* one whole group when every member shares
    // the same parentId and no other object outside the selection belongs
    // to it — that's when Ungroup makes sense instead of Group.
    const firstParent = (objectsMap.get(bulkIds[0])?.toJSON() as any)?.parentId;
    const isWholeGroup = !!firstParent && bulkIds.every(id => (objectsMap.get(id)?.toJSON() as any)?.parentId === firstParent)
      && Array.from(objectsMap.values()).every((o: any) => o.parentId !== firstParent || bulkIds.includes(o.id));

    return (
      <AnimatePresence>
        {isVisible && (
          <motion.div
            key="bulk"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 400 }}
            style={{
              position: 'absolute',
              left: position.x,
              top: position.y,
              transform: `translate(-50%, ${placement === 'top' ? '-100%' : '0%'})`,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              zIndex: 200,
              pointerEvents: 'auto',
              borderRadius: '12px',
              backdropFilter: 'blur(20px)',
              background: 'var(--surface-primary)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 0 0 1px var(--border-divider)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', paddingRight: '10px', borderRight: '1px solid var(--border-divider)', fontSize: '12px', fontWeight: 600 }}>
              <Layers size={14} /> {bulkIds.length} selected
            </div>
            {isWholeGroup ? (
              <button className="btn-icon" data-tooltip="Ungroup (Cmd+Shift+G)" style={{ padding: '6px' }} onClick={() => editor.ungroupNodes(bulkIds)}><Ungroup size={16} /></button>
            ) : (
              <button className="btn-icon" data-tooltip="Group (Cmd+G)" style={{ padding: '6px' }} onClick={() => editor.groupNodes(bulkIds)}><Group size={16} /></button>
            )}
            <div style={{ width: '1px', height: '20px', background: 'var(--border-divider)' }} />
            <button className="btn-icon" data-tooltip="Bring to Front (Cmd+Shift+])" style={{ padding: '6px' }} onClick={() => handleBulkZ('front')}><BringToFront size={16} /></button>
            <button className="btn-icon" data-tooltip="Send to Back (Cmd+Shift+[)" style={{ padding: '6px' }} onClick={() => handleBulkZ('back')}><SendToBack size={16} /></button>
            <button className="btn-icon" data-tooltip="Duplicate (Cmd+D)" style={{ padding: '6px' }} onClick={handleBulkDuplicate}><Copy size={16} /></button>
            <button className="btn-icon" data-tooltip="Delete (Del)" style={{ padding: '6px', color: '#ef4444' }} onClick={handleBulkDelete}><Trash2 size={16} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  if (!liveNode) return null;
  const node = liveNode;

  const handleDuplicate = () => {
    const clone = { ...node, id: nanoid(), x: node.x + 20, y: node.y + 20 };
    editor.createNode(clone);
  };

  const handleDelete = () => {
    deleteNode(activeId!);
    onDeselect();
  };

  const handleAddComment = () => {
    engineEvents.emit('CommentDraftRequested', { x: node.x + node.width, y: node.y, objectId: activeId });
  };

  const updateProp = (updates: any) => {
    editor.updateNode(activeId!, updates);
  };

  // Only text and shapes carry their own typography; stickies use a fixed
  // handwriting face and everything else has none.
  const typography: Typography | null =
    node.type === 'text' ? node.typography
    : node.type === 'shape' ? (node.typography ?? DEFAULT_TYPOGRAPHY)
    : null;

  const setTypography = (patch: Partial<Typography>) =>
    updateProp({ typography: { ...(typography ?? DEFAULT_TYPOGRAPHY), ...patch } });

  const appearance: Appearance = ('appearance' in node ? node.appearance : undefined) ?? {};
  const setAppearance = (patch: Partial<Appearance>) =>
    updateProp({ appearance: { ...appearance, ...patch } });

  const bringToFront = () => updateProp({ zIndex: nextZIndex() });
  const sendToBack = () => updateProp({ zIndex: lowestZIndex() - 1 });

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key={activeId}
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 400 }}
          style={{
            position: 'absolute',
            left: position.x,
            top: position.y,
            transform: `translate(-50%, ${placement === 'top' ? '-100%' : '0%'})`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            padding: '8px 12px',
            gap: '8px',
            zIndex: 200,
            pointerEvents: 'auto',
            borderRadius: '12px',
            backdropFilter: 'blur(20px)',
            background: 'var(--surface-primary)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 0 0 1px var(--border-divider)',
          }}
        >
          {/* Row 1: Tools */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '8px', borderBottom: '1px solid var(--border-divider)' }}>
            {/* Icon Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', paddingRight: '12px', borderRight: '1px solid var(--border-divider)' }}>
            {TYPE_ICON[node.type] || null}
          </div>

          {/* Dynamic tools based on node type */}
          {(node.type === 'shape' || node.type === 'path') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <ColorPickerPopover
                color={appearance.fill?.[0]?.color ?? '#000000'}
                onChange={(color) => setAppearance({ fill: [{ type: 'solid', color, opacity: 1 }] })}
                label="Fill"
              />
              {/* A freehand (Pencil) stroke is a filled outline blob with no
                  separate stroke render path — showing stroke controls for it
                  would silently do nothing. Anchor/bezier paths from the Pen
                  tool do render a real stroke, same as shapes. */}
              {(node.type === 'shape' || node.geometry.kind === 'bezier') && (
                <>
                  <ColorPickerPopover
                    color={appearance.stroke?.color ?? 'transparent'}
                    onChange={(color) => setAppearance({ stroke: { width: appearance.stroke?.width ?? 2, ...appearance.stroke, color } })}
                    label="Stroke"
                  />
                  <NumberStepper
                    value={appearance.stroke?.width ?? 2}
                    onChange={(width) => setAppearance({ stroke: { color: appearance.stroke?.color ?? '#000000', ...appearance.stroke, width } })}
                    min={0} max={100} label="W"
                  />
                </>
              )}
              {node.type === 'shape' && node.geometry.kind === 'rect' && (
                <NumberStepper
                  value={appearance.cornerRadius ?? 0}
                  onChange={(cornerRadius) => setAppearance({ cornerRadius })}
                  min={0} max={200} label="R"
                />
              )}
            </div>
          )}

          {typography && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FontSelector
                value={typography.fontFamily}
                onChange={(fontFamily) => setTypography({ fontFamily })}
              />
              <NumberStepper
                value={typography.fontSize}
                onChange={(fontSize) => setTypography({ fontSize })}
                min={8} max={500}
              />
              {/* One canonical typography block, so these controls, the
                  Properties panel and Cmd+B/I/U all write the same fields. */}
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-hover)', padding: '2px', borderRadius: '6px' }}>
                <StyleToggle active={typography.fontWeight >= 600} tooltip="Bold" onClick={() => setTypography({ fontWeight: typography.fontWeight >= 600 ? 400 : 700 })}><Bold size={14} /></StyleToggle>
                <StyleToggle active={typography.italic} tooltip="Italic" onClick={() => setTypography({ italic: !typography.italic })}><Italic size={14} /></StyleToggle>
                <StyleToggle active={typography.underline} tooltip="Underline" onClick={() => setTypography({ underline: !typography.underline })}><Underline size={14} /></StyleToggle>
              </div>
              <SegmentedControl
                value={typography.align}
                onChange={(align) => setTypography({ align: align as TextAlign })}
                segments={[
                  { value: 'left', icon: <AlignLeft size={14} /> },
                  { value: 'center', icon: <AlignCenter size={14} /> },
                  { value: 'right', icon: <AlignRight size={14} /> },
                ]}
              />
              <ColorPickerPopover
                color={typography.color}
                onChange={(color) => setTypography({ color })}
              />
            </div>
          )}

          {/* Voice notes had *no* quick actions at all — every other type has
              them, and this one is the hardest to get anything out of, because
              PNG export omits the player and SVG draws a placeholder. Saving
              the file is the action that was actually missing. */}
          {node.type === 'audio' && node.src && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <a
                className="btn-icon"
                href={node.src}
                download={`voice-note-${node.author.name.replace(/\s+/g, '-').toLowerCase()}.webm`}
                data-tooltip="Download recording"
                aria-label="Download recording"
                style={{ padding: '4px', display: 'flex', color: 'var(--text-secondary)' }}
              >
                <Download size={14} />
              </a>
            </div>
          )}

          {node.type === 'sticky' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <ColorPickerPopover
                color={THEMES[node.theme]?.bg ?? '#FDE047'}
                onChange={(color) => updateProp({ theme: nearestTheme(color) })}
                label="Bg"
              />
              <NumberStepper
                value={node.fontSize ?? 16}
                onChange={(fontSize) => updateProp({ fontSize })}
                min={8} max={72} label="Size"
              />
              <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-divider)' }} />
              <button 
                className="btn-icon"
                data-tooltip={node.pinned ? "Unpin" : "Pin"}
                style={{
                  padding: '4px', borderRadius: '4px',
                  background: node.pinned ? 'var(--surface-primary)' : 'transparent',
                  color: node.pinned ? 'var(--text-primary)' : 'var(--text-secondary)',
                  boxShadow: node.pinned ? 'var(--shadow-sm)' : 'none'
                }}
                onClick={() => updateProp({ pinned: !node.pinned })}
              >
                <Pin size={14} fill={node.pinned ? 'currentColor' : 'none'} />
              </button>

              {/* Reaction picker.
                  StickyRenderer already renders a reactions row, but nothing ever wrote
                  reaction data — so the feature was permanently invisible. This is the
                  missing write path. */}
              <div style={{ position: 'relative' }} ref={reactionsRef}>
                <button
                  className="btn-icon"
                  data-tooltip="React"
                  style={{ padding: '4px', borderRadius: '4px', color: 'var(--text-secondary)' }}
                  onClick={() => setShowReactions(v => !v)}
                >
                  <SmilePlus size={14} />
                </button>
                {showReactions && (
                  <div
                    className="panel-surface"
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      marginBottom: 6,
                      display: 'flex',
                      gap: 2,
                      padding: 4,
                      borderRadius: 8,
                      zIndex: 30,
                      animation: 'popIn 160ms var(--ease-settle)',
                    }}
                  >
                    {REACTION_SET.map(emoji => {
                      const mine = (node.reactions[emoji] ?? []).includes(myAuthorId);
                      return (
                        <button
                          key={emoji}
                          // A toggle, not a counter. This used to write
                          // `count + 1`, so one person could react five times
                          // and nobody could take a reaction back.
                          onClick={() => {
                            toggleReaction(node.id, emoji, myAuthorId);
                            setShowReactions(false);
                          }}
                          aria-pressed={mine}
                          title={mine ? `Remove ${emoji}` : `React ${emoji}`}
                          style={{
                            background: mine ? 'var(--surface-active)' : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 16,
                            lineHeight: 1,
                            padding: '4px 6px',
                            borderRadius: 6,
                            transition: 'var(--motion-hover)',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
                          onMouseLeave={e =>
                            (e.currentTarget.style.background = mine
                              ? 'var(--surface-active)'
                              : 'transparent')
                          }
                        >
                          {emoji}
                        </button>
                      );
                    })}
                    {/* "Clear reactions" used to live here. It deleted
                        *everyone's* reactions, which is not a thing any
                        participant should be able to do to the others — and it
                        only existed because there was no way to take your own
                        back. Picking your own emoji again removes it. */}
                  </div>
                )}
              </div>
            </div>
          )}

          </div>

          {/* Row 2: Global Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Opacity Control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--surface-hover)', padding: '4px 8px', borderRadius: '6px' }} title="Transparency">
              <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>OPACITY</span>
              <input 
                type="range" 
                min="0" max="100" 
                value={Math.round((node.opacity ?? 1) * 100)} 
                onChange={(e) => updateProp({ opacity: Number(e.target.value) / 100 })}
                style={{ width: '60px', cursor: 'pointer', accentColor: 'var(--text-primary)' }}
              />
              <span style={{ fontSize: '10px', color: 'var(--text-primary)', width: '24px', textAlign: 'right', fontFamily: 'monospace' }}>
                {Math.round((node.opacity ?? 1) * 100)}%
              </span>
            </div>
            <div style={{ width: '1px', height: '20px', margin: '0 2px', backgroundColor: 'var(--border-divider)' }} />
            <button className="btn-icon" data-tooltip="Comment on this object" style={{ padding: '6px' }} onClick={handleAddComment}><MessageSquarePlus size={16} /></button>
            <div style={{ width: '1px', height: '20px', margin: '0 2px', backgroundColor: 'var(--border-divider)' }} />
            <button className="btn-icon" data-tooltip="Bring to Front (Cmd+Shift+])" style={{ padding: '6px' }} onClick={bringToFront}><BringToFront size={16} /></button>
            <button className="btn-icon" data-tooltip="Send to Back (Cmd+Shift+[)" style={{ padding: '6px' }} onClick={sendToBack}><SendToBack size={16} /></button>
            <button className="btn-icon" data-tooltip="Duplicate (Cmd+D)" style={{ padding: '6px' }} onClick={handleDuplicate}><Copy size={16} /></button>
            <button className="btn-icon" data-tooltip="Delete (Del)" style={{ padding: '6px', color: '#ef4444' }} onClick={handleDelete}><Trash2 size={16} /></button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
