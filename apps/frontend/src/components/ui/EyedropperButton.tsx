import React, { useState } from 'react';
import { Pipette } from 'lucide-react';
import { isEyedropperAvailable, sampleColor } from '../../engine/interaction/eyedropper';

interface Props {
  onPick: (color: string) => void;
  label?: string;
}

/**
 * A pipette, beside the colour it would replace.
 *
 * Deliberately not a tool in the dock. An eyedropper is not a mode you enter
 * and then wonder what it will do — it is a way of answering the question
 * "what colour?" that a control has already asked. Putting it next to the
 * swatch means the answer has somewhere to go, and there is no state to leave
 * switched on.
 *
 * Renders nothing where the browser has no `EyeDropper`. A pipette that does
 * nothing is worse than no pipette, and this is the same judgment the object
 * registry makes about declaring a capability the renderer ignores.
 */
export const EyedropperButton: React.FC<Props> = ({ onPick, label = 'Pick a colour from the screen' }) => {
  const [picking, setPicking] = useState(false);

  if (!isEyedropperAvailable()) return null;

  return (
    <button
      type="button"
      className="btn-icon"
      // The native picker takes over the pointer, so a second press cannot
      // reach this button — but a stuck pressed state would still be visible
      // once it closes, and `aria-pressed` is what a screen reader reads.
      aria-pressed={picking}
      aria-label={label}
      data-tooltip={label}
      disabled={picking}
      style={{ padding: 4, flexShrink: 0 }}
      onClick={async () => {
        setPicking(true);
        try {
          const color = await sampleColor();
          if (color) onPick(color);
        } finally {
          setPicking(false);
        }
      }}
    >
      <Pipette size={14} />
    </button>
  );
};
