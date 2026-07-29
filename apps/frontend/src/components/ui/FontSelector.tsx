import React from 'react';

const FONTS = [
  'Inter',
  'Roboto',
  'Space Grotesk',
  'Outfit',
  'Georgia',
  'Courier New'
];

interface Props {
  value: string;
  onChange: (val: string) => void;
  className?: string;
}

export const FontSelector: React.FC<Props> = ({ value, onChange, className = '' }) => {
  return (
    <div className={className} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <select 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: 'none', background: 'var(--surface-hover)',
          border: '1px solid transparent', borderRadius: '6px',
          padding: '4px 24px 4px 12px', fontSize: '12px', fontWeight: 500,
          color: 'var(--text-primary)', outline: 'none', cursor: 'pointer',
          fontFamily: value
        }}
      >
        {FONTS.map(font => (
          <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
        ))}
      </select>
      <div style={{ position: 'absolute', right: '8px', pointerEvents: 'none', color: 'var(--text-secondary)' }}>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </div>
  );
};
