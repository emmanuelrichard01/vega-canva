import React from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  tooltip?: string;
}

/** A real toggle switch — not an icon button pretending to be one. */
export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, tooltip }) => {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      data-tooltip={tooltip}
      data-tooltip-pos="bottom"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
      }}
    >
      {label && (
        // Hidden by CSS on narrow viewports; the tooltip and aria-label carry
        // the meaning there, so the control stays usable rather than being
        // dropped from the header entirely.
        <span className="hdr-switch-label" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label}</span>
      )}
      <span
        style={{
          position: 'relative',
          width: 34, height: 20, borderRadius: 10, flexShrink: 0,
          background: checked ? 'var(--amber-500)' : 'var(--surface-hover)',
          border: '1px solid ' + (checked ? 'transparent' : 'var(--border-divider)'),
          transition: 'background 0.15s ease, border-color 0.15s ease',
        }}
      >
        <span
          style={{
            position: 'absolute', top: 1, left: checked ? 15 : 1,
            width: 16, height: 16, borderRadius: '50%',
            background: '#FFFFFF',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            transition: 'left 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </span>
    </button>
  );
};
