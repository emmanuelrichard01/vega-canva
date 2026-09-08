import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { ChartKindIcon } from '../workspace/chartIcons';
import { CHART_HINTS, CHART_LABELS, chartPickerGroups } from '../../engine/chart/chartKinds';
import { CHART_AGENCY_PALETTES, type ChartKind } from '../../engine/chart/chartTypes';

/**
 * The parts the chart panel is built from.
 *
 * ## Why there are almost no disclosures here
 *
 * There were nine, and they were wrong twice over.
 *
 * First, structurally: this whole section already renders **inside** the
 * panel's `Chart` accordion. Nine collapsibles within a collapsible is a tree
 * where the panel everywhere else is a list, and the cost is paid on every
 * visit — three clicks to reach a control that was two rows away.
 *
 * Second, in principle. Progressive disclosure earns its keep when the hidden
 * thing is genuinely secondary *and* long. Applied to eight rows of ordinary
 * controls it inverts: a title field and two toggles are cheaper to show than
 * to describe on a header, and hiding them means every one of them costs a
 * click that reveals almost nothing. A properties panel is scanned far more
 * often than it is read, and scanning is what a collapsed section prevents.
 *
 * So the layout is **flat, with quiet headings and hairlines**, which is what
 * Figma's inspector and Illustrator's palettes do. Exactly two things stay
 * behind a disclosure, and both pass the test: the preset gallery (fourteen
 * entries, reference material, wanted once) and the function vocabulary (a
 * wall of names, consulted rarely).
 *
 * ## Why rows are not defined here
 *
 * They were, at `72px`, and that was the alignment bug. `.prop-row` in
 * `index.css` is `84px | 1fr` and its comment records why — a narrower column
 * truncated the labels this panel actually uses. Inventing a third width put
 * the chart rows a dozen pixels out of step with the Transform and Fill rows
 * directly above them in the same panel. So chart rows are `Row` from
 * `panelPrimitives`, like every other row in the inspector, and this file
 * defines only what genuinely has no equivalent.
 */

/** A titled block, with a hairline above it. Not collapsible: see the header. */
export const Group: React.FC<{
  label: string;
  /** Trailing controls that belong to the group rather than to a row in it. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, actions, children }) => (
  <section className="chartp-group">
    <div className="chartp-group__head">
      <h4 className="chartp-group__label">{label}</h4>
      {actions && <div className="chartp-group__actions">{actions}</div>}
    </div>
    <div className="chartp-group__body">{children}</div>
  </section>
);

/**
 * The two things still worth hiding.
 *
 * Kept deliberately plain — a summary line would be reinventing the header
 * that was just removed. These hold reference material, and the only question
 * asked of them is "show me the list", which the label already answers.
 */
/**
 * A heading *inside* a section.
 *
 * The panel had fifteen top-level groups because every cluster of two rows
 * that wanted a name could only get one by becoming a group — so "Numbers",
 * "Order", "Density", "Distribution", "Donut" and "Analytics" all sat at the
 * same level as "Data", implying they were the same size of idea. They are
 * not: they are subdivisions of the axis, of the marks, of the palette.
 *
 * A rule with a word on it says "still in this section, new subject", which
 * is all those six ever needed and a fifth of the vertical space a group
 * costs.
 */
export const SubHead: React.FC<{ label: string }> = ({ label }) => (
  <div className="chartp-subhead" role="presentation">
    <span>{label}</span>
  </div>
);

export const Reveal: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <details className="chartp-reveal">
    <summary className="chartp-reveal__summary">{label}</summary>
    <div className="chartp-reveal__body">{children}</div>
  </details>
);

/**
 * The type control: what this chart *is*, at the top, in one line.
 *
 * It was a grid of nineteen 18px glyphs — a picker optimised for somebody who
 * already knows which cell they want and hostile to everybody else. The icons
 * are too small to read as pictures, there is no room for a name, and the five
 * families were flattened into one undifferentiated block.
 *
 * So the panel shows the *current* kind large, with its name and the sentence
 * saying what it is for, and the catalogue opens as a popover with room to be
 * read. That is the trade every serious tool makes here: the common act is
 * confirming what you have, not changing it.
 */
export const TypeHeader: React.FC<{ kind: ChartKind; onPick: (k: ChartKind) => void }> = ({
  kind,
  onPick,
}) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Closing on an outside press rather than on blur: blur fires when focus
  // moves *into* the popover's own buttons, which would shut it on the very
  // click that was choosing something.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="chartp-type" ref={ref}>
      <button
        type="button"
        className="chartp-type__current"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chartp-type__glyph">
          <ChartKindIcon kind={kind} size={20} />
        </span>
        <span className="chartp-type__text">
          <span className="chartp-type__name">{CHART_LABELS[kind]}</span>
          <span className="chartp-type__hint">{CHART_HINTS[kind]}</span>
        </span>
        <ChevronDown size={13} className="chartp-type__caret" />
      </button>

      {open && (
        <div className="chartp-type__popover" role="dialog" aria-label="Chart type">
          {chartPickerGroups().map((group) => (
            <div className="chartp-type__group" key={group.family}>
              <div className="chartp-type__groupLabel">{group.label}</div>
              {group.kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="chartp-type__option"
                  data-active={k === kind || undefined}
                  onClick={() => {
                    onPick(k);
                    setOpen(false);
                  }}
                >
                  <ChartKindIcon kind={k} size={16} />
                  <span className="chartp-type__optionText">
                    <span className="chartp-type__optionName">{CHART_LABELS[k]}</span>
                    <span className="chartp-type__optionHint">{CHART_HINTS[k]}</span>
                  </span>
                  {k === kind && <Check size={12} className="chartp-type__check" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * A number that may be absent, where absent means "work it out".
 *
 * ## Why `NumberStepper` could not do this
 *
 * It takes a `number`, so an optional bound has to pick a sentinel — and the
 * axis controls picked `0`. That makes a minimum of zero **unexpressible**:
 * typing 0 to pin a bar chart's baseline reads back as "automatic", and the
 * one value somebody is most likely to want on that field is the one it cannot
 * hold. A control that silently refuses a legitimate value is worse than one
 * that is missing.
 *
 * So this is a text field that keeps its own draft while focused and commits on
 * blur or Enter. Empty is `undefined`, and the placeholder says what will
 * happen instead of leaving a blank that reads as a bug. Escape restores the
 * committed value, because a half-typed number is not a state anybody wants to
 * be left in.
 *
 * Committing on blur rather than per keystroke matters here for the same
 * reason it does in the data grid: every commit is a CRDT write, an undo entry
 * and a network frame, and typing `-12.5` would broadcast four intermediate
 * axis bounds, one of which is `-` and not a number at all.
 */
export const OptionalNumber: React.FC<{
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  label: string;
}> = ({ value, onChange, placeholder = 'Auto', label }) => {
  const committed = value === undefined ? '' : String(value);
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? committed;

  const commit = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    if (trimmed === '') onChange(undefined);
    else {
      const n = Number(trimmed);
      // An unreadable draft reverts rather than writing NaN into the document,
      // which would put a broken axis on everybody's board.
      if (Number.isFinite(n)) onChange(n);
    }
    setDraft(null);
  };

  return (
    <input
      className="panel-input chartp-optnum"
      inputMode="decimal"
      value={shown}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};

/**
 * A row of icon toggles that reads as one group.
 *
 * Deliberately *not* `SegmentedControl`: that one is a choice **between**
 * options, and lighting two of its segments would say something it cannot
 * mean. These are independent switches, so they get a bordered track and
 * `aria-pressed` — the shape a multi-select has in every tool this is measured
 * against.
 */
export const ToggleRow: React.FC<{
  options: Array<{ id: string; icon: React.ReactNode; label: string; on: boolean }>;
  onToggle: (id: string) => void;
}> = ({ options, onToggle }) => (
  <div className="chartp-toggles" role="group">
    {options.map((o) => (
      <button
        key={o.id}
        type="button"
        className="chartp-toggles__item"
        aria-pressed={o.on}
        aria-label={o.label}
        data-tooltip={o.label}
        onClick={() => onToggle(o.id)}
      >
        {o.icon}
      </button>
    ))}
  </div>
);

/**
 * A row of buttons that *do* something, rather than holding a state.
 *
 * Separated from `ToggleRow` because they are not toggles and were being drawn
 * as permanently-unpressed ones — four switches that never light, which is a
 * control lying about its own kind.
 */
export const ActionRow: React.FC<{
  actions: Array<{ id: string; icon: React.ReactNode; label: string }>;
  onRun: (id: string) => void;
}> = ({ actions, onRun }) => (
  <div className="chartp-actions">
    {actions.map((a) => (
      <button
        key={a.id}
        type="button"
        className="chartp-actions__item"
        aria-label={a.label}
        data-tooltip={a.label}
        onClick={() => onRun(a.id)}
      >
        {a.icon}
      </button>
    ))}
  </div>
);

/**
 * Luxury visual ribbon palette picker.
 * Displays harmonious color bands rather than plain text dropdown options.
 */
export const PaletteRibbonPicker: React.FC<{
  value: string;
  onChange: (paletteId: string) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const current = CHART_AGENCY_PALETTES.find((p) => p.id === value) ?? CHART_AGENCY_PALETTES[0];

  return (
    <div style={{ position: 'relative', width: '100%' }} ref={ref}>
      <button
        type="button"
        className="chartp-palette-btn"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ fontWeight: 500 }}>{current.label}</span>
        <div className="chartp-ribbon">
          {current.colors.slice(0, 6).map((c, i) => (
            <span key={i} className="chartp-ribbon-stripe" style={{ background: c }} />
          ))}
        </div>
      </button>

      {open && (
        <div className="chartp-palette-popover" role="dialog" aria-label="Palette selection">
          {CHART_AGENCY_PALETTES.map((p) => {
            const active = p.id === value;
            return (
              <button
                key={p.id}
                type="button"
                className="chartp-palette-option"
                data-active={active}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
              >
                <span style={{ fontSize: 11 }}>{p.label}</span>
                <div className="chartp-ribbon">
                  {p.colors.slice(0, 6).map((c, i) => (
                    <span key={i} className="chartp-ribbon-stripe" style={{ background: c }} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Clickable mathematical token chips for quick formula insertion.
 */
export const MathTokenBar: React.FC<{
  onInsert: (token: string) => void;
  variable?: string;
}> = ({ onInsert, variable = 'x' }) => {
  const TOKENS = [
    { label: 'sin', insert: `sin(${variable})` },
    { label: 'cos', insert: `cos(${variable})` },
    { label: 'tan', insert: `tan(${variable})` },
    { label: 'exp', insert: `exp(${variable})` },
    { label: 'ln', insert: `ln(${variable})` },
    { label: `√${variable}`, insert: `sqrt(${variable})` },
    { label: 'π', insert: 'pi' },
    { label: `${variable}²`, insert: `${variable}^2` },
    { label: `${variable}ⁿ`, insert: `${variable}^` },
    { label: `|${variable}|`, insert: `abs(${variable})` },
    { label: '( )', insert: '()' },
  ];

  return (
    <div className="chartp-tokens" aria-label="Insert math functions">
      {TOKENS.map((t) => (
        <button
          key={t.label}
          type="button"
          className="chartp-token-btn"
          onClick={() => onInsert(t.insert)}
          title={`Insert ${t.insert}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
};

