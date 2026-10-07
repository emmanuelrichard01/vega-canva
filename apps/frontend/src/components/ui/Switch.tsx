import React from 'react';

interface SwitchProps {
  /** `'mixed'` when a selection disagrees; pressing it turns everything on. */
  checked: boolean | 'mixed';
  onChange: (checked: boolean) => void;
  /** A visible label beside the track. */
  label?: string;
  /**
   * The switch's name for assistive technology when there is no visible
   * label, or when the visible one is a row label elsewhere.
   */
  ariaLabel?: string;
  tooltip?: string;
  /**
   * Fill the width, with the label at one end and the track at the other.
   * A switch in a toolbar hugs its label; one in a menu justifies, so a
   * column of them lines up.
   */
  block?: boolean;
  disabled?: boolean;
}

/** A real toggle switch: `role="switch"`, armed in the accent, focus in graphite. */
export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, ariaLabel, tooltip, block, disabled }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked === 'mixed' ? 'mixed' : checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={() => onChange(checked !== true)}
      data-tooltip={tooltip}
      data-tooltip-pos="bottom"
      className={`ui-switch${block ? ' ui-switch--block' : ''}`}
    >
      {label && (
        // Hidden by CSS on narrow viewports; the tooltip and aria-label carry
        // the meaning there.
        <span className="ui-switch__label" aria-hidden={ariaLabel ? true : undefined}>
          {label}
        </span>
      )}
      <span className="ui-switch__track" aria-hidden="true">
        <span className="ui-switch__thumb" />
      </span>
    </button>
  );
};
