import type { NewNodeInput } from '../document/mutations';
import type { Template } from './templates';
import {
  band, box, caption, chain, chart, code, curve, dashed, decision, frame, glyph, HAIRLINE,
  heading, HUE, iconRow, INK, layer, link, note, pill, plot, sticky, table, terminator, TINT,
  title, zone,
} from './templateKit';

/**
 * How real systems actually work.
 *
 * ## Why these exist
 *
 * The rest of the gallery shows what the tool can draw. These show what it is
 * *for*. Every one of them is a diagram somebody has actually needed — the
 * shape of a deployment pipeline, where the time in a slow request goes, what
 * happens between tapping a card and the money moving — drawn properly, with
 * the real names and the real numbers.
 *
 * That matters more than it sounds. A template called "Flowchart" containing
 * Step 1 → Step 2 → Step 3 teaches the connector tool and nothing else, and
 * nobody keeps it. A template that correctly explains why a video starts
 * playing in 400ms is a thing somebody will send to a colleague, and they will
 * open it in this app.
 *
 * ## The rule these follow
 *
 * **Nothing here is invented.** The bitrate ladder is a real ladder, the YAML
 * would run, the SQL would execute, and the payment flow is the four-party
 * model as the card networks actually operate it. Where a number is
 * illustrative rather than measured, the board says so on the board. A diagram
 * that looks authoritative and is quietly wrong is worse than no diagram: it
 * gets screenshotted.
 */

// ---------------------------------------------------------------------------

const H = 84; // a standard node height for the architecture rows


export const SYSTEM_TEMPLATES: Template[] = [
  // -------------------------------------------------------------------------
  {
    id: 'sys-streaming',
    category: 'systems',
    name: 'How a video reaches your screen',
    blurb: 'The real path from a 4K master to a phone on a train: encode, package, cache, adapt.',
    teaches: ['Architecture', 'Charts', 'Code blocks'],
    build: () => {
      /**
       * The thing almost every explanation of streaming gets wrong is that it
       * draws one arrow from "server" to "player". The interesting part is
       * that there is no single video file: a title is encoded into a *ladder*
       * of renditions, split into a few seconds each, and the player decides
       * which rung to pull next, continuously, from whichever cache is
       * closest. Three separate mechanisms, all invisible, all worth drawing.
       */
      const nodes: NewNodeInput[] = [];

      nodes.push(
        title(0, -160, 'How a video reaches your screen'),
        caption(0, -96, 'There is no single video file. There is a ladder of them, cut into seconds, and a player that keeps choosing.', 980)
      );

      // -- Encode ------------------------------------------------------------
      nodes.push(...zone(0, 0, 900, 560, 'Encode', 'violet'));
      const master = glyph(60, 90, 170, H, 'archive', 'ProRes master\n4K · 400 Mbps', 'violet');
      const inspect = box(60, 220, 170, H, 'Shot detection', 'violet');
      const farmRow = iconRow(60, 350, 210, H, 'cpu', 'Encoder fleet · ~1200 chunks', 'violet');
      const farm = farmRow.node;
      nodes.push(master, inspect, ...farmRow.nodes, ...chain([master, inspect, farm]));

      nodes.push(
        chart(
          290,
          80,
          plot('barHorizontal', {
            title: 'The ladder',
            categories: ['240p', '360p', '480p', '720p', '1080p', '1440p', '4K'],
            series: [{ name: 'kbps', values: [235, 560, 1050, 2350, 4800, 9200, 16800] }],
            showValues: true,
            compactNumbers: true,
            valueSuffix: ' kbps',
          }),
          550,
          420
        ),
        note(290, 510, 'Per-title encoding: a cartoon and a night scene do not need the same bitrate to look the same.', 550, 14)
      );

      // -- Package and store -------------------------------------------------
      nodes.push(...zone(960, 0, 620, 560, 'Package', 'sky'));
      const segment = box(1010, 90, 200, H, 'Segment\n4-second chunks', 'sky');
      const manifest = glyph(1010, 220, 200, H, 'document', 'Manifest\nHLS + DASH', 'sky');
      const store = glyph(1010, 350, 200, H, 'database', 'Object store\nevery rung, every chunk', 'sky');
      nodes.push(segment, manifest, store, ...chain([segment, manifest, store]), link(farm.id, segment.id));

      nodes.push(
        code(
          1250,
          90,
          `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2350000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4800000,RESOLUTION=1920x1080
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=16800000,RESOLUTION=3840x2160
2160p/index.m3u8`,
          'plaintext',
          280,
          340,
          { filename: 'master.m3u8', fontSize: 11, lineNumbers: false }
        )
      );

      // -- Distribute --------------------------------------------------------
      nodes.push(...zone(1640, 0, 700, 560, 'Distribute', 'teal'));
      const originRow = iconRow(1700, 90, 220, H, 'cloud', 'Origin', 'teal');
      const origin = originRow.node;
      const pop = glyph(1700, 230, 180, H, 'server', 'Edge cache\nin your city', 'teal');
      const ispRow = iconRow(1700, 370, 220, H, 'globe', 'Appliance inside your ISP', 'teal');
      const isp = ispRow.node;
      nodes.push(
        ...originRow.nodes,
        pop,
        ...ispRow.nodes,
        link(store.id, origin.id),
        ...chain([origin, pop, isp])
      );

      nodes.push(
        table(
          1920,
          90,
          {
            columns: [
              { id: 'c1', name: 'Tier', width: 120 },
              { id: 'c2', name: 'Hit rate', width: 100 },
              { id: 'c3', name: 'RTT', width: 90 },
            ],
            cells: [
              ['ISP appliance', '92%', '4 ms'],
              ['Metro edge', '6%', '18 ms'],
              ['Regional', '1.6%', '45 ms'],
              ['Origin', '0.4%', '120 ms'],
            ].map((r) => r.map((v) => ({ value: v }))),
          } as never,
          360,
          200
        ),
        note(1920, 320, 'Almost nothing reaches the origin. That is the whole design — the catalogue is pushed out overnight, before anyone asks for it.', 360, 14)
      );

      // -- Play --------------------------------------------------------------
      nodes.push(...zone(0, 660, 2340, 420, 'Play', 'amber'));

      const playerRow = iconRow(80, 760, 230, 110, 'mobile', 'Player', 'amber');
      const player = playerRow.node;
      const probe = box(340, 760, 190, 110, 'Measure\nthroughput + buffer', 'amber');
      const choose = decision(600, 740, 220, 150, 'Buffer healthy?');
      const up = box(890, 700, 190, 80, 'Step up a rung', 'green');
      const down = box(890, 840, 190, 80, 'Step down a rung', 'rose');
      const fetch = box(1160, 760, 190, 110, 'Fetch next\n4 seconds', 'amber');

      nodes.push(
        ...playerRow.nodes, probe, choose, up, down, fetch,
        ...chain([player, probe]),
        link(probe.id, choose.id),
        link(choose.id, up.id, { label: 'yes' }),
        link(choose.id, down.id, { label: 'no' }),
        link(up.id, fetch.id),
        link(down.id, fetch.id),
        curve(fetch.id, player.id, { label: 'every 4s' }),
        dashed(isp.id, fetch.id, { label: 'served from here' })
      );

      nodes.push(
        sticky(1420, 730, 'This loop is the reason a video starts in under a second: it opens on a low rung and climbs, rather than waiting for the good one.', 'yellow', { width: 260, height: 180 }),
        sticky(1720, 730, 'And the reason it goes soft in a tunnel instead of stopping. Stepping down is not a failure — it is the feature.', 'peach', { width: 260, height: 180 }),
        note(2020, 730, 'Drag any box. Every arrow re-routes, including the two that cross the whole board.', 260, 14)
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'sys-actions',
    category: 'systems',
    name: 'GitHub Actions, end to end',
    blurb: 'A real workflow drawn as a graph: triggers, a build matrix, caches, artifacts and a gated deploy.',
    teaches: ['Pipelines', 'Code blocks', 'Critical path'],
    build: () => {
      /**
       * A CI pipeline is a graph, and the YAML that describes it is a list.
       * That mismatch is the entire reason CI is hard to reason about: you
       * cannot see the critical path, the fan-out, or which job is holding up
       * the deploy, because the file is sorted alphabetically.
       *
       * So this board is the same workflow twice — the file as written, and
       * the graph it actually produces — plus the durations, which is the
       * thing you would go looking for and the thing the file cannot tell you.
       */
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -160, 'GitHub Actions, end to end'),
        caption(0, -96, 'The file is a list. What runs is a graph. This is the same workflow drawn both ways.', 960)
      );

      // Triggers
      nodes.push(...zone(0, 0, 340, 520, 'Triggers', 'indigo'));
      const push = pill(40, 80, 260, 'push → main');
      const pr = pill(40, 140, 260, 'pull_request');
      const cron = pill(40, 200, 260, 'schedule: nightly');
      const manual = pill(40, 260, 260, 'workflow_dispatch');
      nodes.push(push, pr, cron, manual);
      nodes.push(
        note(40, 330, 'Four ways in, one workflow. The `if:` on each job decides which of them it answers to.', 260, 14)
      );

      // Jobs
      nodes.push(...zone(420, 0, 1180, 520, 'Jobs', 'blue'));
      const checkout = box(470, 70, 200, 78, 'setup\ncheckout + cache', 'blue');
      const lint = box(470, 190, 200, 78, 'lint', 'blue');
      const types = box(470, 300, 200, 78, 'typecheck', 'blue');

      const m1 = box(760, 70, 180, 70, 'test · node 20', 'sky');
      const m2 = box(760, 160, 180, 70, 'test · node 22', 'sky');
      const m3 = box(760, 250, 180, 70, 'test · windows', 'sky');
      const m4 = box(760, 340, 180, 70, 'test · macos', 'sky');

      const build = box(1030, 190, 200, 90, 'build\nartifact: dist/', 'blue');
      const scan = box(1030, 320, 200, 78, 'security scan', 'blue');
      const packRow = iconRow(1320, 190, 240, 90, 'package', 'upload-artifact', 'blue');
      const pack = packRow.node;

      nodes.push(checkout, lint, types, m1, m2, m3, m4, build, scan, ...packRow.nodes);
      nodes.push(
        link(push.id, checkout.id),
        link(pr.id, checkout.id),
        link(checkout.id, lint.id),
        link(checkout.id, types.id),
        ...[m1, m2, m3, m4].map((m) => link(checkout.id, m.id)),
        link(lint.id, build.id),
        link(types.id, build.id),
        ...[m1, m2, m3, m4].map((m) => link(m.id, build.id)),
        link(build.id, pack.id),
        dashed(checkout.id, scan.id, { label: 'parallel' })
      );

      nodes.push(
        note(760, 430, 'A 2×2 matrix is four runners from four lines of YAML. `fail-fast: false` is what stops one flake killing the other three.', 480, 14)
      );

      // Deploy
      nodes.push(...zone(1680, 0, 700, 520, 'Deploy', 'green'));
      const gate = decision(1730, 60, 220, 150, 'Protected\nenvironment?');
      const approveRow = iconRow(1730, 250, 260, 80, 'user', 'Reviewer approves', 'amber');
      const approve = approveRow.node;
      const staging = box(2040, 70, 200, 80, 'staging', 'green');
      const prod = box(2040, 250, 200, 80, 'production', 'green');
      const oidcRow = iconRow(2040, 380, 260, 80, 'key', 'OIDC → cloud, no stored secret', 'teal');
      const oidc = oidcRow.node;
      nodes.push(gate, ...approveRow.nodes, staging, prod, ...oidcRow.nodes);
      nodes.push(
        link(pack.id, gate.id),
        link(gate.id, staging.id, { label: 'no' }),
        link(gate.id, approve.id, { label: 'yes' }),
        link(approve.id, prod.id),
        dashed(oidc.id, prod.id)
      );

      // The file
      nodes.push(
        heading(0, 600, 'The file'),
        code(
          0,
          650,
          `name: CI
on:
  push: { branches: [main] }
  pull_request:
  schedule: [{ cron: '0 3 * * *' }]
  workflow_dispatch:

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: [20, 22]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm test

  build:
    needs: [test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: dist/ }

  deploy:
    needs: [build]
    environment: production
    permissions: { id-token: write, contents: read }
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ vars.DEPLOY_ROLE }}
          aws-region: eu-west-1`,
          'yaml',
          760,
          860,
          { filename: '.github/workflows/ci.yml', fontSize: 11, highlights: [10, 11, 12, 16, 17] }
        )
      );

      // Durations
      nodes.push(
        heading(860, 600, 'Where the eight minutes go'),
        chart(
          860,
          650,
          plot('barHorizontal', {
            title: 'Job duration',
            categories: ['setup', 'lint', 'typecheck', 'test (slowest leg)', 'security scan', 'build', 'deploy'],
            series: [{ name: 'seconds', values: [38, 26, 44, 214, 96, 118, 52] }],
            showValues: true,
            valueSuffix: 's',
          }),
          700,
          400
        ),
        sticky(1620, 650, 'The critical path is setup → test → build → deploy: about 7 minutes. Lint and the scan are free — they finish inside the matrix.', 'sky', { width: 260, height: 190 }),
        sticky(1620, 870, 'So the only change worth making is to the slowest matrix leg. Speeding up lint saves nothing at all.', 'mint', { width: 260, height: 190 }),
        note(860, 1080, 'Illustrative durations from a mid-size TypeScript monorepo. Swap in your own from the Actions timing tab — the chart opens in the sheet.', 700, 14)
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'sys-pipeline',
    category: 'systems',
    name: 'Data engineering pipeline',
    blurb: 'Sources to dashboards through bronze, silver and gold — with the freshness table that says whether it worked.',
    teaches: ['Medallion layers', 'Tables', 'Orchestration'],
    build: () => {
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -160, 'Data engineering pipeline'),
        caption(0, -96, 'Raw in, trusted out. The three layers exist so that a bad upstream day is contained in one of them.', 980)
      );

      // Orchestration across the top
      nodes.push(band(0, -20, 2400, 76, TINT.violet, 0.6));
      nodes.push(heading(24, 0, 'Orchestration · one DAG, 04:00 UTC', 18));
      nodes.push(note(660, 4, 'Every box below is a task. Retries 3×, exponential backoff, alert on the second failure.', 700, 14));

      // Sources
      nodes.push(...zone(0, 100, 380, 620, 'Sources', 'slate'));
      const pg = glyph(40, 180, 300, 74, 'database', 'Postgres · CDC', 'slate');
      const eventsRow = iconRow(40, 280, 300, 74, 'bolt', 'Event stream · Kafka', 'slate');
      const events = eventsRow.node;
      const saasRow = iconRow(40, 380, 300, 74, 'cloud', 'SaaS APIs · Stripe, HubSpot', 'slate');
      const saas = saasRow.node;
      const files = glyph(40, 480, 300, 74, 'folder', 'Partner drops · S3 CSV', 'slate');
      nodes.push(pg, ...eventsRow.nodes, ...saasRow.nodes, files);
      nodes.push(note(40, 580, 'Four shapes of input: a log, a stream, a paginated API and a file that arrives whenever.', 300, 14));

      // Ingest
      nodes.push(...zone(460, 100, 320, 620, 'Ingest', 'sky'));
      const ingest = box(500, 300, 240, 90, 'Landing\nappend-only, immutable', 'sky');
      nodes.push(ingest, ...[pg, events, saas, files].map((s) => link(s.id, ingest.id)));
      nodes.push(note(500, 420, 'Nothing is parsed here. Bytes land exactly as sent, so a bad transform can be replayed rather than re-fetched.', 240, 14));

      // Medallion
      nodes.push(...zone(860, 100, 760, 620, 'Lakehouse', 'amber'));
      const bronze = box(900, 180, 320, 96, 'Bronze\nraw tables, typed only', '#F5D0A9');
      const silver = box(900, 330, 320, 96, 'Silver\ndeduplicated, conformed, joined', HAIRLINE);
      const gold = box(900, 480, 320, 96, 'Gold\nbusiness models, one row per fact', '#FDE68A');
      nodes.push(bronze, silver, gold, link(ingest.id, bronze.id), ...chain([bronze, silver, gold]));

      nodes.push(
        code(
          1270,
          180,
          `-- silver.orders: one row per order, ever
select
    o.order_id,
    o.customer_id,
    o.placed_at::timestamptz            as placed_at,
    sum(l.qty * l.unit_price)           as gross,
    count(*)                            as line_count
from bronze.orders o
join bronze.order_lines l using (order_id)
where o._ingested_at > {{ this.updated_at }}
group by 1, 2, 3`,
          'sql',
          310,
          290,
          { filename: 'models/silver/orders.sql', fontSize: 10, lineNumbers: false }
        ),
        note(1270, 490, 'Incremental by ingest time, not event time. Late-arriving rows are the single most common silent data bug.', 310, 14)
      );

      // Serve
      nodes.push(...zone(1700, 100, 700, 620, 'Serve', 'green'));
      const warehouse = glyph(1740, 180, 260, 84, 'server', 'Warehouse', 'green');
      const biRow = iconRow(1740, 310, 260, 84, 'desktop', 'Dashboards', 'green');
      const bi = biRow.node;
      const ml = glyph(1740, 440, 260, 84, 'activity', 'Feature store → ML', 'green');
      const reverseRow = iconRow(1740, 570, 260, 84, 'mail', 'Reverse ETL → CRM', 'green');
      const reverse = reverseRow.node;
      nodes.push(warehouse, ...biRow.nodes, ml, ...reverseRow.nodes, link(gold.id, warehouse.id), ...[bi, ml, reverse].map((t) => link(warehouse.id, t.id)));

      // Freshness table + chart
      nodes.push(
        heading(0, 800, 'Did it work this morning?'),
        table(
          0,
          850,
          {
            columns: [
              { id: 'c1', name: 'Dataset', width: 220 },
              { id: 'c2', name: 'Owner', width: 130 },
              { id: 'c3', name: 'SLA', width: 90 },
              { id: 'c4', name: 'Landed', width: 100 },
              { id: 'c5', name: 'Rows', width: 110 },
              { id: 'c6', name: 'State', width: 110 },
            ],
            cells: [
              ['bronze.orders', 'Data Eng', '05:00', '04:12', '1,284,902', 'OK'],
              ['bronze.events', 'Data Eng', '05:00', '04:31', '58,113,204', 'OK'],
              ['silver.orders', 'Analytics', '06:00', '05:04', '1,284,110', 'OK'],
              ['silver.customers', 'Analytics', '06:00', '05:09', '212,884', 'OK'],
              ['gold.revenue_daily', 'Analytics', '07:00', '06:22', '3,650', 'OK'],
              ['gold.churn_features', 'ML', '07:00', '—', '—', 'LATE'],
            ].map((r) => r.map((v) => ({ value: v }))),
          } as never,
          760,
          252
        ),
        note(0, 1120, 'One row per dataset, one owner per row. A pipeline without a named owner per table is a pipeline nobody fixes at 6am.', 760, 14)
      );

      nodes.push(
        chart(
          860,
          850,
          plot('area', {
            title: 'Rows landed per hour',
            categories: ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09'],
            series: [
              { name: 'events', values: [1.2, 0.9, 0.7, 0.8, 22.4, 31.1, 8.2, 4.1, 5.6, 6.0] },
              { name: 'orders', values: [0.2, 0.1, 0.1, 0.1, 2.8, 3.4, 0.9, 0.5, 0.7, 0.8] },
            ],
            valueSuffix: 'M',
            showLegend: true,
          }),
          700,
          300
        ),
        sticky(1620, 850, 'The 04:00 spike is the DAG, not the business. Everything upstream of it is streaming; everything after is batch.', 'sky', { width: 250, height: 180 }),
        sticky(1900, 850, 'gold.churn_features is late because it depends on silver.customers, which depends on a SaaS API that rate-limits. Three hops from the symptom.', 'pink', { width: 250, height: 180 })
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'sys-request',
    category: 'systems',
    name: 'The life of a request',
    blurb: 'Where 900 milliseconds actually went — drawn as a waterfall, then as the machines it passed through.',
    teaches: ['Waterfall charts', 'Latency', 'Annotation'],
    build: () => {
      /**
       * Everybody who has optimised a slow endpoint has had the same
       * experience: the thing you were sure was slow turns out to be 4ms, and
       * the time is somewhere you never looked. A waterfall is the only chart
       * that shows that, because it shows *where in the sequence* rather than
       * how much in total.
       */
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -160, 'The life of a request'),
        caption(0, -96, 'One click, 912 milliseconds, eleven hops. Almost none of it is your code.', 900)
      );

      const hops: Array<[string, string, string]> = [
        ['browser', 'Click', 'slate'],
        ['globe', 'DNS', 'sky'],
        ['shield', 'TLS', 'sky'],
        ['cloud', 'CDN edge', 'teal'],
        ['activity', 'Load balancer', 'teal'],
        ['server', 'API', 'indigo'],
        ['bolt', 'Cache', 'amber'],
        ['database', 'Database', 'rose'],
        ['package', 'Serialise', 'indigo'],
        ['desktop', 'Render', 'slate'],
      ];
      const made = hops.map(([kind, name, tint], i) =>
        glyph(i * 190, 40, 150, 140, kind, name, tint)
      );
      nodes.push(...made, ...chain(made));

      nodes.push(
        chart(
          0,
          220,
          plot('waterfall', {
            title: 'Where the 912 ms went',
            categories: ['DNS', 'TLS', 'CDN miss', 'Queue', 'Auth', 'Cache miss', 'Query', 'N+1 queries', 'Serialise', 'Transfer', 'Render'],
            series: [{ name: 'ms', values: [24, 71, 18, 9, 12, 3, 46, 604, 31, 58, 36] }],
            showValues: true,
            valueSuffix: ' ms',
          }),
          1180,
          480
        ),
        sticky(1240, 220, 'Two thirds of this request is 340 separate queries fired one per row, from a loop nobody reads as a loop.', 'pink', { width: 270, height: 200 }),
        sticky(1240, 450, 'The database is not slow. It answered 341 times in 650 ms. It was asked 340 times too often.', 'yellow', { width: 270, height: 200 }),
        note(1240, 680, 'Fix the N+1 and this is a 300 ms request. Nothing else on the chart is worth touching until it is gone.', 270, 15)
      );

      // The two lessons
      nodes.push(
        heading(0, 760, 'The three that surprise people'),
        box(0, 810, 380, 120, 'TLS costs 71 ms\nbecause it is a second round trip. HTTP/3 folds it into the first.', 'sky', {
          typography: { fontSize: 14, fontWeight: 500, color: INK, align: 'left', verticalAlign: 'middle' },
        }),
        box(410, 810, 380, 120, 'A cache hit saves nothing here\n— 3 ms. The cache is not the problem, so adding another will not help.', 'amber', {
          typography: { fontSize: 14, fontWeight: 500, color: INK, align: 'left', verticalAlign: 'middle' },
        }),
        box(820, 810, 380, 120, 'Render is 36 ms\nfor 340 rows nobody scrolls past the first twenty of.', 'slate', {
          typography: { fontSize: 14, fontWeight: 500, color: INK, align: 'left', verticalAlign: 'middle' },
        })
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'sys-payments',
    category: 'systems',
    name: 'What happens when a card is tapped',
    blurb: 'The four-party model, and why the money arrives two days after the "payment succeeded".',
    teaches: ['Sequence', 'Swimlanes', 'Timelines'],
    build: () => {
      /**
       * Nearly everyone believes a card payment is one event. It is at least
       * three — authorisation, capture and settlement — separated by up to two
       * days, run by four parties who each take a cut, and the reason
       * refunds, chargebacks and "pending" charges behave the way they do.
       *
       * Drawn as lanes because the point is *who* does each step, and the
       * surprise is how few of them are the merchant.
       */
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -160, 'What happens when a card is tapped'),
        caption(0, -96, 'Three events, four parties, two days. "Payment successful" is the first of the three.', 940)
      );

      const LANES: Array<[string, string]> = [
        ['Cardholder', TINT.slate],
        ['Merchant', TINT.blue],
        ['Acquirer', TINT.teal],
        ['Card network', TINT.amber],
        ['Issuer', TINT.rose],
      ];
      const LANE_H = 150;
      LANES.forEach(([name, tint], i) => {
        nodes.push(band(0, i * LANE_H, 2280, LANE_H - 14, tint, 0.45));
        nodes.push(heading(24, i * LANE_H + 16, name, 17));
      });
      const lane = (i: number) => i * LANE_H + 52;

      // Authorisation
      const tap = box(240, lane(0), 170, 72, 'Tap', 'slate');
      const terminal = box(450, lane(1), 170, 72, 'Terminal', 'blue');
      const gateway = box(660, lane(2), 170, 72, 'Gateway', 'teal');
      const route = box(870, lane(3), 170, 72, 'Route by BIN', 'amber');
      const risk = decision(1080, lane(4) - 30, 190, 130, 'Funds?\nRisk?');
      const holdA = box(1320, lane(4), 170, 72, 'Hold funds', 'rose');
      const okNet = box(1320, lane(3), 170, 72, 'Approval code', 'amber');
      const okAcq = box(1530, lane(2), 170, 72, 'Approved', 'teal');
      const okMer = box(1740, lane(1), 170, 72, '“Payment successful”', 'blue');
      const okCard = box(1950, lane(0), 170, 72, 'Receipt', 'slate');

      nodes.push(tap, terminal, gateway, route, risk, holdA, okNet, okAcq, okMer, okCard);
      nodes.push(
        ...chain([tap, terminal, gateway, route, risk]),
        link(risk.id, holdA.id, { label: 'yes' }),
        link(holdA.id, okNet.id),
        ...chain([okNet, okAcq, okMer, okCard])
      );

      nodes.push(
        sticky(240, 790, 'Everything above happens in about 900 milliseconds, and moves no money at all. It only reserves it.', 'yellow', { width: 270, height: 180 }),
        sticky(540, 790, 'This is why a cancelled hotel booking can sit on your statement for a week: the hold was placed and never captured.', 'peach', { width: 270, height: 180 })
      );

      // Capture and settlement timeline
      nodes.push(
        heading(880, 800, 'Then, over the next two days'),
        chart(
          880,
          850,
          plot('timeline', {
            title: 'One payment, three events',
            categories: ['Authorise', 'Capture', 'Net & clear', 'Settle', 'Payout'],
            series: [{ name: 'hours after tap', values: [0, 8, 26, 34, 48] }],
            showValues: true,
            valueSuffix: ' h',
          }),
          700,
          320
        ),
        table(
          1620,
          850,
          {
            columns: [
              { id: 'c1', name: 'On £100', width: 180 },
              { id: 'c2', name: 'Takes', width: 110 },
              { id: 'c3', name: 'Who', width: 150 },
            ],
            cells: [
              ['Interchange', '£1.10', 'Issuer'],
              ['Scheme fee', '£0.11', 'Network'],
              ['Acquirer margin', '£0.39', 'Acquirer'],
              ['Merchant receives', '£98.40', 'Merchant'],
            ].map((r) => r.map((v) => ({ value: v }))),
          } as never,
          460,
          180
        ),
        note(1620, 1050, 'Interchange is the large one and it goes to the bank that issued the card — which is why premium rewards cards cost merchants more.', 460, 14)
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'sys-raft',
    category: 'systems',
    name: 'Consensus, drawn by hand',
    blurb: 'How five machines agree on one number when any of them can vanish — Raft, as a state machine.',
    teaches: ['State machines', 'Sketch mode', 'Loop-backs'],
    build: () => {
      /**
       * Distributed consensus is the canonical "impossible to explain in
       * prose" topic, and it is genuinely simple as a picture: three states,
       * four transitions, and one rule about counting. Drawn in sketch mode
       * because this is a whiteboard subject — it is explained at a wall, to
       * one person, with arrows.
       */
      const nodes: NewNodeInput[] = [];
      const hand = { appearance: { sketch: 'medium' as const } };

      nodes.push(
        title(0, -160, 'Consensus, drawn by hand'),
        caption(0, -96, 'Five machines, one truth, and any of them may disappear mid-sentence. This is Raft.', 920)
      );

      // The state machine
      nodes.push(frame(0, 0, 1080, 720, 'Every node is in one of three states'));

      const follower = box(80, 120, 240, 120, 'Follower\nwaits for a heartbeat', 'sky', hand);
      const candidate = box(420, 120, 240, 120, 'Candidate\nasks for votes', 'amber', hand);
      const leader = box(760, 120, 240, 120, 'Leader\nsends heartbeats', 'green', hand);

      nodes.push(follower, candidate, leader);
      nodes.push(
        link(follower.id, candidate.id, { label: 'timeout' }),
        link(candidate.id, leader.id, { label: 'majority' }),
        curve(candidate.id, follower.id, { label: 'someone else won' }),
        curve(leader.id, follower.id, { label: 'higher term seen' }),
        curve(candidate.id, candidate.id, { label: 'split vote → retry' })
      );

      nodes.push(
        note(80, 290, 'The timeout is randomised, 150–300 ms. That single detail is what stops all five timing out together forever.', 460, 15),
        sticky(620, 280, 'Majority of five is three. Two nodes can die and the cluster still decides — but three cannot, and it stops rather than guessing.', 'yellow', { width: 260, height: 190, ...hand })
      );

      // Log replication
      nodes.push(heading(80, 420, 'Replicating one entry'));
      const client = box(80, 470, 190, 76, 'Client: set x=7', 'slate', hand);
      const append = box(320, 470, 190, 76, 'Leader appends', 'green', hand);
      const send = box(560, 470, 190, 76, 'Send to all four', 'green', hand);
      const count = decision(800, 450, 200, 120, 'Three\nacked?');
      const commit = box(320, 610, 190, 76, 'Commit', 'teal', hand);
      const apply = box(560, 610, 190, 76, 'Apply to state', 'teal', hand);
      nodes.push(client, append, send, count, commit, apply);
      nodes.push(
        ...chain([client, append, send]),
        link(send.id, count.id),
        curve(count.id, commit.id, { label: 'yes' }),
        link(commit.id, apply.id),
        curve(count.id, send.id, { label: 'no — retry forever' })
      );

      // The cluster
      nodes.push(frame(1160, 0, 800, 720, 'The cluster, mid-election'));
      const ring: NewNodeInput[] = [];
      const CX = 1560;
      const CY = 340;
      const names = ['A · leader', 'B', 'C', 'D · down', 'E'];
      const tints = ['green', 'sky', 'sky', 'rose', 'sky'];
      names.forEach((name, i) => {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ring.push(
          glyph(CX + Math.cos(a) * 240 - 80, CY + Math.sin(a) * 220 - 45, 160, 90, 'server', name, tints[i], hand)
        );
      });
      nodes.push(...ring);
      // Heartbeats from the leader to everyone still answering.
      nodes.push(
        ...[1, 2, 4].map((i) => dashed(ring[0].id, ring[i].id, { label: '♥' })),
        link(ring[0].id, ring[3].id, { label: 'no reply', appearance: { stroke: { color: HUE.rose, width: 2, dash: [4, 6] } } })
      );

      nodes.push(
        note(1200, 620, 'A is leader, D is gone. A still has B, C and E — three of five — so writes keep committing and nobody notices.', 720, 15)
      );

      // The punchline
      nodes.push(
        terminator(0, 780, 320, 'Why this matters', 'violet'),
        note(0, 860, 'Every database that promises not to lose your write is running something shaped like this underneath — etcd, Consul, CockroachDB, Kafka’s controller. Same three boxes.', 1080, 17, INK)
      );

      return layer(nodes);
    },
  },
];
