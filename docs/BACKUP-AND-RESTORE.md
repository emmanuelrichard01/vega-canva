# Backup and restore

The canonical state of every board is `room_snapshots.state`, and it is
**overwritten in place**. There is no version history in the schema. So the
question this document answers is the only one that matters after a bad write:
*how far back can you go, and how.*

There are two layers, and they fail in different ways on purpose.

---

## Layer 1 — Neon's history window

Neon keeps a log of page changes and can reconstruct the database at any
instant inside its **history window**, by creating a branch from that instant.
Nothing is overwritten; you get a second branch to read from.

**On the Free plan the window is 6 hours, capped at 1 GB of change history.**
Up to 7 days on Launch, 30 on Scale.

Use this first. It is instant, needs no tooling, and does not touch the live
branch. It is the right answer for "somebody cleared a board twenty minutes
ago".

It is the wrong answer for three cases, which is why layer 2 exists:

- **Anything older than the window.** A bad write found the next morning is
  outside six hours. So is anything discovered on a Monday.
- **A busy period.** The 1 GB cap is on *change* volume, not database size.
  Snapshots are rewritten on every debounced save, so a heavy day can consume
  the window faster than the clock does.
- **Losing the account.** A billing lapse, a mistaken project delete, or
  losing the Neon login takes the database and its history together. They were
  never two things.

### Restoring from it

In the Neon console: **Branches → Create branch → include data up to a
specific date and time**. Point a scratch connection string at the new branch,
confirm it holds what you expect, and copy rows across. Do not repoint the
application at a restore branch without reading §"After any restore" below.

---

## Layer 2 — Nightly logical dump to R2

`.github/workflows/backup.yml` runs `apps/server/scripts/backup-db.sh` at
03:17 UTC daily, and can be run by hand from the Actions tab (with a
`dry_run` option that dumps and verifies but uploads nothing).

It writes `pg_dump --format=custom` output to
`s3://$R2_BACKUP_BUCKET/daily/vega-<ISO8601>.dump` and keeps the newest 30.

Three things it refuses to do, each of which is a way a backup job "succeeds"
while producing nothing:

1. Upload a dump under 1 KB — an empty file, a connection dropped at hello.
2. Upload a dump `pg_restore --list` cannot read — the truncation check. This
   is the difference between "pg_dump exited 0" and "there is a restorable
   file here".
3. Upload a dump missing table data for `rooms`, `room_snapshots`,
   `room_updates`, `media_refs` or `schema_migrations`.

Retention is by **count over lexically sorted ISO-8601 names**, not date
arithmetic. Sorting is chronological by construction, so pruning needs no
clock, no timezone and no parsing — which is where retention scripts usually
acquire the bug that deletes everything.

### Current state

**All five secrets are set. The workflow has never run.** See
`SETUP-CHECKLIST.md` §1 — one manual run is what turns this from a tested
mechanism into an actual backup.

`R2_BACKUP_BUCKET` is `vega-canva-media`, the same bucket the app uploads to.
That was chosen deliberately to start backing up without waiting on a console
visit, and it costs the isolation described below: anything that purges media
takes the backups with it, and the credentials the *server* holds can delete
them. §1a of the checklist carries the migration to a scoped bucket.

### Setting it up

Five repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
| --- | --- |
| `BACKUP_DATABASE_URL` | Neon connection string. A read-only role is enough and is the better choice. |
| `R2_BACKUP_BUCKET` | A bucket **separate from the media bucket**. |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | An R2 token scoped to that bucket only. |

Separate bucket, deliberately: a lifecycle rule or a mistaken purge aimed at
media should not be able to reach the backups. Scoped token for the same
reason — the credentials the *server* holds should not be able to delete the
backups if the server is what gets compromised.

---

## Restoring from a dump

Restore into a **scratch database**, never over the live one. You are trying
to get some rows back, not to replay a whole afternoon over the top of work
people have done since.

```bash
# 1. Find the one you want.
aws s3 ls s3://$R2_BACKUP_BUCKET/daily/ --endpoint-url $R2_ENDPOINT

# 2. Fetch it.
aws s3 cp s3://$R2_BACKUP_BUCKET/daily/vega-2026-09-01T03-17-04Z.dump . \
  --endpoint-url $R2_ENDPOINT

# 3. Read its table of contents without restoring anything.
pg_restore --list vega-2026-09-01T03-17-04Z.dump

# 4. Restore into a scratch database. A Neon branch is a good home for this:
#    it costs nothing and is deleted when you are finished.
createdb vegarestore
pg_restore --dbname "$SCRATCH_DATABASE_URL" --no-owner --no-privileges \
  vega-2026-09-01T03-17-04Z.dump
```

Then copy across only what you need. For a single board:

```sql
-- Run against the scratch database, with the live one as a foreign server,
-- or dump the single row and load it. The row is the whole board.
SELECT room_id, length(state) FROM room_snapshots WHERE room_id = 'abcdefgh12';
```

```bash
# Simplest reliable route for one board: dump just those rows and load them.
pg_dump "$SCRATCH_DATABASE_URL" --data-only --table=room_snapshots \
  --format=plain --file=one.sql
# Edit one.sql down to the row you want, then:
psql "$LIVE_DATABASE_URL" -f one.sql
```

### After any restore

- **`room_snapshots` is what the application reads.** `room_updates` only
  feeds Time Travel's scrubber, and it is deltas against structs created by
  earlier updates — restoring a snapshot without the matching `replay_base`
  and `updates_trimmed` on `rooms` leaves the scrubber unable to replay.
  Restore the `rooms` row alongside the snapshot.
- **Media lives in R2, not in the database.** `media_refs` rows restore, but
  if the object behind one was deleted the board shows a missing image.
  Restoring a room the reaper collected needs the objects back too.
- **Disconnect everyone from the affected board first.** A live client holds
  the document in memory and will write it back over your restore on its next
  save. Restore, then have people reload.

---

## What has actually been tested

Verified against PostgreSQL 17.11 on 2026-09-01, using the real migration SQL
from `apps/server/src/migrations.ts`:

- `backup-db.sh` produced a dump from a live server, and its integrity checks
  correctly **refused** a truncated dump, an unreadable dump, and a dump
  missing `room_snapshots`.
- A dump was restored into a **fresh, empty database** and compared against
  the source by per-table MD5 of the hex-encoded contents. All five tables
  matched exactly — including `room_snapshots.state`, `rooms.replay_base` and
  `room_updates.update_data`, which are the `bytea` columns a text-mangling
  backup would corrupt silently.
- The restored schema carried all three foreign keys with `ON DELETE CASCADE`
  intact and all eight indexes.

**Tested against Neon and R2 on 2026-09-02, and running nightly since.** The
dry run, the first real upload, and every scheduled run to 2026-09-04 have
succeeded; 2026-09-04 dumped 2,100,147 bytes, listed all five tables and put
the object in `daily/`. `gh run list --workflow=backup.yml` is the check, and
it is worth running occasionally — the two runs before the fix in `7da08f5`
failed silently, which is the failure mode a nightly job has.

**Still untested, and worth knowing:**

- **The prune path.** Retention keeps 30 and there have been three. Nothing
  has been deleted yet, so the one part of this script that can *destroy* a
  backup has never executed against the real bucket.
- **A restore from an R2 object.** The restore procedure above was verified
  against a locally produced dump, not against one fetched back out of the
  bucket. That is the last gap, and the sentence below is still the reason it
  matters: a backup nobody has restored is a hypothesis, not a backup.
