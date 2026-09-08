import React from 'react';
import { FunctionSquare, Search, X } from 'lucide-react';
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
 * parser that will evaluate it. That is the single change that turns this from
 * a list into a reference worth opening twice.
 *
 * `tanh` is the case that makes the argument. "Hyperbolic tangent" tells you
 * nothing unless you already know, and the note — "the saturating S curve" —
 * is a *description of a picture*. The picture is eighty bytes. `sinc`'s
 * ringing, `gauss`'s bell, `floor`'s staircase and `mod`'s sawtooth are all
 * chosen because of their shape, so for those the shape simply *is* the
 * definition.
 *
 * A constant draws nothing, deliberately: `pi` is a number, and a flat line
 * across a box would imply it varies and happens to be level.
 *
 * ## What it replaces
 *
 * Two controls that split one job — a row of eleven buttons that inserted, and
 * behind a `<details>`, thirty function names joined with spaces. The buttons
 * covered a third of the functions; the list explained none, answering "does
 * `cbrt` exist" and no other question. Not what `sinc` is for, not that `log`
 * is base ten while `ln` is natural, not how many arguments `atan2` takes.
 *
 * ## Keyboard
 *
 * Arrows move, Enter inserts, and the search field hands off downward — so the
 * whole reference works without the pointer ever leaving the formula you are
 * writing, which is the point of a reference you reach for mid-thought.
 */

interface Props {
  /** `x`, `t` or `a` — the letter this plot's formulae are written in. */
  variable: string;
  onInsert: (text: string) => void;
}

export const ExpressionReference: React.FC<Props> = ({ variable, onInsert }) => (
  <PanelPopover
    title="What you can write"
    width={392}
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
  const [cursor, setCursor] = React.useState(0);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const trimmed = query.trim().toLowerCase();

  const groups = React.useMemo(() => {
    const all = tokenGroups();
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

  const flat = React.useMemo(() => groups.flatMap((g) => g.tokens), [groups]);

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
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Enter': {
        const token = flat[cursor];
        if (token) {
          e.preventDefault();
          onInsert(tokenFor(token, variable));
        }
        break;
      }
      default:
        break;
    }
  };

  let index = -1;

  return (
    <div className="exref" onKeyDown={onKeyDown}>
      <div className="exref__search">
        <Search size={12} aria-hidden />
        <input
          className="exref__input"
          value={query}
          autoFocus
          placeholder={`Search — you are writing in ${variable}`}
          aria-label="Search the expression reference"
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
        />
        {query && (
          <button
            type="button"
            className="exref__clear"
            aria-label="Clear the search"
            onClick={() => setQuery('')}
          >
            <X size={11} />
          </button>
        )}
      </div>

      {flat.length === 0 ? (
        <p className="exref__empty">Nothing matches “{query}”.</p>
      ) : (
        <div className="exref__groups" ref={scrollRef}>
          {groups.map((group) => (
            <section className="exref__group" key={group.group}>
              <h5 className="exref__groupLabel">{group.group}</h5>
              <div className="exref__list">
                {group.tokens.map((token) => {
                  index += 1;
                  const at = index;
                  return (
                    <TokenRow
                      key={token.name}
                      token={token}
                      variable={variable}
                      at={at}
                      focused={at === cursor}
                      onFocus={() => setCursor(at)}
                      onInsert={onInsert}
                    />
                  );
                })}
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

const TokenRow = React.memo<{
  token: ExpressionToken;
  variable: string;
  at: number;
  focused: boolean;
  onFocus: () => void;
  onInsert: (text: string) => void;
}>(({ token, variable, at, focused, onFocus, onInsert }) => {
  const spark = tokenSpark(token);

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
      onClick={() => onInsert(tokenFor(token, variable))}
      title={`Insert ${tokenFor(token, variable)}`}
    >
      {/* A constant has no curve, so it shows its glyph instead — an empty cell
          beside three rows that draw would read as a failure to draw. */}
      <span className="exref__spark" aria-hidden>
        {spark ? (
          <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} focusable="false">
            <path
              d={spark}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.25}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span className="exref__glyph">{mathText(token.name)}</span>
        )}
      </span>
      {/* Set, so the reference reads like the chart rather than like code. */}
      <code className="exref__sig">{mathText(token.signature.replace(/\bx\b/g, variable))}</code>
      <span className="exref__desc">{token.note}</span>
    </button>
  );
});

TokenRow.displayName = 'TokenRow';
