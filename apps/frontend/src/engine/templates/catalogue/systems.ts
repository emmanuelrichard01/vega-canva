import type { Template } from '../templates';
import { INK_STRONG, plot } from '../templateKit';
import { aws, codeHeight, Draft, gcp, k8s, type Family } from './systemsKit';

/**
 * Systems & architecture: how real systems work, drawn the way the engineers
 * who run them would draw them.
 *
 * Every board names real components, follows the order things actually
 * happen in, and carries one note on a design choice that is not obvious from
 * the boxes. The vocabulary (cards, zones, wires, the legend) lives in
 * `systemsKit.ts`, so a board here is layout and content only.
 */

// The grid every board is laid out on.
const M = 64; // board margin
const CW = 264; // card width
const CH = 76; // card height
const GAP = 44; // between stacked cards
const ZP = 24; // zone padding
const ZH = 68; // zone heading band
const ZG = 56; // between zones

/** The x of a card in the given column of zones that start at `x0`. */
const zoneW = CW + ZP * 2;
const rowY = (top: number, row: number) => top + ZH + row * (CH + GAP);
const zoneH = (rows: number) => ZH + rows * CH + (rows - 1) * GAP + 28;

// ---------------------------------------------------------------------------
// 1. How YouTube works
// ---------------------------------------------------------------------------

function youtube() {
  const d = new Draft();
  const RG = 64; // room for a label between the recommender's two columns
  const recW = CW * 2 + ZP * 2 + RG;
  const W = M * 2 + 4 * (zoneW + ZG) + recW;
  const ZT = 288; // zone top
  const zx = (i: number) => M + i * (zoneW + ZG);
  const cx = (i: number) => zx(i) + ZP;
  const ZH3 = zoneH(3);
  const BT = ZT + ZH3 + 96; // bottom row of panels
  const PH = 354;
  const H = BT + PH + M;

  d.board(W, H, 'YouTube, end to end', '📺', 'Upload → transcode → global cache → player, and the loop that picks what plays next');
  d.header(
    M,
    M,
    W - M * 2,
    152,
    'How YouTube works',
    'One upload becomes a ladder of encodings cached inside your ISP, and every second you watch feeds the models that choose the next video.',
    ['call', 'data', 'event', 'loop'],
    'Numbered steps follow a single upload'
  );

  // Upload ------------------------------------------------------------------
  d.zone(zx(0), ZT, zoneW, ZH3, 'Upload', 'blue');
  const studio = d.card(cx(0), rowY(ZT, 0), CW, CH, { title: 'YouTube Studio', sub: 'Resumable, survives a dropped link', glyph: 'browser', family: 'blue' });
  const gfe = d.card(cx(0), rowY(ZT, 1), CW, CH, { title: 'Google Front End', sub: 'TLS ends at the nearest edge PoP', icon: gcp('categories/networking') });
  const ingest = d.card(cx(0), rowY(ZT, 2), CW, CH, { title: 'Upload service', sub: 'Original to Colossus, metadata to Vitess', icon: gcp('categories/storage') });

  // Process (reads bottom to top, so every hand-off is a straight line) -----
  d.zone(zx(1), ZT, zoneW, ZH3, 'Process', 'violet');
  const encode = d.card(cx(1), rowY(ZT, 0), CW, CH, { title: 'Encode the ladder', sub: 'H.264, VP9 and AV1 on Argos VCUs', icon: gcp('categories/media-services') });
  const split = d.card(cx(1), rowY(ZT, 1), CW, CH, { title: 'Split at keyframes', sub: 'Thousands of chunks encode in parallel', icon: gcp('categories/compute') });
  const checks = d.card(cx(1), rowY(ZT, 2), CW, CH, { title: 'Content ID & safety', sub: 'Fingerprint match, policy classifiers', icon: gcp('categories/security-identity') });

  // Deliver -----------------------------------------------------------------
  d.zone(zx(2), ZT, zoneW, ZH3, 'Deliver', 'teal');
  const colossus = d.card(cx(2), rowY(ZT, 0), CW, CH, { title: 'Colossus', sub: 'Every rendition, replicated across regions', icon: gcp('products/cloud-storage') });
  const edge = d.card(cx(2), rowY(ZT, 1), CW, CH, { title: 'Google edge PoPs', sub: 'Regional cache fill and origin shield', glyph: 'globe', family: 'teal' });
  const ggc = d.card(cx(2), rowY(ZT, 2), CW, CH, { title: 'Google Global Cache', sub: 'Appliances inside your ISP', glyph: 'server', family: 'teal' });

  // Watch -------------------------------------------------------------------
  d.zone(zx(3), ZT, zoneW, ZH3, 'Watch', 'amber');
  d.sticky(
    cx(3),
    rowY(ZT, 0),
    CW,
    CH * 2 + GAP - 40,
    'The player starts low on purpose: it measures throughput for a few segments, then climbs. A fast first frame beats a sharp one.',
    'yellow'
  );
  const player = d.card(cx(3), rowY(ZT, 2), CW, CH, { title: 'Player', sub: 'DASH: picks a rung for every segment', glyph: 'mobile', family: 'amber' });

  // Recommend: a loop, two columns wide -------------------------------------
  const rx = zx(4);
  d.zone(rx, ZT, recW, ZH3, 'Recommend', 'rose');
  const c1 = rx + ZP;
  const c2 = rx + ZP + CW + RG;
  const events = d.card(c1, rowY(ZT, 0), CW, CH, { title: 'Watch events', sub: 'Watch time, likes, skips, surveys', icon: gcp('categories/data-analytics') });
  const features = d.card(c2, rowY(ZT, 0), CW, CH, { title: 'Feature store', sub: 'User and video embeddings', icon: gcp('products/big-query') });
  const retrieve = d.card(c2, rowY(ZT, 1), CW, CH, { title: 'Candidate generation', sub: 'Two-tower retrieval: billions to hundreds', icon: gcp('products/vertex-ai') });
  const rank = d.card(c2, rowY(ZT, 2), CW, CH, { title: 'Ranking', sub: 'Predicts watch time and satisfaction', icon: gcp('categories/ai-machine-learning') });
  const feed = d.card(c1, rowY(ZT, 2), CW, CH, { title: 'Home & Up next', sub: 'Re-ranked for freshness and variety', icon: gcp('categories/web-mobile') });

  [studio, gfe, ingest, checks, split, encode, colossus, edge, ggc, player].forEach((card, i) => d.step(card, i + 1));

  d.wire(studio, gfe, 'call', { label: 'HTTPS' });
  d.wire(gfe, ingest, 'call');
  d.wire(ingest, checks, 'data', { label: 'original' });
  d.wire(checks, split, 'data');
  d.wire(split, encode, 'data');
  d.wire(encode, colossus, 'data', { label: 'renditions' });
  d.wire(colossus, edge, 'data', { label: 'cache fill' });
  d.wire(edge, ggc, 'data');
  d.wire(ggc, player, 'data', { label: 'segments' });
  d.wire(player, events, 'event', { label: 'watch events', routing: 'orthogonal', from: 'top', to: 'bottom' });
  d.wire(events, features, 'call');
  d.wire(features, retrieve, 'call');
  d.wire(retrieve, rank, 'call', { label: 'hundreds' });
  d.wire(rank, feed, 'call', { label: 'top 20' });
  d.wire(feed, player, 'loop', { routing: 'orthogonal' });

  // The ladder: a table, and the chart that reads it -------------------------
  const ladderW = 1056;
  d.panel(M, BT, ladderW, PH, 'Delivery ladder', '📶', 'Average VP9 bitrates per rung; the chart reads the table, so edit a number and it redraws');
  const ladder = d.table(M + 24, BT + 24, 560, {
    header: true,
    theme: 'clean',
    fontSize: 13,
    columns: [
      { width: 0.9, type: 'text' },
      { width: 0.9, type: 'number' },
      { width: 1.2, type: 'text' },
      {
        width: 1.6,
        type: 'select',
        multi: true,
        options: [
          { label: 'AV1', tag: 5 },
          { label: 'VP9', tag: 1 },
          { label: 'H.264', tag: 0 },
        ],
      },
    ],
    cells: [
      ['Rung', 'Avg Mbps', 'Frame', 'Codecs'],
      ['144p', '0.1', '256 × 144', 'AV1;VP9;H.264'],
      ['240p', '0.2', '426 × 240', 'AV1;VP9;H.264'],
      ['360p', '0.4', '640 × 360', 'AV1;VP9;H.264'],
      ['480p', '0.75', '854 × 480', 'AV1;VP9;H.264'],
      ['720p', '1.5', '1280 × 720', 'AV1;VP9;H.264'],
      ['1080p', '2.6', '1920 × 1080', 'AV1;VP9;H.264'],
      ['1440p', '8', '2560 × 1440', 'AV1;VP9'],
      ['2160p', '17', '3840 × 2160', 'AV1;VP9'],
    ],
  });
  d.chart(
    M + 24 + 560 + 24,
    BT + 24,
    ladderW - 560 - 72,
    306,
    plot('barHorizontal', {
      title: 'Average bitrate by rung',
      categories: ['144p', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p'],
      series: [{ name: 'Avg Mbps', values: [0.1, 0.2, 0.4, 0.75, 1.5, 2.6, 8, 17] }],
      showValues: true,
      valuePrefix: '',
      valueSuffix: ' Mbps',
      showLegend: false,
      link: { tableId: ladder.id as string, r0: 0, c0: 0, r1: 8, c1: 1, header: true },
    })
  );

  // Why it is built this way ---------------------------------------------------
  const nx = M + ladderW + 56;
  const nw = W - M - nx;
  d.panel(nx, BT, nw, PH, 'Why it is built this way', '🧠', 'Three choices that are not obvious from the boxes');
  const sw = (nw - 24 * 4) / 3;
  d.sticky(nx + 24, BT + 24, sw, PH - 48, 'Split at keyframes, then encode in parallel. A two-hour upload becomes thousands of short jobs, so 360p is watchable in minutes and 4K follows.', 'yellow', { reactions: { '💡': ['a', 'b', 'c'] } });
  d.sticky(nx + 48 + sw, BT + 24, sw, PH - 48, 'The cache lives inside your ISP. Most views never cross the internet backbone: Google Global Cache serves them from a rack down the road.', 'sky', { reactions: { '👍': ['a', 'b'] } });
  d.sticky(nx + 72 + sw * 2, BT + 24, sw, PH - 48, 'Two stages, because no model can score every video for every viewer. Cheap retrieval narrows billions to hundreds; a heavy model ranks only those.', 'mint', { reactions: { '🎯': ['a', 'b', 'c', 'd'] } });

  return d.nodes();
}

// ---------------------------------------------------------------------------
// 2. How Netflix streams
// ---------------------------------------------------------------------------

function netflix() {
  const d = new Draft();
  const W = 2240;
  const ZT = 288;
  const CG = 56; // between card columns inside a zone
  const col = (x0: number, i: number) => x0 + ZP + i * (CW + CG);

  // Columns: the device, the control plane on AWS, then the notes.
  const devX = M;
  const awsX = devX + zoneW + ZG;
  const awsW = ZP * 2 + CW * 4 + CG * 3;
  const noteX = awsX + awsW + ZG;
  const noteW = W - M - noteX;
  const awsH = zoneH(2);
  const ocY = ZT + awsH + ZG;
  const ocH = zoneH(1);
  const archH = ocY + ocH - ZT;
  const TT = ocY + ocH + 96; // the timeline panel
  const LANE = 56;
  const LANES = ['Netflix app', 'Zuul', 'Playback API', 'Steering', 'Licence', 'Open Connect'];
  const TH = 24 + 40 + LANES.length * LANE + 24;
  const H = TT + TH + M;

  d.board(W, H, 'Netflix playback', '🎬', 'Decisions come from AWS, bytes come from Open Connect');
  d.header(
    M,
    M,
    W - M * 2,
    152,
    'How Netflix streams',
    'Every press of play is two conversations: a quick one with the control plane on AWS, and a long one with an Open Connect server that usually sits inside your own ISP.',
    ['call', 'data', 'control', 'fail'],
    'Numbered steps follow one press of play'
  );

  // The device -----------------------------------------------------------------
  d.zone(devX, ZT, zoneW, archH, 'Your home', 'amber');
  const app = d.card(devX + ZP, rowY(ZT, 0), CW, CH, { title: 'Netflix app', sub: 'TV, phone, console or browser', glyph: 'display', family: 'amber' });
  d.sticky(
    devX + ZP,
    rowY(ZT, 1),
    CW,
    archH - (ZH + CH + GAP) - 28,
    'Two connections, two jobs. AWS decides what to play and where from; Open Connect delivers the bytes. If AWS has a bad minute, a film that is already playing does not notice.',
    'yellow'
  );

  // The control plane -----------------------------------------------------------
  d.zone(awsX, ZT, awsW, awsH, 'Control plane on AWS', 'violet');
  const zuul = d.card(col(awsX, 0), rowY(ZT, 0), CW, CH, { title: 'Zuul gateway', sub: 'Auth, routing and load shedding', icon: aws('svc-networking-content-delivery/elastic-load-balancing') });
  const play = d.card(col(awsX, 1), rowY(ZT, 0), CW, CH, { title: 'Playback API', sub: 'Picks profiles this device can play', icon: aws('svc-compute/amazon-ec2') });
  const licence = d.card(col(awsX, 2), rowY(ZT, 0), CW, CH, { title: 'Licence service', sub: 'Widevine, FairPlay, PlayReady', icon: aws('svc-security-identity/aws-key-management-service') });
  const cassandra = d.card(col(awsX, 3), rowY(ZT, 0), CW, CH, { title: 'Cassandra', sub: 'Viewing history and bookmarks', icon: aws('svc-databases/amazon-keyspaces') });
  const chaos = d.card(col(awsX, 0), rowY(ZT, 1), CW, CH, { title: 'Chaos Monkey', sub: 'Kills instances in working hours', icon: aws('svc-developer-tools/aws-fault-injection-service'), dashed: true });
  const steering = d.card(col(awsX, 1), rowY(ZT, 1), CW, CH, { title: 'Steering service', sub: 'Ranks servers by health and route', icon: aws('svc-networking-content-delivery/amazon-route-53') });
  const evcache = d.card(col(awsX, 2), rowY(ZT, 1), CW, CH, { title: 'EVCache', sub: 'Memcached, replicated per region', icon: aws('svc-databases/amazon-elasticache') });
  const masters = d.card(col(awsX, 3), rowY(ZT, 1), CW, CH, { title: 'Encoded masters', sub: 'Every title and profile, in S3', icon: aws('svc-storage/amazon-simple-storage-service') });

  // Open Connect ----------------------------------------------------------------
  d.zone(awsX, ocY, awsW, ocH, 'Open Connect', 'rose');
  const ocaIsp = d.card(col(awsX, 0), rowY(ocY, 0), CW, CH, { title: 'OCA in your ISP', sub: 'Embedded: serves most of the bytes', glyph: 'server', family: 'rose' });
  const ocaIxp = d.card(col(awsX, 1), rowY(ocY, 0), CW, CH, { title: 'OCA at an exchange', sub: 'Peering for the long tail', glyph: 'server', family: 'rose' });
  const fill = d.card(col(awsX, 3), rowY(ocY, 0), CW, CH, { title: 'Nightly fill', sub: 'Tomorrow’s popular titles, off-peak', glyph: 'archive', family: 'rose' });

  [app, zuul, play, steering, licence, ocaIsp].forEach((card, i) => d.step(card, i + 1));

  d.wire(app, zuul, 'call', { label: 'POST /play' });
  d.wire(zuul, play, 'call');
  d.wire(play, steering, 'call');
  d.wire(play, licence, 'call');
  d.wire(play, evcache, 'call');
  d.wire(evcache, cassandra, 'call', { label: 'on a miss' });
  d.wire(app, ocaIsp, 'data', { label: 'video bytes' });
  d.wire(ocaIxp, steering, 'control', { label: 'health, routes' });
  d.wire(masters, fill, 'data');
  d.wire(fill, ocaIxp, 'data', { label: 'fill' });
  d.wire(ocaIxp, ocaIsp, 'data', { label: 'peer fill' });
  d.wire(chaos, zuul, 'fail', { label: 'terminates' });

  // Notes -------------------------------------------------------------------------
  d.callout(
    noteX,
    ZT,
    noteW,
    'Why Netflix runs its own CDN',
    'Video is most of the bytes, and it is predictable: what will be popular tomorrow is known tonight. Pushing files into ISPs while the network is quiet beats any cache that fills on demand.',
    'rose'
  );
  d.callout(
    noteX,
    ZT + 248,
    noteW,
    'Why break things on purpose',
    'Instances die anyway. Chaos Monkey makes it routine, in office hours, so every service is written to lose a host at any moment and nobody learns that at 3 a.m.',
    'violet'
  );

  // Press play: the timeline ------------------------------------------------------
  const TX = M;
  const TW = W - M * 2;
  d.panel(TX, TT, TW, TH, 'Press play', '▶️', 'What happens in the first couple of seconds, one lane per system');
  const labelW = 176;
  const EW = 216;
  const laneTop = TT + 24 + 40;
  const t0 = TX + 24 + labelW + 48;
  const tStep = (TX + TW - 24 - t0 - EW) / 6;
  const tx = (i: number) => t0 + i * tStep;
  const ly = (lane: number) => laneTop + lane * LANE;
  LANES.forEach((name, i) => {
    if (i % 2 === 0) d.band(TX + 24, ly(i), TW - 48, LANE, 'slate', 0.06);
    d.card(TX + 24 + 8, ly(i) + 12, labelW - 16, LANE - 24, { title: name });
  });
  d.chip(t0, TT + 22, 104, 30, 'Time →', 'slate');
  const ev = (lane: number, t: number, title: string, family: Family) => d.card(tx(t), ly(lane) + 10, EW, LANE - 20, { title, family });
  const e1 = ev(0, 0, 'Press play', 'amber');
  const e2 = ev(1, 1, 'Auth and route', 'violet');
  const e3 = ev(2, 2, 'Pick profiles', 'violet');
  const e4 = ev(3, 3, 'Rank OCA URLs', 'violet');
  const e5 = ev(4, 3, 'Issue DRM licence', 'violet');
  const e6 = ev(0, 4, 'Manifest + URLs', 'amber');
  const e7 = ev(5, 5, 'First segments', 'rose');
  const e8 = ev(0, 6, 'Playing', 'amber');
  const seq = { from: 'right', to: 'left' } as const;
  d.wire(e1, e2, 'call', seq);
  d.wire(e2, e3, 'call', seq);
  d.wire(e3, e4, 'call', seq);
  d.wire(e3, e5, 'call', { ...seq, label: 'in parallel' });
  d.wire(e4, e6, 'call', seq);
  d.wire(e5, e6, 'call', seq);
  d.wire(e6, e7, 'data', { ...seq, label: 'range requests' });
  d.wire(e7, e8, 'data', seq);

  return d.nodes();
}

// ---------------------------------------------------------------------------
// 3. GitHub Actions CI/CD
// ---------------------------------------------------------------------------

const CI_YAML = `name: ci
on:
  pull_request:
  push:
    branches: [main]

# A new push cancels the run it supersedes.
concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: [18, 20, 22]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  deploy:
    needs: [test, build]
    if: github.ref == 'refs/heads/main'
    environment: production
    permissions:
      id-token: write
      contents: read
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ vars.DEPLOY_ROLE_ARN }}
          aws-region: eu-west-1
      - run: ./scripts/deploy.sh \${{ github.sha }}`;

function githubActions() {
  const d = new Draft();
  const ZT = 288;
  const JW = 232; // a job
  const JH = 72;
  const JG = 56;
  const GW = 248; // the matrix group

  // Lane A: every pull request ---------------------------------------------------
  const ax = [M + ZP];
  [JW, JW, GW, JW, JW].forEach((w, i) => ax.push(ax[i] + w + JG));
  const TW = 456; // the checks table
  const laneW = ax[5] + TW + ZP - M;
  const stackH = JH + 20 + JH + 20 + 178;
  const laneAH = ZH + stackH + 28;
  const mid = ZT + ZH + stackH / 2 - JH / 2;

  const codeX = M + laneW + ZG;
  const codeW = 520;
  const W = codeX + codeW + M;

  const bY = ZT + laneAH + ZG;
  const laneBH = ZH + JH + GAP + 120 + 28;
  const codeFont = 11;
  const panelH = Math.max(laneAH + ZG + laneBH, codeHeight(CI_YAML, codeFont) + 40);
  const H = ZT + panelH + M;

  d.board(W, H, 'CI/CD with GitHub Actions', '⚙️', 'From a pushed commit to production, with the gates that keep main green');
  d.header(
    M,
    M,
    W - M * 2,
    152,
    'GitHub Actions CI/CD',
    'A pull request runs lint, types and a six-way test matrix; green checks unlock the merge, and main ships through staging and an approval gate.',
    ['call', 'data', 'fail', 'loop'],
    'Numbered steps follow one change'
  );

  d.zone(M, ZT, laneW, laneAH, 'On every pull request', 'blue');
  const push = d.card(ax[0], mid, JW, JH, { title: 'git push', sub: 'to a pull request', glyph: 'terminal', family: 'blue' });
  const install = d.card(ax[1], mid, JW, JH, { title: 'Install', sub: 'pnpm, lockfile cache', glyph: 'package', family: 'blue' });
  const lint = d.card(ax[2], ZT + ZH, GW, JH, { title: 'Lint', sub: 'ESLint and Prettier' });
  const types = d.card(ax[2], ZT + ZH + JH + 20, GW, JH, { title: 'Typecheck', sub: 'tsc -b, project refs' });
  const gy = ZT + ZH + (JH + 20) * 2;
  const matrix = d.surface(ax[2], gy, GW, 178, { family: 'blue' });
  d.add(d.text(ax[2] + 16, gy + 14, GW - 32, 'Test matrix · 6 jobs', { size: 14, weight: 650, color: INK_STRONG, lineHeight: 1.3 }));
  ['ubuntu', 'windows'].forEach((os, c) =>
    [18, 20, 22].forEach((node, r) =>
      d.chip(ax[2] + 16 + c * ((GW - 40) / 2 + 8), gy + 46 + r * 42, (GW - 40) / 2, 34, `${os} · ${node}`, node === 22 && os === 'windows' ? 'rose' : 'green')
    )
  );
  const build = d.card(ax[3], mid, JW, JH, { title: 'Build', sub: 'Turborepo cache', glyph: 'gear', family: 'blue' });
  const preview = d.card(ax[4], mid, JW, JH, { title: 'Preview deploy', sub: 'A URL on every PR', glyph: 'globe', family: 'blue' });
  const checks = d.table(ax[5], ZT + ZH + stackH / 2 - (7 * 32) / 2, TW, {
    header: true,
    theme: 'clean',
    fontSize: 12.5,
    columns: [
      { width: 1.7, type: 'text' },
      {
        width: 1.1,
        type: 'select',
        options: [
          { label: 'Passing', tag: 2 },
          { label: 'Failing', tag: 4 },
        ],
      },
      { width: 0.8, type: 'number' },
      { width: 0.9, type: 'checkbox' },
    ],
    cells: [
      ['Required check', 'Status', 'Secs', 'Required'],
      ['lint', 'Passing', '38', 'TRUE'],
      ['typecheck', 'Passing', '72', 'TRUE'],
      ['test (ubuntu, 22)', 'Passing', '161', 'TRUE'],
      ['test (windows, 22)', 'Failing', '238', 'TRUE'],
      ['build', 'Passing', '107', 'TRUE'],
      ['preview', 'Passing', '52', 'FALSE'],
    ],
    bars: [{ col: 2, color: '#93C5FD' }],
    rules: [{ col: 1, when: 'Failing', fill: '#FEF2F2', wholeRow: true }],
  }, 32);

  d.sticky(ax[0], ZT + ZH, JW * 2 + JG, mid - (ZT + ZH) - 24, 'concurrency cancels the run a new push supersedes, so the queue never fills with stale work.', 'lavender');
  d.sticky(ax[0], mid + JH + 24, JW * 2 + JG, ZT + laneAH - 28 - (mid + JH + 24), 'The cache key is the lockfile hash: a dependency change misses once, every run after it hits.', 'yellow');
  d.sticky(ax[3], ZT + ZH, JW * 2 + JG, mid - (ZT + ZH) - 24, 'fail-fast: false keeps every leg running, so one red cell shows exactly which OS and Node broke.', 'peach');

  // Lane B: merge to main ---------------------------------------------------------
  d.zone(M, bY, laneW, laneBH, 'On merge to main', 'green');
  const bGap = (laneW - ZP * 2 - JW * 6) / 5;
  const bx = (i: number) => M + ZP + i * (JW + bGap);
  const brow = bY + ZH;
  const merge = d.card(bx(0), brow, JW, JH, { title: 'Merge', sub: 'Squash, after review', glyph: 'user', family: 'green' });
  const release = d.card(bx(1), brow, JW, JH, { title: 'Release v1.42.0', sub: 'Tagged by Changesets', glyph: 'package', family: 'green' });
  const staging = d.card(bx(2), brow, JW, JH, { title: 'Staging', sub: 'Smoke tests on real infra', glyph: 'gear', family: 'green' });
  const approve = d.decision(bx(3) + 4, brow + JH / 2 - 52, JW - 8, 104, 'Approved?');
  const prod = d.card(bx(4), brow, JW, JH, { title: 'Production', sub: 'OIDC role, canary first', glyph: 'bolt', family: 'green' });
  const health = d.card(bx(5), brow, JW, JH, { title: 'Health checks', sub: 'Errors and p95, 10 min', glyph: 'activity', family: 'green' });
  const rollback = d.card(bx(5), brow + JH + GAP, JW, JH, { title: 'Roll back', sub: 'Redeploy the last tag', glyph: 'delay', family: 'rose', dashed: true });
  d.sticky(bx(0), brow + JH + GAP, JW * 2 + bGap, 120, 'OIDC: the job trades a short-lived GitHub token for a cloud role. No long-lived keys sit in repository secrets.', 'mint');

  [push, install, build, preview, merge, release, staging, prod].forEach((card, i) => d.step(card, i + 1));

  d.wire(push, install, 'call');
  d.wire(install, lint, 'call');
  d.wire(install, types, 'call');
  d.wire(install, matrix, 'call');
  d.wire(lint, build, 'call');
  d.wire(types, build, 'call');
  d.wire(matrix, build, 'call', { label: 'needs' });
  d.wire(build, preview, 'data', { label: 'artifact' });
  d.wire(preview, checks, 'call');
  d.wire(checks, merge, 'call', { label: 'all required green', from: 'bottom', to: 'top' });
  d.wire(merge, release, 'call');
  d.wire(release, staging, 'data');
  d.wire(staging, approve, 'call');
  d.wire(approve, prod, 'call', { label: 'yes' });
  d.wire(prod, health, 'call');
  d.wire(health, rollback, 'fail', { label: 'SLO breach' });
  d.wire(rollback, prod, 'loop', { label: 'previous tag' });

  // The workflow file ----------------------------------------------------------------
  d.panel(codeX, ZT, codeW, panelH, '.github/workflows/ci.yml', '📄', 'The workflow behind both lanes, trimmed to the parts that matter');
  d.code(codeX + 20, ZT + 20, codeW - 40, CI_YAML, 'yaml', { filename: 'ci.yml', fontSize: codeFont, highlights: [8, 9, 10, 15, 33, 35] });

  return d.nodes();
}

// ---------------------------------------------------------------------------
// 4. A modern data platform
// ---------------------------------------------------------------------------

function dataPlatform() {
  const d = new Draft();
  const ZT = 288;
  const RG = 64;
  const zx = (i: number) => M + i * (zoneW + ZG);
  const cx = (i: number) => zx(i) + ZP;
  const serveW = CW * 2 + ZP * 2 + RG;
  const W = zx(3) + serveW + M;
  const ZH3 = zoneH(3);
  const bY = ZT + ZH3 + ZG;
  const tW = zoneW * 3 + ZG * 2;
  const tH = zoneH(2);
  const pY = bY + tH + 96;
  const pH = 24 + 34 + 12 + 4 * 34 + 24;
  const H = pY + pH + M;

  d.board(W, H, 'Data platform', '🏗️', 'Sources to lakehouse to the people and tools that use the numbers');
  d.header(
    M,
    M,
    W - M * 2,
    152,
    'A modern data platform',
    'Change data from Postgres, Stripe’s API and product events land raw in a lakehouse, dbt refines them bronze → silver → gold, and the warehouse serves BI, reverse ETL and ML.',
    ['data', 'call', 'control', 'event'],
    'Numbered steps follow one order'
  );

  d.zone(zx(0), ZT, zoneW, ZH3, 'Sources', 'slate');
  const pg = d.card(cx(0), rowY(ZT, 0), CW, CH, { title: 'Postgres', sub: 'orders, customers on RDS', icon: aws('svc-databases/amazon-rds') });
  const stripe = d.card(cx(0), rowY(ZT, 1), CW, CH, { title: 'Stripe', sub: 'charges, refunds, payouts', glyph: 'wallet', family: 'slate' });
  const events = d.card(cx(0), rowY(ZT, 2), CW, CH, { title: 'Product events', sub: 'track, page, identify', glyph: 'activity', family: 'slate' });

  d.zone(zx(1), ZT, zoneW, ZH3, 'Ingest', 'sky');
  const kafka = d.card(cx(1), rowY(ZT, 0), CW, CH, { title: 'Debezium → Kafka', sub: 'Every row change as an event', icon: aws('svc-analytics/amazon-managed-streaming-for-apache-kafka') });
  const fivetran = d.card(cx(1), rowY(ZT, 1), CW, CH, { title: 'Fivetran', sub: 'Stripe API, every 15 minutes', glyph: 'sliders', family: 'sky' });
  const firehose = d.card(cx(1), rowY(ZT, 2), CW, CH, { title: 'Data Firehose', sub: 'Events to S3 in micro-batches', icon: aws('svc-analytics/amazon-data-firehose') });

  d.zone(zx(2), ZT, zoneW, ZH3, 'Lakehouse on S3', 'amber');
  const bronze = d.card(cx(2), rowY(ZT, 0), CW, CH, { title: 'Bronze', sub: 'Raw Iceberg tables, append-only', icon: aws('svc-storage/amazon-simple-storage-service') });
  const silver = d.card(cx(2), rowY(ZT, 1), CW, CH, { title: 'Silver', sub: 'Deduped, typed, conformed', icon: aws('svc-analytics/aws-glue') });
  const gold = d.card(cx(2), rowY(ZT, 2), CW, CH, { title: 'Gold', sub: 'orders, revenue, customers', icon: aws('svc-analytics/aws-lake-formation') });

  d.zone(zx(3), ZT, serveW, ZH3, 'Serve', 'green');
  const s1 = cx(3);
  const s2 = cx(3) + CW + RG;
  const warehouse = d.card(s1, rowY(ZT, 0), CW, CH, { title: 'Snowflake', sub: 'Gold tables, served to SQL', glyph: 'cylinder', family: 'green' });
  const metrics = d.card(s1, rowY(ZT, 1), CW, CH, { title: 'Semantic layer', sub: 'Revenue defined once', glyph: 'sliders', family: 'green' });
  const catalog = d.card(s1, rowY(ZT, 2), CW, CH, { title: 'Data catalog', sub: 'Owners, docs, lineage', glyph: 'document', family: 'green' });
  const bi = d.card(s2, rowY(ZT, 0), CW, CH, { title: 'Looker', sub: 'The revenue dashboard', icon: gcp('products/looker') });
  const retl = d.card(s2, rowY(ZT, 1), CW, CH, { title: 'Reverse ETL', sub: 'Scores back into Salesforce', glyph: 'arrow_block', family: 'green' });
  const ml = d.card(s2, rowY(ZT, 2), CW, CH, { title: 'SageMaker', sub: 'Churn features and training', icon: aws('svc-analytics/amazon-sagemaker') });

  // Transform: the orchestrator, dbt, and the lineage dbt builds ------------------
  d.zone(M, bY, tW, tH, 'Transform & test', 'violet');
  const dagster = d.card(cx(0), rowY(bY, 0), CW, CH, { title: 'Dagster', sub: 'Runs on freshness, retries', glyph: 'gear', family: 'violet' });
  const dbt = d.card(cx(1), rowY(bY, 0), CW, CH, { title: 'dbt build', sub: 'SQL models and tests, one DAG', glyph: 'document', family: 'violet' });
  const dq = d.card(cx(2), rowY(bY, 0), CW, CH, { title: 'Contracts', sub: 'Schema and freshness checks', glyph: 'shield', family: 'violet' });
  const LIN = ['src.orders', 'stg_orders', 'int_payments', 'fct_orders', 'revenue_daily', 'Revenue board'];
  const LG = 44;
  const linW = (tW - ZP * 2 - LG * (LIN.length - 1)) / LIN.length;
  const lineage = LIN.map((name, i) => d.chip(M + ZP + i * (linW + LG), rowY(bY, 1) + 18, linW, 40, name, i === LIN.length - 1 ? 'green' : 'violet'));
  lineage.slice(1).forEach((chip, i) => d.wire(lineage[i], chip, 'data', { from: 'right', to: 'left' }));
  const nX = zx(3);
  const nW = (serveW - 24) / 2;
  d.sticky(nX, bY, nW, tH, 'Bronze is never edited. When a silver model has a bug, fix it and rebuild from bronze; no source has to send anything again.', 'lavender');
  d.sticky(nX + nW + 24, bY, nW, tH, 'Why CDC and not a nightly dump: every update and delete arrives within seconds, read from the WAL, with no extra load on the primary.', 'yellow');

  [pg, kafka, bronze, silver, gold, warehouse, bi].forEach((card, i) => d.step(card, i + 1));

  d.wire(pg, kafka, 'data', { label: 'WAL' });
  d.wire(stripe, fivetran, 'call', { label: 'REST' });
  d.wire(events, firehose, 'event');
  d.wire(kafka, bronze, 'data');
  d.wire(fivetran, bronze, 'data');
  d.wire(firehose, bronze, 'data');
  d.wire(bronze, silver, 'data');
  d.wire(silver, gold, 'data');
  d.wire(gold, warehouse, 'data', { label: 'load' });
  d.wire(warehouse, bi, 'call');
  d.wire(warehouse, metrics, 'call');
  d.wire(metrics, retl, 'call');
  d.wire(warehouse, ml, 'data');
  d.wire(dagster, dbt, 'control', { label: 'schedules' });
  d.wire(dbt, dq, 'call', { label: 'tests' });
  d.wire(dbt, silver, 'control', { label: 'builds' });
  d.wire(dbt, catalog, 'control', { label: 'lineage' });

  // Samples and checks ----------------------------------------------------------
  const sW = 1100;
  d.panel(M, pY, sW, pH, 'One order, two layers', '🧾', 'The same order as Debezium landed it, and as the gold model serves it');
  const half = (sW - 72) / 2;
  d.chip(M + 24, pY + 24, 200, 34, 'Bronze · raw CDC', 'amber');
  d.table(M + 24, pY + 24 + 46, half, {
    header: true,
    theme: 'minimal',
    fontSize: 12.5,
    columns: [
      { width: 0.4, type: 'text' },
      { width: 1.3, type: 'text' },
      { width: 0.8, type: 'text' },
      { width: 0.9, type: 'text' },
      { width: 1, type: 'number' },
    ],
    cells: [
      ['op', 'ts_ms', 'id', 'status', 'amount_cents'],
      ['c', '1717171201234', '98231', 'pending', '4999'],
      ['u', '1717171263011', '98231', 'paid', '4999'],
      ['u', '1717171990402', '98231', 'shipped', '4999'],
    ],
  });
  d.chip(M + 48 + half, pY + 24, 200, 34, 'Gold · fct_orders', 'green');
  d.table(M + 48 + half, pY + 24 + 46, half, {
    header: true,
    theme: 'clean',
    fontSize: 12.5,
    currency: '$',
    columns: [
      { width: 0.8, type: 'text' },
      { width: 1.1, type: 'text' },
      { width: 0.9, type: 'currency' },
      {
        width: 0.9,
        type: 'select',
        options: [
          { label: 'shipped', tag: 2 },
          { label: 'paid', tag: 1 },
          { label: 'refunded', tag: 4 },
        ],
      },
      { width: 1, type: 'date' },
    ],
    cells: [
      ['order_id', 'customer', 'amount', 'status', 'paid_at'],
      ['98231', 'Acme Ltd', '49.99', 'shipped', '2024-05-31'],
      ['98232', 'Northwind', '120.00', 'paid', '2024-05-31'],
      ['98233', 'Globex', '15.50', 'refunded', '2024-06-01'],
    ],
  });

  const qX = M + sW + 56;
  const qW = W - M - qX;
  d.panel(qX, pY, qW, pH, 'Data quality', '✅', 'dbt tests from last night’s run');
  d.table(qX + 24, pY + 24, qW - 48, {
    header: true,
    theme: 'striped',
    fontSize: 12.5,
    columns: [
      { width: 1.6, type: 'text' },
      { width: 1, type: 'text' },
      {
        width: 0.7,
        type: 'select',
        options: [
          { label: 'pass', tag: 2 },
          { label: 'warn', tag: 3 },
          { label: 'fail', tag: 4 },
        ],
      },
      { width: 0.6, type: 'number' },
    ],
    cells: [
      ['Test', 'Model', 'Result', 'Rows'],
      ['unique(order_id)', 'fct_orders', 'pass', '0'],
      ['not_null(customer_id)', 'fct_orders', 'pass', '0'],
      ['accepted_values(status)', 'stg_orders', 'warn', '3'],
      ['source freshness < 1 h', 'src_stripe', 'fail', '0'],
      ['relationships(customer)', 'fct_orders', 'pass', '0'],
    ],
  }, (pH - 48) / 6);

  return d.nodes();
}

// ---------------------------------------------------------------------------
// 5. RAG application
// ---------------------------------------------------------------------------

const PROMPT = `SYSTEM = """You answer questions about Acme's products.
Use only the numbered sources. Cite them like [2].
If the sources do not answer it, say you don't know."""

def build_prompt(question: str, chunks: list[Chunk]) -> list[dict]:
    sources = "\\n\\n".join(
        f"[{i}] {c.title} ({c.url})\\n{c.text}"
        for i, c in enumerate(chunks, start=1)
    )
    return [
        {"role": "system", "content": SYSTEM},
        {"role": "user",
         "content": f"Sources:\\n{sources}\\n\\nQuestion: {question}"},
    ]`;

function rag() {
  const d = new Draft();
  const W = 2240;
  const ZT = 288;
  const C = 216; // a stage
  const SG = (W - M * 2 - ZP * 2 - C * 8) / 7;
  const sx = (i: number) => M + ZP + i * (C + SG);
  const laneW = W - M * 2;
  const L1 = ZT;
  const L2 = ZT + zoneH(1) + ZG;
  const BY = L2 + zoneH(1) + 96;
  const codeFont = 12;
  const codeH = codeHeight(PROMPT, codeFont);
  const BH = Math.max(zoneH(2), codeH + 48);
  const H = BY + BH + M;

  d.board(W, H, 'RAG application', '🤖', 'Retrieval-augmented generation, from documents to a cited answer');
  d.header(
    M,
    M,
    W - M * 2,
    152,
    'RAG application architecture',
    'Documents are chunked and embedded ahead of time; each question is rewritten, matched by meaning and keyword, re-ranked, and answered from the sources it cites.',
    ['data', 'call', 'control', 'loop'],
    'Numbered steps follow one question'
  );

  d.zone(M, L1, laneW, zoneH(1), 'Index · offline, on every document change', 'sky');
  const docs = d.card(sx(0), rowY(L1, 0), C, CH, { title: 'Sources', sub: 'Confluence, PDFs, tickets', icon: aws('svc-storage/amazon-simple-storage-service') });
  const parse = d.card(sx(1), rowY(L1, 0), C, CH, { title: 'Parse & clean', sub: 'Text, tables, headings', glyph: 'document', family: 'sky' });
  const chunk = d.card(sx(2), rowY(L1, 0), C, CH, { title: 'Chunk', sub: '~500 tokens, 50 overlap', glyph: 'multi_document', family: 'sky' });
  const embed = d.card(sx(3), rowY(L1, 0), C, CH, { title: 'Embed', sub: '1,024-d vectors', glyph: 'cpu', family: 'sky' });
  const index = d.card(sx(4), rowY(L1, 0), C, CH, { title: 'Vector + BM25', sub: 'HNSW and keyword index', icon: aws('svc-analytics/amazon-opensearch-service') });
  d.sticky(sx(5) + (C + SG) / 2, rowY(L1, 0) - 18, C * 2 + SG, CH + 36, 'Hybrid beats either alone: vectors find paraphrases, BM25 finds exact part numbers and error codes.', 'sky');

  d.zone(M, L2, laneW, zoneH(1), 'Answer · online, per question', 'violet');
  const ask = d.card(sx(0), rowY(L2, 0), C, CH, { title: 'Question', sub: 'With the chat history', glyph: 'chat', family: 'violet' });
  const rewrite = d.card(sx(1), rowY(L2, 0), C, CH, { title: 'Rewrite', sub: 'Standalone query', glyph: 'gear', family: 'violet' });
  const qembed = d.card(sx(2), rowY(L2, 0), C, CH, { title: 'Embed query', sub: 'Same model as the index', glyph: 'cpu', family: 'violet' });
  const retrieve = d.card(sx(3), rowY(L2, 0), C, CH, { title: 'Retrieve', sub: 'Hybrid, top 40', glyph: 'database', family: 'violet' });
  const rerank = d.card(sx(4), rowY(L2, 0), C, CH, { title: 'Re-rank', sub: 'Cross-encoder, keep 6', glyph: 'sort', family: 'violet' });
  const assemble = d.card(sx(5), rowY(L2, 0), C, CH, { title: 'Assemble', sub: 'System, sources, question', glyph: 'document', family: 'violet' });
  const generate = d.card(sx(6), rowY(L2, 0), C, CH, { title: 'Generate', sub: 'LLM, streamed', icon: aws('svc-artificial-intelligence/amazon-bedrock') });
  const guard = d.card(sx(7), rowY(L2, 0), C, CH, { title: 'Guardrails', sub: 'PII and grounding check', glyph: 'shield', family: 'violet' });

  [ask, rewrite, qembed, retrieve, rerank, assemble, generate, guard].forEach((card, i) => d.step(card, i + 1));

  d.wire(docs, parse, 'data');
  d.wire(parse, chunk, 'data');
  d.wire(chunk, embed, 'data');
  d.wire(embed, index, 'data');
  d.wire(ask, rewrite, 'call');
  d.wire(rewrite, qembed, 'call');
  d.wire(qembed, retrieve, 'call');
  d.wire(index, retrieve, 'data', { label: 'top 40' });
  d.wire(retrieve, rerank, 'data');
  d.wire(rerank, assemble, 'data', { label: '6 chunks' });
  d.wire(assemble, generate, 'call');
  d.wire(generate, guard, 'data');
  d.wire(embed, qembed, 'control', { label: 'same model' });

  // Evaluate and improve ------------------------------------------------------------
  const eW = C * 2 + SG + ZP * 2;
  const eX = W - M - eW;
  d.zone(eX, BY, eW, BH, 'Evaluate & improve', 'amber');
  const e1 = sx(6);
  const e2 = sx(7);
  const feedback = d.card(e2, rowY(BY, 0), C, CH, { title: 'Feedback', sub: 'Thumbs, edits, escalations', glyph: 'chat', family: 'amber' });
  const golden = d.card(e1, rowY(BY, 0), C, CH, { title: 'Eval set', sub: '400 golden Q&A pairs', glyph: 'document', family: 'amber' });
  const traces = d.card(e2, rowY(BY, 1), C, CH, { title: 'Traces', sub: 'Every stage, timed', icon: aws('svc-developer-tools/aws-x-ray') });
  const evals = d.card(e1, rowY(BY, 1), C, CH, { title: 'Nightly evals', sub: 'Faithfulness, recall@6', glyph: 'activity', family: 'amber' });
  d.wire(guard, feedback, 'loop', { label: 'answer + citations', routing: 'orthogonal' });
  d.wire(feedback, golden, 'data');
  d.wire(golden, evals, 'data');
  d.wire(traces, evals, 'data');
  d.wire(evals, assemble, 'loop', { label: 'tune the prompt', from: 'left', to: 'bottom', routing: 'orthogonal', at: 0.8 });

  // The prompt, and what each stage costs ---------------------------------------------
  const pX = M;
  const pW = 720;
  d.panel(pX, BY, pW, BH, 'The prompt', '🧩', 'Sources are numbered so the answer can cite them');
  d.code(pX + 24, BY + 24, pW - 48, PROMPT, 'python', { filename: 'prompt.py', fontSize: codeFont });

  const kX = pX + pW + 56;
  const kW = eX - 56 - kX;
  d.panel(kX, BY, kW, BH, 'Latency and cost per stage', '⏱️', 'p50 per question, and dollars per 1,000 questions');
  const rowH = (BH - 48) / 8;
  const tableW = Math.round(kW * 0.5);
  const cost = d.table(kX + 24, BY + 24, tableW, {
    header: true,
    theme: 'clean',
    fontSize: 12.5,
    currency: '$',
    columns: [
      { width: 1.3, type: 'text' },
      { width: 0.8, type: 'number' },
      { width: 0.9, type: 'currency' },
    ],
    cells: [
      ['Stage', 'p50 ms', '$ / 1k'],
      ['Rewrite', '180', '0.60'],
      ['Embed query', '25', '0.01'],
      ['Retrieve', '40', '0.10'],
      ['Re-rank', '120', '2.00'],
      ['Generate', '1900', '12.75'],
      ['Guardrails', '150', '0.40'],
    ],
    summary: [null, 'sum', 'sum'],
  }, rowH);
  d.chart(
    kX + 24 + tableW + 24,
    BY + 24,
    kW - tableW - 72,
    BH - 48,
    plot('barHorizontal', {
      title: 'p50 latency, ms',
      categories: ['Rewrite', 'Embed query', 'Retrieve', 'Re-rank', 'Generate', 'Guardrails'],
      series: [{ name: 'p50 ms', values: [180, 25, 40, 120, 1900, 150] }],
      showValues: true,
      valuePrefix: '',
      valueSuffix: '',
      showLegend: false,
      link: { tableId: cost.id as string, r0: 0, c0: 0, r1: 6, c1: 1, header: true },
    })
  );

  return d.nodes();
}

// ---------------------------------------------------------------------------
// 6. Payments
// ---------------------------------------------------------------------------

function payments() {
  const d = new Draft();
  const W = 2240;
  const ZT = 288;
  const C = 232;
  const SG = (W - M * 2 - ZP * 2 - C * 7) / 6;
  const sx = (i: number) => M + ZP + i * (C + SG);
  const aH = zoneH(2);
  const bY = ZT + aH + ZG;
  const bH = zoneH(1);
  const cY = bY + bH + 96;
  const ledgerRows = 8;
  const cH = 24 + (ledgerRows + 1) * 32 + 24;
  const H = cY + cH + M;

  d.board(W, H, 'Payments system', '💳', 'A card payment from checkout to the issuing bank, and the books that prove it');
  d.header(
    M,
    M,
    W - M * 2,
    152,
    'Payments system design',
    'One card payment, Stripe-style: authorised through the card network, written to a double-entry ledger, announced by webhook and reconciled against the settlement file.',
    ['call', 'data', 'event', 'fail'],
    'Numbered steps follow one charge'
  );

  d.zone(M, ZT, W - M * 2, aH, 'Authorise', 'indigo');
  const checkout = d.card(sx(0), rowY(ZT, 0), C, CH, { title: 'Checkout', sub: 'Card tokenised in the browser', glyph: 'browser', family: 'indigo' });
  const idem = d.card(sx(1), rowY(ZT, 0), C, CH, { title: 'Idempotent API', sub: 'Key → saved response, 24 h', icon: aws('svc-networking-content-delivery/amazon-api-gateway') });
  const pay = d.card(sx(2), rowY(ZT, 0), C, CH, { title: 'Payment service', sub: 'PaymentIntent states', glyph: 'gear', family: 'indigo' });
  const risk = d.card(sx(3), rowY(ZT, 0), C, CH, { title: 'Risk scoring', sub: 'ML fraud score, 3DS rules', glyph: 'shield', family: 'indigo' });
  const acquirer = d.card(sx(4), rowY(ZT, 0), C, CH, { title: 'Acquirer', sub: 'ISO 8583 to the network', glyph: 'server', family: 'indigo' });
  const network = d.card(sx(5), rowY(ZT, 0), C, CH, { title: 'Card network', sub: 'Visa, Mastercard', glyph: 'globe', family: 'indigo' });
  const issuer = d.card(sx(6), rowY(ZT, 0), C, CH, { title: 'Issuing bank', sub: 'Approves or declines', glyph: 'wallet', family: 'indigo' });
  const declined = d.card(sx(0), rowY(ZT, 1), C, CH, { title: 'Show the decline', sub: 'card_declined', glyph: 'cross', family: 'rose', dashed: true });
  d.sticky(sx(3), rowY(ZT, 1) - 6, C + SG + 90, CH + 12, 'Retry with the same key: never a double charge.', 'yellow');

  [checkout, idem, pay, risk, acquirer, network, issuer].forEach((card, i) => d.step(card, i + 1));

  d.wire(checkout, idem, 'call', { label: 'POST' });
  d.wire(idem, pay, 'call');
  d.wire(pay, risk, 'call');
  d.wire(risk, acquirer, 'call', { label: 'allow' });
  d.wire(acquirer, network, 'call');
  d.wire(network, issuer, 'call', { label: 'auth request' });
  d.wire(issuer, declined, 'fail', { label: 'declined', from: 'bottom', to: 'top' });
  d.wire(pay, idem, 'fail', { label: 'retry' });

  // Record, notify, reconcile: each zone sits under the step that feeds it ---------------
  const zl = (i: number) => sx(i) - 16;
  const zr = (i: number) => sx(i) + C + 16;
  d.zone(zl(0), bY, zr(1) - zl(0), bH, 'Notify', 'violet');
  const merchant = d.card(sx(0), rowY(bY, 0), C, CH, { title: 'Merchant server', sub: 'Fulfils the order', glyph: 'server', family: 'violet' });
  const hooks = d.card(sx(1), rowY(bY, 0), C, CH, { title: 'Webhooks', sub: 'Signed, retried for 3 days', glyph: 'mail', family: 'violet' });
  d.zone(zl(2), bY, zr(3) - zl(2), bH, 'Record', 'teal');
  const ledger = d.card(sx(2), rowY(bY, 0), C, CH, { title: 'Ledger service', sub: 'Double-entry, append-only', glyph: 'document', family: 'teal' });
  const ledgerDb = d.card(sx(3), rowY(bY, 0), C, CH, { title: 'Ledger DB', sub: 'Aurora Postgres', icon: aws('svc-databases/amazon-aurora') });
  d.zone(zl(5), bY, zr(6) - zl(5), bH, 'Reconcile', 'amber');
  const recon = d.card(sx(5), rowY(bY, 0), C, CH, { title: 'Reconciliation', sub: 'Ledger vs settlement file', glyph: 'sort', family: 'amber' });
  const breaks = d.card(sx(6), rowY(bY, 0), C, CH, { title: 'Breaks queue', sub: 'Finance reviews these', glyph: 'cross', family: 'rose', dashed: true });

  d.wire(pay, ledger, 'data', { label: 'post entries' });
  d.wire(ledger, ledgerDb, 'data');
  d.wire(pay, hooks, 'event', { label: 'payment_intent.succeeded' });
  d.wire(hooks, merchant, 'event', { label: 'POST' });
  d.wire(merchant, hooks, 'fail', { label: '5xx' });
  d.wire(acquirer, recon, 'data', { label: 'settlement file, T+1' });
  d.wire(recon, breaks, 'fail', { label: 'mismatch' });

  // The books, and the states a payment moves through -----------------------------------
  const lW = 820;
  d.panel(M, cY, lW, cH, 'The ledger for one $100 charge', '📒', 'Every movement is two lines that cancel out; the totals must always match');
  d.table(M + 24, cY + 24, lW - 48, {
    header: true,
    theme: 'clean',
    fontSize: 12.5,
    currency: '$',
    columns: [
      { width: 0.8, type: 'text' },
      { width: 2, type: 'text' },
      { width: 0.9, type: 'currency' },
      { width: 0.9, type: 'currency' },
    ],
    cells: [
      ['Event', 'Account', 'Debit', 'Credit'],
      ['Capture', 'Receivable from network', '100.00', ''],
      ['Capture', 'Merchant balance', '', '96.80'],
      ['Capture', 'Fee revenue (2.9% + 30¢)', '', '3.20'],
      ['Settle', 'Cash at bank', '100.00', ''],
      ['Settle', 'Receivable from network', '', '100.00'],
      ['Payout', 'Merchant balance', '96.80', ''],
      ['Payout', 'Cash at bank', '', '96.80'],
    ],
    summary: [null, null, 'sum', 'sum'],
  }, 32);

  const smX = M + lW + 56;
  const smW = W - M - smX;
  d.panel(smX, cY, smW, cH, 'PaymentIntent states', '🔁', 'Every payment is in exactly one of these');
  const STATES = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'succeeded'];
  const SGAP = 40;
  const stW = (smW - 48 - SGAP * (STATES.length - 1)) / STATES.length;
  const sy = cY + 40;
  const states = STATES.map((s, i) => d.chip(smX + 24 + i * (stW + SGAP), sy, stW, 44, s.replace(/_/g, ' '), i === STATES.length - 1 ? 'green' : 'indigo'));
  states.slice(1).forEach((chip, i) => d.wire(states[i], chip, 'call', { from: 'right', to: 'left' }));
  const canceled = d.chip(smX + 24 + 2 * (stW + SGAP), sy + 104, stW, 44, 'canceled', 'rose');
  d.wire(states[2], canceled, 'fail', { label: '3DS failed' });
  d.wire(states[3], states[0], 'loop', { label: 'declined', from: 'bottom', to: 'bottom', routing: 'curved' });
  d.callout(
    smX + 24,
    sy + 180,
    smW - 48,
    'Why idempotency keys',
    'A phone on a train sends “charge $100”, the response is lost, and the app sends it again. With the same Idempotency-Key, the second request returns the first response instead of charging a second time.',
    'indigo'
  );

  return d.nodes();
}

// ---------------------------------------------------------------------------
// 7. Kubernetes production cluster
// ---------------------------------------------------------------------------

const K8S_YAML = `# Deployment/api, the parts that matter here
spec:
  template:
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector: { matchLabels: { app: api } }
      containers:
        - name: api
          resources:
            requests: { cpu: 500m, memory: 512Mi }
          envFrom:
            - configMapRef: { name: api-config }
            - secretRef: { name: api-secrets }
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: api }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: api }
  minReplicas: 3
  maxReplicas: 30
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 70 }`;

function kubernetes() {
  const d = new Draft();
  const ZT = 288;

  // The cluster: workloads across the top, one row per availability zone below.
  const KC = 236; // a workload column
  const KG = 24;
  const LBL = 132; // the zone label column
  const NODE = 220; // the node column
  const AZR = 76; // an availability-zone row
  const AZG = 16;
  const edgeX = M;
  const clX = edgeX + zoneW + ZG;
  const kx = (i: number) => clX + ZP + LBL + KG + i * (KC + KG);
  const nodeX = kx(4);
  const clW = nodeX + NODE + ZP - clX;
  const opsX = clX + clW + ZG;
  const W = opsX + zoneW + M;
  const wlY = ZT + ZH;
  const azY = (z: number) => wlY + CH + 24 + z * (AZR + AZG);
  const clH = azY(3) - AZG + 28 - ZT;

  // Below: the GitOps loop, the manifests, and a day of the autoscaler.
  const bY = ZT + clH + 96;
  const codeFont = 11;
  const bH = Math.max(zoneH(3), codeHeight(K8S_YAML, codeFont) + 48);
  const H = bY + bH + M;

  d.board(W, H, 'Kubernetes in production', '☸️', 'One region, three zones, and the loops that keep it the way Git says');
  d.header(
    M,
    M,
    W - M * 2,
    152,
    'A production Kubernetes cluster',
    'Traffic enters through a load balancer and ingress, every workload is spread across three zones, the autoscaler follows load, and Argo CD keeps the cluster equal to Git.',
    ['call', 'data', 'control', 'loop'],
    'Numbered steps follow one request'
  );

  // The edge --------------------------------------------------------------------------
  d.zone(edgeX, ZT, zoneW, clH, 'Edge', 'slate');
  const eStep = (clH - ZH - 28 - CH * 3) / 2;
  const ey = (r: number) => ZT + ZH + r * (CH + eStep);
  // Bottom to top, so the ingress sits level with the workloads it routes to.
  const users = d.card(edgeX + ZP, ey(2), CW, CH, { title: 'Users', sub: 'HTTPS to api.acme.com', glyph: 'globe', family: 'slate' });
  const lb = d.card(edgeX + ZP, ey(1), CW, CH, { title: 'Load balancer', sub: 'AWS NLB in three zones', icon: aws('svc-networking-content-delivery/elastic-load-balancing') });
  const ingress = d.card(edgeX + ZP, ey(0), CW, CH, { title: 'Ingress', sub: 'ingress-nginx, by host and path', icon: k8s('resources/ingress') });

  // The cluster -------------------------------------------------------------------------
  d.zone(clX, ZT, clW, clH, 'Cluster · eu-west-1', 'blue');
  const WL: Array<{ title: string; sub: string; icon: string; family: Family; pods: string[][] }> = [
    { title: 'web', sub: 'Deployment, 3 replicas', icon: 'resources/deployment', family: 'sky', pods: [['web-7f9c'], ['web-2kx8'], ['web-q4m1']] },
    { title: 'api', sub: 'Deployment, HPA 3–30', icon: 'resources/deployment', family: 'violet', pods: [['api-6d8a', 'api-6d8b'], ['api-9c1e', 'api-9c1f'], ['api-4b7d', 'api-4b7e']] },
    { title: 'worker', sub: 'Deployment, async jobs', icon: 'resources/deployment', family: 'amber', pods: [['worker-1'], [], ['worker-2']] },
    { title: 'postgres', sub: 'StatefulSet, gp3 disks', icon: 'resources/statefulset', family: 'green', pods: [['postgres-0 · primary'], ['postgres-1 · replica'], []] },
  ];
  const workloads = WL.map((w, i) => d.card(kx(i), wlY, KC, CH, { title: w.title, sub: w.sub, icon: k8s(w.icon) }));
  const nodes = ['a', 'b', 'c'].map((zone, z) => {
    d.band(clX + ZP, azY(z), clW - ZP * 2, AZR, 'blue', 0.08);
    d.chip(clX + ZP + 12, azY(z) + (AZR - 32) / 2, LBL - 12, 32, `eu-west-1${zone}`, 'blue');
    WL.forEach((w, i) => {
      const pods = w.pods[z];
      const pw = (KC - 8 * (pods.length - 1)) / Math.max(1, pods.length);
      pods.forEach((p, k) => d.chip(kx(i) + k * (pw + 8), azY(z) + (AZR - 34) / 2, pw, 34, p, w.family));
    });
    return d.card(nodeX, azY(z) + 6, NODE, AZR - 12, { title: `ip-10-0-${z + 1}-23`, sub: 'm6i.xlarge, 4 vCPU', icon: k8s('infrastructure/node') });
  });
  const [web, api, , postgres] = workloads;

  // Operate -------------------------------------------------------------------------------
  d.zone(opsX, ZT, zoneW, clH, 'Operate', 'teal');
  const oStep = (clH - ZH - 28 - CH * 4) / 3;
  const oy = (r: number) => ZT + ZH + r * (CH + oStep);
  const hpa = d.card(opsX + ZP, oy(0), CW, CH, { title: 'HPA', sub: 'Holds CPU near 70%', icon: k8s('resources/horizontalpodautoscaler') });
  const pvc = d.card(opsX + ZP, oy(1), CW, CH, { title: 'PVC data-postgres-0', sub: '100 GiB gp3, zone-pinned', icon: k8s('resources/persistentvolumeclaim') });
  d.card(opsX + ZP, oy(2), CW, CH, { title: 'ConfigMap + Secret', sub: 'api-config, api-secrets', icon: k8s('resources/configmap') });
  const obs = d.card(opsX + ZP, oy(3), CW, CH, { title: 'Prometheus + Grafana', sub: 'Metrics, Loki logs, alerts', icon: aws('svc-management-tools/amazon-managed-service-for-prometheus') });

  [users, lb, ingress, web, api].forEach((card, i) => d.step(card, i + 1));
  d.wire(users, lb, 'call');
  d.wire(lb, ingress, 'call');
  d.wire(ingress, web, 'call', { label: '/' });
  d.wire(ingress, api, 'call', { label: '/api', to: 'top' });
  d.wire(hpa, api, 'control', { label: 'scales', to: 'top' });
  d.wire(pvc, postgres, 'data', { label: 'mounted' });
  d.wire(obs, nodes[2], 'data', { label: 'scrape' });

  // GitOps ---------------------------------------------------------------------------------
  const goW = CW * 2 + ZG + ZP * 2;
  d.zone(M, bY, goW, bH, 'GitOps loop', 'violet');
  const gx = (i: number) => M + ZP + i * (CW + ZG);
  const repo = d.card(gx(0), rowY(bY, 0), CW, CH, { title: 'infra repo', sub: 'Manifests, reviewed in PRs', glyph: 'document', family: 'violet' });
  const argo = d.card(gx(1), rowY(bY, 0), CW, CH, { title: 'Argo CD', sub: 'Syncs every 3 minutes', glyph: 'gear', family: 'violet' });
  const apiServer = d.card(gx(1), rowY(bY, 1), CW, CH, { title: 'API server', sub: 'EKS control plane, etcd', icon: k8s('control-plane/api-server') });
  const scheduler = d.card(gx(1), rowY(bY, 2), CW, CH, { title: 'Scheduler', sub: 'Places pods across zones', icon: k8s('control-plane/scheduler') });
  d.wire(repo, argo, 'data', { label: 'watch' });
  d.wire(argo, apiServer, 'control', { label: 'apply' });
  d.wire(apiServer, argo, 'loop', { label: 'live state' });
  d.wire(apiServer, scheduler, 'call');
  d.sticky(
    gx(0),
    rowY(bY, 1),
    CW,
    bH - (rowY(bY, 1) - bY) - 28,
    'Drift is a diff. Someone runs kubectl edit in production; Argo CD sees live state no longer matches Git and puts it back.',
    'lavender'
  );

  const yX = M + goW + ZG;
  const yW = 520;
  d.panel(yX, bY, yW, bH, 'api.yaml', '📄', 'The Deployment and its autoscaler, as the cluster reads them');
  d.code(yX + 24, bY + 24, yW - 48, K8S_YAML, 'yaml', { filename: 'api.yaml', fontSize: codeFont, highlights: [5, 6, 7, 23, 24, 29] });

  const cX = yX + yW + ZG;
  const cW = W - M - cX;
  d.panel(cX, bY, cW, bH, 'A day of api', '📈', 'Replicas follow CPU: the HPA adds pods as load climbs');
  d.chart(
    cX + 24,
    bY + 24,
    cW - 48,
    bH - 48,
    plot('bar', {
      title: 'Replicas and CPU through one day',
      categories: ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'],
      series: [
        { name: 'Replicas', values: [3, 3, 4, 9, 14, 12, 16, 7], mark: 'bar' },
        { name: 'CPU %', values: [41, 38, 55, 72, 69, 71, 74, 60], mark: 'line', axis: 'right' },
      ],
      showLegend: true,
      valuePrefix: '',
      valueSuffix: '',
    })
  );

  return d.nodes();
}

export const SYSTEMS: Template[] = [
  {
    id: 'systems-youtube',
    category: 'systems',
    name: 'How YouTube works',
    blurb: 'From one upload to a ladder of encodings in your ISP’s cache, and the loop that picks what plays next.',
    teaches: ['Cloud icons', 'Linked chart', 'Routed connectors'],
    tags: ['video', 'streaming', 'cdn', 'transcoding', 'recommendations', 'gcp', 'system design'],
    accent: 'rose',
    featured: true,
    build: youtube,
  },
  {
    id: 'systems-netflix',
    category: 'systems',
    name: 'How Netflix streams',
    blurb: 'The control plane on AWS, Open Connect servers inside ISPs, and a timeline of the seconds after you press play.',
    teaches: ['AWS icons', 'Swimlane timeline', 'Frames'],
    tags: ['netflix', 'cdn', 'open connect', 'microservices', 'chaos engineering', 'aws', 'drm', 'system design'],
    accent: 'rose',
    build: netflix,
  },
  {
    id: 'systems-github-actions',
    category: 'systems',
    name: 'GitHub Actions CI/CD',
    blurb: 'A pull request through lint, types and a six-way matrix, then main through staging, approval and rollback.',
    teaches: ['Code block', 'Status table', 'Decision shapes'],
    tags: ['ci', 'cd', 'github', 'devops', 'pipeline', 'yaml', 'deployment', 'oidc'],
    accent: 'blue',
    build: githubActions,
  },
  {
    id: 'systems-data-platform',
    category: 'systems',
    name: 'A modern data platform',
    blurb: 'Postgres CDC, Stripe and product events into a bronze, silver and gold lakehouse, then out to BI, reverse ETL and ML.',
    teaches: ['Tables', 'Lineage chips', 'AWS icons'],
    tags: ['data engineering', 'lakehouse', 'dbt', 'kafka', 'etl', 'medallion', 'snowflake', 'analytics'],
    accent: 'amber',
    build: dataPlatform,
  },
  {
    id: 'systems-rag',
    category: 'systems',
    name: 'RAG application architecture',
    blurb: 'Indexing, hybrid retrieval, re-ranking and a grounded, cited answer, with the eval loop and what every stage costs.',
    teaches: ['Linked chart', 'Code block', 'Pipelines'],
    tags: ['ai', 'llm', 'rag', 'retrieval', 'embeddings', 'vector database', 'evals', 'prompt'],
    accent: 'violet',
    featured: true,
    build: rag,
  },
  {
    id: 'systems-payments',
    category: 'systems',
    name: 'Payments system design',
    blurb: 'A card payment from checkout to the issuing bank, with idempotency, a double-entry ledger, webhooks and reconciliation.',
    teaches: ['Failure paths', 'Ledger table', 'State machine'],
    tags: ['payments', 'stripe', 'fintech', 'ledger', 'idempotency', 'webhooks', 'system design'],
    accent: 'indigo',
    build: payments,
  },
  {
    id: 'systems-kubernetes',
    category: 'systems',
    name: 'Kubernetes in production',
    blurb: 'Ingress to pods across three zones, autoscaling, storage, observability, and Argo CD keeping it all in Git.',
    teaches: ['Kubernetes icons', 'Combo chart', 'Code block'],
    tags: ['kubernetes', 'k8s', 'devops', 'gitops', 'argo cd', 'hpa', 'eks', 'platform'],
    accent: 'blue',
    build: kubernetes,
  },
];
