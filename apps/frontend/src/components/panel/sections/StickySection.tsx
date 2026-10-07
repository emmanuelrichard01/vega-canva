import React from 'react';
import { Row, Section, SegmentedControl, Switch } from '../grammar';
import { TagEditor } from '../../ui/TagEditor';
import {
  FIXED_TEXT_SIZES,
  PALETTE_ORDER,
  paperOf,
  STICKY_PADDING,
  STICKY_SIZES,
  stickySizeOf,
  THEME_LABELS,
} from '../../../engine/model/stickyThemes';
import { textBox } from '../../../engine/model/stickyFooter';
import type { AnyNode, StickyNode, StickyTheme } from '../../../engine/model/schema';
import { useStore } from '../../../hooks/useStore';
import type { Shared } from '../../../engine/model/selection';
import { useChromeDark } from '../../../engine/interaction/chromeHalo';
import { stickyText } from '../../canvas/renderers/stickyRichLayout';
import './stickySection.css';

interface StickySectionProps {
  node: StickyNode;
  isMulti: boolean;
  pickedTheme: Shared<string | null>;
  pinned: Shared<boolean | null>;
  set: (updates: Partial<AnyNode>) => void;
  /** Reads across the selection, for mixed states. Without it the primary note stands for all. */
  shared?: <T>(read: (n: AnyNode) => T) => Shared<T>;
}

/** The primary note's value, as a `Shared`, when the panel has not handed over its reader. */
const single = <T,>(value: T): Shared<T> => ({ value, mixed: false });

/**
 * Note: colour, size, how the writing is sized, what else is drawn on it.
 *
 * A sticky has no free fill. The papers are a radio group (arrow keys move the
 * choice), each shown as itself in the current theme, and the next note drawn
 * takes the one last chosen. Size presets keep the note's top-left corner, so
 * a selection of several resizes in place rather than stacking.
 */
export const StickySection: React.FC<StickySectionProps> = ({ node, isMulti, pickedTheme, pinned, set, shared }) => {
  const dark = useChromeDark();
  const read = <T,>(fn: (n: StickyNode) => T, fallback: T): Shared<T> =>
    shared ? shared((n) => (n.type === 'sticky' ? fn(n) : fallback)) : single(fn(node));

  const sizing = read((n) => n.textSizing ?? 'auto', 'auto');
  const fixedSize = read((n) => n.fontSize, 0);
  const sizeId = read((n) => stickySizeOf(n.width, n.height) ?? 'custom', 'custom');
  const showAuthor = read((n) => n.showAuthor !== false, true);
  const showDate = read((n) => n.showDate === true, false);
  const showStamps = read((n) => n.showStamps !== false, true);
  const checklist = read((n) => n.checklist === true, false);

  const choose = (id: StickyTheme) => {
    set({ theme: id } as Partial<AnyNode>);
    useStore.getState().setStickyTheme(id);
  };
  const order = PALETTE_ORDER;
  const activeIndex = pickedTheme.mixed ? -1 : order.findIndex((id) => id === pickedTheme.value);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const from = activeIndex < 0 ? (dir > 0 ? -1 : 0) : activeIndex;
    const next = (from + dir + order.length) % order.length;
    choose(order[next]);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  /** Switching to a fixed size starts from the size the note is drawn at now, rounded to a step. */
  const toFixed = () => {
    const box = textBox(node.width, node.height, STICKY_PADDING, node.tags.length > 0);
    const now = stickyText(node.text, box, { checklist: node.checklist }).fontSize;
    const nearest = FIXED_TEXT_SIZES.reduce((best, s) => (Math.abs(s.size - now) < Math.abs(best.size - now) ? s : best));
    set({ textSizing: 'fixed', fontSize: nearest.size } as Partial<AnyNode>);
  };

  const fixedId = FIXED_TEXT_SIZES.find((s) => s.size === fixedSize.value)?.id ?? '';

  return (
    <Section id="note" title="Note">
      <Row label="Colour">
        <div className="note-swatches" role="radiogroup" aria-label="Note colour" onKeyDown={onKeyDown}>
          {order.map((id, i) => {
            const paper = paperOf(id, dark);
            const active = i === activeIndex;
            const tabbable = active || (activeIndex < 0 && i === 0);
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={THEME_LABELS[id]}
                tabIndex={tabbable ? 0 : -1}
                data-tooltip={THEME_LABELS[id]}
                className="note-swatch"
                style={{ background: paper.bg, borderColor: paper.edge, color: paper.ink }}
                onClick={() => choose(id)}
              >
                <span className="note-swatch__ink" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </Row>

      <Row label="Size" hint="Preset sizes keep the note's top-left corner. Drag a handle for any other size.">
        <SegmentedControl
          ariaLabel="Note size"
          fill
          mixed={sizeId.mixed}
          value={sizeId.mixed ? '' : String(sizeId.value)}
          onChange={(id) => {
            const preset = STICKY_SIZES.find((s) => s.id === id);
            if (preset) set({ width: preset.width, height: preset.height } as Partial<AnyNode>);
          }}
          segments={STICKY_SIZES.map((s) => ({ value: s.id, label: s.id === 'wide' ? 'Wide' : s.id, hint: `${s.label}, ${s.width} × ${s.height}` }))}
        />
      </Row>

      <Row label="Text" hint="Auto fits the writing to the paper. Fixed keeps one size, so a wall of notes reads evenly.">
        <SegmentedControl
          ariaLabel="Text sizing"
          fill
          mixed={sizing.mixed}
          value={sizing.mixed ? '' : String(sizing.value)}
          onChange={(v) => (v === 'fixed' ? toFixed() : set({ textSizing: undefined } as Partial<AnyNode>))}
          segments={[
            { value: 'auto', label: 'Auto', hint: 'Largest size that fits' },
            { value: 'fixed', label: 'Fixed', hint: 'One size, whatever the note says' },
          ]}
        />
      </Row>
      {!sizing.mixed && sizing.value === 'fixed' && (
        <Row label="Text size">
          <SegmentedControl
            ariaLabel="Fixed text size"
            fill
            mixed={fixedSize.mixed}
            value={fixedSize.mixed ? '' : fixedId}
            onChange={(id) => {
              const s = FIXED_TEXT_SIZES.find((f) => f.id === id);
              if (s) set({ fontSize: s.size } as Partial<AnyNode>);
            }}
            segments={FIXED_TEXT_SIZES.map((s) => ({ value: s.id, label: s.id, hint: s.label }))}
          />
        </Row>
      )}

      <Row label="Checklist" hint="Every line becomes an item you can tick. Lines starting [ ] or [x] are items in any note.">
        <Switch ariaLabel="Checklist" checked={checklist.mixed ? 'mixed' : checklist.value} onChange={(on) => set({ checklist: on || undefined } as Partial<AnyNode>)} />
      </Row>
      <Row label="Author" hint="The writer's initials along the bottom of the note.">
        <Switch ariaLabel="Show author" checked={showAuthor.mixed ? 'mixed' : showAuthor.value} onChange={(on) => set({ showAuthor: on ? undefined : false } as Partial<AnyNode>)} />
      </Row>
      <Row label="Date" hint="When the note was written, beside the author.">
        <Switch ariaLabel="Show date" checked={showDate.mixed ? 'mixed' : showDate.value} onChange={(on) => set({ showDate: on || undefined } as Partial<AnyNode>)} />
      </Row>
      <Row label="Stamps" hint="Hide the stamps on this note. Nobody's stamp is removed; they come back when shown.">
        <Switch ariaLabel="Show stamps" checked={showStamps.mixed ? 'mixed' : showStamps.value} onChange={(on) => set({ showStamps: on ? undefined : false } as Partial<AnyNode>)} />
      </Row>
      <Row label="Pinned" hint="A pinned note is held where it is and cannot be dragged. Everything else about it stays editable.">
        <Switch ariaLabel="Pinned" checked={pinned.mixed ? 'mixed' : Boolean(pinned.value)} onChange={(on) => set({ pinned: on } as Partial<AnyNode>)} />
      </Row>
      {!isMulti && <TagEditor tags={node.tags} onChange={(tags: string[]) => set({ tags } as Partial<AnyNode>)} />}
    </Section>
  );
};
