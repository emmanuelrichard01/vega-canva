import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRoomRole,
  setRoomRole,
  getPermissions,
  canEditObjects,
  canPostComments,
  canUseTool,
  isReadOnlyRole,
  resolveInitialRole,
  subscribeRoomRole,
  NON_EDITING_TOOLS,
  COMMENT_TOOLS,
} from './permissions';
import { TOOL_NAMES } from '../tools/toolNames';

describe('view mode', () => {
  beforeEach(() => {
    setRoomRole('editor');
  });

  it('defaults to editor with full editing privileges', () => {
    expect(getRoomRole()).toBe('editor');
    expect(canEditObjects()).toBe(true);
    expect(canPostComments()).toBe(true);
    expect(isReadOnlyRole()).toBe(false);

    const perms = getPermissions('editor');
    expect(perms.canEdit).toBe(true);
    expect(perms.canComment).toBe(true);
    expect(perms.canTransform).toBe(true);
    expect(perms.canDrag).toBe(true);
    expect(perms.canExport).toBe(true);
  });

  it('makes a viewer read-only, but never blocks export', () => {
    // Export reads the board and writes a local file. There is no mode in
    // which withholding it protects anything.
    setRoomRole('viewer');

    expect(canEditObjects()).toBe(false);
    expect(canPostComments()).toBe(false);
    expect(isReadOnlyRole()).toBe(true);

    const perms = getPermissions('viewer');
    expect(perms.canEdit).toBe(false);
    expect(perms.canComment).toBe(false);
    expect(perms.canTransform).toBe(false);
    expect(perms.canDrag).toBe(false);
    expect(perms.canExport).toBe(true);
  });

  it('lets a commenter comment but not edit objects', () => {
    setRoomRole('commenter');

    expect(canEditObjects()).toBe(false);
    expect(canPostComments()).toBe(true);
    expect(isReadOnlyRole()).toBe(false);

    const perms = getPermissions('commenter');
    expect(perms.canEdit).toBe(false);
    expect(perms.canComment).toBe(true);
    expect(perms.canTransform).toBe(false);
  });

  it('notifies subscribers on change, and not on a no-op set', () => {
    const received: string[] = [];
    const unsubscribe = subscribeRoomRole((role) => received.push(role));

    setRoomRole('viewer');
    setRoomRole('viewer');
    setRoomRole('editor');

    expect(received).toEqual(['viewer', 'editor']);
    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    const received: string[] = [];
    subscribeRoomRole((role) => received.push(role))();

    setRoomRole('viewer');

    expect(received).toEqual([]);
  });
});

describe('resolveInitialRole', () => {
  it('reads the spellings the share dialog and a person might each produce', () => {
    for (const query of ['?role=viewer', '?role=view', '?role=readonly', '?permission=viewer']) {
      expect(resolveInitialRole(query), query).toBe('viewer');
    }
    for (const query of ['?role=commenter', '?role=comment', '?permission=comment']) {
      expect(resolveInitialRole(query), query).toBe('commenter');
    }
  });

  it('is case-insensitive', () => {
    expect(resolveInitialRole('?role=VIEWER')).toBe('viewer');
  });

  it('falls back to editor for nothing, junk, or an unknown role', () => {
    for (const query of ['', '?', '?role=', '?role=admin', '?other=viewer']) {
      expect(resolveInitialRole(query), JSON.stringify(query)).toBe('editor');
    }
  });
});

describe('canUseTool', () => {
  it('gives an editor every tool the dock knows about', () => {
    for (const id of Object.keys(TOOL_NAMES)) {
      expect(canUseTool(id, 'editor'), id).toBe(true);
    }
  });

  it('leaves a viewer only the tools that move the view, not the document', () => {
    expect(canUseTool('select', 'viewer')).toBe(true);
    expect(canUseTool('hand', 'viewer')).toBe(true);

    for (const id of Object.keys(TOOL_NAMES)) {
      if (NON_EDITING_TOOLS.has(id)) continue;
      expect(canUseTool(id, 'viewer'), id).toBe(false);
    }
  });

  it('adds exactly the comment tool for a commenter', () => {
    expect(canUseTool('comment', 'commenter')).toBe(true);
    expect(canUseTool('comment', 'viewer')).toBe(false);

    for (const id of Object.keys(TOOL_NAMES)) {
      if (NON_EDITING_TOOLS.has(id) || COMMENT_TOOLS.has(id)) continue;
      expect(canUseTool(id, 'commenter'), id).toBe(false);
    }
  });

  it('refuses a tool it has never heard of', () => {
    /**
     * The allow-list is the point. A drawing tool added next year is an edit
     * until somebody says otherwise -- a deny-list would have permitted it
     * silently, in the mode named for not permitting it, and nothing would
     * have failed to say so.
     */
    expect(canUseTool('some-tool-invented-later', 'viewer')).toBe(false);
    expect(canUseTool('some-tool-invented-later', 'commenter')).toBe(false);
    expect(canUseTool('some-tool-invented-later', 'editor')).toBe(true);
  });

  it('reads the ambient role when none is passed', () => {
    setRoomRole('viewer');
    expect(canUseTool('sticky')).toBe(false);
    setRoomRole('editor');
    expect(canUseTool('sticky')).toBe(true);
  });
});
