import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { MotionConfig } from 'framer-motion';
import { Copy, Lock, MessageSquarePlus, SlidersHorizontal, Trash2, Unlock } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../hooks/useStore';
import type { AnyNode } from '../../engine/model/schema';
import { styleClipboard } from '../../engine/model/styleClipboard';
import { textEditing } from '../../engine/interaction/textEditing';
import { selectionMenu, type CanvasContextMenuActions } from '../menu/canvasMenu';
import { Rail, RailButton, RailMenuButton } from '../toolbar/RailBase';
import { useRailPlacement } from '../toolbar/rail/useRailPlacement';
import { withMultiSelectExtras } from '../toolbar/rail/menuExtras';
import { FeatureBoundary } from '../ui/FeatureBoundary';
import '../toolbar/rail/rail.css';
import './phone.css';

/**
 * The phone's selection bar.
 *
 * The desktop rail answers "what can I change about this" with a row of
 * styling controls; a phone has neither the width for them nor a pointer
 * precise enough to use them over the object. Here the bar carries the four
 * things a thumb does to a selection (edit it, duplicate it, delete it,
 * comment on it) and `⋯`, the same menu as a long-press. Edit opens the
 * properties sheet, which is where the styling lives.
 *
 * It stands above the selection by the rail's own placement. While text is
 * being typed it sits on top of the on-screen keyboard instead, with Edit and
 * Done.
 */
interface Props {
  selectedId: string | null;
  selectedIds?: string[];
  menuActions: CanvasContextMenuActions;
  /** Open the properties sheet. */
  onEdit: () => void;
  /** The properties sheet is open, so the bar stands down. */
  editing?: boolean;
}

const EMPTY: AnyNode[] = [];

/** How far the on-screen keyboard reaches up from the layout viewport's bottom, in px. */
function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) {
      setInset(0);
      return;
    }
    const update = () => setInset(Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return inset;
}

const PhoneContextBarInner: React.FC<Props> = ({ selectedId, selectedIds, menuActions, onEdit, editing = false }) => {
  const ids = selectedIds ?? (selectedId ? [selectedId] : []);
  const isBulk = ids.length > 1;
  const activeId = isBulk ? null : selectedId;
  const typing = useSyncExternalStore(textEditing.subscribe, textEditing.getSnapshot, textEditing.getSnapshot);
  const keyboard = useKeyboardInset(Boolean(typing));

  const { anchorRef, railRef, placement, clear, isVisible } = useRailPlacement({
    activeId,
    isBulk,
    selectedIds,
    sidebarsVisible: true,
    suspended: editing || Boolean(typing),
  });

  const nodes = useStore(
    useShallow((state) => (ids.length ? (ids.map((id) => state.objects[id]).filter(Boolean) as AnyNode[]) : EMPTY))
  );

  if (editing) return null;

  if (typing) {
    return (
      <div className="phone-keybar" role="toolbar" aria-label="Text" style={{ bottom: keyboard }}>
        <button type="button" className="phone-keybar__btn" onClick={onEdit}>
          <SlidersHorizontal size={18} aria-hidden="true" />
          Style
        </button>
        <span className="phone-keybar__fill" />
        <button
          type="button"
          className="phone-keybar__btn phone-keybar__btn--done"
          // Leaving the field commits the edit, as tapping the board does.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
        >
          Done
        </button>
      </div>
    );
  }

  if (nodes.length === 0 || !isVisible) return null;

  const locked = nodes.every((n) => n.locked);
  const label = nodes.length === 1 ? 'Selection' : `${nodes.length} objects`;
  const more = (
    <RailMenuButton
      entries={() => {
        const entries = selectionMenu({
          nodes,
          allObjects: useStore.getState().objects,
          actions: menuActions,
          canEdit: true,
          style: styleClipboard.get(),
          atPointer: false,
        });
        return nodes.length > 1 ? withMultiSelectExtras(entries, nodes) : entries;
      }}
    />
  );

  return (
    <Rail
      id={ids.join(',')}
      label={label}
      description={locked ? 'Locked, so it cannot be moved or restyled' : undefined}
      placement={placement}
      clear={clear}
      anchorRef={anchorRef}
      ref={railRef}
    >
      {locked ? (
        <>
          <span className="ctx-locked">
            <Lock size={14} aria-hidden="true" />
            Locked
          </span>
          <RailButton label="Unlock" onClick={menuActions.toggleLock}>
            <Unlock size={18} />
          </RailButton>
        </>
      ) : (
        <>
          <RailButton label="Edit" hint="Edit its properties" onClick={onEdit}>
            <span className="phone-ctx__edit">
              <SlidersHorizontal size={18} aria-hidden="true" />
              Edit
            </span>
          </RailButton>
          <RailButton label="Duplicate" onClick={menuActions.duplicate}>
            <Copy size={18} />
          </RailButton>
          <RailButton label="Delete" danger onClick={menuActions.remove}>
            <Trash2 size={18} />
          </RailButton>
        </>
      )}
      {nodes.length === 1 && (
        <RailButton label="Comment" onClick={menuActions.comment}>
          <MessageSquarePlus size={18} />
        </RailButton>
      )}
      {more}
    </Rail>
  );
};

export const PhoneContextBar: React.FC<Props> = (props) => (
  <FeatureBoundary name="selection bar" variant="silent" resetKey={props.selectedIds?.join(',') ?? props.selectedId}>
    <MotionConfig reducedMotion="user">
      <PhoneContextBarInner {...props} />
    </MotionConfig>
  </FeatureBoundary>
);
