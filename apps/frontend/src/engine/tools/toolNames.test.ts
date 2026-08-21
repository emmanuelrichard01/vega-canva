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

/**
 * Nothing outside the tool map may claim a bare letter a tool already owns.
 *
 * The trap this closes: `F` fits the board to its contents *inside the radar*
 * and arms the Frame tool everywhere else. That one is legitimate -- the radar
 * is a focus scope of its own and the help screen says so -- but it is one
 * inattentive commit away from being bound globally, at which point the Frame
 * tool quietly stops working and nothing fails.
 *
 * Global single-key commands are listed here so adding one that collides is a
 * failing test rather than a bug report.
 */
describe('global single-key commands', () => {
  /** Keys `Room` handles itself, outside `TOOL_FOR_KEY`. */
  const GLOBAL_KEYS = ['?', '\\', '0', '!'];

  it('never claims a letter a tool already has', () => {
    const toolKeys = new Set(Object.values(TOOL_SHORTCUTS).map((k) => k.toLowerCase()));
    for (const key of GLOBAL_KEYS) {
      expect(toolKeys.has(key.toLowerCase()), `"${key}" is bound twice`).toBe(false);
    }
  });
});
