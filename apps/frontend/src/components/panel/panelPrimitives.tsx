import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Switch } from '../ui/Switch';
import { Section, Row as GrammarRow } from './grammar';
import type { StrokeStyleId } from '../../engine/model/strokeStyle';

/**
 * The older section API, kept for sections that have not moved to the grammar
 * yet. It renders the grammar's `Section`, so every section in the panel has
 * one header, one rhythm and one divider whichever API built it.
 */
export const Accordion: React.FC<{
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
  /** Accepted for compatibility; the grammar's headers carry no icon. */
  icon?: React.ReactNode;
  /** A sub-heading inside another section rather than a section of its own. */
  nested?: boolean;
  /** Stable id for remembered open state. Defaults to the title. */
  id?: string;
}> = ({ title, children, defaultOpen = true, badge, nested, id }) => {
  if (nested) {
    return (
      <div className="pg-subsection">
        <h4 className="pg-subsection__title">
          {title}
          {badge && <span className="pg-section__meta">{badge}</span>}
        </h4>
        {children}
      </div>
    );
  }
  return (
    <Section
      id={id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
      title={title}
      meta={badge}
      collapsible
      defaultOpen={defaultOpen}
    >
      {children}
    </Section>
  );
};

export const StrokeStyleIcon: React.FC<{ style: StrokeStyleId }> = ({ style }) => (
  <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" focusable="false">
    <line
      x1="1" y1="6" x2="19" y2="6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap={style === 'dotted' ? 'round' : 'butt'}
      strokeDasharray={style === 'solid' ? undefined : style === 'dotted' ? '0 4.5' : '4 3'}
      vectorEffect="non-scaling-stroke"
    />
  </svg>
);

/** The labelled row. Same component as the grammar's `Row`. */
export const Row = GrammarRow;

/**
 * A group switched on and off as a whole: a drop shadow, a measure. The switch
 * is the group's label row; its settings appear beneath it while it is on.
 */
export const SubGroup: React.FC<{
  label: string;
  hint?: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  children?: React.ReactNode;
}> = ({ label, hint, on, onToggle, children }) => (
  <div className="prop-subgroup" data-on={on || undefined}>
    <GrammarRow label={label} hint={hint}>
      <Switch checked={on} onChange={onToggle} ariaLabel={label} />
    </GrammarRow>
    {on && children && <div className="prop-subgroup__body">{children}</div>}
  </div>
);

/** A quiet disclosure inside a section, for settings most people never open. */
export const Details: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const [open, setOpen] = useState(false);
  const id = React.useId();
  return (
    <div className="prop-details" data-open={open || undefined}>
      <button
        type="button"
        className="prop-details__toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={11} aria-hidden="true" />
        {label}
      </button>
      {open && <div className="prop-details__body" id={id}>{children}</div>}
    </div>
  );
};
