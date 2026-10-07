import React from 'react';
import { ArrowRight, Link2, Plus, UploadCloud } from 'lucide-react';
import type { Template } from '../../engine/templates/templates';
import type { BoardPreview } from '../../engine/model/boardPreview';
import { TemplateCard } from './TemplateCard';

interface Props {
  templateCount: number;
  /** A few real templates to start from, shown as their covers. */
  starters: readonly Template[];
  previews: Record<string, BoardPreview | null>;
  peekingId: string | null;
  onBlank: () => void;
  onTemplates: () => void;
  onPeek: (template: Template) => void;
  onUse: (template: Template) => void;
  onJoin: () => void;
  onRestore: () => void;
}

/**
 * The library with nothing in it: one sentence about what this place is, one
 * accent button that makes a board, and three real templates as pictures —
 * a cover answers "what could this be" faster than any label.
 */
export const QuickStart: React.FC<Props> = ({
  templateCount, starters, previews, peekingId, onBlank, onTemplates, onPeek, onUse, onJoin, onRestore,
}) => (
  <div className="qstart">
    <div className="qstart__intro">
      <h2 className="qstart__title">Start your first board</h2>
      <p className="qstart__lede">
        An infinite canvas for diagrams, notes and sketches, shared with anyone you send the link to.
      </p>

      <div className="qstart__go">
        <button type="button" className="qstart__primary" onClick={onBlank}>
          <Plus size={17} aria-hidden="true" />
          New blank board
          <kbd aria-hidden="true">N</kbd>
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

    {starters.length > 0 && (
      <section className="qstart__starters" aria-labelledby="qstart-starters">
        <header className="qstart__starters-head">
          <h3 id="qstart-starters" className="qstart__starters-title">Or start from a template</h3>
          <button type="button" className="lbtn" onClick={onTemplates}>
            All {templateCount}
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </header>
        <div className="tgrid tgrid--starters">
          {starters.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              preview={previews[t.id] ?? null}
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
