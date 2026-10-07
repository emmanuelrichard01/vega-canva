/**
 * The link card's paint.
 *
 * A card is *content* — a clipping of somebody else's page pinned to the board —
 * so it stays paper in both themes, the rule tables already follow: content is
 * light, chrome follows the theme. A dark card on a dark board would read as
 * app chrome rather than as the thing that was pasted.
 */
export const LINK_CARD = {
  background: '#FFFFFF',
  border: '#E4E7EC',
  text: '#101828',
  muted: '#667085',
  faint: '#98A2B3',
  mediaGround: '#F2F4F7',
  skeleton: '#EAECF0',
  /** The broken-link pill: red ink on a pale red ground, 6.3:1. */
  failGround: '#FEF3F2',
  failInk: '#B42318',
  font: 'Inter, system-ui, -apple-system, sans-serif',
} as const;
