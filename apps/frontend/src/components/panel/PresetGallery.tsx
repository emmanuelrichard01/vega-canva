import React from 'react';
import { Search, X } from 'lucide-react';
import { presetGroups, specFromPreset, type PlotPreset } from '../../engine/chart/plotPresets';
import { presetThumbSvg } from '../../engine/chart/presetThumb';
import { ThemeService } from '../../engine/ThemeService';
import type { ChartKind, ChartSpec } from '../../engine/chart/chartTypes';

/**
 * The example gallery.
 *
 * ## The preview is the chart
 *
 * Every card draws its preset through `layoutChart` and `chartToSvg` — the
 * same pair the SVG export uses. A hand-drawn icon per preset would be
 * twenty-nine more pictures to keep in step with twenty-nine specs, and the
 * first one to drift would be a card promising a curve the preset does not
 * produce. Drawing the real thing makes that impossible rather than unlikely.
 *
 * It also means the gallery gets better for free: the day the plotter learns
 * to draw something new, every card showing it updates.
 *
 * ## Why search, at twenty-nine
 *
 * Grouping alone was enough at fourteen. Past about twenty a grouped list is
 * still a list you scroll, and the thing people arrive knowing is a *word* —
 * "spiral", "normal", "rose" — not which family it was filed under. The field
 * searches names and notes together, because the note is where "the bell" and
 * "saturating growth" live and those are what somebody half-remembers.
 *
 * Filtering collapses the groups to whatever matched rather than hiding
 * headings entirely: a result you cannot place is a result you have to
 * re-derive, and the family is most of what tells you whether it is the thing
 * you meant.
 */

interface Props {
  /** Ranks the current kind's own examples first. */
  kind: ChartKind;
  onPick: (spec: ChartSpec) => void;
  onAddCurve?: (curves: Array<{ source: string; color?: string }>) => void;
}

const THUMB_W = 132;
const THUMB_H = 74;
const CATEGORIES = ['All', 'Calculus', 'Physics', 'Machine Learning', 'Geometry'] as const;

export const PresetGallery: React.FC<Props> = ({ kind, onPick, onAddCurve }) => {
  const [query, setQuery] = React.useState('');
  const [selectedCategory, setSelectedCategory] = React.useState<string>('All');
  // Read once per render of the gallery rather than once per card: the answer
  // is the same for all twenty-nine and it is a class-list read each time.
  const dark = ThemeService.isDarkMode();

  const groups = React.useMemo(() => {
    const all = presetGroups(kind);
    const q = query.trim().toLowerCase();

    return all
      .map((g) => ({
        ...g,
        presets: g.presets.filter((p) => {
          if (selectedCategory !== 'All' && p.category !== selectedCategory) {
            return false;
          }
          if (!q) return true;
          return (
            p.name.toLowerCase().includes(q) ||
            p.note.toLowerCase().includes(q) ||
            (p.spec.functions ?? []).some((f) => f.source.toLowerCase().includes(q))
          );
        }),
      }))
      .filter((g) => g.presets.length > 0);
  }, [kind, query, selectedCategory]);

  const total = groups.reduce((n, g) => n + g.presets.length, 0);

  return (
    <div className="preset">
      <div className="preset__search">
        <Search size={12} aria-hidden />
        <input
          className="preset__input"
          value={query}
          placeholder="Search examples"
          aria-label="Search examples"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="preset__clear"
            aria-label="Clear the search"
            onClick={() => setQuery('')}
          >
            <X size={11} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 2 }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className="chartp-token-btn"
            style={{
              background: selectedCategory === cat ? 'var(--surface-active)' : undefined,
              borderColor: selectedCategory === cat ? 'var(--accent)' : undefined,
              color: selectedCategory === cat ? 'var(--accent)' : undefined,
              fontWeight: selectedCategory === cat ? 600 : 400,
            }}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {total === 0 ? (
        // Says what was searched for, so the reader can see the typo rather
        // than only that something failed.
        <p className="preset__empty">Nothing matches “{query}”.</p>
      ) : (
        <div className="preset__scroll">
          {groups.map((group) => (
            <section className="preset__group" key={group.kind}>
              <h5 className="preset__groupLabel">
                {group.label}
                <span className="preset__count">{group.presets.length}</span>
              </h5>
              <div className="preset__grid">
                {group.presets.map((preset) => (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    dark={dark}
                    onPick={() => onPick(specFromPreset(preset))}
                    onAdd={
                      onAddCurve && preset.spec.functions?.length
                        ? () => onAddCurve(preset.spec.functions!)
                        : undefined
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * One card.
 *
 * Memoised on the preset and the theme, which are the only two things its
 * drawing depends on — so typing in the search field re-filters the list
 * without re-laying-out a single curve.
 */
const PresetCard = React.memo<{
  preset: PlotPreset;
  dark: boolean;
  onPick: () => void;
  onAdd?: () => void;
}>(({ preset, dark, onPick, onAdd }) => {
  const markup = React.useMemo(
    () => presetThumbSvg(specFromPreset(preset), THUMB_W, THUMB_H, dark),
    [preset, dark]
  );

  return (
    <div className="preset__card" style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={onPick}
        title={`${preset.name}: ${preset.note} (Click to load example)`}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          color: 'inherit',
        }}
      >
        <span className="preset__thumb">
          <svg
            viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
            focusable="false"
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        </span>
        <span className="preset__name">{preset.name}</span>
        <span className="preset__note">{preset.note}</span>
      </button>
      {onAdd && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          className="chartp-token-btn"
          style={{
            position: 'absolute',
            top: 7,
            right: 7,
            background: 'var(--surface-primary)',
            fontSize: 9,
            fontWeight: 600,
            padding: '1px 5px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
          }}
          title="Add curve to current chart"
        >
          + Add
        </button>
      )}
    </div>
  );
});

PresetCard.displayName = 'PresetCard';
