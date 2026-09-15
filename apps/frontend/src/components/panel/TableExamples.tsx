import React from 'react';
import { CornerDownLeft, LayoutGrid, Search, Table2, X } from 'lucide-react';
import { PanelPopover } from './PanelPopover';
import {
  TABLE_EXAMPLES,
  TABLE_EXAMPLE_CATEGORIES,
  type TableExample,
  type TableExampleCategory,
} from '../../engine/table/tableExamples';
import type { TableSpec } from '../../engine/table/tableTypes';
import { TableThumb } from '../table/TableThumb';

/**
 * Start a table from an example.
 *
 * The chart gallery's shape — categories down the left, pictures on the
 * right, search across the top, one line about the card under the cursor —
 * because the two sit a panel apart and a second arrangement for the same job
 * is a second thing to learn. It differs only where tables differ: a table is
 * a wide document, so the cards are wider and fewer across, and search reads
 * the column headings too, because somebody typing "owner" wants the tables
 * that have one.
 *
 * Using an example replaces the table's cells and look. The footer says so,
 * and one undo gives the old table back.
 */

const COLUMNS = 3;

type Filter = 'all' | TableExampleCategory;

const copy = (spec: TableSpec): TableSpec => JSON.parse(JSON.stringify(spec)) as TableSpec;

export const TableExampleButton: React.FC<{ onPick: (spec: TableSpec) => void }> = ({ onPick }) => (
  <PanelPopover
    title="Start from an example"
    width={600}
    icon={<LayoutGrid size={12} aria-hidden />}
    tooltip="Start from a finished table"
    label={
      <>
        Examples
        <span className="pnpop__count">{TABLE_EXAMPLES.length}</span>
      </>
    }
  >
    {(close) => (
      <TableExampleBrowser
        onPick={(spec) => {
          onPick(copy(spec));
          close();
        }}
        onClose={close}
      />
    )}
  </PanelPopover>
);

const TableExampleBrowser: React.FC<{ onPick: (spec: TableSpec) => void; onClose: () => void }> = ({ onPick, onClose }) => {
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [cursor, setCursor] = React.useState(0);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const trimmed = query.trim().toLowerCase();

  const matches = React.useCallback(
    (e: TableExample) =>
      !trimmed ||
      e.name.toLowerCase().includes(trimmed) ||
      e.note.toLowerCase().includes(trimmed) ||
      (e.spec.cells[0] ?? []).some((h) => h.toLowerCase().includes(trimmed)),
    [trimmed]
  );

  const effective: Filter = trimmed ? 'all' : filter;

  const rail = React.useMemo(() => {
    const count = (f: Filter) => TABLE_EXAMPLES.filter((e) => (f === 'all' || e.category === f) && matches(e)).length;
    return [
      { id: 'all' as Filter, label: 'All examples', count: count('all') },
      ...TABLE_EXAMPLE_CATEGORIES.map((c) => ({ id: c.id as Filter, label: c.label, count: count(c.id) })),
    ];
  }, [matches]);

  const shown = React.useMemo(
    () =>
      TABLE_EXAMPLE_CATEGORIES.filter((c) => effective === 'all' || c.id === effective)
        .map((c) => ({ ...c, examples: TABLE_EXAMPLES.filter((e) => e.category === c.id && matches(e)) }))
        .filter((g) => g.examples.length > 0),
    [effective, matches]
  );

  const flat = React.useMemo(() => shown.flatMap((g) => g.examples), [shown]);

  React.useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  const move = (delta: number) =>
    setCursor((c) => {
      const next = Math.max(0, Math.min(flat.length - 1, c + delta));
      scrollRef.current?.querySelector<HTMLElement>(`[data-at="${next}"]`)?.scrollIntoView({ block: 'nearest' });
      return next;
    });

  const choose = (f: Filter) => {
    setFilter(f);
    setQuery('');
    setCursor(0);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
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
    } else if (e.key === 'Enter' && flat[cursor]) {
      e.preventDefault();
      onPick(flat[cursor].spec);
    }
  };

  const described = flat[cursor];
  let index = -1;

  return (
    <div className="exb exb--tables" onKeyDown={onKeyDown}>
      <header className="exb__head">
        <div className="exb__search">
          <Search size={14} aria-hidden />
          <input
            className="exb__input"
            value={query}
            autoFocus
            placeholder={`Search ${TABLE_EXAMPLES.length} tables, or a column like “owner”`}
            aria-label="Search table examples"
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
        <nav className="exb__rail" aria-label="Table example categories">
          {rail.map((r, i) => (
            <React.Fragment key={r.id}>
              {i === 1 && <span className="exb__railRule" aria-hidden="true" />}
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
          <div className="exb__empty">
            <p>Nothing matches “{query}”.</p>
            <button type="button" className="chartp-link" onClick={() => setQuery('')}>
              Clear the search
            </button>
          </div>
        ) : (
          <div className="exb__scroll" ref={scrollRef}>
            {shown.map((group) => (
              <section className="exb__group" key={group.id}>
                <h5 className="exb__groupLabel">
                  <Table2 size={14} aria-hidden />
                  <span>{group.label}</span>
                  <span className="exb__count">{group.examples.length}</span>
                </h5>
                <div className="exb__grid" style={{ '--exb-columns': COLUMNS } as React.CSSProperties}>
                  {group.examples.map((example) => {
                    index += 1;
                    const at = index;
                    return (
                      <div className="exb__card" key={example.id} data-at={at}>
                        <button
                          type="button"
                          className="exb__pick"
                          data-focused={at === cursor || undefined}
                          aria-label={`${example.name}. ${example.note}`}
                          onMouseEnter={() => setCursor(at)}
                          onFocus={() => setCursor(at)}
                          onClick={() => onPick(example.spec)}
                        >
                          <span className="exb__thumb">
                            <TableThumb example={example} />
                          </span>
                          <span className="exb__name">{example.name}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <footer className="exb__foot">
        <div className="exb__footText">
          {described ? (
            <>
              <span className="exb__footName">{described.name}</span>
              <span className="exb__footNote">
                {described.note} · {described.spec.cells.length} rows × {described.spec.columns.length} columns
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
            Replace cells
          </span>
        </div>
      </footer>
    </div>
  );
};
