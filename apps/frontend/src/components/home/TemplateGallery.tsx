import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, Eye, Search, Sparkles } from 'lucide-react';
import { CATEGORIES, type Template, type TemplateCategory } from '../../engine/templates/templates';
import { BoardViewer } from './BoardViewer';
import { TemplateCard } from './TemplateCard';
import { LiveCover } from './LiveCover';
import { prefetchBoard } from './templatePicture';
import { categoryLabel, INTERACTIVE_HINT, isInteractive } from './templateFacts';
import './gallery.css';

interface ShowcaseProps {
  boards: readonly Template[];
  onPeek: (template: Template) => void;
  onUse: (template: Template) => void;
}

/**
 * The head of the gallery: a few boards shown large and live.
 *
 * One board at a time on a big stage, with the others as a list beside it, the
 * way Pitch and Figma lead their template pickers. It never advances on its
 * own: a carousel that moves while you read is a carousel you have to chase.
 * The list is a tab set, so arrows move through it and the stage follows.
 */
const Showcase: React.FC<ShowcaseProps> = ({ boards, onPeek, onUse }) => {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = boards[Math.min(active, boards.length - 1)];

  // The next board is drawn while this one is being looked at.
  useEffect(() => {
    const next = boards[(active + 1) % boards.length];
    if (next && next !== current) prefetchBoard(next, 'hero');
  }, [active, boards, current]);

  if (!current) return null;

  const pick = (i: number) => {
    const n = (i + boards.length) % boards.length;
    setActive(n);
    tabs.current[n]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const moves: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (e.key in moves) { e.preventDefault(); pick(active + moves[e.key]); }
    else if (e.key === 'Home') { e.preventDefault(); pick(0); }
    else if (e.key === 'End') { e.preventDefault(); pick(boards.length - 1); }
  };

  return (
    <section className="gshow" aria-label="Featured templates">
      <div
        className="gshow__stage"
        id="gshow-panel"
        role="tabpanel"
        aria-labelledby={`gshow-tab-${current.id}`}
        data-template={current.id}
        onClick={() => onPeek(current)}
      >
        <BoardViewer key={current.id} template={current} slot="hero" label={`${current.name}, the whole board`} />
      </div>

      <div className="gshow__side">
        <div className="gshow__info" key={current.id}>
          <h2 className="gshow__name">{current.name}</h2>
          <p className="gshow__blurb">{current.blurb}</p>
          {isInteractive(current) && <p className="gshow__hint">{INTERACTIVE_HINT}</p>}
          <ul className="gshow__chips" aria-label="Shows off">
            {current.teaches.slice(0, 4).map((chip) => <li key={chip} className="gchip">{chip}</li>)}
          </ul>
          <div className="gshow__go">
            <button type="button" className="gbtn gbtn--ink" onClick={() => onUse(current)}>
              Use template
              <ArrowRight size={15} aria-hidden="true" />
            </button>
            <button type="button" className="gbtn" onClick={() => onPeek(current)}>
              <Eye size={15} aria-hidden="true" />
              Preview
            </button>
          </div>
        </div>

        {boards.length > 1 && (
          <div className="gshow__list" role="tablist" aria-label="Featured templates" aria-orientation="vertical" onKeyDown={onKeyDown}>
            {boards.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => { tabs.current[i] = el; }}
                type="button"
                role="tab"
                id={`gshow-tab-${t.id}`}
                className="gshow__tab"
                aria-selected={i === active}
                aria-controls="gshow-panel"
                tabIndex={i === active ? 0 : -1}
                onClick={() => setActive(i)}
                onPointerEnter={() => prefetchBoard(t, 'hero')}
              >
                <span className="gshow__thumb"><LiveCover template={t} /></span>
                <span className="gshow__tab-text">
                  <span className="gshow__tab-name">{t.name}</span>
                  <span className="gshow__tab-cat">{categoryLabel(t)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

interface Props {
  /** Every template in the catalogue. */
  total: number;
  /** What the category and query leave, best first when there is a query. */
  matched: readonly Template[];
  category: TemplateCategory | null;
  query: string;
  /** The boards the showcase leads with, when no filter is set. */
  showcase: readonly Template[];
  /** `matched` without the showcase, when it is shown. */
  rest: readonly Template[];
  /** How many cards one row holds, so each category shows exactly one row. */
  shelfColumns: number;
  shelfRef: (el: HTMLDivElement | null) => void;
  peekId: string | null;
  onPeek: (template: Template) => void;
  onUse: (template: Template) => void;
  onCategory: (category: TemplateCategory | null) => void;
  onClearQuery: () => void;
}

/**
 * The templates view: the showcase, then a row per category, or one ranked
 * grid once a category or a search narrows it.
 */
export const TemplateGallery: React.FC<Props> = ({
  total, matched, category, query, showcase, rest, shelfColumns, shelfRef, peekId, onPeek, onUse, onCategory, onClearQuery,
}) => {
  const card = (template: Template, scope: string) => (
    <TemplateCard
      key={`${scope}-${template.id}`}
      template={template}
      peeking={peekId === template.id}
      scope={scope}
      onPeek={onPeek}
      onUse={onUse}
    />
  );

  if (total === 0) {
    return (
      <div className="gempty">
        <Sparkles size={22} aria-hidden="true" />
        <h2>No templates in this build</h2>
        <p>The catalogue is empty. Start from a blank board; templates appear here as soon as they are added.</p>
      </div>
    );
  }

  const trimmed = query.trim();
  if (matched.length === 0) {
    const where = category ? CATEGORIES.find((c) => c.id === category)?.label : null;
    return (
      <div className="gempty" role="status">
        <Search size={22} aria-hidden="true" />
        <h2>{trimmed ? <>No templates match “{trimmed}”{where ? ` in ${where}` : ''}</> : `Nothing in ${where ?? 'this category'} yet`}</h2>
        <p>Try what a board shows off, such as “connectors” or “charts”, or what it is about, such as “kubernetes” or “retro”.</p>
        <div className="gempty__ways">
          {category && trimmed && (
            <button type="button" className="gbtn gbtn--ink" onClick={() => onCategory(null)}>
              Search every category
            </button>
          )}
          {trimmed && <button type="button" className="gbtn" onClick={onClearQuery}>Clear search</button>}
          {!trimmed && category && <button type="button" className="gbtn" onClick={() => onCategory(null)}>See all templates</button>}
        </div>
      </div>
    );
  }

  if (trimmed || category) {
    return (
      <>
        {trimmed && (
          <p className="gresults" role="status">
            {matched.length === 1 ? '1 template' : `${matched.length} templates`} for “{trimmed}”, best match first
          </p>
        )}
        <div className="tgrid ggrid">{matched.map((t) => card(t, trimmed ? 'found' : 'all'))}</div>
      </>
    );
  }

  return (
    <>
      {showcase.length > 0 && <Showcase boards={showcase} onPeek={onPeek} onUse={onUse} />}
      {CATEGORIES.filter((c) => rest.some((t) => t.category === c.id)).map((c, index) => {
        const inCategory = rest.filter((t) => t.category === c.id);
        const shown = inCategory.slice(0, shelfColumns);
        return (
          <section key={c.id} className="tsection" aria-labelledby={`tsection-${c.id}`}>
            <header className="tsection__head">
              <div>
                <h2 className="tsection__title" id={`tsection-${c.id}`}>{c.label}</h2>
                <p className="tsection__blurb">{c.blurb}</p>
              </div>
              {inCategory.length > shown.length && (
                <button type="button" className="lbtn" onClick={() => onCategory(c.id)} aria-label={`Show all ${inCategory.length} ${c.label} templates`}>
                  All {inCategory.length}
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              )}
            </header>
            <div className="tgrid ggrid" ref={index === 0 ? shelfRef : undefined}>{shown.map((t) => card(t, c.id))}</div>
          </section>
        );
      })}
    </>
  );
};
