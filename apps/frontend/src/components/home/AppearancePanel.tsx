import React from 'react';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ContrastToggle } from '../ui/ContrastToggle';
import { useStore } from '../../hooks/useStore';

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Theme and contrast, from the dashboard's account menu. The same two
 * preferences the board uses, so changing them here changes them there.
 */
export const AppearancePanel: React.FC = () => {
  const darkTheme = useStore((s) => s.darkTheme);
  const setDarkTheme = useStore((s) => s.setDarkTheme);
  return (
    <div className="appearance-panel">
      <div className="contrast-setting">
        <span className="contrast-setting__label" id="theme-setting-label">Theme</span>
        <SegmentedControl
          ariaLabel="Theme"
          segments={THEMES}
          value={darkTheme ? 'dark' : 'light'}
          onChange={(v) => setDarkTheme(v === 'dark')}
        />
      </div>
      <ContrastToggle id="home-contrast" />
    </div>
  );
};
