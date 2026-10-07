import React from 'react';

/**
 * The table editor's small controls: toolbar buttons, menu rows and swatches.
 * Every one keeps the grid's selection — a mousedown on a button would
 * otherwise take focus from the sheet before the click lands.
 */

export const Tool: React.FC<{
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  tone?: 'danger';
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, shortcut, pressed, disabled, tone, onClick, children }) => (
  <button
    type="button"
    className="tbled-tool"
    aria-label={label}
    aria-pressed={pressed}
    data-tooltip={shortcut ? `${label} · ${shortcut}` : label}
    data-tone={tone}
    disabled={disabled}
    onPointerDown={(e) => e.preventDefault()}
    onClick={onClick}
  >
    {children}
  </button>
);

export const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint?: string;
  tone?: 'danger';
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}> = ({ icon, label, hint, tone, pressed, disabled, onClick }) => (
  <button
    type="button"
    role="menuitem"
    className="tbled-ctx__item"
    data-tone={tone}
    data-pressed={pressed || undefined}
    disabled={disabled}
    onPointerDown={(e) => e.preventDefault()}
    onClick={onClick}
  >
    {icon}
    <span className="tbled-ctx__label">{label}</span>
    {hint && <span className="tbled-ctx__hint">{hint}</span>}
  </button>
);

export const Sep = () => <span className="tbled-ctx__sep" role="separator" />;
