import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock, Download, Hand, Layers as LayersIcon, MessageSquare, Mic, MousePointer2,
  PenLine, Play, Search, Share2, Sparkles, Square, StickyNote, Type,
  Code2, HelpCircle,
} from 'lucide-react';
import { motion } from 'framer-motion';
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
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { AnyNode } from '../engine/model/schema';

interface CommandPaletteProps {
  onClose: () => void;
  onSelectAction: (actionId: string) => void;
}

interface PaletteItem {
  id: string;
  label: string;
  /** Secondary line — object type, author, or a description. */
  detail?: string;
  group: string;
  icon: React.ReactNode;
  shortcut?: string;
  perform: () => void;
}

/**
 * The characters that matched, marked.
 *
 * A fuzzy search that filters without saying *why* a row survived makes the
 * reader re-run the query in their head on every result -- and fuzzy matching
 * is where that is worst, because the reason "shp" kept "Add Shape" is three
 * letters scattered through it. The help panel makes the same argument about
 * its own search; this uses the same subsequence walk the score does, so what
 * is marked is exactly what was matched on.
 */
const Marked: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;

  const out: React.ReactNode[] = [];
  let qi = 0;
  let run = '';
  let hit = '';

  const flush = () => {
    if (run) { out.push(run); run = ''; }
    if (hit) { out.push(<mark key={out.length} className="cmdk__mark">{hit}</mark>); hit = ''; }
  };

  for (const ch of text) {
    if (qi < q.length && ch.toLowerCase() === q[qi]) {
      if (run) { out.push(run); run = ''; }
      hit += ch;
      qi += 1;
    } else {
      if (hit) { out.push(<mark key={out.length} className="cmdk__mark">{hit}</mark>); hit = ''; }
      run += ch;
    }
  }
  flush();
  return <>{out}</>;
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  sticky: <StickyNote size={16} />,
  text: <Type size={16} />,
  shape: <Square size={16} />,
  path: <PenLine size={16} />,
  audio: <Mic size={16} />,
  comment: <MessageSquare size={16} />,
};

/**
 * Subsequence match with a crude quality score.
 *
 * Full fuzzy matching (Smith-Waterman and friends) is overkill for a list of
 * this size; a subsequence test with bonuses for prefix and word-boundary hits
 * gives the ordering people actually expect from "shp" -> "Add Shape" without
 * the complexity.
 */
function fuzzyScore(haystack: string, needle: string): number | null {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();

  if (h.startsWith(n)) return 1000;

  let score = 0;
  let hIndex = 0;
  let lastMatch = -1;

  for (const char of n) {
    const found = h.indexOf(char, hIndex);
    if (found === -1) return null;
    // Consecutive characters and word starts are stronger signals than
    // scattered hits.
    if (found === lastMatch + 1) score += 8;
    if (found === 0 || h[found - 1] === ' ') score += 6;
    score += 1;
    lastMatch = found;
    hIndex = found + 1;
  }

  // Prefer shorter labels among equal matches.
  return score - h.length * 0.05;
}


/**
 * The command surface.
 *
 * Beyond running commands, this is now also how you find things on an
 * infinite canvas. A complete canvas text search existed in the codebase but
 * had no input wired to it anywhere, so it was unreachable; it belongs here
 * rather than as a separate search box competing for header space.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ onClose, onSelectAction }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  /**
   * The row under the pointer, which is not the row the keyboard is on.
   *
   * `onMouseEnter` used to move `selectedIndex`, so a pointer resting anywhere
   * over the list silently took the keyboard's place: you arrow down three
   * times, the list scrolls under a stationary mouse, and Enter runs whatever
   * the mouse happened to be over. Two states, one Enter, and Enter belongs to
   * the keyboard.
   */
  const [hovered, setHovered] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useFocusTrap(true, onClose);
  const objects = useStore((state) => state.objects);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const flyTo = (x: number, y: number) => {
    window.dispatchEvent(new CustomEvent('navigateViewport', { detail: { x, y, zoom: 1 } }));
  };

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
      { id: 'comment', label: 'Add comment', group: 'Create', icon: <MessageSquare size={16} />, shortcut: key('comment'), perform: run('comment') },

      { id: 'select', label: 'Select tool', group: 'Tools', icon: <MousePointer2 size={16} />, shortcut: key('select'), perform: run('select') },
      { id: 'hand', label: 'Hand tool', group: 'Tools', icon: <Hand size={16} />, shortcut: key('hand'), perform: run('hand') },
      { id: 'tidy', label: 'Tidy up canvas', detail: 'Cluster objects by colour', group: 'Tools', icon: <Sparkles size={16} />, perform: run('tidy') },
      { id: 'diagram', label: 'Diagram from code', detail: 'Write a flowchart in Mermaid, or read a selected one back out', group: 'Tools', icon: <Code2 size={16} />, perform: run('diagram') },
      { id: 'help', label: 'Keyboard shortcuts & help', group: 'Tools', icon: <HelpCircle size={16} />, shortcut: '?', perform: run('help') },
      { id: 'zoom-fit', label: 'Zoom to fit', detail: 'Frame everything on the canvas', group: 'View', icon: <LayersIcon size={16} />, perform: run('zoom-fit') },
      { id: 'reset-view', label: 'Reset view to origin', group: 'View', icon: <LayersIcon size={16} />, shortcut: '0', perform: run('reset-view') },

      { id: 'timetravel', label: 'Replay session', detail: 'Scrub the room’s authoring history', group: 'Session', icon: <Clock size={16} />, perform: run('timetravel') },
      { id: 'play', label: 'Toggle physics play mode', group: 'Session', icon: <Play size={16} />, perform: run('play') },
      { id: 'share', label: 'Share workspace link', group: 'Session', icon: <Share2 size={16} />, perform: run('share') },

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

  const results: PaletteItem[] = useMemo(() => {
    const scored = commands
      .map((item) => ({ item, score: fuzzyScore(`${item.label} ${item.group}`, query) }))
      .filter((entry): entry is { item: PaletteItem; score: number } => entry.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);

    if (!query.trim()) return scored;

    // Canvas objects, searched by their own text content.
    const objectHits = Object.values(objects)
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
      }));

    return [...scored, ...objectHits];
  }, [commands, objects, query]);

  // Reset the cursor whenever the result set changes, so Enter never fires a
  // command that is no longer under the highlight.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const commit = (item: PaletteItem | undefined) => {
    if (!item) return;
    item.perform();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(results[selectedIndex]);
    }
  };

  // Group headers are rendered inline, so track where each group starts.
  let lastGroup = '';

  return (
    /**
     * The whole panel, in the stylesheet.
     *
     * Every rule here used to be an inline `style` object -- about forty of
     * them. It was the only surface in this application styled that way, and
     * inline styles cannot do the four things this panel needs: a hover state,
     * a focus ring, a reduced-motion rule, or a theme. They also cannot be read
     * next to the rest of the design, which is how a panel drifts from the
     * product it is part of without anybody deciding it should.
     */
    <div className="cmdk-scrim" onClick={onClose}>
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className="cmdk"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmdk__head">
          <Search size={18} aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands and objects"
            aria-label="Search commands and objects"
            aria-controls="command-results"
          />
          {/* How many, where the typing is. A fuzzy list that silently shrinks
              gives no sense of whether a query is narrowing or missing. */}
          {query.trim() && (
            <span className="cmdk__tally" role="status">
              {results.length === 0 ? 'no matches' : `${results.length}`}
            </span>
          )}
        </div>

        <div id="command-results" ref={listRef} role="listbox" aria-label="Results" className="cmdk__list">
          {results.length === 0 && (
            <p className="cmdk__none">Nothing matches “{query}”.</p>
          )}

          {results.map((item, index) => {
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            const isSelected = index === selectedIndex;

            return (
              <React.Fragment key={item.id}>
                {showGroup && <p className="cmdk__group">{item.group}</p>}
                <div
                  role="option"
                  aria-selected={isSelected}
                  data-selected={isSelected || undefined}
                  data-hovered={hovered === index || undefined}
                  className="cmdk__row"
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered((h) => (h === index ? null : h))}
                  onClick={() => commit(item)}
                >
                  <span className="cmdk__icon">{item.icon}</span>
                  <span className="cmdk__text">
                    <span className="cmdk__label"><Marked text={item.label} query={query} /></span>
                    {item.detail && <span className="cmdk__detail">{item.detail}</span>}
                  </span>
                  {item.shortcut && <kbd className="cmdk__key">{item.shortcut}</kbd>}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <div className="cmdk__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </motion.div>
    </div>
  );
};
