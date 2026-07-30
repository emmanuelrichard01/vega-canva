# Handoff

Written at the end of a session that rebuilt Time Travel and physics, so the
next session can start cold. Read this, then `README.md`. Delete this file once
its "next up" list is exhausted.

**This supersedes the previous handoff.** If anything here contradicts an older
note, this is newer.

---

## 1. Start here

```bash
docker compose up -d              # Postgres, Redis, MinIO, sync server (:3000)
npm install                       # only if node_modules looks stale — see §6
npm run dev -w apps/frontend      # :5173
```

Verify in ~30 seconds:

```bash
cd apps/frontend
npx tsc -b            # must be silent
npm test              # 89 tests, 6 files
npx oxlint            # must exit 0 (4 known cosmetic warnings)
npx vite build        # must succeed
```

## 2. Where the work lives

All of this session's work is on the branch **`rebuild/time-travel-and-physics`**,
eight commits, nothing pushed, nothing merged to `main`. Each commit builds on
its own (verified by checking out each and typechecking) and the messages carry
the reasoning — read `git log` before changing any of it.

| | |
| --- | --- |
| Typecheck | clean |
| Tests | **89** (was 33) across 6 files |
| Lint | exits 0; 4 `only-export-components` warnings, all cosmetic |
| Build | clean, ~1.17MB JS (still no code splitting) |

## 3. The one thing that will waste your time if you don't know it

**You very likely cannot observe the running app.** The Chrome extension renders
its tab offscreen: `document.visibilityState` is permanently `"hidden"`, so
**`requestAnimationFrame` never fires**, and synthetic pointer events do not
reach the Konva stage.

Consequences, all of which cost real time this session:

- Nothing driven by rAF runs — that is *all* physics, and the camera loop.
- Clicking, dragging and throwing cannot be simulated. `computer` clicks look
  like they land and do nothing.
- A screenshot still renders, so the app *looks* alive. It is not ticking.

What works instead:

- Konva binds its listeners to **`stage.content`**, not `stage.container()`.
  Dispatching a real event on `stage.content` does reach it.
- Drive the simulation by hand: `window.__physics` is the live
  `PhysicsSimulation`; call `applyForce(...)` / `launch(...)` then
  `advance(1000/60)` in a loop.
- `window.objectsMap` is the live Y.Map (long-standing debug hatch).
- Import app modules with `await import('/src/engine/document/index.ts')` — but
  note Vite appends `?t=` to files you have just edited, so a plain import can
  hand you a **second module instance** with its own state. If a store looks
  empty when it should not, that is why. Reload the page rather than trusting it.

**Because of all this, the simulation was extracted so it can be tested in
Node.** Prefer writing a failing test over trying to watch the bug.

## 4. What changed, and the rules that now hold

### Time Travel (`engine/history/`, `components/TimeTravelBar.tsx`)

Replay **never reached the canvas** — `isReplaying` existed and the live observer
deferred to it, but nothing ever set it, and the snapshot went only to the
Layers/Properties panels. `useStore.applyReplaySnapshot` now owns that
transition (objects + scene graph + flag in one write).

`sessionTimeline.buildTimeline` turns the raw CRDT log into described,
attributed *moments* — a 14-step drag is one "Dave moved Ship the beta", not 14
steps. Keyframes make seeking backwards cheap. The server now reports how many
updates retention discarded (`rooms.updates_trimmed`), so "starts partway" is a
fact rather than a guess.

### Physics (`engine/physics/simulation.ts` + `hooks/usePhysics.ts`)

**The simulation is a plain module.** It imports Matter and the material
profiles and *nothing else* — no React, no Konva, no Yjs, no awareness. This is
the rule that makes physics testable at all; do not import any of those into it.
`usePhysics` is only an adapter: when to step, and what to do with the result.

Bugs fixed that are worth not reintroducing:

1. **Infinite mass.** Bodies created with `isStatic: true` never get mass or
   inertia computed, and waking does not restore them. Force scaled by mass
   became `Infinity`, Matter multiplied by an inverse mass of `0`, and every
   position became `NaN`. Build bodies *dynamic*, capture mass properties, then
   park them static (`wakeBody` restores).
2. **Never let a non-finite value reach the document.** `Y.Map` stores `NaN`
   happily and `toJSON()` turns it into `null`, so one bad frame strips a node's
   coordinates permanently, syncs that, and survives reload.
3. **Two coordinate spaces.** `SimTransform` carries both: `x`/`y` is the node's
   **top-left** (commit this) and `centerX`/`centerY` is the **Konva group
   origin** (render this). Writing the wrong one draws objects half their size
   off and makes them jump on landing.
4. **Fixed timestep.** Variable deltas make the same throw travel different
   distances depending on frame pacing. Note the `STEP_EPSILON` — float residue
   was silently dropping a step.
5. **Never broadcast or commit per object in a loop.** Ownership is claimed in
   one awareness write; settles commit in one `doc.transact`. Per-object
   versions produced thousands of network writes a second.
6. **`flightState` skips the local client.** Rendering your own broadcast pose
   while the loop also writes the Konva node makes objects visibly phase back
   and forth.

### Force as a mode (`engine/physics/forces.ts`, `components/ForcesBar.tsx`)

`FORCE_SPECS` is the single source for radius/strength/label — the field ring
you see is drawn from the same numbers the simulation uses. Picking a force tool
*is* turning force on; the header switch now only governs throw-on-flick.
Entering force mode snapshots the layout so "Restore layout" can undo the whole
session; `Canvas` clears that snapshot on **every** exit path.

**There is deliberately no world gravity.** An infinite canvas has no floor, so
a constant field would pull content off the board forever and nothing would ever
settle. "Drop" is a force you aim and hold. The reasoning is written into
`forces.ts` — read it before adding gravity.

### Materials (`utils/behaviorSystem.ts`)

Five user-selectable materials in the Properties panel. `material` is optional on
`BaseNode`; absent means "this type's default", which is what keeps older
documents behaving as before. Air drag was cut ~3× so a flick actually carries
(Paper 120px → 431px) with the ordering preserved and locked by tests.

### UI (`ToolWorkspace`, `WorkspaceShell`, `index.css`)

- The dock **must not clip**: it used `overflow-y: hidden`, which cut off every
  tooltip and flyout, because they are positioned above the buttons. No z-index
  escapes an ancestor's overflow. It wraps instead.
- Dock flyouts (pen/shape/forces) share one menu state, open on click *and*
  hover, and close on Escape or outside press. Hover-only was unreachable on
  touch.
- Where there is no hover there are no tooltips, so touch gets permanent labels
  (`data-label` + `@media (pointer: coarse)`).
- The header button that opens Time Travel says **History**, not "Play".

## 5. Next up, in the order I'd do it

1. **Rebuild the cursor** (`engine/cursor/`). Evaluated but not touched. It sets
   `cursor: none` on the canvas and replaces the pointer with a rAF-positioned
   div, which is always a frame late, discards OS accessibility settings, and
   declares 19 states of which exactly three are ever set. Recommendation: keep
   custom rendering for *remote* cursors, drop the local one in favour of native
   CSS `cursor` per tool. **There is also a live bug**: two independent writers
   of the awareness `cursor` field — `Canvas.tsx:536` (throttled) and
   `CursorRenderer.tsx:98` via `presenceManager.updateCursor` (every window
   mousemove, unthrottled, fires over panels too). They disagree on mouse-leave.
2. **Auth and room lifecycle screens** — sign-in, create, delete, welcome-back.
   Design together; they share one visual system. Note deletion has no confirm
   flow, and see the dashboard bug below.
3. **Landing page** — depends on the identity established in 2.
4. **A real first-run moment** — the empty state teaches the core gesture and
   nothing introduces Forces, History or materials.
5. **Bundle splitting** — 1.17MB, no chunks. Konva, Matter and framer-motion are
   the obvious lazy candidates.

### Known gaps

- **The dashboard lists workspaces from `localStorage` and never checks the
  server**, so a deleted room lingers as a card. Hit repeatedly while testing;
  fix this as part of item 2.
- Adapter-level physics code (Konva writes, awareness broadcasts) is still
  untested — that is exactly where the landing-jump bug lived. Extracting the
  pose-write into a pure function would close it.
- PNG export omits audio players (DOM overlays, not canvas).
- Groups are flat; no permissions; auth is a display identity, not an account.

## 6. Environment notes

- **`@hocuspocus/server` version skew** is the classic trap here. Confirm 4.4.0:
  `node -e "console.log(require('./node_modules/@hocuspocus/server/package.json').version)"`.
- Vite picks the first free port from 5173. **Each port is a separate origin**, so
  `localStorage` and IndexedDB do not carry across ports. If the dashboard looks
  empty or you appear as a different user, check the port.
- Server changes need `docker compose up -d --build server`.
- Physics is behind the **Throw** switch for flicks only, and that preference is
  persisted per origin — if throwing seems dead, check `vega_physics_enabled` in
  `localStorage` before debugging the simulation.
- Rooms in Postgres are recreated by the sync server whenever a client is still
  connected. Close the tab *before* deleting a test room or it will come back.

## 7. Where things live

`README.md` has the full map. The files to read first:

1. `engine/model/schema.ts` — the data model everything obeys
2. `engine/document/` — CRDT ownership, the single write path, normalization
3. `hooks/useStore.ts` — the one bridge from document to UI
4. `engine/physics/simulation.ts` — physics, with nothing else attached
5. `components/Canvas.tsx` — input, tools, camera, the shared transformer
