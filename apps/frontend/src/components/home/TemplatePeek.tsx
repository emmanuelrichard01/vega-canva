import React, { useEffect, useMemo, useRef } from 'react';
import {
  BarChart3, ChevronLeft, ChevronRight, Code2, ExternalLink, Frame, Image, LayoutGrid, Link2, MessageSquare, Mic,
  PenLine, Spline, Square, StickyNote, Table2, Type, X,
} from 'lucide-react';
import { WorkspaceCover } from '../WorkspaceCover';
import { CATEGORIES, type Template } from '../../engine/templates/templates';
import type { BoardPreview } from '../../engine/model/boardPreview';
import { templateContents } from './templateContents';

const KIND_ICON: Record<string, React.ReactNode> = {
  sticky: <StickyNote size={14} />,
  shape: <Square size={14} />,
  text: <Type size={14} />,
  connector: <Spline size={14} />,
  frame: <Frame size={14} />,
  image: <Image size={14} />,
  path: <PenLine size={14} />,
  chart: <BarChart3 size={14} />,
  table: <Table2 size={14} />,
  grid: <LayoutGrid size={14} />,
  code: <Code2 size={14} />,
  link: <Link2 size={14} />,
  audio: <Mic size={14} />,
  comment: <MessageSquare size={14} />,
};

interface Props {
  template: Template;
  preview: BoardPreview | null;
  /** Position in the list being browsed, for "3 of 45" and the arrows. */
  index: number;
  count: number;
  onStep: (direction: -1 | 1) => void;
  onClose: () => void;
  onUse: (template: Template) => void;
  onUseInNewTab: (template: Template) => void;
}

/**
 * A closer look at a template, beside the gallery rather than over it.
 *
 * Not a dialog: the gallery stays scrollable and keyboard focus stays on the
 * cards, so arrowing through them moves the peek with you. Enter uses the
 * template under focus, Escape closes the peek.
 */
export const TemplatePeek: React.FC<Props> = ({
  template, preview, index, count, onStep, onClose, onUse, onUseInNewTab,
}) => {
  const contents = useMemo(() => templateContents(template), [template]);
  const category = CATEGORIES.find((c) => c.id === template.category)?.label;

  // Arrows step through the list while focus is inside the sheet itself.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onStep(1); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  // A new template scrolls the sheet back to its top.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [template.id]);

  return (
    <aside className="tpeek" aria-labelledby="tpeek-title" onKeyDown={onKeyDown}>
      <header className="tpeek__bar">
        <div className="tpeek__nav" role="group" aria-label="Browse templates">
          <button type="button" className="tpeek__icon" onClick={() => onStep(-1)} disabled={count < 2} aria-label="Previous template">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="tpeek__pos" aria-live="polite">{index + 1} of {count}</span>
          <button type="button" className="tpeek__icon" onClick={() => onStep(1)} disabled={count < 2} aria-label="Next template">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        <button type="button" className="tpeek__icon" onClick={onClose} aria-label="Close preview" data-tooltip="Close · Esc">
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="tpeek__body" ref={bodyRef}>
        <div className="tpeek__art" key={template.id}>
          <WorkspaceCover workspaceId={template.id} name={template.name} preview={preview} />
        </div>

        <div className="tpeek__titles">
          <h2 className="tpeek__title" id="tpeek-title">{template.name}</h2>
          {category && <p className="tpeek__category">{category}</p>}
        </div>

        <p className="tpeek__blurb">{template.blurb}</p>

        <section className="tpeek__section" aria-labelledby="tpeek-contents">
          <h3 className="tpeek__subhead" id="tpeek-contents">
            What’s on it <span className="tpeek__total">{contents.total.toLocaleString()} objects</span>
          </h3>
          <ul className="tpeek__kinds">
            {contents.kinds.map((kind) => (
              <li key={kind.type} className="tpeek__kind">
                <span className="tpeek__kind-icon" aria-hidden="true">{KIND_ICON[kind.type] ?? <Square size={14} />}</span>
                <span className="tpeek__kind-count">{kind.count.toLocaleString()}</span>
                <span className="tpeek__kind-label">{kind.label}</span>
              </li>
            ))}
          </ul>
        </section>

        {template.teaches.length > 0 && (
          <section className="tpeek__section" aria-labelledby="tpeek-teaches">
            <h3 className="tpeek__subhead" id="tpeek-teaches">Good for trying</h3>
            <p className="tpeek__teaches">{template.teaches.join(' · ')}</p>
          </section>
        )}
      </div>

      <footer className="tpeek__actions">
        <button type="button" className="tpeek__use" onClick={() => onUse(template)}>
          Use template
          <kbd aria-hidden="true">↵</kbd>
        </button>
        <button type="button" className="tpeek__alt" onClick={() => onUseInNewTab(template)}>
          <ExternalLink size={14} aria-hidden="true" />
          Open in new tab
        </button>
      </footer>
    </aside>
  );
};
