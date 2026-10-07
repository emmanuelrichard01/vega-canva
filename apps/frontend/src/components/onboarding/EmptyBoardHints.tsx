import React, { useEffect, useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { whenDocumentReady } from '../../engine/document';
import { IS_MAC } from '../menu/shortcuts';
import type { RoomRole } from '../../engine/model/permissions';
import './onboarding.css';

/** How long the fade-out runs before the layer leaves the tree. */
const LEAVE_MS = 360;

/** Faded by somebody's first action: not shown again this page session. */
let retired = false;

interface Hint {
  keys: string;
  what: string;
}

const MOD = IS_MAC ? '⌘' : 'Ctrl';

/** Without counting every key, which a store selector would do on each change. */
function isEmpty(table: object): boolean {
  for (const key in table) if (Object.prototype.hasOwnProperty.call(table, key)) return false;
  return true;
}

/** What an empty board can usefully say, per role. Every key here is bound. */
export function hintsFor(role: RoomRole): { title: string; hints: Hint[] } {
  if (role === 'editor') {
    return {
      title: 'Start anywhere',
      hints: [
        { keys: 'S', what: 'Sticky note, then click' },
        { keys: '/', what: 'Chat at your cursor' },
        { keys: `${MOD} K`, what: 'Everything else' },
      ],
    };
  }
  return {
    title: 'Nothing on this board yet',
    hints: [
      { keys: 'Scroll', what: 'Move around' },
      ...(role === 'commenter' ? [{ keys: 'C', what: 'Comment' }] : []),
      { keys: '/', what: 'Chat at your cursor' },
    ],
  };
}

/**
 * What a brand-new board says for itself: three keys, quietly, in the middle.
 *
 * It never takes a click (pointer events pass straight through to the board),
 * waits for the document so it does not flash on a board that is still
 * loading, and fades on the first thing anybody does: a press on the board, a
 * key, a scroll, or an object arriving from anyone.
 */
export const EmptyBoardHints: React.FC<{ visible: boolean }> = ({ visible }) => {
  const empty = useStore((s) => isEmpty(s.objects));
  const { role } = useRoomPermissions();
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<'on' | 'leaving' | 'gone'>(retired ? 'gone' : 'on');

  useEffect(() => {
    let live = true;
    void whenDocumentReady().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const showing = visible && ready && phase === 'on' && empty;

  useEffect(() => {
    if (!showing) return;
    const leave = () => {
      retired = true;
      setPhase('leaving');
    };
    const onKey = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      leave();
    };
    const onPress = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('.konvajs-content, [data-tour="dock"]')) leave();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('wheel', leave, { capture: true, passive: true });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('wheel', leave, { capture: true });
    };
  }, [showing]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const t = window.setTimeout(() => setPhase('gone'), LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  /**
   * The board has something on it, from anyone: the hints are done for this
   * visit, and stay away if it is emptied again.
   */
  useEffect(() => {
    if (!ready || empty || phase !== 'on') return;
    setPhase('gone');
  }, [ready, empty, phase]);

  if (!visible || !ready || phase === 'gone' || (!empty && phase === 'on')) return null;

  const { title, hints } = hintsFor(role);

  return (
    <div className="ebh" data-leaving={phase === 'leaving' || undefined} role="note" aria-label="This board is empty">
      <p className="ebh__title">{title}</p>
      <ul className="ebh__hints">
        {hints.map((h) => (
          <li key={h.keys} className="ebh__hint">
            <kbd className="ebh__key">{h.keys}</kbd>
            <span>{h.what}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
