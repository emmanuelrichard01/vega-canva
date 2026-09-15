import React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { ChartKindIcon } from '../workspace/chartIcons';
import { CHART_HINTS, CHART_LABELS, FAMILY_LABELS, chartPickerGroups } from '../../engine/chart/chartKinds';
import {
  CHART_AGENCY_PALETTES,
  CHART_FAMILY_OF,
  type ChartKind,
} from '../../engine/chart/chartTypes';
import { PanelPopover } from './PanelPopover';

/**
 * The parts the chart panel is built from.
 *
 * ## Flat, with quiet headings
 *
 * This whole section renders **inside** the panel's `Chart` accordion, so a
 * second layer of collapsing turns a list into a tree and charges a click for
 * every control in it. Groups are a sentence-case heading and a hairline —
 * the inspector's own section vocabulary, one step quieter — and nothing in
 * them is behind a disclosure.
 *
 * ## Rows come from the panel
 *
 * Every label/control pair is `Row` from `panelPrimitives`, so chart rows
 * share the inspector's 84px label column instead of inventing a third
 * width. This file defines only what has no equivalent elsewhere: the type
 * card, paired optional numbers, labelled toggles, the palette grid, and the
 * item header annotations share.
 */

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

/** A titled block, with a hairline above it. Not collapsible: see the header. */
export const Group: React.FC<{
  label: string;
  icon?: React.ReactNode;
  /** Trailing controls that belong to the group rather than to a row in it. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, icon, actions, children }) => {
  const id = React.useId();
  return (
    <section className="chartp-group" aria-labelledby={id}>
      <div className="chartp-group__head">
        {icon && <span className="chartp-group__icon" aria-hidden="true">{icon}</span>}
        <h4 className="chartp-group__label" id={id}>
          {label}
        </h4>
        {actions && <div className="chartp-group__actions">{actions}</div>}
      </div>
      <div className="chartp-group__body">{children}</div>
    </section>
  );
};

/**
 * A heading *inside* a group: "still this section, new subject".
 *
 * Sentence case at the label size, with a rule running to the edge so the eye
 * is carried across rather than stopped. It used to be an uppercase run with
 * tracking, which DESIGN.md rules out below 16px for the reason every dense
 * inspector found: an 11px uppercase word needs spacing to be legible at all,
 * and then it shouts.
 */
export const SubHead: React.FC<{ label: string; action?: React.ReactNode }> = ({ label, action }) => (
  <div className="chartp-subhead">
    <span className="chartp-subhead__label">{label}</span>
    <span className="chartp-subhead__rule" aria-hidden="true" />
    {action}
  </div>
);

/**
 * Rows that only mean something while the row above is on.
 *
 * Indented under a hairline, so "these belong to that" is seen rather than
 * inferred from order — the same device the effect sub-groups use.
 */
export const Dependent: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="chartp-dependent">{children}</div>
);

/** A quiet line of explanation, for the one thing a control cannot say. */
export const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="chartp-note">{children}</p>
);

// ---------------------------------------------------------------------------
// The type card
// ---------------------------------------------------------------------------

const CATALOGUE_COLUMNS = 4;

/**
 * What this chart *is*, at the top, and the two ways to change it.
 *
 * The card shows the current kind large, with its name and the sentence
 * saying what it is for; it opens the whole catalogue. Under it sit the
 * kind's **siblings** — the other members of its family, one press each.
 *
 * That split follows how kinds actually change. Almost every switch is
 * sideways — bar to stacked bar, line to area, pie to donut — and a
 * catalogue of twenty-four is the wrong instrument for a move between four.
 * Crossing families is rarer and deliberate, which is exactly what a
 * catalogue is for.
 */
export const TypeHeader: React.FC<{ kind: ChartKind; onPick: (k: ChartKind) => void }> = ({
  kind,
  onPick,
}) => {
  const family = CHART_FAMILY_OF[kind];
  const siblings = chartPickerGroups().find((g) => g.family === family)?.kinds ?? [kind];

  return (
    <div className="chartp-type">
      <PanelPopover
        title="Chart type"
        width={372}
        align="start"
        triggerClassName="chartp-type__card"
        triggerLabel={`Chart type: ${CHART_LABELS[kind]}. Change type`}
        label={
          <>
            <span className="chartp-type__glyph">
              <ChartKindIcon kind={kind} size={22} />
            </span>
            <span className="chartp-type__text">
              <span className="chartp-type__name">{CHART_LABELS[kind]}</span>
              <span className="chartp-type__hint">{CHART_HINTS[kind]}</span>
            </span>
            <ChevronsUpDown size={14} className="chartp-type__caret" aria-hidden="true" />
          </>
        }
      >
        {(close) => (
          <KindCatalogue
            current={kind}
            onPick={(k) => {
              onPick(k);
              close();
            }}
          />
        )}
      </PanelPopover>

      {siblings.length > 1 && (
        <div className="chartp-siblings" role="radiogroup" aria-label={`${FAMILY_LABELS[family]} kinds`}>
          {siblings.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={k === kind}
              aria-label={CHART_LABELS[k]}
              data-tooltip={`${CHART_LABELS[k]} — ${CHART_HINTS[k]}`}
              className="chartp-siblings__item"
              onClick={() => k !== kind && onPick(k)}
            >
              <ChartKindIcon kind={k} size={18} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Every kind, as a grid of pictures grouped by what they compare.
 *
 * Tiles rather than rows: at 24 kinds a list of names is read top to bottom,
 * while a grid of silhouettes is *scanned*, and the silhouette is the thing
 * people remember a chart by. The sentence each kind carries moves to a
 * footer that follows the cursor, so it is said once, about the one tile in
 * question, instead of twenty-four times in 11px.
 */
const KindCatalogue: React.FC<{ current: ChartKind; onPick: (k: ChartKind) => void }> = ({
  current,
  onPick,
}) => {
  const groups = React.useMemo(() => chartPickerGroups(), []);
  const flat = React.useMemo(() => groups.flatMap((g) => g.kinds), [groups]);
  const [cursor, setCursor] = React.useState(() => Math.max(0, flat.indexOf(current)));
  const gridRef = React.useRef<HTMLDivElement>(null);

  // The current kind takes focus on open, so Enter confirms and the arrows
  // start from where you are rather than from the first tile.
  React.useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-at="${cursor}"]`)?.focus();
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveTo = (next: number) => {
    const clamped = Math.max(0, Math.min(flat.length - 1, next));
    setCursor(clamped);
    gridRef.current?.querySelector<HTMLElement>(`[data-at="${clamped}"]`)?.focus();
  };

  /**
   * Up and down move by *visual* row inside a family, and cross into the next
   * family at its edge. Moving by a flat four would land in the middle of the
   * next group, because families end on short rows.
   */
  const vertical = (delta: 1 | -1) => {
    const k = flat[cursor];
    const gi = groups.findIndex((g) => g.kinds.includes(k));
    const col = groups[gi].kinds.indexOf(k) % CATALOGUE_COLUMNS;
    const inGroup = groups[gi].kinds.indexOf(k);
    const target = inGroup + delta * CATALOGUE_COLUMNS;
    if (target >= 0 && target < groups[gi].kinds.length) {
      moveTo(flat.indexOf(groups[gi].kinds[target]));
      return;
    }
    const ng = groups[gi + delta];
    if (!ng) return;
    const rows = Math.ceil(ng.kinds.length / CATALOGUE_COLUMNS);
    const row = delta === 1 ? 0 : rows - 1;
    const idx = Math.min(ng.kinds.length - 1, row * CATALOGUE_COLUMNS + col);
    moveTo(flat.indexOf(ng.kinds[idx]));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => moveTo(cursor + 1),
      ArrowLeft: () => moveTo(cursor - 1),
      ArrowDown: () => vertical(1),
      ArrowUp: () => vertical(-1),
      Home: () => moveTo(0),
      End: () => moveTo(flat.length - 1),
    };
    const run = keys[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  };

  const described = flat[cursor];
  let index = -1;

  return (
    <div className="kcat" onKeyDown={onKeyDown}>
      <div className="kcat__scroll" ref={gridRef}>
        {groups.map((g) => (
          <section className="kcat__group" key={g.family}>
            <h5 className="kcat__label">{g.label}</h5>
            <div className="kcat__grid" style={{ '--kcat-columns': CATALOGUE_COLUMNS } as React.CSSProperties}>
              {g.kinds.map((k) => {
                index += 1;
                const at = index;
                return (
                  <button
                    key={k}
                    type="button"
                    className="kcat__tile"
                    data-at={at}
                    data-current={k === current || undefined}
                    data-focused={at === cursor || undefined}
                    tabIndex={at === cursor ? 0 : -1}
                    aria-pressed={k === current}
                    onMouseEnter={() => setCursor(at)}
                    onFocus={() => setCursor(at)}
                    onClick={() => onPick(k)}
                  >
                    <span className="kcat__glyph">
                      <ChartKindIcon kind={k} size={26} />
                    </span>
                    <span className="kcat__name">{CHART_LABELS[k]}</span>
                    {k === current && <Check size={11} className="kcat__check" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <footer className="kcat__foot" aria-live="polite">
        <span className="kcat__footName">{CHART_LABELS[described]}</span>
        <span className="kcat__footHint">{CHART_HINTS[described]}</span>
      </footer>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * A number that may be absent, where absent means "work it out".
 *
 * ## Why `NumberStepper` could not do this
 *
 * It takes a `number`, so an optional bound has to pick a sentinel — and the
 * axis controls picked `0`. That makes a minimum of zero **unexpressible**:
 * typing 0 to pin a bar chart's baseline reads back as "automatic", and the
 * one value somebody is most likely to want on that field is the one it cannot
 * hold.
 *
 * So this keeps its own draft while focused and commits on blur or Enter.
 * Empty is `undefined`, and the placeholder says what will happen instead.
 * Escape restores the committed value. Committing on blur rather than per
 * keystroke matters: every commit is a CRDT write, an undo entry and a network
 * frame, and typing `-12.5` would otherwise broadcast `-`, which is not a
 * number at all.
 *
 * The arrow keys step it like every other number field in the inspector —
 * `Shift` for ten — starting from the placeholder when the field is empty,
 * so nudging "Auto" begins from the value automatic would have picked.
 */
export const OptionalNumber: React.FC<{
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  label: string;
  /** A short mark inside the field: `min`, `x`, `a`. */
  glyph?: React.ReactNode;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
}> = ({ value, onChange, placeholder = 'Auto', label, glyph, suffix, step = 1, min, max, integer }) => {
  const committed = value === undefined ? '' : String(value);
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? committed;

  const clamp = (n: number) => {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (integer) v = Math.round(v);
    return v;
  };

  const commit = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    if (trimmed === '') onChange(undefined);
    else {
      const n = Number(trimmed);
      // An unreadable draft reverts rather than writing NaN into the document,
      // which would put a broken axis on everybody's board.
      if (Number.isFinite(n)) onChange(clamp(n));
    }
    setDraft(null);
  };

  const nudge = (direction: 1 | -1, coarse: boolean) => {
    const base = draft !== null && draft.trim() !== '' ? Number(draft) : value ?? Number(placeholder);
    if (!Number.isFinite(base)) return;
    const next = clamp(Math.round((base + direction * step * (coarse ? 10 : 1)) * 1e6) / 1e6);
    setDraft(null);
    onChange(next);
  };

  return (
    <label className="chartp-num" data-empty={shown === '' || undefined}>
      {glyph && <span className="chartp-num__glyph" aria-hidden="true">{glyph}</span>}
      <input
        className="chartp-num__input"
        inputMode="decimal"
        value={shown}
        placeholder={placeholder}
        aria-label={label}
        title="↑ ↓ to step · Shift for ten · empty for automatic"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
          }
        }}
      />
      {suffix && shown !== '' && <span className="chartp-num__suffix" aria-hidden="true">{suffix}</span>}
    </label>
  );
};

/**
 * A text field with an optional mark inside it.
 *
 * Writes per keystroke, unlike the number fields: a title is read as it is
 * typed, on the board, and there is no half-typed title that is invalid.
 */
export const TextField: React.FC<{
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  label: string;
  glyph?: React.ReactNode;
  mono?: boolean;
}> = ({ value, onChange, placeholder, label, glyph, mono }) => (
  <label className="chartp-text" data-mono={mono || undefined}>
    {glyph && <span className="chartp-num__glyph" aria-hidden="true">{glyph}</span>}
    <input
      className="chartp-text__input"
      value={value ?? ''}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  </label>
);

/** Two fields that are read against each other, on one line. */
export const Pair: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="chartp-pair">{children}</div>
);

// ---------------------------------------------------------------------------
// Toggles, chips and buttons
// ---------------------------------------------------------------------------

/**
 * Independent switches, each carrying its own word.
 *
 * They were icon-only — a tag, a hash and a grid, 26px each — and the panel
 * asked people to learn that the tag meant *legend*. Every tool this is
 * measured against labels a multi-select like this one, and there was room.
 * `aria-pressed`, not radio: lighting two says something a segmented control
 * cannot mean.
 */
export const ToggleChips: React.FC<{
  options: Array<{ id: string; icon: React.ReactNode; label: string; on: boolean; hint?: string }>;
  onToggle: (id: string) => void;
  columns?: number;
  label?: string;
}> = ({ options, onToggle, columns, label }) => (
  <div
    className="chartp-chips"
    role="group"
    aria-label={label}
    style={{ '--chips-columns': columns ?? options.length } as React.CSSProperties}
  >
    {options.map((o) => (
      <button
        key={o.id}
        type="button"
        className="chartp-chip"
        aria-pressed={o.on}
        data-tooltip={o.hint}
        onClick={() => onToggle(o.id)}
      >
        <span className="chartp-chip__icon" aria-hidden="true">{o.icon}</span>
        <span className="chartp-chip__label">{o.label}</span>
      </button>
    ))}
  </div>
);

/**
 * Shortcuts that set a value, and say when it is the one set.
 *
 * A preset that cannot show whether it is current is five equally-unselected
 * buttons however the chart is configured, which is what these were.
 */
export const QuickChips: React.FC<{
  options: Array<{ id: string; label: React.ReactNode; active?: boolean; hint?: string; onClick: () => void }>;
  label: string;
}> = ({ options, label }) => (
  <div className="chartp-quick" role="group" aria-label={label}>
    {options.map((o) => (
      <button
        key={o.id}
        type="button"
        className="chartp-quick__item"
        aria-pressed={o.active ?? false}
        data-tooltip={o.hint}
        onClick={o.onClick}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/** A square icon button that does something and holds no state. */
export const IconAction: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  tone?: 'danger';
}> = ({ label, onClick, children, disabled, tone }) => (
  <button
    type="button"
    className="chartp-iconbtn"
    aria-label={label}
    data-tooltip={label}
    data-tone={tone}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </button>
);

/** A ghost button that adds something, with the thing it adds as its word. */
export const AddButton: React.FC<{ onClick: () => void; children: React.ReactNode; icon?: React.ReactNode }> = ({
  onClick,
  children,
  icon,
}) => (
  <button type="button" className="chartp-add" onClick={onClick}>
    {icon}
    <span>{children}</span>
  </button>
);

/**
 * The header of a thing that exists on the chart: a target line, a band.
 *
 * Figma's effects list is the model — one line naming the item, its value at
 * a glance and a way to remove it, with its settings indented beneath. It
 * replaces "Remove target line" as a full-width dashed button at the *bottom*
 * of the settings, which put the way out as far from the name as it could be.
 */
export const ItemHead: React.FC<{
  glyph: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  onRemove: () => void;
  removeLabel: string;
}> = ({ glyph, title, meta, onRemove, removeLabel }) => (
  <div className="chartp-item">
    <span className="chartp-item__glyph" aria-hidden="true">{glyph}</span>
    <span className="chartp-item__title">{title}</span>
    {meta !== undefined && <span className="chartp-item__meta">{meta}</span>}
    <IconAction label={removeLabel} onClick={onRemove}>
      <X size={13} />
    </IconAction>
  </div>
);

/** A computed answer, with its name. Selectable text, tabular figures. */
export const Readout: React.FC<{ label: React.ReactNode; children: React.ReactNode }> = ({ label, children }) => (
  <div className="chartp-readout">
    <span className="chartp-readout__label">{label}</span>
    <span className="chartp-readout__value">{children}</span>
  </div>
);

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * The palettes, all on screen, as the colours they are.
 *
 * Six options is a set you compare, and a dropdown hides five of them behind
 * a click and then shows them in a list the width of the panel — a strip of
 * colour six pixels tall beside a name. Laid out as tiles, the whole decision
 * is visible at once and the ribbon is the tile.
 */
export const PaletteGrid: React.FC<{ value: string; onChange: (id: string) => void }> = ({
  value,
  onChange,
}) => (
  <div className="chartp-palettes" role="radiogroup" aria-label="Palette">
    {CHART_AGENCY_PALETTES.map((p) => (
      <button
        key={p.id}
        type="button"
        role="radio"
        aria-checked={p.id === value}
        className="chartp-palette"
        onClick={() => onChange(p.id)}
      >
        <span className="chartp-palette__ribbon" aria-hidden="true">
          {p.colors.slice(0, 6).map((c, i) => (
            <span key={i} style={{ background: c }} />
          ))}
        </span>
        <span className="chartp-palette__name">{p.label}</span>
      </button>
    ))}
  </div>
);
