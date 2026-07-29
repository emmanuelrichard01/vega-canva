import React, { useState, useRef, useEffect } from 'react';

interface Props {
  color: string;
  onChange: (color: string) => void;
  label?: string;
}

const SMART_COLORS = [
  { name: 'Yellow', icon: '🟨', value: '#FDE047' },
  { name: 'Mint', icon: '🟩', value: '#6EE7B7' },
  { name: 'Sky', icon: '🟦', value: '#7DD3FC' },
  { name: 'Pink', icon: '🩷', value: '#F9A8D4' },
  { name: 'Lavender', icon: '🟪', value: '#D8B4FE' },
  { name: 'Peach', icon: '🟧', value: '#FDBA74' },
  { name: 'White', icon: '⚪', value: '#FFFFFF' },
  { name: 'Dark', icon: '⚫', value: '#1F2937' }
];

export const ColorPickerPopover: React.FC<Props> = ({ color, onChange, label }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const displayColor = (!color || color === 'transparent') ? '#000000' : color;

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '4px' }} ref={containerRef}>
      {label && <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', color: 'var(--text-secondary)', marginRight: '4px' }}>{label}</span>}
      
      <button 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '24px', height: '24px', borderRadius: '50%',
          border: '1px solid rgba(0,0,0,0.1)', boxShadow: 'var(--shadow-sm)',
          cursor: 'pointer', overflow: 'hidden', position: 'relative',
          background: displayColor
        }}
      />

      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
          marginTop: '8px', padding: '12px', background: 'var(--surface-primary)',
          border: '1px solid var(--border-divider)', borderRadius: '12px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.2)', zIndex: 50, width: '192px',
          display: 'flex', flexDirection: 'column', gap: '12px'
        }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Smart Colors</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '4px' }}>
              {SMART_COLORS.map((c) => (
                <button
                  key={c.name}
                  onClick={() => { onChange(c.value); setIsOpen(false); }}
                  title={`${c.name}`}
                  style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: c.value,
                    boxShadow: color === c.value ? '0 0 0 2px var(--surface-primary), 0 0 0 3px var(--border-focus)' : 'none'
                  }}
                />
              ))}
            </div>
          </div>

          <div style={{ width: '100%', height: '1px', background: 'var(--border-divider)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '24px', height: '24px', borderRadius: '50%', border: '1px solid rgba(0,0,0,0.1)', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
              <input 
                type="color" 
                value={displayColor}
                onChange={(e) => onChange(e.target.value)}
                style={{ position: 'absolute', top: '-8px', left: '-8px', width: '40px', height: '40px', cursor: 'pointer', opacity: 0 }}
              />
              <div style={{ width: '100%', height: '100%', background: displayColor }} />
            </div>
            <input 
              type="text" 
              value={displayColor.toUpperCase()}
              onChange={(e) => onChange(e.target.value)}
              style={{
                flex: 1, background: 'var(--surface-hover)', border: '1px solid transparent',
                borderRadius: '6px', padding: '4px 8px', fontSize: '12px', fontFamily: 'monospace',
                color: 'var(--text-primary)', outline: 'none'
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
