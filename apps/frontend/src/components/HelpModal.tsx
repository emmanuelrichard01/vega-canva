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
      title: 'Tools',
      blurb: 'One key each, no modifier. Press it anywhere on the board.',
      rows: tools,
    },
    {
      title: 'Moving around',
      blurb: 'The board has no edges. You cannot run out of space in any direction.',
      rows: [
        { keys: 'Scroll', what: 'Pan up, down and sideways' },
        // Zoom is bound to ctrl+wheel, which is also how every browser reports
        // a trackpad pinch — so this is one binding, not two, and writing
        // `Cmd` here on a Mac would advertise a key nothing listens for.
        { keys: 'Pinch', what: 'Zoom in and out at the pointer' },
        { keys: 'Ctrl + Scroll', what: 'Zoom with a mouse wheel' },
        { keys: 'Space + Drag', what: 'Pan without leaving the current tool' },
        { keys: '0', what: 'Back to the origin at 100%' },
        { keys: `${MOD} + K`, what: 'Command palette — everything else' },
        { keys: '?', what: 'This screen' },
        { keys: '\\', what: 'Hide the panels and work on the board alone' },
      ],
    },
    {
      title: 'Selecting',
      rows: [
        { keys: 'Click', what: 'Select one object' },
        { keys: 'Shift + Click', what: 'Add to or remove from the selection' },
        { keys: 'Drag on empty board', what: 'Marquee — select everything inside' },
        { keys: `${MOD} + A`, what: 'Select everything' },
        { keys: 'Esc', what: 'Deselect, or leave the current mode' },
        { keys: 'Double-click', what: 'Edit — text, a label, a path, or crop an image' },
        { keys: 'Enter', what: 'Edit the selected text, note or comment' },
        { keys: 'Right-click', what: 'Everything for the selection, including select all of a type' },
      ],
    },
    {
      title: 'Editing',
      rows: [
        { keys: `${MOD} + Z`, what: 'Undo' },
        { keys: `${MOD} + Shift + Z`, what: 'Redo' },
        { keys: `${MOD} + C`, what: 'Copy — works into another board, or another tab' },
        { keys: `${MOD} + X`, what: 'Cut' },
        { keys: `${MOD} + V`, what: 'Paste. SVG from another tool pastes as editable shapes' },
        { keys: `${MOD} + D`, what: 'Duplicate, offset slightly' },
        { keys: `${MOD} + G`, what: 'Group' },
        { keys: `${MOD} + Shift + G`, what: 'Ungroup' },
        { keys: 'Delete', what: 'Delete the selection — a frame takes its contents' },
        { keys: 'Arrows', what: 'Nudge by one' },
        { keys: 'Shift + Arrows', what: 'Nudge by ten' },
        { keys: `${MOD} + Shift + ]`, what: 'Bring to front' },
        { keys: `${MOD} + Shift + [`, what: 'Send to back' },
      ],
    },
    {
      title: 'Type',
      blurb: 'On text, a shape’s label, or a sticky note.',
      rows: [
        { keys: `${MOD} + B`, what: 'Bold' },
        { keys: `${MOD} + I`, what: 'Italic' },
        { keys: `${MOD} + U`, what: 'Underline' },
      ],
    },
    {
      title: 'The Layers panel',
      blurb: 'Click into the tree first — the arrow keys drive it from there.',
      rows: [
        { keys: '↑ / ↓', what: 'Move the cursor; Shift extends the selection' },
        { keys: '← / →', what: 'Fold and unfold a frame or group' },
        // "Restack" was true of any behaviour, including the inverted one this
        // had for its whole life. A hint has to be specific enough to be wrong.
        { keys: `${MOD} + ↑ / ↓`, what: 'Move one place forward or back in the stack' },
        { keys: 'Enter', what: 'Rename' },
        { keys: 'Space', what: 'Show or hide' },
        { keys: `${MOD} + A`, what: 'Select every row on show' },
        { keys: 'Delete', what: 'Delete the selected rows' },
      ],
    },
    {
      title: 'The minimap',
      blurb: 'Focus the radar — then it flies the camera without touching the board.',
      rows: [
        { keys: 'Arrows', what: 'Pan by a quarter of a screen' },
        { keys: '+ / −', what: 'Zoom in and out' },
        { keys: '0', what: 'Back to 100%' },
        { keys: 'F', what: 'Fit everything on screen' },
      ],
    },
    {
      title: 'Replaying a session',
      blurb: 'While the replay bar is open. The board is read-only until you close it.',
      rows: [
        { keys: '← / →', what: 'Step one moment' },
        { keys: 'K', what: 'Play or pause' },
        { keys: 'Home / End', what: 'Jump to the first or last moment' },
      ],
    },
    {
      title: 'Sticky notes',
      rows: [
        { keys: 'S, then click', what: 'Place a note, ready to type in' },
        { keys: 'Tab', what: 'Chain another note beside this one' },
        { keys: 'Esc', what: 'Finish — an empty note removes itself' },
      ],
    },
  ];
}

/**
 * Things worth knowing that are not a keystroke.
 *
 * Kept apart from the tables on purpose. A tip is a sentence about how the
 * product thinks, and burying one in a two-column key list is how it goes
 * unread — these are the answers to the questions people actually arrive with.
 */
const TIPS: Array<{ title: string; body: string }> = [
  {
    title: 'Connectors follow their objects',
    body:
      'An arrow stores which two objects it joins, never a coordinate — so rearranging a flowchart never breaks it. With the Connector tool (X), click one object and then the other; dragging between them works too.',
  },
  {
    title: 'Aim at the middle, or at a spot',
    body:
      'Dropping an end in the middle of an object binds to the object and lets the route pick a side, which keeps looking right as things move. Dropping it on an edge binds to that exact place. Select a connector and drag either end to re-aim it.',
  },
  {
    title: 'A connector needs two objects',
    body:
      'Both ends have to land on something — an arrow that joins nothing is a line, and the Line tool (R) draws one. Deleting a shape still leaves its connectors where they were rather than collapsing them.',
  },
  {
    title: 'Diagrams go both ways',
    body:
      'Write a flowchart in Mermaid and get real, editable boxes and arrows — not a picture. Select a diagram you have drawn and you can read it back out as code.',
  },
  {
    title: 'Text boxes have three modes',
    body:
      'Auto width grows sideways, auto height wraps and grows down, and Fixed imposes both — which is also the mode where dragging an edge stretches the letterforms.',
  },
  {
    title: 'Sketch is per object',
    body:
      'Any shape or connector can be drawn by hand, at three levels. The result is stable: it never re-randomises, so it looks the same for everyone and in exports.',
  },
  {
    title: 'The board can be played',
    body:
      'Play mode hands everything on the canvas to a physics engine — objects fall, collide and settle. Pin anything you want to stay put, and stopping puts the board back exactly as it was.',
  },
  {
    title: 'Every board remembers how it was built',
    body:
      'Replay steps through the board’s history one moment at a time, showing who made each change. It is a view, not an undo. The live board is untouched while you watch.',
  },
  {
    title: 'Nothing here is an account',
    body:
      'Your boards are listed by this browser, and anyone with the link can edit the board. There are no roles and no way to revoke access, so treat the link itself as the permission.',
  },
  {
    title: 'Offline is fine',
    body:
      'Edits made while disconnected are kept locally and merge when you come back. You will not be asked to resolve anything.',
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<Props> = ({ open, onClose }) => {
  const [query, setQuery] = useState('');
  const panelRef = useFocusTrap(open, onClose);


  const sections = useMemo(buildSections, []);

  /**
   * Filtered across both the key and the description.
   *
   * Someone looking for "how do I duplicate" and someone looking for what
   * `Cmd+D` does are the same person at different moments, and a help screen
   * that only matched one of those would fail whichever half arrived.
   */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map((s) => ({
        ...s,
        rows: s.rows.filter(
          (r) => r.what.toLowerCase().includes(q) || r.keys.toLowerCase().includes(q)
        ),
      }))
      .filter((s) => s.rows.length > 0);
  }, [sections, query]);

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
          <h2 id="help-title">Keyboard &amp; help</h2>
          <div className="help-modal__search">
            <Search size={13} aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shortcuts"
              aria-label="Search shortcuts"
              autoFocus
            />
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="help-modal__body">
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
                Nothing matches “{query}”. Try a tool name, or a key like “{MOD}”.
              </p>
            )}
          </div>

          {!query && (
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
