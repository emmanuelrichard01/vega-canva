import React from 'react';
import { CornerDownLeft, FunctionSquare, Search, X } from 'lucide-react';
import { PanelPopover } from './PanelPopover';
import { mathText } from '../../engine/chart/mathText';
import { SPARK_H, SPARK_W, tokenSpark } from '../../engine/chart/tokenSpark';
import {
  EXPRESSION_TOKENS,
  tokenFor,
  tokenGroups,
  type ExpressionToken,
} from '../../engine/chart/expressionHelp';

/**
 * Everything you can write, as something you can press.
 *
 * ## The row draws the function
 *
 * Each entry carries a sparkline of the shape it makes, sampled from the same
 * parser that will evaluate it. `tanh` is the case that makes the argument:
 * "the saturating S curve" is a *description of a picture*, and the picture
 * is eighty bytes. A constant draws nothing — `pi` is a number, and a flat
 * line would imply it varies and happens to be level.
 *
 * ## Two lines per entry, and a footer that goes further
 *
 * The description used to share one line with the signature and was cut to
 * "Hyperbolic cosine — the sh…" on most rows — the half of the entry that
 * says what the function is *for* was the half that went. Each entry has two
 * lines now, and the footer shows the entry under the cursor at a size where
 * its shape can be read, with exactly what Enter will write.
 *
 * ## Syntax is insertable too
 *
 * Powers, implicit products and grouping were a paragraph of fine print
 * pinned under the list. They are entries at the end of it now, drawn and
 * pressable like everything above them.
 *
 * ## Where the insertion goes
 *
 * The chart section keeps the caret of the formula last edited: a selection is
 * wrapped (`x^2` → `sqrt(x^2)`), a caret mid-formula inserts in place, and a
 * caret at the end extends the formula with `+`.
 */

interface Props {
  /** `x`, `t` or `a` — the letter this plot's formulae are written in. */
  variable: string;
  onInsert: (text: string) => void;
}

/** Syntax as entries: what the parser reads that is not a name. */
interface SyntaxEntry {
  key: string;
  signature: string;
  insert: string;
  note: string;
}

const syntaxFor = (v: string): SyntaxEntry[] => [
  { key: 'pow', signature: `${v}^2`, insert: '^2', note: 'Powers, with a caret' },
  { key: 'implicit', signature: `2${v}`, insert: `2${v}`, note: 'A number beside a name multiplies' },
  { key: 'times', signature: `a * b`, insert: ' * ', note: 'Multiply; + − / as you would expect' },
  { key: 'group', signature: '( )', insert: '()', note: 'Brackets group, and call a function' },
];

export const ExpressionReference: React.FC<Props> = ({ variable, onInsert }) => (
  <PanelPopover
    title="What you can write"
    width={420}
    icon={<FunctionSquare size={12} aria-hidden />}
    tooltip="Functions and syntax — press to insert"
    label={
      <>
        Functions
        {/* The count, for the same reason the examples button carries one:
            this reference's whole value is that it is complete. */}
        <span className="pnpop__count">{EXPRESSION_TOKENS.length}</span>
      </>
    }
  >
    {(close) => <ReferenceList variable={variable} onInsert={onInsert} onClose={close} />}
  </PanelPopover>
);

type Entry =
  | { type: 'token'; token: ExpressionToken; key: string }
  | { type: 'syntax'; syntax: SyntaxEntry; key: string };

const ReferenceList: React.FC<Props & { onClose: () => void }> = ({ variable, onInsert, onClose }) => {
  const [query, setQuery] = React.useState('');
  const [cursor, setCursor] = React.useState(0);
  const [inserted, setInserted] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const trimmed = query.trim().toLowerCase();

  React.useEffect(() => {
    if (!inserted) return;
    const t = window.setTimeout(() => setInserted(null), 1400);
    return () => window.clearTimeout(t);
  }, [inserted]);

  const sections = React.useMemo(() => {
    const hit = (...fields: string[]) => !trimmed || fields.some((f) => f.toLowerCase().includes(trimmed));
    const tokenSections = tokenGroups()
      .map((g) => ({
        label: g.group as string,
        entries: g.tokens
          .filter((t) => hit(t.name, t.note, t.signature))
          .map((token): Entry => ({ type: 'token', token, key: token.name })),
      }))
      .filter((s) => s.entries.length > 0);
    const syntax = syntaxFor(variable)
      .filter((s) => hit(s.signature, s.note))
      .map((syntax): Entry => ({ type: 'syntax', syntax, key: syntax.key }));
    return syntax.length ? [...tokenSections, { label: 'Syntax', entries: syntax }] : tokenSections;
  }, [trimmed, variable]);

  const flat = React.useMemo(() => sections.flatMap((s) => s.entries), [sections]);

  React.useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  const insertionOf = (e: Entry) => (e.type === 'token' ? tokenFor(e.token, variable) : e.syntax.insert);

  const insert = (e: Entry) => {
    const text = insertionOf(e);
    onInsert(text);
    setInserted(text.trim());
  };

  const move = (delta: number) => {
    setCursor((c) => {
      const next = Math.max(0, Math.min(flat.length - 1, c + delta));
      scrollRef.current?.querySelector<HTMLElement>(`[data-at="${next}"]`)?.scrollIntoView({ block: 'nearest' });
      return next;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      const entry = flat[cursor];
      if (entry) {
        e.preventDefault();
        insert(entry);
      }
    }
  };

  const focused = flat[cursor];
  let index = -1;

  return (
    <div className="exref" onKeyDown={onKeyDown}>
      <header className="exb__head">
        <div className="exb__search">
          <Search size={14} aria-hidden />
          <input
            className="exb__input"
            value={query}
            autoFocus
            placeholder="Search functions"
            aria-label="Search the expression reference"
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
          {/* Which letter this plot is written in, since every insertion is
              rewritten into it: `sin` on a polar plot writes `sin(a)`. */}
          <span className="exref__var" data-tooltip="Insertions use this plot's variable">
            in <em>{variable}</em>
          </span>
        </div>
        <button type="button" className="exb__close" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </header>

      {flat.length === 0 ? (
        <div className="exb__empty">
          <p>Nothing matches “{query}”.</p>
          <button type="button" className="chartp-link" onClick={() => setQuery('')}>
            Clear the search
          </button>
        </div>
      ) : (
        <div className="exref__groups" ref={scrollRef}>
          {sections.map((section) => (
            <section className="exref__group" key={section.label}>
              <h5 className="exref__groupLabel">{section.label}</h5>
              <div className="exref__list">
                {section.entries.map((entry) => {
                  index += 1;
                  const at = index;
                  return (
                    <EntryRow
                      key={entry.key}
                      entry={entry}
                      variable={variable}
                      at={at}
                      focused={at === cursor}
                      onFocus={() => setCursor(at)}
                      onInsert={() => insert(entry)}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* The entry under the cursor, large enough to read its shape, and
          exactly what Enter will write. Fixed height, always present. */}
      <footer className="exref__detail" aria-live="polite">
        {focused ? (
          <>
            <span className="exref__bigspark" aria-hidden="true">
              {focused.type === 'token' && tokenSpark(focused.token) ? (
                <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" focusable="false">
                  <line x1="0" y1={SPARK_H / 2} x2={SPARK_W} y2={SPARK_H / 2} className="exref__axis" />
                  <path d={tokenSpark(focused.token)!} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className="exref__bigglyph">
                  {mathText(focused.type === 'token' ? focused.token.name : focused.syntax.signature)}
                </span>
              )}
            </span>
            <span className="exref__detailText">
              <span className="exref__detailSig">
                {mathText(
                  focused.type === 'token'
                    ? focused.token.signature.replace(/\bx\b/g, variable)
                    : focused.syntax.signature
                )}
              </span>
              <span className="exref__detailNote">
                {focused.type === 'token' ? focused.token.note : focused.syntax.note}
              </span>
            </span>
            <span className="exref__insert">
              {inserted ? (
                <span className="exref__done">Inserted</span>
              ) : (
                <>
                  <kbd>
                    <CornerDownLeft size={10} />
                  </kbd>
                  <code>{insertionOf(focused).trim()}</code>
                </>
              )}
            </span>
          </>
        ) : null}
      </footer>
    </div>
  );
};

const EntryRow = React.memo<{
  entry: Entry;
  variable: string;
  at: number;
  focused: boolean;
  onFocus: () => void;
  onInsert: () => void;
}>(({ entry, variable, at, focused, onFocus, onInsert }) => {
  const spark = entry.type === 'token' ? tokenSpark(entry.token) : null;
  const signature =
    entry.type === 'token' ? entry.token.signature.replace(/\bx\b/g, variable) : entry.syntax.signature;
  const note = entry.type === 'token' ? entry.token.note : entry.syntax.note;
  const glyph = entry.type === 'token' ? entry.token.name : entry.syntax.signature;

  return (
    <button
      type="button"
      className="exref__token"
      data-at={at}
      data-focused={focused || undefined}
      // The whole row inserts. A separate button beside a reference entry is a
      // second target for the one thing anybody wants to do with it.
      onMouseEnter={onFocus}
      onFocus={onFocus}
      onClick={onInsert}
    >
      <span className="exref__spark" aria-hidden>
        {spark ? (
          <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} focusable="false">
            <path d={spark} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span className="exref__glyph">{mathText(glyph)}</span>
        )}
      </span>
      <span className="exref__text">
        {/* Set, so the reference reads like the chart rather than like code. */}
        <code className="exref__sig">{mathText(signature)}</code>
        <span className="exref__desc">{note}</span>
      </span>
    </button>
  );
});

EntryRow.displayName = 'EntryRow';
