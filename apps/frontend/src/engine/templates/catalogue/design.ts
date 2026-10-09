import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../../document/mutations';
import type { ChartSpec } from '../../chart/chartTypes';
import type { Template } from '../templates';
import { linked, sheet } from './dataKit';
import { Board, TYPE, grid, heightOf, widthOf, type TextStyle } from './designKit';

/**
 * Web, UI and social: the boards a product designer opens to start real work.
 *
 * Each one is a set of artboards at the sizes the work ships at (frame
 * presets where one exists), laid on an 8px grid with one type scale, one
 * radius set and the effects panel's own shadow presets, and written in the
 * voice of a real (fictional) brand. Nothing is lorem ipsum, and nothing is
 * imported: every picture on these boards is drawn from the shape library.
 */

// ---------------------------------------------------------------------------
// Beacon: the incident-management SaaS that the landing page, the design
// system, the dashboard and the launch-week kit all belong to.
// ---------------------------------------------------------------------------

const B = {
  ink: '#0C1A24',
  body: '#3D4F59',
  muted: '#5B6B73',
  line: '#E3E8E6',
  wash: '#F3F7F5',
  surface: '#F6F8F7',
  signal: '#0E7C66',
  signalDeep: '#0A5E4E',
  signalTint: '#E3F2EC',
  signalBright: '#5EC4A8',
  amber: '#F2B33D',
  amberTint: '#FDF1D8',
  amberInk: '#8A5A00',
  navyMuted: '#9FB1BA',
  navyLine: '#22343F',
  navyRaised: '#14262F',
  rose: '#B42318',
  roseTint: '#FDE7E4',
} as const;

const s = (base: TextStyle, over: Partial<TextStyle> = {}): TextStyle => ({ ...base, ...over });

// ---------------------------------------------------------------------------
// 1. SaaS landing page
// ---------------------------------------------------------------------------

/** Beacon's mark: a rounded tile with a ring in it, a lamp seen from above. */
function beaconMark(b: Board, x: number, y: number, size: number, tile: string = B.signal, ring = '#FFFFFF'): void {
  b.rect(x, y, size, size, { fill: tile, radius: Math.round(size * 0.28) });
  const r = Math.round(size * 0.56);
  b.rect(x + (size - r) / 2, y + (size - r) / 2, r, r, { kind: 'donut', fill: ring, geometry: { innerRatio: 0.45 } });
}

function landingBoard(limit?: number): NewNodeInput[] {
  const b = new Board();
  const W = 1440;
  const g = grid(0, 112, 72, 32);
  const C = (i: number) => g.col(i);
  const span = g.span;
  const mid = W / 2;

  // Height is known only once the page is laid out, so the frame is written
  // first and its height filled in at the end.
  const page = b.frame(0, 0, W, 100, {
    title: 'Beacon · Home · Desktop',
    icon: '🖥️',
    description: '1440 wide, 12 columns of 72 with 32 gutters, on an 8px rhythm',
    preset: 'desktop',
  });

  // ---- Navigation ---------------------------------------------------------
  beaconMark(b, C(0), 28, 32);
  b.label(C(0) + 44, 30, 'Beacon', { size: 22, weight: 700, lh: 1.2, ls: -0.3, color: B.ink });
  const links = ['Product', 'Customers', 'Pricing', 'Docs', 'Changelog'];
  const linkStyle: TextStyle = { size: 15, weight: 500, lh: 1.4, color: B.body };
  const gap = 40;
  const total = links.reduce((n, l) => n + widthOf(l, linkStyle), 0) + gap * (links.length - 1);
  let lx = mid - total / 2;
  for (const l of links) {
    lx += b.label(lx, 33, l, linkStyle).width + gap;
  }
  const cta = b.pill(0, 24, 40, 'Start free', { fill: B.ink, ink: '#FFFFFF', radius: 10, size: 15, padX: 18 });
  cta.x = C(11) + 72 - cta.width;
  const signIn = b.label(0, 33, 'Sign in', s(linkStyle, { color: B.ink }));
  signIn.x = cta.x - 28 - signIn.width;
  b.rule(0, 88, W, B.line);

  // ---- Hero ---------------------------------------------------------------
  const heroTop = 89;
  const h1 = 'Calm incidents.\nFaster fixes.';
  const h1Style = s(TYPE.display, { size: 72, lh: 1.05, ls: -1.75, color: B.ink, align: 'center' });
  const subStyle = s(TYPE.bodyL, { size: 20, lh: 1.6, color: B.body, align: 'center' });
  const sub =
    'Beacon pages the right engineer, opens the war room and writes the timeline while your team fixes the problem. Set up in an afternoon; your first ten seats are free.';
  const h1Y = heroTop + 96;
  const h1H = heightOf(h1, span(8), h1Style);
  const subY = h1Y + h1H + 24;
  const subH = heightOf(sub, 720, subStyle);
  const ctaY = subY + subH + 40;
  const shotY = ctaY + 56 + 80;
  const SHOT_H = 616;
  b.rect(0, heroTop, W, shotY + 360 - heroTop, { fill: B.wash });
  b.text(C(2), h1Y, span(8), h1, h1Style);
  b.text(mid - 360, subY, 720, sub, subStyle);
  b.button(mid - 192, ctaY, 200, 56, 'Start free trial', { fill: B.signal, ink: '#FFFFFF', radius: 12, size: 16, shadow: 'subtle' });
  b.button(mid + 24, ctaY, 168, 56, 'Book a demo', { fill: '#FFFFFF', ink: B.ink, stroke: B.line, radius: 12, size: 16 });
  b.label(mid, ctaY + 56 + 20, 'No credit card  ·  SOC 2 Type II  ·  SSO on every plan', s(TYPE.small, { color: B.muted, align: 'center' }));

  // The product shot: the incident console, drawn from shapes.
  productShot(b, C(1), shotY, span(10), SHOT_H);

  // ---- Logo cloud ---------------------------------------------------------
  const logosY = shotY + SHOT_H + 96;
  b.label(mid, logosY, 'Trusted by 2,400 on-call teams, from seed stage to the Fortune 500', s(TYPE.small, { size: 15, color: B.muted, align: 'center' }));
  const marks: Array<[string, TextStyle]> = [
    ['Northwind', { size: 26, weight: 600, ls: -0.6, family: 'Outfit' }],
    ['HALCYON', { size: 21, weight: 700, ls: 3, family: 'Space Grotesk' }],
    ['kestrel', { size: 28, weight: 800, ls: -1 }],
    ['Parallax', { size: 25, weight: 500, family: 'Space Grotesk' }],
    ['Vantage', { size: 27, weight: 700, ls: -0.4, family: 'Georgia' }],
    ['orbitly', { size: 26, weight: 600, ls: -0.5, family: 'Outfit' }],
  ];
  marks.forEach(([name, style], i) => {
    const cx = C(i * 2) + span(2) / 2;
    b.label(cx, logosY + 56, name, { ...style, lh: 1.2, color: B.muted, align: 'center' });
  });

  // ---- Features -----------------------------------------------------------
  const featY = logosY + 56 + 34 + 128;
  const h2Style = s(TYPE.h2, { color: B.ink, align: 'center' });
  const featH2 = 'Everything an incident needs,\nin the order it needs it';
  b.text(C(2), featY, span(8), featH2, h2Style);
  const featSubY = featY + heightOf(featH2, span(8), h2Style) + 16;
  const featSub = 'From the first alert to the last action item, Beacon keeps responders, stakeholders and customers working from the same page.';
  const featSubStyle = s(TYPE.bodyL, { color: B.body, align: 'center' });
  b.text(mid - 336, featSubY, 672, featSub, featSubStyle);
  const cardsY = featSubY + heightOf(featSub, 672, featSubStyle) + 64;
  const features: Array<[string, string, string]> = [
    ['bolt', 'Paging that escalates itself', 'Routes by schedule, service and time zone, then escalates until someone acknowledges. Phone, SMS, push and Slack.'],
    ['chat', 'War rooms in one click', 'Opens the Slack channel, the video bridge and the incident doc together, with the right people already in them.'],
    ['activity', 'A timeline nobody has to write', 'Every alert, command, deploy and message lands on one timeline, stamped to the second and kept for the review.'],
    ['document', 'Postmortems, drafted', 'Beacon turns the timeline into a first draft with impact, cause and actions, ready to review the next morning.'],
    ['globe', 'Status pages customers trust', 'Post an update once and it reaches your status page, email subscribers and the in-app banner together.'],
    ['gear', 'Fits the stack you run', 'Two-minute integrations with Datadog, Grafana, Sentry, CloudWatch and sixty more. PagerDuty schedules import as-is.'],
  ];
  const CARD_H = 256;
  features.forEach(([kind, title, body], i) => {
    const x = C((i % 3) * 4);
    const y = cardsY + Math.floor(i / 3) * (CARD_H + 32);
    b.rect(x, y, span(4), CARD_H, { fill: '#FFFFFF', stroke: B.line, radius: 16 });
    b.rect(x + 32, y + 32, 48, 48, { fill: B.signalTint, radius: 12 });
    b.glyph(x + 44, y + 44, 24, kind, B.signalTint, B.signal, 1.75);
    b.text(x + 32, y + 104, span(4) - 64, title, s(TYPE.title, { color: B.ink }));
    b.text(x + 32, y + 142, span(4) - 64, body, s(TYPE.body, { color: B.body }));
  });

  // ---- Testimonial --------------------------------------------------------
  const quoteY = cardsY + CARD_H * 2 + 32 + 128;
  const QUOTE_H = 488;
  b.rect(0, quoteY, W, QUOTE_H, { fill: B.ink });
  b.label(C(0), quoteY + 80, '“', { size: 96, weight: 700, lh: 0.9, color: B.amber }, B.ink);
  const quote =
    'We cut time to acknowledge from eleven minutes to ninety seconds in our first month. The timeline alone saves us a day on every postmortem.';
  const quoteStyle: TextStyle = { size: 32, weight: 500, lh: 1.4, ls: -0.4, color: '#FFFFFF' };
  b.text(C(0), quoteY + 168, span(7), quote, quoteStyle, B.ink);
  const attribY = quoteY + 168 + heightOf(quote, span(7), quoteStyle) + 40;
  b.disc(C(0) + 26, attribY + 26, 26, B.signal, { label: 'PR', size: 17 });
  b.label(C(0) + 68, attribY + 4, 'Priya Raman', { size: 17, weight: 600, lh: 1.4, color: '#FFFFFF' }, B.ink);
  b.label(C(0) + 68, attribY + 30, 'Staff SRE, Kestrel', { size: 15, weight: 450, lh: 1.4, color: B.navyMuted }, B.ink);
  const stats: Array<[string, string]> = [
    ['−86%', 'time to acknowledge'],
    ['3.4×', 'faster postmortems'],
    ['99.98%', 'page delivery, last 12 months'],
  ];
  stats.forEach(([value, caption], i) => {
    const y = quoteY + 80 + i * 112;
    if (i) b.rule(C(8), y - 20, span(4), B.navyLine);
    b.label(C(8), y, value, { size: 44, weight: 700, lh: 1.1, ls: -1, color: B.amber }, B.ink);
    b.label(C(8), y + 54, caption, { size: 15, weight: 450, lh: 1.4, color: B.navyMuted }, B.ink);
  });

  // ---- Pricing ------------------------------------------------------------
  const priceY = quoteY + QUOTE_H + 128;
  b.text(C(2), priceY, span(8), 'Pricing that scales with your rota', h2Style);
  const priceSub = 'Every plan includes unlimited incidents, status pages and the mobile app. Change plans or cancel at any time.';
  b.text(mid - 336, priceY + 64, 672, priceSub, featSubStyle);
  const tiersY = priceY + 64 + heightOf(priceSub, 672, featSubStyle) + 64;
  const TIER_H = 600;
  const tiers = [
    {
      name: 'Starter',
      blurb: 'For small teams putting their first rota together.',
      price: '$0',
      unit: 'up to 10 seats',
      cta: 'Start free',
      features: ['On-call schedules and escalations', 'Slack and Microsoft Teams', 'One public status page', 'Email and push alerts'],
    },
    {
      name: 'Team',
      blurb: 'For engineering orgs running incidents every week.',
      price: '$19',
      unit: 'per seat / month, billed yearly',
      cta: 'Start 14-day trial',
      features: ['Everything in Starter', 'Phone and SMS paging', 'War rooms and live timeline', 'Drafted postmortems', 'Unlimited status pages'],
      popular: true,
    },
    {
      name: 'Enterprise',
      blurb: 'For companies with compliance and scale to answer for.',
      price: 'Custom',
      unit: 'annual contract',
      cta: 'Talk to sales',
      features: ['Everything in Team', 'SAML SSO and SCIM', 'Audit log, EU or US residency', '99.99% paging SLA', 'A named success engineer'],
    },
  ];
  tiers.forEach((t, i) => {
    const x = C(i * 4);
    const w = span(4);
    const popular = Boolean(t.popular);
    b.rect(x, tiersY, w, TIER_H, { fill: '#FFFFFF', stroke: popular ? B.signal : B.line, strokeWidth: popular ? 2 : 1, radius: 20, ...(popular ? { shadow: 'medium' as const } : null) });
    b.label(x + 32, tiersY + 36, t.name, s(TYPE.title, { color: B.ink }));
    if (popular) {
      const chip = b.pill(0, tiersY + 34, 28, 'Most popular', { fill: B.amberTint, ink: B.amberInk, radius: 14, size: 13, padX: 12 });
      chip.x = x + w - 32 - chip.width;
    }
    b.text(x + 32, tiersY + 76, w - 64, t.blurb, s(TYPE.body, { size: 15, color: B.body }));
    const priceStyle: TextStyle = { size: 48, weight: 700, lh: 1.1, ls: -1.2, color: B.ink };
    const price = b.label(x + 32, tiersY + 148, t.price, priceStyle);
    b.label(x + 32 + price.width + 8, tiersY + 176, t.unit, s(TYPE.small, { color: B.muted }));
    b.button(x + 32, tiersY + 232, w - 64, 48, t.cta, popular
      ? { fill: B.signal, ink: '#FFFFFF', radius: 12, size: 15 }
      : { fill: '#FFFFFF', ink: B.ink, stroke: B.line, radius: 12, size: 15 });
    b.rule(x + 32, tiersY + 312, w - 64, B.line);
    t.features.forEach((f, j) => {
      const fy = tiersY + 340 + j * 40;
      b.check(x + 32, fy + 4, 14, B.signal, 2);
      b.text(x + 60, fy, w - 92, f, s(TYPE.body, { size: 15, lh: 1.5, color: B.body }));
    });
  });

  // ---- FAQ ----------------------------------------------------------------
  const faqY = tiersY + TIER_H + 128;
  const faqH2 = s(TYPE.h2, { color: B.ink });
  b.text(C(0), faqY, span(4), 'Questions,\nanswered', faqH2);
  const faqLede = 'Can’t find what you need? Our support engineers answer within an hour, around the clock.';
  const faqLedeY = faqY + heightOf('Questions,\nanswered', span(4), faqH2) + 16;
  b.text(C(0), faqLedeY, span(4), faqLede, s(TYPE.body, { color: B.body }));
  b.label(C(0), faqLedeY + heightOf(faqLede, span(4), TYPE.body) + 16, 'Contact support  →', s(TYPE.body, { weight: 600, color: B.signalDeep }));
  const faqs: Array<[string, string?]> = [
    ['How long does setup take?', 'Most teams are paging within an hour. Import schedules from PagerDuty or Opsgenie, connect your monitoring, and Beacon maps services to their owners for you.'],
    ['Can we run PagerDuty alongside Beacon while we switch?'],
    ['Is Beacon SOC 2 and ISO 27001 certified?'],
    ['What counts as a seat?'],
    ['Where is our incident data stored?'],
  ];
  let fy = faqY;
  const qx = C(5);
  const qw = span(7);
  faqs.forEach(([q, a], i) => {
    if (i) b.rule(qx, fy, qw, B.line);
    const top = fy + 28;
    b.text(qx, top, qw - 64, q, s(TYPE.title, { size: 18, color: B.ink }));
    // The disclosure: a minus on the open row, a plus on the others.
    b.rule(qx + qw - 18, top + 12, 16, B.ink, false, 2);
    if (!a) b.rule(qx + qw - 11, top + 5, 16, B.ink, true, 2);
    let bottom = top + 30;
    if (a) {
      const ans = s(TYPE.body, { color: B.body });
      b.text(qx, top + 40, qw - 96, a, ans);
      bottom = top + 40 + heightOf(a, qw - 96, ans);
    }
    fy = bottom + 28;
  });
  b.rule(qx, fy, qw, B.line);

  // ---- Closing call to action and footer ---------------------------------
  const footY = Math.max(fy, faqY + 360) + 128;
  const FOOT_H = 600;
  b.rect(0, footY, W, FOOT_H, { fill: B.ink });
  const closing = 'Your next incident can be a calm one.';
  const closingStyle = s(TYPE.h2, { color: '#FFFFFF' });
  b.text(C(0), footY + 96, span(8), closing, closingStyle, B.ink);
  b.text(C(0), footY + 96 + heightOf(closing, span(8), closingStyle) + 12, span(6), 'Start free with ten seats. Bring your PagerDuty schedules; we’ll do the rest.', s(TYPE.bodyL, { color: B.navyMuted }), B.ink);
  b.button(C(11) + 72 - 168, footY + 112, 168, 52, 'Talk to sales', { fill: B.ink, ink: '#FFFFFF', stroke: '#3A4C57', radius: 12, size: 15 });
  b.button(C(11) + 72 - 168 - 16 - 196, footY + 112, 196, 52, 'Start free trial', { fill: B.amber, ink: B.ink, radius: 12, size: 15 });
  b.rule(C(0), footY + 264, span(12), B.navyLine);
  const colsY = footY + 312;
  beaconMark(b, C(0), colsY, 28, B.signal);
  b.label(C(0) + 40, colsY + 2, 'Beacon', { size: 20, weight: 700, lh: 1.2, ls: -0.3, color: '#FFFFFF' }, B.ink);
  b.text(C(0), colsY + 48, span(3), 'Incident response for teams who would rather be shipping.', s(TYPE.body, { size: 15, color: B.navyMuted }), B.ink);
  const columns: Array<[string, string[]]> = [
    ['Product', ['Paging', 'On-call', 'Status pages', 'Postmortems']],
    ['Company', ['About', 'Customers', 'Careers', 'Blog']],
    ['Resources', ['Docs', 'API reference', 'Changelog', 'Incident guide']],
    ['Legal', ['Privacy', 'Terms', 'Security', 'DPA']],
  ];
  columns.forEach(([head, items], i) => {
    const x = C(4 + i * 2);
    b.label(x, colsY, head, { size: 14, weight: 600, lh: 1.4, color: '#FFFFFF' }, B.ink);
    items.forEach((item, j) => b.label(x, colsY + 36 + j * 32, item, { size: 15, weight: 450, lh: 1.4, color: B.navyMuted }, B.ink));
  });
  b.rule(C(0), footY + FOOT_H - 88, span(12), B.navyLine);
  b.label(C(0), footY + FOOT_H - 56, '© 2026 Beacon Labs, Inc. Made in Lisbon and Toronto.', { size: 14, weight: 450, lh: 1.4, color: B.navyMuted }, B.ink);
  const status = b.label(0, footY + FOOT_H - 56, 'All systems operational', { size: 14, weight: 500, lh: 1.4, color: B.navyMuted }, B.ink);
  status.x = C(11) + 72 - status.width;
  b.disc(status.x - 14, footY + FOOT_H - 46, 4, B.signalBright);

  page.height = footY + FOOT_H;

  specSheet(b, W + 160, 0);
  return b.nodes(limit);
}

/** Beacon's incident console, drawn as the hero's product shot. */
function productShot(b: Board, x: number, y: number, w: number, h: number): void {
  b.rect(x, y, w, h, { fill: '#FFFFFF', stroke: B.line, radius: 16, shadow: 'lifted' });
  // Window chrome.
  [0, 1, 2].forEach((i) => b.disc(x + 24 + i * 18, y + 22, 5, '#D5DDD9'));
  b.button(x + (w - 360) / 2, y + 9, 360, 26, 'app.beacon.dev/incidents/INC-2041', { fill: B.surface, ink: B.muted, radius: 8, size: 12, weight: 500 });
  b.rule(x, y + 44, w, B.line);

  // Sidebar.
  const SIDE = 208;
  b.rect(x, y + 45, SIDE, h - 45, { fill: B.surface, radius: [0, 0, 0, 16] });
  b.rule(x + SIDE, y + 45, h - 45, B.line, true);
  b.disc(x + 31, y + 79, 11, B.ink, { label: 'A', size: 11 });
  b.label(x + 50, y + 70, 'Acme Payments', { size: 14, weight: 600, lh: 1.3, color: B.ink });
  const nav: Array<[string, string]> = [
    ['Incidents', 'bolt'],
    ['On-call', 'user'],
    ['Services', 'server'],
    ['Status pages', 'globe'],
    ['Postmortems', 'document'],
    ['Settings', 'gear'],
  ];
  nav.forEach(([name, kind], i) => {
    const ry = y + 116 + i * 40;
    if (i === 0) b.rect(x + 12, ry - 8, SIDE - 24, 36, { fill: '#FFFFFF', stroke: B.line, radius: 8 });
    b.glyph(x + 24, ry + 1, 16, kind, i === 0 ? B.signalTint : B.surface, i === 0 ? B.signal : B.muted, 1.25);
    b.label(x + 50, ry, name, { size: 14, weight: i === 0 ? 600 : 500, lh: 1.3, color: i === 0 ? B.ink : B.body });
  });

  // Incident header.
  const mx = x + SIDE + 32;
  const mw = w - SIDE - 64;
  b.label(mx, y + 68, 'INC-2041  ·  opened 14:02 UTC by Datadog', { size: 13, weight: 500, lh: 1.3, color: B.muted });
  b.label(mx, y + 90, 'Checkout latency above 2 s', { size: 22, weight: 650, lh: 1.3, ls: -0.3, color: B.ink });
  let cx = mx;
  for (const [text, fill, ink] of [
    ['SEV-2', B.amberTint, B.amberInk],
    ['Mitigating', B.signalTint, B.signalDeep],
    ['checkout-api', B.surface, B.body],
  ] as const) {
    cx += b.pill(cx, y + 132, 26, text, { fill, ink, radius: 13, size: 12, padX: 10 }).width + 8;
  }
  const people: Array<[string, string]> = [['AO', '#0E7C66'], ['JK', '#B45309'], ['MS', '#3E5AA8']];
  people.forEach(([who, fill], i) => b.disc(x + w - 32 - 16 - i * 38, y + 84, 16, fill, { label: who, size: 12, stroke: '#FFFFFF', strokeWidth: 2 }));
  b.label(x + w - 32 - 3 * 38 - 8 - 96, y + 76, '3 responders', { size: 13, weight: 500, lh: 1.3, color: B.muted });
  b.rule(mx, y + 180, mw, B.line);

  // Timeline.
  b.label(mx, y + 204, 'Timeline', { size: 15, weight: 600, lh: 1.3, color: B.ink });
  const events: Array<[string, string, string]> = [
    ['14:02', 'Datadog: p95 latency 2.4 s on checkout-api', B.rose],
    ['14:03', 'Paged Amara Osei, primary on-call', B.muted],
    ['14:04', 'Amara acknowledged from mobile', B.signal],
    ['14:06', 'War room opened in #inc-2041', B.muted],
    ['14:11', 'Rolled back checkout-api to v412', B.signal],
    ['14:19', 'p95 back under 600 ms; monitoring', B.signal],
  ];
  const tx = mx + 64;
  b.rule(tx, y + 252, 5 * 52, B.line, true, 2);
  events.forEach(([time, text, color], i) => {
    const ey = y + 242 + i * 52;
    b.label(mx, ey, time, { size: 13, weight: 500, lh: 1.5, color: B.muted });
    b.disc(tx + 1, ey + 10, 5, color, { stroke: '#FFFFFF', strokeWidth: 2 });
    b.label(tx + 20, ey, text, { size: 14, weight: 500, lh: 1.4, color: B.ink });
  });

  // Metric card with a drawn sparkline: the spike, the rollback, the recovery.
  const kx = mx + mw - 304;
  b.rect(kx, y + 200, 304, 216, { fill: '#FFFFFF', stroke: B.line, radius: 12 });
  b.label(kx + 20, y + 218, 'p95 latency · checkout-api', { size: 13, weight: 600, lh: 1.3, color: B.muted });
  const value = b.label(kx + 20, y + 242, '582 ms', { size: 26, weight: 700, lh: 1.2, ls: -0.6, color: B.ink });
  b.pill(kx + 20 + value.width + 10, y + 248, 24, '−76% since 14:11', { fill: B.signalTint, ink: B.signalDeep, radius: 12, size: 12, padX: 8 });
  const px = kx + 20;
  const py = y + 300;
  const PW = 264;
  const PH = 92;
  b.line([[px, py + 22], [px + PW, py + 22]], B.rose, { width: 1.25, dash: [4, 4] });
  b.label(px + PW - 48, py + 4, '2 s SLO', { size: 11, weight: 600, lh: 1.3, color: B.rose });
  const trace = [0.78, 0.8, 0.76, 0.79, 0.74, 0.3, 0.08, 0.12, 0.05, 0.1, 0.42, 0.66, 0.72, 0.75, 0.74, 0.76];
  b.line(trace.map((t, i) => [px + (i / (trace.length - 1)) * PW, py + t * PH] as [number, number]), B.signal, { width: 2.25 });
  b.rule(px, py + PH + 6, PW, B.line);
  b.label(px, py + PH + 12, '13:50', { size: 11, weight: 500, lh: 1.3, color: B.muted });
  b.label(px + PW, py + PH + 12, '14:20', { size: 11, weight: 500, lh: 1.3, color: B.muted, align: 'right' });

  // Customer impact.
  const iy = y + 436;
  b.rect(kx, iy, 304, 148, { fill: B.amberTint, radius: 12 });
  b.label(kx + 20, iy + 18, 'Customer impact', { size: 13, weight: 600, lh: 1.3, color: B.amberInk });
  b.text(kx + 20, iy + 42, 264, 'Status page shows degraded checkout. 2,310 subscribers notified at 14:09.', { size: 14, weight: 500, lh: 1.45, color: B.ink });
  b.button(kx + 20, iy + 100, 120, 30, 'View update', { fill: '#FFFFFF', ink: B.ink, stroke: '#EBCB8B', radius: 8, size: 13 });
}

/** The page's spec: the measure (as a frame carrying the real layout guide), the type scale and the colours. */
function specSheet(b: Board, x: number, y: number): void {
  const W = 1136;
  const sheet = b.frame(x, y, W, 100, {
    title: 'Spec · Layout, type and colour',
    icon: '📐',
    description: 'What a developer needs to build the page without asking',
  });
  const L = x + 64;
  b.text(L, y + 64, 760, 'Layout, type and colour', s(TYPE.h3, { color: B.ink }));
  b.text(L, y + 112, 760, 'Every measure on the page comes from here. Spacing steps by 8; sections are 128 apart and headings sit 64 above their content.', s(TYPE.body, { color: B.body }));

  // The grid, at half scale, carrying the frame's own layout guide.
  const gy = y + 216;
  b.label(L, gy, 'Grid', s(TYPE.title, { color: B.ink }));
  const mini = b.frame(L, gy + 48, 720, 450, {
    title: 'Grid · 1440 at 50%',
    fill: '#FFFFFF',
    stroke: B.line,
    columns: { count: 12, gutter: 16, margin: 56 },
  });
  const m = grid(mini.x as number, 56, 36, 16);
  const my = mini.y as number;
  b.rect(m.col(0), my + 16, 16, 16, { fill: B.signal, radius: 4 });
  b.rect(m.col(4), my + 20, m.span(4), 8, { fill: '#C9D3CF', radius: 4 });
  b.rect(m.col(11) - 4, my + 14, 40, 20, { fill: B.ink, radius: 5 });
  b.rule(mini.x as number, my + 44, 720, B.line);
  b.rect(m.col(2), my + 84, m.span(8), 28, { fill: B.ink, radius: 4 });
  b.rect(m.col(3), my + 124, m.span(6), 10, { fill: '#C9D3CF', radius: 4 });
  b.rect(m.col(3), my + 142, m.span(6), 10, { fill: '#C9D3CF', radius: 4 });
  b.rect(m.col(4) + 20, my + 172, 100, 28, { fill: B.signal, radius: 6 });
  b.rect(m.col(6) + 12, my + 172, 84, 28, { fill: '#FFFFFF', stroke: '#C9D3CF', radius: 6 });
  b.rect(m.col(1), my + 236, m.span(10), 214, { fill: '#FFFFFF', stroke: '#C9D3CF', radius: 8, shadow: 'subtle' });
  const facts: Array<[string, string]> = [
    ['Columns', '12'],
    ['Column', '72 px'],
    ['Gutter', '32 px'],
    ['Margin', '112 px'],
    ['Content', '1216 px'],
    ['Base unit', '8 px'],
  ];
  facts.forEach(([k, v], i) => {
    const fy = gy + 48 + i * 72;
    b.label(L + 768, fy, k, s(TYPE.small, { color: B.muted }));
    b.label(L + 768, fy + 22, v, { size: 22, weight: 650, lh: 1.3, ls: -0.3, color: B.ink });
  });

  // The type scale, each step set in itself.
  const ty = gy + 48 + 450 + 80;
  b.label(L, ty, 'Type scale · Inter', s(TYPE.title, { color: B.ink }));
  const steps: Array<[string, TextStyle, string, string]> = [
    ['Display', { size: 72, weight: 700, lh: 1.05, ls: -1.75 }, '72 / 76 · Bold · −1.75', 'Calm incidents.'],
    ['Heading', TYPE.h2, '40 / 48 · Bold · −0.5', 'Pricing that scales'],
    ['Subheading', TYPE.h3, '28 / 36 · Semibold', 'Questions, answered'],
    ['Title', TYPE.title, '20 / 28 · Semibold', 'Paging that escalates itself'],
    ['Body large', TYPE.bodyL, '18 / 29 · Regular', 'Keeps responders on the same page.'],
    ['Body', TYPE.body, '16 / 26 · Regular', 'Routes by schedule, service and time zone.'],
    ['Small', TYPE.small, '14 / 20 · Medium', 'No credit card · SOC 2 Type II'],
  ];
  let ry = ty + 48;
  steps.forEach(([name, style, spec, sample]) => {
    const rowH = Math.max(heightOf(sample, 640, style), 24) + 32;
    b.rule(L, ry, W - 128, B.line);
    b.label(L, ry + 18, name, s(TYPE.small, { color: B.muted }));
    b.text(L + 168, ry + 16, 600, sample, { ...style, color: B.ink });
    b.label(L + W - 128, ry + 18, spec, s(TYPE.small, { color: B.muted, align: 'right' }));
    ry += rowH;
  });
  b.rule(L, ry, W - 128, B.line);

  // Colour.
  const cy = ry + 72;
  b.label(L, cy, 'Colour', s(TYPE.title, { color: B.ink }));
  const swatches: Array<[string, string, string]> = [
    ['Ink', B.ink, '#0C1A24'],
    ['Signal', B.signal, '#0E7C66'],
    ['Signal tint', B.signalTint, '#E3F2EC'],
    ['Amber', B.amber, '#F2B33D'],
    ['Body', B.body, '#3D4F59'],
    ['Line', B.line, '#E3E8E6'],
  ];
  const SW = (W - 128 - 5 * 24) / 6;
  swatches.forEach(([name, fill, hex], i) => {
    const sx = L + i * (SW + 24);
    b.rect(sx, cy + 48, SW, 96, { fill, radius: 12, ...(fill === B.line || fill === B.signalTint ? { stroke: '#D5DDD9' } : null) });
    b.label(sx, cy + 156, name, { size: 14, weight: 600, lh: 1.4, color: B.ink });
    b.label(sx, cy + 178, hex, { size: 13, weight: 450, lh: 1.4, color: B.muted });
  });
  sheet.height = cy + 178 + 20 + 64 - y;
}

// ---------------------------------------------------------------------------
// 2. Mobile app: Kite, a budgeting app for iOS
// ---------------------------------------------------------------------------

const K = {
  ink: '#111827',
  body: '#4B5563',
  muted: '#6B7280',
  line: '#E5E7EB',
  bg: '#F5F6FA',
  cobalt: '#1F3BB3',
  cobaltDeep: '#172C86',
  cobaltTint: '#E8ECFB',
  cobaltSoft: '#C9D3F5',
  mint: '#7BE3BE',
  mintInk: '#0B7A5C',
  mintTint: '#DDF5EC',
  rose: '#C0362C',
  roseTint: '#FCE8E6',
  amber: '#F5B544',
  amberTint: '#FEF3DC',
  track: '#3550C4',
} as const;

const PHONE_W = 390;
const PHONE_H = 844;

/** The parts every Kite screen shares: the status bar and the home indicator. */
function phoneChrome(b: Board, x: number, y: number, ground = '#FFFFFF'): void {
  b.label(x + 32, y + 15, '9:41', { size: 15, weight: 600, lh: 1.3, color: inkFor(ground) }, ground);
  [0, 1, 2, 3].forEach((i) => b.rect(x + PHONE_W - 86 + i * 5, y + 26 - i * 2.5, 3, 4 + i * 2.5, { fill: inkFor(ground), radius: 1 }));
  b.rect(x + PHONE_W - 58, y + 18, 25, 12, { fill: ground, stroke: inkFor(ground), radius: 3.5 });
  b.rect(x + PHONE_W - 56, y + 20, 18, 8, { fill: inkFor(ground), radius: 2 });
  b.rect(x + (PHONE_W - 134) / 2, y + PHONE_H - 13, 134, 5, { fill: inkFor(ground), radius: 3 });
}

const inkFor = (ground: string) => (ground === K.cobalt ? '#FFFFFF' : K.ink);

/** The tab bar, with one tab current. */
function tabBar(b: Board, x: number, y: number, current: number): void {
  const top = y + PHONE_H - 90;
  b.rect(x, top, PHONE_W, 90, { fill: '#FFFFFF' });
  b.rule(x, top, PHONE_W, K.line);
  const tabs: Array<[string, string]> = [['Home', 'activity'], ['Cards', 'wallet'], ['Goals', 'star'], ['Settings', 'gear']];
  const w = PHONE_W / tabs.length;
  tabs.forEach(([name, kind], i) => {
    const cx = x + w * i + w / 2;
    const on = i === current;
    b.glyph(cx - 12, top + 10, 24, kind, on ? K.cobaltTint : '#FFFFFF', on ? K.cobalt : K.muted, 1.5);
    b.label(cx, top + 38, name, { size: 11, weight: on ? 600 : 500, lh: 1.3, color: on ? K.cobalt : K.muted, align: 'center' });
  });
}

/** A screen: a phone-sized frame inside the prototype. */
function screen(b: Board, x: number, y: number, title: string, icon: string, description: string, fill = '#FFFFFF'): NewNodeInput {
  return b.frame(x, y, PHONE_W, PHONE_H, { title, icon, description, preset: 'phone', fill, radius: 44, stroke: '#D7DCE6' });
}

/** An iOS switch. */
function toggle(b: Board, x: number, y: number, on: boolean): void {
  b.rect(x, y, 51, 31, { fill: on ? K.cobalt : '#D1D5DB', radius: 15.5 });
  b.rect(on ? x + 22 : x + 2, y + 2, 27, 27, { kind: 'ellipse', fill: '#FFFFFF', shadow: 'subtle' });
}

/** A transaction row: a tinted icon tile, the merchant, the category and the amount. */
function txRow(b: Board, x: number, y: number, w: number, kind: string, tint: string, ink: string, name: string, meta: string, amount: string, positive = false): void {
  b.rect(x, y, 44, 44, { fill: tint, radius: 12 });
  b.glyph(x + 11, y + 11, 22, kind, tint, ink, 1.5);
  b.label(x + 58, y + 2, name, { size: 15, weight: 600, lh: 1.35, color: K.ink });
  b.label(x + 58, y + 24, meta, { size: 13, weight: 450, lh: 1.35, color: K.muted });
  b.label(x + w, y + 11, amount, { size: 15, weight: 600, lh: 1.35, color: positive ? K.mintInk : K.ink, align: 'right' });
}

function mobileBoard(limit?: number): NewNodeInput[] {
  const b = new Board();
  const GAP = 128;
  const PAD = 96;
  const W = PAD * 2 + PHONE_W * 5 + GAP * 4;
  const top = 168;
  b.frame(0, 0, W, top + PHONE_H + 168, {
    title: 'Prototype · Kite for iOS',
    icon: '📱',
    description: 'Five screens and the taps that join them; each screen is a Phone preset frame',
    fill: '#EEF1F6',
    radius: 24,
  });
  const X = (i: number) => PAD + i * (PHONE_W + GAP);
  b.text(PAD, 56, 1400, 'Kite: onboarding to a first budget', s(TYPE.h3, { color: K.ink }));
  b.text(PAD, 100, 1400, 'Arrows are the prototype’s connections. Drag a screen and its flow re-routes; components live in the frame below.', s(TYPE.body, { color: K.body }));

  // ---- 1. Onboarding --------------------------------------------------------
  const x1 = X(0);
  const s1 = screen(b, x1, top, 'Onboarding', '👋', 'First launch, page one of three');
  phoneChrome(b, x1, top);
  b.rect(x1 + 55, top + 96, 280, 280, { kind: 'ellipse', fill: K.cobaltTint });
  b.rect(x1 + 151, top + 140, 96, 128, { kind: 'diamond', fill: K.cobalt });
  b.line([[x1 + 199, top + 140], [x1 + 199, top + 268]], K.cobaltSoft, { width: 2 });
  b.line([[x1 + 151, top + 204], [x1 + 247, top + 204]], K.cobaltSoft, { width: 2 });
  b.line([[x1 + 199, top + 268], [x1 + 186, top + 300], [x1 + 212, top + 326], [x1 + 192, top + 352]], K.cobalt, { width: 2 });
  b.rect(x1 + 180, top + 292, 14, 14, { kind: 'polygon', fill: K.mint, geometry: { points: 3 } });
  b.rect(x1 + 205, top + 320, 14, 14, { kind: 'polygon', fill: K.amber, geometry: { points: 3 } });
  b.disc(x1 + 104, top + 300, 22, K.amber, { stroke: '#FFFFFF', strokeWidth: 3 });
  b.disc(x1 + 292, top + 168, 16, K.mint, { stroke: '#FFFFFF', strokeWidth: 3 });
  const h1 = 'Money that knows\nwhere it’s going';
  const h1s: TextStyle = { size: 30, weight: 700, lh: 1.2, ls: -0.6, color: K.ink, align: 'center' };
  b.text(x1 + 24, top + 432, 342, h1, h1s);
  b.text(x1 + 32, top + 432 + heightOf(h1, 342, h1s) + 16, 326, 'Kite sorts every payment into your budget the moment it clears, and warns you before a bill can surprise you.', { size: 16, weight: 400, lh: 1.5, color: K.body, align: 'center' });
  b.rect(x1 + 171, top + 640, 24, 8, { fill: K.cobalt, radius: 4 });
  b.disc(x1 + 207, top + 644, 4, '#C7CDD9');
  b.disc(x1 + 223, top + 644, 4, '#C7CDD9');
  b.button(x1 + 24, top + 680, 342, 56, 'Create an account', { fill: K.cobalt, ink: '#FFFFFF', radius: 16, size: 17 });
  b.label(x1 + 195, top + 752, 'I already have an account', { size: 15, weight: 600, lh: 1.4, color: K.cobalt, align: 'center' });

  // ---- 2. Home --------------------------------------------------------------
  const x2 = X(1);
  const s2 = screen(b, x2, top, 'Home', '🏠', 'The dashboard after the first payday', K.bg);
  phoneChrome(b, x2, top, K.bg);
  b.label(x2 + 24, top + 60, 'Good morning, Sam', { size: 15, weight: 500, lh: 1.4, color: K.muted });
  b.label(x2 + 24, top + 82, '£4,218.60', { size: 38, weight: 700, lh: 1.15, ls: -1, color: K.ink });
  b.label(x2 + 24, top + 128, 'Available across 3 accounts', { size: 14, weight: 450, lh: 1.4, color: K.muted });
  b.disc(x2 + 342, top + 90, 22, K.cobaltTint, { label: 'SC', ink: K.cobalt, size: 14 });
  const cardY = top + 170;
  b.rect(x2 + 20, cardY, 350, 148, { fill: K.cobalt, radius: 20, shadow: 'medium' });
  b.label(x2 + 40, cardY + 20, 'October budget', { size: 14, weight: 600, lh: 1.4, color: K.cobaltSoft }, K.cobalt);
  b.label(x2 + 40, cardY + 44, '£1,286 of £2,000', { size: 24, weight: 700, lh: 1.25, ls: -0.4, color: '#FFFFFF' }, K.cobalt);
  b.rect(x2 + 40, cardY + 88, 310, 8, { fill: K.track, radius: 4 });
  b.rect(x2 + 40, cardY + 88, 198, 8, { fill: K.mint, radius: 4 });
  b.label(x2 + 40, cardY + 108, '£714 left · 22 days to go', { size: 13, weight: 500, lh: 1.4, color: K.cobaltSoft }, K.cobalt);
  const chY = cardY + 168;
  b.rect(x2 + 20, chY, 350, 196, { fill: '#FFFFFF', radius: 20 });
  b.label(x2 + 40, chY + 18, 'Spending this week', { size: 15, weight: 600, lh: 1.35, color: K.ink });
  b.label(x2 + 350, chY + 18, '£312', { size: 15, weight: 600, lh: 1.35, color: K.ink, align: 'right' });
  const spend = [38, 64, 22, 81, 47, 96, 0];
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  spend.forEach((v, i) => {
    const bx = x2 + 48 + i * 44;
    const bh = Math.max(4, (v / 100) * 96);
    b.rect(bx, chY + 152 - bh, 22, bh, { fill: i === 5 ? K.cobalt : K.cobaltTint, radius: 6 });
    b.label(bx + 11, chY + 160, days[i], { size: 12, weight: i === 5 ? 650 : 500, lh: 1.2, color: i === 5 ? K.cobalt : K.muted, align: 'center' });
  });
  const recY = chY + 220;
  b.label(x2 + 24, recY, 'Recent', { size: 17, weight: 650, lh: 1.35, color: K.ink });
  b.label(x2 + 366, recY + 2, 'See all', { size: 15, weight: 600, lh: 1.35, color: K.cobalt, align: 'right' });
  txRow(b, x2 + 24, recY + 36, 342, 'package', K.mintTint, K.mintInk, 'Waitrose', 'Groceries · 08:14', '−£42.18');
  txRow(b, x2 + 24, recY + 92, 342, 'wallet', K.cobaltTint, K.cobalt, 'Northwind Ltd', 'Salary · Yesterday', '+£3,120.00', true);
  tabBar(b, x2, top, 0);

  // ---- 3. Transaction detail ------------------------------------------------
  const x3 = X(2);
  const s3 = screen(b, x3, top, 'Transaction', '🧾', 'Opened from a row on Home');
  phoneChrome(b, x3, top);
  b.line([[x3 + 34, top + 66], [x3 + 26, top + 74], [x3 + 34, top + 82]], K.cobalt, { width: 2.5 });
  b.label(x3 + 42, top + 63, 'Home', { size: 17, weight: 500, lh: 1.3, color: K.cobalt });
  b.disc(x3 + 195, top + 152, 36, '#2E7D32', { label: 'W', size: 28 });
  b.label(x3 + 195, top + 204, 'Waitrose & Partners', { size: 20, weight: 650, lh: 1.3, color: K.ink, align: 'center' });
  b.label(x3 + 195, top + 236, '−£42.18', { size: 40, weight: 700, lh: 1.15, ls: -1, color: K.ink, align: 'center' });
  b.label(x3 + 195, top + 292, 'Today, 08:14 · Contactless', { size: 14, weight: 450, lh: 1.4, color: K.muted, align: 'center' });
  const chip = b.pill(0, top + 328, 32, 'Groceries', { fill: K.mintTint, ink: K.mintInk, radius: 16, size: 14, padX: 14 });
  chip.x = x3 + 195 - chip.width / 2;
  const dY = top + 392;
  b.rect(x3 + 20, dY, 350, 232, { fill: '#FFFFFF', stroke: K.line, radius: 16 });
  const facts: Array<[string, string]> = [
    ['Card', 'Kite debit ·· 4021'],
    ['Where', 'Islington, London'],
    ['Budget', '£218 of £320 left'],
    ['Reference', 'WAITROSE 0821'],
  ];
  facts.forEach(([k, v], i) => {
    const ry = dY + 18 + i * 54;
    if (i) b.rule(x3 + 40, ry - 14, 310, K.line);
    b.label(x3 + 40, ry + 4, k, { size: 15, weight: 450, lh: 1.35, color: K.muted });
    b.label(x3 + 350, ry + 4, v, { size: 15, weight: 600, lh: 1.35, color: K.ink, align: 'right' });
  });
  b.button(x3 + 20, top + 652, 350, 52, 'Split with friends', { fill: K.cobaltTint, ink: K.cobaltDeep, radius: 14, size: 16 });
  b.button(x3 + 20, top + 716, 350, 52, 'Report a problem', { fill: '#FFFFFF', ink: K.rose, radius: 14, size: 16 });

  // ---- 4. Settings ----------------------------------------------------------
  const x4 = X(3);
  const s4 = screen(b, x4, top, 'Settings', '⚙️', 'Profile, security and alerts', K.bg);
  phoneChrome(b, x4, top, K.bg);
  b.label(x4 + 24, top + 64, 'Settings', { size: 32, weight: 700, lh: 1.2, ls: -0.6, color: K.ink });
  b.rect(x4 + 20, top + 124, 350, 80, { fill: '#FFFFFF', radius: 16 });
  b.disc(x4 + 68, top + 164, 26, K.cobalt, { label: 'SC', size: 16 });
  b.label(x4 + 106, top + 140, 'Sam Carter', { size: 17, weight: 650, lh: 1.35, color: K.ink });
  b.label(x4 + 106, top + 164, 'sam.carter@hey.com', { size: 14, weight: 450, lh: 1.35, color: K.muted });
  const group = (y: number, title: string, rows: Array<[string, boolean]>) => {
    b.label(x4 + 36, y, title, { size: 13, weight: 600, lh: 1.35, color: K.muted });
    b.rect(x4 + 20, y + 26, 350, rows.length * 56, { fill: '#FFFFFF', radius: 16 });
    rows.forEach(([name, on], i) => {
      const ry = y + 26 + i * 56;
      if (i) b.rule(x4 + 36, ry, 334, K.line);
      b.label(x4 + 36, ry + 17, name, { size: 16, weight: 500, lh: 1.35, color: K.ink });
      toggle(b, x4 + 303, ry + 12, on);
    });
    return y + 26 + rows.length * 56;
  };
  const after = group(top + 236, 'Security', [['Face ID', true], ['Hide balances on Home', false]]);
  const after2 = group(after + 28, 'Notifications', [['Spending alerts', true], ['Weekly summary', true], ['Round-up reminders', false]]);
  b.button(x4 + 20, after2 + 28, 350, 52, 'Sign out', { fill: '#FFFFFF', ink: K.rose, radius: 16, size: 16 });
  tabBar(b, x4, top, 3);

  // ---- 5. Empty state -------------------------------------------------------
  const x5 = X(4);
  const s5 = screen(b, x5, top, 'Goals · empty', '🎯', 'What a new account sees before its first goal');
  phoneChrome(b, x5, top);
  b.label(x5 + 24, top + 64, 'Goals', { size: 32, weight: 700, lh: 1.2, ls: -0.6, color: K.ink });
  b.rect(x5 + 95, top + 156, 200, 200, { kind: 'ellipse', fill: K.cobaltTint });
  b.rect(x5 + 135, top + 196, 120, 120, { kind: 'ellipse', fill: '#FFFFFF', stroke: K.cobaltSoft, strokeWidth: 10 });
  b.rect(x5 + 165, top + 226, 60, 60, { kind: 'ellipse', fill: '#FFFFFF', stroke: K.cobalt, strokeWidth: 10 });
  b.line([[x5 + 196, top + 256], [x5 + 252, top + 184]], K.ink, { width: 3 });
  b.rect(x5 + 252, top + 172, 34, 22, { kind: 'polygon', fill: K.amber, geometry: { points: 3 } });
  b.label(x5 + 195, top + 392, 'No goals yet', { size: 22, weight: 700, lh: 1.3, ls: -0.3, color: K.ink, align: 'center' });
  b.text(x5 + 40, top + 430, 310, 'Set a goal and Kite moves your spare change into it every Friday. Most people start with a holiday.', { size: 16, weight: 400, lh: 1.5, color: K.body, align: 'center' });
  b.button(x5 + 24, top + 540, 342, 52, 'Create a goal', { fill: K.cobalt, ink: '#FFFFFF', radius: 14, size: 16 });
  b.label(x5 + 195, top + 620, 'Or start from an idea', { size: 13, weight: 600, lh: 1.35, color: K.muted, align: 'center' });
  let ix = x5 + 34;
  for (const idea of ['Holiday', 'Rainy day', 'New laptop']) {
    ix += b.pill(ix, top + 650, 34, idea, { fill: '#FFFFFF', ink: K.ink, stroke: K.line, radius: 17, size: 14, padX: 14 }).width + 8;
  }
  tabBar(b, x5, top, 2);

  // ---- The flow -------------------------------------------------------------
  const flow = { color: K.cobalt, width: 2.5 };
  b.wire(s1, s2, { ...flow, from: 'right', to: 'left', label: 'Create an account' });
  b.wire(s2, s3, { ...flow, from: 'right', to: 'left', label: 'Tap a payment' });
  b.wire(s2, s4, { ...flow, from: 'top', to: 'top', routing: 'curved', label: 'Settings tab' });
  b.wire(s2, s5, { ...flow, from: 'bottom', to: 'bottom', routing: 'curved', label: 'Goals tab', dash: [8, 6] });

  mobileKit(b, 0, top + PHONE_H + 168 + 160, W);
  return b.nodes(limit);
}

/** The components the screens are built from, each in its states. */
function mobileKit(b: Board, x: number, y: number, W: number): void {
  const H = 640;
  b.frame(x, y, W, H, { title: 'Components · Kite UI kit', icon: '🧩', description: 'Buttons, fields, rows, switches, chips and the tab bar, in their states' });
  const L = x + 96;
  b.text(L, y + 64, 900, 'Components', s(TYPE.h3, { color: K.ink }));
  b.text(L, y + 108, 1100, 'One radius family (14 for controls, 16 to 20 for cards), one 8px rhythm, and every pair of ink and fill at 4.5:1 or better.', s(TYPE.body, { color: K.body }));
  const colY = y + 192;
  const head = (cx: number, text: string) => b.label(cx, colY, text, { size: 15, weight: 650, lh: 1.35, color: K.ink });

  // Buttons.
  head(L, 'Buttons');
  const btns: Array<[string, Parameters<Board['button']>[5]]> = [
    ['Primary', { fill: K.cobalt, ink: '#FFFFFF', radius: 14, size: 16 }],
    ['Secondary', { fill: K.cobaltTint, ink: K.cobaltDeep, radius: 14, size: 16 }],
    ['Outline', { fill: '#FFFFFF', ink: K.ink, stroke: K.line, radius: 14, size: 16 }],
    ['Destructive', { fill: K.roseTint, ink: K.rose, radius: 14, size: 16 }],
    ['Disabled', { fill: K.cobalt, ink: '#FFFFFF', radius: 14, size: 16, opacity: 0.4 }],
  ];
  btns.forEach(([name, o], i) => b.button(L, colY + 40 + i * 68, 300, 52, name, o));

  // Fields.
  const F = L + 400;
  head(F, 'Text fields');
  const field = (fy: number, label: string, value: string, state: 'idle' | 'focus' | 'error', help?: string) => {
    b.label(F, fy, label, { size: 13, weight: 600, lh: 1.35, color: K.body });
    b.rect(F, fy + 24, 340, 52, {
      fill: '#FFFFFF',
      stroke: state === 'error' ? K.rose : state === 'focus' ? '#374151' : '#D1D5DB',
      strokeWidth: state === 'idle' ? 1 : 2,
      radius: 14,
    });
    b.label(F + 16, fy + 39, value, { size: 16, weight: state === 'idle' ? 400 : 500, lh: 1.35, color: state === 'idle' ? K.muted : K.ink });
    if (help) b.label(F, fy + 84, help, { size: 13, weight: 500, lh: 1.35, color: state === 'error' ? K.rose : K.muted });
  };
  field(colY + 40, 'Email', 'you@example.com', 'idle');
  field(colY + 150, 'Monthly budget', '£2,000', 'focus', 'Focus is a graphite edge, never the brand colour');
  field(colY + 270, 'Sort code', '04-00-0', 'error', 'A sort code has six digits');

  // Rows and switches.
  const R = F + 460;
  head(R, 'List rows and switches');
  b.rect(R, colY + 40, 380, 168, { fill: '#FFFFFF', stroke: K.line, radius: 16 });
  txRow(b, R + 20, colY + 60, 340, 'package', K.mintTint, K.mintInk, 'Waitrose', 'Groceries · 08:14', '−£42.18');
  b.rule(R + 20, colY + 124, 340, K.line);
  b.label(R + 20, colY + 152, 'Spending alerts', { size: 16, weight: 500, lh: 1.35, color: K.ink });
  toggle(b, R + 309, colY + 148, true);
  b.label(R, colY + 240, 'Switch', { size: 13, weight: 600, lh: 1.35, color: K.body });
  toggle(b, R, colY + 268, true);
  b.label(R + 62, colY + 273, 'On', { size: 14, weight: 500, lh: 1.35, color: K.muted });
  toggle(b, R + 120, colY + 268, false);
  b.label(R + 182, colY + 273, 'Off', { size: 14, weight: 500, lh: 1.35, color: K.muted });

  // Chips and the tab bar.
  const T = R + 480;
  head(T, 'Chips');
  let cx = T;
  for (const [name, fill, ink, stroke] of [
    ['Groceries', K.mintTint, K.mintInk, undefined],
    ['Bills', K.amberTint, '#8A5A00', undefined],
    ['Holiday', '#FFFFFF', K.ink, K.line],
  ] as const) {
    cx += b.pill(cx, colY + 40, 34, name, { fill, ink, radius: 17, size: 14, padX: 14, ...(stroke ? { stroke } : null) }).width + 8;
  }
  b.label(T, colY + 112, 'Tab bar', { size: 15, weight: 650, lh: 1.35, color: K.ink });
  b.rect(T, colY + 152, PHONE_W, 90, { fill: '#FFFFFF', stroke: K.line, radius: 16 });
  const tabs: Array<[string, string]> = [['Home', 'activity'], ['Cards', 'wallet'], ['Goals', 'star'], ['Settings', 'gear']];
  tabs.forEach(([name, kind], i) => {
    const tcx = T + (PHONE_W / 4) * i + PHONE_W / 8;
    const on = i === 0;
    b.glyph(tcx - 12, colY + 166, 24, kind, on ? K.cobaltTint : '#FFFFFF', on ? K.cobalt : K.muted, 1.5);
    b.label(tcx, colY + 194, name, { size: 11, weight: on ? 600 : 500, lh: 1.3, color: on ? K.cobalt : K.muted, align: 'center' });
  });
}

// ---------------------------------------------------------------------------
// 3. Lo-fi wireframes: Makers' Market, a marketplace for handmade goods
// ---------------------------------------------------------------------------

/** Greys only, and one hand: a wireframe argues about structure, never about colour. */
const WF = {
  pen: '#374151',
  soft: '#6B7280',
  fill: '#F3F4F6',
  photo: '#E5E7EB',
  cross: '#9CA3AF',
  bar: '#D1D5DB',
  hand: 'Architects Daughter',
};

const wfText = (size: number, weight = 400, color = WF.pen): TextStyle => ({ size, weight, lh: 1.35, color, family: WF.hand });

/** The wireframe vocabulary, all drawn by hand. */
class Wire {
  private b: Board;

  constructor(b: Board) {
    this.b = b;
  }

  box(x: number, y: number, w: number, h: number, fill = '#FFFFFF', radius = 6): NewNodeInput {
    return this.b.rect(x, y, w, h, { fill, stroke: WF.pen, strokeWidth: 1.5, radius, sketch: 'medium' });
  }

  /** An image placeholder: a box crossed corner to corner. */
  photo(x: number, y: number, w: number, h: number): void {
    this.b.rect(x, y, w, h, { fill: WF.photo, stroke: WF.soft, strokeWidth: 1.5, radius: 4, sketch: 'light' });
    this.b.line([[x + 6, y + 6], [x + w - 6, y + h - 6]], WF.cross, { width: 1.25, sketch: 'light' });
    this.b.line([[x + w - 6, y + 6], [x + 6, y + h - 6]], WF.cross, { width: 1.25, sketch: 'light' });
  }

  /** Body copy, greeked as bars: the words are the UX writer's job, not this page's. */
  bars(x: number, y: number, widths: number[], gap = 16): void {
    widths.forEach((w, i) => this.b.rect(x, y + i * gap, w, 7, { fill: WF.bar, radius: 3.5, sketch: 'light' }));
  }

  button(x: number, y: number, w: number, h: number, label: string, primary = true): NewNodeInput {
    return this.b.button(x, y, w, h, label, {
      fill: primary ? '#4B5563' : '#FFFFFF',
      ink: primary ? '#FFFFFF' : WF.pen,
      stroke: WF.pen,
      strokeWidth: 1.5,
      radius: 6,
      size: 15,
      weight: 400,
      family: WF.hand,
      sketch: 'medium',
    });
  }

  text(x: number, y: number, body: string, size = 16, weight = 400, color = WF.pen): NewNodeInput {
    return this.b.label(x, y, body, wfText(size, weight, color));
  }

  /** A numbered marker matching an annotation sticky. */
  marker(cx: number, cy: number, n: number): void {
    this.b.disc(cx, cy, 15, '#111827', { label: String(n), size: 14, ink: '#FFFFFF' });
  }

  /** The site header every page shares. */
  header(x: number, y: number, w: number): void {
    this.text(x + 32, y + 24, 'Makers’ Market', 22, 400);
    this.box(x + 260, y + 18, 380, 40, '#FFFFFF', 20);
    this.text(x + 284, y + 27, 'Search handmade goods', 15, 400, WF.soft);
    this.text(x + w - 200, y + 27, 'Sign in', 15);
    this.b.glyph(x + w - 96, y + 22, 30, 'package', '#FFFFFF', WF.pen, 1.5);
    this.text(x + w - 60, y + 27, '2', 15);
    this.b.line([[x + 20, y + 76], [x + w - 20, y + 76]], WF.soft, { width: 1.25, sketch: 'light' });
  }
}

const WF_W = 960;
const WF_H = 640;

function wireframesBoard(limit?: number): NewNodeInput[] {
  const b = new Board();
  const w = new Wire(b);
  const STEP_X = WF_W + 160;
  const NOTE = 208;
  const STEP_Y = WF_H + 48 + NOTE + 200;
  const at = (i: number) => ({ x: (i % 3) * STEP_X, y: Math.floor(i / 3) * STEP_Y });
  const pages: Array<[string, string, string]> = [
    ['Home', '🏠', 'First visit, signed out'],
    ['Search results', '🔎', 'After searching “ceramic mug”'],
    ['Product', '🏺', 'One maker’s listing'],
    ['Basket', '🧺', 'Two makers, three items'],
    ['Checkout · Delivery', '📦', 'Step one of three, as a guest'],
  ];
  pages.forEach(([title, icon, description], i) => {
    const { x, y } = at(i);
    b.frame(x, y, WF_W, WF_H, { title, icon, description });
    w.header(x, y, WF_W);
  });
  // The annotations, numbered against the markers on each page.
  const notes: string[][] = [
    [
      '1  Hero names the maker, not the product. Test against “Gifts that last”.',
      '2  Six categories by search volume, not the whole taxonomy.',
      '3  Search lives in the header on every page: 61% of sessions start there.',
    ],
    [
      '4  Filters apply as you tick them. No Apply button; show a count per option.',
      '5  Typos still match: “cermic mug” finds mugs, with a quiet “Showing results for”.',
      '6  No results? Offer the nearest category, never a dead end.',
    ],
    [
      '7  The maker’s name links to their shop. The strongest trust signal in interviews.',
      '8  A dispatch date beats “in stock”: “Ships by Thu 16 Oct”.',
      '9  Swatches show the real glaze photo, not a flat colour.',
    ],
    [
      '10  Show the gap to free delivery: “Add £12 for free UK delivery”.',
      '11  Items from different makers ship separately. Say so on each line.',
    ],
    [
      '12  Guest checkout is the default; offer an account after payment.',
      '13  Postcode lookup fills the address. Manual entry stays one tap away.',
      '14  Keep the order summary visible on every step.',
    ],
  ];
  notes.forEach((list, i) => {
    const { x, y } = at(i);
    list.forEach((text, j) => b.sticky(x + j * (NOTE + 40), y + WF_H + 48, NOTE, NOTE, text, 'yellow', { fontSize: 18 }));
  });

  // ---- Home ----------------------------------------------------------------
  {
    const { x, y } = at(0);
    w.photo(x + 32, y + 104, 520, 280);
    w.marker(x + 552, y + 120, 1);
    w.text(x + 584, y + 128, 'Handmade, by people', 26);
    w.text(x + 584, y + 166, 'you can name.', 26);
    w.bars(x + 592, y + 228, [320, 300, 220]);
    w.button(x + 592, y + 296, 200, 48, 'Shop new arrivals');
    w.marker(x + 660, y + 38, 3);
    w.text(x + 32, y + 416, 'Shop by craft', 20);
    w.marker(x + 196, y + 430, 2);
    ['Ceramics', 'Prints', 'Jewellery', 'Textiles', 'Woodwork', 'Candles'].forEach((name, i) => {
      const cx = x + 32 + i * 152;
      w.photo(cx, y + 456, 136, 104);
      w.text(cx, y + 570, name, 15);
    });
  }

  // ---- Search results ------------------------------------------------------
  {
    const { x, y } = at(1);
    w.text(x + 32, y + 100, 'Filters', 20);
    w.marker(x + 132, y + 114, 4);
    const groups: Array<[string, string[]]> = [['Craft', ['Ceramics  (96)', 'Glassware  (21)', 'Woodwork  (11)']], ['Ships from', ['UK  (74)', 'Europe  (54)']]];
    let gy = y + 144;
    for (const [head, opts] of groups) {
      w.text(x + 32, gy, head, 16);
      opts.forEach((o, i) => {
        b.rect(x + 32, gy + 34 + i * 30, 16, 16, { fill: '#FFFFFF', stroke: WF.pen, strokeWidth: 1.5, radius: 3, sketch: 'light' });
        if (i === 0) b.check(x + 34, gy + 36 + i * 30, 12, WF.pen, 1.75);
        w.text(x + 58, gy + 30 + i * 30, o, 14);
      });
      gy += 34 + opts.length * 30 + 24;
    }
    w.text(x + 32, gy, 'Price', 16);
    b.line([[x + 32, gy + 44], [x + 212, gy + 44]], WF.pen, { width: 2, sketch: 'light' });
    b.disc(x + 72, gy + 44, 8, '#FFFFFF', { stroke: WF.pen });
    b.disc(x + 172, gy + 44, 8, '#FFFFFF', { stroke: WF.pen });
    w.text(x + 32, gy + 60, '£10 – £60', 14, 400, WF.soft);
    w.text(x + 272, y + 100, '128 results for “ceramic mug”', 20);
    w.marker(x + 600, y + 114, 5);
    w.box(x + 776, y + 96, 152, 36);
    w.text(x + 790, y + 103, 'Most loved  ▾', 15);
    for (let i = 0; i < 6; i++) {
      const cx = x + 272 + (i % 3) * 224;
      const cy = y + 156 + Math.floor(i / 3) * 236;
      w.photo(cx, cy, 200, 140);
      w.bars(cx, cy + 156, [170, 110], 14);
      w.text(cx, cy + 186, ['£34', '£28', '£42', '£22', '£36', '£30'][i], 16);
    }
    w.marker(x + 916, y + 400, 6);
  }

  // ---- Product -------------------------------------------------------------
  {
    const { x, y } = at(2);
    w.photo(x + 32, y + 104, 440, 400);
    w.marker(x + 456, y + 120, 9);
    [0, 1, 2, 3].forEach((i) => w.photo(x + 32 + i * 116, y + 520, 92, 80));
    w.text(x + 512, y + 104, 'Speckled stoneware mug', 26);
    w.text(x + 512, y + 146, 'by Ana Ruiz · Porto', 16, 400, WF.soft);
    w.marker(x + 720, y + 160, 7);
    [0, 1, 2, 3, 4].forEach((i) => b.glyph(x + 512 + i * 24, y + 184, 18, 'star', i < 4 ? '#9CA3AF' : '#FFFFFF', WF.pen, 1.25));
    w.text(x + 640, y + 182, '212 reviews', 14, 400, WF.soft);
    w.text(x + 512, y + 224, '£34', 28);
    w.text(x + 512, y + 276, 'Glaze', 15);
    let cx = x + 512;
    for (const g of ['Oat', 'Sea', 'Charcoal']) {
      const chip = w.button(cx, y + 304, g.length * 12 + 40, 36, g, g === 'Oat');
      cx += (chip.width as number) + 10;
    }
    w.button(x + 512, y + 368, 280, 52, 'Add to basket');
    w.text(x + 512, y + 436, 'Ships by Thu 16 Oct from Porto', 15);
    w.marker(x + 820, y + 446, 8);
    b.line([[x + 512, y + 480], [x + 928, y + 480]], WF.soft, { width: 1.25, sketch: 'light' });
    w.text(x + 512, y + 494, 'Details', 16);
    w.text(x + 908, y + 494, '+', 18);
    b.line([[x + 512, y + 534], [x + 928, y + 534]], WF.soft, { width: 1.25, sketch: 'light' });
    w.text(x + 512, y + 548, 'Delivery and returns', 16);
    w.text(x + 908, y + 548, '+', 18);
  }

  // ---- Basket --------------------------------------------------------------
  {
    const { x, y } = at(3);
    w.text(x + 32, y + 100, 'Your basket', 26);
    const items: Array<[string, string, string]> = [
      ['Speckled stoneware mug', 'Ana Ruiz · ships from Porto', '£34'],
      ['Speckled stoneware mug', 'Ana Ruiz · ships from Porto', '£34'],
      ['Linen tea towel, rust', 'Hollin Studio · ships from Leeds', '£16'],
    ];
    items.forEach(([name, maker, price], i) => {
      const ry = y + 156 + i * 128;
      w.photo(x + 32, ry, 96, 96);
      w.text(x + 152, ry + 4, name, 17);
      w.text(x + 152, ry + 34, maker, 14, 400, WF.soft);
      w.box(x + 152, ry + 62, 96, 32);
      w.text(x + 168, ry + 66, '–   1   +', 15);
      w.text(x + 272, ry + 68, 'Remove', 14, 400, WF.soft);
      w.text(x + 560, ry + 4, price, 17);
    });
    w.marker(x + 460, y + 200, 11);
    w.box(x + 640, y + 156, 288, 320, WF.fill);
    w.text(x + 664, y + 176, 'Summary', 20);
    const rows: Array<[string, string]> = [['Subtotal', '£84'], ['Delivery (2 makers)', '£7.90'], ['Total', '£91.90']];
    rows.forEach(([k, v], i) => {
      w.text(x + 664, y + 224 + i * 36, k, 15);
      w.text(x + 860, y + 224 + i * 36, v, 15);
    });
    w.text(x + 664, y + 340, 'Add £12 for free UK delivery', 14);
    w.marker(x + 912, y + 348, 10);
    w.button(x + 664, y + 396, 240, 52, 'Checkout');
  }

  // ---- Checkout ------------------------------------------------------------
  {
    const { x, y } = at(4);
    const steps = ['Delivery', 'Payment', 'Review'];
    steps.forEach((name, i) => {
      const sx = x + 32 + i * 180;
      b.disc(sx + 14, y + 114, 14, i === 0 ? '#4B5563' : '#FFFFFF', { label: String(i + 1), ink: i === 0 ? '#FFFFFF' : WF.pen, size: 13, stroke: WF.pen });
      w.text(sx + 36, y + 102, name, 16);
      if (i < 2) b.line([[sx + 120, y + 114], [sx + 168, y + 114]], WF.soft, { width: 1.5, sketch: 'light' });
    });
    w.marker(x + 590, y + 114, 12);
    const fields = ['Email', 'Full name', 'Postcode', 'Address'];
    fields.forEach((f, i) => {
      const fy = y + 164 + i * 84;
      w.text(x + 32, fy, f, 15);
      w.box(x + 32, fy + 26, i === 2 ? 200 : 520, 44);
      if (i === 2) w.button(x + 248, fy + 26, 160, 44, 'Find address', false);
    });
    w.marker(x + 440, y + 358, 13);
    w.text(x + 32, y + 504, 'Royal Mail Tracked 48  ·  £3.95', 15);
    w.button(x + 32, y + 552, 280, 52, 'Continue to payment');
    w.box(x + 640, y + 164, 288, 280, WF.fill);
    w.text(x + 664, y + 184, 'Order summary', 18);
    w.marker(x + 912, y + 192, 14);
    [0, 1].forEach((i) => {
      w.photo(x + 664, y + 228 + i * 72, 56, 56);
      w.bars(x + 736, y + 240 + i * 72, [150, 90], 14);
    });
    w.text(x + 664, y + 392, 'Total  £91.90', 18);
  }

  return b.nodes(limit);
}

// ---------------------------------------------------------------------------
// 4. Design system foundations: Beacon DS
// ---------------------------------------------------------------------------

const RAMPS: Array<[string, Array<[string, string]>]> = [
  ['Teal', [['50', '#EEF7F4'], ['100', '#D5EEE5'], ['200', '#ABDCCB'], ['300', '#7CC6AF'], ['400', '#4FAE93'], ['500', '#22957A'], ['600', '#0E7C66'], ['700', '#0A5E4E'], ['800', '#08473C'], ['900', '#06312A']]],
  ['Slate', [['50', '#F6F8F7'], ['100', '#E3E8E6'], ['200', '#C9D3CF'], ['300', '#9FB1BA'], ['400', '#7A8B93'], ['500', '#5B6B73'], ['600', '#3D4F59'], ['700', '#2A3A43'], ['800', '#1A2A33'], ['900', '#0C1A24']]],
  ['Amber', [['100', '#FDF1D8'], ['400', '#F2B33D'], ['700', '#8A5A00']]],
  ['Red', [['100', '#FDE7E4'], ['600', '#B42318'], ['800', '#7A1810']]],
];

function systemBoard(limit?: number): NewNodeInput[] {
  const b = new Board();
  const head = (x: number, y: number, title: string, lede: string, width: number) => {
    b.text(x, y, width, title, s(TYPE.h3, { color: B.ink }));
    b.text(x, y + 48, width, lede, s(TYPE.body, { color: B.body }));
  };

  // ---- Colour: primitives, then the semantic tokens that alias them -------
  const CW = 1280;
  const colour = b.frame(0, 0, CW, 900, { title: 'Colour', icon: '🎨', description: 'Primitives are raw values; components only ever use the semantic tokens' });
  head(64, 64, 'Colour', 'Primitives never appear in a component. Each semantic token names a job and points at one primitive per theme.', 1100);
  let ry = 180;
  RAMPS.forEach(([name, ramp], i) => {
    const y = ry + i * 120;
    b.label(64, y + 24, name, { size: 15, weight: 600, lh: 1.35, color: B.ink });
    ramp.forEach(([step, hex], j) => {
      const x = 176 + j * 104;
      b.rect(x, y, 96, 64, { fill: hex, radius: 8, ...(j === 0 ? { stroke: '#D5DDD9' } : null) });
      b.label(x, y + 72, step, { size: 12, weight: 600, lh: 1.3, color: B.ink });
      b.label(x + 96, y + 72, hex, { size: 11, weight: 450, lh: 1.3, color: B.muted, align: 'right' });
    });
  });
  ry += RAMPS.length * 120 + 24;
  b.label(64, ry, 'Semantic tokens', s(TYPE.title, { color: B.ink }));
  const tokens: Array<[string, string, string, string]> = [
    ['bg/canvas', 'slate-50', 'slate-900', 'The page behind everything'],
    ['text/primary', 'slate-900', 'slate-50', 'Headings and body copy'],
    ['text/secondary', 'slate-600', 'slate-300', 'Supporting copy, captions'],
    ['border/default', 'slate-100', 'slate-800', 'Card and field edges'],
    ['action/primary', 'teal-600', 'teal-400', 'The one main action per view'],
    ['status/danger', 'red-600', 'red-100', 'Errors and destructive actions'],
    ['focus/ring', 'slate-600', 'slate-300', 'Keyboard focus: neutral, never brand'],
  ];
  const tbl = sheet(64, ry + 40, CW - 128, {
    title: 'Semantic tokens',
    columns: [
      { head: 'Token', width: 1.2, cells: tokens.map((t) => t[0]), style: { bold: true } },
      { head: 'Light', width: 0.8, cells: tokens.map((t) => t[1]) },
      { head: 'Dark', width: 0.8, cells: tokens.map((t) => t[2]) },
      { head: 'Use', width: 2, cells: tokens.map((t) => t[3]) },
    ],
    accent: B.signal,
    rowH: 36,
  });
  b.add(tbl.node);
  colour.height = ry + 40 + tbl.height + 64;

  // ---- Type ---------------------------------------------------------------
  const TX = CW + 160;
  const TW = 1120;
  const typeFrame = b.frame(TX, 0, TW, 900, { title: 'Type', icon: '🔤', description: 'One family, seven steps, each mapped to a text-tool preset' });
  head(TX + 64, 64, 'Type scale · Inter', 'Display, Heading and Subheading are the text tool’s own presets, so a style applied from the dock lands on the scale.', 960);
  const steps: Array<[string, TextStyle, string]> = [
    ['Display', TYPE.display, '64 / 70 · Bold'],
    ['Heading', TYPE.h2, '40 / 48 · Bold'],
    ['Subheading', TYPE.h3, '28 / 36 · Semibold'],
    ['Title', TYPE.title, '20 / 28 · Semibold'],
    ['Body large', TYPE.bodyL, '18 / 29 · Regular'],
    ['Body', TYPE.body, '16 / 26 · Regular'],
    ['Small', TYPE.small, '14 / 20 · Medium'],
  ];
  let ty = 196;
  steps.forEach(([name, style, spec]) => {
    const rowH = heightOf('Calm incidents', 560, style) + 36;
    b.rule(TX + 64, ty, TW - 128, B.line);
    b.label(TX + 64, ty + 20, name, s(TYPE.small, { color: B.muted }));
    b.text(TX + 224, ty + 18, 560, 'Calm incidents', { ...style, color: B.ink });
    b.label(TX + TW - 64, ty + 20, spec, s(TYPE.small, { color: B.muted, align: 'right' }));
    ty += rowH;
  });
  b.rule(TX + 64, ty, TW - 128, B.line);
  typeFrame.height = ty + 64;

  // ---- Space, radius and elevation ---------------------------------------
  const RY = Math.max(colour.height, typeFrame.height) + 160;
  b.frame(0, RY, CW, 760, { title: 'Space, radius and elevation', icon: '📏', description: 'An 8px scale with two half steps; three shadows from the effects panel' });
  head(64, RY + 64, 'Space, radius and elevation', 'Spacing steps by 8 with 4 and 12 for tight controls. Elevation uses the effects panel’s presets, and a surface takes a border or a shadow, never both.', 1100);
  const space = [4, 8, 12, 16, 24, 32, 48, 64, 96];
  space.forEach((v, i) => {
    const x = 64 + i * 128;
    b.rect(x, RY + 248 - v, v, v, { fill: B.signalTint, stroke: B.signal, radius: 2 });
    b.label(x, RY + 260, `space-${i + 1}`, { size: 12, weight: 600, lh: 1.3, color: B.ink });
    b.label(x, RY + 280, `${v} px`, { size: 12, weight: 450, lh: 1.3, color: B.muted });
  });
  const radii: Array<[string, number]> = [['none', 0], ['sm', 4], ['md', 8], ['lg', 12], ['xl', 16], ['full', 40]];
  radii.forEach(([name, r], i) => {
    const x = 64 + i * 128;
    b.rect(x, RY + 352, 80, 80, { fill: '#FFFFFF', stroke: B.body, strokeWidth: 1.5, radius: r });
    b.label(x, RY + 444, `radius-${name}`, { size: 12, weight: 600, lh: 1.3, color: B.ink });
    b.label(x, RY + 464, `${r === 40 ? '9999' : r} px`, { size: 12, weight: 450, lh: 1.3, color: B.muted });
  });
  const levels: Array<[string, Parameters<Board['rect']>[4], string]> = [
    ['Flat', { fill: '#FFFFFF', stroke: B.line, radius: 12 }, 'Border only. Cards on the page.'],
    ['Subtle', { fill: '#FFFFFF', radius: 12, shadow: 'subtle' }, 'Rows and controls that lift on hover.'],
    ['Medium', { fill: '#FFFFFF', radius: 12, shadow: 'medium' }, 'Menus, popovers, the chosen plan.'],
    ['Lifted', { fill: '#FFFFFF', radius: 12, shadow: 'lifted' }, 'Dialogs and product shots.'],
  ];
  levels.forEach(([name, o, use], i) => {
    const x = 64 + i * 288;
    b.rect(x, RY + 528, 256, 120, o);
    b.label(x + 20, RY + 548, name, { size: 16, weight: 650, lh: 1.35, color: B.ink });
    b.text(x + 20, RY + 576, 216, use, { size: 13, weight: 450, lh: 1.45, color: B.body });
  });

  // ---- Iconography ---------------------------------------------------------
  b.frame(TX, RY, TW, 760, { title: 'Iconography', icon: '✳️', description: 'A 24px grid with a 2px safe zone, drawn from the shape library' });
  head(TX + 64, RY + 64, 'Icons on a 24 grid', 'Every icon sits on the same keylines, so a circle and a square read as the same size. Stroke 1.5 at 24.', 960);
  const G = 240;
  const gx = TX + 64;
  const gy = RY + 200;
  b.rect(gx, gy, G, G, { fill: '#FFFFFF', stroke: '#C9D3CF' });
  for (let i = 1; i < 24; i++) {
    b.rule(gx + i * 10, gy, G, i % 4 === 0 ? '#C9D3CF' : B.line, true);
    b.rule(gx, gy + i * 10, G, i % 4 === 0 ? '#C9D3CF' : B.line);
  }
  b.rect(gx + 20, gy + 20, 200, 200, { fill: '#FFFFFF', hollow: true, stroke: '#E0A33A', dash: [4, 4], strokeWidth: 1.5 });
  b.rect(gx + 20, gy + 20, 200, 200, { kind: 'ellipse', fill: '#FFFFFF', hollow: true, stroke: B.signal, strokeWidth: 1.5 });
  b.rect(gx + 40, gy + 40, 160, 160, { fill: '#FFFFFF', hollow: true, stroke: B.signal, strokeWidth: 1.5, radius: 16 });
  const keys: Array<[string, string]> = [['#E0A33A', 'Safe zone, 2 px'], [B.signal, 'Keylines: circle 20, square 16'], ['#C9D3CF', 'Grid, 1 px at 24']];
  keys.forEach(([c, t], i) => {
    b.rect(gx, gy + G + 32 + i * 32, 16, 16, { fill: c, radius: 4 });
    b.label(gx + 28, gy + G + 30 + i * 32, t, { size: 14, weight: 500, lh: 1.4, color: B.body });
  });
  const set: Array<[string, string]> = [
    ['bolt', 'Incident'], ['user', 'Responder'], ['chat', 'War room'], ['globe', 'Status page'],
    ['document', 'Postmortem'], ['gear', 'Settings'], ['lock', 'Security'], ['mail', 'Email'],
    ['shield', 'SLA'], ['server', 'Service'], ['activity', 'Metrics'], ['key', 'API key'],
  ];
  set.forEach(([kind, name], i) => {
    const x = TX + 400 + (i % 4) * 160;
    const y = RY + 200 + Math.floor(i / 4) * 140;
    b.rect(x, y, 72, 72, { fill: B.surface, radius: 16 });
    b.glyph(x + 20, y + 20, 32, kind, B.signalTint, B.signalDeep, 1.75);
    b.label(x + 36, y + 84, name, { size: 13, weight: 500, lh: 1.35, color: B.body, align: 'center' });
  });

  // ---- Components in their states -----------------------------------------
  const KY = RY + 760 + 160;
  const KW = TX + TW;
  b.frame(0, KY, KW, 640, { title: 'Components · states', icon: '🧩', description: 'Button and text field, in every state a user can put them in' });
  head(64, KY + 64, 'Button and text field states', 'Hover deepens the fill, pressed deepens it again, and focus adds a graphite ring outside the control so it shows on any fill.', 1400);
  const states: Array<[string, string, number]> = [['Default', B.signal, 1], ['Hover', B.signalDeep, 1], ['Pressed', '#08473C', 1], ['Focus', B.signal, 1], ['Disabled', B.signal, 0.4]];
  states.forEach(([name, fill, opacity], i) => {
    const x = 64 + i * 260;
    b.label(x, KY + 196, name, { size: 13, weight: 600, lh: 1.35, color: B.muted });
    if (name === 'Focus') b.rect(x - 4, KY + 228 - 4, 196, 56, { fill: '#FFFFFF', hollow: true, stroke: '#3D4F59', strokeWidth: 2, radius: 14 });
    b.button(x, KY + 228, 188, 48, 'Start free trial', { fill, ink: '#FFFFFF', radius: 10, size: 15, opacity });
  });
  const fields: Array<[string, string, number, string | null, string]> = [
    ['Default', '#C9D3CF', 1, null, 'name@company.com'],
    ['Hover', '#9FB1BA', 1, null, 'name@company.com'],
    ['Focus', '#3D4F59', 2, null, 'priya@kestrel.io'],
    ['Error', '#B42318', 2, 'Use a work email address', 'priya@gmail'],
    ['Disabled', '#E3E8E6', 1, null, 'name@company.com'],
  ];
  fields.forEach(([name, edge, w, error, value], i) => {
    const x = 64 + i * 260;
    const y = KY + 344;
    b.label(x, y, name, { size: 13, weight: 600, lh: 1.35, color: B.muted });
    b.label(x, y + 32, 'Work email', { size: 13, weight: 600, lh: 1.35, color: B.ink });
    b.rect(x, y + 56, 228, 44, { fill: name === 'Disabled' ? B.surface : '#FFFFFF', stroke: edge, strokeWidth: w, radius: 10, opacity: name === 'Disabled' ? 0.6 : 1 });
    b.label(x + 14, y + 67, value, { size: 15, weight: 450, lh: 1.35, color: i >= 2 && i < 4 ? B.ink : B.muted });
    if (error) b.label(x, y + 110, error, { size: 13, weight: 500, lh: 1.35, color: B.rose });
  });

  return b.nodes(limit);
}

// ---------------------------------------------------------------------------
// 5. Social media kit: Beacon Launch Week
// ---------------------------------------------------------------------------

const GROTESK = 'Space Grotesk';

/** The campaign's motif: rings spreading from a lamp, as a lighthouse's beam reads from the sea. */
function rings(b: Board, x: number, y: number, size: number): void {
  [[1, 0.18], [0.72, 0.32], [0.44, 1]].forEach(([k, opacity]) => {
    const d = size * k;
    b.rect(x + (size - d) / 2, y + (size - d) / 2, d, d, { kind: 'donut', fill: k === 0.44 ? B.amber : B.signalBright, opacity, geometry: { innerRatio: k === 0.44 ? 0.55 : 0.8 } });
  });
}

function socialBoard(limit?: number): NewNodeInput[] {
  const b = new Board();
  const N = B.ink;
  const art = (x: number, y: number, w: number, h: number, title: string, icon: string, description: string, preset: string | undefined, safe: { top: number; right: number; bottom: number; left: number }) =>
    b.frame(x, y, w, h, { title, icon, description, fill: N, preset, safeArea: safe });
  const mark = (x: number, y: number, size: number) => {
    beaconMark(b, x, y, size);
    b.label(x + size * 1.35, y + size * 0.08, 'Beacon', { size: size * 0.72, weight: 700, lh: 1.2, ls: -0.5, color: '#FFFFFF' }, N);
  };
  const even = (v: number) => ({ top: v, right: v, bottom: v, left: v });

  // ---- Story 1080×1920 ------------------------------------------------------
  art(0, 0, 1080, 1920, 'Instagram story · Day 1', '📱', '1080 × 1920; the safe area keeps copy clear of the app’s own bars', 'story', { top: 250, right: 64, bottom: 320, left: 64 });
  mark(96, 276, 56);
  b.pill(96, 392, 56, 'Day 1 of 5', { fill: B.amber, ink: N, radius: 28, size: 26, padX: 28, family: GROTESK, weight: 700 });
  b.text(96, 480, 888, 'Paging\n2.0', { size: 200, weight: 700, lh: 0.95, ls: -6, color: '#FFFFFF', family: GROTESK }, N);
  b.text(96, 900, 860, 'Escalations that follow the sun, live today on every Team plan.', { size: 44, weight: 500, lh: 1.3, color: B.navyMuted }, N);
  rings(b, 340, 1170, 400);
  b.label(540, 1592, 'Swipe up for the changelog', { size: 32, weight: 600, lh: 1.3, color: '#FFFFFF', align: 'center', family: GROTESK }, N);

  // ---- Instagram post 1080×1080 --------------------------------------------
  const IX = 1240;
  art(IX, 0, 1080, 1080, 'Instagram post · Teaser', '🔳', '1080 × 1080, 64 clear on every side', 'square', even(64));
  mark(IX + 96, 96, 56);
  b.text(IX + 96, 296, 888, 'Launch\nWeek', { size: 210, weight: 700, lh: 0.92, ls: -7, color: '#FFFFFF', family: GROTESK }, N);
  b.label(IX + 96, 720, '13–17 October', { size: 60, weight: 700, lh: 1.15, ls: -1, color: B.amber, family: GROTESK }, N);
  b.text(IX + 96, 816, 560, 'Five launches from Beacon, one a day.', { size: 36, weight: 500, lh: 1.3, color: B.navyMuted }, N);
  rings(b, IX + 680, 680, 320);

  // ---- X header 1500×500 ----------------------------------------------------
  art(IX, 1240, 1500, 500, 'X header', '🪧', '1500 × 500; the profile photo covers the lower left, so copy sits right', undefined, even(60));
  rings(b, IX + 120, 1240 + 70, 360);
  b.label(IX + 600, 1240 + 140, 'Launch Week', { size: 104, weight: 700, lh: 1.05, ls: -3, color: '#FFFFFF', family: GROTESK }, N);
  b.label(IX + 600, 1240 + 270, '13–17 October · one launch a day', { size: 40, weight: 600, lh: 1.25, color: B.amber, family: GROTESK }, N);

  // ---- YouTube thumbnail 1280×720 -------------------------------------------
  const YX = 2900;
  art(YX, 0, 1280, 720, 'YouTube thumbnail · Day 1', '🎬', '1280 × 720; the duration badge covers the lower right', 'thumbnail', even(48));
  b.pill(YX + 72, 88, 52, 'Day 1 of 5', { fill: B.amber, ink: N, radius: 26, size: 24, padX: 24, family: GROTESK, weight: 700 });
  b.text(YX + 72, 176, 720, 'We rebuilt\npaging.', { size: 124, weight: 700, lh: 0.98, ls: -4, color: '#FFFFFF', family: GROTESK }, N);
  b.rect(YX + 72, 456, 240, 14, { fill: B.amber, radius: 7 });
  b.text(YX + 72, 506, 640, 'Escalations that follow the sun', { size: 40, weight: 500, lh: 1.25, color: B.navyMuted }, N);
  // A phone with the page arriving on it.
  b.rect(YX + 880, 72, 300, 600, { fill: B.navyRaised, stroke: '#3A4C57', strokeWidth: 3, radius: 44 });
  b.rect(YX + 900, 200, 260, 196, { fill: '#FFFFFF', radius: 20, shadow: 'lifted' });
  beaconMark(b, YX + 920, 220, 28);
  b.label(YX + 958, 224, 'Beacon · now', { size: 15, weight: 600, lh: 1.35, color: B.muted });
  b.text(YX + 920, 264, 220, 'SEV-1: payments-api errors at 12%', { size: 18, weight: 650, lh: 1.3, color: B.ink });
  b.button(YX + 920, 336, 220, 40, 'Acknowledge', { fill: B.signal, ink: '#FFFFFF', radius: 10, size: 16 });

  // ---- LinkedIn 1200×627 ----------------------------------------------------
  const LY = 880;
  art(YX, LY, 1200, 627, 'LinkedIn post', '💼', '1200 × 627, the size LinkedIn shows uncropped in the feed', undefined, { top: 40, right: 60, bottom: 40, left: 60 });
  b.text(YX + 64, LY + 64, 640, 'Launch Week starts Monday', { size: 56, weight: 700, lh: 1.1, ls: -1.5, color: '#FFFFFF', family: GROTESK }, N);
  b.label(YX + 64, LY + 216, 'Five launches in five days, live at 17:00 BST.', { size: 24, weight: 500, lh: 1.35, color: B.navyMuted }, N);
  const days: Array<[string, string]> = [['Mon', 'Paging 2.0'], ['Tue', 'War rooms'], ['Wed', 'Timeline search'], ['Thu', 'Status pages'], ['Fri', 'Mobile app']];
  days.forEach(([d, what], i) => {
    const y = LY + 296 + i * 54;
    b.label(YX + 64, y, d, { size: 24, weight: 700, lh: 1.3, color: B.amber, family: GROTESK }, N);
    b.label(YX + 150, y, what, { size: 24, weight: 500, lh: 1.3, color: '#FFFFFF' }, N);
  });
  rings(b, YX + 740, LY + 114, 400);

  return b.nodes(limit);
}

// ---------------------------------------------------------------------------
// 6. Dashboard UI: Beacon's reliability overview
// ---------------------------------------------------------------------------

function dashboardBoard(limit?: number): NewNodeInput[] {
  const b = new Board();
  const W = 1440;
  const H = 1024;
  b.frame(0, 0, W, H, { title: 'Beacon · Reliability overview', icon: '📊', description: 'Desktop preset; both charts read live from the services table', fill: B.surface, preset: 'desktop' });

  // Sidebar.
  const SIDE = 240;
  b.rect(0, 0, SIDE, H, { fill: '#FFFFFF' });
  b.rule(SIDE, 0, H, B.line, true);
  beaconMark(b, 24, 28, 28);
  b.label(64, 30, 'Beacon', { size: 19, weight: 700, lh: 1.2, ls: -0.3, color: B.ink });
  const nav: Array<[string, string]> = [['Overview', 'activity'], ['Incidents', 'bolt'], ['On-call', 'user'], ['Services', 'server'], ['Postmortems', 'document'], ['Status pages', 'globe'], ['Settings', 'gear']];
  nav.forEach(([name, kind], i) => {
    const y = 96 + i * 44;
    if (i === 0) b.rect(12, y - 9, SIDE - 24, 38, { fill: B.signalTint, radius: 8 });
    b.glyph(28, y + 1, 18, kind, i === 0 ? B.signalTint : '#FFFFFF', i === 0 ? B.signalDeep : B.muted, 1.4);
    b.label(58, y, name, { size: 14, weight: i === 0 ? 600 : 500, lh: 1.4, color: i === 0 ? B.signalDeep : B.body });
  });
  b.rule(24, H - 88, SIDE - 48, B.line);
  b.disc(44, H - 48, 18, B.signal, { label: 'PR', size: 12 });
  b.label(72, H - 64, 'Priya Raman', { size: 14, weight: 600, lh: 1.35, color: B.ink });
  b.label(72, H - 44, 'Acme Payments', { size: 13, weight: 450, lh: 1.35, color: B.muted });

  // Header and filters.
  const X0 = SIDE + 40;
  const CW = W - X0 - 40;
  b.label(X0, 36, 'Reliability overview', { size: 28, weight: 700, lh: 1.25, ls: -0.5, color: B.ink });
  b.label(X0, 76, 'All services · last 30 days · updated 2 minutes ago', { size: 14, weight: 450, lh: 1.4, color: B.muted });
  let fx = X0;
  for (const f of ['Last 30 days  ▾', 'All teams  ▾']) fx += b.pill(fx, 116, 36, f, { fill: '#FFFFFF', ink: B.ink, stroke: B.line, radius: 8, size: 14, weight: 500, padX: 14 }).width + 8;
  fx += 16;
  for (const [sev, on] of [['SEV-1', true], ['SEV-2', true], ['SEV-3', false]] as const) {
    fx += b.pill(fx, 116, 36, sev, on ? { fill: B.ink, ink: '#FFFFFF', radius: 18, size: 13, padX: 14 } : { fill: '#FFFFFF', ink: B.body, stroke: B.line, radius: 18, size: 13, padX: 14 }).width + 8;
  }
  b.button(X0 + CW - 128, 116, 128, 36, 'Export CSV', { fill: '#FFFFFF', ink: B.ink, stroke: B.line, radius: 8, size: 14 });

  // KPI cards.
  const kpis: Array<[string, string, string, 'good' | 'bad' | 'flat']> = [
    ['Open incidents', '3', '2 SEV-2 · 1 SEV-3', 'flat'],
    ['Time to acknowledge', '1m 32s', '−41s vs September', 'good'],
    ['Time to resolve', '38 min', '+6 min vs September', 'bad'],
    ['SLO attainment', '99.94%', 'Target 99.90%', 'good'],
  ];
  const KW = (CW - 3 * 24) / 4;
  kpis.forEach(([label, value, delta, tone], i) => {
    const x = X0 + i * (KW + 24);
    b.rect(x, 176, KW, 116, { fill: '#FFFFFF', stroke: B.line, radius: 12 });
    b.label(x + 20, 194, label, { size: 13, weight: 600, lh: 1.35, color: B.muted });
    b.label(x + 20, 218, value, { size: 30, weight: 700, lh: 1.2, ls: -0.8, color: B.ink });
    const [fill, ink] = tone === 'good' ? [B.signalTint, B.signalDeep] : tone === 'bad' ? [B.roseTint, B.rose] : [B.surface, B.body];
    b.pill(x + 20, 258, 22, delta, { fill, ink, radius: 11, size: 12, weight: 600, padX: 8 });
  });

  // The table both charts read.
  const services: Array<[string, string, number, number, number, number, string]> = [
    ['checkout-api', 'Payments', 9, 1, 1.2, 42, '99.91%'],
    ['payments-api', 'Payments', 6, 1, 0.9, 55, '99.93%'],
    ['notifications', 'Platform', 7, 0, 1.8, 26, '99.95%'],
    ['media-cdn', 'Platform', 5, 0, 1.1, 47, '99.94%'],
    ['search', 'Discovery', 4, 0, 2.1, 31, '99.97%'],
    ['auth', 'Identity', 3, 0, 1.4, 18, '99.99%'],
    ['catalog', 'Discovery', 2, 0, 2.6, 22, '99.98%'],
  ];
  const TY = 652;
  b.rect(X0, TY, CW, 332, { fill: '#FFFFFF', stroke: B.line, radius: 12 });
  b.label(X0 + 20, TY + 18, 'Services', { size: 16, weight: 650, lh: 1.35, color: B.ink });
  b.label(X0 + CW - 20, TY + 20, 'Sorted by incidents', { size: 13, weight: 500, lh: 1.35, color: B.muted, align: 'right' });
  const tbl = sheet(X0 + 12, TY + 56, CW - 24, {
    title: 'Services',
    columns: [
      { head: 'Service', width: 1.4, cells: services.map((r) => r[0]), style: { bold: true } },
      { head: 'Team', cells: services.map((r) => r[1]) },
      { head: 'Incidents', type: 'number', width: 0.9, cells: services.map((r) => String(r[2])) },
      { head: 'SEV-1', type: 'number', width: 0.7, cells: services.map((r) => String(r[3])) },
      { head: 'MTTA (min)', type: 'number', width: 0.9, cells: services.map((r) => r[4].toFixed(1)) },
      { head: 'MTTR (min)', type: 'number', width: 0.9, cells: services.map((r) => String(r[5])) },
      { head: 'SLO', type: 'percent', width: 0.8, cells: services.map((r) => r[6]) },
    ],
    accent: B.signal,
    rowH: 32,
    rules: [{ col: 3, when: '>0', fill: B.roseTint, color: B.rose, bold: true }],
  });
  b.add(tbl.node);

  // Two charts, linked to the table.
  const CH_W = (CW - 24) / 2;
  const chartCard = (x: number, title: string, sub: string, spec: ChartSpec) => {
    b.rect(x, 316, CH_W, 312, { fill: '#FFFFFF', stroke: B.line, radius: 12 });
    b.label(x + 20, 334, title, { size: 16, weight: 650, lh: 1.35, color: B.ink });
    b.label(x + 20, 358, sub, { size: 13, weight: 450, lh: 1.35, color: B.muted });
    b.add({ id: nanoid(), type: 'chart', x: x + 12, y: 392, width: CH_W - 24, height: 224, chart: spec } as NewNodeInput);
  };
  const base = (kind: ChartSpec['kind']): ChartSpec => ({ kind, categories: [], series: [] });
  chartCard(X0, 'Incidents by service', 'Last 30 days, from the table below', linked(tbl, { cat: 0, series: [2] }, {
    ...base('bar'),
    series: [{ name: '', values: [], color: B.signal }],
    cornerRadius: 4,
    showLegend: false,
    showValues: true,
  } as ChartSpec));
  chartCard(X0 + CH_W + 24, 'Time to acknowledge and resolve', 'Minutes per service; resolve on the right axis', linked(tbl, { cat: 0, series: [4, 5] }, {
    ...base('bar'),
    series: [
      { name: '', values: [], color: '#9FB1BA' },
      { name: '', values: [], color: B.amber, mark: 'line', axis: 'right' },
    ],
    cornerRadius: 4,
    legendPosition: 'top',
  } as ChartSpec));

  return b.nodes(limit);
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const DESIGN: Template[] = [
  {
    id: 'design-saas-landing',
    category: 'design',
    name: 'SaaS landing page',
    blurb: 'A complete desktop page for an incident tool, from hero to footer, with its grid and type spec.',
    teaches: ['Frame presets', 'Layout grid', 'Text styles', 'Drop shadows'],
    tags: ['website', 'landing page', 'marketing site', 'hero', 'pricing', 'faq', 'web design', 'saas'],
    accent: 'teal',
    build: landingBoard,
  },
  {
    id: 'design-mobile-app',
    category: 'design',
    name: 'Mobile app screens and kit',
    blurb: 'Five iPhone screens for a budgeting app, joined as a prototype flow, plus the components they share.',
    teaches: ['Phone frames', 'Nested frames', 'Prototype flow', 'Components'],
    tags: ['ios', 'mobile', 'app design', 'ui kit', 'fintech', 'prototype', 'onboarding', 'empty state'],
    accent: 'blue',
    build: mobileBoard,
  },
  {
    id: 'design-wireframes',
    category: 'design',
    name: 'Lo-fi wireframes',
    blurb: 'A marketplace from home to checkout, sketched in greys, with numbered notes a UX writer would leave.',
    teaches: ['Sketch mode', 'Hand fonts', 'Stickies', 'Annotations'],
    tags: ['wireframe', 'lo-fi', 'ux', 'marketplace', 'ecommerce', 'checkout', 'balsamiq'],
    accent: 'stone',
    build: wireframesBoard,
  },
  {
    id: 'design-system',
    category: 'design',
    name: 'Design system foundations',
    blurb: 'Primitive and semantic colour, a type scale, space, radius, elevation, icons and component states.',
    teaches: ['Tables', 'Shadow presets', 'Text styles', 'Shape icons'],
    tags: ['design system', 'tokens', 'style guide', 'typography', 'colour', 'spacing', 'components'],
    accent: 'teal',
    build: systemBoard,
  },
  {
    id: 'design-social-kit',
    category: 'design',
    name: 'Social media kit',
    blurb: 'One launch-week campaign at Instagram, story, LinkedIn, X header and YouTube thumbnail sizes.',
    teaches: ['Frame presets', 'Safe areas', 'Display type', 'Shape art'],
    tags: ['social', 'instagram', 'story', 'linkedin', 'twitter', 'youtube', 'campaign', 'launch', 'marketing'],
    accent: 'amber',
    build: socialBoard,
  },
  {
    id: 'design-dashboard',
    category: 'design',
    name: 'Admin dashboard UI',
    blurb: 'A reliability dashboard: sidebar, filters, KPI cards, a services table and two charts that read it.',
    teaches: ['Data links', 'Tables', 'Charts', 'Desktop frame'],
    tags: ['dashboard', 'admin', 'web app', 'saas', 'kpi', 'analytics', 'table', 'charts'],
    accent: 'slate',
    featured: true,
    build: dashboardBoard,
  },
];
