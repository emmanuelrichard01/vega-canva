import React from 'react';
import { CornerDownLeft, LayoutGrid, Plus, Search, X } from 'lucide-react';
import { exampleGroups, type ChartExample } from '../../engine/chart/chartExamples';
import { thumbFor, thumbReady } from '../../engine/chart/thumbCache';
import { CHART_LABELS, FAMILY_LABELS, chartPickerGroups } from '../../engine/chart/chartKinds';
import { CHART_FAMILY_OF, type ChartFamily, type ChartKind, type ChartSpec } from '../../engine/chart/chartTypes';
import { ThemeService } from '../../engine/ThemeService';
import { useNearViewport } from '../../hooks/useNearViewport';
import { ChartKindIcon } from '../workspace/chartIcons';
import { PanelPopover } from './PanelPopover';

/**
 * Start from an example.
 *
 * ## Shape: a rail and a grid
 *
 * The template browsers this is measured against — Miro's, FigJam's,
 * Lucidchart's — all settle on the same arrangement, because it is the one
 * that scales: categories down the left, pictures on the right, search
 * across the top. Sixty-odd examples in one scrolling column made the
 * current kind's own examples the only ones anybody saw, and the rest were a
 * scroll away from being discovered.
 *
 * The rail opens on **For this chart** — the current kind and its family —
 * because that is what most visits want, and every other family is one press
 * away. Search always covers everything: somebody typing "tan" means the
 * curve wherever it lives.
 *
 * ## What a card promises
 *
 * Every card is a real chart, laid out by `layoutChart` and painted by
 * `chartToSvg`, so a card cannot advertise a shape the example does not
 * produce. A card of a *different* kind carries that kind's glyph, and the
 * footer says "Switches to Waterfall" — picking an example is also how people
 * change kind, and it should never do so by surprise.
 *
 * ## What it costs
 *
 * Sixty-three thumbnails is ~374ms of main thread. Cards render when nearly
 * on screen, and `thumbCache` keeps them for the session, so the first open
 * pays for what is visible and the second for nothing.
 *
 * ## Keyboard
 *
 * Arrows move, Enter uses, Shift+Enter adds a plot's curves to the current
 * one, Escape closes. The cursor is also what the footer describes.
 */

interface Props {
  kind: ChartKind;
  onPick: (spec: ChartSpec) => void;
  /**
   * Add this example's curves rather than replacing the chart. Only where it
   * means something: a formula can join a plot that already has one, and a
   * table of quarterly revenue cannot join anything.
   */
  onAddCurves?: (curves: Array<{ source: string; color?: string }>) => void;
}

const THUMB_W = 124;
const THUMB_H = 70;
const COLUMNS = 3;

type Filter = 'suggested' | 'all' | ChartFamily;

export const ExampleButton: React.FC<Props> = ({ kind, onPick, onAddCurves }) => {
  const groups = React.useMemo(() => exampleGroups(kind), [kind]);
  const total = groups.reduce((n, g) => n + g.examples.length, 0);
  if (total === 0) return null;

  return (
    <PanelPopover
      title="Start from an example"
      width={600}
      icon={<LayoutGrid size={12} aria-hidden />}
      tooltip="Start from a finished chart"
      label={
        <>
          Examples
          {/* The count is the promise. A trigger that only says "Examples" is
              a lid with a word on it. */}
          <span className="pnpop__count">{total}</span>
        </>
      }
    >
      {(close) => (
        <ExampleBrowser
          current={kind}
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
          onClose={close}
        />
      )}
    </PanelPopover>
  );
};

const ExampleBrowser: React.FC<{
  current: ChartKind;
  groups: ReturnType<typeof exampleGroups>;
  onPick: (spec: ChartSpec) => void;
  onAddCurves?: (curves: Array<{ source: string; color?: string }>) => void;
  onClose: () => void;
}> = ({ current, groups, onPick, onAddCurves, onClose }) => {
  const family = CHART_FAMILY_OF[current];
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('suggested');
  const [cursor, setCursor] = React.useState(0);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // Once per render rather than once per card: the answer is the same for
  // every card and it is a class-list read each time.
  const dark = ThemeService.isDarkMode();
  const trimmed = query.trim().toLowerCase();

  const inFilter = React.useCallback(
    (k: ChartKind, f: Filter) =>
      f === 'all' ? true : f === 'suggested' ? k === current || CHART_FAMILY_OF[k] === family : CHART_FAMILY_OF[k] === f,
    [current, family]
  );

  const matches = React.useCallback(
    (e: ChartExample, label: string) =>
      !trimmed ||
      e.name.toLowerCase().includes(trimmed) ||
      e.note.toLowerCase().includes(trimmed) ||
      label.toLowerCase().includes(trimmed) ||
      // The formulae too: somebody searching `tan` means the curve, and its
      // name is "Tangent" while its expression is what they typed.
      (e.spec.functions ?? []).some((f) => f.source.toLowerCase().includes(trimmed)),
    [trimmed]
  );

  /** The rail: the suggestion, everything, then each family that has examples. */
  const rail = React.useMemo(() => {
    const count = (f: Filter) =>
      groups.filter((g) => inFilter(g.kind, f)).reduce((n, g) => n + g.examples.filter((e) => matches(e, g.label)).length, 0);
    const families = chartPickerGroups()
      .map((g) => g.family)
      .filter((f) => groups.some((g) => CHART_FAMILY_OF[g.kind] === f));
    return [
      { id: 'suggested' as Filter, label: 'For this chart', count: count('suggested') },
      { id: 'all' as Filter, label: 'All examples', count: count('all') },
      ...families.map((f) => ({ id: f as Filter, label: FAMILY_LABELS[f], count: count(f) })),
    ];
  }, [groups, inFilter, matches]);

  // A search always covers everything; the rail then reports where the
  // matches are rather than hiding most of them.
  const effective: Filter = trimmed ? 'all' : filter;

  const shown = React.useMemo(
    () =>
      groups
        .filter((g) => inFilter(g.kind, effective))
        .map((g) => ({ ...g, examples: g.examples.filter((e) => matches(e, g.label)) }))
        .filter((g) => g.examples.length > 0),
    [groups, inFilter, matches, effective]
  );

  const flat = React.useMemo(() => shown.flatMap((g) => g.examples), [shown]);

  React.useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  const move = (delta: number) => {
    setCursor((c) => {
      const next = Math.max(0, Math.min(flat.length - 1, c + delta));
      scrollRef.current?.querySelector<HTMLElement>(`[data-at="${next}"]`)?.scrollIntoView({ block: 'nearest' });
      return next;
    });
  };

  const choose = (filterId: Filter) => {
    setFilter(filterId);
    setQuery('');
    setCursor(0);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The rail's own buttons keep their native arrow behaviour.
    if ((e.target as HTMLElement).closest('.exb__rail')) return;
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(1),
      ArrowLeft: () => move(-1),
      ArrowDown: () => move(COLUMNS),
      ArrowUp: () => move(-COLUMNS),
      Home: () => move(-flat.length),
      End: () => move(flat.length),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
      return;
    }
    if (e.key === 'Enter') {
      const chosen = flat[cursor];
      if (!chosen) return;
      e.preventDefault();
      if (e.shiftKey && onAddCurves && chosen.spec.functions?.length) onAddCurves(chosen.spec.functions);
      else onPick(chosen.spec);
    }
  };

  const described = flat[cursor];
  const canAdd = Boolean(onAddCurves && described?.spec.functions?.length);
  let index = -1;

  return (
    <div className="exb" onKeyDown={onKeyDown}>
      <header className="exb__head">
        <div className="exb__search">
          <Search size={14} aria-hidden />
          <input
            className="exb__input"
            value={query}
            autoFocus
            placeholder={`Search ${rail[1].count} examples`}
            aria-label="Search examples"
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
          />
          {query && (
            <button type="button" className="exb__clear" aria-label="Clear the search" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
        <button type="button" className="exb__close" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </header>

      <div className="exb__body">
        <nav className="exb__rail" aria-label="Example categories">
          {rail.map((r, i) => (
            <React.Fragment key={r.id}>
              {i === 2 && <span className="exb__railRule" aria-hidden="true" />}
              <button
                type="button"
                className="exb__railItem"
                aria-current={effective === r.id || undefined}
                disabled={r.count === 0}
                onClick={() => choose(r.id)}
              >
                <span className="exb__railLabel">{r.label}</span>
                <span className="exb__railCount">{r.count}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>

        {flat.length === 0 ? (
          // Quotes what was typed, so the reader sees the typo rather than
          // only that something failed.
          <div className="exb__empty">
            <p>Nothing matches “{query}”.</p>
            <button type="button" className="chartp-link" onClick={() => setQuery('')}>
              Clear the search
            </button>
          </div>
        ) : (
          <div className="exb__scroll" ref={scrollRef}>
            {shown.map((group) => (
              <section className="exb__group" key={group.kind}>
                <h5 className="exb__groupLabel">
                  <ChartKindIcon kind={group.kind} size={14} />
                  <span>{group.label}</span>
                  {group.kind === current && <span className="exb__current">Current</span>}
                  <span className="exb__count">{group.examples.length}</span>
                </h5>
                {/* The grid is told its columns by the same constant ArrowDown
                    moves by; two places deciding that independently is a down
                    arrow that skips or repeats a row. */}
                <div className="exb__grid" style={{ '--exb-columns': COLUMNS } as React.CSSProperties}>
                  {group.examples.map((example) => {
                    index += 1;
                    const at = index;
                    return (
                      <ExampleCard
                        key={example.id}
                        example={example}
                        dark={dark}
                        at={at}
                        focused={at === cursor}
                        onFocus={() => setCursor(at)}
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
              </section>
            ))}
          </div>
        )}
      </div>

      {/**
       * One line about whatever the cursor is on, and the keys that act on it.
       *
       * Fixed height, always rendered, so the surface never resizes as the
       * pointer crosses it — a footer that appears on hover moves every card
       * above it and turns a steady scan into a flinch.
       */}
      <footer className="exb__foot">
        <div className="exb__footText">
          {described ? (
            <>
              <span className="exb__footName">{described.name}</span>
              <span className="exb__footNote">
                {described.kind !== current ? `Switches to ${CHART_LABELS[described.kind]} · ` : ''}
                {described.note}
              </span>
            </>
          ) : (
            <span className="exb__footNote">Nothing to show</span>
          )}
        </div>
        <div className="exb__keys" aria-hidden="true">
          <span className="exb__key">
            <kbd>
              <CornerDownLeft size={10} />
            </kbd>
            Use
          </span>
          {canAdd && (
            <span className="exb__key">
              <kbd>⇧</kbd>
              <kbd>
                <CornerDownLeft size={10} />
              </kbd>
              Add
            </span>
          )}
        </div>
      </footer>
    </div>
  );
};

const ExampleCard = React.memo<{
  example: ChartExample;
  dark: boolean;
  at: number;
  focused: boolean;
  onFocus: () => void;
  onPick: () => void;
  onAdd?: () => void;
}>(({ example, dark, at, focused, onFocus, onPick, onAdd }) => {
  /**
   * Already paid for, or waiting to be seen. A cached preview renders at once
   * — a skeleton would be a flash of nothing in front of a value we hold.
   */
  const cached = thumbReady(example.id, THUMB_W, THUMB_H, dark);
  const [ref, near] = useNearViewport<HTMLDivElement>({ enabled: !cached });
  const ready = cached || near;

  const markup = React.useMemo(
    () => (ready ? thumbFor(example.id, example.spec, THUMB_W, THUMB_H, dark) : null),
    [ready, example.id, example.spec, dark]
  );

  return (
    <div className="exb__card" ref={ref} data-at={at}>
      <button
        type="button"
        className="exb__pick"
        data-focused={focused || undefined}
        aria-label={`${example.name}. ${example.note}`}
        onMouseEnter={onFocus}
        onFocus={onFocus}
        onClick={onPick}
      >
        <span className="exb__thumb">
          {markup ? (
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
          ) : (
            // Holds the exact space the chart will take, so nothing reflows.
            <span className="exb__skeleton" style={{ aspectRatio: `${THUMB_W} / ${THUMB_H}` }} />
          )}
        </span>
        <span className="exb__name">{example.name}</span>
      </button>

      {/* Adding a curve to a plot that already has one is a different act from
          replacing the chart, and the one people want more often. */}
      {onAdd && (
        <button
          type="button"
          className="exb__add"
          aria-label={`Add ${example.name} to this plot`}
          data-tooltip="Add to this plot"
          onClick={onAdd}
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
});

ExampleCard.displayName = 'ExampleCard';
