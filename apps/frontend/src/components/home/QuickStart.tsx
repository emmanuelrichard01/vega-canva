import React from 'react';
import { ArrowRight, Compass, Link2, SquarePen, UploadCloud } from 'lucide-react';

interface Props {
  /** `full` is the empty library's own screen; `strip` is the row above a grid. */
  size: 'full' | 'strip';
  templateCount: number;
  onBlank: () => void;
  onTemplates: () => void;
  onJoin: () => void;
  onRestore: () => void;
}

/**
 * The four ways a board gets on screen, in the order they are worth trying.
 *
 * Blank, from a template, from somebody's link, from a backup file. They were
 * spread across a `+` menu, a nav destination and an account menu, and written
 * out in full only on the empty state — which is the one screen you see once.
 * Here they are one row above the library, and the same row, larger, when the
 * library is empty: a person who has done this before skims past a 56px strip,
 * and a person who has not is looking straight at every way in.
 *
 * A backup is last and quietest of the four. It is the rarest, and the one
 * that already has a second way in — dropping the file anywhere on the page.
 */
export const QuickStart: React.FC<Props> = ({ size, templateCount, onBlank, onTemplates, onJoin, onRestore }) => {
  const full = size === 'full';
  const actions = [
    {
      id: 'blank',
      icon: <SquarePen size={full ? 18 : 16} aria-hidden="true" />,
      name: 'Blank board',
      sub: full ? 'An empty canvas with no edges' : 'A canvas with no edges',
      onClick: onBlank,
      primary: true,
    },
    {
      id: 'template',
      icon: <Compass size={full ? 18 : 16} aria-hidden="true" />,
      name: 'From a template',
      sub: full ? `${templateCount} boards that open already filled in` : `${templateCount} ready-made boards`,
      onClick: onTemplates,
    },
    {
      id: 'link',
      icon: <Link2 size={full ? 18 : 16} aria-hidden="true" />,
      name: 'Open a link',
      sub: full ? 'Somebody has shared a board with you' : 'Somebody shared one with you',
      onClick: onJoin,
    },
    {
      id: 'backup',
      icon: <UploadCloud size={full ? 18 : 16} aria-hidden="true" />,
      name: 'Restore a backup',
      sub: full ? 'Or drop the file anywhere on this page' : 'Or drop the file on this page',
      onClick: onRestore,
    },
  ];

  return (
    <div className={`starts starts--${size}`} role="group" aria-label="Start a board">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="start"
          data-primary={action.primary || undefined}
          onClick={action.onClick}
        >
          <span className="start__icon">{action.icon}</span>
          <span className="start__text">
            <span className="start__name">{action.name}</span>
            <span className="start__sub">{action.sub}</span>
          </span>
          {full && <ArrowRight size={15} className="start__go" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
};
