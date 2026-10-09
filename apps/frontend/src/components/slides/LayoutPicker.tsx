import React, { useEffect, useMemo } from 'react';
import { Check } from 'lucide-react';
import type { AnyNode, FrameNode } from '../../engine/model/schema';
import { layoutNodes, SLIDE_LAYOUTS, slideFrame, type LayoutId } from '../../engine/slides/layouts';
import { DECK_THEMES, type DeckTheme } from '../../engine/slides/themes';
import { ensureFamilyStylesheet } from '../../engine/text/fontCatalogue';
import { SlidePlan } from './SlidePlan';

/**
 * Pick a layout for a new slide, in a theme.
 *
 * Each card is the layout itself, laid out by the same function that will
 * build the slide and drawn as its plan, so what you pick is exactly what
 * arrives. The theme row recolours every card at once.
 */

const BOX = { x: 0, y: 0, width: 1920, height: 1080 };

/** A layout as a tiny board: a frame and what it holds, keyed by id. */
export function layoutBoard(id: LayoutId, theme: DeckTheme): { frame: FrameNode; objects: Record<string, AnyNode> } {
  const frame = { ...slideFrame(BOX, theme, 'Layout'), zIndex: 0, hidden: false } as unknown as FrameNode;
  const objects: Record<string, AnyNode> = { [frame.id]: frame as AnyNode };
  layoutNodes(id, BOX, theme).forEach((n, i) => {
    // Shown at full strength: in a picker the prompt *is* the content.
    objects[String(n.id)] = { ...n, frameId: frame.id, zIndex: i + 1, hidden: false, opacity: 1 } as unknown as AnyNode;
  });
  return { frame, objects };
}

export const ThemeRow: React.FC<{ value: DeckTheme; onChange: (theme: DeckTheme) => void; label?: string }> = ({
  value,
  onChange,
  label = 'Theme',
}) => {
  // The chips speak in each theme's own face; fetch the faces that are not bundled.
  useEffect(() => {
    DECK_THEMES.forEach((t) => void ensureFamilyStylesheet(t.display.family).catch(() => undefined));
  }, []);
  return (
    <div className="slide-themes" role="radiogroup" aria-label={label}>
      {DECK_THEMES.map((t) => {
        const on = t.id === value.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            className="slide-theme"
            onClick={() => onChange(t)}
            title={t.blurb}
          >
            <span className="slide-theme__chip" style={{ background: t.page, color: t.ink, borderColor: t.line }} aria-hidden="true">
              <span className="slide-theme__aa" style={{ fontFamily: t.display.family, fontWeight: t.display.weight }}>
                Aa
              </span>
              <span className="slide-theme__dot" style={{ background: t.accent }} />
            </span>
            <span className="slide-theme__name">
              {t.label}
              {on && <Check size={12} aria-hidden="true" />}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export const LayoutPicker: React.FC<{
  theme: DeckTheme;
  onTheme: (theme: DeckTheme) => void;
  onPick: (layout: LayoutId) => void;
}> = ({ theme, onTheme, onPick }) => {
  const boards = useMemo(() => SLIDE_LAYOUTS.map((l) => ({ ...l, ...layoutBoard(l.id, theme) })), [theme]);
  return (
    <div className="slide-layouts">
      <ThemeRow value={theme} onChange={onTheme} />
      <ul className="slide-layouts__grid" aria-label="Layouts">
        {boards.map((b) => (
          <li key={b.id}>
            <button type="button" className="slide-layout" onClick={() => onPick(b.id)} aria-label={`${b.label}. ${b.blurb}`} title={b.blurb}>
              <span className="slide-layout__art">
                <SlidePlan frame={b.frame} objects={b.objects} showPlaceholders />
              </span>
              <span className="slide-layout__name">{b.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
