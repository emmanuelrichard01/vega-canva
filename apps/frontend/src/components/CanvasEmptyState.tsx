import React from 'react';
import { Command, Frame, Square, StickyNote, Type } from 'lucide-react';
import { Logo } from './ui/Logo';
import { useStore } from '../hooks/useStore';

/**
 * What a brand-new canvas says for itself.
 *
 * An empty infinite canvas is the least self-explanatory surface in the
 * product: nothing on screen, no edges, and no indication that the dock at the
 * bottom is where you begin.
 *
 * ## What it stopped saying
 *
 * It was headed **"A canvas with no edges"** — which is, word for word, the
 * first beat of `WelcomeSequence`, down to the fading dot field drawn beside
 * it. Two surfaces answering the same question is the thing this product's
 * first principle forbids, and the duplication was not harmless: the welcome
 * explains *what this is*, once, and by the time you are looking at an empty
 * board you have already been told. Being told again, in the same words, at
 * the moment you want to start, is the interface talking instead of getting
 * out of the way.
 *
 * So this answers the other question — **what do I do right now** — and the
 * answer is that it does not matter where, which is the one genuinely useful
 * consequence of an infinite canvas for someone about to make their first
 * mark.
 *
 * ## What it stopped offering
 *
 * Comment was one of the three starting moves. There is nothing on an empty
 * board to comment on, so the first thing it offered was the one tool that
 * could not do anything. The four here are the real openings: a note, some
 * words, a shape, or a frame to put them in.
 *
 * ## What it does not do
 *
 * There is no big grey icon in a rounded square. The three chips are the
 * affordance, and an ornament above them is a picture of an empty state
 * rather than a way out of one.
 *
 * Non-modal and non-blocking throughout: the prose never takes a click, the
 * chips individually do, and the whole thing disappears the instant the first
 * object exists so it never becomes something to dismiss.
 */
export const CanvasEmptyState: React.FC<{ visible: boolean }> = ({ visible }) => {
  const objectCount = useStore((state) => Object.keys(state.objects).length);

  if (!visible || objectCount > 0) return null;

  const openings: Array<{ icon: React.ReactNode; label: string; keys: string; tool: string }> = [
    { icon: <StickyNote size={15} />, label: 'Sticky note', keys: 'S', tool: 'sticky' },
    { icon: <Type size={15} />, label: 'Text', keys: 'T', tool: 'text' },
    { icon: <Square size={15} />, label: 'Shape', keys: 'R', tool: 'shape' },
    { icon: <Frame size={15} />, label: 'Frame', keys: 'F', tool: 'frame' },
  ];

  return (
    <div className="empty-canvas" role="note" aria-label="This board is empty">
      {/* The wordmark, and deliberately not the mark-plus-name lockup.

          The header already carries the mark beside "Vega Studio" set in the
          interface's type. Repeating that arrangement in the middle of the
          same screen is the same lockup twice, forty pixels apart, which
          reads as a template rather than as identity. The wordmark is the one
          piece of the identity not already on screen.

          Not the stacked `full` lockup either: at 227x256 it is a block, and
          this wants to be a line above a line.

          Quiet on purpose. An empty board should say what to do first and
          whose tool it is second. */}
      <Logo piece="wordmark" size={30} className="empty-canvas__brand" alt="Vega Studio" />

      {/* One line, not a headline over a line.

          "Start anywhere" was set at 28px directly beneath the wordmark, so
          two pieces of large type sat sixteen pixels apart competing to be
          read first — and the heading won, which is backwards on the one
          screen where the identity is the only thing to look at. The idea it
          carried was never a heading anyway; it is the first clause of the
          sentence underneath it. */}
      <p className="empty-canvas__body">
        Start anywhere. This canvas has no edges and no wrong place to begin.
        Scroll to move around the board, <kbd>Ctrl</kbd>{'+scroll to zoom.'}
      </p>

      <div className="empty-canvas__openings">
        {openings.map((opening) => (
          <button
            key={opening.label}
            type="button"
            className="empty-canvas__opening"
            // Armed through the same event the dock dispatches, so there is
            // one way in and no second tool-selection path to drift from it.
            onClick={() => window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: opening.tool }))}
            aria-label={`${opening.label} tool, shortcut ${opening.keys}`}
          >
            <span className="empty-canvas__opening-icon">{opening.icon}</span>
            {opening.label}
            <kbd>{opening.keys}</kbd>
          </button>
        ))}
      </div>

      <span className="empty-canvas__more">
        <Command size={13} aria-hidden="true" />
        Press <kbd>Ctrl K</kbd> for everything else
      </span>
    </div>
  );
};
