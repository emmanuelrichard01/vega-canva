/**
 * The words a shared link unfurls into, in one place.
 *
 * Two things show them: the page link unfurlers read (`api/_lib/shareHtml.ts`,
 * on Vercel's edge) and the Share dialog's preview card
 * (`components/share/LinkPreview.tsx`), which exists to show exactly what the
 * unfurl will say before the link goes anywhere. They used to compose the copy
 * separately and could drift; now both call this, so the preview is the unfurl.
 *
 * Pure and dependency-free, because the edge function imports it too.
 *
 * ## Privacy
 *
 * `facts` is `null` whenever the board must not be described — previews are
 * off, the card service could not be reached, or the link is not one the
 * service will vouch for — and then every string here is generic: no name, no
 * count, no frame. A frame link without facts says "a frame", nothing more.
 */

export type InviteRole = 'viewer' | 'commenter' | 'editor';

export const SITE_NAME = 'Vega Studio';

export const ACCESS: Record<InviteRole, string> = {
  editor: 'Can edit',
  commenter: 'Can comment',
  viewer: 'View only',
};

/**
 * Most unfurlers cut a title at about 70 characters and a description at
 * about 200 (X shows less; LinkedIn and Slack show about this). Cutting here,
 * at a word, reads better than letting each app cut mid-word.
 */
export const MAX_TITLE = 70;
export const MAX_DESCRIPTION = 200;

export interface UnfurlFrame {
  name: string;
  icon?: string;
}

export interface UnfurlFacts {
  name: string;
  total: number;
  frame?: UnfurlFrame | null;
}

export interface UnfurlInput {
  facts: UnfurlFacts | null;
  /** What the link lets people do; `null` when the link does not say. */
  access: InviteRole | null;
  /** The link points at one frame (`?frame=`). */
  framed?: boolean;
}

export interface UnfurlCopy {
  title: string;
  description: string;
  imageAlt: string;
  /** Slack shows these as labelled facts under the card (`twitter:label1/2`). */
  facts: Array<{ label: string; value: string }>;
}

/** Cut to `max` characters at a word, with an ellipsis. Counts code points, so emoji are never split. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  let cut = chars.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  if (space > max * 0.5) cut = cut.slice(0, space);
  return `${cut.replace(/[\s,.;:–—-]+$/, '')}…`;
}

export function contentsLine(total: number): string {
  return total === 0 ? 'An empty board' : `${total.toLocaleString('en-US')} object${total === 1 ? '' : 's'} on the board`;
}

const suffix = ` | ${SITE_NAME}`;

/** `name | Vega Studio`, with the name — not the product — giving way when it is long. */
function titled(name: string): string {
  return `${truncate(name, MAX_TITLE - suffix.length)}${suffix}`;
}

export function unfurlCopy({ facts, access, framed = false }: UnfurlInput): UnfurlCopy {
  const accessLabel = access ? ACCESS[access] : null;
  const verb = access === 'viewer' ? 'look around' : 'draw, write and comment together';

  if (!facts) {
    return {
      title: framed ? `A frame on a ${SITE_NAME} board` : `A board on ${SITE_NAME}`,
      description: 'Open the link to see the board and work on it together, live.',
      imageAlt: `A board on ${SITE_NAME}`,
      facts: accessLabel ? [{ label: 'This link', value: accessLabel }] : [],
    };
  }

  const contents = contentsLine(facts.total);
  const frame = facts.frame ?? null;
  const frameLabel = frame ? `${frame.icon ? `${frame.icon} ` : ''}${frame.name}` : null;
  const title = frameLabel ? titled(`${frameLabel} · ${facts.name}`) : titled(facts.name);
  const description = frame
    ? `The “${frame.name}” frame on ${facts.name}. ${contents}. Open it to ${verb}, live, on ${SITE_NAME}.`
    : `${contents}. Open it to ${verb}, live, on ${SITE_NAME}.`;

  return {
    title,
    description: truncate(description, MAX_DESCRIPTION),
    imageAlt: truncate(`${facts.name}: a picture of the board`, 120),
    facts: [
      { label: frame ? 'Frame' : 'On the board', value: frame ? truncate(frame.name, 60) : contents },
      ...(accessLabel ? [{ label: 'This link', value: accessLabel }] : []),
    ],
  };
}
