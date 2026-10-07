import { describe, expect, it } from 'vitest';
import { editorKeyIntent, type EditorKeyEvent } from './nodeEditorKeys';

const key = (k: string, extra: Partial<EditorKeyEvent> = {}): EditorKeyEvent => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...extra,
});
const sticky = { sticky: true, formattable: false };
const text = { sticky: false, formattable: true };

describe('editorKeyIntent', () => {
  it('chains stickies with Tab, Shift+Tab and Cmd+Enter', () => {
    expect(editorKeyIntent(key('Tab'), sticky)).toEqual({ kind: 'chain', direction: 'right' });
    expect(editorKeyIntent(key('Tab', { shiftKey: true }), sticky)).toEqual({ kind: 'chain', direction: 'down' });
    expect(editorKeyIntent(key('Enter', { metaKey: true }), sticky)).toEqual({ kind: 'chain', direction: 'right' });
  });

  it('leaves Tab alone outside stickies and only finishes on Cmd+Enter', () => {
    expect(editorKeyIntent(key('Tab'), text)).toBeNull();
    expect(editorKeyIntent(key('Enter', { ctrlKey: true }), text)).toEqual({ kind: 'finish' });
  });

  it('ignores every chord while an IME composition is open', () => {
    expect(editorKeyIntent(key('Tab', { isComposing: true }), sticky)).toBeNull();
    expect(editorKeyIntent(key('Enter', { metaKey: true, isComposing: true }), sticky)).toBeNull();
    expect(editorKeyIntent(key('Escape', { isComposing: true }), sticky)).toBeNull();
  });

  it('cancels on Escape and formats on the familiar chords', () => {
    expect(editorKeyIntent(key('Escape'), text)).toEqual({ kind: 'cancel' });
    expect(editorKeyIntent(key('b', { metaKey: true }), text)).toEqual({ kind: 'format', command: 'bold' });
    expect(editorKeyIntent(key('b', { metaKey: true }), sticky)).toBeNull();
  });
});
