import React from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { ChartKindIcon } from '../workspace/chartIcons';
import { CHART_HINTS, CHART_LABELS, chartPickerGroups } from '../../engine/chart/chartKinds';
import type { ChartKind } from '../../engine/chart/chartTypes';

/**
 * The parts the chart panel is built from.
 *
 * ## Why a summary on every collapsed header
 *
 * The panel had nine always-open blocks and was two screens long, so finding
 * the axis controls meant scrolling past the data grid every time. Collapsing
 * them fixes the length and creates a worse problem: a closed section hides
 * whether anything inside it is set, so the only way to know if a prefix is
 * applied is to open the section and look.
 *
 * Every disclosure here therefore carries a **live summary of its own state**
 * on the header row — `$ · 2dp`, `0–300`, `Title, values`. That is the whole
 * design. It is what a properties panel in Figma or a palette in Illustrator
 * does, and the reason is the same: the header is doing two jobs at once, and
 * the second one — *is there anything in here I should care about* — is asked
 * far more often than the first.
 *
 * A section with nothing set says so in the same slot, quietly, rather than
 * leaving the space blank: "off" is a state and blank is an absence, and a
 * reader cannot tell an unset section from a broken one.
 */

/** A collapsible block whose header reports what is inside it. */
export const Disclosure: React.FC<{
  label: string;
  /** The live state, shown on the header when collapsed *and* when open. */
  summary?: string;
  /** Open on first render. The data grid and the formulae are; nothing else. */
  defaultOpen?: boolean;
  /** Trailing controls that belong to the section, not to its contents. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, summary, defaultOpen, actions, children }) => {
  const [open, setOpen] = React.useState(defaultOpen ?? false);
  const id = React.useId();

  return (
    <section className="cp-section" data-open={open || undefined}>
      <div className="cp-section__head">
        <button
          type="button"
          className="cp-section__toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="cp-section__label">{label}</span>
          {/*
            Kept visible when the section is open as well. Hiding it on expand
            makes the header flicker between two widths every time somebody
            opens and closes a section, and the summary is still the fastest
            way to read the state once you are inside.
          */}
          {summary && <span className="cp-section__summary">{summary}</span>}
        </button>
        {actions && <div className="cp-section__actions">{actions}</div>}
      </div>
      {open && (
        <div className="cp-section__body" id={id}>
          {children}
        </div>
      )}
    </section>
  );
};

/**
 * The type control: what this chart *is*, at the top, in one line.
 *
 * It was a grid of nineteen 18px glyphs. That is a picker optimised for
 * somebody who already knows which cell they want and hostile to everybody
 * else — the icons are too small to read as pictures, there is no room for a
 * name, and the five families were flattened into one undifferentiated block.
 *
 * So the panel shows the *current* kind large, with its name and the sentence
 * that says what it is for, and the full catalogue opens as a popover with the
 * room to be read. That is the trade every serious tool makes here: the common
 * case is confirming what you have, not changing it.
 */
export const TypeHeader: React.FC<{ kind: ChartKind; onPick: (k: ChartKind) => void }> = ({
  kind,
  onPick,
}) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Closing on an outside press rather than on blur: blur fires when focus
  // moves *into* the popover's own buttons, which would shut it on the click
  // that was choosing something.
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
    <div className="cp-type" ref={ref}>
      <button
        type="button"
        className="cp-type__current"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cp-type__glyph">
          <ChartKindIcon kind={kind} size={22} />
        </span>
        <span className="cp-type__text">
          <span className="cp-type__name">{CHART_LABELS[kind]}</span>
          <span className="cp-type__hint">{CHART_HINTS[kind]}</span>
        </span>
        <ChevronDown size={13} className="cp-type__caret" />
      </button>

      {open && (
        <div className="cp-type__popover" role="dialog" aria-label="Chart type">
          {chartPickerGroups().map((group) => (
            <div className="cp-type__group" key={group.family}>
              <div className="cp-type__groupLabel">{group.label}</div>
              {group.kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="cp-type__option"
                  data-active={k === kind || undefined}
                  onClick={() => {
                    onPick(k);
                    setOpen(false);
                  }}
                >
                  <ChartKindIcon kind={k} size={17} />
                  <span className="cp-type__optionText">
                    <span className="cp-type__optionName">{CHART_LABELS[k]}</span>
                    <span className="cp-type__optionHint">{CHART_HINTS[k]}</span>
                  </span>
                  {k === kind && <Check size={12} className="cp-type__check" />}
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
 * A row of icon toggles that read as one group.
 *
 * Text buttons in a wrapping flex row were what this replaced, and they had two
 * faults at once: they wrapped differently at every panel width, so the control
 * moved as you resized, and a pressed text button is a weak state — there is no
 * strong visual difference between "Legend" pressed and "Legend" not.
 *
 * These are `aria-pressed` toggles in a bordered track, which is the shape a
 * multi-select of independent options has in every tool this is measured
 * against. It is deliberately *not* `SegmentedControl`: that one is a choice
 * *between* options, and lighting two of its segments would say something it
 * cannot mean.
 */
export const ToggleRow: React.FC<{
  options: Array<{ id: string; icon: React.ReactNode; label: string; on: boolean }>;
  onToggle: (id: string) => void;
}> = ({ options, onToggle }) => (
  <div className="cp-toggles" role="group">
    {options.map((o) => (
      <button
        key={o.id}
        type="button"
        className="cp-toggles__item"
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

/** A label and its control on one line, at the panel's shared column. */
export const Field: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div className="cp-field">
    <span className="cp-field__label" data-tooltip={hint} data-tooltip-pos="left">
      {label}
    </span>
    <div className="cp-field__control">{children}</div>
  </div>
);

/** Two controls sharing one row, for bounds and ranges that belong together. */
export const FieldPair: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div className="cp-field">
    <span className="cp-field__label" data-tooltip={hint} data-tooltip-pos="left">
      {label}
    </span>
    <div className="cp-field__control cp-field__control--pair">{children}</div>
  </div>
);
