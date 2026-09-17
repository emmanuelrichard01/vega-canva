import React from 'react';
import { motion } from 'framer-motion';
import { RailPopoverGroup, RailSideContext } from './railSide';
import { HANG, ENTRY } from './railConstants';
import type { RailSide } from '../../engine/interaction/railPlacement';
import { Slider } from '../ui/Slider';
import { Ellipsis } from 'lucide-react';
import { Menu } from '../menu/Menu';
import type { MenuEntry } from '../menu/menuModel';

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

/** The rail's own controls, in order, leaving out anything inside an open popover. */
function railControls(rail: HTMLElement): HTMLElement[] {
  return Array.from(rail.querySelectorAll<HTMLElement>('.ctx-btn')).filter(
    (el) => !el.closest('.ctx-popover') && !(el as HTMLButtonElement).disabled
  );
}

/**
 * The floating rail.
 *
 * ## A toolbar the keyboard can use
 *
 * It was a row of buttons with nothing saying so: no `role`, no name, and the
 * only way along it was Tab through thirty stops. It is announced as a toolbar
 * now, named for what it acts on, and moves the way toolbars move — Left and
 * Right between controls, Home and End to the ends. Alt+F10, the long-standing
 * "go to the toolbar" key in editors, puts the keyboard on it from the board.
 */
export const Rail = React.forwardRef<
  HTMLDivElement,
  {
    id: string;
    placement: RailSide;
    clear?: boolean;
    anchorRef: React.RefObject<HTMLDivElement | null>;
    /** What the rail acts on, for assistive tech: "Rectangle", "3 objects". */
    label?: string;
    children: React.ReactNode;
  }
>(({ id, placement, clear = true, anchorRef, label = 'Selection', children }, railRef) => {
  const own = React.useRef<HTMLDivElement | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const group = React.useMemo(() => ({ openId, setOpenId }), [openId]);
  // A different subject is a different rail: nothing it had open carries over.
  React.useEffect(() => setOpenId(null), [id]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F10' || !e.altKey || e.ctrlKey || e.metaKey) return;
      const rail = own.current;
      if (!rail) return;
      e.preventDefault();
      railControls(rail)[0]?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Keys inside a popover belong to the popover's own controls.
    if (target.closest('.ctx-popover') || !target.classList.contains('ctx-btn')) return;
    const controls = railControls(e.currentTarget);
    const at = controls.indexOf(target);
    if (at < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (at + 1) % controls.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + controls.length) % controls.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = controls.length - 1;
    if (next < 0) return;
    e.preventDefault();
    // The board nudges the selection on arrow keys; moving along the rail must
    // not also move the object it is describing.
    e.stopPropagation();
    controls[next].focus();
  };

  return (
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
            ref={(el) => {
              own.current = el;
              if (typeof railRef === 'function') railRef(el);
              else if (railRef) railRef.current = el;
            }}
            className={`ctx-toolbar${clear ? '' : ' ctx-toolbar--veiled'}`}
            data-side={placement}
            role="toolbar"
            aria-label={`${label} tools`}
            aria-orientation="horizontal"
            onKeyDown={onKeyDown}
            style={{ position: 'relative', pointerEvents: 'auto' }}
          >
            <RailSideContext.Provider value={placement === 'top' ? 'top' : 'bottom'}>
              <RailPopoverGroup.Provider value={group}>{children}</RailPopoverGroup.Provider>
            </RailSideContext.Provider>
          </div>
        </motion.div>
      </div>
    </div>
  );
});
Rail.displayName = 'Rail';

/**
 * The rail's `⋯`: the right-click menu, opened from the rail.
 *
 * Not a second, shorter list. It used to be one — flip, restack, lock,
 * flatten, outline, delete — which had drifted from the context menu in both
 * directions, so Group and Copy as PNG were only reachable by right-clicking
 * and Flip only from here. FigJam's contextual toolbar makes the same choice:
 * its overflow *is* the context menu.
 */
export const RailMenuButton: React.FC<{
  label?: string;
  /** Built when opened, so the rail does not build a menu on every frame it moves. */
  entries: () => MenuEntry[];
  /** What the button shows. The overflow's ellipsis unless it is a named picker. */
  trigger?: React.ReactNode;
}> = ({ label = 'More actions', entries, trigger }) => {
  const [open, setOpen] = React.useState<{ rect: DOMRect; keyboard: boolean } | null>(null);
  const side = React.useContext(RailSideContext);
  /**
   * The menu closes itself on any outside pointerdown, in the capture phase —
   * which includes a press on this button. Without remembering that, the click
   * that follows would open it again, and the button could never close its menu.
   */
  const swallowClick = React.useRef(false);
  return (
    <>
      <button
        type="button"
        className="ctx-btn"
        data-tooltip={open ? undefined : label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        onPointerDown={() => {
          if (open) swallowClick.current = true;
        }}
        onClick={(e) => {
          if (swallowClick.current) {
            swallowClick.current = false;
            return;
          }
          setOpen({ rect: e.currentTarget.getBoundingClientRect(), keyboard: e.detail === 0 });
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            setOpen({ rect: e.currentTarget.getBoundingClientRect(), keyboard: true });
          }
        }}
      >
        {trigger ?? <Ellipsis size={16} />}
      </button>
      {open && (
        <Menu
          label={label}
          entries={entries()}
          anchor={{ kind: 'rect', rect: open.rect, prefer: side === 'top' ? 'above' : 'below' }}
          focusFirst={open.keyboard}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
};

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
  /*
    The shared slider, rather than a bare range with its own caption row.

    It was a two-part control — a label-and-value row above a native input —
    which is the same information the primitive lays out in one line, and a
    native input is the thing that does not follow the theme, the focus ring or
    the other platforms. Coming through `Slider` also brings the fine-step
    modifier and the typable readout, which a popover full of numbers wants at
    least as much as the panel does.
  */
  <Slider
    label={label}
    value={value}
    min={min}
    max={max}
    step={step}
    unit={suffix}
    onChange={onChange}
  />
);
