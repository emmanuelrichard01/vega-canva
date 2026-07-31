import React from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './IconButton.module.css';

type Size = 'sm' | 'md' | 'lg';

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  /** The glyph. Size it with `--icon-sm|md|lg`, not a literal. */
  icon: React.ReactNode;
  /**
   * Required. An icon-only control is unlabelled to a screen reader, and
   * `data-tooltip` is a presentational attribute that assistive technology
   * never sees. Making this required is the only reliable way to stop the next
   * icon button shipping unlabelled.
   */
  'aria-label': string;
  size?: Size;
  /** Armed/selected. Emits `aria-pressed` so the state is not colour-only. */
  active?: boolean;
  /** Renders a chevron and marks the control as owning a menu. */
  hasMenu?: boolean;
  /** Only meaningful with `hasMenu`. */
  expanded?: boolean;
  danger?: boolean;
  tooltip?: string;
  tooltipPos?: 'top' | 'bottom' | 'left' | 'right';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    size = 'md',
    active,
    hasMenu,
    expanded,
    danger,
    tooltip,
    tooltipPos = 'top',
    type = 'button',
    ...rest
  },
  ref,
) {
  const className = [
    styles.iconButton,
    styles[size],
    hasMenu ? styles.hasMenu : '',
    danger ? styles.danger : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={className}
      // A menu trigger reports aria-expanded; a toggle reports aria-pressed.
      // Emitting both makes the control ambiguous to a screen reader, which is
      // why `active` on a menu trigger falls back to a data attribute the
      // stylesheet reads instead.
      aria-pressed={hasMenu ? undefined : active}
      aria-haspopup={hasMenu ? 'menu' : undefined}
      aria-expanded={hasMenu ? Boolean(expanded) : undefined}
      data-active={hasMenu && active ? 'true' : undefined}
      // Suppressed while the menu is open: a tooltip that covers the menu it
      // just opened is worse than no tooltip.
      data-tooltip={expanded ? undefined : tooltip}
      data-tooltip-pos={tooltip ? tooltipPos : undefined}
      {...rest}
    >
      {icon}
      {hasMenu && <ChevronDown size={12} className={styles.chevron} aria-hidden="true" />}
    </button>
  );
});
