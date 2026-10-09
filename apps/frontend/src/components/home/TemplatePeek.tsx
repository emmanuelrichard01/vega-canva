import React, { useEffect, useMemo, useRef } from 'react';
import {
  BarChart3, ChevronLeft, ChevronRight, Code2, ExternalLink, Frame, Image, LayoutGrid, Link2, MessageSquare, Mic,
  MousePointerClick, PenLine, Shapes, Spline, Square, StickyNote, Table2, Type, X,
} from 'lucide-react';
import type { Template } from '../../engine/templates/templates';
import { templateContents } from './templateContents';
import { BoardViewer } from './BoardViewer';
import { categoryLabel, INTERACTIVE_HINT, isInteractive } from './templateFacts';

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
  icon: <Shapes size={14} />,
};

interface Props {
  template: Template;
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
 * Not a dialog: the gallery stays scrollable and keyboard focus can stay on
 * the cards, so arrowing through them moves the peek with you. The board
 * itself is live in a window that pans and zooms, so its small print can be
 * read before it is opened. Enter uses the template under focus, Escape
 * closes the peek, and ← → step through the list from inside it.
 */
export const TemplatePeek: React.FC<Props> = ({
  template, index, count, onStep, onClose, onUse, onUseInNewTab,
}) => {
  const contents = useMemo(() => templateContents(template), [template]);
  const category = categoryLabel(template);
  const interactive = isInteractive(template);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
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
          <BoardViewer template={template} slot="peek" interactive label={`${template.name}, the whole board`} />
        </div>

        <div className="tpeek__titles">
          <h2 className="tpeek__title" id="tpeek-title">{template.name}</h2>
          {category && <p className="tpeek__category">{category}</p>}
        </div>

        <p className="tpeek__blurb">{template.blurb}</p>

        {interactive && (
          <p className="tpeek__hint">
            <MousePointerClick size={15} aria-hidden="true" />
            <span>{INTERACTIVE_HINT}</span>
          </p>
        )}

        {template.teaches.length > 0 && (
          <section className="tpeek__section" aria-labelledby="tpeek-teaches">
            <h3 className="tpeek__subhead" id="tpeek-teaches">Shows off</h3>
            <ul className="tpeek__chips">
              {template.teaches.map((chip) => <li key={chip} className="gchip">{chip}</li>)}
            </ul>
          </section>
        )}

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
