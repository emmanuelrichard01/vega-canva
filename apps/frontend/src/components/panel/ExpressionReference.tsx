import React from 'react';
import { FunctionSquare, Search, X } from 'lucide-react';
import { PanelPopover } from './PanelPopover';
import {
  EXPRESSION_TOKENS,
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
 * One list now, where every entry both documents and inserts.
 *
 * ## Why a popover rather than the panel
 *
 * It sat inline for a while, and 260px could not hold thirty-one rows of
 * signature-plus-prose — so it showed a common dozen behind a "show all 31",
 * which was a compromise forced by the width and not a judgement that two
 * thirds of the reference was not worth reading. The surface has room, so the
 * list is whole and the compromise is gone with the constraint that caused it.
 *
 * The trigger carries the count for the same reason the examples button does:
 * "Functions · 31" promises something specific, where a lid labelled "What you
 * can write" promises nothing and gets opened by nobody.
 *
 * ## Search across notes, not just names
 *
 * The thing somebody arrives knowing is a *word* — "root", "bell", "round" —
 * and "bell" finds `gauss` only because the note is searched too. That is the
 * search people actually perform when they do not know the name, which is
 * exactly when a reference is worth having.
 */

interface Props {
  /** `x`, `t` or `a` — the letter this plot's formulae are written in. */
  variable: string;
  onInsert: (text: string) => void;
}


export const ExpressionReference: React.FC<Props> = ({ variable, onInsert }) => (
  <PanelPopover
    title="What you can write"
    width={380}
    icon={<FunctionSquare size={12} aria-hidden />}
    label={
      <>
        Functions
        {/* The count, for the same reason the examples button carries one: a
            trigger that says only "Functions" promises nothing in particular,
            and this reference's whole value is that it is complete. */}
        <span className="pnpop__count">{EXPRESSION_TOKENS.length}</span>
      </>
    }
  >
    <ReferenceList variable={variable} onInsert={onInsert} />
  </PanelPopover>
);

const ReferenceList: React.FC<Props> = ({ variable, onInsert }) => {
  const [query, setQuery] = React.useState('');
  const trimmed = query.trim().toLowerCase();

  const groups = React.useMemo(() => {
    const all = tokenGroups();
    /**
     * All of it, always.
     *
     * Inline in the panel this showed a common dozen behind a "show all 31",
     * which was a density compromise forced by 260px and not a judgement that
     * two thirds of the reference was not worth showing. The surface has room
     * now, so the compromise goes with the constraint that caused it.
     */
    if (!trimmed) return all;
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
  }, [trimmed]);

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
