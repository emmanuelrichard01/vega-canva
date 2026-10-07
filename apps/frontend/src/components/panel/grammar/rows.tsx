import React from 'react';

/**
 * The three row shapes the panel is built from.
 *
 * - `Row`: an 84px label column and a control. For controls whose job is not
 *   visible from their own shape (Blend, Material, Cap).
 * - `PairRow`: two controls side by side, no label column. For dense numeric
 *   pairs whose fields carry their own glyph (X / Y, W / H).
 * - `FullRow`: one control across the width. The section title is its label.
 */

export const Row: React.FC<{
  label: string;
  htmlFor?: string;
  /** A sentence on hover over the label, for a control whose name is not enough. */
  hint?: string;
  /** Label above a control that needs the whole width (a long segmented choice). */
  stack?: boolean;
  children: React.ReactNode;
}> = ({ label, htmlFor, hint, stack, children }) => (
  <div className={stack ? 'pg-row pg-row--stack' : 'pg-row'}>
    {htmlFor ? (
      <label className="pg-row__label" htmlFor={htmlFor} data-tooltip={hint} data-tooltip-pos="left">
        {label}
      </label>
    ) : (
      <span className="pg-row__label" data-tooltip={hint} data-tooltip-pos="left">
        {label}
      </span>
    )}
    <div className="pg-row__control">{children}</div>
  </div>
);

export const PairRow: React.FC<{
  children: React.ReactNode;
  /** A narrow middle column, e.g. the aspect lock between W and H. */
  linked?: boolean;
  /** Three equal columns, e.g. rotation and the two skews. */
  thirds?: boolean;
}> = ({ children, linked, thirds }) => (
  <div className={`pg-pair${linked ? ' pg-pair--linked' : ''}${thirds ? ' pg-pair--thirds' : ''}`}>{children}</div>
);

export const FullRow: React.FC<{ children: React.ReactNode; label?: string }> = ({ children, label }) => (
  <div className="pg-full" role={label ? 'group' : undefined} aria-label={label}>
    {children}
  </div>
);

/** A quiet sentence under a control: a reason, a consequence, a count. */
export const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="pg-note">{children}</p>
);
