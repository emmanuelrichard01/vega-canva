import React, { useCallback, useEffect, useRef, useState } from 'react';
import { provider } from '../document';
import { keyBelongsToFocus } from '../interaction/keyTarget';
import { chipColorsFor } from '../cursor/remoteCursor';
import { CHAT_MAX_CHARS } from './collaborators';
import { presenceManager } from './PresenceManager';

/**
 * Cursor chat: press `/` over the board, type, and the line floats beside your
 * pointer for everyone in the room.
 *
 * Awareness only, never the document, so it costs nothing to keep and leaves
 * no trace. Every keystroke rides the presence throttle, so others watch it
 * being written. Enter sends (it stays up for a few seconds), Escape cancels,
 * and clicking away sends what is there. Works for every role, since it writes
 * nothing anyone could undo.
 *
 * The bubble follows the pointer from `pointermove`, a frame behind the OS
 * cursor, which is fine for a label beside it; the pointer itself is still the
 * OS's own.
 */

const OFFSET = { x: 18, y: 20 };

function ownColor(): string {
  const user = provider.awareness?.getLocalState()?.user as { color?: unknown } | undefined;
  return typeof user?.color === 'string' ? user.color : '#3B82F6';
}

export const CursorChatComposer: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const pointer = useRef({ x: 0, y: 0, overBoard: false });
  const shell = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const place = useCallback(() => {
    const el = shell.current;
    if (!el) return;
    const width = el.offsetWidth;
    const maxX = window.innerWidth - width - 8;
    const x = Math.min(pointer.current.x + OFFSET.x, Math.max(8, maxX));
    const y = Math.min(pointer.current.y + OFFSET.y, window.innerHeight - el.offsetHeight - 8);
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      pointer.current = {
        x: e.clientX,
        y: e.clientY,
        overBoard: !!target?.closest?.('.canvas-container'),
      };
      if (open) place();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [open, place]);

  useEffect(() => {
    if (open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!pointer.current.overBoard || keyBelongsToFocus(e.key)) return;
      e.preventDefault();
      setText('');
      setOpen(true);
      presenceManager.updateChat('', true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    place();
    input.current?.focus();
  }, [open, place]);

  const close = useCallback((send: boolean, value: string) => {
    if (send && value.trim()) presenceManager.updateChat(value, false);
    else presenceManager.clearChat();
    setOpen(false);
    setText('');
  }, []);

  if (!open) return null;

  const colors = chipColorsFor(ownColor());

  return (
    <div
      ref={shell}
      className="cc"
      style={
        {
          '--who': colors.outline,
          '--who-fill': colors.fill,
          '--who-ink': colors.ink,
        } as React.CSSProperties
      }
    >
      <div className="cc__bubble">
        <input
          ref={input}
          className="cc__input"
          value={text}
          maxLength={CHAT_MAX_CHARS}
          placeholder="Say something"
          aria-label="Cursor chat message"
          onChange={(e) => {
            const value = e.target.value.slice(0, CHAT_MAX_CHARS);
            setText(value);
            presenceManager.updateChat(value, true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              close(true, text);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close(false, '');
            }
          }}
          onBlur={() => close(true, text)}
        />
      </div>
      <div className="cc__hint">Enter to send · Esc to cancel</div>
    </div>
  );
};
