import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  FlipHorizontal2,
  FlipVertical2,
  LayoutTemplate,
  Lock,
  MoreHorizontal,
  PanelRightClose,
  Unlock,
} from 'lucide-react';
import { Menu } from '../menu/Menu';
import type { MenuEntry } from '../menu/menuModel';
import { SHORTCUTS } from '../menu/shortcuts';
import { TYPE_ICON } from './panelIcons';
import { nodeLabel } from '../../engine/model/nodeLabel';
import { contrastInk } from '../../engine/model/color';
import type { AnyNode, NodeType } from '../../engine/model/schema';
import type { RestackOp } from '../../engine/model/restack';

const PLURAL: Partial<Record<NodeType, string>> = {
  shape: 'shapes',
  text: 'text boxes',
  sticky: 'notes',
  image: 'images',
  frame: 'frames',
  connector: 'connectors',
  path: 'drawings',
  grid: 'grids',
  chart: 'charts',
  table: 'tables',
  code: 'code blocks',
  link: 'links',
  audio: 'audio clips',
  comment: 'comments',
};

const SINGULAR: Partial<Record<NodeType, string>> = {
  shape: 'Shape',
  text: 'Text',
  sticky: 'Note',
  image: 'Image',
  frame: 'Frame',
  connector: 'Connector',
  path: 'Drawing',
  grid: 'Grid',
  chart: 'Chart',
  table: 'Table',
  code: 'Code',
  link: 'Link',
  audio: 'Audio',
  comment: 'Comment',
};

/** "3 notes", or "5 objects, mixed" when the types disagree. */
export function multiLabel(nodes: readonly AnyNode[]): string {
  const types = new Set(nodes.map((n) => n.type));
  if (types.size === 1) {
    const type = nodes[0].type;
    return `${nodes.length} ${PLURAL[type] ?? `${type}s`}`;
  }
  return `${nodes.length} objects, mixed`;
}

export interface Editor {
  name: string;
  color: string;
}

interface PanelHeaderProps {
  nodes: AnyNode[];
  editors: Editor[];
  flipped: { x: boolean; y: boolean };
  locked: boolean;
  canLock: boolean;
  onRename: (title: string | undefined) => void;
  onRestack: (op: RestackOp) => void;
  onFlip: (axis: 'x' | 'y') => void;
  onToggleLock: () => void;
  onCollapse?: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/**
 * One 40px row: what is selected, its name, who else has it, a lock, and
 * its menu.
 *
 * The name is the same `title` the Layers panel renames, edited in place with
 * a single click. Lock is the one quick action shown, because a locked object
 * explains why the board ignores your drags; arrange and flip are in the ⋯
 * menu and on their shortcuts.
 */
export const PanelHeader: React.FC<PanelHeaderProps> = ({
  nodes,
  editors,
  flipped,
  locked,
  canLock,
  onRename,
  onRestack,
  onFlip,
  onToggleLock,
  onCollapse,
}) => {
  const node = nodes[0];
  const isMulti = nodes.length > 1;
  const uniform = new Set(nodes.map((n) => n.type)).size === 1;
  const Icon = isMulti && !uniform ? LayoutTemplate : TYPE_ICON[node.type] ?? LayoutTemplate;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setEditing(false);
  }, [node.id]);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const typeName = SINGULAR[node.type] ?? node.type;
  const shownName = isMulti ? multiLabel(nodes) : node.title ?? nodeLabel(node);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if ((next || undefined) !== (node.title || undefined)) onRename(next || undefined);
  };

  const entries: MenuEntry[] = [
    { kind: 'item', id: 'front', label: 'Bring to front', icon: <ArrowUpToLine size={14} />, shortcut: SHORTCUTS.front, onSelect: () => onRestack('front') },
    { kind: 'item', id: 'forward', label: 'Bring forward', icon: <ArrowUp size={14} />, shortcut: SHORTCUTS.forward, onSelect: () => onRestack('forward') },
    { kind: 'item', id: 'backward', label: 'Send backward', icon: <ArrowDown size={14} />, shortcut: SHORTCUTS.backward, onSelect: () => onRestack('backward') },
    { kind: 'item', id: 'back', label: 'Send to back', icon: <ArrowDownToLine size={14} />, shortcut: SHORTCUTS.back, onSelect: () => onRestack('back') },
    { kind: 'separator', id: 'sep-flip' },
    { kind: 'item', id: 'flip-h', label: 'Flip horizontal', icon: <FlipHorizontal2 size={14} />, checked: flipped.x, onSelect: () => onFlip('x') },
    { kind: 'item', id: 'flip-v', label: 'Flip vertical', icon: <FlipVertical2 size={14} />, checked: flipped.y, onSelect: () => onFlip('y') },
  ];
  const shownEditors = editors.slice(0, 3);
  const extra = editors.length - shownEditors.length;
  const editorsLabel =
    editors.length === 1
      ? `${editors[0].name} has this selected`
      : `${editors.map((e) => e.name).join(', ')} have this selected`;

  return (
    <header className="panel-head">
      <span className="panel-head__glyph" aria-hidden="true" data-tooltip={isMulti ? undefined : typeName}>
        <Icon size={14} />
      </span>
      {editing && !isMulti ? (
        <input
          ref={input}
          className="panel-head__name-input"
          aria-label={`${typeName} name`}
          value={draft}
          placeholder={nodeLabel({ ...node, title: undefined } as AnyNode)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
            }
          }}
        />
      ) : isMulti ? (
        <span className="panel-head__name" aria-live="polite">{shownName}</span>
      ) : (
        <button
          type="button"
          className="panel-head__name panel-head__name--button"
          aria-label={`${typeName}: ${shownName}. Rename`}
          data-tooltip="Rename"
          // A name cut short by the ellipsis is spelled out in the tooltip.
          onPointerOver={(e) => {
            const el = e.currentTarget;
            el.setAttribute('data-tooltip', el.scrollWidth > el.clientWidth + 1 ? `Rename “${shownName}”` : 'Rename');
          }}
          onClick={() => {
            setDraft(node.title ?? '');
            setEditing(true);
          }}
        >
          {shownName}
        </button>
      )}
      {editors.length > 0 && (
        <span className="panel-head__editors" role="img" aria-label={editorsLabel} data-tooltip={editorsLabel}>
          {shownEditors.map((e) => (
            <span key={`${e.name}-${e.color}`} className="panel-head__avatar" style={{ '--who': e.color, '--who-ink': contrastInk(e.color) } as React.CSSProperties}>
              {initials(e.name)}
            </span>
          ))}
          {extra > 0 && <span className="panel-head__avatar panel-head__avatar--more">+{extra}</span>}
        </span>
      )}
      {canLock && (
        <button
          type="button"
          className="pg-icon-btn panel-head__lock"
          aria-pressed={locked}
          aria-label={locked ? 'Unlock' : 'Lock'}
          data-tooltip={locked ? 'Locked · click to unlock' : 'Lock'}
          data-locked={locked || undefined}
          onClick={onToggleLock}
        >
          {locked ? <Lock size={14} aria-hidden="true" /> : <Unlock size={14} aria-hidden="true" />}
        </button>
      )}
      <button
        ref={menuButton}
        type="button"
        className="pg-icon-btn"
        aria-label="Arrange and flip"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-tooltip="More"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      {onCollapse && (
        <button
          type="button"
          className="pg-icon-btn"
          onClick={onCollapse}
          data-tooltip="Collapse panel"
          aria-label="Collapse the properties panel"
        >
          <PanelRightClose size={15} aria-hidden="true" />
        </button>
      )}
      {menuOpen && menuButton.current && (
        <Menu
          entries={entries}
          label="Arrange and flip"
          anchor={{ kind: 'rect', rect: menuButton.current.getBoundingClientRect(), align: 'end' }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </header>
  );
};
