// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToolLibrary, type ToolEntry } from './ToolLibrary';

afterEach(cleanup);

const entry = (id: string, group: string, extra: Partial<ToolEntry> = {}): ToolEntry => ({
  id,
  group,
  label: id[0].toUpperCase() + id.slice(1),
  description: `The ${id} tool`,
  icon: <svg />,
  run: vi.fn(),
  ...extra,
});

describe('the tool library', () => {
  it('lists every entry under its group, with its key', () => {
    render(
      <ToolLibrary
        label="All tools"
        searchPlaceholder="Search all tools"
        entries={[entry('select', 'Select and move', { shortcut: 'V' }), entry('forces', 'Playful')]}
      />
    );
    expect(screen.getByRole('group', { name: 'Select and move' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Playful' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^Select\. .*Key V$/ })).toBeTruthy();
  });

  it('finds a tool by a word in its description or keywords', () => {
    render(
      <ToolLibrary
        label="All tools"
        searchPlaceholder="Search all tools"
        entries={[entry('forces', 'Playful', { keywords: ['physics'] }), entry('text', 'Create')]}
      />
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'physics' } });
    expect(screen.queryByRole('menuitem', { name: /^Text\./ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /^Forces\./ })).toBeTruthy();
  });

  it('says so when nothing matches', () => {
    render(<ToolLibrary label="Insert" searchPlaceholder="Search what to insert" entries={[entry('image', 'Pictures')]} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByRole('status').textContent).toContain('zzz');
  });

  it('walks the rows with the arrow keys and arms with Enter from the search', () => {
    const first = entry('image', 'Pictures');
    render(<ToolLibrary label="Insert" searchPlaceholder="Search what to insert" entries={[first, entry('audio', 'Pictures')]} />);
    const search = screen.getByRole('searchbox');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^Image\./ }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^Audio\./ }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(first.run).toHaveBeenCalled();
  });

  it('pins a tool with its own seat, and names the seat that carries one without', () => {
    const toggle = vi.fn();
    render(
      <ToolLibrary
        label="All tools"
        searchPlaceholder="Search all tools"
        entries={[
          entry('eraser', 'Draw', { pin: { pinned: false, toggle } }),
          entry('marker', 'Draw', { home: 'in Draw' }),
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Put Eraser on the dock' }));
    expect(toggle).toHaveBeenCalled();
    expect(screen.getByText('in Draw')).toBeTruthy();
  });
});
