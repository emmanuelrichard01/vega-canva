import { isCssColor } from '../text/cssColor';

/**
 * What an icon node is allowed to say, enforced at the read boundary.
 *
 * `pack` and `iconId` end up in a URL path and a cache key, so they are held to
 * a strict charset: anything else is not an icon, and the node draws the
 * neutral placeholder instead of reaching `fetch`.
 */
export const PACK_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const ICON_ID = /^[a-z0-9][a-z0-9-]{0,47}\/[a-z0-9][a-z0-9.+-]{0,79}$/;
export const MAX_ICON_LABEL = 120;

export const isPackId = (v: unknown): v is string => typeof v === 'string' && PACK_ID.test(v);
export const isIconId = (v: unknown): v is string => typeof v === 'string' && ICON_ID.test(v);

export interface IconSpec {
  pack: string;
  iconId: string;
  colour?: string;
  label?: string;
}

/** An `IconSpec` every reader can rely on. Unusable references become empty strings, which draw the placeholder. */
export function normalizeIconSpec(raw: unknown): IconSpec {
  const r = (raw ?? {}) as Record<string, unknown>;
  const label = typeof r.label === 'string' ? r.label.slice(0, MAX_ICON_LABEL) : '';
  return {
    pack: isPackId(r.pack) ? r.pack : '',
    iconId: isIconId(r.iconId) ? r.iconId : '',
    ...(isCssColor(r.colour) ? { colour: (r.colour as string).trim() } : null),
    ...(label ? { label } : null),
  };
}
