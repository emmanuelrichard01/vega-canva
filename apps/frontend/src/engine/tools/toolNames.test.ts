import { describe, it, expect } from 'vitest';
import { TOOL_NAMES } from './toolNames';
import { TOOL_SHORTCUTS } from './shortcuts';

describe('TOOL_NAMES', () => {
  it('names every tool that has a shortcut', () => {
    // The help screen renders `TOOL_NAMES[id] ?? id`, which fails quietly: a
    // tool added to TOOL_SHORTCUTS and forgotten here appears on the one
    // screen people read when they are lost, under its internal id.
    const unnamed = Object.keys(TOOL_SHORTCUTS).filter((id) => !TOOL_NAMES[id]);
    expect(unnamed).toEqual([]);
  });

  it('does not name a tool that has no shortcut to advertise', () => {
    const orphans = Object.keys(TOOL_NAMES).filter((id) => !TOOL_SHORTCUTS[id]);
    expect(orphans).toEqual([]);
  });

  it('gives each tool a distinct key', () => {
    const keys = Object.values(TOOL_SHORTCUTS).map((k) => k.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });
});
