import React from 'react';
import { motion } from 'framer-motion';
import { RailSideContext } from './railSide';
import { HANG, ENTRY } from './railConstants';
import type { RailSide } from '../../engine/interaction/railPlacement';

/**
 * Dedicated vector edit icon representing an anchor point with control handles.
 */
export const VectorEditIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
    <path d="M3 13 C 3 7, 9 9, 13 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <rect x="1.5" y="11.5" width="3" height="3" rx="0.5" fill="currentColor" stroke="currentColor" strokeWidth="0.5" />
    <rect x="11.5" y="1.5" width="3" height="3" rx="0.5" fill="currentColor" stroke="currentColor" strokeWidth="0.5" />
    <line x1="3" y1="11.5" x2="3" y2="6.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.2 1.2" />
    <circle cx="3" cy="6.5" r="1.3" fill="currentColor" />
  </svg>
);

export const Rail = React.forwardRef<
  HTMLDivElement,
  {
    id: string;
    placement: RailSide;
    clear?: boolean;
    anchorRef: React.RefObject<HTMLDivElement | null>;
    children: React.ReactNode;
  }
>(({ id, placement, clear = true, anchorRef, children }, railRef) => (
  <div
    ref={anchorRef}
    style={{
      position: 'absolute', left: 0, top: 0, zIndex: 200,
      pointerEvents: 'none', willChange: 'transform',
    }}
  >
    <div
      style={{
        position: 'absolute',
        transform: HANG[placement],
        width: 'max-content',
      }}
    >
      <motion.div
        key={id}
        initial={{ opacity: 0, ...ENTRY[placement] }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        exit={{ opacity: 0, ...ENTRY[placement] }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ pointerEvents: 'none' }}
      >
        <div
          ref={railRef}
          className={`ctx-toolbar${clear ? '' : ' ctx-toolbar--veiled'}`}
          data-side={placement}
          style={{ position: 'relative', pointerEvents: 'auto' }}
        >
          <RailSideContext.Provider value={placement === 'top' ? 'top' : 'bottom'}>
            {children}
          </RailSideContext.Provider>
        </div>
      </motion.div>
    </div>
  </div>
));
Rail.displayName = 'Rail';

export const RailButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
  onHover?: (over: boolean) => void;
}> = ({ label, onClick, children, pressed, disabled, danger, hint, onHover }) => (
  <button
    type="button"
    className={`ctx-btn${danger ? ' ctx-btn--danger' : ''}`}
    data-tooltip={hint ?? label}
    aria-label={label}
    aria-pressed={pressed}
    disabled={disabled}
    onClick={onClick}
    onPointerEnter={onHover ? () => onHover(true) : undefined}
    onPointerLeave={onHover ? () => onHover(false) : undefined}
    onFocus={onHover ? () => onHover(true) : undefined}
    onBlur={onHover ? () => onHover(false) : undefined}
  >
    {children}
  </button>
);

export const Divider = () => <span className="ctx-divider" aria-hidden="true" />;

export const PopoverSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, suffix = '', onChange }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div className="ctx-popover__row">
      <span className="ctx-popover__label">{label}</span>
      <span className="ctx-value">{Math.round(value)}{suffix}</span>
    </div>
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="ctx-range"
    />
  </div>
);
