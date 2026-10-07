import React from 'react';

/**
 * An on/off icon button: bold, italic, aspect lock.
 *
 * Pressed takes an ink wash; mixed takes a dashed edge, since across a
 * selection that disagrees neither state is true. Styled entirely in CSS so
 * the global focus ring is never overridden.
 */
export const IconToggle: React.FC<{
  label: string;
  pressed: boolean;
  mixed?: boolean;
  onClick: () => void;
  disabledReason?: string;
  children: React.ReactNode;
}> = ({ label, pressed, mixed = false, onClick, disabledReason, children }) => (
  <button
    type="button"
    className="pg-toggle"
    aria-label={label}
    aria-pressed={mixed ? 'mixed' : pressed}
    data-tooltip={disabledReason ?? label}
    disabled={Boolean(disabledReason)}
    onClick={onClick}
  >
    {children}
  </button>
);
