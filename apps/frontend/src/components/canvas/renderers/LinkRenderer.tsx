import React from 'react';
import { Circle, Group, Image as KonvaImage, Path, Rect, Text } from 'react-konva';
import useImage from 'use-image';
import type { LinkNode } from '../../../engine/model/schema';
import { coverCrop, DESC_LINE, layoutLinkCard, resolveDisplay, TITLE_LINE } from '../../../engine/link/linkLayout';
import { providerFor, siteDomain } from '../../../engine/link/linkProviders';
import { LINK_CARD } from '../../../engine/link/linkStyle';
import { claimRemaining, ensurePreview } from '../../../engine/link/linkApply';
import { useStore } from '../../../hooks/useStore';

/**
 * A link on the canvas: chip, horizontal card, vertical card, or embed.
 *
 * ## Every state is a designed state
 *
 * A link card spends real time without its preview — the fetch is a round trip
 * through the server to somebody else's site — and some previews never come.
 * So loading is a skeleton in the card's final shape rather than a spinner, an
 * error is still a usable card (the address, the provider, "double-click to
 * open") rather than a broken one, and a card with no picture lays its text out
 * as a text card rather than leaving a grey hole where the image would be.
 *
 * ## Embeds are posters until asked
 *
 * An embed draws its poster and a play affordance on the canvas. The live
 * iframe is a DOM layer (`EmbedLayer`) that exists only while that one embed is
 * active: a board of twenty videos would otherwise be twenty pages running at
 * once, each swallowing the wheel and the pointer so the board could not be
 * panned across it.
 */

/** A 14px arrow-up-right, the universal "this leaves the board" mark. */
const OPEN_GLYPH = 'M4 10 L10 4 M5 4 H10 V9';

export const LinkRenderer: React.FC<{ node: LinkNode }> = ({ node }) => {
  const { link } = node;
  const provider = React.useMemo(() => providerFor(link.url), [link.url]);
  const display = resolveDisplay(link.display, node.width, node.height, Boolean(provider.embed));
  const meta = link.meta;
  const [image, imageStatus] = useImage(meta?.image ?? '', 'anonymous');
  const [favicon] = useImage(meta?.favicon ?? '', 'anonymous');
  const active = useStore((s) => s.embedActiveNodeId === node.id);

  // Fill in the preview, now or once someone else's stale claim lapses.
  React.useEffect(() => {
    if (link.status !== 'loading') return;
    const wait = claimRemaining(link);
    if (wait === 0) {
      void ensurePreview(node.id);
      return;
    }
    const t = window.setTimeout(() => void ensurePreview(node.id), wait + 250);
    return () => window.clearTimeout(t);
  }, [link, node.id]);

  const hasImage = Boolean(meta?.image && image);
  /**
   * Whether this card has a picture *coming*, which is not the same question as
   * whether it has one now.
   *
   * The layout used to be decided by "is the picture decoded yet", so every
   * card with a picture laid itself out twice — once as a text card in the
   * moment before the bytes arrived, then again with the picture — and visibly
   * jumped between the two. Now the slot is reserved the instant we know a
   * picture is coming, whether that is because the server is still fetching it
   * (`imagePending`) or because it has given us the address and the browser is
   * decoding it. Only a picture that has actually *failed* gives its space back.
   */
  const expectsImage = Boolean(meta?.imagePending) || (Boolean(meta?.image) && imageStatus !== 'failed');
  const layout = layoutLinkCard(display, node.width, node.height, display === 'embed' ? true : expectsImage, Boolean(meta?.description));
  const loading = link.status === 'loading';
  const failed = link.status === 'error';
  const domain = siteDomain(link.url);
  const title = meta?.title || (loading ? '' : provider.id === 'web' ? domain : provider.detail ? `${provider.name} · ${provider.detail}` : provider.name);
  const site = meta?.siteName || (provider.id === 'web' ? domain : provider.name);
  const description = failed ? `${link.error ?? 'No preview'}. Double-click to open.` : meta?.description;
  const W = node.width;
  const H = node.height;

  const clip = (ctx: { beginPath: () => void; roundRect?: (...a: number[]) => void; rect: (...a: number[]) => void; closePath: () => void }) => {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, W, H, layout.radius);
    else ctx.rect(0, 0, W, H);
    ctx.closePath();
  };

  const icon = layout.icon;
  const letter = (domain[0] ?? '?').toUpperCase();

  const media = layout.media;
  const mediaNode = media ? (
    <Group x={media.x} y={media.y}>
      <Rect width={media.width} height={media.height} fill={display === 'embed' ? '#0B0D12' : LINK_CARD.mediaGround} />
      {image && hasImage && !active && (
        <KonvaImage
          image={image}
          width={media.width}
          height={media.height}
          crop={coverCrop(image.naturalWidth, image.naturalHeight, media.width, media.height)}
          opacity={display === 'embed' ? 0.92 : 1}
        />
      )}
      {!hasImage && display === 'embed' && !active && (
        <Rect
          width={media.width}
          height={media.height}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: media.width, y: media.height }}
          fillLinearGradientColorStops={[0, provider.accent, 1, '#0B0D12']}
          opacity={0.85}
        />
      )}
      {display === 'embed' && !active && (
        <Group x={media.width / 2} y={media.height / 2}>
          {provider.kind === 'video' || provider.kind === 'audio' ? (
            <>
              <Circle radius={26} fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} />
              <Path data="M-7 -11 L12 0 L-7 11 Z" fill="#FFFFFF" />
            </>
          ) : (
            <>
              <Rect x={-96} y={-15} width={192} height={30} cornerRadius={15} fill="rgba(0,0,0,0.55)" />
              <Text x={-96} y={-15} width={192} height={30} align="center" verticalAlign="middle" text="Double-click to interact" fontFamily={LINK_CARD.font} fontSize={12} fontStyle="600" fill="#FFFFFF" />
            </>
          )}
        </Group>
      )}
      {/*
        * The picture's place while it is on its way.
        *
        * Tinted with the site's own colour rather than left grey: the card
        * already knows whose page this is by the time the picture is still
        * coming, and a faint wash of the brand reads as "loading this site"
        * where a grey rectangle reads as "something is broken". The same
        * treatment the embed poster uses, at a quarter of the strength.
        */}
      {!hasImage && expectsImage && display !== 'embed' && (
        <Rect
          width={media.width}
          height={media.height}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: media.width, y: media.height }}
          fillLinearGradientColorStops={[0, LINK_CARD.skeleton, 1, provider.accent]}
          opacity={0.22}
        />
      )}
    </Group>
  ) : null;

  return (
    <Group>
      <Rect width={W} height={H} fill={LINK_CARD.background} cornerRadius={layout.radius} />
      <Group clipFunc={clip as never}>
        {display === 'embed' && <Rect width={W} height={40 + 4} fill="#FFFFFF" />}
        {mediaNode}

        {/* The site's mark, or its initial on the brand's tint. */}
        <Group x={icon.x} y={icon.y}>
          <Rect width={icon.size} height={icon.size} cornerRadius={icon.size * 0.26} fill={provider.accent} opacity={favicon ? 0.08 : 0.14} />
          {favicon ? (
            <KonvaImage
              image={favicon}
              x={display === 'compact' ? icon.size * 0.2 : 0}
              y={display === 'compact' ? icon.size * 0.2 : 0}
              width={display === 'compact' ? icon.size * 0.6 : icon.size}
              height={display === 'compact' ? icon.size * 0.6 : icon.size}
            />
          ) : (
            <Text width={icon.size} height={icon.size} align="center" verticalAlign="middle" text={letter} fontFamily={LINK_CARD.font} fontStyle="700" fontSize={icon.size * 0.52} fill={provider.accent} />
          )}
        </Group>

        {display !== 'compact' && display !== 'embed' && layout.site.width > 0 && (
          <Text x={layout.site.x} y={layout.site.y} width={layout.site.width} height={16} verticalAlign="middle" text={site} wrap="none" ellipsis fontFamily={LINK_CARD.font} fontSize={12} fontStyle="500" fill={LINK_CARD.muted} />
        )}

        {loading && !meta ? (
          <>
            <Rect x={layout.title.x} y={layout.title.y + 2} width={Math.max(0, layout.title.width * 0.72)} height={layout.title.fontSize * 0.9} cornerRadius={4} fill={LINK_CARD.skeleton} />
            {display !== 'compact' && display !== 'embed' && (
              <Rect x={layout.title.x} y={layout.title.y + layout.title.fontSize * 1.6} width={Math.max(0, layout.title.width * 0.9)} height={10} cornerRadius={4} fill={LINK_CARD.skeleton} opacity={0.7} />
            )}
          </>
        ) : (
          <Text
            x={layout.title.x}
            y={layout.title.y}
            width={layout.title.width}
            height={layout.title.fontSize * TITLE_LINE * layout.title.lines + 1}
            text={title}
            wrap={layout.title.lines > 1 ? 'word' : 'none'}
            ellipsis
            lineHeight={TITLE_LINE}
            fontFamily={LINK_CARD.font}
            fontSize={layout.title.fontSize}
            fontStyle="600"
            fill={LINK_CARD.text}
          />
        )}

        {display === 'compact' && (
          <Text x={layout.title.x} y={layout.site.y} width={layout.site.width} height={16} text={domain} wrap="none" ellipsis fontFamily={LINK_CARD.font} fontSize={12} fill={LINK_CARD.muted} />
        )}

        {layout.description && description && (
          <Text
            x={layout.description.x}
            y={layout.description.y}
            width={layout.description.width}
            height={layout.description.fontSize * DESC_LINE * layout.description.lines + 1}
            text={description}
            wrap="word"
            ellipsis
            lineHeight={DESC_LINE}
            fontFamily={LINK_CARD.font}
            fontSize={layout.description.fontSize}
            fill={failed ? LINK_CARD.faint : LINK_CARD.muted}
          />
        )}

        {/* The domain along the foot of a vertical card, where people look for "where does this go". */}
        {display === 'vertical' && H - (layout.description ? layout.description.y + layout.description.height : layout.title.y + layout.title.height) > 34 && (
          <Text x={layout.title.x} y={H - 16 - 14} width={layout.title.width} height={14} text={domain} wrap="none" ellipsis fontFamily={LINK_CARD.font} fontSize={11.5} fill={LINK_CARD.faint} />
        )}

        {display === 'embed' && <Rect y={43} width={W} height={1} fill={LINK_CARD.border} />}

        {layout.action && (
          <Path x={layout.action.x} y={layout.action.y} data={OPEN_GLYPH} stroke={LINK_CARD.faint} strokeWidth={1.6} lineCap="round" lineJoin="round" scaleX={layout.action.size / 14} scaleY={layout.action.size / 14} />
        )}
      </Group>
      <Rect width={W} height={H} cornerRadius={layout.radius} stroke={LINK_CARD.border} strokeWidth={1} listening={false} />
    </Group>
  );
};
