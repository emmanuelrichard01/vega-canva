import React from 'react';

/**
 * The glyph for the icon library: four tiles, two of them cut into shapes, the
 * way a sheet of architecture icons reads at a glance. Authored rather than
 * borrowed so it sits at the dock's 16px grid with the same 1.5 stroke as its
 * neighbours.
 */
export const IconsGlyph: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <circle cx="11.5" cy="4.5" r="2.5" />
    <path d="M4.5 9 L7 13.5 H2 Z" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </svg>
);
