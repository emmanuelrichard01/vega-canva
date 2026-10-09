import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Popover } from '../ui/Popover';
import type { EmojiPickerProps } from './EmojiPicker';
import { OPEN_EMOJI_PICKER, type OpenEmojiPickerDetail } from './openEmojiPicker';
import { loadEmojiIndex } from '../../engine/emoji/emojiIndex';
import { scheduleEmojiPrefetch } from '../../engine/emoji/emojiPrefetch';
import './emoji.css';

/** The picker's code arrives with its first opening, not with the board. */
const importPicker = () => import('./EmojiPicker');
// The catalogue is fetched alongside the script chunk, not after it: two round trips in parallel instead of in series.
const LazyPicker = lazy(() => {
  void loadEmojiIndex().catch(() => undefined);
  return importPicker().then((m) => ({ default: m.EmojiPicker }));
});

const Loading: React.FC = () => (
  <div className="emoji-picker emoji-picker--loading" aria-busy="true" aria-label="Loading emoji picker" />
);

export interface EmojiPickerPopoverProps extends Omit<EmojiPickerProps, 'autoFocus'> {
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  label?: string;
  prefer?: 'below' | 'above';
  align?: 'start' | 'end';
}

/**
 * The picker hung off a trigger. Picking closes it; so do Escape and a press
 * outside, through the shared `Popover`.
 */
export const EmojiPickerPopover: React.FC<EmojiPickerPopoverProps> = ({
  anchor,
  open,
  onClose,
  label = 'Choose an emoji',
  prefer,
  align,
  onPick,
  onRemove,
  ...rest
}) => (
  <Popover anchor={anchor} open={open} onClose={onClose} label={label} prefer={prefer} align={align} className="emoji-popover">
    {open && (
      <Suspense fallback={<Loading />}>
        <LazyPicker
          {...rest}
          onPick={(native) => {
            onPick(native);
            onClose();
          }}
          onRemove={
            onRemove
              ? () => {
                  onRemove();
                  onClose();
                }
              : undefined
          }
        />
      </Suspense>
    )}
  </Popover>
);

export const CanvasEmojiPickerHost: React.FC = () => {
  const [request, setRequest] = useState<OpenEmojiPickerDetail | null>(null);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  // Mounted once with the canvas: a good moment to warm the picker for later.
  useEffect(() => scheduleEmojiPrefetch(importPicker), []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenEmojiPickerDetail>).detail;
      if (!detail?.rect || typeof detail.onPick !== 'function') return;
      setRequest(detail);
      setOpen(true);
    };
    window.addEventListener(OPEN_EMOJI_PICKER, onOpen);
    return () => window.removeEventListener(OPEN_EMOJI_PICKER, onOpen);
  }, []);

  if (!request) return null;
  const { rect } = request;
  return (
    <>
      <div
        ref={anchor}
        className="emoji-anchor"
        aria-hidden="true"
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      />
      <EmojiPickerPopover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        label={request.label}
        current={request.current}
        onPick={request.onPick}
        onRemove={request.onRemove}
        removeLabel={request.removeLabel}
      />
    </>
  );
};
