import React from 'react';
import { Check, Copy } from 'lucide-react';
import type { LinkNode } from '../../engine/model/schema';
import { RailButton } from './RailBase';
import { RailPopover } from './RailPopover';
import { providerFor } from '../../engine/link/linkProviders';
import { resolveDisplay } from '../../engine/link/linkLayout';
import { setLinkDisplay } from '../../engine/link/linkApply';
import { LINK_DISPLAY_LABELS, type LinkDisplay } from '../../engine/link/linkTypes';

/**
 * A link's display, drawn as the card it produces: a bar, a picture beside
 * lines, a picture above lines, a player.
 */
export const LinkDisplayIcon: React.FC<{ display: Exclude<LinkDisplay, 'auto'> }> = ({ display }) => (
  <svg width="18" height="16" viewBox="0 0 18 16" fill="none" aria-hidden>
    {display === 'compact' && (
      <>
        <rect x="1" y="5" width="16" height="6" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <rect x="3" y="7" width="2" height="2" rx="0.5" fill="currentColor" />
        <path d="M7 8h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </>
    )}
    {display === 'horizontal' && (
      <>
        <rect x="1" y="3" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <rect x="1.65" y="3.65" width="5.5" height="8.7" rx="1.4" fill="currentColor" opacity="0.35" />
        <path d="M9.5 6.5h5M9.5 9.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </>
    )}
    {display === 'vertical' && (
      <>
        <rect x="3" y="1" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <rect x="3.65" y="1.65" width="10.7" height="5.5" rx="1.4" fill="currentColor" opacity="0.35" />
        <path d="M5.5 10h7M5.5 12.5h4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </>
    )}
    {display === 'embed' && (
      <>
        <rect x="1" y="2" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M7.5 5.5v5l4-2.5z" fill="currentColor" />
      </>
    )}
  </svg>
);

/**
 * How the link is shown, as one control wearing the layout it is using now.
 *
 * Left on auto, that is the one its shape picked; pressing a layout pins it and
 * snaps the card to that layout's natural size.
 */
export const LinkDisplayControl: React.FC<{ node: LinkNode }> = ({ node }) => {
  const { link } = node;
  const provider = providerFor(link.url);
  const shown = resolveDisplay(link.display, node.width, node.height, Boolean(provider.embed));
  const options: Array<Exclude<LinkDisplay, 'auto'>> = provider.embed
    ? ['compact', 'horizontal', 'vertical', 'embed']
    : ['compact', 'horizontal', 'vertical'];
  return (
    <RailPopover label={`Show as: ${LINK_DISPLAY_LABELS[shown]}`} trigger={<LinkDisplayIcon display={shown} />} align="start">
      {(close) => (
        <>
          <span className="ctx-popover__label">Show as</span>
          <div className="rail-display-grid" role="radiogroup" aria-label="Show link as">
            {options.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={shown === d}
                className="rail-display"
                onClick={() => {
                  setLinkDisplay(node, d);
                  close();
                }}
              >
                <LinkDisplayIcon display={d} />
                <span>
                  {LINK_DISPLAY_LABELS[d]}
                  {link.display === 'auto' && shown === d && <span className="rail-display__auto"> · auto</span>}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </RailPopover>
  );
};

export const CopyLinkButton: React.FC<{ url: string }> = ({ url }) => {
  const [copied, setCopied] = React.useState(false);
  return (
    <RailButton
      label={copied ? 'Copied' : 'Copy link'}
      onClick={() => {
        void navigator.clipboard?.writeText(url).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </RailButton>
  );
};

