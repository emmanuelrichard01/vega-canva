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
  /** The tab label. Short, because the tab strip is a row of them. */
  tab: string;
  title: string;
  blurb?: string;
  rows: Shortcut[];
}

interface Tip {
  title: string;
  body: string;
}

/**
 * `Cmd` on a Mac, `Ctrl` everywhere else — decided once, at the top.
 *
 * `navigator.platform` is deprecated and empty in some browsers, which would
 * quietly tell every Mac user to press Ctrl. `userAgentData.platform` is the
 * replacement where it exists; the user-agent string is the fallback that has
 * always worked. Three sources, one answer, computed once.
 */
const MOD = ((): string => {
  if (typeof navigator === 'undefined') return 'Ctrl';
  const claimed =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    '';
  return /Mac|iPhone|iPad|iPod/i.test(claimed) ? 'Cmd' : 'Ctrl';
})();

function buildSections(): Section[] {
  const tools: Shortcut[] = Object.entries(TOOL_SHORTCUTS).map(([id, key]) => ({
    keys: key,
    what: TOOL_NAMES[id] ?? id,
  }));

  return [
    {
      id: 'tools',
      tab: 'Tools',
      title: 'Tools',
      blurb: 'One key each, no modifier. Press it anywhere on the board.',
      rows: tools,
    },
    {
      id: 'navigation',
      tab: 'Navigation',
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
      tab: 'Selection',
      title: 'Selecting',
      rows: [
        { keys: 'Click', what: 'Select one object' },
        { keys: 'Shift + Click', what: 'Add to or remove from selection' },
        { keys: 'Drag on empty board', what: 'Marquee — select everything inside' },
        { keys: `${MOD} + A`, what: 'Select every object on the board' },
        { keys: 'Esc', what: 'Deselect, or exit current edit mode' },
        { keys: 'Double-click', what: 'Go inside: text, line points, path anchors, image crop' },
        { keys: 'Enter', what: 'Edit selected text or note — or open a line’s points' },
        { keys: 'Alt + Drag', what: 'Duplicate the object instead of moving it' },
        { keys: 'Right-click', what: 'Context menu with type-actions & alignment' },
      ],
    },
    {
      id: 'editing',
      tab: 'Editing',
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
      /**
       * The tool that changed most, and the one nobody will guess at.
       *
       * A line was two points for the whole life of this project, so there is
       * no reason for anyone to suspect that clicking rather than dragging does
       * something different — which makes this the section most worth having.
       */
      id: 'lines',
      tab: 'Lines',
      title: 'Lines & arrows',
      blurb: 'Drag for a straight line. Click for one with corners.',
      rows: [
        { keys: 'L / R', what: 'Line tool / Arrow tool' },
        { keys: 'Drag', what: 'A straight line from where you pressed to where you let go' },
        { keys: 'Click, click, click', what: 'Place a corner with each click' },
        { keys: 'Enter / Esc', what: 'Finish the line you are drawing' },
        { keys: 'Double-click', what: 'Also finishes it — the last click lands on the last corner' },
        { keys: 'Backspace', what: 'Take back the corner you just placed' },
        { keys: 'Shift', what: 'Constrain the next corner to 15° steps' },
      ],
    },
    {
      id: 'linepoints',
      tab: 'Line points',
      title: 'Reshaping a line',
      blurb: 'Double-click a line, or press Enter with it selected.',
      rows: [
        { keys: 'Double-click', what: 'Open the point editor' },
        { keys: `Enter / ${MOD} + Enter`, what: 'Open it from the keyboard' },
        { keys: 'Drag a point', what: 'Move that corner' },
        { keys: 'Drag a curve handle', what: 'Bend the segment into an arc' },
        { keys: 'Alt + Click a segment', what: 'Add a corner where you clicked' },
        { keys: 'Alt + Click a curve handle', what: 'Straighten that segment again' },
        { keys: 'Delete', what: 'Remove the selected corner' },
        { keys: 'Shift + Drag', what: 'Constrain to 15° from the neighbouring point' },
        { keys: 'Esc', what: 'Leave the point editor' },
      ],
    },
    {
      id: 'pen',
      tab: 'Pen',
      title: 'The Pen (P)',
      blurb: 'Bézier curves. Click for corners, drag for smooth ones.',
      rows: [
        { keys: 'Click', what: 'Place a corner point' },
        { keys: 'Drag', what: 'Place a smooth point and pull its handles' },
        { keys: 'Alt + Drag', what: 'Break the handles apart for a cusp' },
        { keys: 'Click the last point', what: 'Retract its outgoing handle' },
        { keys: 'Click the first point', what: 'Close the path' },
        { keys: 'Shift', what: 'Constrain to 45° steps' },
        { keys: 'Backspace', what: 'Undo the last point' },
        { keys: 'Enter', what: 'Finish as an open path' },
        { keys: 'Esc', what: 'Discard the path' },
      ],
    },
    {
      id: 'vector',
      tab: 'Vector',
      title: 'Vector & Direct Select (A)',
      blurb: 'Direct Select tool (A) or double-click any vector path.',
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
      tab: 'Type',
      title: 'Type & Formatting',
      blurb: 'Works on text nodes, shape labels, and sticky notes.',
      rows: [
        { keys: `${MOD} + B`, what: 'Toggle Bold weight' },
        { keys: `${MOD} + I`, what: 'Toggle Italic style' },
        { keys: `${MOD} + U`, what: 'Toggle Underline' },
      ],
    },
    {
      id: 'export',
      tab: 'Export',
      title: 'Copying & exporting',
      blurb: 'Everything works on a selection as well as on the whole board.',
      rows: [
        { keys: `${MOD} + Shift + E`, what: 'Export the selection — six formats, with a preview' },
        { keys: 'Right-click', what: 'Copy as PNG or SVG, and Export from the same menu' },
      ],
    },
    {
      id: 'stickies',
      tab: 'Notes',
      title: 'Sticky Notes',
      rows: [
        { keys: 'S, then click', what: 'Place a note, ready to type' },
        { keys: 'Tab', what: 'Chain another note beside the active one' },
        { keys: 'Esc', what: 'Finish editing (empty notes self-clean)' },
      ],
    },
    {
      id: 'layers',
      tab: 'Layers',
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
      tab: 'Radar',
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
      tab: 'History',
      title: 'Session Time Travel',
      blurb: 'While history replay is active. The live canvas is preserved.',
      rows: [
        { keys: '← / →', what: 'Step one moment in history' },
        { keys: 'K / Space', what: 'Play or pause timeline playback' },
        { keys: 'Home / End', what: 'Jump to the beginning or end of history' },
      ],
    },
  ];
}

/**
 * Things worth knowing that are not a keystroke.
 *
 * The test for what belongs here: it has to be something the interface cannot
 * tell you by itself, and something that changes what you would do. "Edits sync
 * over CRDTs" fails both — it is true, it is invisible, and knowing it does not
 * change a single action anyone takes.
 */
const TIPS: Tip[] = [
  {
    title: 'A line can turn corners',
    body:
      'Drag the Line tool for a straight one. Click instead, once per corner, for a route — then Enter to finish. Afterwards, double-click any line to move its points, or drag the small handle on a segment to bend it into an arc.',
  },
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
    title: 'Combine shapes, and see it first',
    body:
      'Select two or more shapes and use Union, Subtract, Intersect or Exclude on the floating toolbar. Hovering a button draws the result over the shapes it would replace, so you can tell the four apart before committing to one.',
  },
  {
    title: 'Text can become a shape',
    body:
      'Right-click a text object and Convert to path to get its real letterforms as editable vectors — counters and all. Decorations a contour cannot express, like a highlight, are named as they are dropped rather than silently lost.',
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
    title: 'Physics & force fields',
    body:
      'Play mode runs a 2D physics simulation on the board — shapes collide, fall, and react to force tools (Wind, Vortex, Attract, Repel, Shockwave). Stopping restores the original layout.',
  },
  {
    title: 'Nothing is lost offline',
    body:
      'Keep editing with the network down. Your changes merge with everyone else’s when you reconnect, rather than one side overwriting the other.',
  },
];

const TIPS_TAB = 'tips';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * The keyboard reference, and the handful of things a keyboard cannot say.
 *
 * ## What was wrong with the filtering
 *
 * The tab strip was a hand-written list of eight beside a section list of ten,
 * which is the arrangement this codebase keeps finding bugs in: four sections —
 * the vector tools, the radar, time travel and sticky notes — had **no tab of
 * their own**, so picking any tab hid them and they were reachable only under
 * "All". Nothing said so; they simply were not there. The tabs are derived from
 * the sections now, so a section cannot exist without a way to reach it.
 *
 * Search had the mirror of the same fault. Tips were shown only when the query
 * was empty, so typing a word that appears in a tip hid every tip — and picking
 * the Tips tab and then typing produced a blank panel with no message, because
 * the empty state was itself inside the "not the tips tab" branch. A search that
 * hides what matches is worse than no search at all. Both lists are searched
 * now, and every combination of tab and query renders either results or a
 * sentence saying why not.
 */
export const HelpModal: React.FC<Props> = ({ open, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const panelRef = useFocusTrap(open, onClose);

  const sections = useMemo(buildSections, []);

  /**
   * The tabs, from the content rather than from a second list beside it.
   *
   * "All" and "Tips" are the two that are not a section — one is the absence of
   * a filter and the other is the other half of the panel.
   */
  const categories = useMemo(
    () => [
      { id: 'all', label: 'All' },
      ...sections.map((s) => ({ id: s.id, label: s.tab })),
      { id: TIPS_TAB, label: 'Tips' },
    ],
    [sections]
  );

  const q = query.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    if (activeTab === TIPS_TAB) return [];
    const scoped = activeTab === 'all' ? sections : sections.filter((s) => s.id === activeTab);
    if (!q) return scoped;

    return scoped
      .map((s) => ({
        ...s,
        rows: s.rows.filter(
          (r) => r.what.toLowerCase().includes(q) || r.keys.toLowerCase().includes(q)
        ),
      }))
      // A section whose title matches keeps all of its rows: searching "line"
      // should show the line section entire, not only the two rows that happen
      // to repeat the word.
      .map((s, i) =>
        s.rows.length === 0 && s.title.toLowerCase().includes(q) ? scoped[i] : s
      )
      .filter((s) => s.rows.length > 0);
  }, [sections, q, activeTab]);

  /** Tips are searched too, and only hidden when a tab excludes them. */
  const filteredTips = useMemo(() => {
    if (activeTab !== 'all' && activeTab !== TIPS_TAB) return [];
    if (!q) return TIPS;
    return TIPS.filter(
      (t) => t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q)
    );
  }, [q, activeTab]);

  const nothingMatched = filteredSections.length === 0 && filteredTips.length === 0;

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
              placeholder="Search shortcuts and tips…"
              aria-label="Search shortcuts and tips"
              autoFocus
            />
            {query && (
              <button
                type="button"
                className="help-modal__clear"
                onClick={() => setQuery('')}
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

        <nav className="help-modal__tabs" role="tablist" aria-label="Help categories">
          {categories.map((cat) => {
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

        {/* One column when there are no tips to sit beside — otherwise the
            reference is squeezed into two thirds of the width for a panel that
            is not there. */}
        <div className={`help-modal__body ${filteredTips.length === 0 ? 'help-modal__body--wide' : ''}`}>
          {filteredSections.length > 0 && (
            <div className="help-modal__cols">
              {filteredSections.map((section) => (
                <section key={section.id} className="help-section">
                  <h3>{section.title}</h3>
                  {section.blurb && !q && <p className="help-section__blurb">{section.blurb}</p>}
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
            </div>
          )}

          {filteredTips.length > 0 && (
            <div className="help-tips">
              <h3>Worth knowing</h3>
              {filteredTips.map((tip) => (
                <div key={tip.title} className="help-tip">
                  <strong>{tip.title}</strong>
                  <p>{tip.body}</p>
                </div>
              ))}
            </div>
          )}

          {/* Outside both branches, so every combination of tab and query says
              something. Picking Tips and then typing used to render a blank
              panel: the empty state lived inside the "not the tips tab" branch
              and could not be reached from there. */}
          {nothingMatched && (
            <p className="help-modal__empty">
              {q
                ? <>Nothing matches “{query}”. Try a tool name, or a key like <kbd>{MOD}</kbd>.</>
                : 'Nothing to show here yet.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
