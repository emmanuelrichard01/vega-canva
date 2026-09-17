import React from 'react';
import { ExternalLink, X } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { providerFor } from '../../engine/link/linkProviders';
import { EMBED_HEADER, resolveDisplay } from '../../engine/link/linkLayout';
import { openLink } from '../../engine/link/linkApply';
import { PORTAL_SURFACE_ATTR } from '../ui/portalSurface';
import './link.css';

/**
 * The one live embed on the board.
 *
 * ## Click to interact
 *
 * The canvas draws every embed as a poster. Double-clicking one brings its
 * player here: a real iframe laid over the poster's media area, at the camera's
 * zoom, following the board as it moves. Anywhere else pressed puts it back to
 * sleep. One at a time, because a page per embed on a busy board is a browser
 * running twenty sites, and because a live iframe takes the pointer and the
 * wheel — the board could not be panned across a wall of them.
 *
 * ## What the iframe may do
 *
 * Its source is built by the provider adapter from ids parsed out of the link,
 * never taken from the page (see `linkProviders`). It is sandboxed to what a
 * player needs — scripts, its own origin's storage, fullscreen, popups for
 * "watch on YouTube" — and gets no referrer beyond the origin, so the board's
 * address is not sent along.
 */
export const EmbedLayer: React.FC = () => {
  const id = useStore((s) => s.embedActiveNodeId);
  const node = useStore((s) => (id ? s.objects[id] : undefined));
  const close = React.useCallback(() => useStore.getState().setEmbedActiveNodeId(null), []);

  React.useEffect(() => {
    if (id && (!node || node.type !== 'link')) close();
  }, [id, node, close]);

  if (!node || node.type !== 'link') return null;
  const provider = providerFor(node.link.url);
  if (!provider.embed || resolveDisplay(node.link.display, node.width, node.height, true) !== 'embed') return null;
  return <LiveEmbed key={node.id} nodeId={node.id} onClose={close} />;
};

const LiveEmbed: React.FC<{ nodeId: string; onClose: () => void }> = ({ nodeId, onClose }) => {
  const node = useStore((s) => s.objects[nodeId]);
  const [, reposition] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    const again = () => reposition((n) => n + 1);
    engineEvents.on('CameraChanged', again);
    engineEvents.on('ObjectMoved', again);
    window.addEventListener('resize', again);
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      engineEvents.off('CameraChanged', again);
      engineEvents.off('ObjectMoved', again);
      window.removeEventListener('resize', again);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!node || node.type !== 'link') return null;
  const provider = providerFor(node.link.url);
  if (!provider.embed) return null;

  const zoom = cameraSystem.zoom || 1;
  const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
  const left = (stage?.left ?? 0) + node.x * zoom + cameraSystem.x;
  const top = (stage?.top ?? 0) + (node.y + EMBED_HEADER) * zoom + cameraSystem.y;
  const width = node.width;
  const height = Math.max(0, node.height - EMBED_HEADER);

  return (
    <div
      ref={rootRef}
      className="lnk-embed"
      data-loaded={loaded || undefined}
      style={{ left, top, width, height, transform: `scale(${zoom})` }}
      {...{ [PORTAL_SURFACE_ATTR]: 'embed' }}
    >
      <iframe
        title={node.link.meta?.title ?? provider.name}
        src={provider.embed.src}
        allow={provider.embed.allow}
        allowFullScreen
        referrerPolicy="strict-origin"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
        loading="eager"
        onLoad={() => setLoaded(true)}
      />
      {/* At screen size, however far the board is zoomed. */}
      <div className="lnk-embed__bar" style={{ transform: `scale(${1 / zoom})` }}>
        <button type="button" className="lnk-embed__btn" onClick={() => openLink(node.link.url)} aria-label={`Open in ${provider.name}`}>
          <ExternalLink size={13} aria-hidden /> Open
        </button>
        <button type="button" className="lnk-embed__btn lnk-embed__btn--icon" onClick={onClose} aria-label="Stop interacting">
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
};
