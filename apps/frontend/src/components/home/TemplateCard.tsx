import React from 'react';
import { WorkspaceCover } from '../WorkspaceCover';
import type { BoardPreview } from '../../engine/model/boardPreview';
import type { Template } from '../../engine/templates/templates';

interface Props {
  template: Template;
  preview: BoardPreview | null;
  /** The template the peek is showing, so its card reads as the current one. */
  peeking: boolean;
  /** Where the roving id comes from; templates appear in more than one grid. */
  scope: string;
  onPeek: (template: Template) => void;
  onUse: (template: Template) => void;
}

/**
 * A template in the gallery.
 *
 * A click looks before it leaps: it opens the template in the peek beside the
 * gallery, where "Use template" makes the board. A double click, or Enter,
 * uses it straight away; Space peeks, the way Quick Look does.
 */
export const TemplateCard: React.FC<Props> = ({ template, preview, peeking, scope, onPeek, onUse }) => (
  <button
    type="button"
    className="tcard"
    data-cell
    data-roving={`${scope}:${template.id}`}
    data-template={template.id}
    data-peeking={peeking || undefined}
    aria-describedby={`tblurb-${scope}-${template.id}`}
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
    <span className="tcard__art">
      <WorkspaceCover workspaceId={template.id} name={template.name} preview={preview} />
    </span>
    <span className="tcard__body">
      <span className="tcard__name">{template.name}</span>
      <span className="tcard__blurb" id={`tblurb-${scope}-${template.id}`}>{template.blurb}</span>
      {template.objectCount && (
        <span className="tcard__meta">
          <span className="tcard__count">{template.objectCount.toLocaleString()} objects</span>
        </span>
      )}
    </span>
  </button>
);
