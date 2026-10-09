// @vitest-environment jsdom
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Menu } from '../menu/Menu';
import { RailMenuButton } from '../toolbar/RailBase';
import { RailPopover } from '../toolbar/RailPopover';
import { PanelPopover } from '../panel/PanelPopover';
import { FontSelector } from './FontSelector';
import { PORTAL_SURFACE_ATTR } from './portalSurface';

/**
 * The second click on a trigger closes what the first opened — the bug where a
 * ⋯ menu blinked shut on `pointerdown` and its toggle reopened it on `click`.
 * Each press here is the whole gesture a browser sends: pointerdown, then click.
 */

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
// The font list lazy-loads its rows with one.
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;
Element.prototype.scrollIntoView ??= function () {};

afterEach(() => {
  cleanup();
  // Spend any swallow a test left armed.
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

const Pointer = ((globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent) as typeof MouseEvent;

/** The trigger's box, which jsdom leaves at zero. */
const placeAt = (el: Element, left = 100, top = 100, width = 28, height = 28) => {
  el.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
};

/** A real click: pointerdown, then click, at the middle of the element's box. */
function gesture(el: Element) {
  const r = el.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  act(() => void el.dispatchEvent(new Pointer('pointerdown', init)));
  act(() => void el.dispatchEvent(new MouseEvent('click', init)));
}

function pressOnly(el: Element) {
  act(() => void el.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true, button: 0 })));
}

describe('Menu with a toggle trigger', () => {
  const Harness: React.FC<{ onToggle: () => void }> = ({ onToggle }) => {
    const [rect, setRect] = useState<DOMRect | null>(null);
    return (
      <>
        <button
          type="button"
          ref={(el) => {
            if (el) placeAt(el);
          }}
          onClick={(e) => {
            onToggle();
            const r = e.currentTarget.getBoundingClientRect();
            setRect((open) => (open ? null : r));
          }}
        >
          More
        </button>
        <div data-testid="elsewhere">elsewhere</div>
        {rect && (
          <Menu
            label="Actions"
            entries={[{ kind: 'item', id: 'a', label: 'Alpha', onSelect: () => {} }]}
            anchor={{ kind: 'rect', rect }}
            onClose={() => setRect(null)}
          />
        )}
      </>
    );
  };

  it('opens, closes on the second click and stays closed; a third click opens again', () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    const button = screen.getByText('More');

    gesture(button);
    expect(document.querySelector('.menu')).not.toBeNull();

    gesture(button);
    expect(document.querySelector('.menu')).toBeNull();
    // The trigger's click was eaten, so its toggle did not run again.
    expect(onToggle).toHaveBeenCalledTimes(1);

    gesture(button);
    expect(document.querySelector('.menu')).not.toBeNull();
  });

  it('closes on a press anywhere else', () => {
    render(<Harness onToggle={() => {}} />);
    gesture(screen.getByText('More'));
    gesture(screen.getByTestId('elsewhere'));
    expect(document.querySelector('.menu')).toBeNull();
  });

  it('closes on a press on its own trigger when given one, and leaves the rest of the anchor alone', () => {
    const step = vi.fn();
    const Group: React.FC = () => {
      const chevron = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={step}>
            Step
          </button>
          <button type="button" ref={chevron} onClick={() => setOpen((o) => !o)}>
            Chevron
          </button>
          {open && (
            <Menu
              label="Zoom"
              entries={[{ kind: 'item', id: 'a', label: 'Fit', onSelect: () => {} }]}
              anchor={{ kind: 'rect', rect: { left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400 } as DOMRect }}
              trigger={chevron}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
      );
    };
    render(<Group />);
    gesture(screen.getByText('Chevron'));
    expect(document.querySelector('.menu')).not.toBeNull();
    gesture(screen.getByText('Chevron'));
    expect(document.querySelector('.menu')).toBeNull();

    gesture(screen.getByText('Chevron'));
    gesture(screen.getByText('Step'));
    expect(document.querySelector('.menu')).toBeNull();
    expect(step).toHaveBeenCalledTimes(1);
  });
});

describe("the rail's ⋯ (RailMenuButton)", () => {
  it('closes on the second click and opens again on the third', () => {
    render(<RailMenuButton entries={() => [{ kind: 'item', id: 'a', label: 'Alpha', onSelect: () => {} }]} />);
    const button = screen.getByLabelText('More actions');
    placeAt(button);

    gesture(button);
    expect(document.querySelector('.menu')).not.toBeNull();
    gesture(button);
    expect(document.querySelector('.menu')).toBeNull();
    gesture(button);
    expect(document.querySelector('.menu')).not.toBeNull();
  });
});

describe('RailPopover', () => {
  /** A colour picker as the app opens one: portalled to the body, from inside the panel. */
  const NestedPicker: React.FC = () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Pick
        </button>
        {open &&
          createPortal(
            <div {...{ [PORTAL_SURFACE_ATTR]: 'color-picker' }}>
              <button type="button">Swatch</button>
            </div>,
            document.body
          )}
      </>
    );
  };

  it('toggles closed on its trigger, closes outside, and keeps a nested picker inside', () => {
    render(
      <>
        <RailPopover label="Fill" trigger="Fill">
          <NestedPicker />
        </RailPopover>
        <div data-testid="elsewhere" />
      </>
    );
    const trigger = screen.getByLabelText('Fill');

    gesture(trigger);
    expect(document.querySelector('.ctx-popover')).not.toBeNull();
    gesture(trigger);
    expect(document.querySelector('.ctx-popover')).toBeNull();

    gesture(trigger);
    gesture(screen.getByText('Pick'));
    gesture(screen.getByText('Swatch'));
    expect(document.querySelector('.ctx-popover')).not.toBeNull();

    pressOnly(screen.getByTestId('elsewhere'));
    expect(document.querySelector('.ctx-popover')).toBeNull();
  });
});

describe('PanelPopover', () => {
  /** A Select's menu, as a Select inside the popover opens one. */
  const NestedSelect: React.FC = () => {
    const [rect, setRect] = useState<DOMRect | null>(null);
    return (
      <>
        <button type="button" onClick={(e) => setRect(e.currentTarget.getBoundingClientRect())}>
          Choose
        </button>
        {rect && (
          <Menu
            label="Options"
            entries={[{ kind: 'item', id: 'b', label: 'Bravo', keepOpen: true, onSelect: () => {} }]}
            anchor={{ kind: 'rect', rect }}
            onClose={() => setRect(null)}
          />
        )}
      </>
    );
  };

  it('toggles closed on its trigger and treats a nested menu as inside', () => {
    render(
      <>
        <PanelPopover label="Examples" title="Examples" width={300}>
          <NestedSelect />
        </PanelPopover>
        <div data-testid="elsewhere" />
      </>
    );
    const trigger = screen.getByText('Examples');

    gesture(trigger);
    expect(document.querySelector('.pnpop')).not.toBeNull();
    gesture(trigger);
    expect(document.querySelector('.pnpop')).toBeNull();

    gesture(trigger);
    gesture(screen.getByText('Choose'));
    gesture(screen.getByText('Bravo'));
    expect(document.querySelector('.pnpop')).not.toBeNull();

    pressOnly(screen.getByTestId('elsewhere'));
    expect(document.querySelector('.pnpop')).toBeNull();
  });

  it('Escape closes it and hands focus back to the trigger', () => {
    render(<PanelPopover label="Examples" title="Examples" width={300}>content</PanelPopover>);
    const trigger = screen.getByText('Examples');
    gesture(trigger);
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.pnpop')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('FontSelector', () => {
  it('closes on the second click of its trigger and on a press outside', () => {
    render(
      <>
        <FontSelector value="Inter" onChange={() => {}} />
        <div data-testid="elsewhere" />
      </>
    );
    const trigger = document.querySelector<HTMLButtonElement>('.font-select button')!;
    const list = () => document.querySelector(`.font-menu, [${PORTAL_SURFACE_ATTR}="true"]`);

    gesture(trigger);
    expect(list()).not.toBeNull();
    gesture(trigger);
    expect(list()).toBeNull();

    gesture(trigger);
    expect(list()).not.toBeNull();
    pressOnly(screen.getByTestId('elsewhere'));
    expect(list()).toBeNull();
  });
});
