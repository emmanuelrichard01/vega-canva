import React, { useContext } from 'react';
import { ArrowRight, Compass, Link2, Plus, UploadCloud } from 'lucide-react';
import type { Template } from '../../engine/templates/templates';
import { requestGuidedStart } from '../../engine/learn/tourChecklist';
import { AuthContext } from '../../hooks/useAuth';
import { TemplateCard } from './TemplateCard';
import '../onboarding/quickstart.css';

interface Props {
  templateCount: number;
  /** A few real templates to start from, shown as their covers. */
  starters: readonly Template[];
  peekingId: string | null;
  onBlank: () => void;
  onTemplates: () => void;
  onPeek: (template: Template) => void;
  onUse: (template: Template) => void;
  onJoin: () => void;
  onRestore: () => void;
}

/** The first name only: "Ada Lovelace" is greeted as Ada. */
function firstName(name: string | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * The library with nothing in it, which is the dashboard's first-run moment.
 *
 * A greeting, one sentence about the place, and three ways to start that differ
 * in how much help they bring: a blank board (the one accent), a guided first
 * board that opens with the tour and the checklist, and the templates below as
 * their covers. The rarer ways in (a shared link, a backup) are quiet text.
 * No modal, no wall: everything here is a door, and any of them can be ignored.
 */
export const QuickStart: React.FC<Props> = ({
  templateCount, starters, peekingId, onBlank, onTemplates, onPeek, onUse, onJoin, onRestore,
}) => {
  const name = firstName(useContext(AuthContext)?.user?.name);

  const guided = () => {
    requestGuidedStart();
    onBlank();
  };

  return (
    <div className="qstart">
      <div className="qstart__intro">
        <h2 className="qstart__title">{name ? `Welcome, ${name}` : 'Welcome to Vega Studio'}</h2>
        <p className="qstart__lede">
          An infinite canvas for diagrams, notes and sketches, shared with anyone you send the link to.
        </p>

        <div className="qstart__go">
          <button type="button" className="qstart__primary" onClick={onBlank}>
            <Plus size={17} aria-hidden="true" />
            New blank board
            <kbd aria-hidden="true">N</kbd>
          </button>
          <button type="button" className="qstart__guided" onClick={guided} aria-describedby="qstart-guided-hint">
            <Compass size={16} aria-hidden="true" />
            <span className="qstart__guided-text">
              <span className="qstart__guided-label">Make your first board</span>
              <span id="qstart-guided-hint" className="qstart__guided-hint">
                A one-minute tour, then five first moves
              </span>
            </span>
          </button>
        </div>

        <p className="qstart__quiet">
          <button type="button" className="qstart__link" onClick={onJoin}>
            <Link2 size={14} aria-hidden="true" />
            Open a shared link
          </button>
          <button type="button" className="qstart__link" onClick={onRestore}>
            <UploadCloud size={14} aria-hidden="true" />
            Restore a backup
          </button>
        </p>
      </div>

      {starters.length > 0 && (
        <section className="qstart__starters" aria-labelledby="qstart-starters">
          <header className="qstart__starters-head">
            <h3 id="qstart-starters" className="qstart__starters-title">Or start from a template</h3>
            <button type="button" className="lbtn" onClick={onTemplates}>
              All {templateCount}
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </header>
          <div className="tgrid ggrid tgrid--starters">
            {starters.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                peeking={peekingId === t.id}
                scope="starter"
                onPeek={onPeek}
                onUse={onUse}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
