import type { Template } from '../templates';
import type { NewNodeInput } from '../../document/mutations';
import { code } from '../templateKit';
import { deckTheme, type DeckTheme } from '../../slides/themes';
import type { SlideBox } from '../../slides/layouts';
import { belowDeck, block, buildDeck, card, sourceData, wire, words, type DeckSlideSpec } from './slidesKit';

/**
 * Slides: decks built from frames, ready to present.
 *
 * Five talks people actually give, each in one of the deck themes and each
 * showing what a deck on a canvas does that a deck in a file cannot: a chart
 * that reads a table on the board, diagrams that are real connected objects,
 * code that is code, and smart moves between slides that share objects.
 * Every slide carries speaker notes, sections divide the longer decks, and
 * the slide view, presenter view and PDF export all read them.
 */

const theme = (id: string): DeckTheme => deckTheme(id)!;

// ---------------------------------------------------------------------------
// 1. A seed pitch
// ---------------------------------------------------------------------------

function pitch(): NewNodeInput[] {
  const t = theme('paper');
  const data = sourceData(
    0,
    belowDeck(10) + 96,
    `Month,MRR ($k)
Apr,54
May,61
Jun,70
Jul,79
Aug,91
Sep,104
Oct,118
Nov,131
Dec,149
Jan,163
Feb,174
Mar,186`,
    'area',
    1100,
    { valuePrefix: '$', valueSuffix: 'k', showLegend: false }
  );

  const flow = (box: SlideBox): NewNodeInput[] => {
    const x = box.x + 160;
    const y = box.y + 300;
    const steps = ['Invoice arrives', 'Read and coded', 'Matched to PO', 'Approved', 'Paid'];
    const cards = steps.map((s, i) =>
      card(t, x + (i % 2) * 400, y + Math.floor(i / 2) * 200, 340, 120, s, { tone: i === 2 ? 'accent' : 'surface', size: 26, name: `Step ${i + 1}` })
    );
    return [...cards, ...cards.slice(1).map((c, i) => wire(t, cards[i], c))];
  };

  const slides: DeckSlideSpec[] = [
    {
      layout: 'title',
      name: 'Tessera',
      icon: '🧾',
      content: { title: 'Tessera', subtitle: 'Accounts payable that closes itself', footer: 'Maya Okafor, CEO · Seed round · March 2026' },
      notes: 'Thirty seconds on who we are. Do not explain the product yet; the next two slides do that.',
    },
    {
      layout: 'two-column',
      name: 'Problem',
      section: 'Why now',
      content: {
        title: 'Paying a supplier still takes nine days',
        left: { heading: 'Invoices arrive everywhere', body: 'Email, portals, PDFs and scans\nMatched to orders by hand\nApprovals chased over chat' },
        right: { heading: 'And it costs real money', body: '$12.40 to process one invoice\n9.2 days from receipt to approval\nOne in thirty paid late or twice' },
      },
      notes: 'These are the median numbers from our 38 customers before they switched. The duplicate payments line is the one CFOs remember.',
    },
    {
      layout: 'image-text',
      name: 'Product',
      content: {
        title: 'Every invoice, start to finish',
        body: 'Tessera reads each invoice, codes it, matches it to the order and receipt, and routes it for approval. People only see the exceptions.',
        art: flow,
      },
      notes: 'Point at the match step: that is the hard part and the reason for our accuracy. Everything else is plumbing done well.',
      transition: 'dissolve',
    },
    {
      layout: 'big-number',
      name: 'Automation',
      section: 'Traction',
      content: { number: '71%', label: 'of invoices go from inbox to paid with no human touch', context: 'Across 38 customers over the last 90 days, up from 22% a year ago.' },
      notes: 'Pause after the number. Then: a year ago this was 22%. The model gets better with every invoice our customers approve.',
    },
    {
      layout: 'data',
      name: 'Revenue',
      content: {
        title: 'Revenue is compounding',
        chart: data.chart,
        number: '$186k',
        takeaway: 'Monthly recurring revenue, up 3.4× in twelve months with net revenue retention of 128%.',
      },
      notes: 'The chart reads the table under the deck, so it is always the current number. Update March when the month closes.',
      transition: 'smart',
    },
    {
      layout: 'two-column',
      name: 'Market',
      content: {
        title: 'A large market that still runs on email',
        left: { heading: '$14.6B', body: 'Spent each year on AP software and outsourced processing in North America and Europe' },
        right: { heading: '210,000', body: 'Mid-market companies paying more than 500 invoices a month: our first buyers' },
      },
      notes: 'Bottom up: 210k companies at an average contract of $20k is $4.2B serviceable. We need 0.1% of it for the plan.',
    },
    {
      layout: 'two-column',
      name: 'Model',
      section: 'Business',
      content: {
        title: 'Priced the way finance teams budget',
        left: { heading: 'Platform', body: '$1,200 a month\nUnlimited users and approvers\nERP sync for NetSuite, Sage and Xero' },
        right: { heading: 'Usage', body: '$0.45 per invoice past 2,000 a month\nNo charge for exceptions\n82% gross margin today' },
      },
      notes: 'Usage aligns us with their growth; that is where the 128% retention comes from.',
    },
    {
      layout: 'quote',
      name: 'Customer',
      content: {
        quote: 'We closed the books four days earlier in our first month, and nobody on my team wants to go back.',
        attribution: 'Daniel Reyes, CFO, Brightline Logistics',
      },
      notes: 'Brightline pays 6,000 invoices a month across three entities. They expanded to all three in month two.',
      transition: 'dissolve',
    },
    {
      layout: 'content',
      name: 'Team',
      content: {
        title: 'Built by people who ran AP',
        body: 'Maya Okafor, CEO: led Stripe Billing for enterprise\nJonas Berg, CTO: built the document pipeline at Brex\nPriya Raman, Finance Ops: twelve years as an AP controller',
        list: true,
      },
      notes: 'Priya is the unfair advantage. She has sat in our customers’ chair.',
    },
    {
      layout: 'closing',
      name: 'The ask',
      section: 'The ask',
      content: {
        title: 'Raising $4.5M',
        subtitle: 'Eighteen months to $5M ARR: two engineers, a second AP specialist and our first sales team.',
        footer: 'maya@tessera.example · tessera.example',
      },
      notes: 'Stop talking. Take questions.',
    },
  ];

  return buildDeck(t, slides, [
    words(t, 0, belowDeck(10), 1600, 'Source data for the revenue slide. Edit a month and the chart on slide 5 redraws.', { size: 28, weight: 600 }),
    data.table,
  ]);
}

// ---------------------------------------------------------------------------
// 2. A quarterly business review
// ---------------------------------------------------------------------------

function qbr(): NewNodeInput[] {
  const t = theme('studio');
  const y = belowDeck(8);
  const arr = sourceData(
    0,
    y + 96,
    `Quarter,Enterprise,Mid-market,Self-serve
Q4 2025,2.1,1.4,0.6
Q1 2026,2.6,1.5,0.6
Q2 2026,3.0,1.6,0.7
Q3 2026,3.9,1.8,0.7`,
    'stackedBar',
    1100,
    { valuePrefix: '€', valueSuffix: 'M' }
  );
  const grr = sourceData(
    1260,
    y + 96,
    `Month,Gross retention (%),Net retention (%)
Jul,93.8,108.2
Aug,94.1,109.0
Sep,94.4,111.6`,
    'line',
    900,
    { valueSuffix: '%' }
  );

  const slides: DeckSlideSpec[] = [
    {
      layout: 'title',
      name: 'Q3 review',
      icon: '📊',
      content: { title: 'Q3 2026 business review', subtitle: 'Customer Success, EMEA', footer: 'Lena Fischer · 14 October 2026' },
      notes: 'Forty minutes: twenty on the quarter, twenty on the three decisions at the end.',
    },
    {
      layout: 'big-number',
      name: 'Headline',
      section: 'The quarter',
      content: { number: '€4.82M', label: 'Net new ARR in Q3', context: '112% of plan, and our best quarter since 2024.' },
      notes: 'Lead with the number, then hand straight to where it came from.',
    },
    {
      layout: 'data',
      name: 'Where it came from',
      content: {
        title: 'Enterprise carried the quarter',
        chart: arr.chart,
        number: '64%',
        takeaway: 'of new ARR came from enterprise expansions, led by the DACH renewals.',
      },
      notes: 'Both charts read the tables under the deck. Finance updates them; the slides follow.',
      transition: 'smart',
    },
    {
      layout: 'data',
      name: 'Retention',
      content: {
        title: 'Retention held while we grew',
        chart: grr.chart,
        number: '94.4%',
        takeaway: 'gross revenue retention in September, the third month in a row above target.',
      },
      notes: 'Net retention is the story the board asks about: 111.6% and rising.',
      transition: 'smart',
    },
    {
      layout: 'two-column',
      name: 'Retro',
      section: 'Looking back',
      content: {
        title: 'What we learned',
        left: { heading: 'Went well', body: 'Onboarding time down to 19 days\nExecutive sponsors on 31 of 40 accounts\nRenewals forecast within 3%' },
        right: { heading: 'Did not', body: 'Two mid-market logos churned on price\nSupport backlog peaked at 9 days\nHealth scores lagged real risk' },
      },
      notes: 'Be specific about the two churns: both were annual contracts we discounted to win.',
    },
    {
      layout: 'content',
      name: 'Risks',
      content: {
        title: 'Risks for Q4',
        body: 'Three enterprise renewals worth €1.1M fall in December\nThe onboarding rebuild needs a second engineer\nA price change from our largest competitor in November',
        list: true,
      },
      notes: 'Each risk has an owner in the appendix board. Do not read them out.',
    },
    {
      layout: 'section',
      name: 'Decisions',
      section: 'Decisions',
      content: { title: 'Three decisions for today', subtitle: 'Each one is small. Together they protect the renewals.' },
      notes: 'Transition into the ask. Slow down here.',
      transition: 'dissolve',
    },
    {
      layout: 'closing',
      name: 'Asks',
      content: {
        title: 'Approve, move, fund',
        subtitle: 'Approve two CSM hires for DACH. Move renewals to annual billing. Fund the onboarding rebuild.',
        footer: 'lena.fischer@northwind.example',
      },
      notes: 'Ask for a yes or no on each before the meeting ends.',
    },
  ];

  return buildDeck(t, slides, [
    words(t, 0, y, 1100, 'ARR by segment, € millions', { size: 28, weight: 600 }),
    arr.table,
    words(t, 1260, y, 900, 'Monthly retention', { size: 28, weight: 600 }),
    grr.table,
  ]);
}

// ---------------------------------------------------------------------------
// 3. A product launch review, with a smart move across the product
// ---------------------------------------------------------------------------

function launch(): NewNodeInput[] {
  const t = theme('studio');

  /** The automation builder, drawn as the product's own cards. `explained` spreads it out to make room for the run log. */
  const builder = (explained: boolean) => (box: SlideBox): NewNodeInput[] => {
    const x = box.x + 160;
    const y = box.y + 140;
    const trigger = card(t, x, y + (explained ? 0 : 120), 520, 120, 'When a deal moves to Won', { name: 'Trigger', size: 26 });
    const check = card(t, x + (explained ? 0 : 140), y + (explained ? 200 : 340), 520, 120, 'If the value is over $50k', { name: 'Condition', size: 26 });
    const act = card(t, x + (explained ? 0 : 280), y + (explained ? 400 : 560), 520, 120, 'Create the onboarding board', { name: 'Action', size: 26, tone: 'accent' });
    const nodes = [trigger, check, act, wire(t, trigger, check), wire(t, check, act)];
    if (explained) {
      nodes.push(
        card(t, x, y + 600, 520, 160, 'Ran 2 minutes ago\nWon: Acme Corp, $82k\nBoard created by Flow', { name: 'Run log', size: 22, weight: 500, align: 'left' })
      );
    }
    return nodes;
  };

  const slides: DeckSlideSpec[] = [
    {
      layout: 'title',
      name: 'Flow 2.0',
      icon: '🚀',
      content: { title: 'Flow 2.0', subtitle: 'Automations that explain themselves', footer: 'Launch review · Design, Engineering, Marketing · 6 November' },
      notes: 'This is the go or no-go. Keep it to twenty minutes.',
    },
    {
      layout: 'quote',
      name: 'Why',
      section: 'Why we rebuilt it',
      content: {
        quote: 'I turned the automation off because I could not tell what it had done.',
        attribution: 'Operations lead, research interview 14 of 22',
      },
      notes: 'Eleven of twenty-two interviews said a version of this. Trust, not power, was the problem.',
    },
    {
      layout: 'image-text',
      name: 'Builder',
      section: 'The product',
      content: { title: 'Build it in plain words', body: 'Every step reads as a sentence, so the person who inherits an automation can read what it does.', art: builder(false) },
      notes: 'Demo live if the network allows; this slide is the fallback.',
    },
    {
      layout: 'image-text',
      name: 'Run log',
      content: { title: 'Then it shows its work', body: 'Each run leaves a receipt: what triggered it, what it checked and what it changed, linked to the record.', art: builder(true) },
      notes: 'The cards glide into place with smart move; the run log is the new part. Pause on it.',
      transition: 'smart',
    },
    {
      layout: 'big-number',
      name: 'Beta',
      section: 'Evidence',
      content: { number: '−43%', label: 'support tickets about automations during the beta', context: '1,240 beta workspaces over six weeks, against a matched control group.' },
      notes: 'The control group matters; say it out loud.',
      transition: 'dissolve',
    },
    {
      layout: 'two-column',
      name: 'Plan',
      section: 'Launch',
      content: {
        title: 'How it ships',
        left: { heading: 'Week one', body: 'On for every new workspace\nIn-app tour on first automation\nChangelog and launch post' },
        right: { heading: 'Weeks two to four', body: 'Existing workspaces in waves of 10%\nWebinar with three beta customers\nSales one-pager and demo board' },
      },
      notes: 'Rollback is a flag per wave; engineering owns the call.',
    },
    {
      layout: 'closing',
      name: 'Go',
      content: { title: 'Ship on 18 November', subtitle: 'Decision needed today on the wave plan and the pricing page copy.', footer: 'flow-launch channel · owner: Sam Whitfield' },
      notes: 'Go round the room for a yes from each lead.',
    },
  ];
  return buildDeck(t, slides);
}

// ---------------------------------------------------------------------------
// 4. Brand guidelines
// ---------------------------------------------------------------------------

function brand(): NewNodeInput[] {
  const t = theme('paper');
  const palette = [
    { name: 'Clay', hex: '#B4441C', role: 'Primary action, one per screen' },
    { name: 'Ink', hex: '#1C1917', role: 'Text and icons' },
    { name: 'Stone', hex: '#57534E', role: 'Secondary text' },
    { name: 'Sand', hex: '#F1ECE3', role: 'Cards and wells' },
  ];

  const swatches = (box: SlideBox): NewNodeInput[] => {
    const x0 = box.x + 160;
    const y0 = box.y + 340;
    return palette.flatMap((p, i) => {
      const x = x0 + i * 400;
      return [
        block(x, y0, 352, 320, p.hex, { title: p.name, appearance: { fill: [{ type: 'solid', color: p.hex, opacity: 1 }], stroke: { color: t.line, width: 1.5 }, cornerRadius: 20 } }),
        words(t, x, y0 + 352, 352, p.name, { size: 32, weight: 650 }),
        words(t, x, y0 + 404, 352, p.hex, { size: 24, tone: 'muted', mono: true }),
        words(t, x, y0 + 452, 352, p.role, { size: 22, tone: 'muted' }),
      ];
    });
  };

  const typeScale = (box: SlideBox): NewNodeInput[] => {
    const x = box.x + 160;
    const rows: Array<[string, number, string, number]> = [
      ['Display', 96, 'DM Serif Display', 400],
      ['Heading', 56, 'DM Serif Display', 400],
      ['Body', 32, 'Inter', 400],
      ['Caption', 22, 'Inter', 500],
    ];
    let y = box.y + 300;
    return rows.flatMap(([label, size, family, weight]) => {
      const sample: NewNodeInput = {
        ...words(t, x + 360, y, 1240, label === 'Body' || label === 'Caption' ? 'Clear words, set to be read' : 'Make the work feel made', { size }),
      };
      (sample.typography as Record<string, unknown>).fontFamily = family;
      (sample.typography as Record<string, unknown>).fontWeight = weight;
      sample.height = Math.ceil(size * 1.4 + 16);
      const out = [words(t, x, y + Math.max(0, size * 0.5 - 16), 320, `${label} · ${size}`, { size: 22, tone: 'muted', mono: true }), sample];
      y += Math.max(size * 1.4 + 40, 72);
      return out;
    });
  };

  const voice = (box: SlideBox): NewNodeInput[] => {
    const x = box.x + 160;
    const y = box.y + 360;
    return [
      card(t, x, y, 760, 120, 'Your board is ready', { tone: 'page', size: 30 }),
      card(t, x, y + 160, 760, 120, 'Success! Your workspace has been provisioned!', { tone: 'page', size: 26, weight: 500 }),
      words(t, x + 840, y + 36, 760, 'Say what happened, in the words people use.', { size: 28 }),
      words(t, x + 840, y + 196, 760, 'Not this: exclamation marks and system words.', { size: 28, tone: 'muted' }),
    ];
  };

  const slides: DeckSlideSpec[] = [
    {
      layout: 'title',
      name: 'Brand',
      icon: '🎨',
      content: { title: 'The Fieldnote brand', subtitle: 'How we look, write and sound. Version 3, for everyone who makes things for us.', footer: 'Brand team · Updated 2 October 2026' },
      notes: 'Keep this deck as the source; every other brand asset links here.',
    },
    {
      layout: 'quote',
      name: 'Principle',
      section: 'Foundations',
      content: { quote: 'Warm, plain and exact. We sound like a good editor, not a salesperson.', attribution: 'The one sentence to remember' },
      notes: 'Everything else in the deck is this sentence applied.',
    },
    {
      layout: 'content',
      name: 'Colour',
      section: 'Colour and type',
      content: { title: 'Four colours, used in proportion', noBody: true },
      extra: swatches,
      notes: 'Clay is rare on purpose. If two things on a screen are clay, one of them is wrong.',
    },
    {
      layout: 'content',
      name: 'Type',
      content: { title: 'Two faces, four sizes', noBody: true },
      extra: typeScale,
      notes: 'DM Serif Display only from 40 up. Below that it gets fussy; use Inter.',
      transition: 'smart',
    },
    {
      layout: 'content',
      name: 'Voice',
      section: 'Voice',
      content: { title: 'Write like this', noBody: true },
      extra: voice,
      notes: 'Read the second card aloud. Everyone winces. That is the lesson.',
    },
    {
      layout: 'two-column',
      name: 'Do and do not',
      content: {
        title: 'Do and do not',
        left: { heading: 'Do', body: 'Lead with the outcome\nUse sentence case everywhere\nGive numbers their units' },
        right: { heading: 'Do not', body: 'Stack exclamation marks\nInvent words for features\nPut text on photographs' },
      },
      notes: 'This is the slide people screenshot. Keep it to six lines.',
    },
    {
      layout: 'closing',
      name: 'Contact',
      content: { title: 'Questions go to the brand channel', subtitle: 'Logo files, templates and the full type specimen live on the brand board.', footer: 'brand@fieldnote.example' },
      notes: 'Point people at the board, not at this deck.',
    },
  ];
  return buildDeck(t, slides);
}

// ---------------------------------------------------------------------------
// 5. A conference talk
// ---------------------------------------------------------------------------

function latency(): NewNodeInput[] {
  const t = theme('ledger');

  /** The request path; `cached` adds the edge cache and moves the database off the hot path. */
  const path = (cached: boolean) => (box: SlideBox): NewNodeInput[] => {
    const x = box.x + 160;
    const y = box.y + 380;
    const client = card(t, x, y, 300, 120, 'Mobile app', { name: 'Client', size: 26 });
    const gateway = card(t, x + 400, y, 300, 120, 'API gateway', { name: 'Gateway', size: 26 });
    const feed = card(t, x + 800, y, 300, 120, 'Feed service', { name: 'Feed', size: 26 });
    const db = card(t, x + (cached ? 1200 : 800), y + (cached ? 280 : 280), 300, 120, 'Postgres', { name: 'Database', size: 26 });
    const nodes: NewNodeInput[] = [client, gateway, feed, db, wire(t, client, gateway), wire(t, gateway, feed), wire(t, feed, db)];
    if (cached) {
      const cache = card(t, x + 1200, y, 300, 120, 'Redis read cache', { name: 'Cache', size: 26, tone: 'accent' });
      nodes.push(cache, wire(t, feed, cache), words(t, x, y + 300, 1000, '94% of feed reads now stop at the cache.', { size: 28, tone: 'muted' }));
    } else {
      nodes.push(words(t, x, y + 300, 700, 'Every feed read went to Postgres.', { size: 28, tone: 'muted' }));
    }
    return nodes;
  };

  const snippet = (box: SlideBox): NewNodeInput[] => [
    code(
      box.x + 160,
      box.y + 300,
      `export async function feedFor(userId: string): Promise<Feed> {
  const key = \`feed:v3:\${userId}\`;
  const hit = await redis.get(key);
  if (hit) return decodeFeed(hit);

  // One query instead of N+1: authors join in Postgres.
  const rows = await db.query(FEED_WITH_AUTHORS, [userId, PAGE]);
  const feed = buildFeed(rows);
  await redis.set(key, encodeFeed(feed), { EX: 30 });
  return feed;
}`,
      'typescript',
      1600,
      560,
      { fontSize: 22, highlights: [3, 4, 7], filename: 'services/feed/feedFor.ts', theme: 'midnight', wrap: false }
    ),
  ];

  const slides: DeckSlideSpec[] = [
    {
      layout: 'title',
      name: 'Talk',
      icon: '⚡',
      content: { title: 'How we cut p95 latency by 60%', subtitle: 'Three changes, one quarter, no rewrite', footer: 'Ravi Menon, Staff Engineer · PerfConf Berlin 2026' },
      notes: 'Hi, I am Ravi. This is a talk about boring fixes that worked.',
    },
    {
      layout: 'big-number',
      name: 'Before',
      section: 'The problem',
      content: { number: '1.9s', label: 'p95 to load the home feed in January', context: 'Measured at the client, on a mid-range Android phone over 4G.' },
      notes: 'Say where it is measured. Server timings hid most of this.',
    },
    {
      layout: 'content',
      name: 'Path before',
      content: { title: 'Where the time went', noBody: true },
      extra: path(false),
      notes: 'Tracing showed 62% of the time in the database, most of it N+1 author lookups.',
    },
    {
      layout: 'content',
      name: 'Path after',
      section: 'The fixes',
      content: { title: 'Where the time went', noBody: true },
      extra: path(true),
      notes: 'Smart move: the database steps aside and the cache slides in. Let the animation land before speaking.',
      transition: 'smart',
    },
    {
      layout: 'content',
      name: 'Code',
      content: { title: 'The read path, all of it', noBody: true },
      extra: snippet,
      notes: 'Highlighted lines: the cache read, and the single query that replaced N+1. A 30-second TTL was enough.',
      transition: 'dissolve',
    },
    {
      layout: 'two-column',
      name: 'Other fixes',
      content: {
        title: 'Two smaller changes',
        left: { heading: 'Ship less JSON', body: 'Dropped unused fields from the feed\nPayload down from 410 KB to 96 KB' },
        right: { heading: 'Start sooner', body: 'Prefetch the feed during app start\nFirst paint no longer waits for auth' },
      },
      notes: 'Each of these was a day of work. Measure before you rewrite anything.',
    },
    {
      layout: 'big-number',
      name: 'After',
      section: 'Results',
      content: { number: '760ms', label: 'p95 to load the home feed in April', context: 'Down 60%, with database load down by two thirds.' },
      notes: 'Same phone, same network. Then pause.',
      transition: 'smart',
    },
    {
      layout: 'closing',
      name: 'Thanks',
      content: { title: 'Thank you', subtitle: 'Slides and the tracing setup are on the board linked below.', footer: 'ravi.menon@feedly.example · perfconf.example/talks/feed-latency' },
      notes: 'Take questions. Have the tracing screenshot ready.',
    },
  ];
  return buildDeck(t, slides);
}

export const SLIDES: Template[] = [
  {
    id: 'slides-pitch',
    category: 'slides',
    name: 'Seed pitch deck',
    blurb: 'Ten slides for a seed round, with a revenue chart that reads its table.',
    teaches: ['Slides', 'Linked chart', 'Smart move'],
    tags: ['pitch', 'fundraising', 'startup', 'investors', 'deck', 'presentation'],
    accent: 'stone',
    featured: true,
    build: pitch,
  },
  {
    id: 'slides-qbr',
    category: 'slides',
    name: 'Quarterly business review',
    blurb: 'The quarter in eight slides: the number, where it came from, and the decisions.',
    teaches: ['Linked charts', 'Sections', 'Speaker notes'],
    tags: ['qbr', 'quarterly', 'review', 'customer success', 'arr', 'deck'],
    accent: 'indigo',
    build: qbr,
  },
  {
    id: 'slides-launch',
    category: 'slides',
    name: 'Product launch review',
    blurb: 'A go or no-go for a launch, with the product drawn and smart-moved.',
    teaches: ['Smart move', 'Connectors', 'Sections'],
    tags: ['launch', 'product', 'go to market', 'review', 'deck'],
    accent: 'slate',
    build: launch,
  },
  {
    id: 'slides-brand',
    category: 'slides',
    name: 'Brand guidelines',
    blurb: 'Colour, type and voice on seven slides people actually read.',
    teaches: ['Type scale', 'Colour swatches', 'Sections'],
    tags: ['brand', 'design system', 'guidelines', 'style guide', 'typography', 'deck'],
    accent: 'orange',
    build: brand,
  },
  {
    id: 'slides-latency',
    category: 'slides',
    name: 'Conference talk',
    blurb: 'How we cut p95 latency by 60%: a technical talk with code and a diagram.',
    teaches: ['Code block', 'Diagram', 'Smart move'],
    tags: ['talk', 'conference', 'engineering', 'performance', 'latency', 'deck'],
    accent: 'teal',
    build: latency,
  },
];
