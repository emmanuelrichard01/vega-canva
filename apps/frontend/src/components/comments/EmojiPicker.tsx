import React from 'react';
import { Smile } from 'lucide-react';
import { EmojiPickerPopover } from '../emoji/EmojiPickerPopover';

/**
 * The browse path, for when you do not know the name.
 *
 * Typing `:fi` and pressing Enter is faster than any picker; this is the
 * discoverable way in for "the one with the little chart going up", which has
 * no name you can guess. It is the board's shared emoji picker, hung off a
 * 26px button beside the composer, so a comment, a sticky stamp and a frame
 * title all choose from the same catalogue, recents and skin tone.
 */
export const EmojiPicker: React.FC<{
  onPick: (char: string) => void;
  /** Which way the panel opens, since the composer sits at either end of a thread. */
  placement?: 'up' | 'down';
}> = ({ onPick, placement = 'up' }) => {
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="emoji-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Insert emoji"
        data-tooltip="Emoji  ·  or type : to search"
        // Prevented so the textarea keeps its caret while the panel opens: the
        // caret position is where the emoji is going.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <Smile size={15} aria-hidden="true" />
      </button>
      <EmojiPickerPopover
        anchor={trigger}
        open={open}
        onClose={() => setOpen(false)}
        prefer={placement === 'up' ? 'above' : 'below'}
        align="end"
        onPick={onPick}
      />
    </>
  );
};
