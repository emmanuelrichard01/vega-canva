import React from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  tooltip?: string;
  /**
   * Fill the width, with the label at one end and the track at the other.
   *
   * A switch in a toolbar should hug its label; a switch in a menu should not.
   * Hugging inside a menu is what left four toggles at four different
   * horizontal positions, each one sitting wherever its label happened to
   * end — which reads as carelessness even to someone who could not say why.
   */
  block?: boolean;
}

/**
 * A real toggle switch — not an icon button pretending to be one.
 *
 * ## Why this stopped being inline styles
 *
 * Every rule lived in a `style` object, and an inline declaration outranks any
 * selector, so nothing that *used* this component could adjust how it sat.
 * That is fine for a component with one home and wrong for one with two: the
 * header wants it to hug, the View menu wants it to justify, and neither could
 * say so.
 *
 * The on state also painted `--amber-500` — a raw primitive from the palette
 * rather than the accent role, which is the exact drift the token system's own
 * header warns about. An armed switch is the accent, and now says so.
 */
export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, tooltip, block }) => {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      data-tooltip={tooltip}
      data-tooltip-pos="bottom"
      className={`ui-switch${block ? ' ui-switch--block' : ''}`}
    >
      {label && (
        // Hidden by CSS on narrow viewports; the tooltip and aria-label carry
        // the meaning there, so the control stays usable rather than being
        // dropped from the header entirely.
        <span className="ui-switch__label">{label}</span>
      )}
      <span className="ui-switch__track" aria-hidden="true">
        <span className="ui-switch__thumb" />
      </span>
    </button>
  );
};
