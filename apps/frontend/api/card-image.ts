import { safeId } from './_lib/shareHtml.js';

/**
 * A board's share picture, from this site's edge.
 *
 * The sync server draws it (`apps/server/src/share/routes.ts`); this puts it
 * behind the CDN. An unfurler fetching the picture of a board shared an hour
 * ago gets it from the edge in milliseconds instead of waking the server, and
 * the URL carries the card's version, so a cached picture can never be the
 * wrong one — an edited board is a different URL.
 *
 * When the server cannot be reached the generic board picture is served in its
 * place, briefly cached, rather than an error that would leave the unfurl
 * without an image for as long as the unfurler remembers it.
 */

export const config = { runtime: 'edge' };

const api = () =>
  (process.env.SHARE_API_URL || process.env.VITE_API_URL || 'https://vega-canva.onrender.com').replace(/\/+$/, '');

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const id = safeId(url.searchParams.get('id') ?? '');
  const version = url.searchParams.get('v');
  const fallback = () => Response.redirect(new URL('/og-board.png', url.origin).toString(), 302);

  if ((kind !== 'room' && kind !== 'invite') || !id) return fallback();

  const source = `${api()}/cards/${kind}/${encodeURIComponent(id)}/image.png${version ? `?v=${encodeURIComponent(version)}` : ''}`;
  try {
    const res = await fetch(source, { signal: AbortSignal.timeout(8000) });
    if (!res.ok || res.headers.get('content-type') !== 'image/png') return fallback();
    return new Response(res.body, {
      headers: {
        'Content-Type': 'image/png',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': version
          ? 'public, max-age=86400, s-maxage=31536000, immutable'
          : 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
      },
    });
  } catch {
    return fallback();
  }
}
