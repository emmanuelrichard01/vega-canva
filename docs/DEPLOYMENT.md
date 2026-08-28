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
| `ALLOWED_ORIGINS` | yes | Comma separated. No wildcard. |
| `PUBLIC_API_URL` | yes | Written into documents as the address of uploaded media. Changing it later orphans media in boards written before the change. |
| `TRUST_PROXY` | if behind a proxy | Hop count. Wrong either way breaks rate limiting. |
| `REDIS_HOST` | only for >1 instance | Without it, instances do not share documents or awareness. |
| `AUTH_SECRET` | no | One shared token. Not authorization. |
| `MIN_ROOM_ID_LENGTH` | no | Default 8. Lower only to keep older short-id boards reachable. |
| `HISTORY_FLUSH_MS` | no | Default 1000. See §4. |

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

## 6. Health

- `GET /healthz` — liveness. Deliberately checks nothing else: a liveness probe
  that touches the database turns a recoverable dependency outage into a
  restart loop that guarantees one.
- `GET /readyz` — readiness. Checks the database, and reports history queue
  depth and drops. A server that cannot reach Postgres should be taken out of
  rotation, not restarted.

---

## 7. What is still missing

Ranked. None of this is done, and the first one is the largest single risk in
the system.

1. **Backups.** `room_snapshots` holds the canonical state of every board and is
   overwritten in place, with no versioning. A bad write is unrecoverable except
   partially, from `room_updates` plus `replay_base`. Nothing in this repository
   configures point-in-time recovery. **Do not launch without this.**

2. **Nothing is ever deleted.** No room TTL, no S3 lifecycle policy, no
   orphaned-media reaping. `rooms.last_active_at` is written and never read.
   Storage grows monotonically for the life of the deployment. Migration 2 adds
   the indexes a reaper would need; the reaper itself does not exist.

3. **Rate limiting is per-process.** Run two instances and each client gets a
   full allowance per instance. It needs to move to Redis at the same time as
   horizontal scaling, not after — see the note in `rateLimit.ts`.

4. **Object storage durability.** MinIO on one volume is one disk.

5. **TLS.** Terminate in front of the server and set `TRUST_PROXY`.

6. **No load testing has been done.** The batching in §4 is a reasoned fix for a
   measured-by-inspection problem, not a benchmarked one. The numbers to find
   out are: transactions per second per active board, and where the pool
   saturates.
