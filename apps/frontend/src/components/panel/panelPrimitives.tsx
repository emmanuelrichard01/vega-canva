import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Switch } from '../ui/Switch';
import type { StrokeStyleId } from '../../engine/model/strokeStyle';

export const Accordion: React.FC<{
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
  icon?: React.ReactNode;
  /**
   * One level in, inside another accordion.
   *
   * Drop shadow and inner shadow are two answers to one question — which way
   * does the light fall — and sat as siblings of Blur and of Typography, so the
   * panel offered "shadow" twice at the top level and never said the two were
   * related. Nesting says it, and it costs a quieter header rather than a
   * second component: a sub-section that looked like a section would defeat the
   * grouping it exists to express.
   */
  nested?: boolean;
}> = ({ title, children, defaultOpen = true, badge, icon, nested }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const id = React.useId();
  return (
    <section className="prop-section" data-open={isOpen || undefined} data-nested={nested || undefined}>
      <button
        type="button"
        className="prop-section__header"
        aria-expanded={isOpen}
        aria-controls={`${id}-panel`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChevronRight size={12} className="prop-section__chevron" aria-hidden="true" />
        {icon && <span className="prop-section__icon" aria-hidden="true">{icon}</span>}
        <span className="prop-section__title">{title}</span>
        {badge && <span className="prop-section__badge">{badge}</span>}
      </button>
      {isOpen && (
        <div id={`${id}-panel`} role="region" aria-label={title} className="prop-section__body">
          {children}
        </div>
      )}
    </section>
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

export const Row: React.FC<{
  label: string;
  children: React.ReactNode;
  hint?: string;
  stack?: boolean;
}> = ({ label, children, hint, stack }) => (
  <div className={stack ? 'prop-row prop-row--stack' : 'prop-row'}>
    <span className="prop-row__label" data-tooltip={hint} data-tooltip-pos="left">{label}</span>
    <div className="prop-row__control">{children}</div>
  </div>
);

export const SubGroup: React.FC<{
  label: string;
  hint?: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  children?: React.ReactNode;
}> = ({ label, hint, on, onToggle, children }) => (
  <div className="prop-subgroup" data-on={on || undefined}>
    <Row label={label} hint={hint}>
      <Switch checked={on} onChange={onToggle} />
    </Row>
    {on && children && <div className="prop-subgroup__body">{children}</div>}
  </div>
);

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

export const ToggleButton: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  mixed?: boolean;
  children: React.ReactNode;
}> = ({ active, onClick, label, mixed = false, children }) => (
  <button
    className="btn-icon"
    aria-pressed={mixed ? 'mixed' : active}
    aria-label={label}
    onClick={onClick}
    style={{
      padding: '4px 6px', borderRadius: '4px',
      background: !mixed && active ? 'var(--surface-primary)' : 'transparent',
      color: mixed || active ? 'var(--text-primary)' : 'var(--text-secondary)',
      boxShadow: !mixed && active ? 'var(--shadow-sm)' : 'none',
      outline: mixed ? '1px dashed var(--border-strong, var(--border-divider))' : 'none',
      outlineOffset: '-2px',
    }}
  >
    {children}
  </button>
);
