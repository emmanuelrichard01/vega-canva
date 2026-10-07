import React from 'react';
import { Copy, History, RotateCcw, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';

interface Props {
  /** What is on screen: "Today, 10:42:31" or a version's name. */
  title: string;
  /** True when the board shown is the board as it is now. */
  isCurrent: boolean;
  liveChanges: number;
  showChanges: boolean;
  onShowChanges: (on: boolean) => void;
  canRestore: boolean;
  restoreLabel: string;
  copyLabel: string;
  busy: boolean;
  onRestore: () => void;
  onCopy: () => void;
  onExit: () => void;
}

/**
 * The read-only banner: what you are looking at, and the three things you can
 * do about it. Restore is the screen's one primary action, and the only one a
 * viewer cannot take; it stays visible to them, disabled, with the reason.
 */
export const ReplayBanner: React.FC<Props> = ({
  title,
  isCurrent,
  liveChanges,
  showChanges,
  onShowChanges,
  canRestore,
  restoreLabel,
  copyLabel,
  busy,
  onRestore,
  onCopy,
  onExit,
}) => {
  const restoreReason = !canRestore
    ? 'Only editors can restore versions'
    : isCurrent
      ? 'This is the board as it is now'
      : undefined;

  return (
    <div className="replay-banner panel-surface" role="region" aria-label="Version history">
      <div className="replay-banner__status">
        <History size={16} className="replay-banner__icon" aria-hidden="true" />
        <span className="replay-banner__title">
          {isCurrent ? 'Viewing the current version' : <>Viewing <strong>{title}</strong></>}
        </span>
        {liveChanges > 0 && (
          <span className="replay-banner__live">
            <span className="replay-banner__live-dot" aria-hidden="true" />
            {liveChanges.toLocaleString()} new change{liveChanges === 1 ? '' : 's'} since you started viewing
          </span>
        )}
      </div>

      <div className="replay-banner__actions">
        <Switch
          checked={showChanges}
          onChange={onShowChanges}
          label="Show changes"
          tooltip="Outline what this version changed"
        />
        <span className="replay-banner__rule" aria-hidden="true" />
        <Button variant="ghost" size="sm" icon={<Copy size={14} />} onClick={onCopy} tooltip="Copy to paste into the live board">
          {copyLabel}
        </Button>
        <span data-tooltip={restoreReason} data-tooltip-pos="bottom" className="replay-banner__restore-wrap">
          <Button
            variant="primary"
            size="sm"
            icon={<RotateCcw size={14} />}
            onClick={onRestore}
            disabled={!canRestore || isCurrent || busy}
          >
            {restoreLabel}
          </Button>
        </span>
        <Button variant="secondary" size="sm" icon={<X size={14} />} onClick={onExit} tooltip="Back to the live board (Esc)">
          Exit
        </Button>
      </div>
    </div>
  );
};
