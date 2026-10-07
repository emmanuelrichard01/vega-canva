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
a **signed** role. `onAuthenticate` (`apps/server/src/collab.ts`) verifies the
signature, checks the token was minted for *this* room, and enforces the role
inside it:

- **viewer**: the connection is read-only. (Until this was fixed the server
  returned `readOnly` from the hook, which Hocuspocus ignores; it reads
  `connectionConfig.readOnly`. Viewers could write.)
- **commenter**: each update is applied to a scratch copy first, and refused
  unless everything it changes is a comment thread, an identity, or a node's
  reactions (`commenterFilter.ts`). Because a client's updates are causally
  chained, a refused update also blocks everything that client sends after it
  until it reloads, so the client must not attempt a refused write.
- **editor**: anything.

**Minting is bounded by what the caller holds.** `POST /rooms/:id/invite` mints
a role at or below the caller's own, and no longer-lived than the caller's own
invite. A caller presents its invite as `X-Invite-Token`; without one it holds
what the room id grants (editor, or nothing under `ENFORCE_SHARE_TOKENS`).
`ADMIN_SECRET` may mint anything.

What a token does **not** do on its own: it names its room, because the client
needs that to open the document. Someone who reads it out of their own URL can
connect on the bare room id and get an editor session. **`ENFORCE_SHARE_TOKENS=true`
closes that**: unsigned WebSocket connections are refused, REST routes need
`X-Invite-Token` (history: viewer; uploads and the share card: editor; link
previews: viewer), and room-keyed share cards answer "not found". It breaks
every bare room link already shared and the room-code join box with it, which
is why it is off by default. Media URLs stay readable without the header,
because an image tag cannot send one; their ids are unguessable and only
reachable through a board.

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
| `ALLOWED_ORIGINS` | yes | Comma separated. A leading-label wildcard is allowed for preview hosts, but **never under a public suffix**: `https://*.vercel.app` admits every Vercel site on the internet, with credentials. Use your team's scope (`https://*-yourteam.vercel.app`) or list preview hosts explicitly. A bare `*` is not allowed. Entries are compared as browsers spell an origin, so a trailing slash or a capital is forgiven. An entry that is not an origin fails at boot, naming itself. |
| `PUBLIC_API_URL` | yes | Written into documents as the address of uploaded media. Changing it later orphans media in boards written before the change. |
| `TRUST_PROXY` | if behind a proxy | Hop count. Wrong either way breaks rate limiting. |
| `DATABASE_URL` | instead of the `POSTGRES_*` fields | A connection string; `sslmode=require` turns TLS on. |
| `REDIS_URL` or `REDIS_HOST` | only for >1 instance | Without it, instances share neither documents and awareness nor rate limits and upload quotas. `REDIS_URL` may be `rediss://` (TLS) and carry a password; with `REDIS_HOST`, use `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_TLS`. |
| `SHARE_SECRET` | no | Signs invite links. Without it, only full-access links can be offered. Rotating it revokes every outstanding invite — the only revocation there is. |
| `AUTH_SECRET` | no | One shared token. Not authorization. The client sends it as `VITE_AUTH_SECRET`; set both or neither, or every client is refused. Because it is in the browser bundle, it guards nothing else. |
| `SESSION_SECRET` | **yes** | Signs anonymous session tokens. At least 32 characters, different from `SHARE_SECRET` and `AUTH_SECRET`. Not derived from `SHARE_SECRET`, because rotating that key is how invites are revoked and must not reset every identity. Development without it uses a per-process key. |
| `ADMIN_SECRET` | no | Bearer token for `/admin/reap`, `/admin/stats` and minting invites of any role. Unset means the routes are closed. |
| `ENFORCE_SHARE_TOKENS` | no | `true` makes a bare room id open nothing. See §1. |
| `WS_MAX_PAYLOAD_BYTES` / `MAX_DOCUMENT_BYTES` | no | 4 MB per WebSocket frame (larger frames close the socket); 32 MB per document (updates past it are refused). |
| `WS_MAX_CONNECTIONS_PER_IP`, `ROOM_CREATE_BURST`, `ROOM_CREATE_PER_MINUTE` | no | 32 sockets per address; new boards per address, a burst of 30 then 6 a minute. |
| `SENTRY_DSN` | no | Error tracking. `/readyz` reports `errorTracking` — trust that, not the log line. |
| `MIN_ROOM_ID_LENGTH` | no | Default 8. Lower only to keep older short-id boards reachable. |
| `HISTORY_FLUSH_MS` / `HISTORY_MAX_BYTES` | no | Default 1000 ms and 64 MB. See §4. |

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

- The media route serves only objects recorded in `media_refs`, so it cannot
  be pointed at anything else that shares the bucket.
- Uploads (and link-preview pictures) are charged to a daily allowance per
  client address **and** per session; the stricter decides. Charging the
  session alone was free to escape, because the server mints a new session for
  any request without a cookie. A request whose declared size already breaks
  the allowance is refused before anything is streamed to storage.
- At 90% of `MAX_GLOBAL_STORAGE_BYTES` error tracking is told (at most
  hourly); at 100% uploads stop.
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

Shutdown (`shutdown.ts`) now marks the instance draining (`/readyz` answers
503), arms a fifteen-second forced exit before anything else, closes
connections (a client still attached can write during the flush), calls
`flushPendingStores()`, and waits for the open-document count to reach zero
before `pool.end()` — closing the pool first kills the connections mid-write
and hands the loss straight back. There is an eight second backstop so one
board that refuses to store cannot take the rest with it, and a second signal
exits at once.

With Redis fan-out, every instance holding a document sees every update; only
the instance that received an update from a client records it in the history,
so the log is not written once per instance.

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
   draws 1200×630 with resvg on a worker thread (so a render never stalls the
   WebSocket traffic on the same event loop), cached in memory by room and
   version. Everything
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
- `GET /readyz` — readiness. 503 while draining for shutdown; otherwise one
  `SELECT 1`, plus history queue depth and drops. A server that cannot reach
  Postgres should be taken out of rotation, not restarted.
- `GET /admin/stats` — storage totals, behind `ADMIN_SECRET`. They used to be
  in the public readiness payload, computed by a full-table sum on every probe.

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

   `R2_BACKUP_BUCKET` is currently the media bucket. **Move it to a separate
   bucket with its own scoped token** (`SETUP-CHECKLIST.md` §1a): the server's
   storage credentials can delete anything in the media bucket, backups
   included, and a lifecycle rule aimed at media would reach them too. The
   media route no longer serves keys it did not record, so the dumps are not
   readable through it.

   `room_snapshots` is overwritten in place with no version history, so read
   the restore procedure before you need it, not during.

2. **The reaper runs weekly as a report, and deletes only when told to.**
   `.github/workflows/reap.yml` runs `apps/server/scripts/reap-rooms.ts` on a
   schedule. It reports by default and deletes with `--apply` or
   `REAP_APPLY=true`. It reads the same variables as the server
   (`DATABASE_URL` or the `POSTGRES_*` fields with `POSTGRES_SSL`, the `S3_*`
   variables, `ROOM_TTL_DAYS`) and refuses to run with any of them missing,
   rather than falling back to the development defaults.

   - Rows from before migration 3 have no `storage_key`; the reaper derives
     their object key from the stored URL, which has always ended in the
     object name.
   - The delete re-checks inactivity, so a board opened after the scan
     survives, and media uploaded after the scan is deleted with its room.
   - It hard-deletes. Turn on a known-good recovery window (item 1) before
     you set `REAP_APPLY`.

   `last_active_at` is now refreshed on connection as well as on change
   (`roomActivity.ts`), so a board people read and never edit no longer looks
   dormant. Before that fix it was the row most likely to be collected.

3. **Rate limiting follows `REDIS_URL`/`REDIS_HOST`.** Set it and every
   limiter (uploads, history, link previews, share cards, new boards) shares
   one token bucket across instances, along with the upload quota. Leave it
   unset and each process keeps its own, which is correct for one instance and
   quietly wrong for two: each client gets a full allowance per instance.

   If Redis goes away at runtime the limiters fall back to memory rather than
   refusing traffic, log one line per thirty seconds, and keep reconnecting
   with a capped backoff for as long as it takes.

4. **Object storage durability.** MinIO on one volume is one disk.

5. **TLS.** Terminate in front of the server and set `TRUST_PROXY`.

6. **No load testing has been done.** The batching in §4 is a reasoned fix for a
   measured-by-inspection problem, not a benchmarked one. The numbers to find
   out are: transactions per second per active board, and where the pool
   saturates.

---

## 9. Music: built-in stations and Spotify

The six built-in stations (Acoustic Ambient, Peaceful Piano, Lo-fi, Synth,
House, Retro) are generated in the browser with Web Audio. They need no
configuration, download nothing, and carry no licensing obligations.

Spotify is optional. To enable it:

1. Create an app at <https://developer.spotify.com/dashboard>. Select **Web API**
   and **Web Playback SDK**.
2. Under **Redirect URIs**, register one entry per origin the frontend is served
   from, each ending in `/spotify-callback`. Spotify matches them exactly:
   - `https://your-domain.example/spotify-callback`
   - `http://127.0.0.1:5173/spotify-callback` for local development. Spotify no
     longer accepts `localhost`; use the loopback IP and open the app on it.
   - Preview deployments each need their own entry, or set
     `VITE_SPOTIFY_REDIRECT_URI` to one fixed origin.
3. Set `VITE_SPOTIFY_CLIENT_ID` (and optionally `VITE_SPOTIFY_REDIRECT_URI`)
   where the frontend is built, then rebuild. Both values are public; there is
   no client secret, because sign-in uses Authorization Code with PKCE.

**Development mode limit.** A new Spotify app runs in development mode: only
the Spotify accounts you list under **User Management** (25 at most) can
sign in. Everyone else is refused by Spotify. Opening it to all users requires
applying for extended quota in the dashboard.

**What plays where.**
- Premium accounts play in the tab through the Web Playback SDK, which loads
  from `sdk.scdn.co` on first use.
- Other accounts play on a device where Spotify is already open, through the
  Connect API.
- With no device available, the player falls back to Spotify's embed player,
  which plays previews.

**Tokens.** Access and refresh tokens live in the tab's `sessionStorage`. They
never reach the board or the server. "Disconnect" forgets them in that tab.
Spotify offers no revocation endpoint to PKCE clients, so the player links to
spotify.com/account/apps, where a person can withdraw access entirely.
