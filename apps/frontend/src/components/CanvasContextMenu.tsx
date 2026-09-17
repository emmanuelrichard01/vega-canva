import React, { useMemo, useSyncExternalStore } from 'react';
import type { AnyNode } from '../engine/model/schema';
import { styleClipboard } from '../engine/model/styleClipboard';
import { Menu } from './menu/Menu';
import { boardMenu, selectionMenu, type CanvasContextMenuActions } from './menu/canvasMenu';

export type { CanvasContextMenuActions } from './menu/canvasMenu';

export interface ContextTarget {
  /** Where the menu was summoned, in window coordinates. */
  x: number;
  y: number;
  /** What was under the pointer. Empty for the bare board. */
  ids: string[];
  /**
   * Opened from the keyboard (Shift+F10, the Menu key), so the keyboard lands
   * on the first row and "here" means nothing — there is no pointer spot.
   */
  viaKeyboard?: boolean;
}

interface Props {
  target: ContextTarget | null;
  onClose: () => void;
  objects: Record<string, AnyNode>;
  actions: CanvasContextMenuActions;
  /** Viewers get the ways to look and take away, not the ways to change. */
  canEdit?: boolean;
  /** Everything on the board, so the resolver can tell a whole group from part of one. */
  allObjects?: Record<string, AnyNode>;
}

/**
 * The board's right-click menu.
 *
 * What it offers is `selectionMenu` / `boardMenu`, which the rail's overflow
 * button opens too; how it behaves is `Menu`. This file only decides which of
 * the two lists a right-click is asking for.
 */
export const CanvasContextMenu: React.FC<Props> = ({
  target,
  onClose,
  objects,
  actions,
  canEdit = true,
  allObjects,
}) => {
  const style = useSyncExternalStore(styleClipboard.subscribe, styleClipboard.get, styleClipboard.get);

  const entries = useMemo(() => {
    if (!target) return [];
    const nodes = target.ids.map((id) => objects[id]).filter(Boolean);
    const input = {
      nodes,
      allObjects: allObjects ?? objects,
      actions,
      canEdit,
      style,
      atPointer: !target.viaKeyboard,
    };
    return nodes.length > 0 ? selectionMenu(input) : boardMenu(input);
  }, [target, objects, allObjects, actions, canEdit, style]);

  const anchor = useMemo(
    () => (target ? { kind: 'point' as const, x: target.x, y: target.y } : null),
    [target]
  );

  if (!target || !anchor) return null;

  return (
    <Menu
      // A new right-click is a new menu: it re-places and re-focuses rather than
      // inheriting the last one's open submenu at a stale position.
      key={`${target.x},${target.y},${target.ids.join()}`}
      label={target.ids.length > 0 ? 'Selection actions' : 'Board actions'}
      entries={entries}
      anchor={anchor}
      focusFirst={Boolean(target.viaKeyboard)}
      onClose={onClose}
    />
  );
};
