import React from 'react';
import { Search, X } from 'lucide-react';
import {
  tokenFor,
  tokenGroups,
  type ExpressionToken,
} from '../../engine/chart/expressionHelp';

/**
 * Everything you can write, as something you can press.
 *
 * ## What it replaces
 *
 * Two controls that split one job. A row of eleven buttons that inserted, and
 * — behind a `<details>` labelled "What you can write" — a sentence about
 * operators followed by thirty function names joined with spaces. The buttons
 * covered a third of the functions and the list explained none of them: it
 * answered "does `cbrt` exist" and no other question. Not what `sinc` is for,
 * not that `log` is base ten while `ln` is natural, not how many arguments
 * `atan2` takes.
 *
 * One list now, not hidden, where every entry both documents and inserts.
 *
 * ## Why it is filterable rather than long
 *
 * Thirty-one entries with a line of prose each is more than a properties
 * panel should show at rest, and grouping alone does not fix that — the
 * thing somebody arrives knowing is a *word*: "root", "log", "round". So the
 * list is short by default (the dozen that carry most plots) and the field
 * opens the rest. Typing filters names *and* notes together, because "bell"
 * finds `gauss` and that is the search somebody actually performs.
 */

interface Props {
  /** `x`, `t` or `a` — the letter this plot's formulae are written in. */
  variable: string;
  onInsert: (text: string) => void;
}

/**
 * The dozen shown before anybody types.
 *
 * Chosen by what appears in real formulae rather than by any ordering of the
 * parser: the trig three, the exponential pair, roots, absolute value, the two
 * shapes that are awkward to write out, and the constants.
 */
const COMMON = new Set([
  'sin', 'cos', 'tan', 'exp', 'ln', 'log', 'sqrt', 'abs', 'sinc', 'gauss', 'pi', 'e',
]);

export const ExpressionReference: React.FC<Props> = ({ variable, onInsert }) => {
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState(false);
  const trimmed = query.trim().toLowerCase();

  const groups = React.useMemo(() => {
    const all = tokenGroups();
    if (!trimmed) {
      if (expanded) return all;
      return all
        .map((g) => ({ ...g, tokens: g.tokens.filter((t) => COMMON.has(t.name)) }))
        .filter((g) => g.tokens.length > 0);
    }
    return all
      .map((g) => ({
        ...g,
        tokens: g.tokens.filter(
          (t) =>
            t.name.toLowerCase().includes(trimmed) ||
            t.note.toLowerCase().includes(trimmed) ||
            t.signature.toLowerCase().includes(trimmed)
        ),
      }))
      .filter((g) => g.tokens.length > 0);
  }, [trimmed, expanded]);

  const shown = groups.reduce((n, g) => n + g.tokens.length, 0);

  return (
    <div className="exref">
      <div className="exref__head">
        <div className="exref__search">
          <Search size={11} aria-hidden />
          <input
            className="exref__input"
            value={query}
            placeholder={`What you can write in ${variable}`}
            aria-label="Search the expression reference"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="exref__clear"
              aria-label="Clear the search"
              onClick={() => setQuery('')}
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      {shown === 0 ? (
        <p className="exref__empty">Nothing matches “{query}”.</p>
      ) : (
        <div className="exref__groups">
          {groups.map((group) => (
            <section className="exref__group" key={group.group}>
              <h5 className="exref__groupLabel">{group.group}</h5>
              <div className="exref__list">
                {group.tokens.map((token) => (
                  <TokenRow
                    key={token.name}
                    token={token}
                    variable={variable}
                    onInsert={onInsert}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Not a disclosure over the whole reference — the common dozen are
          always on screen. This only says whether the rarer two thirds are
          listed as well, which is a genuine choice about density rather than
          a lid on the feature. */}
      {!trimmed && (
        <button
          type="button"
          className="exref__more"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show fewer' : 'Show all 31'}
        </button>
      )}

      <p className="exref__note">
        Numbers, <code>+ − × / %</code>, <code>^</code> for powers, brackets, and implicit
        products: <code>2{variable}</code> and <code>3sin({variable})</code> both work.
      </p>
    </div>
  );
};

const TokenRow: React.FC<{
  token: ExpressionToken;
  variable: string;
  onInsert: (text: string) => void;
}> = ({ token, variable, onInsert }) => (
  <button
    type="button"
    className="exref__token"
    // The whole row inserts. A separate insert button beside a reference entry
    // is a second target for the one thing anybody wants to do with it.
    onClick={() => onInsert(tokenFor(token, variable))}
    title={`Insert ${tokenFor(token, variable)}`}
  >
    <code className="exref__sig">{token.signature.replace(/\bx\b/g, variable)}</code>
    <span className="exref__desc">{token.note}</span>
  </button>
);
