// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLOATING_CHILD_ATTR, SWALLOW_MS, listenOutsidePress } from './outsidePress';
import { PORTAL_SURFACE_ATTR } from './portalSurface';

const Pointer = ((globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent) as typeof MouseEvent;
const press = (el: Element, init: MouseEventInit = {}) =>
  el.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true, button: 0, ...init }));
const click = (el: Element, init: MouseEventInit = {}) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

let surface: HTMLDivElement;
let trigger: HTMLButtonElement;
let elsewhere: HTMLDivElement;
let stop: (() => void) | null = null;

const add = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
};

beforeEach(() => {
  surface = add('div');
  surface.appendChild(document.createElement('span'));
  trigger = add('button');
  trigger.appendChild(document.createElement('span'));
  elsewhere = add('div');
});

afterEach(() => {
  stop?.();
  stop = null;
  // Fire one click past any swallow still armed, so tests do not leak into each other.
  click(document.body);
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('listenOutsidePress', () => {
  it('ignores a press inside a surface and closes on one outside', () => {
    const onOutside = vi.fn();
    stop = listenOutsidePress({ surfaces: [surface], onOutside });
    press(surface.firstElementChild!);
    expect(onOutside).not.toHaveBeenCalled();
    press(elsewhere);
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it('accepts refs and a getter for the surfaces', () => {
    const onOutside = vi.fn();
    stop = listenOutsidePress({ surfaces: () => [surface], onOutside });
    press(surface);
    const stop2 = listenOutsidePress({ surfaces: [{ current: surface }], onOutside });
    press(surface);
    stop2();
    expect(onOutside).not.toHaveBeenCalled();
  });

  it('leaves a press on a toggle trigger to the trigger', () => {
    const onOutside = vi.fn();
    const onClick = vi.fn();
    trigger.addEventListener('click', onClick);
    stop = listenOutsidePress({ surfaces: [surface], triggers: { current: trigger }, onOutside });
    press(trigger.firstElementChild!);
    click(trigger.firstElementChild!);
    expect(onOutside).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("closes on a 'close' trigger and swallows the click that completes the gesture", () => {
    const onOutside = vi.fn();
    const onClick = vi.fn();
    trigger.addEventListener('click', onClick);
    stop = listenOutsidePress({ surfaces: [surface], triggers: trigger, trigger: 'close', onOutside });
    press(trigger);
    expect(onOutside).toHaveBeenCalledTimes(1);
    click(trigger);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('treats a press inside the trigger rect as the trigger: close, then swallow exactly one click', () => {
    const onOutside = vi.fn();
    const onClick = vi.fn();
    trigger.addEventListener('click', onClick);
    stop = listenOutsidePress({ surfaces: [surface], triggers: rect(100, 100, 30, 30), onOutside });
    press(elsewhere, { clientX: 115, clientY: 115 });
    expect(onOutside).toHaveBeenCalledTimes(1);

    const swallowed = new MouseEvent('click', { bubbles: true, cancelable: true });
    trigger.dispatchEvent(swallowed);
    expect(onClick).not.toHaveBeenCalled();
    expect(swallowed.defaultPrevented).toBe(true);

    click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a press outside the trigger rect is a plain outside press, with nothing swallowed', () => {
    const onOutside = vi.fn();
    const onClick = vi.fn();
    elsewhere.addEventListener('click', onClick);
    stop = listenOutsidePress({ surfaces: [surface], triggers: rect(100, 100, 30, 30), onOutside });
    press(elsewhere, { clientX: 300, clientY: 300 });
    click(elsewhere);
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a right-click on the trigger closes without arming a swallow', () => {
    const onOutside = vi.fn();
    const onClick = vi.fn();
    elsewhere.addEventListener('click', onClick);
    stop = listenOutsidePress({ surfaces: [surface], triggers: rect(100, 100, 30, 30), onOutside });
    press(elsewhere, { clientX: 110, clientY: 110, button: 2 });
    expect(onOutside).toHaveBeenCalledTimes(1);
    click(elsewhere);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('drops the swallow if the click never comes', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    elsewhere.addEventListener('click', onClick);
    stop = listenOutsidePress({ surfaces: [surface], triggers: rect(0, 0, 50, 50), onOutside: () => {} });
    press(elsewhere, { clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(SWALLOW_MS + 1);
    click(elsewhere);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('the swallow outlives the listener that armed it (closing unmounts the menu)', () => {
    const onClick = vi.fn();
    trigger.addEventListener('click', onClick);
    const off = listenOutsidePress({ surfaces: [surface], triggers: trigger, trigger: 'close', onOutside: () => off() });
    press(trigger);
    click(trigger);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('a floating child opened after it is inside; a surface already open (its parent) is not', () => {
    const parent = add('div', { [PORTAL_SURFACE_ATTR]: '' });
    const onOutside = vi.fn();
    stop = listenOutsidePress({ surfaces: [surface], onOutside });

    const picker = add('div', { [PORTAL_SURFACE_ATTR]: 'color-picker' });
    picker.appendChild(document.createElement('button'));
    const menu = add('div', { [FLOATING_CHILD_ATTR]: '' });
    press(picker.firstElementChild!);
    press(menu);
    expect(onOutside).not.toHaveBeenCalled();

    press(parent);
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it('stops listening when disposed', () => {
    const onOutside = vi.fn();
    listenOutsidePress({ surfaces: [surface], onOutside })();
    press(elsewhere);
    expect(onOutside).not.toHaveBeenCalled();
  });

  it('reads a getter on every press, so the latest callback runs', () => {
    const first = vi.fn();
    const second = vi.fn();
    let current = first;
    stop = listenOutsidePress(() => ({ surfaces: [surface], onOutside: current }));
    current = second;
    press(elsewhere);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
