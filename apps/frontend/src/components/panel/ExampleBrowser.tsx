import React from 'react';
import { LayoutGrid, Plus, Search, X } from 'lucide-react';
import { exampleGroups, type ChartExample } from '../../engine/chart/chartExamples';
import { presetThumbSvg } from '../../engine/chart/presetThumb';
import { ThemeService } from '../../engine/ThemeService';
import { PanelPopover } from './PanelPopover';
import type { ChartKind, ChartSpec } from '../../engine/chart/chartTypes';

/**
 * Start from an example.
 *
 * ## Why a popover, and why that is not the disclosure again
 *
 * This began as a `<details>`, which was wrong — a closed disclosure in a list
 * of rows promises nothing, so the people who most need a chooser never open
 * it. It then became a strip pinned into the panel, which was honest but
 * cramped: the properties column is about 260px, so a strip of cards showed
 * two at a time and there was nowhere to put a search field.
 *
 * A labelled button with a count on it fixes the first problem, and the
 * surface it opens fixes the second. **The trigger says how many examples
 * there are**, which is the whole difference between this and a disclosure:
 * "Examples · 24" promises something specific, "Start from an example" is a
 * label on a lid.
 *
 * At 440px the same content is a three-up grid with search and group
 * headings — the constraint was doing the design harm, and no arrangement
 * inside 260px was going to fix that.
 *
 * ## The preview is the chart
 *
 * Every card is drawn by `chartToSvg`, the same painter as the export, so a
 * card cannot promise a shape the example does not produce. Fifty hand-drawn
 * icons would be fifty more pictures to keep in step with fifty specs, and
 * the first to drift would be a card advertising a chart nobody gets.
 */

interface Props {
  kind: ChartKind;
  onPick: (spec: ChartSpec) => void;
  /**
   * Add this example's curves to the chart rather than replacing it.
   *
   * Only where it means something: a formula can join a plot that already has
   * one, and a table of quarterly revenue cannot join anything.
   */
  onAddCurves?: (curves: Array<{ source: string; color?: string }>) => void;
}

const THUMB_W = 124;
const THUMB_H = 70;

export const ExampleButton: React.FC<Props> = ({ kind, onPick, onAddCurves }) => {
  const groups = React.useMemo(() => exampleGroups(kind), [kind]);
  const total = groups.reduce((n, g) => n + g.examples.length, 0);
  if (total === 0) return null;

  return (
    <PanelPopover
      title="Start from an example"
      width={440}
      icon={<LayoutGrid size={12} aria-hidden />}
      label={
        <>
          Examples
          {/* The count is the promise. A trigger that only says "Examples"
              is a lid with a word on it. */}
          <span className="pnpop__count">{total}</span>
        </>
      }
    >
      {(close) => (
        <ExampleBrowser
          groups={groups}
          onPick={(spec) => {
            onPick(spec);
            close();
          }}
          onAddCurves={
            onAddCurves
              ? (curves) => {
                  onAddCurves(curves);
                  close();
                }
              : undefined
          }
        />
      )}
    </PanelPopover>
  );
};

const ExampleBrowser: React.FC<{
  groups: ReturnType<typeof exampleGroups>;
  onPick: (spec: ChartSpec) => void;
  onAddCurves?: (curves: Array<{ source: string; color?: string }>) => void;
}> = ({ groups, onPick, onAddCurves }) => {
  const [query, setQuery] = React.useState('');
  // Once per render of the browser rather than once per card: the answer is
  // the same for all fifty and it is a class-list read each time.
  const dark = ThemeService.isDarkMode();
  const trimmed = query.trim().toLowerCase();

  const shown = React.useMemo(() => {
    if (!trimmed) return groups;
    return groups
      .map((g) => ({
        ...g,
        examples: g.examples.filter(
          (e) =>
            e.name.toLowerCase().includes(trimmed) ||
            e.note.toLowerCase().includes(trimmed) ||
            g.label.toLowerCase().includes(trimmed) ||
            // The formulae too: somebody searching `tan` means the curve, and
            // its name is "Tangent" while its expression is what they typed.
            (e.spec.functions ?? []).some((f) => f.source.toLowerCase().includes(trimmed))
        ),
      }))
      .filter((g) => g.examples.length > 0);
  }, [groups, trimmed]);

  const found = shown.reduce((n, g) => n + g.examples.length, 0);

  return (
    <div className="exb">
      <div className="exb__search">
        <Search size={12} aria-hidden />
        <input
          className="exb__input"
          value={query}
          autoFocus
          placeholder="Search examples"
          aria-label="Search examples"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="exb__clear"
            aria-label="Clear the search"
            onClick={() => setQuery('')}
          >
            <X size={11} />
          </button>
        )}
      </div>

      {found === 0 ? (
        // Quotes what was typed, so the reader can see the typo rather than
        // only that something failed.
        <p className="exb__empty">Nothing matches “{query}”.</p>
      ) : (
        <div className="exb__scroll">
          {shown.map((group) => (
            <section className="exb__group" key={group.kind}>
              <h5 className="exb__groupLabel">
                {group.label}
                <span className="exb__count">{group.examples.length}</span>
              </h5>
              <div className="exb__grid">
                {group.examples.map((example) => (
                  <ExampleCard
                    key={example.id}
                    example={example}
                    dark={dark}
                    onPick={() => onPick(example.spec)}
                    onAdd={
                      onAddCurves && example.spec.functions?.length
                        ? () => onAddCurves(example.spec.functions!)
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

const ExampleCard = React.memo<{
  example: ChartExample;
  dark: boolean;
  onPick: () => void;
  onAdd?: () => void;
}>(({ example, dark, onPick, onAdd }) => {
  const markup = React.useMemo(
    () => presetThumbSvg(example.spec, THUMB_W, THUMB_H, dark),
    [example.spec, dark]
  );

  return (
    <div className="exb__card">
      <button type="button" className="exb__pick" onClick={onPick}>
        <span className="exb__thumb">
          <svg
            viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
            focusable="false"
            // Our own generated markup from our own escaper, never user input:
            // examples are static and `chartToSvg` escapes every string it
            // emits.
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        </span>
        <span className="exb__name">{example.name}</span>
        {/* The note fits here where it did not in the strip: at 124px a card
            had room for a name and nothing else, so the one line explaining
            what the example demonstrates lived only in a tooltip. */}
        <span className="exb__note">{example.note}</span>
      </button>

      {/* Adding a curve to a plot that already has one is a different act from
          replacing the chart, and it is the one people want more often. */}
      {onAdd && (
        <button
          type="button"
          className="exb__add"
          aria-label={`Add ${example.name} to this plot`}
          title="Add to this plot instead of replacing it"
          onClick={onAdd}
        >
          <Plus size={11} />
        </button>
      )}
    </div>
  );
});

ExampleCard.displayName = 'ExampleCard';
