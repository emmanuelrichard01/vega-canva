import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { useRoomShortcuts, type RoomShortcutsOptions } from './useRoomShortcuts';
import { TOOL_FOR_KEY } from '../engine/tools/shortcuts';
import { undoManager } from '../engine/document';
import { editor } from '../engine/api/EditorAPI';
import { cameraSystem } from '../engine/CameraSystem';

class FakeHTMLInputElement {}
class FakeHTMLTextAreaElement {}

describe('useRoomShortcuts', () => {
  let options: RoomShortcutsOptions;
  let listeners: Record<string, ((e: any) => void)[]> = {};

  beforeEach(() => {
    listeners = {};

    (globalThis as any).HTMLInputElement = FakeHTMLInputElement;
    (globalThis as any).HTMLTextAreaElement = FakeHTMLTextAreaElement;

    const mockWindow = {
      innerWidth: 1024,
      innerHeight: 768,
      location: { hostname: 'localhost', protocol: 'http:', pathname: '/room/test' },
      addEventListener: vi.fn((event: string, cb: (e: any) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      }),
      removeEventListener: vi.fn((event: string, cb: (e: any) => void) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((fn) => fn !== cb);
        }
      }),
      dispatchEvent: vi.fn((event: any) => {
        const cbs = listeners[event.type] || [];
        cbs.forEach((cb) => cb(event));
        return true;
      }),
    };

    (globalThis as any).window = mockWindow;
    (globalThis as any).document = {
      activeElement: { tagName: 'BODY' },
    };

    // Set mock React dispatcher for React 18 & 19
    const mockDispatcher = {
      useEffect: (effect: () => any) => {
        effect();
      },
    };

    const clientInternals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    if (clientInternals) {
      clientInternals.H = mockDispatcher;
    }

    const secretInternals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    if (secretInternals?.ReactCurrentDispatcher) {
      secretInternals.ReactCurrentDispatcher.current = mockDispatcher;
    }

    options = {
      selectTool: vi.fn(),
      setSelectedIds: vi.fn(),
      setShowCommandPalette: vi.fn(),
      setShowHelp: vi.fn(),
      setIsUiVisible: vi.fn(),
      isCompact: false,
      panelsOpen: false,
      setPanelsOpen: vi.fn(),
      activeTool: 'select',
      setActiveTool: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fireKeyDown = (init: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    target?: any;
  }) => {
    const event = {
      type: 'keydown',
      key: init.key,
      ctrlKey: Boolean(init.ctrlKey),
      metaKey: Boolean(init.metaKey),
      altKey: Boolean(init.altKey),
      shiftKey: Boolean(init.shiftKey),
      target: init.target || { tagName: 'BODY' },
      defaultPrevented: false,
      preventDefault: vi.fn(),
    };
    const cbs = listeners['keydown'] || [];
    cbs.forEach((cb) => cb(event));
    // Returned so a test can assert on what the handler did to the event
    // itself, not only on what it called.
    return event;
  };

  it('binds listeners for keydown and legacy_tool_change', () => {
    useRoomShortcuts(options);

    expect(listeners['keydown']?.length).toBeGreaterThan(0);
    expect(listeners['legacy_tool_change']?.length).toBeGreaterThan(0);
  });

  it('triggers tool activation for all registered hotkeys in TOOL_FOR_KEY', () => {
    useRoomShortcuts(options);

    for (const [key, expectedTool] of Object.entries(TOOL_FOR_KEY)) {
      fireKeyDown({ key });
      expect(options.selectTool).toHaveBeenCalledWith(expectedTool);
    }
  });

  it('triggers Redo on Ctrl+Y and Cmd+Shift+Z', () => {
    const redoSpy = vi.spyOn(undoManager, 'redo').mockImplementation(() => null);
    useRoomShortcuts(options);

    fireKeyDown({ key: 'y', ctrlKey: true });
    expect(redoSpy).toHaveBeenCalledTimes(1);

    fireKeyDown({ key: 'z', metaKey: true, shiftKey: true });
    expect(redoSpy).toHaveBeenCalledTimes(2);
  });

  it('triggers Zoom In/Out on +/- with and without modifiers', () => {
    const zoomSpy = vi.spyOn(cameraSystem, 'zoomAt').mockImplementation(() => {});
    useRoomShortcuts(options);

    fireKeyDown({ key: '+', metaKey: true });
    expect(zoomSpy).toHaveBeenCalledWith(1, 512, 384);

    fireKeyDown({ key: '-', metaKey: true });
    expect(zoomSpy).toHaveBeenCalledWith(-1, 512, 384);

    fireKeyDown({ key: '+' });
    expect(zoomSpy).toHaveBeenCalledWith(1, 512, 384);

    fireKeyDown({ key: '-' });
    expect(zoomSpy).toHaveBeenCalledWith(-1, 512, 384);
  });

  it('triggers Zoom to Fit on Cmd+1 and !', () => {
    const fitSpy = vi.spyOn(editor, 'zoomToFit').mockImplementation(() => {});
    useRoomShortcuts(options);

    fireKeyDown({ key: '1', metaKey: true });
    expect(fitSpy).toHaveBeenCalledTimes(1);

    fireKeyDown({ key: '!' });
    expect(fitSpy).toHaveBeenCalledTimes(2);
  });

  it('ignores tool hotkeys when modifier keys (ctrl, meta, alt) are held', () => {
    useRoomShortcuts(options);

    fireKeyDown({ key: 's', ctrlKey: true });
    fireKeyDown({ key: 's', metaKey: true });
    fireKeyDown({ key: 's', altKey: true });

    expect(options.selectTool).not.toHaveBeenCalled();
  });

  it('opens help modal on "?" key', () => {
    useRoomShortcuts(options);

    fireKeyDown({ key: '?' });
    expect(options.setShowHelp).toHaveBeenCalledWith(true);
  });

  it('toggles command palette on Cmd+K', () => {
    useRoomShortcuts(options);

    fireKeyDown({ key: 'k', metaKey: true });
    expect(options.setShowCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('leaves Cmd+P to the browser', () => {
    // Print. Taking it opened a command list on the one shortcut every
    // operating system agrees about.
    useRoomShortcuts(options);

    const event = fireKeyDown({ key: 'p', metaKey: true });

    expect(options.setShowCommandPalette).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('closes panels on Escape when in compact mode with panels open', () => {
    options.isCompact = true;
    options.panelsOpen = true;
    useRoomShortcuts(options);

    fireKeyDown({ key: 'Escape' });
    expect(options.setPanelsOpen).toHaveBeenCalledWith(false);
  });

  it('exits force tool mode on Escape', () => {
    options.activeTool = 'magnet';
    useRoomShortcuts(options);

    fireKeyDown({ key: 'Escape' });
    expect(options.setActiveTool).toHaveBeenCalledWith('select');
  });

  it('pans camera on arrow keys when no objects are selected', () => {
    const panSpy = vi.spyOn(cameraSystem, 'panBy').mockImplementation(() => {});
    options.selectedIds = [];
    useRoomShortcuts(options);

    fireKeyDown({ key: 'ArrowRight' });
    expect(panSpy).toHaveBeenCalled();
  });

  it('does not pan camera on arrow keys when objects are selected', () => {
    const panSpy = vi.spyOn(cameraSystem, 'panBy').mockImplementation(() => {});
    options.selectedIds = ['node-1'];
    useRoomShortcuts(options);

    fireKeyDown({ key: 'ArrowRight' });
    expect(panSpy).not.toHaveBeenCalled();
  });

  it('does not fire shortcuts when typing inside input element', () => {
    useRoomShortcuts(options);

    const inputTarget = new FakeHTMLInputElement();
    fireKeyDown({ key: 'v', target: inputTarget });

    expect(options.selectTool).not.toHaveBeenCalled();
  });
});
