import React from 'react';

export interface Segment {
  value: string;
  icon?: React.ReactNode;
  label?: string;
}

interface Props {
  segments: Segment[];
  value: string;
  onChange: (val: string) => void;
}

export const SegmentedControl: React.FC<Props> = ({ segments, value, onChange }) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-hover)', padding: '2px', borderRadius: '6px' }}>
      {segments.map((seg) => {
        const isActive = value === seg.value;
        return (
          <button
            key={seg.value}
            onClick={() => onChange(seg.value)}
            className="btn-icon"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '4px', borderRadius: '4px', transition: 'all 0.2s',
              background: isActive ? 'var(--surface-primary)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: isActive ? 'var(--shadow-sm)' : 'none'
            }}
            title={seg.label}
          >
            {seg.icon && <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{seg.icon}</span>}
            {seg.label && !seg.icon && <span style={{ fontSize: '12px', fontWeight: 500 }}>{seg.label}</span>}
          </button>
        );
      })}
    </div>
  );
};
