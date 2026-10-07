import { ExternalLink, PencilLine, Play, RotateCw } from 'lucide-react';
import { resolveDisplay } from '../../../engine/link/linkLayout';
import { openLink, refreshPreview } from '../../../engine/link/linkApply';
import { providerFor } from '../../../engine/link/linkProviders';
import type { LinkNode } from '../../../engine/model/schema';
import { useStore } from '../../../hooks/useStore';
import { openLinkComposerFor } from '../../link/openLinkComposer';
import { RailButton } from '../RailBase';
import { CopyLinkButton } from '../LinkRailSection';
import type { RailVerb } from './verbs';

/** Where a link goes, and how to change it. */
export function linkVerbs(node: LinkNode): RailVerb[] {
  const { link } = node;
  const provider = providerFor(link.url);
  const shown = resolveDisplay(link.display, node.width, node.height, Boolean(provider.embed));
  const verbs: RailVerb[] = [];
  if (shown === 'embed' && provider.embed) {
    verbs.push({
      id: 'play',
      controls: 1,
      node: (
        <RailButton label="Play here" hint="Interact with it on the board" onClick={() => useStore.getState().setEmbedActiveNodeId(node.id)}>
          <Play size={15} />
        </RailButton>
      ),
    });
  }
  verbs.push(
    {
      id: 'open',
      controls: 1,
      node: (
        <RailButton label={`Open ${provider.id === 'web' ? 'link' : `in ${provider.name}`}`} onClick={() => openLink(link.url)}>
          <ExternalLink size={16} />
        </RailButton>
      ),
    },
    { id: 'copy', controls: 1, node: <CopyLinkButton url={link.url} /> },
    {
      id: 'edit',
      controls: 1,
      node: (
        <RailButton label="Edit link" onClick={() => openLinkComposerFor(node)}>
          <PencilLine size={16} />
        </RailButton>
      ),
    }
  );
  if (link.status === 'error') {
    verbs.push({
      id: 'retry',
      controls: 1,
      node: (
        <RailButton label="Try the preview again" onClick={() => refreshPreview(node)}>
          <RotateCw size={16} />
        </RailButton>
      ),
    });
  }
  return verbs;
}
