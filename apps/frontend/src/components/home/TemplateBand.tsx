import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Template } from '../../engine/templates/templates';
import { TemplateCard } from './TemplateCard';

interface Props {
  /** A fixed list: membership never depends on layout, so the peek cannot change it. */
  templates: readonly Template[];
  total: number;
  peekId: string | null;
  onPeek: (template: Template) => void;
  onUse: (template: Template) => void;
  onBrowse: () => void;
}

/**
 * Templates as a band you scroll sideways, for a library that is still small.
 *
 * With a handful of boards the page is mostly space, and what fills it best is
 * a reason to make the next one. The band shows larger covers than the seam at
 * the foot of a big library, snaps card by card, fades at whichever edge has
 * more behind it, and has arrow buttons where there is a mouse to use them.
 *
 * Every card is always rendered: what is in the band is the same list however
 * wide the stage is, which is what keeps the peek from changing it (see the
 * column freeze in Home).
 */
export const TemplateBand: React.FC<Props> = ({ templates, total, peekId, onPeek, onUse, onBrowse }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    measure();
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const scrollBy = (direction: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <section className="lband" aria-labelledby="lband-title">
      <header className="lband__head">
        <h2 className="lband__title" id="lband-title">Start from a template</h2>
        <div className="lband__tools">
          <div className="lband__arrows">
            <button type="button" className="lband__arrow" onClick={() => scrollBy(-1)} disabled={edges.start} aria-label="Scroll templates back" tabIndex={-1}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button type="button" className="lband__arrow" onClick={() => scrollBy(1)} disabled={edges.end} aria-label="Scroll templates forward" tabIndex={-1}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <button type="button" className="llink" onClick={onBrowse}>
            Browse all {total}
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="lband__viewport" data-at-start={edges.start || undefined} data-at-end={edges.end || undefined}>
        <div className="lband__track" ref={trackRef} onScroll={measure}>
          {templates.map((t) => (
            <TemplateCard key={`band-${t.id}`} template={t} peeking={peekId === t.id} scope="band" onPeek={onPeek} onUse={onUse} />
          ))}
        </div>
      </div>
    </section>
  );
};
