# Handoff

Written so the next session can start cold. Read this, then `DESIGN.md` if you
are touching anything visual, then `docs/CANVAS-SPEC.md`.

**This supersedes every previous handoff.** The presence/physics archaeology
that used to fill this file has been folded into the commit messages and the
spec; `git log` is now the record of *why*, and `docs/CANVAS-SPEC.md` is the
record of *what exists*. This file is only: how to run it, what will waste your
time, where the work stopped, and what is next.

> ## Read this first
>
> **The last session was a long design and product pass, and almost none of it
> was watched running.** The Chrome extension was unstable throughout and the
> user's standing instruction became "minimise testing and calling claude in
> chrome, focus on building faster". Take that seriously — it is the working
> agreement, not an excuse — but know what it costs: the claims below are
> backed by typecheck, tests and reading the code, and a handful were backed by
> a browser before it fell over.
>
> **Two bugs in that session were found by the user, not by the work**, and
> both are the same shape: something correct in the source that never reached
> the screen, because a *second* gate elsewhere was quietly switched off.
>
> 1. **A star drew as a block in board thumbnails, twice.** The first fix was
>    real and the report came back unchanged, because previews are cached in
>    `localStorage` and only rewritten when a board is opened. A correct
>    renderer was faithfully drawing a stale summary. Records carry
>    `PREVIEW_VERSION` now (`engine/model/boardPreview.ts`) and a mismatch
>    reads as no record. **If you change the preview shape, bump it.**
> 2. **Connectors had no colour control in the properties panel.** The registry
>    declared `supportsStroke`, the panel rendered a Stroke section, and
>    `APPEARANCE_TYPES` — a hand-maintained list *inside the panel* — omitted
>    `connector`, so `appearanceOf` returned null and every paint section was
>    gated off. See invariant 7; there is now a test that holds that list
>    against the registry, and it found the bug's shape the moment it existed.
>
> The lesson both times: **when a control "exists" but nobody can see it, look
> for the second gate**, and prefer one source of truth with a test over two
> lists that agree today.

---

## 1. Start here

```bash
docker compose up -d              # Postgres, Redis, MinIO, sync server (:3000)
npm install                       # only if node_modules looks stale — see §6
npm run dev -w apps/frontend      # :5173
```

Verify in ~30 seconds:

```bash
npx tsc --noEmit -p apps/frontend/tsconfig.app.json   # must be silent
npx vitest run --root apps/frontend                   # 667 tests, 37 files
npx oxlint apps/frontend/src                          # 14 cosmetic warnings, exit 0
npm run build -w apps/frontend                        # must succeed
```

**Do not typecheck with `tsconfig.json`.** It is a solution file with no
`files` and no `include`, so `tsc -p apps/frontend/tsconfig.json` typechecks
*nothing at all* and exits 0. Several "tsc is clean" reports in this project's
history were vacuous for exactly that reason. Use `tsconfig.app.json`, or
`npm run build`, which runs `tsc -b`.

| | |
| --- | --- |
| Branch | `rebuild/time-travel-and-physics`, nothing pushed, nothing merged |
| Typecheck | clean |
| Tests | **667** across 37 files |
| Lint | exits 0; 14 `only-export-components` warnings, all cosmetic |
| Build | clean, 1.44MB JS (gzip 452KB) + 111KB CSS (gzip 18KB) — still no code splitting |

**Read the failing-suite line, not the test count.** Vitest reports a suite
that failed to *load* separately from tests that failed, so a file that throws
on import still leaves the summary reading "474 passed". That has already
caused one bad commit here (`f0c359c` fixes it and says so). Check
`Test Files  N passed (N)` — the two numbers must match.

## 2. Where the work lives

`docs/CANVAS-SPEC.md` is the map: ~100 discrete capabilities from the product
brief, each marked **Shipped / Partial / Dead / Absent**, with the reasoning
and the phase plan at the bottom. It is kept current — update it in the same
commit as the code, not after.

**"Dead" is the important category and it is worse than "Absent."** A dead
field is declared on the schema, written by something, and read by nobody — so
the app *claims* a capability it does not have, and every reader downstream is
entitled to believe it. Ten have been found and killed so far. The most recent
was `TextNode.autoHeight` (Phase 5). The rule that follows from it: **never
declare a capability the renderer ignores**, and **a feature ships with the
control that gives it a purpose**.

Recent commits, newest first:

| | |
| --- | --- |
| `54697cd` | preview versioning, star/polygon geometry, connector colour in Appearance |
| `0b83d28` | the colour picker and gradient editor off inline styles |
| `e0fee09` | ruler/grid toggles, the dot field, focus mode, export, share sheet |
| `ccf0594` | board covers that survive being opened |
| `16b7858` | the canvas empty state |
| `f615fa8` | layer search |
| `2702a9a` | Phase 5 — text case, strikethrough, three-way text box resizing |
| `ed1db3d` | Phase 4 — anchor/handle editing, booleans, flatten, outline stroke |

## 3. The one thing that will waste your time if you don't know it

**Observing the running app is unreliable, but not impossible.** It worked for
most of the last session. When it fails it fails in these ways, and each has
cost real time here.

Historically the extension rendered its tab offscreen, so `rAF` never fired and
synthetic pointer events never reached the stage. That was *not* the experience
last session — clicks, drags and physics all ran. Assume it may work, verify
that it is actually ticking, and fall back to the techniques below when it is
not. The renderer also freezes outright on long scripts: keep injected snippets
small, and expect `Runtime.evaluate` timeouts on anything that loops over the
whole document.

Consequences, all of which have cost real time here:

- Nothing driven by rAF runs — that is *all* physics, and the camera loop.
- Clicking, dragging and throwing cannot be simulated. `computer` clicks look
  like they land and do nothing.
- A screenshot still renders, so the app *looks* alive. It is not ticking.

What works instead:

- Konva binds its listeners to **`stage.content`**, not `stage.container()`.
  Dispatching a real event on `stage.content` does reach it.
- `window.objectsMap` is the live Y.Map (long-standing debug hatch).
- Import app modules with `await import('/src/engine/document/index.ts')` — but
  Vite appends `?t=` to files you have just edited, so a plain import can hand
  you a **second module instance** with its own state. If a store looks empty
  when it should not, that is why. Reload rather than trusting it.
- Read **inline** styles, not computed ones. A hidden tab freezes CSS
  transitions at their start value, so `getComputedStyle(...).opacity` reads 0
  while the inline style correctly says 1.

**The user has since asked to minimise browser checking outright** — "let's
move faster, minimise testing and calling claude in chrome, let's focus on
building faster" — and the extension has been reliably unreliable since. Treat
that as the working agreement.

**So prefer writing a failing test to trying to watch the bug.** Every piece of
arithmetic in this codebase lives in a pure module for that reason —
`smartGuides`, `pathGeometry`, `pathBoolean`, `strokeOutline`, `imageCrop`,
`rulerTicks`, `stickyText`, `layerSearch`, `boardPreview` all run in Node with
no canvas. When you find arithmetic inside a component, that is the bug: move
it out and assert it. `previewPolygonPoints` was extracted for exactly this
reason after a star drew as a block twice.

**And check your test is not vacuous.** Revert the fix and confirm the test
fails. Two physics tests here passed with the fix removed; they were measuring
`activeCount` when the defect was in settle *churn*. The habit has caught real
things — `appearanceTypes.test.ts` was checked this way and, on a first draft
with too broad an invariant, flagged `sticky` and `audio` as bugs when neither
was one.

**But static rendering can be checked, and you should when the work is
visual.** Nothing static needs rAF. Import the real modules into the running
app and render into an injected overlay:
`await import('/node_modules/.vite/deps/react.js')` (note `.default`), and
`react-dom_client.js` exposes `createRoot` on **`.default`**, not as a named
export. Bust Vite's cache with `?bust=${Date.now()}` after editing. That is how
the cursor art was judged, and it caught three shapes that would otherwise have
shipped.

There is also a trick for feeding the app a file without a backend: generate a
PNG in-page and hand it to the existing hidden `<input type=file>` via a
`DataTransfer`. That is how the crop overlay was verified.

## 4. The invariants — break these and you will reintroduce a known bug

Each was learned from a real defect here and is documented at its source.

1. **`engine/document/mutations.ts` is the only write path.** Nothing else
   touches the Y.Map.
2. **`width`/`height` on `BaseNode` are the only source of bounds.** `geometry`
   is *what shape*, never *how big*. `appearance` is paint. Nothing is stored
   in both.
3. **All reads are normalized at the CRDT boundary** (`normalize.ts`), so no
   consumer ever sees a legacy field. Every function there is total — it never
   throws and never returns undefined for a required field.
4. **Any CRDT container created on demand can be created twice.** Two people
   reacting to a fresh sticky each build their own `Y.Map` and `set` it at the
   same key; one is discarded. Seed containers with the node. See
   `reactions.ts`.
5. **Ephemeral state rides awareness or an external store, never the
   document.** Which anchor *you* have picked, which image *you* are cropping,
   which frames *you* have folded shut — none of that is a fact about the
   board. `cropMode`, `pathEdit`, `guideState` and `tagFilter` are the pattern.
6. **Never declare a capability the renderer ignores**, and **ship a feature
   with the thing that gives it a purpose.**
7. **One source of truth, or a test that holds the copies together.** The
   properties panel gates each paint section on *two* things: the capability
   the registry declares, and a hand-maintained type list. The list forgot
   `connector`, so connectors had no colour control while the code that draws
   one sat right there looking correct. The list now lives in
   `engine/objects/appearanceTypes.ts` with `appearanceTypes.test.ts` holding
   it against the registry. Any time you find yourself writing a second list
   of types, write the test with it.
8. **A cache of derived data needs a version.** Board covers are summarised
   into `localStorage` and only rewritten when a board is opened, so a fix to
   the *renderer* cannot reach a board nobody has opened since. Bump
   `PREVIEW_VERSION` whenever `PreviewItem` changes meaning.

Konva specifics that have each cost a bug: `fillPriority` must be set on every
branch (Konva leaves stale fill props in place, and React does not unset props
it stops passing); filters need an explicit `cache()` and the cache must be
padded by three sigma or the blur clips flat against the node's edge; Konva has
no stroke alignment, no inner shadow, no shadow spread and no conic or diamond
gradient — all four are drawn by hand in `ShapeEffects.tsx` and
`paintPattern.ts`.

## 4b. What the recent sessions changed

Grouped by area. Everything here is committed; the reasoning is in the code
comments and the commit messages, which are the real record. Two sessions are
folded together here because the second one was mostly design work on what the
first one built.

**A design system, written down.** `DESIGN.md` is new and is the reference:
two layers of tokens (PRIMITIVES are raw values, SEMANTIC are roles), and
components reference roles only. The bug it exists to stop had already happened
five times — a raw palette primitive (`--amber-500`) used where the accent role
belongs, giving white-on-orange at ~2.15:1 in the badge, the share sheet, the
comments overlay and the switch. Two traps documented there and worth
repeating: **a CSS custom property resolves where it is declared**, so aliasing
a theme-dependent value on `:root` freezes the light value in dark mode
(`--focus-ring-color` did exactly this); and **`popIn` animates `transform`**,
which clobbers the `translateX(-50%)` that centres a popover, so four surfaces
appeared half their width to the right and snapped into place. Centre with the
independent `translate` property, which composes instead of losing.

**The rooms page** (`Home.tsx`) was rebuilt from scratch twice — the first
attempt was patched and the user's verdict was that it was still "super
confusing", which was correct. It is a rail plus a stage now, with Your boards
and Vega Studio templates as separate views rather than one merged scroll.

**Templates: 26, in five categories** (`art`, `design`, `diagrams`, `physics`,
`thinking`), up from 13. Built from typed `NewNodeInput` rather than JSON so a
schema rename fails the build instead of producing broken rooms. Includes
deliberate scale showcases at 100/500/1000 objects. Thumbnails come from the
same `build()` that makes the board, drawn through the same `WorkspaceCover`
the board cards use, so a card cannot drift from what it produces —
`build(limit)` exists because generating 1600 nodes to draw four thumbnails
froze the page.

**Physics became a mode rather than a toggle.** `engine/physics/` holds
`simulation.ts` (Matter.js), `forces.ts` and `flightState.ts`. What is worth
knowing before touching it:

- **Matter's `isStatic` is overloaded** as both "pinned" and "asleep" here.
  `SimNode.locked` is the separate, real "the user pinned this" flag, and
  `activate()` refuses to wake a locked body. That is what makes Pachinko pegs
  possible, and it is a control a user has.
- **"Just my selection" is scoping, not imprisonment.** The first attempt
  removed everything else from the world, so a 450-object board became a
  4-object one and objects fell through where their neighbours used to be. It
  uses Matter **collision categories and masks** now: out-of-scope bodies still
  exist and still collide, they just do not receive the force.
- **Freeze had to learn about the latch.** A latched field re-applied itself
  on the next tick, so freezing did nothing that lasted; `calmAll` clears the
  latch first.
- An "inert contact" rule was written, measured to change nothing, and
  **deleted** rather than shipped as dead code. Do the same.

**The canvas chrome.** Rulers and the dot grid are toggles in a View menu that
also carries Snap, Throw and Focus mode. The ruler switch is *structural*: the
stage is inset by `RULER_SIZE` so screen coordinates and ruler marks describe
the same world position, so hiding the rulers has to move the stage, the grid
offset, the panel clearance and both insets, or it strands a dead margin down
two edges. One flag drives all five.

**The dot field was never a grid.** It was declared on `.canvas-area` at a
fixed `0 0` while the camera loop wrote `backgroundPosition` to
`.canvas-container` — a different element with no background image — so it was
screen-fixed wallpaper that objects slid over and snapping did not describe.
Moving it exposed why it had lived on the parent: `.canvas-container` carries
`w-full h-full relative`, **Tailwind classes in a project with no Tailwind**,
so it was zero pixels tall. It asks `tickStep` for its pitch now — the same
function the rulers use — and holds 20–40px across a 160x zoom range.

**Board covers** draw the actual board from a `localStorage` summary: real
positions, sizes, silhouettes and colours, including text as ruled lines,
frames as paper with a hairline, rotation, outline-only shapes, and stars and
polygons generated from a side count and an inner ratio. The vertex maths is
`previewPolygonPoints` in `engine/model/boardPreview.ts`, pure and tested,
because the alternative is arithmetic inside JSX that can only be checked by
looking at a thumbnail — which is how a star drew as a block for two rounds.

**Sharing** rebuilds its link from the room id rather than echoing
`location.href`, which was carrying whatever query or hash was in the address
bar into an invitation meant to outlive the session. It also states plainly
that a link is full access, permanently — there are no roles here and the sheet
should not imply there are.

**Smaller, all user-reported:** the activity feed compared `author.id` against
`provider.awareness.clientID` — two different identifier spaces — so "is this
me?" was never true and it narrated your own actions back at you; an empty
board's preview key was *deleted* rather than written, collapsing "never opened
here" and "opened, and empty" into one absence so every empty board read "Not
opened on this device"; `[hidden]` lost to an author `display` rule and left a
tuning row on screen.

## 5. Next up

### 5a. The walkthrough project (this is still what the user asked for)

Agreed scope, in order. Two of five are done:

1. ~~**Demo rooms**~~ — done. **26 templates in 5 categories**, including
   deliberate scale showcases at 100/500/1000 objects.
2. **Per-tool guided walkthroughs.** *Not started, and this is the next
   substantial piece of the brief.* The agreed design: an arrow anchored to a
   real object that **advances by doing the thing**, not by a Next button. A
   wizard becomes the thing people dismiss, and it would contradict what makes
   the templates work — you learn connectors by dragging a box. The templates
   now give these somewhere to happen; launch a walkthrough *against* a
   matching template rather than an empty canvas. The user chose "scripted
   real mutations" over a recorded video when asked.
3. ~~**Visual refinement** of existing surfaces~~ — largely done; see §4b.
4. **New surfaces** — the canvas empty state and the rooms page are done. A
   **first-run onboarding** and a **marketing-grade first run** are not.
5. **A product page.** Not started.

**Session creation is the loose thread.** The share *sheet* was rebuilt, but
the flow that gets you a named board and shares it the first time was not
touched. The user asked for "session creation and sharing, end to end" and only
the second half landed. Start there if you want a short, well-defined piece.

Also outstanding and explicitly deferred by the user: **Supabase** for auth and
storage. They chose it over own-auth/PocketBase/Clerk. It is a multi-file change
across the server, a new schema with RLS, and moving voice notes out of the CRDT
into object storage — worth its own session. Note that voice notes are still
base64 inside the Yjs document; the bitrate fix cut that ~5x but did not solve
it.

### 5b. Watch Phases 3–5 (still partly unverified)

Concretely:

- **The 22px stage inset.** `Canvas.tsx` insets the Konva stage by
  `RULER_SIZE` so screen coordinates and ruler marks describe the same world
  position. If those disagree the ruler is *worse* than not having one. This is
  the single riskiest unverified change on the branch.
- Smart guide lines appearing during a drag, and ruler ticks relabelling
  sensibly across a zoom range.
- Guides dragging out of the rulers, snapping, and double-click to delete.
- Double-click a pen path → anchors and handles appear; drag an anchor, drag a
  handle, Alt-drag to break the pair, click the outline to insert, Delete to
  remove one. Watch that the selection box tracks the shape (that is
  `reframePath` doing its job).
- The four booleans on two overlapping shapes — especially **subtract
  producing a visible hole**, which is the whole reason compound paths exist.
- Outline stroke on a thick dashed line; flatten a rounded rectangle and check
  the corners are still round.
- Text: case switching without the stored text changing, strikethrough, and
  the three resize modes (auto-width must not wrap, fixed must ellipsize).

### 5c. The sticky bug that was never reproduced

Reported repeatedly: placing a sticky shows the "added a sticky note" toast but
**nothing appears on the canvas or in the layers panel**. Never once reproduced
on this machine across five attempts.

Two real defects were found and fixed while hunting it, either of which could
have been it:

- `CanvasEngine` optimistically added a new node to the visible set, and the
  next spatial query built a fresh set and assigned it over the top — dropping
  the node again unless the index had caught it within one frame. `Canvas` only
  rescues that when culling loses >50% of the board, so it was invisible on a
  tiny board and fatal on a real one. Now held in `pendingIds` until the query
  itself reports the id.
- An empty sticky is discarded when its editor closes. The note is created on
  **pointerdown**, and a real click takes ~100ms — long enough for the editor to
  mount and autofocus, so **pointerup** blurred it and destroyed the note. This
  is timing-dependent, which is why synthetic events (which fire down and up in
  one tick) never reproduced it.

If it recurs, the next thing to check is `useStore.getState().isReplaying` —
stuck `true`, the store ignores *all* live document traffic, which produces
exactly this signature and has nothing to do with stickies.

### 5d. The two panels — a build phase

The user's brief for this is long and specific; the short version is that both
panels exist, both are functional, and both are thin against what the brief
asks for. What follows is an audit, not a wish list.

**`components/LayersPanel.tsx` (913 lines) already does:** a virtualized
uniform-row tree (frames and group clusters, indented), inline rename, drag
reorder, per-row visibility and lock toggles, Shift-range and Cmd-toggle
multi-select, per-frame collapse held outside the CRDT, tag filtering, type
icons, and "so-and-so is editing this" badges from awareness. The
virtualization is load-bearing: a DOM row per object measured at 27ms per
document change with 500 objects, which was ~88% of the cost of moving one.

**What the brief asks for that is missing:**

- ~~Search and filter by name and by node type.~~ **Done** (`f615fa8`).
  Subsequence matching with a two-pass ranker in
  `engine/model/layerSearch.ts`, marked hits in the row, type chips for the
  types the document actually contains, and a flat ranked list while filtering
  rather than a filtered tree. Enter selects every match.
- **Keyboard navigation of the panel itself.** ↑/↓ to move, ←/→ to fold and
  unfold, Enter to rename, Cmd+↑/↓ to reorder, Space for visibility. The brief
  explicitly asks for the power-user path and there is currently none.
- **Frame wrapping** — turn a selection into a frame.
- **Reparenting by drag**, not just reordering.
- Section, Component, Instance and Mask node types. These are **blocked**:
  sections and masks are their own features, components are Phase 7.

**`components/PropertiesPanel.tsx` (1895 lines) already does:** Transform
(X/Y/W/H with aspect lock, rotation, flip), Appearance (fill with all five
paint types, opacity, corner radius, blend), Stroke (colour, weight, dash
preset, alignment, join, miter limit), Shadow, Inner Shadow, Blur (layer and
backdrop, together with the shadows — they are all effects), Typography
(family, size, weight, italic, underline, strikethrough, case, alignment, line
height, tracking, box resizing), plus per-type blocks for Star, Polygon, line
Ends, frame Safe Area, image Adjust, Sticky, Physics and Metadata — **and
multi-selection with a real mixed-value state throughout**, which is the
largest item this section used to list as missing.

**What the brief asks for that is missing:**

- ~~**It shows nothing for a multi-selection.**~~ **Done.** `Room.tsx` threads
  `selectedIds` through, capabilities are the *intersection* across the
  selection rather than the union, and a field where two objects disagree
  reads *Mixed* and writes to all of them when edited. `sharedPaint` /
  `shared` are the helpers; there are ~49 mixed-state call sites.
- **It shows nothing when nothing is selected.** The brief wants global canvas
  state there: background colour, measurement units, ruler/grid visibility
  toggles, and the document's styles.
- **Independent corner radii and corner smoothing.** One uniform radius today;
  the brief wants four corners and a squircle parameter.
- Constraints/pinning grid and Auto Layout are **Phase 6**; component link,
  variants and exposed properties are **Phase 7**. Do not start those here.

**Suggested order from here**: panel keyboard navigation → global canvas
state when nothing is selected → independent corner radii → frame wrapping and
drag-reparenting.

Two things newly visible on connectors, now that they finally reach the paint
sections at all: **Blend is deliberately hidden for them** — a connector's job
is to stay legible across whatever it crosses, and multiply darkens it into the
shapes it runs over — while **Blur is still offered and probably should not
be**. Backdrop blur on a hairline is close to meaningless. That was noticed and
left alone rather than changed past what was asked for; it is a two-line fix
next to the `hasConnector` gate if you agree.

### 5e. Still logged, from earlier phases

- **Real nested groups + deep select.** Groups are flat: members share a
  synthetic `parentId` and there is nothing to select *into*. This is a model
  change, and it is the same one auto-layout needs — so it belongs with
  **Phase 6**, not with selection or with the layers panel.
- **The scale tool** — distinct from the transformer, which resizes geometry;
  a scale tool multiplies strokes, radii, shadows and type along with the box.
  Only now well-defined, since all four of those became real.
- **Layout grid overlays**, which want a per-frame grid definition and belong
  with the frame work.
- **A compound path cannot be edited anchor by anchor** — the editor walks one
  run of anchors and a compound path is several.
- **Booleans decline on a rotated or scaled operand.** The geometry would need
  to go through the node's full transform first. The buttons disappear rather
  than producing a result that ignores the rotation.
- **Paragraph spacing, kerning and OpenType are one decision, not three.** All
  three want text off Konva's `Text` and off the `<textarea>` overlay. Worth
  making once, deliberately.
- **The shell around the canvas.** No router — every navigation is a full page
  reload rebuilding the Y.Doc. No workspace deletion. The dashboard reads
  `localStorage` only. No landing page.
- **Bundle splitting.** 1.33MB in one chunk.
- **Two real browsers with two real mice** — still the one check automation
  cannot stand in for.

### 5f. Not started from the brief

Excalidraw-style ideas, mermaid diagrams, wireframe-to-code, and the laser
pointer. The laser pointer is small and independent (it is ephemeral presence
state — see invariant 5) and could be slotted in any time.

## 6. Environment notes

- **`@hocuspocus/server` version skew** is the classic trap. Confirm 4.4.0:
  `node -e "console.log(require('./node_modules/@hocuspocus/server/package.json').version)"`.
- Vite picks the first free port from 5173. **Each port is a separate origin**,
  so `localStorage` and IndexedDB do not carry across ports. If the dashboard
  looks empty or you appear as a different user, check the port.
- Server changes need `docker compose up -d --build server`.
- Physics is behind the **Throw** switch for flicks only, persisted per origin
  — if throwing seems dead, check `vega_physics_enabled` in `localStorage`
  before debugging the simulation.
- Rooms in Postgres are recreated by the sync server while a client is still
  connected. Close the tab *before* deleting a test room.
- `apps/frontend/public/` holds favicon and logo assets the owner is editing
  directly. They show as modified/untracked in `git status` and are **not**
  part of this work — do not stage them.

## 7. Where things live

`README.md` has the full map. Read these first, in this order:

1. `engine/model/schema.ts` — the data model everything obeys
2. `engine/document/` — CRDT ownership, the single write path, normalization
3. `hooks/useStore.ts` — the one bridge from document to UI
4. `components/Canvas.tsx` — input, tools, camera, the shared transformer
5. `docs/CANVAS-SPEC.md` — what exists, what does not, and why

The vector engine (newest, and the densest):

| File | What it owns |
| --- | --- |
| `engine/model/pathGeometry.ts` | cubics, flattening, splitting, anchor-centric conversion, hit-testing. Pure, tested. |
| `engine/model/shapeToPath.ts` | every primitive → a real path. Pure, tested. |
| `engine/model/pathBoolean.ts` | the four booleans, over `polygon-clipping`. Pure, tested. |
| `engine/model/strokeOutline.ts` | a stroke → a filled region. Pure, tested. |
| `engine/document/vectorOps.ts` | the same operations as document edits |
| `components/canvas/PathEditor.tsx` | anchors and handles on screen |
| `engine/interaction/pathEdit.ts` | which path is open, which anchor is picked |

The precision tools:

| File | What it owns |
| --- | --- |
| `engine/interaction/smartGuides.ts` | alignment and spacing arithmetic. Pure, tested. |
| `engine/interaction/objectSnap.ts` | the adapter: candidates, zoom tolerance, re-entrancy guard |
| `engine/interaction/rulerTicks.ts` | tick steps and labels. Pure, tested. |
| `engine/document/guides.ts` | ruler guides, as document state on a root `Y.Array` |

Physics, templates and the product shell (newest):

| File | What it owns |
| --- | --- |
| `engine/physics/simulation.ts` | the Matter world: bodies, scoping by collision category, `locked` vs asleep, gesture bookkeeping |
| `engine/physics/forces.ts` | the force catalogue, latch durations, falloff curves, the wording shown in the panel |
| `engine/physics/flightState.ts` | what is mid-throw, kept out of the document |
| `hooks/usePhysics.ts` | the React side: arming a force, latching, `calmAll` |
| `engine/templates/templates.ts` | 26 templates as typed `NewNodeInput`, with `build(limit)` for thumbnails |
| `engine/model/boardPreview.ts` | the board summary in `localStorage`, `PREVIEW_VERSION`, `previewPolygonPoints`. Pure, tested. |
| `components/WorkspaceCover.tsx` | that summary drawn as SVG — the only thumbnail renderer, shared by boards and templates |
| `engine/objects/appearanceTypes.ts` | which types carry an `appearance` block, held against the registry by a test |
| `Home.tsx` | the rooms page: rail, stage, boards and templates as separate views |
| `DESIGN.md` | the token layers and the named rules. Read before touching `index.css`. |
