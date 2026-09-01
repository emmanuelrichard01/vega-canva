# Setup checklist

Things that must be done in a console somewhere, not in this repository.
Each one is a switch that is currently off, with what stays broken until it is
on. Tick them off here as you go.

Last updated 2026-09-01.

---

## [ ] 1. Run the backup workflow once — **the last unprotected risk**

**The five secrets are set.** `BACKUP_DATABASE_URL`, `R2_ENDPOINT`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BACKUP_BUCKET` are all
present on the repository. What has *not* happened is a run.

**Do this:** Actions → *Database backup* → Run workflow, with `dry_run`
**checked**. That dumps and verifies without uploading, so a wrong connection
string fails safely. When it passes, run it again unchecked and confirm the
object appears in the bucket.

> **Until that second run succeeds, recovery is Neon's history window and
> nothing else — 6 hours on the Free plan, capped at 1 GB of change history.**
> A bad write found the next morning is outside it. `room_snapshots` holds the
> canonical state of every board and is overwritten in place.

The mechanism is verified: dump and restore round-trip byte-for-byte on
PostgreSQL 17, `bytea` columns and cascading foreign keys included. What is
*not* verified is the credentials, which is exactly what the manual run proves.

### [ ] 1a. Then move backups to their own bucket

`R2_BACKUP_BUCKET` is currently `vega-canva-media` — the same bucket the app
uploads to. That was a deliberate choice to start backing up immediately
rather than wait on a console visit, and the tradeoff is real and worth
closing:

| | shared bucket (now) | own bucket (better) |
| --- | --- | --- |
| a purge or lifecycle rule aimed at media | takes the backups too | backups survive |
| the server's own R2 key leaks | backups are deletable | backups survive |

To close it: create `vega-canva-backups` in Cloudflare R2, mint an API token
**scoped to that bucket only**, then update three secrets —
`R2_BACKUP_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Nothing in the
workflow changes.

## [ ] 2. Confirm the Neon history window, and write the number down

**Where:** Neon → Project → Settings → Storage → *History retention*.

Free plan is 6 hours. Knowing the number is the point: it is how long you have
to *notice* a problem before layer 1 stops being able to help. Raising it is a
paid-plan change and reasonable to defer — but not to be vague about.

---

## Done

- [x] **`SENTRY_DSN` on Render, `VITE_SENTRY_DSN` on Vercel.** Both verified
  live: `/readyz` reports `errorTracking: true`, and the deployed bundle
  contains the DSN and a lazily-loaded `vendor-sentry` chunk.
  *`VITE_SENTRY_DSN` is inlined at build time — rotating it needs a Vercel
  rebuild, not just an env change.*
- [x] **`ALLOWED_ORIGINS`, `PUBLIC_API_URL`, `TRUST_PROXY` on Render.**
  Validated against the production config reader: single origin, no wildcard,
  `trust proxy: 1`.

## Deliberately not done

- **Scheduling the room reaper.** `apps/server/scripts/reap-rooms.ts` exists
  and is manual on purpose. Do not automate it before item 1 is ticked: it
  hard-deletes rooms, snapshots, update logs and media with no undo. Both
  pre-flight counts were zero when last checked (2026-09-01), so there is no
  hurry.
- **`AUTH_SECRET`.** Only useful for making the whole instance private. If you
  ever set it, set `VITE_AUTH_SECRET` in Vercel to the same value in the same
  change, or every client is refused with "Unauthorized room connection".
