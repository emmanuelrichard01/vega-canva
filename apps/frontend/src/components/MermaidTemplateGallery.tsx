import React from 'react';
import { Check } from 'lucide-react';
import type { MermaidTemplate } from '../engine/diagram/mermaidTemplates';
import { thumbFor, type TemplateThumb } from '../engine/diagram/templateThumb';

const GROUPS: ReadonlyArray<{ kind: MermaidTemplate['kind']; label: string }> = [
  { kind: 'flow', label: 'Flowcharts' },
  { kind: 'sequence', label: 'Sequence diagrams' },
  { kind: 'pie', label: 'Pie charts' },
];

/** A template's real layout in miniature: boxes, connections, wedges, no words. */
const Thumb: React.FC<{ thumb: TemplateThumb | null }> = ({ thumb }) => {
  if (!thumb) return <span className="mm-gallery__thumb mm-gallery__thumb--empty" aria-hidden />;
  const pad = Math.max(thumb.width, thumb.height) * 0.06;
  // Strokes scale with the drawing, so they are sized in its units to land at
  // about one screen pixel whatever the diagram's extent.
  const stroke = Math.max(thumb.width, thumb.height) / 110;
  return (
    <svg
      className="mm-gallery__thumb"
      viewBox={`${-pad} ${-pad} ${thumb.width + pad * 2} ${thumb.height + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {thumb.lines.map((l, i) => (
        <line
          key={`l${i}`}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          className="mm-gallery__line"
          strokeWidth={stroke}
          strokeDasharray={l.dashed ? `${stroke * 3} ${stroke * 2.5}` : undefined}
        />
      ))}
      {thumb.boxes.map((b, i) => (
        <rect
          key={`b${i}`}
          x={b.x}
          y={b.y}
          width={b.width}
          height={b.height}
          rx={b.round ? Math.min(b.height / 3, 14) : stroke * 4}
          className={b.round ? 'mm-gallery__box' : 'mm-gallery__group'}
          strokeWidth={stroke}
        />
      ))}
      {thumb.wedges.map((d, i) => (
        <path key={`w${i}`} d={d} className={`mm-gallery__wedge mm-gallery__wedge--${i % 4}`} strokeWidth={stroke} />
      ))}
    </svg>
  );
};

/**
 * Starting points, as pictures.
 *
 * A name says what a template is about; the shape says what it will draw,
 * which is the thing being chosen. Grouped by engine, since "does this draw a
 * timeline or a graph" is the first question and the names alone do not
 * answer it. Picking replaces the code, so the current one is marked.
 */
export const MermaidTemplateGallery: React.FC<{
  templates: ReadonlyArray<MermaidTemplate>;
  activeId: string | null;
  onPick: (template: MermaidTemplate) => void;
  onClose: () => void;
}> = ({ templates, activeId, onPick, onClose }) => {
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"], .mm-gallery__tile')?.focus();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (rootRef.current?.contains(target) || target.closest?.('.mm-gallery-trigger')) return;
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  /** Arrow keys move through the tiles in reading order, as in any grid of choices. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? 3 : e.key === 'ArrowUp' ? -3 : 0;
    if (!step) return;
    const tiles = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('.mm-gallery__tile') ?? []);
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    tiles[Math.max(0, Math.min(tiles.length - 1, at + step))]?.focus();
  };

  return (
    <div ref={rootRef} className="mm-gallery" role="dialog" aria-label="Templates" onKeyDown={onKeyDown}>
      {GROUPS.map((group) => {
        const items = templates.filter((t) => t.kind === group.kind);
        if (items.length === 0) return null;
        return (
          <section key={group.kind} className="mm-gallery__group-block" aria-label={group.label}>
            <h3 className="mm-gallery__heading">{group.label}</h3>
            <div className="mm-gallery__grid">
              {items.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="mm-gallery__tile"
                  aria-pressed={t.id === activeId}
                  onClick={() => onPick(t)}
                >
                  <Thumb thumb={thumbFor(t)} />
                  <span className="mm-gallery__name">
                    {t.name}
                    {t.id === activeId && <Check size={12} aria-hidden />}
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};
