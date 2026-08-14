# Handoff

Written so the next session can start cold. Read this, then `docs/CANVAS-SPEC.md`.

**This supersedes every previous handoff.** The presence/physics archaeology
that used to fill this file has been folded into the commit messages and the
spec; `git log` is now the record of *why*, and `docs/CANVAS-SPEC.md` is the
record of *what exists*. This file is only: how to run it, what will waste your
time, where the work stopped, and what is next.

> ## Read this first
>
> **A large session of feature and bug work has landed on this branch and is
> now committed.** Most of it *was* watched running — the Chrome extension
> cooperated for long stretches this time — and every claim below that says
> "verified" was measured in a browser, not inferred.
>
> Two things are explicitly **not** verified, and they are the first places to
> look if something is off:
>
> 1. **The audio recorder has never met a real microphone.** Bitrate, mime
>    type and the save control are correct by construction and by typecheck;
>    nothing has recorded a sound.
> 2. **"Empty text/sticky is discarded on abandon" was not watched.** The
>    guard that stops a *just-created* note being destroyed by its own opening
>    click was verified; the path where you genuinely walk away from an empty
>    one holds by construction (past a 600ms window it falls through to the old
>    behaviour) but was never observed. Place a note, wait a second, click away
>    — it should vanish.
>
> One long-running report was never reproduced and may still be live: **"the
> sticky note does not appear at all, but a toast says one was added."** The
> most likely cause was found and fixed (see §5c), but on the reporter's
> machine it was intermittent and on this one it never occurred.

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
npx vitest run                                        # 643 tests, 34 files
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
| Tests | **643** across 34 files |
| Lint | exits 0; 14 `only-export-components` warnings, all cosmetic |
| Build | clean, ~1.4MB JS (gzip ~430KB) — still no code splitting |

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
| *(this commit)* | connectors, export + restore, tooltips, templates — see §5c |
| `2702a9a` | Phase 5 — text case, strikethrough, three-way text box resizing |
| `ed1db3d` | Phase 4 — anchor/handle editing, booleans, flatten, outline stroke, join/miter |
| `410e96d` | Phase 3 recorded, and what it left blocked on the group model |
| `f0c359c` | the snap tests were not loading; the count was lying |
| `a4b3905` | rulers, and guides you can pull out of them |

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

**Because of all this, prefer writing a failing test to trying to watch the
bug.** Every piece of arithmetic in this codebase lives in a pure module for
that reason — `smartGuides`, `pathGeometry`, `pathBoolean`, `strokeOutline`,
`imageCrop`, `rulerTicks`, `stickyText` all run in Node with no canvas.

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

Konva specifics that have each cost a bug: `fillPriority` must be set on every
branch (Konva leaves stale fill props in place, and React does not unset props
it stops passing); filters need an explicit `cache()` and the cache must be
padded by three sigma or the blur clips flat against the node's edge; Konva has
no stroke alignment, no inner shadow, no shadow spread and no conic or diamond
gradient — all four are drawn by hand in `ShapeEffects.tsx` and
`paintPattern.ts`.

## 4b. What the last session changed

Grouped by area. Everything here is committed; the reasoning is in the code
comments, which are the real record.

**Connectors.** `normalizeType`'s allow-list never got `connector`, so *every*
connector was silently rewritten into a shape — no error, just the wrong node.
The union is now derived from a `NODE_TYPES` const so the list cannot drift
again. Curved routing drew a straight line (two points plus Konva `tension`,
which needs three or more); it is a sampled cubic Bézier leaving each port
along its normal. Connector ends went from one boolean per end to six kinds
(none/arrow/triangle/circle/diamond/bar), with the run trimmed back under each
marker. Derived bounds now sync on a trailing delay, so a connector no longer
vanishes when its stale box leaves the viewport.

**Export.** Three formats became six (PNG/JPEG/WebP/SVG/PDF/JSON) with a live
preview, size estimate, per-format settings derived from a `FORMAT_SPECS`
table, batch export of every frame, and copy-to-clipboard. **The PDF writer is
hand-rolled** — five objects and an xref table, ~80 lines, no dependency —
because jsPDF/pdf-lib cost 300–400KB for one page holding one image.

**Restore.** The JSON export called itself "best for backups" and nothing could
read one back. There is now a validating parser, a single-transaction restorer,
and a "rebuild a board from a backup" path on the rooms page. That last one
matters: the in-room restore is unreachable for someone who cleared their
browser, which is exactly who needs it.

**Templates.** Thirteen editable boards in five categories, built from typed
`NewNodeInput` rather than shipped as JSON so a schema rename fails the build
instead of producing broken rooms. Includes deliberate scale showcases —
Bloom (500), Wave field (1000), Spectrum (360), Domino wall (200). Thumbnails
are computed from the same `build()` that makes the board and drawn through the
same `WorkspaceCover` the board cards use, so a card cannot drift from what it
produces. `build(limit)` exists because generating 1600 nodes to draw four
48-item thumbnails froze the page.

**Tooltips.** Were `position: absolute` pseudo-elements, so both scrolling side
panels clipped them. **z-index cannot fix that** — it orders within a stacking
context and has nothing to do with `overflow`. There is now one `position:
fixed` node at the app root reading the same `data-tooltip` attributes, so no
call site changed.

**Transformer.** Eight vertices with corners and edge-midpoints shaped
differently (a corner scales both axes, an edge one), rotation-aware cursors in
a tested pure module, and a centre mark shown only while dragging.

**Other fixes worth knowing:** hover and click now share one `canSelectWith()`
predicate, so the hover outline can no longer promise a click the tool will
refuse; `NodeEditor` was positioning a `position: fixed` overlay from *stage*
coordinates, putting every text caret 22px left and 74px above its object; text
bounds never tracked auto-width content, so selection boxes were a fraction of
the words; images loaded with `crossOrigin='anonymous'` and failed outright
when the host sent no CORS header (now falls back); uploads were fixed 300×300
regardless of aspect.

## 5. Next up

### 5a. The walkthrough project (this is what the user asked for next)

Agreed scope, in order:

1. ~~**Demo rooms**~~ — done, 13 templates in 5 categories.
2. **Per-tool guided walkthroughs.** The agreed design: an arrow anchored to a
   real object that **advances by doing the thing**, not by a Next button. A
   wizard becomes the thing people dismiss, and it would contradict what makes
   the templates work — you learn connectors by dragging a box. The templates
   now give these somewhere to happen; launch a walkthrough *against* a
   matching template rather than an empty canvas.
3. **Visual refinement** of existing surfaces.
4. **New surfaces** — onboarding, empty states, marketing-grade first run.
5. **A product page.**

Also outstanding and explicitly deferred by the user: **Supabase** for auth and
storage. They chose it over own-auth/PocketBase/Clerk. It is a multi-file change
across the server, a new schema with RLS, and moving voice notes out of the CRDT
into object storage — worth its own session. Note that voice notes are still
base64 inside the Yjs document; the bitrate fix cut that ~5× but did not solve
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

**`components/LayersPanel.tsx` (596 lines) already does:** a virtualized
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

**`components/PropertiesPanel.tsx` (1148 lines) already does:** Transform
(X/Y/W/H with aspect lock, rotation, flip), Appearance (fill with all five
paint types, opacity, corner radius, blend), Stroke (colour, weight, dash
preset, alignment, join, miter limit), Shadow, Inner Shadow, Layer Blur,
Backdrop Blur, Typography (family, size, weight, italic, underline,
strikethrough, case, alignment, line height, tracking, box resizing), plus
per-type blocks for Star, Polygon, line Ends, frame Safe Area, image Adjust,
Sticky, Physics and Metadata.

**What the brief asks for that is missing:**

- **It shows nothing for a multi-selection.** `Room.tsx` passes `selectedId`
  (singular), so selecting three objects gives you "Select an object". This is
  the most conspicuous gap in the panel and almost certainly part of what
  "weak and poorly implemented" refers to. Doing it properly means a mixed-value
  state — a field where two objects disagree shows *Mixed* and writes to all of
  them when edited.
- **It shows nothing when nothing is selected.** The brief wants global canvas
  state there: background colour, measurement units, ruler/grid visibility
  toggles, and the document's styles.
- **Independent corner radii and corner smoothing.** One uniform radius today;
  the brief wants four corners and a squircle parameter.
- Constraints/pinning grid and Auto Layout are **Phase 6**; component link,
  variants and exposed properties are **Phase 7**. Do not start those here.

**Suggested order from here**: properties for a multi-selection (with Mixed)
→ panel keyboard navigation → global state when nothing is selected →
independent corner radii → frame wrapping and drag-reparenting.

The multi-selection one is the biggest single win left in either panel:
`Room.tsx` passes `selectedId` (singular) to `PropertiesPanel`, so selecting
three objects shows "Select an object". Doing it properly means threading the
whole selection through and giving every field a mixed-value state — a control
where two objects disagree reads *Mixed* and writes to all of them when
edited.

### 5c. Still logged, from earlier phases

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

### 5d. Not started from the brief

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
