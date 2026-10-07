import React, { useCallback, useMemo } from 'react';
import {
  Clock, Download, Layers as LayersIcon, MessageSquare, Mic, MousePointer2,
  PenLine, Play, Share2, Sparkles, Square, StickyNote, Type,
  Code2, HelpCircle, ArrowLeft, Link2, Contrast, Presentation, LayoutGrid, MousePointerSquareDashed,
} from 'lucide-react';
import { isContrastEnhanced, toggleContrast } from '../engine/ui/contrast';
import { HandIcon } from './workspace/HandIcon';
import { IconsGlyph } from './icons/IconsGlyph';
import { ICON_PACK_LABELS, openIconBrowser } from '../engine/icons/iconStore';
import { provider } from '../engine/document';
/**
 * The shared label, not a private copy.
 *
 * This file carried its own `objectLabel`, which was `nodeLabel` as it stood
 * before shapes learned to name themselves by kind. So the Layers panel called
 * a box "Rectangle" while the palette called the same box "Shape" — two names
 * for one object, in two surfaces a foot apart. `nodeLabel`'s own header says
 * it was extracted so exactly that could not happen; the palette was a third
 * surface that never got the memo.
 */
import { nodeLabel } from '../engine/model/nodeLabel';
import { viewportCenter } from '../engine/presence/PresenceTypes';
import { useStore } from '../hooks/useStore';
import { TOOL_SHORTCUTS } from '../engine/tools/shortcuts';
import { requestPresentation } from './canvas/useContentShortcuts';
import { SHORTCUTS, menuShortcut } from './menu/shortcuts';
import { PaletteDialog } from './palette/PaletteDialog';
import { fuzzyScore, type PaletteItem } from './palette/paletteMatch';
import type { AnyNode } from '../engine/model/schema';

interface CommandPaletteProps {
  onClose: () => void;
  onSelectAction: (actionId: string) => void;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  sticky: <StickyNote size={16} />,
  text: <Type size={16} />,
  shape: <Square size={16} />,
  path: <PenLine size={16} />,
  audio: <Mic size={16} />,
  comment: <MessageSquare size={16} />,
};

/** Select everything sharing one property with the current selection. */
const selectSimilar = (key: 'type' | 'fill' | 'stroke' | 'font') => () =>
  window.dispatchEvent(new CustomEvent('requestSelectSimilar', { detail: { key } }));

/**
 * Organise the selected stickies. The selection lives in the canvas, which owns
 * the chord, so the palette presses it rather than keeping a second copy.
 */
const organiseStickies = (byAuthor: boolean) => () =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', ctrlKey: true, altKey: true, shiftKey: byAuthor, cancelable: true })
  );

const flyTo = (x: number, y: number) => {
  window.dispatchEvent(new CustomEvent('navigateViewport', { detail: { x, y, zoom: 1 } }));
};

/**
 * The command surface.
 *
 * Beyond running commands, this is now also how you find things on an
 * infinite canvas. A complete canvas text search existed in the codebase but
 * had no input wired to it anywhere, so it was unreachable; it belongs here
 * rather than as a separate search box competing for header space.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ onClose, onSelectAction }) => {
  const commands: PaletteItem[] = useMemo(() => {
    const run = (id: string) => () => onSelectAction(id);
    /**
     * The key a tool is actually bound to, asked rather than written.
     *
     * These were string literals -- `'S'`, `'T'`, `'R'`, `'V'`, `'H'` -- which
     * is the failure `toolNames.ts` opens by warning about and then documents
     * four instances of. A palette is the surface somebody reaches for when
     * they cannot remember a key, so it is the worst place in the product for
     * a key to be wrong, and the least likely to be updated when one moves.
     */
    const key = (tool: string) => TOOL_SHORTCUTS[tool];
    const base: PaletteItem[] = [
      { id: 'sticky', label: 'Add sticky note', group: 'Create', icon: <StickyNote size={16} />, shortcut: key('sticky'), perform: run('sticky') },
      { id: 'text', label: 'Add text', group: 'Create', icon: <Type size={16} />, shortcut: key('text'), perform: run('text') },
      { id: 'shape-rect', label: 'Add rectangle', group: 'Create', icon: <Square size={16} />, shortcut: key('shape'), perform: run('shape-rect') },
      { id: 'code', label: 'Add code block', detail: 'Highlighted code you can edit on the board', group: 'Create', icon: <Code2 size={16} />, perform: run('code') },
      { id: 'link', label: 'Add link', detail: 'A card, or a player for videos, Figma and Spotify', group: 'Create', icon: <Link2 size={16} />, perform: run('link') },
      { id: 'icons', label: 'Insert icon…', detail: 'AWS, Azure, Google Cloud and Kubernetes architecture icons', keywords: 'icon cloud architecture vendor', group: 'Create', icon: <IconsGlyph size={16} />, shortcut: 'Shift+I', perform: () => openIconBrowser() },
      ...ICON_PACK_LABELS.map((pack) => ({
        id: `icons-${pack.id}`, label: `${pack.name} icons`, keywords: `icon library ${pack.id}`, group: 'Create',
        icon: <IconsGlyph size={16} />, perform: () => openIconBrowser({ pack: pack.id }),
      })),
      { id: 'comment', label: 'Add comment', group: 'Create', icon: <MessageSquare size={16} />, shortcut: key('comment'), perform: run('comment') },

      { id: 'select', label: 'Select tool', group: 'Tools', icon: <MousePointer2 size={16} />, shortcut: key('select'), perform: run('select') },
      { id: 'hand', label: 'Hand tool', group: 'Tools', icon: <HandIcon size={16} />, shortcut: key('hand'), perform: run('hand') },
      { id: 'tidy', label: 'Tidy up canvas', detail: 'Cluster objects by colour', group: 'Tools', icon: <Sparkles size={16} />, perform: run('tidy') },
      { id: 'diagram', label: 'Diagram from code', detail: 'Write a flowchart in Mermaid, or read a selected one back out', group: 'Tools', icon: <Code2 size={16} />, perform: run('diagram') },
      { id: 'help', label: 'Keyboard shortcuts & help', group: 'Tools', icon: <HelpCircle size={16} />, shortcut: '?', perform: run('help') },
      { id: 'present', label: 'Present', detail: 'Step through the board’s frames', keywords: 'slideshow frames', group: 'Tools', icon: <Presentation size={16} />, shortcut: menuShortcut(SHORTCUTS.present), perform: () => requestPresentation() },
      { id: 'organise-colour', label: 'Organise stickies by colour', detail: 'Select two or more stickies first', keywords: 'sort group notes', group: 'Tools', icon: <LayoutGrid size={16} />, shortcut: menuShortcut(SHORTCUTS.organiseColour), perform: organiseStickies(false) },
      { id: 'organise-author', label: 'Organise stickies by author', detail: 'Select two or more stickies first', keywords: 'sort group notes', group: 'Tools', icon: <LayoutGrid size={16} />, shortcut: menuShortcut(SHORTCUTS.organiseAuthor), perform: organiseStickies(true) },
      { id: 'select-same-type', label: 'Select all with same type', detail: 'Widen the selection', group: 'Tools', icon: <MousePointerSquareDashed size={16} />, shortcut: menuShortcut(SHORTCUTS.selectSameType), perform: selectSimilar('type') },
      { id: 'select-same-fill', label: 'Select all with same fill', detail: 'Widen the selection', group: 'Tools', icon: <MousePointerSquareDashed size={16} />, shortcut: menuShortcut(SHORTCUTS.selectSameFill), perform: selectSimilar('fill') },
      { id: 'select-same-stroke', label: 'Select all with same stroke', detail: 'Widen the selection', group: 'Tools', icon: <MousePointerSquareDashed size={16} />, shortcut: menuShortcut(SHORTCUTS.selectSameStroke), perform: selectSimilar('stroke') },
      { id: 'select-same-font', label: 'Select all with same font', detail: 'Widen the selection', group: 'Tools', icon: <MousePointerSquareDashed size={16} />, shortcut: menuShortcut(SHORTCUTS.selectSameFont), perform: selectSimilar('font') },
      { id: 'zoom-fit', label: 'Zoom to fit', detail: 'Frame everything on the canvas', group: 'View', icon: <LayersIcon size={16} />, perform: run('zoom-fit') },
      { id: 'contrast', label: isContrastEnhanced() ? 'Use standard contrast' : 'Increase contrast', detail: 'Stronger text, borders and focus rings', keywords: 'accessibility', group: 'View', icon: <Contrast size={16} />, perform: toggleContrast },
      { id: 'reset-view', label: 'Reset view to origin', group: 'View', icon: <LayersIcon size={16} />, shortcut: '0', perform: run('reset-view') },

      { id: 'timetravel', label: 'Version history', detail: 'Scrub the board’s history and restore a version', group: 'Session', icon: <Clock size={16} />, perform: run('timetravel') },
      { id: 'play', label: 'Toggle physics play mode', group: 'Session', icon: <Play size={16} />, perform: run('play') },
      { id: 'share', label: 'Share workspace link', group: 'Session', icon: <Share2 size={16} />, perform: run('share') },
      /**
       * The second route out, for the people the corner mark does not reach.
       *
       * The header's mark is the way back to the dashboard, and the objection
       * to it is fair: a logo that reveals an arrow on hover confirms the
       * action for somebody already reaching for it and teaches nobody else.
       * A searchable entry costs no chrome and answers the search anybody
       * stuck in a board would actually type.
       *
       * `perform` navigates directly rather than going through
       * `onSelectAction`, because leaving the room is not a canvas action and
       * routing it through the room's action switch would put a page
       * navigation in the same list as "add sticky note".
       */
      { id: 'boards', label: 'Go to Your boards', detail: 'Leave this board and open the dashboard', group: 'Session', icon: <ArrowLeft size={16} />, perform: () => { window.location.href = '/'; } },

      { id: 'export-png', label: 'Export as PNG', detail: 'Raster image at 2x', group: 'Export', icon: <Download size={16} />, perform: run('export-png') },
      { id: 'export-svg', label: 'Export as SVG', detail: 'Editable vector', group: 'Export', icon: <Download size={16} />, perform: run('export-svg') },
      { id: 'export-json', label: 'Export as JSON', detail: 'Raw document', group: 'Export', icon: <Download size={16} />, perform: run('export-json') },
    ];

    // Jump to a collaborator.
    provider.awareness?.getStates().forEach((state: any, clientId: number) => {
      if (clientId === provider.awareness?.clientID || !state.user?.name) return;
      base.push({
        id: `follow-${clientId}`,
        label: `Jump to ${state.user.name}`,
        detail: 'Move your view to theirs',
        group: 'People',
        icon: <MousePointer2 size={16} color={state.user.color} />,
        perform: () => {
          // Their viewport is stored as its top-left corner, so jump to the
          // middle of what they can see. Falling back to the raw cursor covers
          // someone whose camera has not moved.
          if (state.viewport) {
            const c = viewportCenter(state.viewport);
            flyTo(c.x, c.y);
          } else if (state.cursor) {
            flyTo(state.cursor.x, state.cursor.y);
          }
        },
      });
    });

    return base;
  }, [onSelectAction]);

  /**
   * Canvas objects, searched by their own text content. Read when the query
   * changes rather than subscribed to, so a collaborator's edit does not re-run
   * the search and move the highlighted result under the cursor.
   */
  const objectResults = useCallback((query: string): PaletteItem[] =>
    Object.values(useStore.getState().objects)
      .map((node) => ({ node, score: fuzzyScore(nodeLabel(node), query) }))
      .filter((entry): entry is { node: AnyNode; score: number } => entry.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ node }) => ({
        id: `object-${node.id}`,
        label: nodeLabel(node),
        detail: node.createdByName ? `${node.type} · ${node.createdByName}` : node.type,
        group: 'On this canvas',
        icon: TYPE_ICONS[node.type] ?? <Square size={16} />,
        perform: () => {
          flyTo(node.x + node.width / 2, node.y + node.height / 2);
          document.dispatchEvent(new CustomEvent('requestSelectNode', { detail: { id: node.id } }));
        },
      })), []);

  return (
    <PaletteDialog
      items={commands}
      extraResults={objectResults}
      placeholder="Search commands and objects"
      label="Command palette"
      onClose={onClose}
    />
  );
};
