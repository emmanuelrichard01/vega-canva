import type { NewNodeInput } from '../document/mutations';
import type { Template } from './templates';
import {
  band, box, BRAND, BRAND_INK, caption, chart, dashed, frame, HAIRLINE, heading, HUE, INK,
  INK_MID, INK_SOFT, layer, link, note, PAPER, pill, plot, RULE, sticky, table, TINT, title,
} from './templateKit';

/**
 * The boards a team actually keeps open.
 *
 * ## What separates these from a "template"
 *
 * Most planning templates are an empty grid with column headings, which is a
 * form. A form tells you the shape of the answer and nothing about how to get
 * one, and it is why so many of them are opened once and abandoned: the hard
 * part of a quarter plan was never drawing the columns.
 *
 * So each of these arrives **mid-use** — with real bets, real numbers, notes
 * arguing with each other, and at least one thing visibly going wrong. That is
 * the difference between a template that shows you what to do and one that
 * shows you what it looks like when it is working. Delete our content and you
 * have the form; read it first and you have the method.
 *
 * ## One visual language
 *
 * Everything here is built from `templateKit`, so a board pulled from this
 * file and one pulled from `systemTemplates` sit side by side in the gallery
 * without looking like they came from different products.
 */

// ---------------------------------------------------------------------------

/** A column of sticky notes under a heading — the unit almost every workshop board is made of. */
const column = (
  x: number,
  y: number,
  name: string,
  theme: 'yellow' | 'mint' | 'sky' | 'pink' | 'lavender' | 'peach' | 'white',
  items: string[],
  width = 220
): NewNodeInput[] => {
  const out: NewNodeInput[] = [heading(x, y, name, 17)];
  items.forEach((text, i) => {
    out.push(sticky(x, y + 42 + i * (width * 0.62 + 14), text, theme, { width, height: width * 0.62 }));
  });
  return out;
};

export const WORK_TEMPLATES: Template[] = [
  // -------------------------------------------------------------------------
  {
    id: 'work-quarter',
    category: 'work',
    name: 'Q3 planning wall',
    blurb: 'A quarter mid-flight: three bets, the capacity they cost, and the two things already slipping.',
    teaches: ['Planning', 'Capacity', 'Charts'],
    build: () => {
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -170, 'Q3 planning wall'),
        caption(0, -104, 'Six weeks in. Two bets are on track, one is not, and the capacity chart is the reason why.', 980)
      );

      // -- The bets ----------------------------------------------------------
      nodes.push(heading(0, -20, 'Three bets, and what would make each one true'));

      const BETS: Array<[string, string, string, string]> = [
        ['Bet 1 · Activation', 'New teams reach a shared board in their first session', '38% → 60%', 'green'],
        ['Bet 2 · Performance', 'A 5,000-object board pans at 60fps on a four-year-old laptop', '41fps → 60fps', 'amber'],
        ['Bet 3 · Enterprise', 'SSO and audit logs, enough to pass a security review', 'not started', 'rose'],
      ];
      const betNodes = BETS.map(([name, claim, metric, tint], i) => {
        const x = i * 520;
        const card = box(x, 30, 470, 150, '', tint as never, {
          appearance: { fill: [{ type: 'solid', color: tint === 'green' ? TINT.green : tint === 'amber' ? TINT.amber : TINT.rose }], cornerRadius: 16 },
        });
        return { card, extras: [
          heading(x + 24, 52, name, 18),
          note(x + 24, 86, claim, 420, 15, INK),
          pill(x + 24, 134, 200, metric, tint as never),
        ] };
      });
      nodes.push(...betNodes.flatMap((b) => [b.card, ...b.extras]));

      // -- Lanes -------------------------------------------------------------
      const LANE_Y = 240;
      nodes.push(heading(0, LANE_Y, 'The work, by where it is'));
      const LANES: Array<[string, 'yellow' | 'mint' | 'sky' | 'pink' | 'lavender' | 'peach' | 'white', string[]]> = [
        ['Shipped', 'mint', ['Template gallery\nrebuilt — 47 boards', 'Presence: follow\n+ audience count', 'Link previews\nanswer in two parts']],
        ['In flight', 'sky', ['Object culling\nby viewport', 'SSO discovery\n(blocked, see risk)', 'Onboarding: first\nshared board']],
        ['Next', 'lavender', ['Audit log schema', 'Offline edit queue', 'Comment resolve\nnotifications']],
        ['Parked, with a reason', 'peach', ['Mobile editing —\nno capacity until Q4', 'Plugin API —\nwaiting on SSO']],
      ];
      LANES.forEach(([name, theme, items], i) => {
        nodes.push(band(i * 400 - 20, LANE_Y + 40, 370, 700, [TINT.green, TINT.sky, TINT.violet, TINT.orange][i], 0.4));
        nodes.push(...column(i * 400, LANE_Y + 56, name, theme, items, 240));
      });

      // -- Capacity ----------------------------------------------------------
      nodes.push(
        heading(1660, LANE_Y, 'Why bet 3 has not started'),
        chart(
          1660,
          LANE_Y + 44,
          plot('stackedBar', {
            title: 'Engineering weeks, planned vs actual',
            categories: ['Wk 1–2', 'Wk 3–4', 'Wk 5–6', 'Wk 7–8', 'Wk 9–10', 'Wk 11–12'],
            series: [
              { name: 'Bet 1', values: [4, 4, 3, 2, 2, 1] },
              { name: 'Bet 2', values: [2, 3, 4, 5, 4, 3] },
              { name: 'Bet 3', values: [0, 0, 0, 1, 2, 4] },
              { name: 'Unplanned', values: [2, 3, 5, 4, 3, 2] },
            ],
            showLegend: true,
            valueSuffix: ' wks',
          }),
          620,
          360
        ),
        sticky(1660, LANE_Y + 430, 'Unplanned work is a third of the quarter. It is not a surprise — it is every quarter — so the plan should have carried it from week one.', 'pink', { width: 290, height: 200 }),
        sticky(1990, LANE_Y + 430, 'Bet 3 was scheduled into the weeks that unplanned work always eats. That is the whole story.', 'yellow', { width: 290, height: 200 })
      );

      // -- Risks -------------------------------------------------------------
      nodes.push(
        heading(0, 1000, 'Risks, owned'),
        table(
          0,
          1044,
          {
            columns: [
              { id: 'c1', name: 'Risk', width: 380 },
              { id: 'c2', name: 'Owner', width: 120 },
              { id: 'c3', name: 'Likelihood', width: 120 },
              { id: 'c4', name: 'If it happens', width: 300 },
              { id: 'c5', name: 'Doing about it', width: 300 },
            ],
            cells: [
              ['SSO vendor review slips past Q3', 'Priya', 'High', 'Bet 3 moves to Q4 entirely', 'Booked review for wk 8, not wk 11'],
              ['Culling regresses text rendering', 'Sam', 'Medium', 'Perf bet lands, quality drops', 'Visual diff on 40 boards in CI'],
              ['Two people leave in the same month', 'Alex', 'Low', 'Everything slips one sprint', 'No single-owner workstreams'],
              ['Activation metric is measuring the wrong thing', 'Jo', 'Medium', 'We optimise a number nobody feels', 'Five user sessions, wk 7'],
            ].map((r) => r.map((v) => ({ value: v }))),
          } as never,
          1220,
          180
        ),
        note(0, 1250, 'A risk with no owner and no action is a worry, not a risk. Both columns are the point of the table.', 1220, 15)
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'work-brand',
    category: 'work',
    name: 'Brand exploration',
    blurb: 'Three directions argued properly: marks, palettes, type, and the one that wins with a reason.',
    teaches: ['Moodboards', 'Type scale', 'Critique'],
    build: () => {
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -170, 'Brand exploration'),
        caption(0, -104, 'Three directions, shown at the sizes they will actually be used at, and chosen out loud.', 980)
      );

      const DIRECTIONS: Array<{
        name: string;
        line: string;
        palette: string[];
        font: string;
        tint: string;
      }> = [
        {
          name: 'Direction A · Instrument',
          line: 'Quiet, precise, gets out of the way. Reads as a tool.',
          palette: [BRAND_INK, '#F7F7F7', BRAND, '#4B5563', '#E5E7EB'],
          font: 'Inter',
          tint: TINT.slate,
        },
        {
          name: 'Direction B · Studio',
          line: 'Warm, made by people, a little bit ink-on-paper.',
          palette: ['#1C1917', '#FAF7F2', '#B45309', '#78716C', '#E7E5E4'],
          font: 'Inter',
          tint: TINT.stone,
        },
        {
          name: 'Direction C · Signal',
          line: 'High contrast, confident, unmistakable at 16px.',
          palette: ['#0B0D12', PAPER, HUE.indigo, INK_MID, HAIRLINE],
          font: 'Inter',
          tint: TINT.indigo,
        },
      ];

      DIRECTIONS.forEach((d, i) => {
        const x = i * 760;
        nodes.push(frame(x, 0, 700, 880, d.name));
        nodes.push(band(x, 0, 700, 880, d.tint, 0.5));

        nodes.push(heading(x + 40, 40, d.name, 22), note(x + 40, 76, d.line, 620, 15));

        // The mark, at three sizes — which is the only honest way to judge one.
        nodes.push(heading(x + 40, 130, 'The mark, at the sizes it will live at', 14));
        [88, 44, 22].forEach((size, j) => {
          nodes.push(
            box(x + 40 + j * 130, 164, size, size, '', d.palette[2], {
              geometry: { kind: 'squircle' },
              appearance: { fill: [{ type: 'solid', color: d.palette[2] }], cornerRadius: size * 0.28 },
            }),
            note(x + 40 + j * 130, 164 + size + 8, `${size}px`, 80, 11, INK_SOFT)
          );
        });

        // Palette
        nodes.push(heading(x + 40, 290, 'Palette', 14));
        d.palette.forEach((c, j) => {
          nodes.push(
            box(x + 40 + j * 130, 318, 116, 76, '', c, {
              appearance: { fill: [{ type: 'solid', color: c }], cornerRadius: 10 },
            }),
            note(x + 40 + j * 130, 400, c, 116, 11, INK_SOFT)
          );
        });

        // Type scale — shown as type, not as a table of numbers.
        nodes.push(heading(x + 40, 440, 'Type scale', 14));
        const SCALE: Array<[string, number, number]> = [
          ['Display 44', 44, 700],
          ['Headline 28', 28, 650],
          ['Title 18', 18, 600],
          ['Body 15 — the size everything is actually read at.', 15, 450],
        ];
        let ty = 472;
        SCALE.forEach(([text, size, weight]) => {
          nodes.push({
            id: `${d.name}-t-${size}` as never,
            type: 'text',
            x: x + 40,
            y: ty,
            width: 620,
            height: size * 1.4,
            text,
            resize: 'width',
            typography: { fontSize: size, fontWeight: weight, color: d.palette[0], lineHeight: 1.25 },
          } as never);
          ty += size * 1.65 + 10;
        });

        // In use
        nodes.push(heading(x + 40, 660, 'In use', 14));
        nodes.push(
          box(x + 40, 690, 300, 150, 'Your board,\nshared.', d.palette[1], {
            appearance: { fill: [{ type: 'solid', color: d.palette[1] }], cornerRadius: 14, stroke: { color: d.palette[4], width: 1 } },
            typography: { fontSize: 26, fontWeight: 700, color: d.palette[0], align: 'left', verticalAlign: 'middle' },
          }),
          box(x + 360, 690, 300, 150, 'Your board,\nshared.', d.palette[0], {
            appearance: { fill: [{ type: 'solid', color: d.palette[0] }], cornerRadius: 14 },
            typography: { fontSize: 26, fontWeight: 700, color: d.palette[1], align: 'left', verticalAlign: 'middle' },
          })
        );
      });

      // The critique
      nodes.push(
        heading(0, 940, 'What people actually said'),
        sticky(0, 990, 'A is the only one that still reads at 22px. B’s mark turns to mud.', 'yellow', { width: 240, height: 160 }),
        sticky(270, 990, 'B has the most personality and we will get bored of it in a year.', 'peach', { width: 240, height: 160 }),
        sticky(540, 990, 'C looks like six other developer tools. Correct, and that is the risk.', 'pink', { width: 240, height: 160 }),
        sticky(810, 990, 'Nobody defended the amber in A and everybody used it in the mock-ups.', 'mint', { width: 240, height: 160 }),
        box(1090, 990, 460, 160, 'Chosen: A, with B’s warmth in the paper tone.\nThe amber stays — it is the only thing on the page nobody could do without.', TINT.green, {
          typography: { fontSize: 16, fontWeight: 600, color: INK, align: 'left', verticalAlign: 'middle' },
        }),
        note(1090, 1170, 'Write the decision on the board, next to the work. A decision recorded somewhere else is a decision that gets relitigated.', 460, 14)
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'work-roadmap',
    category: 'work',
    name: 'Roadmap, with the dependencies drawn',
    blurb: 'Now, next and later — plus the four arrows that decide the real order.',
    teaches: ['Roadmapping', 'Dependencies', 'Timelines'],
    build: () => {
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -170, 'Roadmap'),
        caption(0, -104, 'Every roadmap is three columns. The arrows are the part that makes it true.', 900)
      );

      const COLS: Array<[string, string, string]> = [
        ['Now', 'shipping this quarter', TINT.green],
        ['Next', 'started when Now empties', TINT.sky],
        ['Later', 'real, unscheduled, not promised', TINT.slate],
      ];
      COLS.forEach(([name, sub, tint], i) => {
        nodes.push(band(i * 540, -10, 500, 760, tint, 0.5));
        nodes.push(heading(i * 540 + 24, 16, name, 22), note(i * 540 + 24, 50, sub, 440, 14));
      });

      const card = (col: number, slot: number, name: string, who: string) => {
        const x = col * 540 + 24;
        const y = 90 + slot * 118;
        return {
          shape: box(x, y, 450, 96, '', PAPER, {
            appearance: { fill: [{ type: 'solid', color: PAPER }], cornerRadius: 12, stroke: { color: HAIRLINE, width: 1 } },
          }),
          bits: [heading(x + 18, y + 18, name, 17), note(x + 18, y + 48, who, 400, 13, INK_SOFT)],
        };
      };

      const now1 = card(0, 0, 'Object culling by viewport', 'Sam · perf bet · wk 9');
      const now2 = card(0, 1, 'Template gallery rebuild', 'Jo · shipped wk 6');
      const now3 = card(0, 2, 'Presence: follow + audience', 'Ali · shipped wk 5');
      const now4 = card(0, 3, 'Link previews in two parts', 'Ali · shipped wk 6');

      const next1 = card(1, 0, 'SSO (SAML + SCIM)', 'Priya · blocked on review');
      const next2 = card(1, 1, 'Audit log', 'Priya · needs SSO first');
      const next3 = card(1, 2, 'Offline edit queue', 'Sam · needs culling first');

      const later1 = card(2, 0, 'Plugin API', 'unowned · needs audit log');
      const later2 = card(2, 1, 'Mobile editing', 'unowned');
      const later3 = card(2, 2, 'Version branching', 'unowned');

      const all = [now1, now2, now3, now4, next1, next2, next3, later1, later2, later3];
      nodes.push(...all.flatMap((c) => [c.shape, ...c.bits]));

      nodes.push(
        link(next1.shape.id, next2.shape.id, { label: 'needs' }),
        link(now1.shape.id, next3.shape.id, { label: 'needs' }),
        link(next2.shape.id, later1.shape.id, { label: 'needs' }),
        dashed(now3.shape.id, later2.shape.id, { label: 'informs' })
      );

      nodes.push(
        sticky(0, 800, 'Three of the four arrows point out of one card: SSO. It is in Next and it is holding two quarters of work.', 'pink', { width: 250, height: 180 }),
        sticky(280, 800, 'Which means the only scheduling decision on this board is whether SSO moves to Now.', 'yellow', { width: 250, height: 180 })
      );

      nodes.push(
        heading(600, 800, 'The same thing, over time'),
        chart(
          600,
          844,
          plot('timeline', {
            title: 'When each lands, if SSO stays in Next',
            categories: ['Culling', 'SSO', 'Audit log', 'Offline queue', 'Plugin API'],
            series: [{ name: 'week', values: [9, 18, 24, 14, 32] }],
            showValues: true,
            valueSuffix: ' wk',
          }),
          900,
          320
        ),
        note(600, 1190, 'Drag a card between columns and re-draw one arrow. That is the whole planning meeting.', 900, 15)
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'work-research',
    category: 'work',
    name: 'Research synthesis',
    blurb: 'Twelve interviews becoming four themes — the affinity wall, with the counting done.',
    teaches: ['Affinity mapping', 'Synthesis', 'Evidence'],
    build: () => {
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -170, 'Research synthesis'),
        caption(0, -104, 'Quotes on the left, themes on the right, and a number under each so nobody can promote an anecdote.', 1000)
      );

      // Raw observations
      nodes.push(heading(0, -20, 'What people said'), band(-20, 20, 560, 900, TINT.slate, 0.5));
      const QUOTES: Array<[string, 'yellow' | 'peach' | 'sky' | 'mint' | 'pink']> = [
        ['“I made a board and then couldn’t find it again.”', 'yellow'],
        ['“I sent the link and they said it asked them to sign in.”', 'peach'],
        ['“I don’t know if they can edit or just look.”', 'peach'],
        ['“It was fine until about a thousand stickies.”', 'sky'],
        ['“I use it on the call and then never again.”', 'yellow'],
        ['“I didn’t know anyone else was on it.”', 'mint'],
        ['“I wanted to show them the corner I was in.”', 'mint'],
        ['“We keep one board per project and lose them.”', 'yellow'],
        ['“Pasting a Figma link did nothing useful.”', 'pink'],
        ['“Scrolling got sticky on my old laptop.”', 'sky'],
      ];
      QUOTES.forEach(([text, theme], i) => {
        nodes.push(sticky(10 + (i % 2) * 265, 60 + Math.floor(i / 2) * 175, text, theme, { width: 250, height: 160 }));
      });

      // Themes
      nodes.push(heading(620, -20, 'What it means'));
      const THEMES: Array<[string, string, number, string]> = [
        ['Boards get lost', 'No account, no list they trust. The link is the only handle and it lives in a chat.', 4, TINT.amber],
        ['Permission is invisible', 'Nobody can tell what a link grants until somebody complains.', 2, TINT.orange],
        ['It slows down before it breaks', 'Degradation, not failure — which is why nobody reports it.', 2, TINT.sky],
        ['Presence is one-directional', 'You can see them. They cannot see you looking.', 2, TINT.green],
      ];
      THEMES.forEach(([name, meaning, count, tint], i) => {
        const y = 20 + i * 220;
        nodes.push(
          box(620, y, 620, 190, '', tint, { appearance: { fill: [{ type: 'solid', color: tint }], cornerRadius: 14 } }),
          heading(646, y + 22, name, 20),
          note(646, y + 56, meaning, 560, 15, INK),
          pill(646, y + 130, 190, `${count} of 12 people`, 'slate')
        );
      });

      // What we did about it
      nodes.push(
        heading(1320, -20, 'And what changed'),
        ...[
          ['Boards get lost', 'A removal shelf, and a board list you can export.'],
          ['Permission is invisible', 'The share dialog shows the card the link will produce.'],
          ['It slows down before it breaks', 'Viewport culling — the Q3 perf bet.'],
          ['Presence is one-directional', '“3 people are following you”, and Show everyone.'],
        ].flatMap(([theme, action], i) => {
          const y = 20 + i * 220;
          return [
            box(1320, y, 520, 190, '', PAPER, {
              appearance: { fill: [{ type: 'solid', color: PAPER }], cornerRadius: 14, stroke: { color: HAIRLINE, width: 1 } },
            }),
            heading(1346, y + 22, '→ ' + action, 17),
            note(1346, y + 96, `From: ${theme}`, 460, 13, INK_SOFT),
          ];
        })
      );

      nodes.push(
        note(0, 960, 'The count is the discipline. Four people is a theme; one person with a strong opinion is a quote, and a quote is not a reason to build anything.', 1000, 16, INK)
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'work-launch',
    category: 'work',
    name: 'Launch plan',
    blurb: 'Six weeks to ship day and four after it, with the metric that says whether it worked.',
    teaches: ['Go-to-market', 'Swimlanes', 'Funnels'],
    build: () => {
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -170, 'Launch plan'),
        caption(0, -104, 'Ten weeks, four lanes, one number. Everything that is not on the way to that number is a nice-to-have.', 1000)
      );

      const WEEKS = 10;
      const COL = 210;
      const LANE_H = 176;

      // Week ruler
      for (let w = 0; w < WEEKS; w++) {
        nodes.push(pill(w * COL, -30, 190, w < 6 ? `Week −${6 - w}` : w === 6 ? 'SHIP DAY' : `Week +${w - 6}`, w === 6 ? 'amber' : 'slate'));
      }
      nodes.push(band(6 * COL - 10, -40, 210, 780, TINT.amber, 0.35));

      const LANES: Array<[string, string, Array<[number, number, string]>]> = [
        ['Product', TINT.indigo, [[0, 2, 'Feature freeze'], [2, 2, 'Beta with 12 teams'], [4, 2, 'Fix the top 5'], [6, 1, 'Ship'], [7, 3, 'Watch and patch']]],
        ['Content', TINT.blue, [[1, 2, 'Write the launch post'], [3, 2, 'Record the 90s demo'], [5, 1, 'Docs + changelog'], [6, 1, 'Publish'], [7, 2, 'Follow-up deep dive']]],
        /*
         * Spans are [startWeek, weeks], so a run must end before the next one
         * starts. "Brief the newsletters" was [4, 2] against a [5, 1] beside
         * it, which drew the second card entirely inside the first — two
         * labels stacked in one box, and a lane that had lost a week.
         */
        ['Channels', TINT.teal, [[3, 2, 'Brief 6 design newsletters'], [5, 1, 'Schedule socials'], [6, 1, 'Post everywhere'], [7, 3, 'Community AMA']]],
        ['Support', TINT.rose, [[2, 3, 'Write the FAQ'], [5, 1, 'Brief the team'], [6, 4, 'On-call rota, doubled']]],
      ];

      LANES.forEach(([name, tint, items], i) => {
        const y = 20 + i * LANE_H;
        nodes.push(band(-20, y, WEEKS * COL + 20, LANE_H - 16, tint, 0.4));
        nodes.push(heading(-10, y + 10, name, 16));
        items.forEach(([start, span, text]) => {
          nodes.push(
            box(start * COL, y + 44, span * COL - 20, 84, text, PAPER, {
              appearance: { fill: [{ type: 'solid', color: PAPER }], cornerRadius: 10, stroke: { color: RULE, width: 1 } },
              typography: { fontSize: 14, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
            })
          );
        });
      });

      // The number
      nodes.push(
        heading(0, 780, 'The one number'),
        chart(
          0,
          824,
          plot('funnel', {
            title: 'Ship week, first 7 days',
            categories: ['Saw the post', 'Opened a board', 'Put something on it', 'Shared it', 'Came back in 7 days'],
            series: [{ name: 'people', values: [41200, 8640, 5310, 1880, 940] }],
            showValues: true,
            compactNumbers: true,
          }),
          760,
          420
        ),
        sticky(820, 824, 'The launch is not the first bar. It is the last one — 940 people who came back. Everything above it is traffic.', 'yellow', { width: 270, height: 200 }),
        sticky(1110, 824, 'Biggest drop is “opened a board → put something on it”. That is an onboarding problem, and it is fixable before ship day.', 'pink', { width: 270, height: 200 }),
        table(
          1420,
          824,
          {
            columns: [
              { id: 'c1', name: 'Channel', width: 180 },
              { id: 'c2', name: 'Reach', width: 110 },
              { id: 'c3', name: 'Opened', width: 110 },
              { id: 'c4', name: 'Stuck', width: 100 },
            ],
            cells: [
              ['Design newsletters', '18,400', '4,900', '31%'],
              ['Community post', '11,800', '2,200', '19%'],
              ['Socials', '9,100', '1,180', '9%'],
              ['Direct / word of mouth', '1,900', '360', '44%'],
            ].map((r) => r.map((v) => ({ value: v }))),
          } as never,
          520,
          180
        ),
        note(1420, 1030, 'Word of mouth is the smallest channel and the only good one. Every launch discovers this and every launch is surprised.', 520, 14)
      );

      return layer(nodes);
    },
  },
];
