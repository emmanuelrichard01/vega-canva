import React, { useEffect, useMemo, useState } from 'react';
import { EyeOff } from 'lucide-react';
import { roomId as currentRoomId } from '../../engine/document/doc';
import { setBoardMetadata } from '../../engine/document/mutations';
import { useRoomState } from '../../hooks/useSync';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useStore } from '../../hooks/useStore';
import { previewsHidden, requestCardFlush, SHARE_PREVIEW_KEY } from '../../engine/share/shareCard';
import { shareCardImageUrl } from '../../utils/endpoints';
import type { RoomRole } from '../../engine/model/permissions';
import './linkPreview.css';

const ACCESS: Record<RoomRole, string> = {
  editor: 'Can edit',
  commenter: 'Can comment',
  viewer: 'View only',
};

/**
 * What the link will look like when it is pasted into a chat.
 *
 * Sharing a board is usually pasting a link into Slack, Teams or iMessage, and
 * what arrives there is a card this app does not otherwise show anyone: the
 * board's name, what is on it, and a picture. So the dialog shows that card —
 * the real one, drawn by the same server that answers the unfurlers — before
 * the link goes anywhere, and offers the one decision that belongs to it:
 * whether the name and picture travel with the link at all.
 *
 * Laid out as chat apps lay a rich link out — the picture first, then the
 * site, the title and the description beneath it on one card — so it is
 * recognisable as "the preview" at a glance without imitating any one app's
 * chrome. The facts underneath are this dialog's addition: what is on the
 * board, and what the link lets people do.
 */
export const LinkPreview: React.FC<{ role: RoomRole }> = ({ role }) => {
  const { metadata } = useRoomState();
  const { canEdit } = useRoomPermissions();
  const total = useStore((s) => {
    let n = 0;
    for (const node of Object.values(s.objects)) if (!node.hidden && node.type !== 'comment') n++;
    return n;
  });
  const hidden = previewsHidden(metadata);
  const name = metadata?.name?.trim() || 'Untitled Workspace';

  /**
   * The picture, once the board has published itself.
   *
   * Asked for as the dialog opens and whenever previews are switched back on,
   * so the image is the board as it is now. The timestamp only defeats this
   * browser's cache of the unversioned URL; the server ignores it.
   */
  const [image, setImage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (hidden) {
      setImage('/og-board.png');
      return;
    }
    let cancelled = false;
    setImage(null);
    void requestCardFlush().then(() => {
      if (!cancelled) setImage(`${shareCardImageUrl(currentRoomId)}?t=${Date.now()}`);
    });
    return () => {
      cancelled = true;
    };
  }, [hidden]);
  useEffect(() => setLoaded(false), [image]);

  const contents = total === 0 ? 'An empty board' : `${total.toLocaleString()} object${total === 1 ? '' : 's'} on the board`;
  const title = hidden ? 'A board on Vega Studio' : `${name} | Vega Studio`;
  const description = hidden
    ? 'Open the link to see the board and work on it together, live.'
    : `${contents}. Open it to ${role === 'viewer' ? 'look around' : 'draw, write and comment together'}, live, on Vega Studio.`;

  const facts = useMemo(
    () => [
      ...(hidden ? [] : [{ label: 'On the board', value: contents }]),
      { label: 'This link', value: ACCESS[role] },
    ],
    [hidden, contents, role]
  );

  const toggle = () => {
    if (!canEdit) return;
    setBoardMetadata(SHARE_PREVIEW_KEY, hidden ? 'on' : 'off');
  };

  return (
    <section className="share__unfurl" aria-labelledby="share-unfurl-title">
      <div className="share__unfurl-head">
        <h3 id="share-unfurl-title" className="share__unfurl-title">Link preview</h3>
        <label className={`share__unfurl-toggle${canEdit ? '' : ' is-locked'}`}>
          <span>Show name and picture</span>
          <button
            type="button"
            role="switch"
            aria-checked={!hidden}
            aria-disabled={!canEdit || undefined}
            className="grid-switch"
            data-active={!hidden || undefined}
            onClick={toggle}
            title={canEdit ? undefined : 'Only people who can edit the board can change this'}
          >
            <span className="grid-switch__dot" />
          </button>
        </label>
      </div>

      <figure className="lp-card" aria-label={`How this link looks when shared: ${title}`}>
        {/* The picture leads, as it does in every chat that unfurls a link:
            it is what people recognise before they read anything. Held at
            the card's own 1200 by 630 from the first frame so nothing jumps. */}
        <div className={`lp-card__image${loaded ? ' is-loaded' : ''}`}>
          {image && (
            <img
              key={image}
              src={image}
              alt=""
              width={1200}
              height={630}
              onLoad={() => setLoaded(true)}
              onError={() => setImage('/og-board.png')}
            />
          )}
        </div>
        <figcaption className="lp-card__body">
          <span className="lp-card__site">
            <img src="/favicon.svg" alt="" width={14} height={14} />
            Vega Studio
          </span>
          <span className="lp-card__title">{title}</span>
          <span className="lp-card__desc">{description}</span>
          <dl className="lp-card__facts">
            {facts.map((fact) => (
              <div key={fact.label} className="lp-card__fact">
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </figcaption>
      </figure>

      <p className="share__hint">
        {hidden ? (
          <>
            <EyeOff size={12} aria-hidden="true" className="share__hint-icon" />
            Chats get a plain card with no name or picture. The link still opens the board.
          </>
        ) : (
          'What Slack, Teams, iMessage and X show when the link is pasted. It follows the board as it changes.'
        )}
      </p>
    </section>
  );
};
