import React from 'react';
import { useStore } from '../../hooks/useStore';
import { ancestorsOf } from '../../engine/model/groupTree';
import { Layers, ChevronRight, X } from 'lucide-react';

export const GroupIsolationBar: React.FC = () => {
  const enteredGroupId = useStore((s) => s.enteredGroupId);
  const groups = useStore((s) => s.groups);
  const setEnteredGroupId = useStore((s) => s.setEnteredGroupId);

  if (!enteredGroupId || !groups[enteredGroupId]) return null;

  const chain = [...ancestorsOf(groups, enteredGroupId).reverse(), enteredGroupId];

  const handleSelectAncestor = (targetGroupId: string) => {
    setEnteredGroupId(targetGroupId);
  };

  const handleExit = () => {
    window.dispatchEvent(new CustomEvent('exitGroupIsolation'));
  };

  return (
    <div
      className="absolute top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 rounded-full bg-surface-base/90 dark:bg-surface-dark-base/90 backdrop-blur-md border border-outline-subtle/50 dark:border-outline-dark-subtle/50 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200"
      role="status"
      aria-label="Group isolation mode"
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-brand-primary dark:text-brand-primary-light">
        <Layers className="w-3.5 h-3.5" />
        <span>Editing Group:</span>
      </div>

      <nav className="flex items-center gap-1 text-xs text-foreground/80 dark:text-foreground-dark/80">
        {chain.map((gid, idx) => {
          const isCurrent = gid === enteredGroupId;
          const group = groups[gid];
          const label = group?.name || `Group ${gid.slice(0, 4)}`;

          return (
            <React.Fragment key={gid}>
              {idx > 0 && <ChevronRight className="w-3 h-3 text-foreground-muted" />}
              {isCurrent ? (
                <span className="font-semibold text-foreground dark:text-foreground-dark px-1.5 py-0.5 rounded bg-surface-subtle/80 dark:bg-surface-dark-subtle/80">
                  {label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSelectAncestor(gid)}
                  className="hover:underline text-foreground-muted hover:text-foreground transition-colors cursor-pointer px-1"
                >
                  {label}
                </button>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      <div className="h-3.5 w-px bg-outline-subtle/60 dark:bg-outline-dark-subtle/60 mx-1" />

      <button
        type="button"
        onClick={handleExit}
        className="flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground dark:hover:text-foreground-dark transition-colors px-1.5 py-0.5 rounded hover:bg-surface-subtle dark:hover:bg-surface-dark-subtle cursor-pointer"
        title="Exit group isolation (Esc)"
      >
        <X className="w-3 h-3" />
        <span>Exit</span>
        <kbd className="text-[10px] font-mono px-1 py-0.2 rounded bg-surface-subtle dark:bg-surface-dark-subtle border border-outline-subtle/40 dark:border-outline-dark-subtle/40">
          Esc
        </kbd>
      </button>
    </div>
  );
};
