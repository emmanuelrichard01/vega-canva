import React, { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Menu } from '../../menu/Menu';
import type { MenuEntry } from '../../menu/menuModel';
import { showTipIfTruncated } from './truncationTip';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  icon?: React.ReactNode;
  /** A second, quieter line in the list. */
  detail?: string;
  /** Options sharing a group are listed under its heading. */
  group?: string;
}

export interface SelectProps<V extends string = string> {
  /** Names the control for assistive technology. */
  label: string;
  value: V | 'mixed';
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  disabledReason?: string;
}

/**
 * A one-of-many choice as a button and a menu.
 *
 * Built on the app's `Menu` instead of a native `<select>`, so the list looks
 * the same in both themes, answers to the same keys as every other menu, and
 * can show an icon beside each option.
 */
export function Select<V extends string = string>({ label, value, options, onChange, disabledReason }: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const mixed = value === 'mixed';
  const current = mixed ? undefined : options.find((o) => o.value === value);

  const entries: MenuEntry[] = [];
  let group: string | undefined;
  options.forEach((o) => {
    if (o.group && o.group !== group) {
      if (entries.length > 0) entries.push({ kind: 'separator', id: `sep-${o.group}` });
      entries.push({ kind: 'heading', id: `head-${o.group}`, label: o.group });
    }
    group = o.group;
    entries.push({
      kind: 'item',
      id: o.value,
      label: o.label,
      icon: o.icon,
      detail: o.detail,
      checked: !mixed && o.value === value,
      onSelect: () => onChange(o.value),
    });
  });

  return (
    <>
      <button
        ref={button}
        type="button"
        className="pg-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${mixed ? 'Mixed' : current?.label ?? value}`}
        disabled={Boolean(disabledReason)}
        data-tooltip={disabledReason}
        onPointerOver={(e) =>
          showTipIfTruncated(e.currentTarget, e.currentTarget.querySelector('.pg-select__value'), disabledReason)
        }
        onFocus={(e) =>
          showTipIfTruncated(e.currentTarget, e.currentTarget.querySelector('.pg-select__value'), disabledReason)
        }
        onClick={() => {
          setKeyboard(false);
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || ((e.key === 'Enter' || e.key === ' ') && !open)) {
            e.preventDefault();
            setKeyboard(true);
            setOpen(true);
          }
        }}
      >
        {current?.icon && <span className="pg-select__icon" aria-hidden="true">{current.icon}</span>}
        <span className="pg-select__value" data-mixed={mixed || undefined}>
          {mixed ? 'Mixed' : current?.label ?? value}
        </span>
        <ChevronDown size={12} className="pg-select__caret" aria-hidden="true" />
      </button>
      {open && button.current && (
        <Menu
          entries={entries}
          label={label}
          anchor={{ kind: 'rect', rect: button.current.getBoundingClientRect(), align: 'start' }}
          focusFirst={keyboard}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </>
  );
}
