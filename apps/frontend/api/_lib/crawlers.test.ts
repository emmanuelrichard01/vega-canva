import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { BOARD_PATTERN, isUnfurler, SEARCH_ENGINES, UNFURLERS } from './crawlers.js';

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
  rewrites: Array<{ source: string; destination: string; has?: Array<{ type: string; key: string; value?: string }> }>;
};

/** Real agents, as the services send them. */
const AGENTS = {
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  slackImages: 'Slack-ImgProxy (+https://api.slack.com/robots)',
  x: 'Twitterbot/1.0',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  imessage: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0',
  linkedin: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  whatsapp: 'WhatsApp/2.23.20.0 A',
  telegram: 'TelegramBot (like TwitterBot)',
  teams: 'Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5 skype-url-preview@microsoft.com',
  google: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
};

const HUMANS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]',
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Instagram 350.0',
];

describe('crawler detection', () => {
  it('recognises every unfurler a board link is pasted into', () => {
    for (const [name, agent] of Object.entries(AGENTS)) expect(isUnfurler(agent), name).toBe(true);
  });

  it('leaves people, including in-app browsers, to the app', () => {
    for (const agent of HUMANS) expect(isUnfurler(agent), agent).toBe(false);
    expect(isUnfurler(null)).toBe(false);
    expect(isUnfurler('')).toBe(false);
  });

  it('keeps search engines out of the unfurl-only list', () => {
    expect(isUnfurler(AGENTS.google, { search: false })).toBe(false);
    expect(isUnfurler(AGENTS.slack, { search: false })).toBe(true);
    for (const name of SEARCH_ENGINES) expect(UNFURLERS as readonly string[]).not.toContain(name);
  });

  it('is the exact pattern vercel.json rewrites board and invite links with', () => {
    const crawlerRewrites = vercel.rewrites.filter((r) => r.has?.some((h) => h.key === 'user-agent'));
    expect(crawlerRewrites.map((r) => r.source).sort()).toEqual(['/i/:token', '/room/:id']);
    for (const rewrite of crawlerRewrites) {
      expect(rewrite.has!.find((h) => h.key === 'user-agent')!.value).toBe(BOARD_PATTERN);
      expect(rewrite.destination.startsWith('/api/share?')).toBe(true);
    }
  });
});
