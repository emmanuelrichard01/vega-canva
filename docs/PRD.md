# PRD — Real-Time Collaborative Infinite Canvas

Vega IT hackathon main-event build. 2-day timeline.

## Product overview

A web platform where multiple users create a room, share a link, and jointly
create/manipulate objects (text, shapes, images, sticky notes, audio
recordings) on an infinite 2D canvas with live sync, physics-based
interactions, a presence radar, and offline resilience.

## Target scale (explicit, not implied)

This is **not** being designed for Figma's concurrency (millions of users,
enterprise file scale, years of accumulated document complexity). Target:
hundreds of concurrent rooms, up to ~30–50 concurrent users per room,
thousands of total concurrent users across the platform during a demo/eval
window. Every decision in `ARCHITECTURE.md` is made against this target, not
Figma's — see that doc's "what we borrow from Figma vs. what we deliberately
skip" section for the reasoning.

## Users / personas

- **Room creator (host)** — starts a room, shares the link.
- **Guest collaborator** — joins via link, sets a display name, no account.

No persistent user accounts, no login, no cross-session identity in MVP.

## Core user stories

Grouped by the hackathon's own scoring tiers, so each story maps directly to
a grading line item.

### Mandatory MVP

1. As a user, I can create a room and get a shareable link.
2. As a user, I can open a room link and join as a guest by typing a display
   name — no signup.
3. As a user, I can pan and zoom a 2D canvas smoothly, including scrolling
   well beyond the visible starting area.
4. As a user, I can add and manipulate text, shapes, images, sticky notes,
   and audio recordings on the canvas.
5. As a user, I see other users' edits appear in real time.
6. As a user, the app is usable on both desktop and mobile viewports.
7. The canvas stays smooth at interactive framerate with 100+ objects
   present.

### High-score / creative-technical

8. As a user, I can throw, collide, and attract/repel canvas objects using
   physics.
9. As a user, I can see where other collaborators currently are on the
   canvas via a mini-map/radar.
10. As a user, if I lose connectivity, my edits are preserved locally and
    synced automatically once I'm back online.

### Bonus

11. As a user, I can export the canvas to PNG, SVG, or JSON.
12. As a user, I can replay a room's session from the beginning
    ("Time Travel").
13. As a user, I can put data on the board as a chart or a table, edit it in
    a spreadsheet, bring it in and take it out as CSV, and start from a
    finished example.

## Non-functional requirements

- Real-time edit propagation: perceived latency under ~150ms on a normal
  connection.
- Canvas interaction: smooth pan/zoom maintained with 100+ objects on
  screen.
- Offline: local edits must not be lost on disconnect, and must reconcile
  automatically on reconnect with no manual conflict resolution step.
- Responsive: functional (not necessarily feature-identical) on a
  phone-sized viewport.
- No account system, no server-side password auth.

## Explicitly out of scope for MVP

- Enterprise-grade permissions / per-object ACLs — anyone with the room
  link can edit anything.
- Horizontal multi-instance scaling — documented as a future path in
  `ARCHITECTURE.md`, not built now.
- End-to-end encryption.
- Persistent user accounts / cross-device identity.
- A custom rendering engine (C++/Wasm) — disproportionate to this object
  count and timeline; see `ARCHITECTURE.md`.

## Success criteria for the demo

- Two or more judges/laptops join the same room link and see each other's
  cursors, edits, and radar dots live.
- A user throws an object; it collides with another and comes to rest.
- A user goes offline (airplane mode), edits something, reconnects — the
  change appears for everyone.
- The canvas exports to PNG and JSON from the toolbar.
- If time allowed: a session can be scrubbed/replayed from t=0.

## Related docs

- `ARCHITECTURE.md` — system design, Figma comparison, bottlenecks
- `DATA-MODEL.md` — CRDT document schema, persistence tables
- `BUILD-PLAN.md` — prioritized 2-day execution plan
