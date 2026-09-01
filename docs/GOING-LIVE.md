# Going live: risks, authentication, and a $0 deployment

Written 2026-08-28, at the end of the session that hardened the server. This is
the forward-looking companion to two documents that describe what *exists*:

- `docs/DEPLOYMENT.md` — how the server is configured and operated today.
- `HANDOFF.md` §4f — what was wrong with it and what was fixed.

This one is about what is **not** built yet: what will break when real people
use it, what authentication should look like, and how to put it on the internet
for nothing.

---

## 0. Start here

If you read nothing else, read this section.

**The app is live**: Vercel (`vscanva.vercel.app`) → Render
(`vega-canva.onrender.com`) → Neon Postgres → Cloudflare R2 → Sentry.
That changes the arithmetic below: every item is now carrying real data.

**Status as of 2026-09-01.**

| # | Item | State |
| --- | --- | --- |
| 1 | Upload quotas (§1.1) | **Done.** Per-room 200 MB, per-IP daily 500 MB, global 10 GB, enforced with 413. A failed upload deletes its object and row. |
| 2 | Dashboard bundle preload (§1.2) | **Done.** `modulePreload.resolveDependencies` cut the eager preload set to three chunks; verified in `dist/index.html`. |
| 3 | Room & media reaper (§1.3) | **Written, deliberately unscheduled.** Read `DEPLOYMENT.md` §7.2 before running it once, let alone on a timer. |
| 4 | Error tracking (§1.4) | **Done, and it was not before.** See below. |
| 5 | Database backups (§1.5) | **Built, not yet proven.** Nightly dump to R2 (`BACKUP-AND-RESTORE.md`), round-trip verified on PG 17. Needs its secrets and one manual run. |

### What "error tracking" meant until today

`SENTRY_DSN` was set on Render and `VITE_SENTRY_DSN` on Vercel, and both
`observability.ts` files did this:

```ts
if (dsn) {
  logger.info('Sentry error tracking enabled for server');
  // If Sentry Node SDK is installed in production, it initializes here.
}
```

No SDK was installed in either app — `@sentry/node` and `@sentry/react` were
absent from both `package.json` files. So the deployment logged a line saying
error tracking was on, and reported nothing, for as long as it has been live.
The log line was the one piece of evidence anybody would have checked.

Both are wired properly now. The client loads the SDK by dynamic `import()`
rather than statically, because statically it put 28 kB gzipped into the entry
chunk — sixfold growth on the eagerly-loaded entry, undoing much of item 2 —
and it only showed up in a build that *had* the DSN set, so a local build
looked free. Errors thrown before the SDK arrives are buffered and flushed.

`/readyz` now reports `errorTracking: true|false` from whether `init` actually
returned, not from whether a DSN was set. **Trust that field, not a log line.**

### Do this next

**Set the five repository secrets and run the backup workflow once by hand**
(Actions → Database backup → Run workflow, `dry_run` first). Until that has
happened, recovery is Neon's 6-hour history window and nothing else — and a
bad write found the next morning is outside it.

`docs/BACKUP-AND-RESTORE.md` lists the secrets and the restore procedure.

Everything after that is genuinely optional until you have users.

---

## 1. What will actually hurt you

Ranked by "how likely is this to ruin a week", not by how interesting it is.

### 1.1 You are about to run an open file host

**This is the biggest risk of a public launch and it is not in `DEPLOYMENT.md`.**

The upload route is `POST /rooms/:roomId/media` (`apps/server/src/index.ts:274`).
What limits exist:

- 50MB per file (`index.ts:205`)
- A token bucket of 30 uploads burst, 1/sec sustained, **per IP**
- An allow-list of image and audio types

What does not exist: any cap on total bytes per room, per user, per day, or in
total. There is no account, so there is nobody to hold responsible. Anyone who
finds the endpoint has unlimited anonymous storage behind your domain.

This is not hypothetical. It happens to every open uploader that gets any
attention, and on a free tier you will find out about it via a suspension
email rather than a graph.

**The fix, concretely.** You are already recording `size_bytes` and `room_id` in
`media_refs` (`index.ts:311`), and migration 2 added `media_refs_room_id_idx`,
so the query is cheap:

```sql
SELECT COALESCE(SUM(size_bytes), 0) FROM media_refs WHERE room_id = $1;
```

Enforce, before accepting the upload:

- **Per room:** a hard ceiling (start at 200MB — generous for a real board,
  useless as free hosting).
- **Per IP per day:** a second ceiling on bytes, not just request count. The
  rate limiter caps requests per second, which does nothing against thirty
  50MB files spread across a day.
- **Global:** a total-bytes kill switch, so a bug or an attack cannot silently
  fill the disk. Refuse new uploads and log loudly.

Return `413` with a message that says which limit was hit. `media_refs` also
needs a row deleted when an upload fails after the object is written, or the
accounting drifts upward forever.

**Do this before you share the link.**

### 1.2 The dashboard downloads the entire editor

Measured at the end of this session: **919kB raw across 7 files, eagerly
preloaded on first paint**, including `vendor-konva` (~300kB), `app-export`
(~430kB) and `vendor-motion` (~120kB). None of that is needed to render the
board list. On a phone on mobile data it is the first impression.

Investigated but deliberately not fixed, because it needs measuring rather than
guessing:

- There is **no static import path from `App.tsx` to Konva, framer-motion or the
  export engine.** The entry's own module graph is 18 modules reaching only
  react, zustand, nanoid and rbush. This was verified with a tracer.
- So the preloads come from Vite/rolldown emitting `modulepreload` for the
  dependency chunks of the *dynamically* imported routes. That is a deliberate
  optimisation — it makes opening a board instant — and it makes the dashboard
  pay for it.
- Removing the `app-export` manual chunk was tried and measured **worse** (967kB
  eager: the code redistributes into `vendor-konva`, which grows 302 → 480kB, and
  `app-physics`, 90 → 286kB). The grouping is doing real work.

**Next step when you pick this up:** try `build.modulePreload.resolveDependencies`
to filter route-chunk dependencies out of the entry's preload set, and measure
both the dashboard's eager bytes *and* the time-to-interactive of opening a board.
The trade is real; do not optimise one and call it done. Accounting method:

```python
# from apps/frontend, after `npm run build`
import re, os
html = open('dist/index.html', encoding='utf-8').read()
names = re.findall(r'assets/([^"]+\.js)', html)
print(sum(os.path.getsize(f'dist/assets/{n}') for n in names) // 1024, 'kB eager')
```

### 1.3 Nothing is ever deleted, and boards grow forever

Two separate problems that get conflated.

**Storage never shrinks.** No room TTL, no S3 lifecycle policy, no orphaned-media
reaping. `rooms.last_active_at` is written on every snapshot and read by
nothing. Migration 2 added `rooms_last_active_idx` specifically so a reaper
would have its index; the reaper does not exist. On a 10GB free tier this is
weeks, not months.

A reaper needs to, in one transaction per room: delete the S3 objects listed in
`media_refs` for that room, then delete the `rooms` row (which cascades to
`room_snapshots`, `room_updates` and `media_refs`). Order matters — delete the
objects first, because a failed object delete after the row is gone leaves an
orphan nothing knows about.

**A single board grows forever.** Distinct and more subtle. A Yjs document
accumulates structural history for its entire life. `room_updates` is bounded by
retention, but `room_snapshots.state` is the whole document and only ever gets
larger. There is currently **no story for a board that has been edited daily for
a year**: it gets slower to load and heavier to sync, for everyone who joins,
with no bound. Nobody has hit this because no board is old yet.

Worth investigating when it matters: periodic compaction into a fresh `Y.Doc`,
accepting that it breaks Time Travel across the compaction boundary — the same
trade `replay_base` already makes for the update log.

### 1.4 There is no observability

Confirmed by search: no Sentry, no PostHog, no OpenTelemetry, no metrics, in
either workspace. Errors go to `console.error` and into a container log that
nothing reads.

The moment this is live and somebody says "it broke", you will have nothing.
Sentry's free tier on both the client and the server is about an hour of work
and is the difference between debugging and guessing.

Add, at minimum:

- Client: Sentry with the release tagged, so a stack trace maps to source.
- Server: Sentry, plus structured JSON logs instead of `console.*` so they are
  greppable when a platform aggregates them.
- The `/readyz` payload already reports `historyQueue` and `historyDropped` —
  scrape those. A rising queue is the first sign the database is struggling.

### 1.5 Backups

Repeated from `DEPLOYMENT.md` §7 because it is the largest single risk in the
system and repetition is warranted.

`room_snapshots` holds the canonical state of every board, is overwritten in
place, and has no versioning. A bad write is unrecoverable except partially,
from `room_updates` plus `replay_base`. Nothing in this repository configures
point-in-time recovery.

Whichever Postgres you pick in §3, **turn on PITR and test a restore once.** An
untested backup is a belief, not a backup.

---

## 2. Authentication and users

There is no auth today. The access model is: **the room id is the capability.**
Whoever holds it can open, edit, rename and delete. `onAuthenticate`
(`index.ts:540`) validates the id's shape and length and then returns success
unconditionally.

That model is legitimate — it is what "anyone with the link" does — and this
session closed the hole in it (it used to accept one-character room ids). What
it cannot do: revoke access, attribute an edit, or let somebody find their
boards from a second device.

Build it in three stages. **Stage 1 is the one people skip and shouldn't.**

### Stage 2.1 — Durable anonymous identity, no signup

Issue every visitor a signed JWT in an httpOnly, SameSite=Lax cookie carrying a
stable `userId`. No login screen. No product change. Nobody notices it happened.

What it buys, immediately:

- **Presence you can trust.** Today `onAuthenticate` mints a server-side id and
  then discards it — display names come from client-set Yjs awareness, so
  anybody can appear as anybody. With a server-asserted identity, the name in
  the corner means something.
- **Rate limiting per user rather than per IP.** IP-based limiting is broken
  behind CGNAT and mobile networks: it throttles a whole office together and
  lets one person with a phone reset their bucket at will.
- **Abuse traceability.** You can ban an uploader. Without this, §1.1 has no
  enforcement mechanism beyond IP, which is not one.
- **A migration path.** When somebody later signs up, you claim the anonymous
  id rather than orphaning everything they made. Doing this *after* accounts
  exist means writing a merge tool; doing it now means a foreign key.

Sketch:

```text
users(id, created_at, is_anonymous, email NULL, display_name, color)
```

The WebSocket handshake already passes a token to `onAuthenticate` — that is
where the JWT gets verified. The REST routes read the same cookie.

**Effort: small. Value: high. Do this first.**

### Stage 2.2 — Real accounts: magic link and OAuth, no passwords

Do not build passwords. They mean hashing, reset flows, breach liability and
password-manager quirks, in exchange for zero product value. Email magic link
plus Google and GitHub OAuth covers effectively everyone.

**Do not roll this yourself.** The hidden cost is not the token logic, it is
email deliverability, and it will eat a week — SPF, DKIM, DMARC, and then
discovering your mail lands in spam for the one person you wanted to show.

Recommended: **Supabase Auth.** You are already on Postgres, the free tier is
generous, it issues a JWT you verify with a public key in `onAuthenticate`, and
it handles the OAuth dance and the email sending. The alternative worth a look
is Clerk or WorkOS, both of which have free tiers that get expensive at exactly
the point you would be pleased about it.

Whatever you pick, keep verification in one place server-side so there is a
single answer to "who is this connection".

### Stage 2.3 — Per-board authorization

```sql
boards(
  id            TEXT PRIMARY KEY,   -- the existing room id
  owner_id      UUID REFERENCES users(id),
  visibility    TEXT NOT NULL       -- 'private' | 'link' | 'public'
);

board_members(
  board_id  TEXT REFERENCES boards(id) ON DELETE CASCADE,
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL,          -- 'owner' | 'editor' | 'viewer'
  PRIMARY KEY (board_id, user_id)
);
```

Two design points that matter more than the schema:

**Keep link-sharing as an explicit visibility mode.** Do not delete the
capability model — it is genuinely good for throwing a board at someone in
Slack, and the room-code work from this session (`engine/room/roomCode.ts`) is
built for exactly that. Make it a *choice* (`visibility = 'link'`) rather than
the only behaviour. A board defaults to `private`; sharing a link flips it.

**Read-only must be enforced at the WebSocket layer.** A viewer role checked in
the client is decorative — the client can send any Yjs update it likes, and the
CRDT will merge it. Hocuspocus supports marking a connection read-only from
`onAuthenticate`; that is the only place it can be true. If you take one thing
from this section, take this one: it is the mistake that looks finished and
isn't.

Also gate the two REST routes on membership, not just on room shape: the history
endpoint (`index.ts:397`) currently hands the full board history to anybody who
asks, and the media proxy (`index.ts:331`) serves any object in any room.

### What this does *not* need

Roles beyond owner/editor/viewer. Organisations. SSO. Audit logs. Every one of
those is a real feature for a real customer who has asked for it, and pure cost
until then.

---

## 3. Deploying it for $0

**Verify current free-tier limits before committing.** These change constantly
and the information behind this table has a cutoff of May 2026.

| Layer | Recommendation | Why |
| --- | --- | --- |
| Frontend | **Cloudflare Pages** | Unlimited bandwidth on the free tier. For a static SPA this is genuinely free indefinitely. |
| Sync server | **Google Cloud Run** | Real free tier, supports WebSockets, scales to zero. Cold start on the first connection is the cost. |
| Postgres | **Neon** | Best free serverless Postgres. Also cold-starts, sub-second. |
| Object storage | **Cloudflare R2** | 10GB free and **zero egress**. S3-compatible, so the existing `@aws-sdk/client-s3` code works with an endpoint change. |
| Redis | Skip | Only needed for more than one instance. Run one. |
| Errors | **Sentry** free tier | Both ends. See §1.4. |

### Why R2 specifically

**Zero egress is the single most important free-tier property for this app.** A
canvas serves the same images over and over, and egress is what quietly ends
free tiers. R2 does not charge it. It is S3-compatible, so the change is
`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` and nothing else — the code
already speaks the protocol.

### The always-on problem

Cloud Run scaling to zero means the first person to open a board waits a second
or two for a cold start. For a realtime tool that is noticeable but tolerable.

If it bothers you:

- **Oracle Cloud Always Free** is the strongest genuine $0 option by a distance —
  an always-on ARM VM with resources that embarrass every other free tier. The
  catch is that account approval and capacity availability are a lottery, and
  you are now running a VM, which is a different kind of work.
- **Fly.io** is the pragmatic middle. Not strictly $0 any more, but a
  256MB always-on machine is a couple of dollars a month, and it is the least
  friction of anything here.
- **Render's free tier sleeps after 15 minutes** with a slow cold start. Fine
  for a demo link you send to three people; wrong for anything you want to be
  proud of.

### A consequence of this session's media change, stated honestly

Routing media through the API proxy — which is what made the bucket private and
put the security headers on the path that is actually used — means image bytes
now flow through the server's CPU and bandwidth instead of straight from
storage.

At your scale that is fine and it is the right trade. When bandwidth starts
mattering, the upgrade is **short-lived presigned URLs**: the API stays the
authorization point and issues a signed GET, but the bytes come direct from R2
and never touch your server. That requires the client to resolve a media id to
a URL at render time rather than storing an absolute URL in the document, which
is a real change — worth knowing it is the path rather than discovering it
under load. A CDN in front of the proxy is the cheaper interim step; the
`Cache-Control: immutable` header the proxy already sends is what makes it work.

### Environment mapping

`.env.example` at the repo root lists every variable with notes. For this stack:

```bash
NODE_ENV=production
POSTGRES_HOST / USER / PASSWORD / DB   -> from Neon
S3_ENDPOINT                            -> https://<account>.r2.cloudflarestorage.com
S3_ACCESS_KEY / S3_SECRET_KEY          -> R2 API token
S3_BUCKET                              -> your R2 bucket
ALLOWED_ORIGINS                        -> https://<your-pages-domain>
PUBLIC_API_URL                         -> https://<your-cloud-run-url>
TRUST_PROXY=1                          -> Cloud Run terminates TLS in front
```

The server refuses to start if any of the required ones are missing or left at a
development default, and prints every problem at once before exiting 78. That
is deliberate — see `apps/server/src/config.ts`.

### Before the first real deploy

- [ ] Run `apps/server/scripts/rewrite-media-urls.ts` if any board already has
      uploaded media (reports by default; `--apply` writes). Existing boards
      hold direct object-store URLs that 404 against a private bucket.
- [ ] Confirm `MIN_ROOM_ID_LENGTH` does not orphan boards you care about.
- [ ] Turn on PITR and **test a restore**.
- [ ] Set a billing alert on every account, even the free ones. Especially the
      free ones.

---

## 4. The strategic thing worth noticing

**The app already works with no server.** `IndexeddbPersistence`
(`apps/frontend/src/engine/document/doc.ts:74`) means a board is fully
functional offline, in the browser, alone. Most collaborative tools cannot say
that.

It means the single-player experience could ship on pure static hosting —
genuinely free, effectively infinite scale, no cold starts — with the server
being the thing that adds *collaboration and durability* rather than the thing
that makes the app work at all.

Right now that is true by accident. Making it true on purpose would be both a
better product and a cheaper one:

- A clear, honest offline state rather than an error.
- A "this board is local until you share it" mode, where the server is never
  contacted until somebody presses Share. That also removes most of §1.1's risk
  surface, because anonymous uploads only happen on shared boards.
- A story for the sync server being down that is "you can keep working" instead
  of "come back later".

This is the highest-leverage *product* idea in this document, as opposed to the
highest-leverage fixes, which are in §1.

---

## 5. Ordered plan

Ranked across all phases, so the numbers mean something globally rather than
restarting at each heading.

| # | Phase | Item | Ref |
| --- | --- | --- | --- |
| 1 | Blocking a public link | Upload quotas: per room, per IP per day, global kill switch | §1.1 |
| 2 | Blocking a public link | Sentry on client and server | §1.4 |
| 3 | Blocking a public link | Postgres PITR, and one tested restore | §1.5 |
| 4 | First week live | Durable anonymous identity | §2.1 |
| 5 | First week live | The room and media reaper | §1.3 |
| 6 | First week live | Billing alerts on every account, including the free ones | §3 |
| 7 | Once people use it | Real accounts: magic link plus OAuth | §2.2 |
| 8 | Once people use it | Per-board roles, enforced at the WebSocket layer | §2.3 |
| 9 | Once people use it | The bundle split, measured both ways | §1.2 |
| 10 | When it hurts | Redis-backed rate limiting, in the same change as a second instance | §3 |
| 11 | When it hurts | Presigned media URLs instead of proxying bytes | §3 |
| 12 | When it hurts | A compaction story for long-lived documents | §1.3 |

Items 1 to 3 are roughly one focused session together and none of them needs a
product decision from you. Everything from 4 onwards does, to some degree — see
§6.

---

## 6. Decisions that are yours, not mine

These need a product call before the work makes sense, and are worth thinking
about while the code is not being written:

- **Do boards stay anonymous?** Everything in §2 assumes you eventually want
  accounts. If the answer is "no, this is deliberately account-free forever",
  then §2.1 is still worth doing and §2.2–2.3 never happen — and §1.1's quotas
  become more important, not less, because IP is your only lever.

- **What happens to a board nobody has opened in a year?** The reaper needs a
  policy, and the policy is a promise to users. Deleting silently is hostile;
  keeping everything forever is what §1.3 is about.

- **Is Time Travel worth its cost?** It is the reason `room_updates` exists, the
  reason `onChange` fires per transaction, and a meaningful share of the
  database write load. It is also genuinely good. Worth knowing it is the most
  expensive feature in the system per unit of use.

- **Free forever, or a paid tier eventually?** This changes the auth answer. A
  product that will charge needs accounts early, because retrofitting identity
  onto anonymous data is the migration nobody enjoys.
