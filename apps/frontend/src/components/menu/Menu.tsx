import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';
import {
  aimingAt,
  firstIndex,
  isNavigable,
  lastIndex,
  placeAtPoint,
  placeAtRect,
  placeSubmenu,
  stepIndex,
  typeahead,
  type MenuEntry,
  type Placement,
  type Size,
} from './menuModel';
import { menuShortcut, withShortcut } from './shortcuts';

/**
 * The app's menu: right-click on the board, and the rail's overflow.
 *
 * ## What a menu has to do that a column of buttons does not
 *
 * The context menu this replaces was a `div` of buttons with `role="menu"` on
 * it and none of the behaviour the role promises. No arrow keys, no Home and
 * End, no typing a letter to jump, no focus on open and none restored on close
 * — a screen reader announced a menu the keyboard could not enter. It could not
 * nest either, so every command sat at the top level and a shape swapper was
 * sixty glyphs laid out inline.
 *
 * This is the whole contract, once, for every menu in the app:
 *
 * - **Keyboard.** Up and Down move, wrapping and skipping rules and disabled
 *   rows. Right and Enter open a submenu and step into it; Left and Escape step
 *   back out. Letters jump to the row that starts with them. Tab leaves.
 * - **Submenus that forgive the pointer.** Moving diagonally to a submenu
 *   crosses the rows under the one that opened it. Each of those used to be a
 *   chance to lose the submenu; here the pointer's heading is read, and a row
 *   crossed on the way to an open submenu does not take it away.
 * - **Placement a desktop user expects.** Down and right of the pointer,
 *   flipping rather than sliding when there is no room, so the first row never
 *   lands under a pointer that is still releasing a right-click.
 * - **One authored motion.** The panel grows out of the corner nearest the
 *   pointer, in 140ms, on the app's exponential settle. Under reduced motion it
 *   simply appears.
 */

export type MenuAnchor =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'rect'; rect: DOMRect; prefer?: 'below' | 'above'; align?: 'start' | 'end' };

interface MenuProps {
  entries: MenuEntry[];
  label: string;
  anchor: MenuAnchor;
  onClose: () => void;
  /** Put the keyboard on the first row — for a menu the keyboard opened. */
  focusFirst?: boolean;
}

const MARGIN = 8;
const OPEN_DELAY = 110;
const AIM_GRACE = 260;

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight, margin: MARGIN });

export const Menu: React.FC<MenuProps> = ({ entries, label, anchor, onClose, focusFirst = false }) => {
  const layerRef = useRef<HTMLDivElement>(null);
  /** What had focus before, so closing from the keyboard hands it back. */
  const returnTo = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const restore = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const closeAll = useCallback((giveFocusBack: boolean) => {
    restore.current = giveFocusBack;
    onCloseRef.current();
  }, []);

  useEffect(() => {
    /**
     * `pointerdown`, in the capture phase: a menu still on screen at mouseup
     * would sit over a drag that has already begun, and a handler that stops
     * propagation on the way up must not be able to keep it open.
     */
    const onDown = (e: PointerEvent) => {
      if (!layerRef.current?.contains(e.target as Node)) closeAll(false);
    };
    const onWheel = (e: WheelEvent) => {
      if (!layerRef.current?.contains(e.target as Node)) closeAll(false);
    };
    const onBlur = () => closeAll(false);
    const onResize = () => closeAll(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onResize);
    const previous = returnTo.current;
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      if (restore.current && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [closeAll]);

  const place = useCallback(
    (size: Size): Placement =>
      anchor.kind === 'point'
        ? placeAtPoint(anchor, size, viewport())
        : placeAtRect(anchor.rect, size, viewport(), anchor.prefer, anchor.align),
    [anchor]
  );

  return createPortal(
    <div ref={layerRef} className="menu-layer" onContextMenu={(e) => e.preventDefault()}>
      <MenuPanel
        entries={entries}
        label={label}
        depth={0}
        place={place}
        focusToken={focusFirst ? 1 : 0}
        closeAll={closeAll}
      />
    </div>,
    document.body
  );
};

interface PanelProps {
  entries: MenuEntry[];
  label: string;
  depth: number;
  place: (size: Size) => Placement & { side?: 'left' | 'right' };
  /** Changes whenever the keyboard should land on the first row. `0` means don't. */
  focusToken: number;
  closeAll: (giveFocusBack: boolean) => void;
  /** Step back to the row that opened this panel. */
  onBack?: () => void;
  /** Report where this panel ended up, for the parent's aim test. */
  onPlaced?: (rect: DOMRect, side: 'left' | 'right') => void;
  onPointerEnterPanel?: () => void;
  /** A bespoke body instead of rows. */
  custom?: (close: () => void) => React.ReactNode;
}

interface OpenSub {
  index: number;
  row: DOMRect;
  parent: DOMRect;
  focusToken: number;
}

const MenuPanel: React.FC<PanelProps> = ({
  entries,
  label,
  depth,
  place,
  focusToken,
  closeAll,
  onBack,
  onPlaced,
  onPointerEnterPanel,
  custom,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<number, HTMLElement>());
  const [spot, setSpot] = useState<(Placement & { side?: 'left' | 'right' }) | null>(null);
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<OpenSub | null>(null);
  /** Which tile in each strip the keyboard is on. */
  const [tile, setTile] = useState<Record<number, number>>({});

  const hovered = useRef(-1);
  const timer = useRef<number | undefined>(undefined);
  const trail = useRef<Array<{ x: number; y: number }>>([]);
  const subRect = useRef<{ rect: DOMRect; side: 'left' | 'right' } | null>(null);
  const buffer = useRef({ text: '', at: 0 });

  // ------------------------------------------------------------ placement
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const next = place({ width: el.offsetWidth, height: el.scrollHeight });
    setSpot(next);
    // Measured once, at open: a menu that re-placed itself as rows changed
    // would move under the pointer that is choosing from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!spot || !panelRef.current || !onPlaced) return;
    onPlaced(panelRef.current.getBoundingClientRect(), spot.side ?? 'right');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // ------------------------------------------------------------------ focus
  const focusRow = useCallback(
    (index: number, tileIndex?: number) => {
      setActive(index);
      if (index < 0) return;
      const entry = entries[index];
      const el = rows.current.get(index);
      if (!el) return;
      if (entry?.kind === 'strip') {
        const current = tileIndex ?? tile[index] ?? entry.items.findIndex((i) => !i.disabled);
        setTile((t) => ({ ...t, [index]: current }));
        el.querySelectorAll<HTMLElement>('[data-tile]')[current]?.focus({ preventScroll: true });
      } else {
        el.focus({ preventScroll: true });
      }
      el.scrollIntoView?.({ block: 'nearest' });
    },
    [entries, tile]
  );

  useEffect(() => {
    if (!spot) return;
    if (custom) {
      if (focusToken) {
        panelRef.current
          ?.querySelector<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])')
          ?.focus({ preventScroll: true });
      }
      return;
    }
    if (focusToken) focusRow(firstIndex(entries));
    else if (depth === 0) panelRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, focusToken]);

  // ---------------------------------------------------------------- submenu
  const openSub = useCallback(
    (index: number, withKeyboard: boolean) => {
      const row = rows.current.get(index);
      const parent = panelRef.current;
      if (!row || !parent) return;
      window.clearTimeout(timer.current);
      setSub((current) =>
        current?.index === index
          ? { ...current, focusToken: withKeyboard ? current.focusToken + 1 : current.focusToken }
          : {
              index,
              row: row.getBoundingClientRect(),
              parent: parent.getBoundingClientRect(),
              focusToken: withKeyboard ? 1 : 0,
            }
      );
    },
    []
  );

  const closeSub = useCallback(() => {
    subRect.current = null;
    setSub(null);
  }, []);

  // --------------------------------------------------------------- activate
  const activate = (index: number) => {
    const entry = entries[index];
    if (!entry || !isNavigable(entry)) return;
    if (entry.kind === 'submenu') {
      openSub(index, true);
      return;
    }
    if (entry.kind === 'strip') {
      const item = entry.items[tile[index] ?? entry.items.findIndex((i) => !i.disabled)];
      if (!item || item.disabled) return;
      closeAll(true);
      item.onSelect();
      return;
    }
    if (entry.kind === 'item') {
      if (entry.keepOpen) {
        entry.onSelect();
        return;
      }
      // Closed first, so a command that opens a dialog is not handed its focus
      // back by a menu unmounting a moment later.
      closeAll(true);
      entry.onSelect();
    }
  };

  // --------------------------------------------------------------- keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Every key stops here. The board binds Delete, Enter, the arrows and
    // single letters on the window, and none of them may reach it through an
    // open menu.
    e.stopPropagation();

    if (custom) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onBack?.();
      }
      return;
    }

    const entry = entries[active];
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRow(stepIndex(entries, active, 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        focusRow(active < 0 ? lastIndex(entries) : stepIndex(entries, active, -1));
        return;
      case 'Home':
        e.preventDefault();
        focusRow(firstIndex(entries));
        return;
      case 'End':
        e.preventDefault();
        focusRow(lastIndex(entries));
        return;
      case 'ArrowRight':
        e.preventDefault();
        if (entry?.kind === 'submenu' && !entry.disabled) openSub(active, true);
        else if (entry?.kind === 'strip') {
          const at = tile[active] ?? 0;
          for (let k = at + 1; k < entry.items.length; k++) {
            if (!entry.items[k].disabled) {
              focusRow(active, k);
              break;
            }
          }
        }
        return;
      case 'ArrowLeft': {
        e.preventDefault();
        if (entry?.kind === 'strip' && (tile[active] ?? 0) > 0) {
          for (let k = (tile[active] ?? 0) - 1; k >= 0; k--) {
            if (!entry.items[k].disabled) {
              focusRow(active, k);
              return;
            }
          }
        }
        onBack?.();
        return;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (active >= 0) activate(active);
        return;
      case 'Escape':
        e.preventDefault();
        if (onBack) onBack();
        else closeAll(true);
        return;
      case 'Tab':
        e.preventDefault();
        closeAll(true);
        return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      const now = performance.now();
      const text = now - buffer.current.at < 700 ? buffer.current.text + e.key : e.key;
      buffer.current = { text, at: now };
      const hit = typeahead(entries, active, text);
      if (hit >= 0) focusRow(hit);
    }
  };

  // ---------------------------------------------------------------- pointer
  const onPointerMove = (e: React.PointerEvent) => {
    const t = trail.current;
    t.push({ x: e.clientX, y: e.clientY });
    if (t.length > 5) t.shift();
  };

  const settleOn = (index: number) => {
    const entry = entries[index];
    if (!entry || !isNavigable(entry)) {
      setActive(-1);
      panelRef.current?.focus({ preventScroll: true });
      if (sub) closeSub();
      return;
    }
    focusRow(index);
    if (entry.kind === 'submenu') {
      if (sub?.index === index) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (hovered.current === index) openSub(index, false);
      }, sub ? 0 : OPEN_DELAY);
    } else if (sub) {
      closeSub();
    }
  };

  const onRowEnter = (index: number, e: React.PointerEvent) => {
    hovered.current = index;
    if (sub && sub.index !== index && subRect.current) {
      const t = trail.current;
      const from = t[0];
      const to = { x: e.clientX, y: e.clientY };
      if (from && aimingAt(from, to, subRect.current.rect, subRect.current.side)) {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          if (hovered.current === index) settleOn(index);
        }, AIM_GRACE);
        return;
      }
    }
    settleOn(index);
  };

  const subEntry = sub ? entries[sub.index] : null;

  const panelStyle: React.CSSProperties = spot
    ? {
        left: spot.x,
        top: spot.y,
        maxHeight: spot.maxHeight,
        transformOrigin: spot.origin,
      }
    : { left: 0, top: 0, visibility: 'hidden' };

  return (
    <>
      <div
        ref={panelRef}
        className={`menu${custom ? ' menu--panel' : ''}${spot ? ' is-placed' : ''}`}
        data-depth={depth}
        role={custom ? 'dialog' : 'menu'}
        aria-label={label}
        aria-orientation={custom ? undefined : 'vertical'}
        tabIndex={-1}
        style={panelStyle}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerEnter={onPointerEnterPanel}
        onPointerLeave={() => {
          hovered.current = -1;
          if (!sub) setActive(-1);
        }}
      >
        {custom
          ? custom(() => closeAll(true))
          : entries.map((entry, index) => {
              switch (entry.kind) {
                case 'separator':
                  return <div key={entry.id} className="menu__rule" role="separator" />;
                case 'heading':
                  return (
                    <div key={entry.id} className="menu__heading" role="presentation">
                      {entry.label}
                    </div>
                  );
                case 'strip':
                  return (
                    <div
                      key={entry.id}
                      ref={(el) => {
                        if (el) rows.current.set(index, el);
                        else rows.current.delete(index);
                      }}
                      className="menu__strip"
                      role="group"
                      aria-label={entry.label}
                      onPointerEnter={(e) => onRowEnter(index, e)}
                    >
                      {entry.items.map((item, k) => (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          tabIndex={-1}
                          data-tile
                          className="menu__tile"
                          data-active={(active === index && (tile[index] ?? -1) === k) || undefined}
                          aria-label={item.label}
                          aria-disabled={item.disabled || undefined}
                          data-tooltip={withShortcut(item.label, item.shortcut)}
                          data-tooltip-pos="top"
                          onPointerEnter={() => {
                            if (!item.disabled) focusRow(index, k);
                          }}
                          onClick={() => {
                            if (item.disabled) return;
                            closeAll(true);
                            item.onSelect();
                          }}
                        >
                          {item.icon}
                        </button>
                      ))}
                    </div>
                  );
                case 'item':
                case 'submenu': {
                  const isSub = entry.kind === 'submenu';
                  const disabled = Boolean(entry.disabled);
                  const checked = entry.kind === 'item' ? entry.checked : undefined;
                  const detail =
                    entry.kind === 'item'
                      ? disabled && entry.disabledReason
                        ? entry.disabledReason
                        : entry.detail
                      : undefined;
                  return (
                    <div
                      key={entry.id}
                      ref={(el) => {
                        if (el) rows.current.set(index, el);
                        else rows.current.delete(index);
                      }}
                      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                      aria-checked={checked}
                      tabIndex={-1}
                      className="menu__row"
                      data-active={active === index || sub?.index === index || undefined}
                      data-danger={(entry.kind === 'item' && entry.danger) || undefined}
                      aria-disabled={disabled || undefined}
                      aria-haspopup={isSub ? (entry.panel ? 'dialog' : 'menu') : undefined}
                      aria-expanded={isSub ? sub?.index === index : undefined}
                      onPointerEnter={(e) => onRowEnter(index, e)}
                      onClick={() => {
                        if (disabled) return;
                        if (isSub) openSub(index, false);
                        else activate(index);
                      }}
                    >
                      {/* A toggle with an icon keeps the icon and carries its
                          state at the end of the row, as a switch-like check,
                          so the rows still read by picture. One without an
                          icon uses the icon column for the check, the way a
                          plain desktop menu does. */}
                      <span className="menu__icon" aria-hidden="true">
                        {checked !== undefined && !entry.icon ? (checked ? <Check size={15} /> : null) : entry.icon}
                      </span>
                      <span className="menu__text">
                        <span className="menu__label">{entry.label}</span>
                        {detail && <span className="menu__detail">{detail}</span>}
                      </span>
                      {entry.kind === 'item' && entry.trailing}
                      {entry.kind === 'item' && entry.shortcut && (
                        <kbd className="menu__key">{menuShortcut(entry.shortcut)}</kbd>
                      )}
                      {checked !== undefined && entry.icon && (
                        <span className="menu__toggle" data-on={checked || undefined} aria-hidden="true">
                          <span className="menu__toggle-dot" />
                        </span>
                      )}
                      {isSub && <ChevronRight size={14} className="menu__chevron" aria-hidden="true" />}
                    </div>
                  );
                }
              }
            })}
      </div>

      {sub && subEntry?.kind === 'submenu' && (
        <MenuPanel
          key={subEntry.id}
          entries={subEntry.entries ?? []}
          custom={subEntry.panel}
          label={subEntry.label}
          depth={depth + 1}
          focusToken={sub.focusToken}
          closeAll={closeAll}
          place={(size) => placeSubmenu(sub.row, sub.parent, size, viewport())}
          onPlaced={(rect, side) => {
            subRect.current = { rect, side };
          }}
          onPointerEnterPanel={() => {
            window.clearTimeout(timer.current);
            hovered.current = sub.index;
            setActive(sub.index);
          }}
          onBack={() => {
            const index = sub.index;
            closeSub();
            focusRow(index);
          }}
        />
      )}
    </>
  );
};
