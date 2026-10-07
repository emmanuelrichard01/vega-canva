import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECKLIST,
  checklistState,
  detectFromDocument,
  requestGuidedStart,
  takeStartIntent,
  type NodeLike,
} from './tourChecklist';

const ME = 'ada';


/** An in-memory store behind `window.localStorage`, which is where safeStorage looks. */
function installStorage() {
  const map = new Map<string, string>();
  const mem = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  vi.stubGlobal('localStorage', mem);
  vi.stubGlobal('window', { localStorage: mem });
}

beforeEach(() => {
  installStorage();
  checklistState.reload();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectFromDocument', () => {
  const none = new Set<string>();

  it('ticks each document item from the node that proves it', () => {
    const objects: Record<string, NodeLike> = {
      a: { type: 'path', createdBy: ME },
      b: { type: 'sticky', createdBy: ME },
      c: { type: 'connector', createdBy: ME, from: { nodeId: 'x' }, to: { nodeId: 'y' } },
    };
    expect(detectFromDocument(objects, none, ME)).toEqual(['draw', 'sticky', 'connect']);
  });

  it('counts a shape as drawing', () => {
    expect(detectFromDocument({ s: { type: 'shape', createdBy: ME } }, none, ME)).toEqual(['draw']);
  });

  it('does not count a connector with a loose end', () => {
    const loose = { c: { type: 'connector', createdBy: ME, from: { nodeId: 'x' }, to: { nodeId: null } } };
    expect(detectFromDocument(loose, none, ME)).toEqual([]);
  });

  it('ignores what was on the board before watching began', () => {
    // A template's stickies, stamped with your id when the board was seeded.
    const objects = { t1: { type: 'sticky', createdBy: ME }, t2: { type: 'path', createdBy: ME } };
    expect(detectFromDocument(objects, new Set(['t1', 't2']), ME)).toEqual([]);
  });

  it("ignores a collaborator's work", () => {
    expect(detectFromDocument({ b: { type: 'sticky', createdBy: 'bob' } }, none, ME)).toEqual([]);
  });

  it('never ticks the items the document cannot prove', () => {
    const many: Record<string, NodeLike> = {};
    for (let i = 0; i < 50; i++) many[`n${i}`] = { type: i % 2 ? 'text' : 'image', createdBy: ME };
    expect(detectFromDocument(many, none, ME)).toEqual([]);
  });
});

describe('checklistState', () => {
  it('starts empty and open for somebody new', () => {
    expect(checklistState.getSnapshot()).toEqual({ done: [], dismissed: false, collapsed: false });
  });

  it('starts folded for somebody who used the product before it existed', () => {
    localStorage.setItem('vega_tour_v1', 'yes');
    checklistState.reload();
    expect(checklistState.getSnapshot().collapsed).toBe(true);
  });

  it('records progress in checklist order and returns only what is new', () => {
    expect(checklistState.mark(['music', 'draw'])).toEqual(['music', 'draw']);
    expect(checklistState.mark(['draw', 'sticky'])).toEqual(['sticky']);
    expect(checklistState.getSnapshot().done).toEqual(['draw', 'sticky', 'music']);
  });

  it('survives a reload: progress, folding and closing', () => {
    checklistState.mark(['invite']);
    checklistState.collapse();
    checklistState.dismiss();
    checklistState.reload();
    expect(checklistState.getSnapshot()).toEqual({ done: ['invite'], dismissed: true, collapsed: true });
  });

  it('comes back open, with progress kept, when Help reopens it', () => {
    checklistState.mark(['draw']);
    checklistState.dismiss();
    checklistState.reopen();
    expect(checklistState.getSnapshot()).toEqual({ done: ['draw'], dismissed: false, collapsed: false });
  });

  it('knows when it is complete', () => {
    checklistState.mark(CHECKLIST.map((i) => i.id));
    expect(checklistState.isComplete()).toBe(true);
  });

  it('shrugs off storage it did not write', () => {
    localStorage.setItem('vega_get_started_v1', JSON.stringify({ done: ['draw', 'teleport', 7], dismissed: 'yes' }));
    checklistState.reload();
    expect(checklistState.getSnapshot()).toEqual({ done: ['draw'], dismissed: false, collapsed: false });
    localStorage.setItem('vega_get_started_v1', '][');
    checklistState.reload();
    expect(checklistState.getSnapshot().done).toEqual([]);
  });
});

describe('the guided start', () => {
  it('is read once by the board it opens', () => {
    requestGuidedStart();
    expect(takeStartIntent()).toBe('guided');
    expect(takeStartIntent()).toBeNull();
  });

  it('goes stale rather than ambushing a board opened much later', () => {
    requestGuidedStart();
    expect(takeStartIntent(Date.now() + 11 * 60_000)).toBeNull();
  });
});
