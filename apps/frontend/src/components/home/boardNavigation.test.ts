import { beforeEach, describe, expect, it, vi } from 'vitest';

const listeners: Record<string, Array<() => void>> = {};
const location = { href: '' };
const assigned: string[] = [];
Object.defineProperty(location, 'href', { get: () => assigned[assigned.length - 1] ?? '', set: (v: string) => assigned.push(v) });

vi.stubGlobal('window', {
  location,
  addEventListener: (name: string, fn: () => void) => (listeners[name] ??= []).push(fn),
  document: { querySelectorAll: () => [] },
});
vi.stubGlobal('document', { querySelectorAll: () => [] });

const { goToBoard, isLeaving, resetLeaving } = await import('./boardNavigation');

beforeEach(() => {
  assigned.length = 0;
  resetLeaving();
});

describe('leaving the dashboard for a board', () => {
  it('a double click on Use creates exactly one board', () => {
    goToBoard('/room/aaa');
    goToBoard('/room/bbb');
    expect(assigned).toEqual(['/room/aaa']);
    expect(isLeaving()).toBe(true);
  });

  it('is open again when the page is shown from the back cache', () => {
    goToBoard('/room/aaa');
    listeners.pageshow.forEach((fn) => fn());
    expect(isLeaving()).toBe(false);
    goToBoard('/room/ccc');
    expect(assigned).toEqual(['/room/aaa', '/room/ccc']);
  });
});
