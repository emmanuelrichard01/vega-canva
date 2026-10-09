import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const states = new Map<number, Record<string, unknown>>();
const local: Record<string, unknown> = {};

vi.mock('../document', () => ({
  provider: {
    awareness: {
      clientID: 1,
      getLocalState: () => local,
      setLocalState: (next: Record<string, unknown>) => {
        for (const key of Object.keys(local)) delete local[key];
        Object.assign(local, next);
        states.set(1, { ...local });
      },
      setLocalStateField: (key: string, value: unknown) => {
        local[key] = value;
      },
      getStates: () => states,
      on: () => {},
      off: () => {},
    },
  },
}));

import { CHAT_LINGER_MS, presenceManager } from './PresenceManager';
import { CHAT_MAX_CHARS, readChat, readCollaborators, rosterSignature } from './collaborators';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});

afterEach(() => {
  presenceManager.clearChat();
  vi.runAllTimers();
  vi.useRealTimers();
});

describe('cursor chat, as written', () => {
  it('broadcasts the line while it is being typed, marked open', () => {
    presenceManager.updateChat('hel', true);
    vi.runAllTimers();
    expect(local.chat).toMatchObject({ text: 'hel', open: true });
  });

  it('keeps a sent line up, then clears it after it has lingered', () => {
    presenceManager.updateChat('ship it', false);
    vi.advanceTimersByTime(100);
    expect(local.chat).toMatchObject({ text: 'ship it', open: false });
    vi.advanceTimersByTime(CHAT_LINGER_MS);
    expect(local.chat).toBeNull();
  });

  it('clears at once when cancelled', () => {
    presenceManager.updateChat('never mind', true);
    presenceManager.clearChat();
    vi.runAllTimers();
    expect(local.chat).toBeNull();
  });

  it('does not let an earlier send clear a newer line', () => {
    presenceManager.updateChat('first', false);
    vi.advanceTimersByTime(CHAT_LINGER_MS - 100);
    presenceManager.updateChat('second', true);
    vi.advanceTimersByTime(500);
    expect(local.chat).toMatchObject({ text: 'second', open: true });
  });

  it('cuts a long line to the limit', () => {
    presenceManager.updateChat('x'.repeat(500), false);
    vi.advanceTimersByTime(100);
    expect((local.chat as { text: string }).text.length).toBe(CHAT_MAX_CHARS);
  });
});

describe('cursor chat, as read from a peer', () => {
  it('drops control characters and caps length, whatever the peer sent', () => {
    const chat = readChat({ text: 'a\u0000b\u001bc' + 'z'.repeat(300), open: false, at: 5 });
    expect(chat?.text.startsWith('a b c')).toBe(true);
    expect(chat?.text.length).toBe(CHAT_MAX_CHARS);
  });

  it('ignores anything that is not a chat', () => {
    expect(readChat(null)).toBeNull();
    expect(readChat('hi')).toBeNull();
    expect(readChat({ text: 42 })).toBeNull();
    expect(readChat({ text: '   ', open: false })).toBeNull();
  });

  it('keeps an empty bubble while it is still open, so the caret shows', () => {
    expect(readChat({ text: '', open: true, at: 1 })).toEqual({ text: '', open: true, at: 1 });
  });

  it('re-renders the roster when a chat line changes, not when a pointer moves', () => {
    const peer = (chat: unknown, cursor: { x: number; y: number }) =>
      new Map([[2, { user: { name: 'Ana', color: '#22C55E' }, cursor, chat }]]);
    const a = rosterSignature(readCollaborators(peer(null, { x: 0, y: 0 }), 1));
    const moved = rosterSignature(readCollaborators(peer(null, { x: 50, y: 9 }), 1));
    const said = rosterSignature(readCollaborators(peer({ text: 'hi', open: true }, { x: 0, y: 0 }), 1));
    expect(moved).toBe(a);
    expect(said).not.toBe(a);
  });
});

describe('roster signature and reactions', () => {
  it('changes when the same emoji is sent again, so a repeat shows', () => {
    const peer = (timestamp: number) =>
      new Map([[2, { user: { name: 'Ana', color: '#22C55E' }, cursor: { x: 0, y: 0 }, reaction: { emoji: '🎉', timestamp } }]]);
    const first = rosterSignature(readCollaborators(peer(1000), 1));
    const again = rosterSignature(readCollaborators(peer(2000), 1));
    expect(again).not.toBe(first);
  });
});

describe('awareness payload', () => {
  it('stays small with every field at its largest', () => {
    presenceManager.updateCursor(123456.789, -98765.4321);
    presenceManager.updateViewport({ x: -12345.6, y: 6543.21, width: 2560, height: 1440, zoom: 3.75 });
    presenceManager.updateSelection(Array.from({ length: 20 }, (_, i) => `node_${i}_abcdefghij`));
    presenceManager.updateTool('shape-hexagon');
    presenceManager.updateChat('y'.repeat(CHAT_MAX_CHARS), true);
    vi.runAllTimers();
    const bytes = new TextEncoder().encode(JSON.stringify(local)).length;
    // Broadcast to every peer at up to 15Hz: under 1.5KB keeps a 50-person
    // room well inside a WebSocket's comfort zone.
    expect(bytes).toBeLessThan(1500);
  });
});
