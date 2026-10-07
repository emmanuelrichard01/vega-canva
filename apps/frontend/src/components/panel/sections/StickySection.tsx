import React from 'react';
import { Row, Section, Switch } from '../grammar';
import { TagEditor } from '../../ui/TagEditor';
import { THEMES } from '../../../engine/model/stickyThemes';
import { STICKY_THEMES, type AnyNode, type StickyNode } from '../../../engine/model/schema';
import { useStore } from '../../../hooks/useStore';
import type { Shared } from '../../../engine/model/selection';

interface StickySectionProps {
  node: StickyNode;
  isMulti: boolean;
  pickedTheme: Shared<string | null>;
  pinned: Shared<boolean | null>;
  set: (updates: Partial<AnyNode>) => void;
}

/**
 * Note: the paper, whether it is pinned, and its tags.
 *
 * A sticky has no free fill. The eight papers are a radio group (arrow keys
 * move the choice), each ink a deep version of its own paper, and the next
 * note drawn takes the one last chosen.
 */
export const StickySection: React.FC<StickySectionProps> = ({ node, isMulti, pickedTheme, pinned, set }) => {
  const choose = (id: (typeof STICKY_THEMES)[number]) => {
    set({ theme: id } as Partial<AnyNode>);
    useStore.getState().setStickyTheme(id);
  };
  const activeIndex = pickedTheme.mixed ? -1 : STICKY_THEMES.findIndex((id) => id === pickedTheme.value);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const from = activeIndex < 0 ? (dir > 0 ? -1 : 0) : activeIndex;
    const next = (from + dir + STICKY_THEMES.length) % STICKY_THEMES.length;
    choose(STICKY_THEMES[next]);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <Section id="note" title="Note">
      <Row label="Paper">
        <div className="sticky-papers" role="radiogroup" aria-label="Note colour" onKeyDown={onKeyDown}>
          {STICKY_THEMES.map((id, i) => {
            const paper = THEMES[id];
            const active = i === activeIndex;
            const tabbable = active || (activeIndex < 0 && i === 0);
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={id}
                tabIndex={tabbable ? 0 : -1}
                data-tooltip={id[0].toUpperCase() + id.slice(1)}
                className={`sticky-paper${active ? ' is-active' : ''}`}
                style={{ background: paper.bg, borderColor: paper.edge, color: paper.text }}
                onClick={() => choose(id)}
              >
                Aa
              </button>
            );
          })}
        </div>
      </Row>
      <Row label="Pinned" hint="A pinned note is held where it is and cannot be dragged. Everything else about it stays editable.">
        <Switch
          ariaLabel="Pinned"
          checked={pinned.mixed ? 'mixed' : Boolean(pinned.value)}
          onChange={(on) => set({ pinned: on } as Partial<AnyNode>)}
        />
      </Row>
      {!isMulti && <TagEditor tags={node.tags} onChange={(tags: string[]) => set({ tags } as Partial<AnyNode>)} />}
    </Section>
  );
};
