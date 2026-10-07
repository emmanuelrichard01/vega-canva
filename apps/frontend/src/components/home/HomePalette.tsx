import React, { useMemo } from 'react';
import { Compass, Contrast, Download, Layers, Link2, Pin, Plus, UploadCloud } from 'lucide-react';
import { isContrastEnhanced, toggleContrast } from '../../engine/ui/contrast';
import { PaletteDialog } from '../palette/PaletteDialog';
import type { PaletteItem } from '../palette/paletteMatch';
import { CATEGORIES, type Template } from '../../engine/templates/templates';
import { whenOpened, type ShelfBoard } from '../../engine/room/boardShelf';

interface Props {
  boards: readonly ShelfBoard[];
  pinned: ReadonlySet<string>;
  templates: readonly Template[];
  onClose: () => void;
  onNewBoard: () => void;
  onOpenBoard: (board: ShelfBoard) => void;
  onPeekTemplate: (template: Template) => void;
  onBrowseTemplates: () => void;
  onJoin: () => void;
  onRestore: () => void;
  onSaveList: () => void;
}

/**
 * ⌘K on the dashboard: every board, every template and every way to start
 * one, in a single field. Loaded on first use.
 */
export const HomePalette: React.FC<Props> = ({
  boards, pinned, templates, onClose, onNewBoard, onOpenBoard, onPeekTemplate,
  onBrowseTemplates, onJoin, onRestore, onSaveList,
}) => {
  const items = useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = [
      { id: 'new', label: 'New board', detail: 'A blank board, ready to name', group: 'Start', icon: <Plus size={16} />, shortcut: 'N', perform: onNewBoard },
      { id: 'templates', label: 'Browse templates', detail: `${templates.length} boards, already filled in`, group: 'Start', icon: <Compass size={16} />, perform: onBrowseTemplates },
      { id: 'join', label: 'Open a shared link', detail: 'Paste a board link or type a code', group: 'Start', icon: <Link2 size={16} />, perform: onJoin },
      { id: 'restore', label: 'Restore a backup', detail: 'A board backup opens as a new board', group: 'Start', icon: <UploadCloud size={16} />, perform: onRestore },
      { id: 'contrast', label: isContrastEnhanced() ? 'Use standard contrast' : 'Increase contrast', detail: 'Stronger text, borders and focus rings', keywords: 'accessibility', group: 'Settings', icon: <Contrast size={16} />, perform: toggleContrast },
      { id: 'save-list', label: 'Save board list', detail: 'Every address on this device, as a file', group: 'Start', icon: <Download size={16} />, perform: onSaveList },
    ];
    const boardItems: PaletteItem[] = [...boards]
      .sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || b.lastAccessed - a.lastAccessed)
      .map((board) => ({
        id: `board-${board.id}`,
        label: board.name,
        detail: `${pinned.has(board.id) ? 'Pinned · ' : ''}Opened ${whenOpened(board.lastAccessed)}`,
        group: 'Your boards',
        icon: pinned.has(board.id) ? <Pin size={16} /> : <Layers size={16} />,
        perform: () => onOpenBoard(board),
      }));
    const templateItems: PaletteItem[] = templates.map((t) => ({
      id: `template-${t.id}`,
      label: t.name,
      detail: CATEGORIES.find((c) => c.id === t.category)?.label,
      keywords: `${t.blurb} ${t.teaches.join(' ')}`,
      group: 'Templates',
      icon: <Compass size={16} />,
      perform: () => onPeekTemplate(t),
    }));
    return [...actions, ...boardItems, ...templateItems];
  }, [boards, pinned, templates, onNewBoard, onOpenBoard, onPeekTemplate, onBrowseTemplates, onJoin, onRestore, onSaveList]);

  return (
    <PaletteDialog
      items={items}
      placeholder="Search boards, templates and actions"
      label="Search the library"
      onClose={onClose}
    />
  );
};
