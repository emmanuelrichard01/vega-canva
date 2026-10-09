// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const device = vi.hoisted(() => ({ phone: false }));
vi.mock('./usePhone', () => ({
  usePhone: () => device.phone,
  useDeviceClass: () => (device.phone ? 'phone' : 'desktop'),
}));

import { ToolWorkspace } from './ToolWorkspace';
import { BoardColumn } from './WorkspaceShell';

vi.setConfig({ testTimeout: 20000 });

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  device.phone = false;
});

const column = (open: boolean, onClose = () => {}) => (
  <BoardColumn
    side="right"
    open={open}
    onPin={() => {}}
    onClose={onClose}
    panelLabel="People and properties"
    pillLabel="People"
    sheetLabel="Properties"
    region={3}
    panelClassName="context-inspector panel-surface"
    pill={() => <span>pill</span>}
  >
    <p>panel body</p>
  </BoardColumn>
);

describe('the desktop shell is untouched', () => {
  it('renders the dock, not the phone bar', () => {
    render(<ToolWorkspace activeToolId="select" />);
    expect(document.querySelector('.tool-dock')).not.toBeNull();
    expect(document.querySelector('.phone-bar')).toBeNull();
    expect(document.querySelector('[data-seat="select"]')).not.toBeNull();
  });

  it('keeps an open column a column, with no sheet', () => {
    render(column(true));
    expect(document.querySelector('aside.context-inspector')?.textContent).toContain('panel body');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the phone shell', () => {
  it('replaces the dock with six seats and More', () => {
    device.phone = true;
    render(<ToolWorkspace activeToolId="sticky" />);
    expect(document.querySelector('[data-seat]')).toBeNull();
    const seats = Array.from(document.querySelectorAll<HTMLButtonElement>('.phone-bar__seat'));
    expect(seats.map((b) => b.getAttribute('aria-label'))).toEqual(['Select', 'Draw', 'Note', 'Shape', 'Text', 'Connect', 'All tools']);
    expect(seats[2].getAttribute('aria-pressed')).toBe('true');
  });

  it('arms a tool from the bar and from More', () => {
    device.phone = true;
    const armed: string[] = [];
    const listen = (e: Event) => armed.push((e as CustomEvent<string>).detail);
    window.addEventListener('legacy_tool_change', listen);
    render(<ToolWorkspace activeToolId="select" />);
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    fireEvent.click(screen.getByRole('button', { name: 'All tools' }));
    fireEvent.click(screen.getByRole('button', { name: /Table/ }));
    window.removeEventListener('legacy_tool_change', listen);
    expect(armed).toEqual(['text', 'table']);
  });

  it('shows an open column as a sheet over the board, with the pill kept', () => {
    device.phone = true;
    render(column(true));
    expect(document.querySelector('.board-pill--right')?.textContent).toBe('pill');
    expect(document.querySelector('aside.context-inspector')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Properties' }).textContent).toContain('panel body');
  });
});
