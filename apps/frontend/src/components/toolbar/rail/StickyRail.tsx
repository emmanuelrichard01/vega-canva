import React, { Suspense, lazy, useState } from 'react';
import { Pin, SmilePlus } from 'lucide-react';
import { localAuthorId, toggleReaction } from '../../../engine/document';
import type { StickyNode, StickyTheme } from '../../../engine/model/schema';
import { PALETTE_ORDER, paperOf, STICKY_SIZES, stickySizeOf, THEME_LABELS } from '../../../engine/model/stickyThemes';
import { QUICK_STAMPS, STAMP_PLUS_ONE, stampLabel } from '../../../engine/model/stickyStamps';
import { useChromeDark } from '../../../engine/interaction/chromeHalo';
import { useStore } from '../../../hooks/useStore';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { Emoji } from '../../emoji/Emoji';
import { RailButton } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { RailAnatomy } from './anatomy';
import { updateNode, type SingleRail } from './types';
import './stickyRail.css';

const LazyPicker = lazy(() => import('../../emoji/EmojiPicker').then((m) => ({ default: m.EmojiPicker })));

/**
 * The quick colour row: every paper as a dot, one tab stop, arrows to move.
 *
 * Inline rather than behind a popover because recolouring notes is the thing
 * people do most to them while sorting a wall — one press, not two.
 */
const ColourRow: React.FC<{ theme: StickyTheme; onPick: (t: StickyTheme) => void }> = ({ theme, onPick }) => {
  const dark = useChromeDark();
  const active = PALETTE_ORDER.indexOf(theme);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (Math.max(0, active) + dir + PALETTE_ORDER.length) % PALETTE_ORDER.length;
    onPick(PALETTE_ORDER[next]);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div className="sticky-rail-colours" role="radiogroup" aria-label="Note colour" onKeyDown={onKeyDown}>
      {PALETTE_ORDER.map((id, i) => {
        const paper = paperOf(id, dark);
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={i === active}
            aria-label={THEME_LABELS[id]}
            data-tooltip={THEME_LABELS[id]}
            tabIndex={i === active || (active < 0 && i === 0) ? 0 : -1}
            className="sticky-rail-colour"
            style={{ background: paper.bg, borderColor: paper.edge }}
            onClick={() => onPick(id)}
          />
        );
      })}
    </div>
  );
};

/**
 * The stamp tray: the quick set, then the whole catalogue behind "More", in
 * the same popover so there is never a popover on a popover. Its own
 * component so "More" starts closed every time the tray opens.
 */
const StampTray: React.FC<{ node: StickyNode; me: string; close: () => void }> = ({ node, me, close }) => {
  const [more, setMore] = useState(false);
  if (more) {
    return (
      <Suspense fallback={<div className="emoji-picker emoji-picker--loading" aria-busy="true" />}>
        <LazyPicker
          onPick={(native) => {
            toggleReaction(node.id, native, me);
            close();
          }}
        />
      </Suspense>
    );
  }
  return (
    <div className="sticky-rail-stamps">
      {QUICK_STAMPS.map((stamp) => {
        const mine = (node.reactions[stamp] ?? []).includes(me);
        return (
          <button
            key={stamp}
            type="button"
            className="sticky-rail-stamp"
            aria-pressed={mine}
            aria-label={mine ? `Remove ${stampLabel(stamp)}` : stampLabel(stamp)}
            data-tooltip={stampLabel(stamp)}
            onClick={() => {
              toggleReaction(node.id, stamp, me);
              close();
            }}
          >
            {stamp === STAMP_PLUS_ONE ? <span className="sticky-rail-plus-one">+1</span> : <Emoji native={stamp} size={20} />}
          </button>
        );
      })}
      <span className="sticky-rail-stamps__sep" aria-hidden="true" />
      <button type="button" className="sticky-rail-stamp" aria-label="More emoji" data-tooltip="More emoji" onClick={() => setMore(true)}>
        <SmilePlus size={16} />
      </button>
    </div>
  );
};

/**
 * A sticky note: its colour, its size, whether it is pinned, and a stamp.
 */
export const StickyRail: SingleRail<StickyNode> = ({ node, conditional, tail, tailControls }) => {
  const me = localAuthorId();
  const { canEdit, canComment } = useRoomPermissions();
  const size = stickySizeOf(node.width, node.height);

  return (
    <RailAnatomy
      paint={
        canEdit ? (
          <ColourRow
            theme={node.theme}
            onPick={(theme) => {
              updateNode(node.id, { theme });
              // Recolouring a note also sets what the next one will be.
              useStore.getState().setStickyTheme(theme);
            }}
          />
        ) : undefined
      }
      paintControls={canEdit ? 2 : 0}
      verbs={[
        ...(canEdit
          ? [
              {
                id: 'size',
                controls: 1,
                node: (
                  <RailPopover label="Note size" align="center" trigger={<span className="sticky-rail-size">{size === 'wide' ? 'W' : size ?? '—'}</span>}>
                    {(close) => (
                      <div className="sticky-rail-sizes" role="group" aria-label="Note size">
                        {STICKY_SIZES.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className="sticky-rail-size-option"
                            aria-pressed={size === s.id}
                            onClick={() => {
                              updateNode(node.id, { width: s.width, height: s.height });
                              close();
                            }}
                          >
                            <span className="sticky-rail-size-glyph" style={{ width: s.width / 14, height: s.height / 14 }} aria-hidden="true" />
                            {s.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </RailPopover>
                ),
              },
              {
                id: 'pin',
                controls: 1,
                node: (
                  <RailButton label={node.pinned ? 'Unpin' : 'Pin'} pressed={node.pinned} onClick={() => updateNode(node.id, { pinned: !node.pinned })}>
                    <Pin size={16} fill={node.pinned ? 'currentColor' : 'none'} />
                  </RailButton>
                ),
              },
            ]
          : []),
        ...(canComment
          ? [
              {
                id: 'stamp',
                controls: 1,
                node: (
                  <RailPopover label="Stamp" align="center" trigger={<SmilePlus size={16} />}>
                    {(close) => <StampTray node={node} me={me} close={close} />}
                  </RailPopover>
                ),
              },
            ]
          : []),
      ]}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
