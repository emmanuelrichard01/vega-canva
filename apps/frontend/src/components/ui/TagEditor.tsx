import React, { useState } from 'react';
import { X } from 'lucide-react';
import { addTag, MAX_TAGS_PER_NODE, normalizeTag, removeTag } from '../../engine/model/tags';

/**
 * Add and remove a note's tags.
 *
 * Enter or comma commits; Backspace in an empty field removes the last chip,
 * which is the behaviour of every tag field people have used and the one they
 * try first. Normalisation happens in `engine/model/tags`, so what you see on
 * the chip is exactly what the filter will match.
 */
export const TagEditor: React.FC<{
  tags: string[];
  onChange: (tags: string[]) => void;
}> = ({ tags, onChange }) => {
  const [draft, setDraft] = useState('');
  const full = tags.length >= MAX_TAGS_PER_NODE;

  const commit = () => {
    const next = addTag(tags, draft);
    if (next !== tags) onChange(next);
    setDraft('');
  };

  return (
    <div className="tag-editor">
      <span className="tag-editor-label">Tags</span>

      <div className="tag-editor-chips">
        {tags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            <button
              type="button"
              onClick={() => onChange(removeTag(tags, tag))}
              aria-label={`Remove tag ${tag}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}

        {!full && (
          <input
            className="tag-editor-input"
            value={draft}
            placeholder={tags.length === 0 ? 'Add a tag…' : 'Add…'}
            aria-label="Add a tag"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              // Canvas shortcuts must not fire while typing a tag.
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
                e.preventDefault();
                onChange(tags.slice(0, -1));
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft('');
              }
            }}
          />
        )}
      </div>

      {/* Only shown once it matters — a limit announced up front reads as a
          restriction, and announced on contact reads as an explanation. */}
      {full && <span className="tag-editor-note">{MAX_TAGS_PER_NODE} tags is the limit</span>}
      {!full && draft.trim() !== '' && normalizeTag(draft) === '' && (
        <span className="tag-editor-note">Letters and numbers only</span>
      )}
    </div>
  );
};
