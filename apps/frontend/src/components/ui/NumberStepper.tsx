import React, { useState, useEffect } from 'react';
import { Minus, Plus } from 'lucide-react';

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  className?: string;
}

export const NumberStepper: React.FC<Props> = ({ value, onChange, min = -Infinity, max = Infinity, step = 1, label, className = '' }) => {
  const [localValue, setLocalValue] = useState(value.toString());

  useEffect(() => {
    setLocalValue(value.toString());
  }, [value]);

  const handleCommit = (val: number) => {
    const clamped = Math.max(min, Math.min(max, val));
    onChange(clamped);
    setLocalValue(clamped.toString());
  };

  const handleBlur = () => {
    const parsed = parseFloat(localValue);
    if (!isNaN(parsed)) {
      // Committing unconditionally here meant merely focusing and blurring
      // this field — no edit at all — fired onChange (and so a CRDT write)
      // every time. Worse: the same field often has a lower `max` in this
      // toolbar than in the Properties panel (e.g. font size 200 vs 500) —
      // a value set higher elsewhere would silently get clamped back down
      // just by tabbing through this control with no intent to change it.
      const clamped = Math.max(min, Math.min(max, parsed));
      if (clamped !== value) {
        handleCommit(parsed);
      } else if (clamped.toString() !== localValue) {
        setLocalValue(clamped.toString());
      }
    } else {
      setLocalValue(value.toString());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handleCommit(value + step);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleCommit(value - step);
    }
  };

  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      {label && <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', color: 'var(--text-secondary)', marginRight: '4px' }}>{label}</span>}
      <div style={{ 
        display: 'flex', alignItems: 'center', background: 'var(--surface-hover)', 
        borderRadius: '6px', overflow: 'hidden', border: '1px solid transparent',
        transition: 'border-color 0.2s'
      }}>
        <button 
          onClick={() => handleCommit(value - step)}
          disabled={value <= min}
          className="btn-icon"
          style={{ padding: '4px', opacity: value <= min ? 0.3 : 1 }}
        >
          <Minus size={14} />
        </button>
        <input
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          style={{
            width: '32px', background: 'transparent', border: 'none', outline: 'none',
            textAlign: 'center', fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-primary)'
          }}
        />
        <button 
          onClick={() => handleCommit(value + step)}
          disabled={value >= max}
          className="btn-icon"
          style={{ padding: '4px', opacity: value >= max ? 0.3 : 1 }}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
};
