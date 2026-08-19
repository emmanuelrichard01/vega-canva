import React, { useMemo, useState } from 'react';
import { X, Search } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { TOOL_SHORTCUTS } from '../engine/tools/shortcuts';

/**
 * What every tool is called, in the order the dock shows them.
 *
 * The *keys* are not written here — they come from `TOOL_SHORTCUTS`, which is
 * what `Room` actually binds and what the dock badges render. A help screen
 * that hard-codes its own copy of the shortcuts is the worst version of this
 * document: it is the one place a person goes when they are already unsure,
 * and it is the place least likely to be updated when a binding changes.
 * Anything advertised here is bound, by construction.
 */
const TOOL_NAMES: Record<string, string> = {
  select: 'Select and move',
  hand: 'Pan the board',
  pen: 'Pencil — freehand',
  'bezier-pen': 'Pen — anchors and curves',
  eraser: 'Eraser',
  text: 'Text',
  shape: 'Shape',
  frame: 'Frame',
  connector: 'Connector',
  sticky: 'Sticky note',
  comment: 'Comment',
  image: 'Place an image',
  audio: 'Record a voice note',
};

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
      blurb: 'The board has no edges — you cannot run out of room in any direction.',
      rows: [
        { keys: 'Scroll', what: 'Pan up, down and sideways' },
        { keys: `${MOD} + Scroll`, what: 'Zoom in and out at the pointer' },
        { keys: 'Space + Drag', what: 'Pan without leaving the current tool' },
        { keys: `${MOD} + 0`, what: 'Zoom back to 100%' },
        { keys: `${MOD} + K`, what: 'Command palette — everything else' },
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
      ],
    },
    {
      title: 'Editing',
      rows: [
        { keys: `${MOD} + Z`, what: 'Undo' },
        { keys: `${MOD} + Shift + Z`, what: 'Redo' },
        { keys: `${MOD} + D`, what: 'Duplicate' },
        { keys: `${MOD} + G`, what: 'Group' },
        { keys: `${MOD} + Shift + G`, what: 'Ungroup' },
        { keys: 'Delete', what: 'Delete the selection' },
        { keys: 'Arrows', what: 'Nudge by one unit' },
        { keys: 'Shift + Arrows', what: 'Nudge by ten' },
      ],
    },
    {
      title: 'The Layers panel',
      blurb: 'Click into the tree first — the arrow keys drive it from there.',
      rows: [
        { keys: '↑ / ↓', what: 'Move the cursor; Shift extends the selection' },
        { keys: '← / →', what: 'Fold and unfold a frame' },
        { keys: 'Enter', what: 'Rename' },
        { keys: 'Space', what: 'Show or hide' },
        { keys: `${MOD} + ↑ / ↓`, what: 'Restack' },
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
      'An arrow stores which two objects it joins, never a coordinate — so rearranging a flowchart never breaks it. Draw from the edge of a shape with the Connector tool (X).',
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
    title: 'Nothing here is an account',
    body:
      'Your boards are listed by this browser, and anyone with a room link can edit that room. There are no roles and no revoking — treat a link as the permission.',
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
