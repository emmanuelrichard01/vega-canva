import React from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { exampleGroups, type ChartExample } from '../../engine/chart/chartExamples';
import { presetThumbSvg } from '../../engine/chart/presetThumb';
import { ThemeService } from '../../engine/ThemeService';
import type { ChartKind, ChartSpec } from '../../engine/chart/chartTypes';

/**
 * Start from an example.
 *
 * ## Not behind a disclosure
 *
 * It was a `<details>` labelled "Start from an example", which is the worst
 * possible place for it: the people who need it most are the ones who have
 * not yet worked out what the panel contains, and a disclosure is invisible
 * to exactly them. A chooser that has to be discovered is a chooser that
 * mostly is not.
 *
 * So it is always on screen — but as a **strip**, not a gallery. One row of
 * live previews that scrolls sideways costs about eighty pixels wherever the
 * chart is in its life, which is little enough to leave open permanently and
 * enough to see four examples at a glance. That is the trade every component
 * browser makes, and it is why they are strips rather than grids.
 *
 * ## The current kind first, and then everything else
 *
 * Deliberately not filtered to the current kind. Picking an example is *also*
 * how people change kind, and the fastest way to find out that a waterfall
 * exists is to see one while looking at a bar chart. Restricting the strip to
 * matching kinds would turn a chooser into a style picker.
 *
 * ## The preview is the chart
 *
 * Every card is drawn by `chartToSvg` — the same painter as the export — so a
 * card cannot promise a shape the example does not produce. A hand-drawn icon
 * per example would be fifty more pictures to keep in step with fifty specs.
 */

interface Props {
  kind: ChartKind;
  onPick: (spec: ChartSpec) => void;
  /**
   * Add this example's curves to the chart rather than replacing it.
   *
   * Only offered where it means something: a formula can join a plot that
   * already has one, and a table of quarterly revenue cannot join anything.
   */
  onAddCurves?: (curves: Array<{ source: string; color?: string }>) => void;
}

const THUMB_W = 116;
const THUMB_H = 64;

export const ExampleStrip: React.FC<Props> = ({ kind, onPick, onAddCurves }) => {
  const dark = ThemeService.isDarkMode();
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const groups = React.useMemo(() => exampleGroups(kind), [kind]);

  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(false);

  /**
   * Whether the arrows have anywhere to go.
   *
   * An arrow that does nothing is worse than no arrow: it says there is more
   * and there is not. Recomputed on scroll and on the strip resizing, because
   * the panel is resizable and a strip that fits at 320px does not at 240px.
   */
  const measure = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, groups]);

  const nudge = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // A page is most of the visible width, keeping one card in view as an
    // anchor -- scrolling by a whole width loses your place.
    el.scrollBy({ left: direction * (el.clientWidth - THUMB_W * 0.4), behavior: 'smooth' });
  };

  const flat = React.useMemo(
    () => groups.flatMap((group) => group.examples.map((example) => ({ group, example }))),
    [groups]
  );

  if (flat.length === 0) return null;

  return (
    <div className="exs">
      <div className="exs__head">
        <span className="exs__title">Start from an example</span>
        <div className="exs__nav">
          <button
            type="button"
            className="exs__arrow"
            aria-label="Earlier examples"
            disabled={atStart}
            onClick={() => nudge(-1)}
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            className="exs__arrow"
            aria-label="More examples"
            disabled={atEnd}
            onClick={() => nudge(1)}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      <div className="exs__scroller" ref={scrollerRef} onScroll={measure}>
        {flat.map(({ group, example }, i) => {
          // The kind's name is printed once, above the first card of its run,
          // rather than on every card -- four cards all saying "Bar" is four
          // repetitions of the one thing they have in common.
          const startsGroup = i === 0 || flat[i - 1].group.kind !== group.kind;
          return (
            <ExampleCard
              key={example.id}
              example={example}
              dark={dark}
              groupLabel={startsGroup ? group.label : null}
              onPick={() => onPick(example.spec)}
              onAdd={
                onAddCurves && example.spec.functions?.length
                  ? () => onAddCurves(example.spec.functions!)
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
};

const ExampleCard = React.memo<{
  example: ChartExample;
  dark: boolean;
  groupLabel: string | null;
  onPick: () => void;
  onAdd?: () => void;
}>(({ example, dark, groupLabel, onPick, onAdd }) => {
  const markup = React.useMemo(
    () => presetThumbSvg(example.spec, THUMB_W, THUMB_H, dark),
    [example.spec, dark]
  );

  return (
    <div className="exs__cell">
      {/* Reserved whether or not this card starts a run, so the cards stay in
          one row rather than stepping up and down the strip. */}
      <span className="exs__kind">{groupLabel ?? ' '}</span>

      <div className="exs__card">
        <button type="button" className="exs__pick" onClick={onPick} title={example.note}>
          <span className="exs__thumb">
            <svg
              viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
              focusable="false"
              // Our own generated markup from our own escaper, never user
              // input: examples are static and `chartToSvg` escapes every
              // string it emits.
              dangerouslySetInnerHTML={{ __html: markup }}
            />
          </span>
          <span className="exs__name">{example.name}</span>
        </button>

        {/* Adding a curve to a plot that already has one is a different act
            from replacing the chart, and it is the one people want more
            often. It only appears where it is possible. */}
        {onAdd && (
          <button
            type="button"
            className="exs__add"
            aria-label={`Add ${example.name} to this plot`}
            title="Add to this plot instead of replacing it"
            onClick={onAdd}
          >
            <Plus size={11} />
          </button>
        )}
      </div>
    </div>
  );
});

ExampleCard.displayName = 'ExampleCard';
