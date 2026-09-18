# Deployment, and what is still missing

This is the operational companion to `ARCHITECTURE.md`. It covers what the
server needs to run, the decisions that are already made for you, and — the
part worth reading before you commit to a launch date — what is still open.

**For what to build next, see `GOING-LIVE.md`**: the risks that block a public
launch, an authentication plan in three stages, and a $0 hosting stack.

---

## 1. The access model, stated once

**There are no accounts. The room id is the capability.** Whoever holds a
board's id can open it, edit it, rename it and delete what is on it. That is
the whole of the access control, and the share dialog says so in as many words.

This is a legitimate model — it is what a "anyone with the link" share does —
and it has exactly one hard requirement: *the id must be unguessable*. New
boards use `nanoid(10)`, which is sixty bits. The server refuses ids shorter
than `MIN_ROOM_ID_LENGTH` (default 8), because the previous validator accepted
a **one character** id and the library's join box passes a bare id straight
through, so short boards were easy to create by accident and trivial to
enumerate.

What the model cannot do, and what you are choosing when you ship it:

- **No revocation.** A link shared once is permanent access. There is no way to
  remove somebody from a board.
- **No audit.** Edits are attributed to a display name the client chooses.
- **Leakage is permanent.** Room ids travel in `Referer` headers, browser
  history, screenshots and chat logs, and any one of those is a working key.

### Invite links, and the half of the problem they solve

With `SHARE_SECRET` set, the share dialog can mint `/i/<token>` links carrying
a **signed** role. `onAuthenticate` verifies the signature, checks the token
was minted for *this* room, and sets `readOnly` from the role inside it. A
person holding a view link cannot promote it: the role is covered by the
signature, and the previous implementation — where `role` was a field the
client wrote and the server read back — is gone.

**Minting needs no permission, and that is correct.** A token is strictly less
than the room id it derives from, so anyone who can ask for one already has
everything it grants. Attenuating a capability you hold never needs authority.

What it does **not** do: a token names its room, because the client needs that
to open the document. Someone who reads it out of their own URL can connect the
ordinary way and get an editor session, because a bare room id still opens a
board. Closing that means **refusing unsigned connections**, which would break
every link already shared and the room-code join box with it. That is a product
decision and it has not been taken; until it is, an invite link is enforced
against the link, not against a determined holder. The share dialog says so in
those words.

Expiry is real — it is inside the signed payload — and it is the only
per-link control there is. Rotating `SHARE_SECRET` revokes every outstanding
invite at once, which is the only other revocation available.

`AUTH_SECRET` is a single shared token for the whole deployment. It is a front
door for a private instance and **not** authorization: it cannot express "this
person, this board". Do not mistake it for one.

Real per-board permissions mean accounts, a membership table, and a token on
the WebSocket handshake that `onAuthenticate` checks against it. That is a
product decision, not a configuration one.

---

## 2. Configuration

Copy `.env.example` to `.env` and fill it in. Under `NODE_ENV=production` the
server **refuses to start** if a required value is missing or is one of the
development credentials committed to this repository, and prints every problem
at once before exiting `78` (`EX_CONFIG`).

That refusal is the point. The previous behaviour was to fall back to
`canva_password` silently, so a deploy that forgot a variable came up healthy
on a password anybody could read on GitHub. A server that will not boot is a
page somebody fixes in five minutes.

| Variable | Required in production | Notes |
| --- | --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | yes | |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | yes | |
| `ALLOWED_ORIGINS` | yes | Comma separated. A leading-label wildcard is allowed for preview hosts (`https://*.vercel.app`); a bare `*` is not. Entries are compared as browsers spell an origin, so a trailing slash or a capital is forgiven. An entry that is not an origin fails at boot, naming itself. |
| `PUBLIC_API_URL` | yes | Written into documents as the address of uploaded media. Changing it later orphans media in boards written before the change. |
| `TRUST_PROXY` | if behind a proxy | Hop count. Wrong either way breaks rate limiting. |
| `REDIS_HOST` | only for >1 instance | Without it, instances share neither documents and awareness nor rate limits and IP quotas. |
| `SHARE_SECRET` | no | Signs invite links. Without it, only full-access links can be offered. Rotating it revokes every outstanding invite — the only revocation there is. |
| `AUTH_SECRET` | no | One shared token. Not authorization. The client sends it as `VITE_AUTH_SECRET`; set both or neither, or every client is refused. |
| `SENTRY_DSN` | no | Error tracking. `/readyz` reports `errorTracking` — trust that, not the log line. |
| `MIN_ROOM_ID_LENGTH` | no | Default 8. Lower only to keep older short-id boards reachable. |
| `HISTORY_FLUSH_MS` | no | Default 1000. See §4. |

On the frontend's host (Vercel):

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_API_URL` | yes | The sync server. Also what the share-card functions ask for a board's name and picture. |
| `VITE_SITE_URL` | in production | The site's own address, baked into `canonical`, `og:url`, `og:image` and `sitemap.xml` at build time. Defaults to `https://vscanva.vercel.app`; set it for any other domain, or every shared link points at the wrong host. |
| `SHARE_API_URL` | no | Overrides `VITE_API_URL` for the share functions alone, when the crawler-facing server is not the sync server. |

`docker-compose.yml` is **development only** — published data stores, committed
credentials, no TLS. `docker-compose.prod.yml` is the deployable shape.

---

## 3. Media

Uploads go to object storage; the document holds a URL.

**The bucket is private and the API is the only way to read it.** It used to be
world-readable, with the upload response handing back a direct object URL that
the client wrote into the document — which meant the media proxy, along with
its `nosniff` header, its `default-src 'none'` policy and its refusal to echo
back a client-chosen content type, was never on the path anything actually
used. Media was served by object storage with whatever type it was uploaded
with, which is the exact situation those headers exist to prevent.

Consequences worth knowing:

- Media access now follows room access, which is where it belonged.
- Images load with CORS, so `crossOrigin="anonymous"` succeeds and PNG export of
  boards containing images is no longer silently tainted.
- **Boards written before this change hold direct object-store URLs and will
  show missing images.** Run `apps/server/scripts/rewrite-media-urls.ts` — it
  reports by default and rewrites with `--apply`. Take a backup first.

SVG is not an accepted upload type, deliberately: an SVG is a document that can
carry script, and serving one from your own origin is a stored XSS. Vector work
is unaffected — SVG import parses in the browser into real nodes, and export
writes SVG out; neither round-trips through storage.

---

## 4. History, and what a crash costs

`onChange` fires once per Yjs transaction — during a drag, every few frames. It
used to perform two Postgres round trips each time, which is roughly sixty
queries a second from one person against a pool of twenty. Updates are buffered
in memory now and written as one multi-row insert per `HISTORY_FLUSH_MS`.

The trade: **a hard kill loses up to one flush interval of scrubbable history.**
That is acceptable and would not be if it were the document. The canonical
state is `room_snapshots`, written by Hocuspocus's own debounced persistence;
`room_updates` only feeds Time Travel's scrubber. A graceful stop — which is
what a deploy is — flushes and loses nothing.

If the database is unreachable the buffer caps and drops the oldest entries.
Live sync is the product; history is a convenience, and the convenience is what
gets dropped rather than the process running out of memory.

### The document, which was not flushed at all

The paragraph above leans on "the canonical state is `room_snapshots`", and
that was true and unprotected. Hocuspocus's persistence is **debounced**, and
the shutdown path drained the history buffer, closed the Postgres pool and
exited without ever asking it to store what it was holding. **A deploy, a
restart or a free-tier spin-down discarded every edit since the last debounced
write** — the document, not the scrubber.

Two things made it total rather than occasional:

- The draining ran inside `httpServer.close(async () => ...)`, whose callback
  waits for every existing connection to end. WebSocket connections do not end
  on their own, so on any instance with a client attached that callback fired
  after the ten-second forced-exit timer, or never.
- Nothing called `flushPendingStores()`.

Shutdown now closes connections first (a client still attached can write during
the flush), calls `flushPendingStores()`, and waits for the open-document count
to reach zero before `pool.end()` — closing the pool first kills the
connections mid-write and hands the loss straight back. There is an eight
second backstop so one board that refuses to store cannot take the rest with
it.

**Why nobody reported it as data loss.** The person editing keeps everything:
`y-indexeddb` holds their copy on their own machine, so their board looks
complete and always will. Only other people see the gap, which arrives as
"the board is empty on their end" rather than as anything resembling a server
fault.

---

## 5. Schema

`src/migrations.ts`, numbered and recorded in `schema_migrations`, applied
inside a transaction each, guarded by a Postgres advisory lock so instances
starting together queue instead of racing.

**Migrations are append-only. Never edit one that has shipped** — a deployed
database has already recorded it and will not run it again, so an edit changes
what *new* databases get and nothing else. That is how two environments end up
with different schemas and the same version number.

---

## 6. Share cards, and what crawlers see

A board link pasted into Slack, iMessage, Teams, X or Discord unfurls into the
board's own name, how much is on it, what the link allows, and a picture of the
board. Four pieces, each able to fail without taking the others down:

1. **The board publishes itself.** `useShareCard` sends `PUT /rooms/:id/card` —
   the name, and the same summary the dashboard draws its covers from — twelve
   seconds after the board goes quiet, and again on page hide. Only from a
   synced client that can edit, so a tab that has not synced cannot replace a
   real board's card with an empty one.
2. **The server keeps it and draws it.** `room_cards` (migration 4) holds one
   row per room. `GET /cards/room/:id` answers the facts and `…/image.png`
   draws 1200×630 with resvg, cached in memory by room and version. Everything
   a client sent is checked again on the way out: colours must match a CSS
   colour grammar, numbers are clamped to known ranges, and the name is drawn
   as glyph outlines — there is no text node in the picture to break out of.
3. **The crawler gets HTML.** `vercel.json` rewrites `/room/:id` and `/i/:token`
   to `api/share.ts` **only for known crawler user agents**; everyone else gets
   the app. That function asks the server for the facts within 3.5 seconds and
   falls back to a generic card, so a sleeping server costs detail, never the
   unfurl itself.
4. **The picture comes from the site's own edge.** `api/card-image.ts` proxies
   the server's PNG with the card's version in the URL, so it can cache for a
   year and an edited board is simply a different URL.

Two rules hold the privacy line. An **invite card never names its room**: its
JSON and its image URL are keyed by the token, because an unfurl of a view link
must not become a way to learn the edit link. And any board can switch previews
off — Share → Link preview — which clears the name and picture from the server
rather than hiding them, leaving every unfurl generic.

Boards are kept out of search with `X-Robots-Tag: noindex` on `/room/` and
`/i/`, **not** with `robots.txt`: a disallowed URL can still be indexed without
its content, and X and LinkedIn honour `robots.txt` for previews, which would
take the picture off every shared link.

`apps/server/scripts/brand-assets.ts` draws every icon and both static share
images from one vector mark. Rerun it after changing the mark or the card.

---

## 7. Health

- `GET /healthz` — liveness. Deliberately checks nothing else: a liveness probe
  that touches the database turns a recoverable dependency outage into a
  restart loop that guarantees one.
- `GET /readyz` — readiness. Checks the database, and reports history queue
  depth and drops. A server that cannot reach Postgres should be taken out of
  rotation, not restarted.

---

## 8. What is still missing

Ranked. None of this is done, and the first one is the largest single risk in
the system.

1. **Backups.** Two layers, both in `BACKUP-AND-RESTORE.md`: Neon's history
   window (**6 hours on the Free plan**, capped at 1 GB of change history) and
   a nightly `pg_dump` to R2 via `.github/workflows/backup.yml`.

   The dump round-trips on PostgreSQL 17 — `bytea` columns and cascading
   foreign keys included — and all five repository secrets are set. **It has
   still never run.** One manual run is what turns a tested mechanism into a
   backup; until then recovery is six hours.

   `R2_BACKUP_BUCKET` is currently the media bucket, which is a deliberate
   shortcut with a real cost — see `SETUP-CHECKLIST.md` §1a.

   `room_snapshots` is overwritten in place with no version history, so read
   the restore procedure before you need it, not during.

2. **The reaper is written but deliberately not scheduled.**
   `apps/server/scripts/reap-rooms.ts` reports by default and deletes with
   `--apply`. Two things to settle before it ever runs unattended:

   - `media_refs.storage_key` was added nullable by migration 3 and never
     backfilled. `reaper.ts` skips rows without one, so any media predating
     that migration would have its database row cascaded away while the object
     survives in R2 with its key now unrecoverable. Count them first:
     `SELECT count(*) FROM media_refs WHERE storage_key IS NULL;`
   - It hard-deletes, and §7.1 is still open. Turn on a known-good recovery
     window before you turn on automatic deletion.

   `last_active_at` is now refreshed on connection as well as on change
   (`roomActivity.ts`), so a board people read and never edit no longer looks
   dormant. Before that fix it was the row most likely to be collected.

3. **Rate limiting follows `REDIS_HOST`.** Set it and all three limiters — media
   upload, room history, link preview — share one token bucket across every
   instance, along with the per-IP storage quota. Leave it unset and each
   process keeps its own buckets, which is correct for one instance and quietly
   wrong for two: each client would get a full allowance per instance, nothing
   would fail, and the numbers would simply be wrong.

   This was previously wired the other way round — the Redis bucket existed and
   **no call site passed a client** — so the note here used to say the limits
   were per-process unconditionally. They are not any more, but the failure is
   still silent if `REDIS_HOST` is missing on a multi-instance deployment, so it
   stays on this list.

   If Redis goes away at runtime the limiters fall back to memory rather than
   refusing traffic, and log one line per thirty seconds rather than one per
   reconnect.

4. **Object storage durability.** MinIO on one volume is one disk.

5. **TLS.** Terminate in front of the server and set `TRUST_PROXY`.

6. **No load testing has been done.** The batching in §4 is a reasoned fix for a
   measured-by-inspection problem, not a benchmarked one. The numbers to find
   out are: transactions per second per active board, and where the pool
   saturates.
