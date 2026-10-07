import React, { useEffect, useSyncExternalStore } from 'react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { Layers, Lock, MessageSquarePlus, PaintRoller, Unlock } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../hooks/useStore';
import { booleanPreview } from '../engine/interaction/booleanPreview';
import { canPasteStyle, styleClipboard, type StyleSnapshot } from '../engine/model/styleClipboard';
import { kindNoun } from '../engine/model/selectMatching';
import type { AnyNode } from '../engine/model/schema';
import { FeatureBoundary } from './ui/FeatureBoundary';
import { selectionMenu, type CanvasContextMenuActions } from './menu/canvasMenu';
import { SHORTCUTS, withShortcut } from './menu/shortcuts';
import { Divider, Rail, RailButton, RailMenuButton } from './toolbar/RailBase';
import { useRailPlacement } from './toolbar/rail/useRailPlacement';
import { RAIL_SECTIONS } from './toolbar/rail/registry';
import { railSubjectOf } from './toolbar/rail/subject';
import { KindLabel } from './toolbar/rail/kind';
import { kindOf } from './toolbar/rail/kindOf';
import { MultiRail } from './toolbar/rail/MultiRail';
import { describeMix } from './toolbar/rail/describeMix';
import './toolbar/rail/rail.css';

/**
 * The floating contextual rail.
 *
 * One 40px row whatever is selected. Each subject's controls live in its own
 * module under `toolbar/rail/`, registered by subject, and every subject fills
 * the same anatomy: kind, paint, verbs, a conditional Paste style, then the
 * tail. This file is the frame around them: where the rail stands, which
 * module draws it, the locked state, and the tail every subject ends with.
 *
 * Several objects get the union rail (`MultiRail`): what the selection is
 * when it has a uniform subject, then arrangement, structure and what they all
 * share. A control that cannot apply to all of them is not shown.
 */

interface Props {
  selectedId: string | null;
  selectedIds?: string[];
  onDeselect: () => void;
  /** Whether the side panels and bottom dock are on screen. */
  sidebarsVisible?: boolean;
  /**
   * The board's commands, the same object the right-click menu runs, so a
   * command reached from here and from a right-click cannot differ.
   */
  menuActions: CanvasContextMenuActions;
}

const EMPTY_NODES: AnyNode[] = [];

const ObjectContextToolbarInner: React.FC<Props> = ({ selectedId, selectedIds, sidebarsVisible = true, menuActions }) => {
  const isBulk = (selectedIds?.length || 0) > 1;
  const bulkIds = selectedIds || [];
  const activeId = isBulk ? null : selectedId;

  const { anchorRef, railRef, placement, clear, isVisible } = useRailPlacement({
    activeId,
    isBulk,
    selectedIds,
    sidebarsVisible,
  });

  const liveNode = useStore((state) => (activeId ? state.objects[activeId] : undefined));
  // The selected nodes compared element by element: the whole map changes on
  // every edit anywhere on the board, and the rail should not re-render for it.
  const bulkNodes = useStore(
    useShallow((state) => (isBulk ? (bulkIds.map((id) => state.objects[id]).filter(Boolean) as AnyNode[]) : EMPTY_NODES))
  );
  // A table's or code block's editor brings its own bar; the object rail steps back.
  const tableEditing = useStore((s) => s.tableEditNodeId);
  const codeEditing = useStore((s) => s.codeEditNodeId);
  const copiedStyle = useSyncExternalStore(styleClipboard.subscribe, styleClipboard.get, styleClipboard.get);

  // A combine preview must not outlive the rail that showed it: a selection
  // change unmounts the button under the pointer without `pointerleave`.
  useEffect(() => () => booleanPreview.set(null), []);
  useEffect(() => {
    booleanPreview.set(null);
  }, [activeId, isBulk, selectedIds]);

  if ((!activeId && !isBulk) || !isVisible) return null;

  /** The `⋯`: the right-click menu for what the rail shows, built when opened. */
  const moreButton = (nodes: AnyNode[]) => (
    <RailMenuButton
      entries={() =>
        selectionMenu({
          nodes,
          allObjects: useStore.getState().objects,
          actions: menuActions,
          canEdit: true,
          style: styleClipboard.get(),
          atPointer: false,
        })
      }
    />
  );

  /** Paste style, only while a copied style would land here, wearing the colour it brings. */
  const pasteStyle = (nodes: AnyNode[], style: StyleSnapshot | null) =>
    style && !(nodes.length === 1 && nodes[0].id === style.sourceId) && canPasteStyle(nodes, style) ? (
      <RailButton
        label="Paste style"
        hint={withShortcut(`Paste the copied ${kindNoun({ type: style.sourceType } as AnyNode, false)} style`, SHORTCUTS.pasteStyle)}
        onClick={menuActions.pasteStyle}
      >
        <span className="ctx-paste-style">
          <PaintRoller size={16} />
          {style.swatch && <i style={{ background: style.swatch }} aria-hidden="true" />}
        </span>
      </RailButton>
    ) : null;

  const commentButton = (
    <RailButton label="Comment" hint="Comment on this (C)" onClick={menuActions.comment}>
      <MessageSquarePlus size={16} />
    </RailButton>
  );

  const frame = (key: string, label: string, children: React.ReactNode) => (
    <AnimatePresence>
      <Rail id={key} label={label} placement={placement} clear={clear} anchorRef={anchorRef} ref={railRef}>
        {children}
      </Rail>
    </AnimatePresence>
  );

  /**
   * A locked selection says so and offers one way out. Copying, exporting and
   * commenting on a locked object are still what it is for, so `⋯` stays.
   */
  const lockedRail = (key: string, chip: React.ReactNode, label: string, nodes: AnyNode[]) =>
    frame(
      `${key}-locked`,
      label,
      <>
        {chip}
        <Divider />
        <span
          className="ctx-locked"
          data-tooltip={nodes.length === 1 ? 'Locked, so it cannot be moved or restyled' : 'All locked, so they cannot be moved or restyled'}
        >
          <Lock size={13} aria-hidden="true" />
          Locked
        </span>
        <RailButton label="Unlock" hint={withShortcut('Unlock to edit', SHORTCUTS.lock)} onClick={menuActions.toggleLock}>
          <Unlock size={16} />
        </RailButton>
        <Divider />
        {nodes.length === 1 && commentButton}
        {moreButton(nodes)}
      </>
    );

  if (isBulk) {
    const label = `${bulkNodes.length} objects`;
    if (bulkNodes.length > 0 && bulkNodes.every((n) => n.locked)) {
      const chip = (
        <span className="ctx-kind" data-tooltip={describeMix(bulkNodes)}>
          <Layers size={15} />
          {bulkNodes.length}
        </span>
      );
      return lockedRail('union', chip, label, bulkNodes);
    }
    return frame(
      'union',
      label,
      <MultiRail
        nodes={bulkNodes}
        ids={bulkIds}
        conditional={pasteStyle(bulkNodes, copiedStyle)}
        tail={moreButton(bulkNodes)}
        tailControls={1}
      />
    );
  }

  if (!liveNode || tableEditing || codeEditing) return null;
  const node = liveNode;
  const subject = railSubjectOf(node);
  const kind = kindOf(node, subject);
  if (node.locked) return lockedRail(node.id, <KindLabel icon={kind.icon} name={kind.name} />, kind.name, [node]);

  const Section = RAIL_SECTIONS[subject];
  return frame(
    node.id,
    kind.name,
    <Section
      node={node}
      subject={subject}
      menuActions={menuActions}
      conditional={pasteStyle([node], copiedStyle)}
      tail={
        <>
          {commentButton}
          {moreButton([node])}
        </>
      }
      tailControls={2}
    />
  );
};

/**
 * The rail, contained: a crash in one subject's module hides the rail until the
 * selection changes, rather than taking the board down. Its entrance runs on
 * every selection, so it honours reduced motion.
 */
export const ObjectContextToolbar = React.memo(function ObjectContextToolbar(props: Props) {
  return (
    <FeatureBoundary name="context toolbar" variant="silent" resetKey={props.selectedIds?.join(',') ?? props.selectedId}>
      <MotionConfig reducedMotion="user">
        <ObjectContextToolbarInner {...props} />
      </MotionConfig>
    </FeatureBoundary>
  );
});
