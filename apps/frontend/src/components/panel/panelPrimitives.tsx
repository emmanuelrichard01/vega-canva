import React, { useState } from 'react';
import {
  ChevronRight,
  ImageIcon,
  MessageSquare,
  Mic,
  PenLine,
  Square,
  StickyNote,
  Type,
} from 'lucide-react';
import { Switch } from '../ui/Switch';
import type { StrokeStyleId } from '../../engine/model/strokeStyle';

export const Accordion: React.FC<{
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
  icon?: React.ReactNode;
}> = ({ title, children, defaultOpen = true, badge, icon }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const id = React.useId();
  return (
    <section className="prop-section" data-open={isOpen || undefined}>
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

export const TYPE_ICONS: Record<string, React.ReactNode> = {
  sticky: <StickyNote size={16} color="var(--text-secondary)" />,
  shape: <Square size={16} color="var(--text-secondary)" />,
  text: <Type size={16} color="var(--text-secondary)" />,
  image: <ImageIcon size={16} color="var(--text-secondary)" />,
  audio: <Mic size={16} color="var(--text-secondary)" />,
  path: <PenLine size={16} color="var(--text-secondary)" />,
  comment: <MessageSquare size={16} color="var(--text-secondary)" />,
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
      padding: '6px', borderRadius: '4px',
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

export function shortFont(stack: string): string {
  return (stack.split(',')[0] ?? stack).replace(/["']/g, '').trim();
}
