import React from 'react';
import { SegmentedControl } from './SegmentedControl';
import { setContrastPreference, useContrast, type ContrastPreference } from '../../engine/ui/contrast';

const SEGMENTS = [
  { value: 'system', label: 'Auto', hint: 'Follow the system setting' },
  { value: 'off', label: 'Standard' },
  { value: 'on', label: 'Increased', hint: 'Stronger text, borders and focus rings' },
];

/**
 * The contrast setting as a three-way choice, for a settings surface.
 *
 * "Auto" is a real third option rather than an absence: it keeps following the
 * OS as that setting changes, where "Standard" holds even if the OS asks for
 * more. The line underneath says what Auto currently resolves to, so the
 * choice is never a guess.
 */
export const ContrastToggle: React.FC<{ id?: string }> = ({ id = 'contrast-setting' }) => {
  const { preference, enhanced } = useContrast();
  return (
    <div className="contrast-setting">
      <span className="contrast-setting__label" id={`${id}-label`}>
        Contrast
      </span>
      <SegmentedControl
        ariaLabel="Contrast"
        segments={SEGMENTS}
        value={preference}
        onChange={(v) => setContrastPreference(v as ContrastPreference)}
      />
      {preference === 'system' && (
        <span className="contrast-setting__note">{enhanced ? 'Increased, from your system setting' : 'Standard, from your system setting'}</span>
      )}
    </div>
  );
};
