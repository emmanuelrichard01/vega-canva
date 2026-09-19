import React from 'react';
import { ArrowRight, Compass, Link2, Plus, UploadCloud } from 'lucide-react';

interface Props {
  templateCount: number;
  onBlank: () => void;
  onTemplates: () => void;
  onJoin: () => void;
  onRestore: () => void;
}

/**
 * The library with nothing in it — the one screen a person sees before they
 * have anything of their own.
 *
 * ## What this replaced, and why none of it was cosmetic
 *
 * It was four identical rows, each an icon, a name, a line of explanation and a
 * right-pointing arrow, under a heading set at 16px in secondary grey. Three
 * separate failures stacked on the screen that has to work hardest:
 *
 * 1. **There was no front door.** Not one accent-filled control anywhere on it.
 *    The accent appeared as a 16px icon tint on the first row and nowhere else,
 *    so the screen whose entire job is to get somebody started declined to say
 *    which of the four things to do. Four identical rows is a page that has
 *    refused to advise.
 * 2. **The heading was the quietest text on the screen.** "Nothing here yet" in
 *    grey, at body size, under a 30px black page title that said "Your boards" —
 *    so the largest type on the screen named a collection that did not exist and
 *    the actual message was set smaller than the explanations beneath it.
 * 3. **It was the refused layout.** Same-size cards of icon plus heading plus
 *    text, as the page's structure.
 *
 * ## The shape now
 *
 * One sentence that says what this place is for, one accent-filled button that
 * makes a board, and the three rarer ways in as one quiet line underneath.
 * Ranking them is the entire point: a blank board is the honest default, and the
 * other three are answers to conditions a newcomer either has or does not — a
 * link somebody sent, a backup from another machine, or no idea what to draw.
 *
 * The three are text buttons rather than tiles because a tile the size of the
 * primary reads as an equal option, which is the flattening this screen existed
 * to undo.
 */
export const QuickStart: React.FC<Props> = ({
  templateCount,
  onBlank,
  onTemplates,
  onJoin,
  onRestore,
}) => (
  <div className="qstart">
    <h2 className="qstart__title">Start your first board</h2>
    <p className="qstart__lede">
      An infinite canvas for diagrams, notes and sketches, shared with anyone you
      send the link to. Boards you open on this device collect here.
    </p>

    <button type="button" className="qstart__primary" onClick={onBlank}>
      <Plus size={17} aria-hidden="true" />
      New blank board
    </button>

    {/* The other three, ranked and quiet. A template first: it is the fastest
        route to something that looks like work, and the only one of the three
        that needs nothing from the person. */}
    <div className="qstart__more">
      <button type="button" className="qstart__alt" onClick={onTemplates}>
        <Compass size={15} aria-hidden="true" />
        Browse {templateCount} templates
        <ArrowRight size={14} className="qstart__alt-go" aria-hidden="true" />
      </button>
      <button type="button" className="qstart__alt" onClick={onJoin}>
        <Link2 size={15} aria-hidden="true" />
        Open a shared link
      </button>
      <button type="button" className="qstart__alt" onClick={onRestore}>
        <UploadCloud size={15} aria-hidden="true" />
        Restore a backup
      </button>
    </div>
  </div>
);
