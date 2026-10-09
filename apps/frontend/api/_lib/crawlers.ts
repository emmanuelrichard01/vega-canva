/**
 * Who gets the server-rendered link page instead of the app.
 *
 * `vercel.json` cannot import code, so its rewrites carry these lists as a
 * regular expression; `crawlers.test.ts` fails if the two disagree, which is
 * what keeps an unfurler added here from silently never matching there.
 *
 * ## Two lists
 *
 * **Unfurlers** fetch a link to draw a card in a chat or a feed: they never
 * run scripts, so without this they see the home page's tags on every link.
 * **Search engines** run scripts and index; a board link is answered for them
 * too, because the answer carries `noindex` without waiting for the app to
 * boot and say so. The templates gallery, which search *should* index as the
 * app renders it, is rewritten for unfurlers alone.
 *
 * Substrings, not full agents, and only distinctive ones: a pattern that also
 * matched an in-app browser would send a person to a page of meta tags (which
 * forwards them on, with `app=1`, but costs them a hop).
 */

export const UNFURLERS = [
  'Slackbot',
  'Slack-ImgProxy',
  'Twitterbot',
  'facebookexternalhit',
  'Facebot',
  'LinkedInBot',
  'Discordbot',
  'WhatsApp/',
  'TelegramBot',
  'SkypeUriPreview',
  'MicrosoftPreview',
  'redditbot',
  'Embedly',
  'Iframely',
  'Pinterestbot',
  'vkShare',
  'Mastodon',
  'Pleroma',
  'Misskey',
  'Bluesky Cardyb',
  'Snap URL Preview',
  'Google-PageRenderer',
  'Synapse',
  'Discourse',
  'XING-contenttabreceiver',
  'Quora Link Preview',
] as const;

export const SEARCH_ENGINES = [
  'Applebot',
  'Googlebot',
  'Google-InspectionTool',
  'bingbot',
  'BingPreview',
  'DuckDuckBot',
  'YandexBot',
] as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The `has.value` pattern a `vercel.json` rewrite matches a user agent with. */
export function userAgentPattern(names: readonly string[]): string {
  return `.*(${names.map(escape).join('|')}).*`;
}

export const BOARD_PATTERN = userAgentPattern([...UNFURLERS, ...SEARCH_ENGINES]);
export const UNFURL_PATTERN = userAgentPattern(UNFURLERS);

/** Whether a request comes from something that reads tags rather than runs the app. */
export function isUnfurler(userAgent: string | null | undefined, { search = true } = {}): boolean {
  if (!userAgent) return false;
  return new RegExp(search ? BOARD_PATTERN : UNFURL_PATTERN).test(userAgent);
}
