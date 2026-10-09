import { safeFrameId, safeId, shareHtml, type CardFacts, type LinkKind } from './_lib/shareHtml.js';

/**
 * Board links, as link unfurlers see them.
 *
 * Reached only through the crawler rewrites in `vercel.json` — a person
 * opening `/room/…` gets the app, never this. It asks the sync server what the
 * board calls itself — and, for a `?frame=` link, what that frame is called —
 * and answers with a page of `<meta>` tags built from that
 * (`_lib/shareHtml.ts`).
 *
 * ## Built to be fast when the server is not
 *
 * The sync server sleeps when idle, and an unfurler waits a few seconds at
 * most before giving up and showing nothing. So the question gets 3.5 seconds;
 * past that the page still answers, with a generic board card and a static
 * picture, which is a lesser unfurl but never a missing one. Answers are cached
 * at the edge for five minutes and served stale for a day while they refresh,
 * so the second share of a link does not wait at all.
 */

export const config = { runtime: 'edge' };

const api = () =>
  (process.env.SHARE_API_URL || process.env.VITE_API_URL || 'https://vega-canva.onrender.com').replace(/\/+$/, '');

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') as LinkKind | null;
  const id = safeId(url.searchParams.get('id') ?? '');
  // Vercel carries the original query through a rewrite, so `?frame=` arrives here.
  const frame = safeFrameId(url.searchParams.get('frame'));
  const site = (process.env.VITE_SITE_URL || url.origin).replace(/\/+$/, '');

  if ((kind !== 'room' && kind !== 'invite') || !id) {
    return Response.redirect(`${site}/`, 302);
  }

  let facts: CardFacts | null = null;
  let reachable = false;
  try {
    const query = frame ? `?frame=${encodeURIComponent(frame)}` : '';
    const res = await fetch(`${api()}/cards/${kind}/${encodeURIComponent(id)}${query}`, {
      signal: AbortSignal.timeout(3500),
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      reachable = true;
      const body = (await res.json()) as Partial<CardFacts> & { found?: boolean; image?: string };
      if (body.found && typeof body.name === 'string' && body.name) {
        const named = body.frame && typeof body.frame.name === 'string' && body.frame.name ? body.frame : null;
        facts = {
          found: true,
          name: body.name.slice(0, 120),
          total: Math.max(0, Math.floor(Number(body.total) || 0)),
          role: body.role === 'viewer' || body.role === 'commenter' || body.role === 'editor' ? body.role : undefined,
          frame: named ? { name: named.name.slice(0, 80), ...(typeof named.icon === 'string' ? { icon: named.icon.slice(0, 16) } : {}) } : null,
          version: typeof body.image === 'string' ? new URL(body.image).searchParams.get('v') ?? undefined : undefined,
        };
      }
    }
  } catch {
    // Asleep, slow or down: the generic card below.
  }

  return new Response(shareHtml({ kind, id, site, facts, reachable, frame }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': reachable
        ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400'
        : // A fallback must not be what the edge remembers for five minutes.
          'public, max-age=0, s-maxage=15',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
