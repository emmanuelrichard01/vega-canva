import React from 'react';
import { HelpCircle } from 'lucide-react';
import './shell.css';

/**
 * Help, always one press away in the board's bottom-left corner.
 *
 * `?` is how a newcomer finds everything else, so it does not hide behind a
 * menu: it sits in the radar's footer while the radar is open, and beside the
 * radar's pill when it is put away. Zoom lives in the right panel's header.
 */
export const BoardFoot: React.FC<{ onHelp: () => void; bare?: boolean }> = ({ onHelp, bare = false }) => (
  <div className={bare ? 'board-foot board-foot--bare' : 'board-foot panel-surface'}>
    <button
      type="button"
      className={bare ? 'board-foot__help board-foot__help--wide' : 'btn-icon board-foot__help'}
      onClick={onHelp}
      aria-label="Help and keyboard shortcuts"
      aria-keyshortcuts="Shift+Slash"
      data-tooltip="Help and shortcuts (?)"
    >
      <HelpCircle size={15} aria-hidden />
      {bare && <span>Help and shortcuts</span>}
    </button>
  </div>
);
