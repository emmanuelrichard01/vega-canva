import React from 'react';
import { LayoutGrid, Plus, Search, X } from 'lucide-react';
import { exampleGroups, type ChartExample } from '../../engine/chart/chartExamples';
import { thumbFor, thumbReady } from '../../engine/chart/thumbCache';
import { ThemeService } from '../../engine/ThemeService';
import { useNearViewport } from '../../hooks/useNearViewport';
import { PanelPopover } from './PanelPopover';
import type { ChartKind, ChartSpec } from '../../engine/chart/chartTypes';

/**
 * Start from an example.
 *
 * ## What it costs, and what that bought
 *
 * Every card is a real chart, laid out by `layoutChart` and painted by
 * `chartToSvg` — the same pair the export uses, so a card cannot advertise a
 * shape the example does not produce. That fidelity is the point, and it is
 * not free: **sixty-three thumbnails is 374ms of blocked main thread**,
 * measured, with a contour map at ~35ms on its own because marching squares
 * runs per level over a grid.
 *
 * Paying that on every open is what made it feel heavy, and two changes remove
 * it between them:
 *
 * - **Cards render when they are nearly on screen**, not when the list is
 *   built. Nine of sixty-three are visible, so the first open pays for nine.
 * - **`thumbCache` keeps them for the session**, so the second open pays for
 *   nothing at all. The examples are static and the themes are two; a preview
 *   is a pure function of `(id, dark)`.
 *
 * Neither works alone: the cache does nothing for the first open, and lazy
 * mounting alone re-pays every time you scroll back up.
 *
 * ## Keyboard
 *
 * Arrows move, Enter picks, Escape closes — it had none of that, which on a
 * list of sixty-three is the difference between a browser and a wall. The
 * cursor is also what the footer describes, so moving it *narrates* itself,
 * the same trick the dock's `KindPicker` uses.
 */

interface Props {
  kind: ChartKind;
  onPick: (spec: ChartSpec) => void;
  /**
   * Add this example's curves rather than replacing the chart.
   *
   * Only where it means something: a formula can join a plot that already has
   * one, and a table of quarterly revenue cannot join anything.
   */
  onAddCurves?: (curves: Array<{ source: string; color?: string }>) => void;
}

const THUMB_W = 124;
const THUMB_H = 70;
const COLUMNS = 3;

export const ExampleButton: React.FC<Props> = ({ kind, onPick, onAddCurves }) => {
  const groups = React.useMemo(() => exampleGroups(kind), [kind]);
  const total = groups.reduce((n, g) => n + g.examples.length, 0);
  if (total === 0) return null;

  return (
    <PanelPopover
      title="Start from an example"
      width={452}
      icon={<LayoutGrid size={12} aria-hidden />}
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
  const [cursor, setCursor] = React.useState(0);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // Once per render of the browser rather than once per card: the answer is
  // the same for all sixty-three and it is a class-list read each time.
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

  /** Everything on screen in reading order, which is what an arrow key moves through. */
  const flat = React.useMemo(
    () => shown.flatMap((g) => g.examples.map((example) => ({ example, group: g }))),
    [shown]
  );

  // A search that now matches fewer must not leave the cursor past the end.
  React.useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  const move = (delta: number) => {
    setCursor((c) => {
      const next = Math.max(0, Math.min(flat.length - 1, c + delta));
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-at="${next}"]`)
        ?.scrollIntoView({ block: 'nearest' });
      return next;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        move(-1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        move(COLUMNS);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-COLUMNS);
        break;
      case 'Home':
        e.preventDefault();
        move(-flat.length);
        break;
      case 'End':
        e.preventDefault();
        move(flat.length);
        break;
      case 'Enter': {
        const chosen = flat[cursor];
        if (chosen) {
          e.preventDefault();
          onPick(chosen.example.spec);
        }
        break;
      }
      default:
        break;
    }
  };

  const described = flat[cursor];
  let index = -1;

  return (
    <div className="exb" onKeyDown={onKeyDown}>
      <div className="exb__search">
        <Search size={12} aria-hidden />
        <input
          className="exb__input"
          value={query}
          autoFocus
          placeholder="Search examples"
          aria-label="Search examples"
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
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

      {flat.length === 0 ? (
        // Quotes what was typed, so the reader sees the typo rather than only
        // that something failed.
        <p className="exb__empty">Nothing matches “{query}”.</p>
      ) : (
        <div className="exb__scroll" ref={scrollRef}>
          {shown.map((group) => (
            <section className="exb__group" key={group.kind}>
              <h5 className="exb__groupLabel">
                {group.label}
                <span className="exb__count">{group.examples.length}</span>
              </h5>
              {/* The grid is told how many columns to draw by the same constant
                  ArrowDown moves by. Two places deciding that independently is
                  a down arrow that skips or repeats a row. */}
              <div
                className="exb__grid"
                style={{ '--exb-columns': COLUMNS } as React.CSSProperties}
              >
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

      {/**
       * One line about whatever the cursor is on.
       *
       * Fixed height, always rendered, so the surface does not resize as the
       * pointer crosses it — a footer that appears on hover moves every card
       * above it and turns a steady scan into a flinch.
       */}
      <footer className="exb__foot">
        {described ? (
          <>
            <span className="exb__footName">{described.example.name}</span>
            <span className="exb__footNote">{described.example.note}</span>
          </>
        ) : (
          <span className="exb__footNote">
            {flat.length} to choose from — arrows to move, Enter to use one
          </span>
        )}
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
   * Already paid for, or waiting to be seen.
   *
   * A cached preview renders immediately — there is nothing to defer and a
   * skeleton would be a flash of nothing in front of a value we already hold.
   * Everything else waits until it is nearly on screen.
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
            // Holds the exact space the chart will take, so nothing reflows
            // when it arrives.
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
