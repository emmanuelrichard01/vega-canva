import React from 'react';
import { Eye } from 'lucide-react';
import type { Template } from '../../engine/templates/templates';
import { LiveCover } from './LiveCover';
import { isInteractive } from './templateFacts';
import './gallery.css';

interface Props {
  template: Template;
  /** The template the peek is showing, so its card reads as the current one. */
  peeking: boolean;
  /** Where the roving id comes from; templates appear in more than one grid. */
  scope: string;
  /** How many capability chips fit; the rest are in the peek. */
  chips?: number;
  onPeek: (template: Template) => void;
  onUse: (template: Template) => void;
}

/**
 * A template in the gallery.
 *
 * The name is the card's one tab stop, stretched over the whole card. A click
 * looks before it leaps: it opens the peek, where the board can be explored.
 * Enter or a double click uses it straight away; Space peeks, as Quick Look
 * does. Pointer users also get Preview and Use over the picture on hover;
 * keyboard users have the same two through Space and Enter, so those buttons
 * stay out of the tab order rather than tripling it.
 */
export const TemplateCard: React.FC<Props> = ({ template, peeking, scope, chips = 3, onPeek, onUse }) => {
  const blurbId = `tblurb-${scope}-${template.id}`;
  const shown = template.teaches.slice(0, chips);
  const interactive = isInteractive(template);
  return (
    <div className="gcard" data-cell data-template={template.id} data-peeking={peeking || undefined}>
      <span className="gcard__art">
        <LiveCover template={template} />
        {interactive && (
          <span className="gcard__badge">
            Interactive <kbd>⇧P</kbd>
          </span>
        )}
        <span className="gcard__actions">
          <button type="button" className="gcard__act" tabIndex={-1} onClick={() => onPeek(template)} aria-label={`Preview ${template.name}`}>
            <Eye size={14} aria-hidden="true" />
            Preview
          </button>
          <button type="button" className="gcard__act gcard__act--use" tabIndex={-1} onClick={() => onUse(template)} aria-label={`Use ${template.name}`}>
            Use
          </button>
        </span>
      </span>
      <span className="gcard__body">
        <button
          type="button"
          className="gcard__hit"
          data-roving={`${scope}:${template.id}`}
          aria-describedby={blurbId}
          aria-keyshortcuts="Enter Space"
          aria-pressed={peeking}
          onClick={(e) => {
            // A keyboard click is handled on keydown, where Enter and Space differ.
            if (e.detail === 0) return;
            onPeek(template);
          }}
          onDoubleClick={() => onUse(template)}
          onKeyDown={(e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            if (e.key === 'Enter') { e.preventDefault(); onUse(template); }
            else if (e.key === ' ') { e.preventDefault(); onPeek(template); }
          }}
        >
          {template.name}
        </button>
        <span className="gcard__blurb" id={blurbId}>{template.blurb}</span>
        {shown.length > 0 && (
          <span className="gcard__chips" aria-label="Shows off">
            {shown.map((chip) => <span key={chip} className="gchip">{chip}</span>)}
          </span>
        )}
      </span>
    </div>
  );
};
