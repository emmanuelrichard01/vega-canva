# Setup checklist

Things that must be done in a console somewhere, not in this repository.
Each one is a switch that is currently off, with what stays broken until it is
on. Tick them off here as you go.

---

## [ ] 1. Backup secrets — **outstanding, and the only unprotected risk left**

**Where:** GitHub → this repo → Settings → Secrets and variables → Actions →
*New repository secret*.

Five of them, spelled exactly:

| Secret | Where the value comes from |
| --- | --- |
| `BACKUP_DATABASE_URL` | Neon → Project → Connection string. Use the **pooled** host, and append `?sslmode=require`. A read-only role is sufficient and is the better choice. |
| `R2_BACKUP_BUCKET` | The name of a **new** R2 bucket, e.g. `vega-canva-backups`. Create it first; see the note below. |
| `R2_ENDPOINT` | Cloudflare → R2 → *S3 API* endpoint: `https://<account-id>.r2.cloudflarestorage.com` — the same host the server already uses for media. |
| `R2_ACCESS_KEY_ID` | Cloudflare → R2 → Manage API tokens → Create token, **scoped to the backup bucket only**. |
| `R2_SECRET_ACCESS_KEY` | Shown once, when that token is created. |

**Make the bucket separate from `vega-canva-media`, and scope the token to
it.** Two different accidents are being kept apart: a lifecycle rule or a
mistaken purge aimed at media should not be able to reach the backups, and the
credentials the *server* holds should not be able to delete the backups if the
server is what gets compromised.

**Then run it once by hand:** Actions → *Database backup* → Run workflow, with
`dry_run` **checked**. That dumps and verifies without uploading, so a wrong
connection string fails safely. When it passes, run it again with `dry_run`
unchecked and confirm the object appears in the bucket.

> **Until that second run succeeds, recovery is Neon's history window and
> nothing else — 6 hours on the Free plan, capped at 1 GB of change history.**
> A bad write found the next morning is outside it. `room_snapshots` holds the
> canonical state of every board and is overwritten in place.

The mechanism is verified: dump and restore round-trip byte-for-byte on
PostgreSQL 17, `bytea` columns and cascading foreign keys included. What is
*not* verified is your credentials, which is exactly what the manual run
proves. See `BACKUP-AND-RESTORE.md`.

The nightly job runs at 03:17 UTC. If the secrets are missing it will fail and
GitHub will email you, so this checklist is not the only thing standing
between you and remembering.

---

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
