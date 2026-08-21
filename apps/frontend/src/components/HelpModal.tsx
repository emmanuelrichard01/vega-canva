import React, { useMemo, useState } from 'react';
import { X, Search } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { TOOL_SHORTCUTS } from '../engine/tools/shortcuts';
import { TOOL_NAMES } from '../engine/tools/toolNames';

interface Shortcut {
  keys: string;
  what: string;
}

interface Section {
  id: string;
  title: string;
  blurb?: string;
  rows: Shortcut[];
}

/** `Cmd` on a Mac, `Ctrl` everywhere else — decided once, at the top. */
const MOD =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? 'Cmd'
    : 'Ctrl';

function buildSections(): Section[] {
  const tools: Shortcut[] = Object.entries(TOOL_SHORTCUTS).map(([id, key]) => ({
    keys: key,
    what: TOOL_NAMES[id] ?? id,
  }));

  return [
    {
      id: 'tools',
      title: 'Tools',
      blurb: 'One key each, no modifier. Press it anywhere on the board.',
      rows: tools,
    },
    {
      id: 'navigation',
      title: 'Moving around',
      blurb: 'The board has no edges. You cannot run out of space in any direction.',
      rows: [
        { keys: 'Scroll', what: 'Pan up, down and sideways' },
        { keys: 'Pinch', what: 'Zoom in and out at the pointer' },
        { keys: 'Ctrl + Scroll', what: 'Zoom with a mouse wheel' },
        { keys: 'Space + Drag', what: 'Pan without leaving the current tool' },
        { keys: 'Arrows', what: 'Pan the canvas viewport (when no objects are selected)' },
        { keys: '0', what: 'Reset view to origin at 100%' },
        { keys: `${MOD} + 0`, what: 'Reset zoom & position to 100%' },
        { keys: '+ / −', what: 'Zoom in and out' },
        { keys: `${MOD} + + / −`, what: 'Zoom in and out with modifier' },
        { keys: 'Shift + 1', what: 'Fit everything on screen' },
        { keys: `${MOD} + 1`, what: 'Zoom to fit all objects' },
        { keys: `${MOD} + K`, what: 'Command palette & search' },
        { keys: `${MOD} + P`, what: 'Command palette alternative' },
        { keys: '?', what: 'Open keyboard shortcuts & help' },
        { keys: '\\', what: 'Toggle Zen mode — hide or show panels' },
      ],
    },
    {
      id: 'selection',
      title: 'Selecting',
      rows: [
        { keys: 'Click', what: 'Select one object' },
        { keys: 'Shift + Click', what: 'Add to or remove from selection' },
        { keys: 'Drag on empty board', what: 'Marquee — select everything inside' },
        { keys: `${MOD} + A`, what: 'Select every object on the board' },
        { keys: 'Esc', what: 'Deselect, or exit current edit mode' },
        { keys: 'Double-click', what: 'Edit text, path anchors, or crop image' },
        { keys: 'Enter', what: 'Edit selected text, note or comment' },
        { keys: 'Right-click', what: 'Context menu with type-actions & alignment' },
      ],
    },
    {
      id: 'editing',
      title: 'Editing',
      rows: [
        { keys: `${MOD} + Z`, what: 'Undo previous action' },
        { keys: `${MOD} + Shift + Z`, what: 'Redo previously undone action' },
        { keys: `${MOD} + Y`, what: 'Redo (Windows / Linux standard)' },
        { keys: `${MOD} + C`, what: 'Copy — works across boards and tabs' },
        { keys: `${MOD} + X`, what: 'Cut selection to clipboard' },
        { keys: `${MOD} + V`, what: 'Paste — SVG parses as editable vectors' },
        { keys: `${MOD} + D`, what: 'Duplicate selection, offset slightly' },
        { keys: `${MOD} + G`, what: 'Group selected objects' },
        { keys: `${MOD} + Shift + G`, what: 'Ungroup selected objects' },
        { keys: 'Delete / Backspace', what: 'Delete selection (frames take contents)' },
        { keys: 'Arrows', what: 'Nudge selection by 1 pixel' },
        { keys: 'Shift + Arrows', what: 'Nudge selection by 10 pixels' },
        { keys: `${MOD} + ]`, what: 'Bring selection forward one step' },
        { keys: `${MOD} + [`, what: 'Send selection backward one step' },
        { keys: `${MOD} + Shift + ]`, what: 'Bring selection to front' },
        { keys: `${MOD} + Shift + [`, what: 'Send selection to back' },
      ],
    },
    {
      id: 'vector',
      title: 'Vector & Direct Select (A)',
      blurb: 'Direct Select tool (A) or double-click any vector path or shape.',
      rows: [
        { keys: 'A', what: 'Direct Select tool (anchors & bezier handles)' },
        { keys: 'Click + Drag', what: 'Marquee select multiple anchor points' },
        { keys: `${MOD} / Shift + Click`, what: 'Add or toggle anchors in selection' },
        { keys: 'Click Outline', what: 'Insert new anchor point on path' },
        { keys: 'Shift + Drag', what: 'Constrain anchor/handle drag to 0°, 45°, 90° axes' },
        { keys: 'Alt + Drag Handle', what: 'Break tangent symmetry for sharp cusp curves' },
        { keys: 'Alt + Click Anchor', what: 'Retract handles (convert to sharp corner)' },
        { keys: 'Double-click Anchor', what: 'Toggle between Corner and Smooth modes' },
        { keys: 'Delete / Backspace', what: 'Delete selected anchors and bridge path' },
        { keys: 'Arrows / Shift + Arrows', what: 'Nudge selected anchors by 1px / 10px' },
      ],
    },
    {
      id: 'typography',
      title: 'Type & Formatting',
      blurb: 'Works on text nodes, shape labels, and sticky notes.',
      rows: [
        { keys: `${MOD} + B`, what: 'Toggle Bold weight' },
        { keys: `${MOD} + I`, what: 'Toggle Italic style' },
        { keys: `${MOD} + U`, what: 'Toggle Underline' },
      ],
    },
    {
      id: 'layers',
      title: 'The Layers Panel',
      blurb: 'Click into the tree first — keyboard arrows navigate from there.',
      rows: [
        { keys: '↑ / ↓', what: 'Move cursor; Shift extends selection' },
        { keys: '← / →', what: 'Fold and unfold a frame or group' },
        { keys: `${MOD} + ↑ / ↓`, what: 'Move one position forward or back in stack' },
        { keys: 'Enter', what: 'Rename layer' },
        { keys: 'Space', what: 'Toggle layer visibility' },
        { keys: `${MOD} + A`, what: 'Select every visible layer row' },
        { keys: 'Delete', what: 'Delete selected layer rows' },
      ],
    },
    {
      id: 'radar',
      title: 'Minimap & Radar',
      blurb: 'Focus the radar to fly the camera around the workspace.',
      rows: [
        { keys: 'Arrows', what: 'Pan by a quarter of a screen' },
        { keys: '+ / −', what: 'Zoom in and out' },
        { keys: '0', what: 'Back to 100% zoom' },
        { keys: 'Shift + 1 / Home', what: 'Fit all objects on screen' },
      ],
    },
    {
      id: 'replay',
      title: 'Session Time Travel',
      blurb: 'While history replay is active. The live canvas is preserved.',
      rows: [
        { keys: '← / →', what: 'Step one moment in history' },
        { keys: 'K / Space', what: 'Play or pause timeline playback' },
        { keys: 'Home / End', what: 'Jump to the beginning or end of history' },
      ],
    },
    {
      id: 'stickies',
      title: 'Sticky Notes',
      rows: [
        { keys: 'S, then click', what: 'Place a note, ready to type' },
        { keys: 'Tab', what: 'Chain another note beside the active one' },
        { keys: 'Esc', what: 'Finish editing (empty notes self-clean)' },
      ],
    },
  ];
}

/**
 * Things worth knowing that are not a keystroke.
 */
const TIPS: Array<{ title: string; body: string }> = [
  {
    title: 'Connectors follow their objects',
    body:
      'An arrow stores which two objects it joins, never a fixed coordinate — so rearranging a flowchart never breaks it. With the Connector tool (X), click one object and then the other; dragging between them works too.',
  },
  {
    title: 'Aim at the middle, or at a spot',
    body:
      'Dropping an end in the middle of an object binds to the object and lets the route pick a side. Dropping it on an edge binds to that exact anchor. Select a connector and drag either end to re-aim it.',
  },
  {
    title: 'Diagrams go both ways',
    body:
      'Write a flowchart in Mermaid code and get real, editable boxes and arrows — not a picture. Select a diagram on your canvas and read it back out as Mermaid code.',
  },
  {
    title: 'Text boxes have three modes',
    body:
      'Auto-width grows horizontally, auto-height wraps and grows downward, and Fixed imposes both — in fixed mode dragging a corner handle scales text geometry.',
  },
  {
    title: 'Hand-drawn sketch styling',
    body:
      'Any shape, frame, or connector can be rendered in hand-drawn sketch style with 3 roughness levels. The result is deterministic and identical for all collaborators.',
  },
  {
    title: 'Physics & Force fields',
    body:
      'Play mode runs a 2D physics simulation on the board — shapes collide, fall, and react to force tools (Wind, Vortex, Attract, Repel, Shockwave). Stopping restores the original layout.',
  },
  {
    title: 'Collaborative real-time sync',
    body:
      'Changes are synchronized via Yjs CRDTs with single-writer ownership arbitration. Edits made while offline merge seamlessly when reconnecting.',
  },
];

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'tools', label: 'Tools' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'selection', label: 'Selection' },
  { id: 'editing', label: 'Editing' },
  { id: 'typography', label: 'Type' },
  { id: 'layers', label: 'Layers' },
  { id: 'tips', label: 'Tips' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<Props> = ({ open, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const panelRef = useFocusTrap(open, onClose);

  const sections = useMemo(buildSections, []);

  /**
   * Filtered across search query and active category tab.
   */
  const filtered = useMemo(() => {
    let result = sections;

    if (activeTab !== 'all' && activeTab !== 'tips') {
      result = result.filter((s) => s.id === activeTab);
    }

    const q = query.trim().toLowerCase();
    if (!q) return result;

    return result
      .map((s) => ({
        ...s,
        rows: s.rows.filter(
          (r) => r.what.toLowerCase().includes(q) || r.keys.toLowerCase().includes(q)
        ),
      }))
      .filter((s) => s.rows.length > 0);
  }, [sections, query, activeTab]);

  const showTips = (activeTab === 'all' || activeTab === 'tips') && !query;

  if (!open) return null;

  return (
    <div className="export-scrim" onPointerDown={onClose} role="presentation">
      <div
        ref={panelRef}
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="help-modal__head">
          <h2 id="help-title">Keyboard &amp; Help</h2>
          <div className="help-modal__search">
            <Search size={13} aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shortcuts…"
              aria-label="Search shortcuts"
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  color: 'var(--text-tertiary)',
                }}
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {/* Category Filter Tabs */}
        <nav className="help-modal__tabs" role="tablist" aria-label="Help categories">
          {CATEGORIES.map((cat) => {
            const isActive = activeTab === cat.id;
            return (
              <button
                key={cat.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(cat.id)}
                className={`help-modal__tab ${isActive ? 'help-modal__tab--active' : ''}`}
              >
                {cat.label}
              </button>
            );
          })}
        </nav>

        <div className="help-modal__body">
          {activeTab !== 'tips' && (
            <div className="help-modal__cols">
              {filtered.map((section) => (
                <section key={section.title} className="help-section">
                  <h3>{section.title}</h3>
                  {section.blurb && !query && <p className="help-section__blurb">{section.blurb}</p>}
                  <dl>
                    {section.rows.map((row) => (
                      <div key={row.keys + row.what} className="help-row">
                        <dt>
                          {row.keys.split(' + ').map((k, i) => (
                            <React.Fragment key={k + i}>
                              {i > 0 && <span className="help-plus">+</span>}
                              <kbd>{k}</kbd>
                            </React.Fragment>
                          ))}
                        </dt>
                        <dd>{row.what}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
              {filtered.length === 0 && (
                <p className="help-modal__empty">
                  Nothing matches “{query}”. Try searching for a tool name or a shortcut key like “{MOD}”.
                </p>
              )}
            </div>
          )}

          {showTips && (
            <div className="help-tips">
              <h3>Worth knowing</h3>
              {TIPS.map((tip) => (
                <div key={tip.title} className="help-tip">
                  <strong>{tip.title}</strong>
                  <p>{tip.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
