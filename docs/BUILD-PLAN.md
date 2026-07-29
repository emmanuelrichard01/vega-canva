# Build Plan — Real-Time Collaborative Infinite Canvas

Companion to `PRD.md`, `ARCHITECTURE.md`, `DATA-MODEL.md`. Prioritized by
score-per-hour, not by the order features appear in the brief. Do not
reorder under time pressure — the ranking already accounts for what's cheap
because of the Yjs/CRDT architecture versus what's genuinely effort-heavy.

## Priority order

1. **MVP (non-negotiable)** — infinite canvas pan/zoom, Yjs sync wired to
   Hocuspocus, object CRUD for all 5 types, guest auth, room creation +
   shareable link, responsive layout.
2. **Offline support** — near-free once Yjs is wired up (`y-indexeddb`).
3. **Mini-map / radar** — near-free via the awareness protocol.
4. **Export: PNG + JSON** — PNG is one call (`stage.toDataURL()`); JSON is
   trivial doc serialization.
5. **Physics** — highest effort and risk. Ok to cut, or de-scope to just
   "throw + collide" and drop attract/repel if time is short.
6. **SVG export** — only if ahead of schedule; needs a custom
   object-to-SVG serializer since Konva doesn't export SVG natively.
7. **Time Travel** — only start once 1–5 are done and stable.

## Suggested schedule

Adjust to actual hours remaining — this assumes a fresh 2-day (~20 working
hour) block.

### Day 1 — MVP

- Hrs 0–2: repo scaffold, Konva stage with pan/zoom, viewport culling stub.
- Hrs 2–5: Hocuspocus server + `y-websocket` client wiring; objects render
  reactively from the Yjs `objects` map.
- Hrs 5–8: object creation tools — text, shape, sticky, image upload, audio
  recording via `MediaRecorder`.
- Hrs 8–10: guest auth modal, room creation + shareable link, responsive
  pass.

### Day 2 — differentiators

- Hrs 0–2: `y-indexeddb` offline persistence, connection-status UI,
  reconnect test (airplane mode on/off).
- Hrs 2–4: awareness broadcast + mini-map rendering.
- Hrs 4–5: PNG + JSON export.
- Hrs 5–8: Matter.js physics — throw-gesture velocity mapping, collisions;
  attract/repel if time remains.
- Hrs 8–9: polish, deploy, README, drop the architecture diagram into the
  repo.
- Hrs 9–10 (only if ahead): SVG export, Time Travel scrubber.

## Definition of done — mandatory features

- **Real-time collaboration**: two browsers in the same room see each
  other's object creates/moves/deletes within ~150ms, no manual refresh.
- **Infinite canvas**: pan/zoom stays smooth (no visible frame drop) with
  100+ objects placed; scrolling well past the initial viewport works.
- **Object types**: all 5 (text, shape, image, sticky, audio) can be
  created, moved, and deleted by any user in the room.
- **Guest auth**: a new browser tab can join an existing room link with
  just a display name, no signup step.
- **Responsive**: the toolbar and canvas remain usable at a phone-width
  viewport (not necessarily feature-identical, but not broken).

## Cut-list if behind schedule

Cut in this order — never cut real-time sync, the infinite canvas, or the 5
object types, since those are MVP-mandatory and the build isn't gradeable
without them:

1. Time Travel
2. SVG export
3. Attract/repel physics (keep throw + collide)
4. Mini-map polish (keep basic dots, cut smooth interpolation)

## Related docs

- `PRD.md` — product scope and success criteria
- `ARCHITECTURE.md` — system design and bottleneck reasoning
- `DATA-MODEL.md` — schemas referenced by the build tasks above
