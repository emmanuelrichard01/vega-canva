import React from 'react';
import type { TransitionKind } from '../../engine/slides/slideMeta';

/**
 * The transitions, drawn at 14px in the icon set's 1.5 stroke: a glide is
 * a slide moving along a path, a cut two slides edge to edge, a dissolve one
 * slide fading through another, a smart move one shape travelling between two.
 */
export const TransitionGlyph: React.FC<{ kind: TransitionKind; className?: string }> = ({ kind, className }) => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {kind === 'glide' && (
      <>
        <rect x="8.5" y="4.5" width="6" height="7" rx="1.2" />
        <path d="M1.5 8h4.5M4 5.5 6.5 8 4 10.5" />
      </>
    )}
    {kind === 'none' && (
      <>
        <rect x="1.5" y="4.5" width="6" height="7" rx="1.2" />
        <rect x="8.5" y="4.5" width="6" height="7" rx="1.2" />
      </>
    )}
    {kind === 'dissolve' && (
      <>
        <rect x="1.5" y="3.5" width="8" height="7" rx="1.2" />
        <rect x="6.5" y="5.5" width="8" height="7" rx="1.2" strokeDasharray="1.6 1.8" />
      </>
    )}
    {kind === 'push' && (
      <>
        <rect x="0.75" y="4.5" width="6" height="7" rx="1.2" strokeDasharray="1.6 1.8" />
        <rect x="8.5" y="4.5" width="6.75" height="7" rx="1.2" />
        <path d="M11 8H5" />
      </>
    )}
    {kind === 'slide' && (
      <>
        <rect x="1.5" y="4.5" width="9" height="7" rx="1.2" strokeDasharray="1.6 1.8" />
        <rect x="6" y="3" width="9" height="10" rx="1.2" />
      </>
    )}
    {kind === 'zoom' && (
      <>
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.4" />
        <rect x="6" y="6" width="4" height="4" rx="0.8" />
        <path d="M3.5 4.5 6 6M12.5 4.5 10 6M3.5 11.5 6 10M12.5 11.5 10 10" />
      </>
    )}
    {kind === 'smart' && (
      <>
        <rect x="1.5" y="9" width="4" height="4" rx="1" />
        <rect x="9.5" y="3" width="5" height="5" rx="1" />
        <path d="M5.5 9.5 9.5 7" strokeDasharray="1.4 1.6" />
      </>
    )}
  </svg>
);
