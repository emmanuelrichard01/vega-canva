import React from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  size?: Size;
  /** Fills the width of its container. Dialog footers, mobile actions. */
  block?: boolean;
  /** Rendered before the label, at the size matching `size`. */
  icon?: React.ReactNode;
  /**
   * Hover/focus hint, routed through the app's own tooltip rather than the
   * native `title` attribute — `title` cannot be styled, cannot be themed, and
   * takes about a second to appear, which is too slow to explain a control the
   * user is already reaching for.
   */
  tooltip?: string;
  tooltipPos?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * The app's only text button.
 *
 * `type` defaults to "button". React's default is "submit", so a button placed
 * inside any <form> without an explicit type submits it — which is how the
 * dashboard's view-mode toggles could navigate the join-link form.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block, icon, tooltip, tooltipPos = 'bottom', children, type = 'button', ...rest },
  ref,
) {
  const className = [styles.button, styles[variant], styles[size], block ? styles.block : ''].filter(Boolean).join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={className}
      data-tooltip={tooltip}
      data-tooltip-pos={tooltip ? tooltipPos : undefined}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});
