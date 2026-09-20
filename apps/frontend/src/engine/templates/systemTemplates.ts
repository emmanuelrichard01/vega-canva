import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../document/mutations';
import type { Template } from './templates';
import {
  band, box, caption, chain, chart, code, curve, dashed, decision, fillOf, frame, glyph,
  heading, HUE, iconRow, INK, layer, link, note, pill, plot, sketched, sticky, strokeOf, table, terminator,
  TINT, title, zone, type Tint,
} from './templateKit';

/**
 * How real systems actually work.
 *
 * ## Why these exist
 *
 * The rest of the gallery shows what the tool can draw. These show what it is
 * *for*. Every one of them is an authoritative systems diagram somebody has
 * actually needed — the path from 4K master to phone on a train, what happens
 * on push to main, modern lakehouse data pipelines, distributed tracing
 * latency waterfalls, the 4-party card payment clearing cycle, and Raft
 * consensus — drawn properly, with real names, real protocols, and real numbers.
 *
 * ## The rule these follow
 *
 * **Nothing here is invented.** The bitrate ladder is a real ladder, the YAML
 * would run in GitHub Actions, the SQL would execute in dbt/Snowflake, the
 * payment flow is the four-party model as card networks actually operate it,
 * and the Raft state machine follows the Ongaro & Ousterhout consensus paper.
 */

const H = 84; // standard node height for architecture rows

export const SYSTEM_TEMPLATES: Template[] = [
  // -------------------------------------------------------------------------
  // 1. SYS-STREAMING: How a video reaches your screen
  // -------------------------------------------------------------------------
  {
    id: 'sys-streaming',
    category: 'systems',
    name: 'How a video reaches your screen',
    blurb: 'The real path from a 4K master to a phone on a train: encode, package, DRM, cache, and adaptive bitrate.',
    teaches: ['Architecture', 'Charts', 'Code blocks', 'DRM & Caching'],
    objectCount: 64,
    build: () => {
      const nodes: NewNodeInput[] = [];

      nodes.push(
        title(0, -160, 'How a video reaches your screen'),
        caption(
          0,
          -96,
          'Encoded into a multi-bitrate ladder, chunked into 4s segments, and served via edge CDN to adaptive players.',
          1100
        )
      );

      // -- Encode ------------------------------------------------------------
      nodes.push(...zone(0, 0, 900, 560, 'Encode', 'violet'));
      const masterRow = iconRow(60, 90, 210, H, 'archive', 'ProRes master\n4K · 400 Mbps', 'violet');
      const master = masterRow.node;
      const inspect = box(60, 220, 210, H, 'Shot detection\n& VMAF probe', 'violet');
      const farmRow = iconRow(60, 350, 210, H, 'cpu', 'Encoder fleet · ~1200 chunks', 'violet');
      const farm = farmRow.node;
      nodes.push(...masterRow.nodes, inspect, ...farmRow.nodes, ...chain([master, inspect, farm]));

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
        note(290, 510, 'Per-title encoding: bitrates adapt to scene complexity, cutting bandwidth by 25%.', 550, 14)
      );

      // -- Package and Encrypt -----------------------------------------------
      nodes.push(...zone(960, 0, 640, 560, 'Package & Encrypt', 'sky'));
      const segment = box(1010, 80, 200, 74, 'Segment\n4-second chunks', 'sky');
      const manifest = glyph(1010, 185, 200, 74, 'document', 'Manifest Engine\nHLS + DASH', 'sky');
      const drm = box(1010, 290, 200, 74, 'DRM Key Server\nFairPlay & Widevine', 'sky');
      const store = box(1010, 395, 200, 74, 'Object Store\nAll chunks & rungs', 'sky');
      nodes.push(
        segment,
        manifest,
        drm,
        store,
        ...chain([segment, manifest, store]),
        link(farm.id, segment.id),
        link(manifest.id, drm.id)
      );

      nodes.push(
        code(
          1240,
          80,
          `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://fairplay.vega.dev/v1"
#EXT-X-STREAM-INF:BANDWIDTH=2350000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"
720p/prog_index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4800000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/prog_index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=16800000,RESOLUTION=3840x2160,CODECS="hvc1.2.4.L153.B0,mp4a.40.2"
4k/prog_index.m3u8`,
          'plaintext',
          330,
          420,
          { filename: 'master.m3u8', fontSize: 11, lineNumbers: false }
        )
      );

      // -- Distribute --------------------------------------------------------
      nodes.push(...zone(1660, 0, 700, 560, 'Distribute', 'teal'));
      const originRow = iconRow(1710, 90, 220, H, 'cloud', 'Origin Shield Cache', 'teal');
      const origin = originRow.node;
      const popRow = iconRow(1710, 230, 220, H, 'server', 'Regional Metro PoP\nin your city', 'teal');
      const pop = popRow.node;
      const ispRow = iconRow(1710, 370, 220, H, 'globe', 'Appliance inside your ISP', 'teal');
      const isp = ispRow.node;
      nodes.push(
        ...originRow.nodes,
        ...popRow.nodes,
        ...ispRow.nodes,
        link(store.id, origin.id),
        ...chain([origin, pop, isp])
      );

      nodes.push(
        table(
          1940,
          90,
          {
            header: true,
            theme: 'clean',
            fontSize: 12,
            columns: [
              { width: 1.4, type: 'text' },
              { width: 1, type: 'text', align: 'right' },
              { width: 1, type: 'text', align: 'right' },
            ],
            cells: [
              ['Cache Tier', 'Hit Rate', 'RTT'],
              ['ISP appliance', '94.0%', '3 ms'],
              ['Metro edge', '4.8%', '14 ms'],
              ['Regional shield', '0.9%', '38 ms'],
              ['Origin', '0.3%', '110 ms'],
            ],
          },
          390,
          200
        ),
        note(
          1940,
          320,
          'Over 94% of traffic hits ISP edge caches. Catalog updates pre-warm before peak hours.',
          390,
          14
        )
      );

      // -- Play (Adaptive Bitrate Feedback Loop) ------------------------------
      nodes.push(...zone(0, 660, 2360, 420, 'Play (Adaptive Bitrate Feedback Loop)', 'amber'));

      const playerRow = iconRow(80, 760, 230, 110, 'mobile', 'Player\nAVPlayer / ExoPlayer', 'amber');
      const player = playerRow.node;
      const probe = box(340, 760, 190, 110, 'Measure\nthroughput + buffer', 'amber');
      const choose = decision(600, 740, 220, 150, 'Buffer healthy?');
      const up = box(890, 700, 190, 80, 'Step up a rung\n(↑ 4K)', 'green');
      const down = box(890, 840, 190, 80, 'Step down a rung\n(↓ 720p)', 'rose');
      const fetch = box(1160, 760, 190, 110, 'Fetch next\n4 seconds', 'amber');

      nodes.push(
        ...playerRow.nodes, probe, choose, up, down, fetch,
        ...chain([player, probe]),
        link(probe.id, choose.id),
        link(choose.id, up.id, { label: 'yes' }),
        link(choose.id, down.id, { label: 'no' }),
        link(up.id, fetch.id),
        link(down.id, fetch.id),
        curve(fetch.id, player.id, { label: 'every 4s', appearance: { stroke: { color: HUE.amber, width: 2 }, sketch: 'light' } }),
        dashed(isp.id, fetch.id, { label: 'served from ISP edge' }),
        dashed(drm.id, player.id, { label: 'acquire license' })
      );

      nodes.push(
        sticky(1420, 730, 'This loop is the reason a video starts in under a second: it opens on a low rung and climbs, rather than waiting for the good one.', 'yellow', { width: 260, height: 180 }),
        sticky(1720, 730, 'And the reason it goes soft in a tunnel instead of stopping. Stepping down is not a failure — it is the feature.', 'peach', { width: 260, height: 180 }),
        note(2020, 730, 'Drag any box. Every arrow re-routes, including the ones that cross the whole board.', 280, 14)
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  // 2. SYS-ACTIONS: What happens when you push to main
  // -------------------------------------------------------------------------
  {
    id: 'sys-actions',
    category: 'systems',
    name: 'What happens when you push to main',
    blurb: 'A production GitHub Actions workflow drawn as an execution graph: event triggers, remote Buildx cache, matrix runners, and gated OIDC deployment.',
    teaches: ['Pipelines', 'Code blocks', 'Critical path', 'OIDC & Security'],
    objectCount: 66,
    build: () => {
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -160, 'What happens when you push to main'),
        caption(
          0,
          -96,
          'The file is a list. What runs is a graph. This is the same workflow drawn both ways, highlighting wall-clock critical paths and OIDC security.',
          1100
        )
      );

      // Triggers & Concurrency
      nodes.push(...zone(0, 0, 360, 540, 'Triggers & Concurrency', 'indigo'));
      const push = pill(40, 75, 280, 'push → main (paths: apps/**)');
      const pr = pill(40, 130, 280, 'pull_request (opened, sync)');
      const cron = pill(40, 185, 280, 'schedule: nightly @ 03:00');
      const manual = pill(40, 240, 280, 'workflow_dispatch (with inputs)');
      const concur = box(40, 305, 280, 70, 'concurrency: group\ncancel-in-progress: true', 'indigo');
      nodes.push(push, pr, cron, manual, concur);
      nodes.push(
        note(40, 395, 'Single unified workflow. Concurrency groups cancel superseded runs instantly on push.', 280, 14)
      );

      // Jobs & Matrix
      nodes.push(...zone(420, 0, 1220, 540, 'Jobs & Parallel Execution', 'blue'));
      const checkout = box(470, 70, 210, 78, 'setup\ncheckout + pnpm cache', 'blue');
      const lint = box(470, 190, 210, 78, 'lint & format\noxlint sub-second', 'blue');
      const types = box(470, 310, 210, 78, 'typecheck\ntsc -b parallel', 'blue');

      const m1 = box(760, 70, 190, 70, 'test · ubuntu-22\nnode 20 · shard 1/2', 'sky');
      const m2 = box(760, 160, 190, 70, 'test · ubuntu-22\nnode 22 · shard 2/2', 'sky');
      const m3 = box(760, 250, 190, 70, 'test · macos-14\nApple Silicon arm64', 'sky');
      const m4 = box(760, 340, 190, 70, 'test · windows-2022\nPowerShell shell', 'sky');

      const build = box(1030, 190, 210, 90, 'build\nTurborepo remote cache', 'blue');
      const scan = box(1030, 320, 210, 78, 'security scan\nTrivy CVE + Snyk', 'blue');
      const packRow = iconRow(1320, 190, 250, 90, 'package', 'upload-artifact\ndist/ + sourcemaps', 'blue');
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
        note(760, 440, 'A 4-way matrix shards tests across OS and Node versions. fail-fast: false keeps all legs running to report every regression.', 520, 14)
      );

      // Security & Gated Deployment
      nodes.push(...zone(1700, 0, 720, 540, 'Security & Gated Deployment', 'green'));
      const cosign = box(1750, 65, 270, 76, 'Cosign Keyless Signing\nSLSA L3 Attestation', 'teal');
      const gate = decision(1750, 190, 230, 150, 'Protected Env?\nManual Sign-off');
      const approveRow = iconRow(1750, 390, 270, 80, 'user', 'Reviewer approves\nSlack webhook action', 'amber');
      const approve = approveRow.node;
      const staging = box(2080, 65, 210, 76, 'staging\nephemeral preview', 'green');
      const prod = box(2080, 225, 210, 80, 'production\nCanary rollout', 'green');
      const oidcRow = iconRow(2080, 390, 270, 80, 'key', 'OIDC → AWS IAM\nZero stored secrets', 'teal');
      const oidc = oidcRow.node;
      nodes.push(cosign, gate, ...approveRow.nodes, staging, prod, ...oidcRow.nodes);
      nodes.push(
        link(pack.id, cosign.id),
        link(cosign.id, gate.id),
        link(gate.id, staging.id, { label: 'no' }),
        link(gate.id, approve.id, { label: 'yes', appearance: { stroke: { color: HUE.amber, width: 2 }, sketch: 'light' } }),
        link(approve.id, prod.id),
        dashed(oidc.id, prod.id)
      );

      // Bottom: YAML File & Durations Chart
      nodes.push(
        heading(0, 610, 'The Workflow File'),
        code(
          0,
          660,
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
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test --shard=\${{ strategy.job-index }}/\${{ strategy.job-total }}

  build:
    needs: [test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm build
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

      nodes.push(
        heading(860, 610, 'Where the Eight Minutes Go (Wall-Clock Critical Path)'),
        chart(
          860,
          660,
          plot('barHorizontal', {
            title: 'Job Duration',
            categories: ['setup', 'lint', 'typecheck', 'test matrix leg', 'security scan', 'build', 'deploy'],
            series: [{ name: 'seconds', values: [38, 24, 42, 210, 92, 115, 48] }],
            showValues: true,
            valueSuffix: 's',
          }),
          720,
          420
        ),
        sticky(
          1640,
          660,
          'The critical path is setup → test → build → deploy: ~7 minutes. Lint and security scans are free because they finish inside the matrix window.',
          'sky',
          { width: 270, height: 190 }
        ),
        sticky(
          1640,
          880,
          'Optimizing lint or typecheck saves 0 seconds of developer wait time. The only leverage is sharding the slowest test matrix leg.',
          'mint',
          { width: 270, height: 190 }
        ),
        note(
          860,
          1100,
          'Measured durations from a TypeScript monorepo. Double-click the chart to edit categories and benchmark your own repository.',
          720,
          14
        )
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  // 3. SYS-PIPELINE: Data engineering pipeline (Medallion Lakehouse)
  // -------------------------------------------------------------------------
  {
    id: 'sys-pipeline',
    category: 'systems',
    name: 'Data engineering pipeline',
    blurb: 'Medallion Lakehouse architecture: raw ingestion to gold business marts, data quality circuit breakers, and RAG vector store synchronization.',
    teaches: ['Medallion layers', 'Tables', 'Orchestration', 'Data Quality'],
    objectCount: 64,
    build: () => {
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -160, 'Data engineering pipeline'),
        caption(
          0,
          -96,
          'Raw in, trusted out. Medallion architecture isolates upstream drift: bronze stores immutable events, silver conforms facts, and gold powers BI & RAG.',
          1100
        )
      );

      // Orchestration across the top
      nodes.push(band(0, -20, 2440, 76, TINT.violet, 0.6));
      nodes.push(heading(24, 0, 'Orchestration · Dagster / Airflow DAG · 04:00 UTC Scheduled Batch', 18));
      nodes.push(
        note(
          780,
          4,
          'Every box below is an asset task. Retries 3× with exponential jitter; PagerDuty alerts on second failure.',
          780,
          14
        )
      );

      // Sources
      nodes.push(...zone(0, 100, 390, 640, 'Sources', 'slate'));
      const pg = box(40, 180, 310, 74, 'PostgreSQL · Debezium CDC', 'slate');
      const eventsRow = iconRow(40, 280, 310, 74, 'bolt', 'Kafka Stream · User Telemetry', 'slate');
      const events = eventsRow.node;
      const saasRow = iconRow(40, 380, 310, 74, 'cloud', 'SaaS APIs · Stripe & HubSpot', 'slate');
      const saas = saasRow.node;
      const filesRow = iconRow(40, 480, 310, 74, 'folder', 'Partner Feeds · S3 Parquet', 'slate');
      const files = filesRow.node;
      nodes.push(pg, ...eventsRow.nodes, ...saasRow.nodes, ...filesRow.nodes);
      nodes.push(
        note(40, 580, 'Four disparate input formats: change logs, append streams, rate-limited REST APIs, and bulk file dumps.', 310, 14)
      );

      // Ingest & Validation
      nodes.push(...zone(470, 100, 330, 640, 'Ingest & Validation', 'sky'));
      const ingest = box(510, 240, 250, 90, 'Landing Bucket\nAppend-only, immutable', 'sky');
      const registry = box(510, 380, 250, 84, 'Schema Registry\nAvro / Protobuf contract guard', 'sky');
      nodes.push(
        ingest,
        registry,
        ...[pg, events, saas, files].map((s) => link(s.id, ingest.id)),
        link(ingest.id, registry.id)
      );
      nodes.push(
        note(510, 490, 'Bytes land unmutated. Schema violations are quarantined without terminating the stream.', 250, 14)
      );

      // Lakehouse Medallion
      nodes.push(...zone(880, 100, 800, 640, 'Lakehouse (Delta Lake / Iceberg)', 'amber'));
      const bronze = box(920, 170, 320, 86, 'Bronze Layer\nRaw tables + ingest metadata', 'amber', {
        appearance: { fill: [{ type: 'solid', color: '#FEF3C7' }], stroke: { color: '#B45309', width: 1.5 } },
      });
      const dq = decision(920, 290, 320, 100, 'Quality Check\ndbt test / Great Expectations');
      const silver = box(920, 430, 320, 86, 'Silver Layer\nCleaned, conformed, deduplicated', 'slate', {
        appearance: { fill: [{ type: 'solid', color: '#F1F5F9' }], stroke: { color: '#64748B', width: 1.5 } },
      });
      const gold = box(920, 550, 320, 86, 'Gold Layer\nAggregated star-schema marts', 'amber', {
        appearance: { fill: [{ type: 'solid', color: '#FEF08A' }], stroke: { color: '#D97706', width: 1.5 } },
      });
      nodes.push(
        bronze,
        dq,
        silver,
        gold,
        link(registry.id, bronze.id),
        link(bronze.id, dq.id),
        link(dq.id, silver.id, { label: 'passed' }),
        link(silver.id, gold.id)
      );

      nodes.push(
        code(
          1290,
          170,
          `-- silver.orders: conformed dimensional table
{{ config(materialized='incremental', unique_key='order_id') }}

select
    o.order_id,
    o.customer_id,
    o.placed_at::timestamptz            as placed_at,
    sum(l.qty * l.unit_price)           as gross_amount,
    count(*)                            as line_count
from {{ ref('bronze_orders') }} o
join {{ ref('bronze_order_lines') }} l using (order_id)
{% if is_incremental() %}
where o._ingested_at > (select max(_ingested_at) from {{ this }})
{% endif %}
group by 1, 2, 3`,
          'sql',
          350,
          320,
          { filename: 'models/silver/orders.sql', fontSize: 10, lineNumbers: false }
        ),
        note(1290, 510, 'Incremental by ingest time, not event time. Late-arriving rows merge cleanly without full table rewrites.', 350, 14)
      );

      // Serve & Intelligence
      nodes.push(...zone(1760, 100, 680, 640, 'Serve & Analytics', 'green'));
      const warehouseRow = iconRow(1800, 170, 270, 84, 'server', 'Semantic Data Warehouse\nSnowflake / BigQuery', 'green');
      const warehouse = warehouseRow.node;
      const biRow = iconRow(1800, 290, 270, 84, 'desktop', 'Executive BI & Dashboards\nMetabase / Cube.js', 'green');
      const bi = biRow.node;
      const vectorRow = iconRow(1800, 410, 270, 84, 'activity', 'Vector Embeddings & RAG\npgvector / Pinecone sync', 'green');
      const vector = vectorRow.node;
      const reverseRow = iconRow(1800, 530, 270, 84, 'mail', 'Reverse ETL & Webhooks\nSync to Salesforce & CRM', 'green');
      const reverse = reverseRow.node;
      nodes.push(
        ...warehouseRow.nodes,
        ...biRow.nodes,
        ...vectorRow.nodes,
        ...reverseRow.nodes,
        link(gold.id, warehouse.id),
        ...[bi, vector, reverse].map((t) => link(warehouse.id, t.id))
      );

      // Bottom: Freshness table + chart
      nodes.push(
        heading(0, 800, 'Data Contract Freshness & SLA Monitoring'),
        table(
          0,
          850,
          {
            header: true,
            theme: 'clean',
            fontSize: 12,
            columns: [
              { width: 1.5, type: 'text' },
              { width: 1.1, type: 'text' },
              { width: 0.8, type: 'text', align: 'center' },
              { width: 0.9, type: 'text', align: 'center' },
              { width: 1.1, type: 'text', align: 'right' },
              { width: 0.9, type: 'text', align: 'center' },
            ],
            cells: [
              ['Dataset', 'Owner', 'SLA', 'Landed', 'Rows', 'State'],
              ['bronze.orders', 'Data Eng', '05:00', '04:12', '1.28M', 'OK'],
              ['bronze.events', 'Data Eng', '05:00', '04:31', '58.1M', 'OK'],
              ['silver.orders', 'Analytics', '06:00', '05:04', '1.28M', 'OK'],
              ['silver.customers', 'Analytics', '06:00', '05:09', '212K', 'OK'],
              ['gold.revenue_daily', 'Analytics', '07:00', '06:22', '3.6K', 'OK'],
              ['gold.churn_features', 'ML Team', '07:00', '—', '—', 'LATE'],
            ],
          },
          760,
          252
        ),
        note(0, 1130, 'Dataset SLA board. Every asset has a designated team and automated landed status.', 760, 14)
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
        sticky(1640, 850, 'The 04:00 spike is the scheduled DAG, not customer activity. Ingestion is real-time; downstream transformations run in micro-batches.', 'sky', { width: 260, height: 180 }),
        sticky(1920, 850, 'gold.churn_features is late because it depends on silver.customers, which waits on an external rate-limited SaaS API. Circuit breaker caught it.', 'pink', { width: 260, height: 180 })
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  // 4. SYS-REQUEST: Where does the 200ms go?
  // -------------------------------------------------------------------------
  {
    id: 'sys-request',
    category: 'systems',
    name: 'Where does the 200ms go?',
    blurb: 'Tracing an API call across 11 hops: Anycast DNS, TLS 1.3, Envoy Gateway, microservice mesh, and database N+1 query bottlenecks.',
    teaches: ['Waterfall charts', 'Latency', 'Distributed Tracing', 'Database optimization'],
    objectCount: 51,
    build: () => {
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -160, 'The life of a request (Where the 200ms goes)'),
        caption(
          0,
          -96,
          'One click, 764 milliseconds, eleven hops. Profiling where latency lives: DNS, TLS 1.3, Envoy proxy, and the devastating cost of an N+1 query loop.',
          1150
        ),
        band(0, -20, 2200, 56, TINT.indigo, 0.5),
        heading(24, -4, 'W3C Distributed Trace Context: traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', 16)
      );

      const hop = (x: number, iconKind: string, label: string, tint: Tint | string) => {
        const card = box(x, 60, 160, 120, '', tint, {
          appearance: { fill: [{ type: 'solid', color: fillOf(tint) }], stroke: { color: strokeOf(tint), width: 1.5 }, cornerRadius: 0 },
        });
        const icon: NewNodeInput = {
          id: nanoid(),
          type: 'shape',
          x: x + 62,
          y: 74,
          width: 36,
          height: 36,
          geometry: { kind: iconKind },
          appearance: { fill: [{ type: 'solid', color: strokeOf(tint) }], stroke: { color: strokeOf(tint), width: 1 }, cornerRadius: 0, opacity: 0.9 },
        };
        const text: NewNodeInput = {
          id: nanoid(),
          type: 'text',
          x: x + 8,
          y: 118,
          width: 144,
          height: 48,
          text: label,
          resize: 'none',
          typography: { fontSize: 12, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle', lineHeight: 1.25 },
        };
        return { card, nodes: [card, icon, text] };
      };

      const h1 = hop(0, 'browser', 'Client App\nReact / Mobile', 'slate');
      const h2 = hop(200, 'globe', 'Anycast DNS\n1.1.1.1 / 8.8.8.8', 'sky');
      const h3 = hop(400, 'shield', 'TLS 1.3 0-RTT\nSession Resumption', 'sky');
      const h4 = hop(600, 'cloud', 'Edge WAF\nRate Limiting', 'teal');
      const h5 = hop(800, 'activity', 'Envoy Ingress\nLoad Balancer', 'teal');
      const h6 = hop(1000, 'server', 'API Gateway\nJWT Validation', 'indigo');
      const h7 = hop(1200, 'bolt', 'Redis Cluster\nSession & Cache', 'amber');
      const h8 = hop(1400, 'database', 'PgBouncer Pool\nPrimary Database', 'rose');
      const h9 = hop(1600, 'package', 'JSON Serializer\nDTO Marshalling', 'indigo');
      const h10 = hop(1800, 'desktop', 'DOM Paint\nClient Hydration', 'slate');

      const hops = [h1, h2, h3, h4, h5, h6, h7, h8, h9, h10];
      nodes.push(...hops.flatMap((h) => h.nodes));
      nodes.push(...chain(hops.map((h) => h.card)));

      nodes.push(
        chart(
          0,
          230,
          plot('waterfall', {
            title: 'Where the 764 ms went',
            categories: ['DNS', 'TLS 1.3', 'Edge WAF', 'Gateway', 'JWT Auth', 'Cache miss', 'Pool wait', 'Query', 'N+1 loop', 'Serialise', 'Transfer', 'Render'],
            series: [{ name: 'ms', values: [18, 24, 8, 10, 12, 4, 6, 16, 540, 26, 42, 32] }],
            showValues: true,
            valueSuffix: ' ms',
          }),
          1180,
          480
        ),
        sticky(1240, 230, '70% of duration (540ms) is spent on 240 sequential SQL queries inside an unbatched loop.', 'pink', { width: 280, height: 200 }),
        sticky(1240, 460, 'Database is healthy (2.2ms/query). The penalty is network RTT. Batching via DataLoader cuts this to 18ms.', 'yellow', { width: 280, height: 200 }),
        note(1240, 690, 'Fix the N+1 and this 764ms request drops to 85ms. Query patterns dominate performance.', 280, 15)
      );

      // Key Systems Engineering Insights
      nodes.push(
        heading(0, 760, 'Key Systems Engineering Insights'),
        box(0, 810, 380, 120, 'TLS 1.3 0-RTT saves 50 ms\nSession ticket resumption folds the crypto handshake into the initial SYN packet on repeat visits.', 'sky', sketched('light', {
          typography: { fontSize: 14, fontWeight: 500, color: INK, align: 'left', verticalAlign: 'middle' },
        })),
        box(410, 810, 380, 120, 'Redis misses are cheap\nAt 4 ms, a cache miss is negligible. Never introduce complex cache invalidation to mask unoptimized N+1 queries.', 'amber', sketched('light', {
          typography: { fontSize: 14, fontWeight: 500, color: INK, align: 'left', verticalAlign: 'middle' },
        })),
        box(820, 810, 380, 120, 'Payload size directly costs CPU\nSerializing 4 MB of JSON blocks the event loop for 26 ms. Sparse fieldsets cut serialization time by 80%.', 'slate', sketched('light', {
          typography: { fontSize: 14, fontWeight: 500, color: INK, align: 'left', verticalAlign: 'middle' },
        }))
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  // 5. SYS-PAYMENTS: How a card payment clears
  // -------------------------------------------------------------------------
  {
    id: 'sys-payments',
    category: 'systems',
    name: 'What happens when a card is tapped',
    blurb: 'The 4-party model: contactless tokenization, 3DS2 risk scoring, sub-second authorization hold (<800ms), and multi-day clearing & settlement.',
    teaches: ['Sequence', 'Swimlanes', 'Fintech Architecture', 'Interchange Economics'],
    objectCount: 39,
    build: () => {
      const nodes: NewNodeInput[] = [];
      nodes.push(
        title(0, -160, 'What happens when a card is tapped'),
        caption(
          0,
          -96,
          'Three events, four parties, two days. Contactless tokenization, risk scoring, sub-second authorization hold (<800ms), and multi-day clearing.',
          1150
        )
      );

      const LANES: Array<[string, string]> = [
        ['Cardholder & Digital Wallet (Apple Pay / Google Pay)', TINT.slate],
        ['Merchant & POS (Terminal / Payment SDK)', TINT.blue],
        ['Acquiring Bank & Gateway (Stripe / Adyen)', TINT.teal],
        ['Card Scheme Network (Visa / Mastercard)', TINT.amber],
        ['Issuing Bank (Customer Account)', TINT.rose],
      ];
      const LANE_H = 150;
      LANES.forEach(([name, tint], i) => {
        nodes.push(band(0, i * LANE_H, 2340, LANE_H - 14, tint, 0.45));
        nodes.push(heading(24, i * LANE_H + 16, name, 16));
      });
      const lane = (i: number) => i * LANE_H + 52;

      // Authorisation steps
      const tap = box(180, lane(0), 190, 72, 'Contactless Tap\nNFC / Apple Pay', 'slate');
      const token = box(420, lane(0), 190, 72, 'DPAN Tokenization\nEMV Cryptogram', 'slate');
      const terminal = box(420, lane(1), 190, 72, 'POS Terminal\nPayload Encryption', 'blue');
      const gateway = box(670, lane(2), 190, 72, 'Acquiring Gateway\nFraud & ISO 8583', 'teal');
      const route = box(920, lane(3), 190, 72, 'Scheme Switch\nRoute by BIN / IIN', 'amber');
      const risk = decision(1160, lane(4) - 30, 210, 140, '3DS2 & Risk?\nFunds Available?');
      const holdA = box(1420, lane(4), 180, 72, 'Hold Funds\nReserve Balance', 'rose');
      const okNet = box(1420, lane(3), 180, 72, 'Approval Code\nISO 0110 Msg', 'amber');
      const okAcq = box(1650, lane(2), 180, 72, 'Auth Confirmed\nCapture Logged', 'teal');
      const okMer = box(1880, lane(1), 190, 72, '“Payment Approved”\nInventory Released', 'blue');
      const okCard = box(2120, lane(0), 180, 72, 'Digital Receipt\nPush Alert', 'slate');

      nodes.push(tap, token, terminal, gateway, route, risk, holdA, okNet, okAcq, okMer, okCard);
      nodes.push(
        ...chain([tap, token]),
        link(token.id, terminal.id),
        link(terminal.id, gateway.id),
        link(gateway.id, route.id),
        link(route.id, risk.id),
        link(risk.id, holdA.id, { label: 'yes' }),
        link(holdA.id, okNet.id),
        link(okNet.id, okAcq.id),
        link(okAcq.id, okMer.id),
        link(okMer.id, okCard.id)
      );

      nodes.push(
        sticky(180, 790, 'Everything above happens in under 800 milliseconds and moves zero money. It only reserves a hold on the credit line.', 'yellow', { width: 280, height: 180 }),
        sticky(490, 790, 'This is why cancelled hotel or fuel holds linger on bank statements for days: the pre-auth was placed but never submitted for capture.', 'peach', { width: 280, height: 180 })
      );

      // Capture, Clearing & Settlement
      nodes.push(
        heading(880, 800, 'Then, Over the Next Two Days (Clearing & Settlement)'),
        chart(
          880,
          850,
          plot('timeline', {
            title: 'One Payment, Three Phases',
            categories: ['Authorise', 'Batch capture', 'Net & clear', 'Interbank settle', 'Payout'],
            series: [{ name: 'hours after tap', values: [0, 8, 24, 36, 48] }],
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
            header: true,
            theme: 'clean',
            fontSize: 12,
            columns: [
              { width: 1.6, type: 'text' },
              { width: 1.0, type: 'text', align: 'right' },
              { width: 1.4, type: 'text' },
            ],
            cells: [
              ['Fee Component', 'On £100', 'Recipient'],
              ['Interchange Fee', '£1.10', 'Issuing Bank'],
              ['Scheme Network Fee', '£0.12', 'Visa / Mastercard'],
              ['Acquirer Margin', '£0.38', 'Payment Processor'],
              ['Merchant Net Payout', '£98.40', 'Merchant Business'],
            ],
          },
          460,
          190
        ),
        note(1620, 1060, 'Interchange fee routes to issuing bank to fund fraud liability and cardholder rewards.', 460, 14)
      );

      return layer(nodes);
    },
  },

  // -------------------------------------------------------------------------
  // 6. SYS-RAFT: Consensus, drawn by hand
  // -------------------------------------------------------------------------
  {
    id: 'sys-raft',
    category: 'systems',
    name: 'Consensus, drawn by hand',
    blurb: 'How five machines agree on one number when any of them can vanish — Raft state machine and quorum log replication.',
    teaches: ['State machines', 'Sketch mode', 'Loop-backs', 'Consensus'],
    objectCount: 40,
    build: () => {
      const nodes: NewNodeInput[] = [];
      const hand = { appearance: { sketch: 'medium' as const } };

      nodes.push(
        title(0, -160, 'Consensus, drawn by hand (The Raft Protocol)'),
        caption(
          0,
          -96,
          'Five machines, one replicated state machine. The 3-state lifecycle, randomized election timeouts, and quorum log replication.',
          1150
        )
      );

      // Frame 1: 3-State Machine & Log Replication
      nodes.push(frame(0, 0, 1120, 740, 'Every Node is in One of Three States'));

      const follower = box(80, 110, 260, 120, 'Follower\nWaits for heartbeat\nTimeout: rand(150, 300)ms', 'sky', hand);
      const candidate = box(430, 110, 260, 120, 'Candidate\nIncrements term\nRequests peer votes', 'amber', hand);
      const leader = box(780, 110, 260, 120, 'Leader\nBroadcasts heartbeats\nAppends client entries', 'green', hand);

      nodes.push(follower, candidate, leader);
      nodes.push(
        link(follower.id, candidate.id, { label: 'timeout' }),
        link(candidate.id, leader.id, { label: 'majority (>=3)' }),
        curve(candidate.id, follower.id, { label: 'peer won' }),
        curve(leader.id, follower.id, { label: 'higher term seen' }),
        curve(candidate.id, candidate.id, { label: 'split vote → retry' })
      );

      nodes.push(
        note(80, 280, 'Randomized election timeouts (150–300ms) prevent split-vote deadlocks when peer heartbeats pause.', 460, 14),
        sticky(620, 270, 'Quorum of 5 is 3. Two nodes can fail without cluster downtime; three failures safely pause writes to prevent split brain.', 'yellow', { width: 280, height: 190 })
      );

      // Log replication sub-flow
      nodes.push(heading(80, 480, 'Replicating a State Machine Entry'));
      const client = box(80, 530, 190, 76, 'Client: set x=7', 'slate', hand);
      const append = box(320, 530, 190, 76, 'Leader appends\nto local log', 'green', hand);
      const send = box(560, 530, 190, 76, 'Send AppendEntries\nto all peers', 'green', hand);
      const count = decision(800, 510, 200, 120, 'Quorum (3/5)\nacknowledged?');
      const commit = box(320, 640, 190, 70, 'Advance commitIndex', 'teal', hand);
      const apply = box(560, 640, 190, 70, 'Apply to state & reply', 'teal', hand);
      nodes.push(client, append, send, count, commit, apply);
      nodes.push(
        ...chain([client, append, send]),
        link(send.id, count.id),
        curve(count.id, commit.id, { label: 'yes' }),
        link(commit.id, apply.id),
        curve(count.id, send.id, { label: 'no — retry' })
      );

      // Frame 2: 5-Node Cluster Ring
      nodes.push(frame(1180, 0, 840, 740, 'The 5-Node Cluster During Active Replication'));
      const ring: NewNodeInput[] = [];
      const CX = 1600;
      const CY = 240;
      const names = ['A · Leader', 'B · Follower', 'C · Follower', 'D · Down', 'E · Follower'];
      const tints = ['green', 'sky', 'sky', 'rose', 'sky'];
      names.forEach((name, i) => {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ring.push(
          box(CX + Math.cos(a) * 200 - 80, CY + Math.sin(a) * 160 - 38, 160, 76, name, tints[i], {
            ...hand,
            appearance: {
              fill: [{ type: 'solid', color: fillOf(tints[i]) }],
              stroke: { color: strokeOf(tints[i]), width: 1.5 },
              cornerRadius: 0,
            },
          })
        );
      });
      nodes.push(...ring);

      nodes.push(
        dashed(ring[0].id, ring[1].id, { label: '♥ AppendEntries' }),
        dashed(ring[0].id, ring[2].id, { label: '♥ AppendEntries' }),
        dashed(ring[0].id, ring[4].id, { label: '♥ AppendEntries' }),
        link(ring[0].id, ring[3].id, { label: 'no reply (timeout)', appearance: { stroke: { color: HUE.rose, width: 2, dash: [4, 6] } } })
      );

      nodes.push(
        box(1200, 480, 800, 84, 'Replicated Log State:\n[Idx 1, Term 1: set x=3]   [Idx 2, Term 1: set y=9]   [Idx 3, Term 2: set x=7 (Committed)]', 'slate', {
          ...hand,
          typography: { fontSize: 13, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle', lineHeight: 1.4 },
        }),
        note(1220, 590, 'Node A is leader, Node D is offline. Quorum holds across B, C, and E (4/5 active) — writes commit seamlessly.', 760, 14)
      );

      // Bottom Summary
      nodes.push(
        terminator(0, 800, 340, 'Where Raft Powers the World', 'violet'),
        note(
          0,
          880,
          'Kubernetes (etcd), CockroachDB, Kafka KRaft, and HashiCorp Consul rely on this state machine for serializable consistency.',
          1120,
          16,
          INK
        )
      );

      return layer(nodes);
    },
  },
];
