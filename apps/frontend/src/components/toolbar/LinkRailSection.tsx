import React from 'react';
import { Check, Copy, ExternalLink, PencilLine, Play, RotateCw } from 'lucide-react';
import type { LinkNode } from '../../engine/model/schema';
import { useStore } from '../../hooks/useStore';
import { RailButton, Divider } from './RailBase';
import { providerFor } from '../../engine/link/linkProviders';
import { resolveDisplay } from '../../engine/link/linkLayout';
import { openLink, refreshPreview, setLinkDisplay } from '../../engine/link/linkApply';
import type { LinkDisplay } from '../../engine/link/linkTypes';
import { openLinkComposerFor } from '../link/openLinkComposer';

/**
 * A link's display, drawn as the card it produces.
 *
 * Four shapes that differ only in layout, so each is a thumbnail of that layout
 * — a bar, a picture beside lines, a picture above lines, a player — rather
 * than four abstract glyphs somebody has to learn.
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

export const LINK_DISPLAY_LABELS: Record<Exclude<LinkDisplay, 'auto'>, string> = {
  compact: 'Compact',
  horizontal: 'Card, picture beside',
  vertical: 'Card, picture above',
  embed: 'Player',
};

/**
 * What a selected link puts on the rail: how it is shown, and where it goes.
 *
 * The four displays are one segmented run, the pressed one showing the layout
 * the card is *currently* using — which, left on auto, is the one its shape
 * picked. Pressing one pins it and snaps the card to that layout's natural
 * size, so the choice is visible the moment it is made.
 */
export const LinkRailSection: React.FC<{ node: LinkNode }> = ({ node }) => {
  const { link } = node;
  const provider = providerFor(link.url);
  const shown = resolveDisplay(link.display, node.width, node.height, Boolean(provider.embed));
  const [copied, setCopied] = React.useState(false);
  const options: Array<Exclude<LinkDisplay, 'auto'>> = provider.embed
    ? ['compact', 'horizontal', 'vertical', 'embed']
    : ['compact', 'horizontal', 'vertical'];

  return (
    <>
      <div className="ctx-group" role="radiogroup" aria-label="Show link as">
        {options.map((d) => (
          <RailButton
            key={d}
            label={LINK_DISPLAY_LABELS[d]}
            hint={link.display === 'auto' && shown === d ? `${LINK_DISPLAY_LABELS[d]} (chosen by its shape)` : LINK_DISPLAY_LABELS[d]}
            pressed={shown === d}
            onClick={() => setLinkDisplay(node, d)}
          >
            <LinkDisplayIcon display={d} />
          </RailButton>
        ))}
      </div>
      <Divider />
      <div className="ctx-group">
        {shown === 'embed' && provider.embed && (
          <RailButton label="Play here" hint="Interact with it on the board" onClick={() => useStore.getState().setEmbedActiveNodeId(node.id)}>
            <Play size={15} />
          </RailButton>
        )}
        <RailButton label={`Open ${provider.id === 'web' ? 'link' : `in ${provider.name}`}`} onClick={() => openLink(link.url)}>
          <ExternalLink size={16} />
        </RailButton>
        <RailButton
          label={copied ? 'Copied' : 'Copy link'}
          onClick={() => {
            void navigator.clipboard?.writeText(link.url).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            });
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </RailButton>
        <RailButton
          label="Edit link"
          onClick={() => openLinkComposerFor(node)}
        >
          <PencilLine size={16} />
        </RailButton>
        {link.status === 'error' && (
          <RailButton label="Try the preview again" onClick={() => refreshPreview(node)}>
            <RotateCw size={16} />
          </RailButton>
        )}
      </div>
      <Divider />
    </>
  );
};
