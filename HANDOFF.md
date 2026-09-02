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
> **The last session was a long bug-and-feature pass with no working browser.**
> The Chrome extension would not connect at all, so nothing was watched: every
> claim below is held up by a test or by arithmetic, and none of it by eye. The
> standing instruction is still "minimise testing and calling claude in chrome,
> focus on building faster" — take it seriously, it is the working agreement —
> but know what shape the misses take.
>
> **Almost everything found was one of three mistakes, and each has a rule.**
>
> **1. Two derivations of one answer.** The oldest lesson here (invariant 7) and
> still the most productive. This session it was: a sticky's text box computed
> in three places, so reacting to a note resized its handwriting and clicking
> into a tagged one resized it again; the pen tool's preview and its commit each
> building segments from the same anchors with different code; the reaction tray
> being a second popover implementation that had none of the flipping the shared
> one has had all along; and `hasFooter` derived from `Object.keys(reactions)`
> while the thing it gated was derived from the filtered list.
>
> **2. A quantity in the wrong unit or the wrong space.** Newly promoted to an
> invariant (see 9 and 10) because it happened four times in one session:
> - The contextual rail converted world → *stage* coordinates and then placed a
>   DOM element in *window* coordinates. It was drawn a ruler's width up and to
>   the left of its object. Three separate rounds of raising the standoff were
>   spent compensating for it, and the asymmetry was the clue nobody read — the
>   gap above looked right precisely because it had 28px added, and the gap
>   below was short by the same 28px.
> - Alt-drag's duplicate threshold was compared in world units, so a wobble
>   duplicated at 10% zoom and a real drag refused at 500%.
> - The pen's handle-drag threshold, the same.
> - The rail's standoff was measured to the rail's box while the thing that
>   lands on the artwork is its *shadow*, which reaches ~20px past it.
>
> **3. A field the renderer draws and nothing honours.** Invariant 6, again.
> `pinned` was drawn on every pinned sticky, offered in two places, described in
> the properties panel as "stays put" — and read by nothing. The pin itself was
> `listening={false}`, so it was also a control you could not press.
>
> **What the absence of a browser cost, specifically:** the rail bug above is
> visual and would have taken one screenshot to see. It took three rounds of the
> user saying "more clearance" and a hard look at `NodeEditor` — which has
> always added the stage origin — to find. When a report is about *position* and
> the fix does not hold, stop tuning the number and check the coordinate space.

---

## 1. Start here

```bash
docker compose up -d              # Postgres, Redis, MinIO, sync server (:3000)
npm install                       # only if node_modules looks stale — see §6
npm run dev -w apps/frontend      # :5173
```

Verify in ~30 seconds:

```bash
npm run build -w apps/frontend                        # tsc -b + vite build
npx vitest run --root apps/frontend                   # 2244 tests, 129 files
npx vitest run --root apps/server                     # 75 tests, 9 files
npx oxlint apps/frontend/src                          # 0 warnings, 0 errors, exit 0
```

**`npm run build` is the only typecheck that matches CI, and it is first in
the list for that reason.** Two ways to fool yourself here, one of which cost
a broken production deploy on 2026-09-01:

- `tsc -p apps/frontend/tsconfig.json` typechecks **nothing at all** and exits
  0 — it is a solution file with no `files` and no `include`. Several "tsc is
  clean" reports in this project's history were vacuous for that reason.
- `npx tsc --noEmit` at the package root checks a *different file set* than
  the build. It passed on a temporal-dead-zone error in `MermaidModal.tsx`
  that failed Vercel with TS2448 and blanked the canvas at runtime. Build mode
  (`tsc -b`) resolves the project references; a bare `--noEmit` does not.

`tsconfig.app.json` is fine for a fast inner-loop check. It is not the check
to trust before pushing.

Last verified 2026-09-01, by running the four commands above. Every figure in
it is a second record of something the tools will tell you in 30 seconds — when
it disagrees with them, they are right and this is stale.

| | |
| --- | --- |
| Branch | `main`, level with `origin/main`. `grid-slots-and-notices`, `rebuild/time-travel-and-physics` and `session-2` are history, not workspaces |
| Deployed | **live**: Vercel (`vscanva.vercel.app`) → Render (`vega-canva.onrender.com`) → Neon → Cloudflare R2 → Sentry |
| Typecheck | clean via `npm run build` |
| Tests | **2244** across 129 files (frontend, 1 skipped — see `BENCH` below); **75** across 9 files (server) |
| Lint | exits 0; 0 warnings, 0 errors |
| Build | clean. **38 JS chunks**, 2.7MB raw / ~870KB gzip, plus 216KB CSS. Largest: `Room` 527KB, `vendor-sentry` 475KB, `vendor-fontkit` 357KB, `vendor-konva` 310KB, `app-diagram` 259KB, `app-export` 254KB |

The eager first-paint set is *not* that total. `vite.config.ts` filters the
dashboard's `modulepreload` down to three files — the runtime, the icons and
the stylesheet — so `vendor-sentry`, `app-diagram`, `Room` and the rest arrive
only when something asks for them. Check `dist/index.html` if you change that
filter; it is the only place the effect is visible.

**One test is skipped on purpose.** The 10,000-node spatial benchmark runs
under `BENCH=1 npx vitest run stressTest` and prints its numbers rather than
asserting them. It asserted a wall-clock threshold once, failed at 1.47ms
against a 1.0ms bar, and starved an unrelated source-scanning test past its
timeout on the way. A benchmark's output is a number to compare against last
week's, not a boolean.

**The build is code-split now**, by hand: `vite.config.ts` names the vendor and
subsystem chunks rather than leaving Rollup to produce a `browser-module` that
says nothing about why the bundle grew. The row above used to end "still no
code splitting" and §5e used to carry it as an outstanding task; both were
true, and both stopped being true without either being struck.

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

Recent commits, newest first. **This table is a copy of `git log` and it goes
stale between every session — check the log before trusting a "newest".** As of
2026-08-27 the newest is `925d179`, and the twelve above `e531549` are all
newer than anything listed here:

| | |
| --- | --- |
| `925d179` | identity: a face, a colour of one's own, and a working L key |
| `3131634`… | the pen and sketch arc — five commits, through `cabbd13` |
| `9172b53` | the radar's people list given room to be read |
| `803826a`… | the line-profile and arrowhead arc — five commits, through `383e2b8` |
| `e531549` | the export rewrite and the two disappearances, written down |
| `595497a` | the rail stops vanishing; white gets a ramp |
| `b11b3e7` | a copy contains what it says it contains |
| `f7780b0` | the four combines work on turned shapes, and subtract turns the right way round |
| `d2d61a3` | the rail drawn where the object actually is |
| `54a9ad4`… | the line-profile arc — see §4a-iv. Twelve commits; read that section rather than the log |
| `f047011` | a line's box becomes what it draws; endpoints move into `geometry` |
| `a605dec` | the hooks-order bug that emptied the canvas on double-click |
| `42efea7` | selection restored after a tool change (a stale `React.memo` comparator) |
| `006d92e` | connectors: anchored binding, draggable ends, and the shape that moved while you drew |
| `f848435` | Blend and Blur hidden for connectors |
| `417ec41` | the keyboard audit recorded; §5a-ii restored |
| `260bcab` | the keyboard audit — nudge, Cmd+A and `?` bound, the help screen corrected |
| `44d807e` | diagrams as code, the line/arrow rework, the right-click menu, help, text layout |
| `5cebd12` | connectors given the appearance block they were declared to have |
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

**In the most recent session it did not connect at all**: `tabs_context_mcp`
returned "Browser extension is not connected" for the whole session, so nothing
was observed. That is survivable for arithmetic and expensive for anything
positional — the rail was drawn a ruler's width off for three rounds of user
reports because the only evidence available was the user's description. **When a
report is about where something is and the fix does not hold, stop tuning the
number and check the coordinate space** (invariant 10).

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

   **The prose form of this is the same bug and has no compiler.** The help
   modal's key list, and this file's own "what is missing" lists, are second
   records of a fact the code already holds. Both have been wrong in the same
   week: four shortcuts advertised and unbound, and two sections here still
   listed as missing after they shipped — one of them struck by the very commit
   that edited this file. Where a list can be derived, derive it
   (`TOOL_SHORTCUTS` → the help screen's tool rows). Where it cannot, strike it
   in the commit that finishes the work, never afterwards.
8. **A cache of derived data needs a version.** Board covers are summarised
   into `localStorage` and only rewritten when a board is opened, so a fix to
   the *renderer* cannot reach a board nobody has opened since. Bump
   `PREVIEW_VERSION` whenever `PreviewItem` changes meaning.
9. **A gesture threshold belongs in screen pixels; geometry belongs in world
   units.** A threshold is a statement about a hand on a screen, so judging it
   in world units makes it mean something different at every zoom: Alt-drag
   duplicated on a half-pixel wobble at 10% and refused a twenty-pixel drag at
   500%, and the pen's handle-drag did the same. Multiply by `camera.zoom`
   before comparing. `altDuplicate.travelledEnough` and
   `penSession.isHandleDrag` both take the zoom for exactly this reason, and
   both have a test that pins it.
10. **Know which space a coordinate is in, and convert once.** There are three
    here and they are not interchangeable: **world** (what the document
    stores), **stage** (`world * zoom + camera.x`, an offset inside the Konva
    stage), and **window** (what a DOM overlay is positioned in). The stage does
    not start at the window's corner — it is inset by the rulers — so a DOM
    element placed from a stage coordinate is wrong by that inset. `NodeEditor`
    adds `getBoundingClientRect()` of `.konvajs-content`; `ObjectContextToolbar`
    did not, and was drawn a ruler's width off for as long as it existed. If you
    are positioning DOM against canvas content, add the stage origin.
11. **During a gesture, the document is stale on purpose.** A drag writes to
    `liveTransformStore`, not the CRDT — that is what keeps a sixty-frame drag
    from being sixty updates. Anything that needs to *follow* the gesture must
    read the live store with the document as the fallback, which is the rule
    every renderer already follows. The selection handles did not, and sat where
    the object had been until the drop.
12. **A state that only its owner can revoke will eventually get stuck.** Six
    components dispatch `canvas-drag-start` / `canvas-drag-end`, and one boolean
    listened. Konva does not fire `dragend` for a node destroyed mid-drag, and
    every handle that sends these events is conditionally rendered — so one
    interrupted gesture hid the contextual rail *for the life of the page*. A
    missing `end` is a shape, not a bug you can finish finding: there is always
    one more path that skips it. Give the state something that can falsify it
    from outside — `railVeil.settle` uses "the pointer came up and nothing is
    being typed into", which is a fact about the world rather than a promise
    from a sender. If you add a new begin/end pair, ask what clears it when the
    sender dies.
13. **The Konva stage is not the document.** It holds *less*, because the canvas
    culls to the viewport — so a synchronous capture of a board wider than the
    window produced an image of the right size with the off-screen half blank.
    And it holds *more*, because it carries every object regardless of what the
    export was scoped to — so a selection-scoped PNG contained the neighbours
    the SVG of the same selection did not. Anything reading pixels off the stage
    must declare what it needs mounted (`renderScope`), wait for the commit, and
    hide what it does not want (`isolateObjects`). And mounting is not drawing:
    an image node is an empty rectangle until it loads, which is why
    `imagesReady` counts the document's images against the stage's.
14. **A comment describing behaviour is not the behaviour.** `tintsAndShades`
    said the colour sits "wherever its value places it" and had always placed it
    dead centre. `frameExportBounds`, `autoHeight` and `SvgPaintDefs.markup()`
    were all the same shape. When a docstring makes a claim about output, the
    cheapest thing you can do is write the assertion it implies — that is how
    this one was found, and it was one line.

15. **Curving a segment is not rounding a corner.** They sound like the same
    request and they are different operations: a bend moves the *middle* of a
    segment and leaves its ends alone, so a run of bent segments still has every
    one of its corners. Rounding needs the run to arrive at a point and leave it
    along one shared direction — which, with one quadratic per segment and the
    vertices fixed, is over-determined and sometimes unsolvable. That is why
    `smooth` is a flag that changes how the points are *drawn* rather than a
    pass that writes bends. The general lesson: when a feature cannot be
    expressed in the representation you have, say so and change the
    representation, rather than shipping the nearest thing it can express.
16. **A glyph means one thing.** Two controls sharing an icon is how someone
    learns the wrong thing about one of them, and it is invisible to every test
    here. The dock's tools (`ToolWorkspace.tsx`) own their glyphs; grep before
    you pick one for the rail.
Konva specifics that have each cost a bug: `fillPriority` must be set on every
branch (Konva leaves stale fill props in place, and React does not unset props
it stops passing); filters need an explicit `cache()` and the cache must be
padded by three sigma or the blur clips flat against the node's edge; Konva has
no stroke alignment, no inner shadow, no shadow spread and no conic or diamond
gradient — all four are drawn by hand in `ShapeEffects.tsx` and
`paintPattern.ts`.

## 4a-0. Pictures in grid modules

Select pictures and a grid and press **Place in grid** (the rail, or the
right-click menu), or drop image files straight onto a module. Each picture is
covered — scaled to fill, centre-cropped through the existing `crop` field,
never stretched — and clipped to the module.

Four files, and the split is the point:

| File | What it owns |
| --- | --- |
| `engine/grid/gridSlot.ts` | the arithmetic — cover crop, module box under rotation, world→grid-local, hit test, fill order. Pure, 35 tests |
| `engine/grid/gridReflow.ts` | what has to change, as patches. Pure, 15 tests |
| `engine/grid/gridSlotApply.ts` | the store reads, the writes, and the subscription |
| `ObjectRenderer.tsx` | the clip path, for modules a rectangle cannot express |

Three decisions worth not relitigating:

- **A slotted picture is an ordinary `ImageNode` with a `gridSlot` binding**,
  not a source on the grid's recipe. It therefore keeps Adjust, crop, the
  Layers panel and every exporter *for free*; the recipe version would have
  needed a second image path in all three exporters and would have put the
  pictures out of reach of every control that already exists.
- **The box is written through, not derived on read.** A connector recomputes
  its points on every read and stores nothing, and the reason a picture does
  not is that a connector is special-cased in every consumer that needed to
  know: the spatial index, culling, the selection outline, the transformer,
  smart guides and `computeContentBounds` all read `x`/`y`/`width`/`height`
  straight off the node. Writing through teaches none of them anything.
- **The reflow observes the document rather than being called.** A grid's box
  moves under a drag, the transformer, a nudge, an align, a distribute, a panel
  edit — *and* an undo, *and* a collaborator on another machine. The last two
  have no local call site to add a line to, which is what settles it. It cannot
  loop because only differences are written, and that same property is why
  every client can run it: they all compute the same answer, the first writes
  it, the rest find it already true.

### Modules hold captions too

Double-click an empty module and type. A caption is a `TextNode` with the same
`gridSlot`, pinned to `resize: 'fixed'` because the module decides the box —
the other two resize modes let the box follow the text, so a caption would grow
out of its module on the third line and be dragged back by the next reflow, the
box fighting the typing. `GridSlot` is declared **once** in `schema.ts` and
shared by both node types; `focus`/`zoom` are simply never written for text.

### Reframing a picture inside its module

Arrow keys move the picture *within* the module, because its box belongs to the
grid and the ordinary nudge would be a keypress the reflow silently undid.
Zoom and Recentre are on the rail under **Reframe**.

The framing is stored as a **focal point and a zoom, not as a crop** — that is
the load-bearing decision. A crop has the module's aspect ratio baked in, so
when the module changes shape there is no way to recover which part of the
picture the person cared about: re-covering re-centres and throws their framing
away, keeping it stretches the picture. A focal point is aspect-free, which is
why every image CMS stores one.

### What happens when you cycle through arrangements

**This was got wrong the first time and the fix is the interesting part.**

Module counts across the kinds run from **one** (manuscript) to **thirty-six**
(orbit), so cycling arrangements repeatedly asks nine pictures to fit into four
and then into thirty-six. The first implementation **released** whatever did not
fit — dropped the binding, left it where it was. That is defensible for a
deliberate "make this 2x2" and badly wrong for the gesture people actually
perform: try five arrangements and the fifth has permanently loosened your
photographs into a pile on top of the grid, and going back does not bring them
home. **A gesture for exploring must not destroy anything.**

Nothing is released by changing a grid now. Content with no module **waits** in
a strip below the grid, still bound, ordered by the module it came from, and
walks back into place the moment an arrangement with enough modules comes round
again. `gridReflow.test.ts` pins the round trip. Releasing is only ever
something a person asks for — the rail's **Remove from grid**, which also puts
the picture back to its own proportions, because the cover crop was the
module's framing and not the picture's.

The strip says what it is: the rail shows a count of what is waiting, because a
state nobody can name is the "invisible state" objection parking has to answer.

### Which grids this works for

All of them, and the rule is **derived rather than listed**. A module can hold
content if it is at least `MIN_SLOT_SIZE` (32) across its smaller side —
`canHoldContent`. At the default 600x400 that excludes exactly one kind, orbit,
whose modules are 22-unit dots, and admits a baseline grid's shallow strips,
which hold a letterboxed photograph perfectly well. A *large* orbit grid's
modules pass, which a hardcoded list of kinds could never get right. The list
would also have been a second record of a fact the geometry already carries.

### Still not built

A file-picker button in the grid panel (today you drag files in or place
pictures already on the board), and `contain` as an alternative to `cover`.
`gridSlotApply.ts` has no tests of its own — the arithmetic and the planning
under it do, which is the same division `gridApply.ts` already has, but the
**swap** in `reassignGridSlot` is decision logic that nothing pins.

## 4a-1. Notices, and the five surfaces that became two

There were five ways this application said something, and two of them said the
same sentence in different words: the header's sync dot read *"Offline. Changes
are saved on this device"* while a banner four inches away read *"Working
Offline. Changes will sync automatically."* The banner was **fifteen inline
style properties**, which `DESIGN.md` forbids for the reason it forbids all of
them.

The distinction that collapses them:

> **An event is something that happened. A state is something that is true.**

Being offline is a state — it persists, it does not want reading twice, and it
was already visible in the header. A banner parked over the canvas for its
whole duration is not a notification, it is a badly-placed status light. A paste
producing nine objects is an event.

So states live in the header indicator (`sync-pip`), which is a bare dot for
*Saved* and grows a word for *Saving* and *Offline* — the two moments the
assumption behind the silence is wrong. Only the syncing dot pulses: a pulse
means "wait, something is happening", which is false when the connection is
gone.

Events live in `engine/ui/notices.ts` and are drawn once by `NoticeLayer`, the
same arrangement `TooltipLayer` uses. What is worth knowing:

- **Severity decides lifetime, and the caller does not.** The old `showToast`
  gave everything 3200ms, so *"That SVG could not be read"* — the only message
  worth reading — vanished in the same three seconds as *"Copied"*. Errors now
  stay until dismissed.
- **A repeat folds into a count**, so four bad pastes are one row with a ×4
  rather than four identical rows.
- **The cap never evicts an error.** It is in the list because it is waiting for
  a person; a burst of "Copied" must not carry it away.
- One timer for the whole stack, re-aimed on every change, because a timer per
  notice leaks one whenever a notice is folded or evicted.

## 4a-11. Two cards fewer, a rail instead of a bar, and one continuous stroke

**`DockCoach` and `FirstRunGuide` are deleted.** They were written before there
was a walkthrough, and once there was one they became the third and fourth card
to interrupt somebody in their first two minutes, the last two arriving together
on the single act of putting a shape down. Everything they taught is still
taught at a better moment: frames by the `frame-page` lesson when the frame tool
is armed, sharing by step five of the tour, focus mode by the view menu and the
reference. The rule left behind is that a first run gets **one** offer.

**The library has no top bar.** It held a wordmark, a search field, a name and a
sign-out button across the full width of the window and none of them was worth a
band. The rail was already permanent and already where people aim, so identity,
navigation and account fold into its head and foot, and the stage gets the whole
height. Icons only: two destinations do not need two hundred pixels, they need
to be unmistakable and out of the way.

The categories moved out with the labels, to a chip row above the grid they
filter. Five words across the top of a wall of pictures read as a filter; five
rows down the side read as a second navigation.

**The cards are not cards.** They were white boxes on a white page: a border, a
fill and a shadow round a picture that already had an edge. Twenty of them is
twenty frames competing with twenty compositions. Now the picture sits in a
rounded well and the words sit on the page beneath it, only the picture lifts on
hover, and the three word-chips under each one are gone: they named what a board
*teaches*, which was never why anybody picked one.

**The seam became a tile.** "Browse templates" was a full-width bar carrying a
heading, a sentence and an arrow, for a link, which is the one shape on a page
people have trained themselves to skip. As a dashed tile at the head of the
boards grid it is the size of its neighbours and needs two words.

**Three spacing tokens did not exist.** `--space-7`, `--space-10`: the scale is
1 2 3 4 5 6 8 12, so those declarations were dropped in silence and two headings
sat on the text above them. Worth remembering the next time a gap looks wrong
for no reason.

**The tour's shaft is one stroke now.** It was `roughPolyline`, which bristles
every *segment*, so eight samples gave seven short strokes with a break at each
join: rough, but broken rough. `roughLoop` with `closed: false` walks one
continuous stroke along the arc length and wanders as it goes, which is why the
ring looked right all along, `roughEllipse` having gone through that sampler
from the start. The head no longer draws itself on: eleven units of stroke is
too short a distance to read as drawing, so it stuttered. It arrives whole, at
the instant the shaft reaches it, which is what a hand does.

## 4a-10. The tour was unreachable on a new board

**It never appeared on the screen it is for.** `TourOffer` waited for the dock
question *and* for the board to have an object on it, and `DockCoach` only
appears once something exists. So somebody who opened a new board and looked
around was offered nothing at all, and the tour could only be found in the
reference panel's footer, which is the last place a lost person looks.

**The order is inverted.** The tour is the general orientation and the dock's
question about frames is a specific follow-up about one thing in it, so asking
the follow-up first was backwards. `TourOffer` now shows as soon as the chrome
is up, on an empty board included: there is nothing to interrupt, nothing to
lose, and every question anybody has at that moment is where anything is.
`CanvasEmptyState` sits mid-canvas and the offer sits above the dock, so they do
not collide. The dock coach, the first-run guide and the lesson coach all wait
for `tourSettled`, so nothing fights it.

It also waits a beat before appearing. A card already there when the page
finishes painting reads as part of the page, and this is a question *about* the
page.

**The offer is drawn by the same pen as the tour.** A hand-drawn ring and tick,
made with `rough.ts`, and the handwritten face on its three-word title. A lucide
glyph there would have been a third visual language on a card whose only job is
to introduce the second.

**The marks are doubled now.** The shaft and the head were drawn at `light`,
which is one pass -- `rough.ts` calls that "a neat hand with a straight edge...
without reading as informal", which is the wrong register for something scrawled
on your screen, and the same file calls the doubling "the single most
recognisable thing about a hand-drawn shape". They are `medium` (two passes) and
the ring is `heavy`, which overshoots its joins the way a fast circle does. The
arc is sampled at eight points rather than fourteen: the wobble is added per
segment, so chopping a curve finer produces many tiny deviations and comes out
smooth, which is the opposite of the intent.

## 4a-9. Rulers, the palette, and one glyph per meaning

**Rulers start off.** They cost 22px from two edges permanently, put a second
scale along a surface whose whole promise is that it has no edges, and offer a
measurement almost nobody on a whiteboard wants. The people who do want them
will find the switch. As with the panels, only a browser that has never been
told changes.

**`SlidersHorizontal` meant three things**: the properties rail's identity, the
header's view menu, and the dock's rearrange mode. Invariant 16, three ways. The
rail keeps it, the header menu takes `Settings2`, and the dock's rearrange takes
`Move`, which is what that mode actually does.

**The view menu has group labels.** Seven controls of three kinds -- what the
board does when you touch it, what it is drawn on, how you are looking at it --
were separated by two unlabelled rules, so the grouping existed and could not be
read.

**The command palette stays, and is worth keeping**: it is the only way to reach
the canvas text search, and the only place to jump to a collaborator. Three
things were wrong with it.

Every rule in it was an inline `style` object, about forty of them, and it was
the only surface in the application styled that way. Inline styles cannot
express a hover state, a focus ring, a reduced-motion rule or a theme, which are
exactly the four things this panel needed. They also cannot be read beside the
rest of the design, which is how a panel drifts from its product without anybody
deciding it should.

Its shortcut badges were string literals -- `'S'`, `'T'`, `'R'`, `'V'`, `'H'` --
in the one surface somebody reaches for *because* they cannot remember a key.
They come from `TOOL_SHORTCUTS` now.

And hovering moved the keyboard cursor, so a pointer resting anywhere over the
list silently took Enter with it: arrow down three times under a stationary
mouse and Enter ran whatever the mouse was over. Hover and selection are two
states now and Enter belongs to the keyboard. Matches are highlighted, which
fuzzy search needs most of all, because the reason "shp" kept "Add Shape" is
three letters scattered through it.

## 4a-8. The library

**The avatar in the app bar was one of the five.** It carried
`user.name.charAt(0).toUpperCase()` in a span of its own, which is the exact
pattern `ui/Avatar.tsx` opens by describing as the bug it was built to fix: the
same person read as "A" here and "AO" in the room. It outlived the
consolidation because nobody was looking at this page. It uses the shared
component now.

**The empty state offers the three openings instead of describing them.** It was
an icon, a heading and a paragraph naming three actions -- start from a
template, open a blank board, open a link -- and offering none of them. A screen
shown only to somebody who does not yet know where anything is, that names the
way out rather than being it, is the least useful screen in a product. The first
of the three carries the accent, because three identical rows is a page that has
declined to advise.

**`/` focuses the search**, with the key drawn on the field it reaches. The
library is a grid of twenty-one pictures and the fastest way through it is to
type.

**The rail has group labels.** Two destinations and five filters were seven rows
of one weight, so the shape of the navigation had to be inferred from an indent.

**No wash on this page.** One was tried, to give the library the material the
rest of the product now has, and it was the wrong instrument: this page is a
wall of coloured pictures, and a tinted ground is one more colour competing with
the work it is presenting. The auth screen can carry a wash because it has
nothing else in it. Here the cards are the character and the chrome's job is to
disappear.

## 4a-7. The way in, in both themes

**The showcase belongs to the theme now.** It was a hardcoded near-black with a
light ink, so the whole left half of the first screen ignored the setting the
person had just been asked to choose two hundred pixels to its right. Light is
not the dark one inverted, which would put a white panel next to a white form
and leave the split with no composition: light is a warm tinted page against the
form's cool neutral, so the two halves are different materials. Every colour is
a token, dimmer in the dark because a field at the same opacity over near-black
has four times the contrast it had over paper.

Three drifting fields rather than two, at different sizes, rates and
directions, so they never quite repeat; grain at `soft-light` rather than
`overlay`, which crushed the highlights of a pale ground into dirt; and a
vignette whose strength is a token, always travelling towards the ground colour.

**A fourth beat, drawn by `rough.ts`.** "Ruled, or drawn by hand" shows the same
rectangle and ellipse twice, one drafted and one made by the generator the canvas
actually renders sketched shapes with. It is the one claim on that screen that
could not be copied off a marketing page without building the feature first. The
first version compared a rounded ruled rect against a sharp drawn one with no
ellipse, which read as two different drawings rather than one done two ways.

**The people beat shows what each person is doing.** Two cursors travelling is a
screensaver. They carry names now, and one is dragging a card while the other has
something selected with a ring in their own colour, which are the two states the
board actually shows a collaborator in.

**The form.** One sentence of lede instead of three, because the last two made a
claim the panel beside it now spends a whole beat on. A 52px field with an
accent focus ring, since it is the only input on the screen. The native checkbox
became the app's own switch, which is also the right control for a state that
persists rather than one that is submitted. The disabled button says why it is
disabled. The appearance chips got a label.

## 4a-6. The walkthrough, drawn by the product's own pen
**Refinements after looking at it.** The arrow's landing point was written out
per side, which is four approximations of one fact: against a wide flat target
those hand-written points were tens of pixels off the real curve, so the head
landed on the ring, or inside it, or in the gap. It is solved now, by walking
out from the ring's centre until the ellipse equation is satisfied. `TOUR_GAP`
went 56 to 72 because the ring pad, the stand-off and the lift-off eat about
thirty of it, and thirty pixels of stroke reads as a tick rather than a sweep.
The `1 OF 6` eyebrow is gone: the dots say the same thing and can be pressed,
and it was pushing the handwritten title out of first place.

**"Show them all again" is gone from the reference footer.** It called
`learnState.reset()`, which clears what you have learned *and* unmutes, so
pressing it while the switch beside it was off silently turned that switch back
on: two controls where one secretly moves the other. It was also answering a
question already answered twice on that screen, by the switch and by the library
below it. `reset()` went with it.

**The lesson steps read as pairs rather than as two lists.** They were a
two-column definition list, gesture left and result right, so the eye went down
the left column collecting gestures and had to come back up for what each one
did. One flowing line each now, gesture emphasised, which is also exactly what
the coach mark does with the same steps.



**The theme is asked for rather than assumed.** It followed the operating
system, which was wrong here, and was then forced to light for one commit, which
was wrong in the other direction: somebody who has set their whole system to
dark has told you something. `AuthModal` asks, on the screen that already exists
to ask a question, pre-selected from `prefers-color-scheme` so the honest answer
is one click. The store's `false` is now a fallback for identities that never
pass through that screen, not a policy.

**`engine/learn/tour.ts` is a walk round the screen.** Six steps, one sentence
each, pointing at the dock, both panel edges, the radar, share and help. Offered
once after the dock question settles, declined as firmly as it is accepted, and
replayable from the reference panel's footer for ever after.

It takes over the two panel lessons and the `moment` trigger goes with them. A
coach mark above the dock saying "click the rail on the right" is the worst
possible version of a spatial instruction, and it arrived at a moment somebody
had chosen to do something else. Where things live is not taught just in time;
it is pointed at, once, when asked. Lessons are back to verbs only.

**One card that travels, not a popover per step.** A tour built as hide-this
show-that gives the eye nothing to follow and turns six steps into six small
searches. `placeCard` is pure and tested: it tries the asked-for side, then the
opposite, then the perpendiculars, taking the first whose own axis fits and
sliding along the other. Testing both axes was the first version and it rejected
good sides -- the radar in a corner failed "above" only because centring a 312px
card on a 150px pill put its edge off screen.

**The marks come out of `rough.ts`.** The ring round the target and the curving
pointer are drawn by the same generator the canvas renders hand-drawn shapes
with, at the same profiles, seeded from the step id so they sit still while the
board pans rather than boiling. That is what makes it ours rather than a style:
the product already draws this way, and a tour is annotation rather than
interface, so a pen mark is the register that cannot be mistaken for a control.

The hand stops at the pointing. The title takes Caveat because it is short,
large and it is the voice; the body stays in the interface's type, because
handwriting at fourteen pixels is worse to read in every language and the body is
the information. `TOUR_GAP` went from 14 to 56 for the same reason the marks
exist: at fourteen the pointer was twenty pixels long with half of it behind the
card, and an arrow you cannot see is worse than none because it was drawn anyway.

**Anchors are `data-tour` strings, kept honest by a test** that reads every
source file and fails if a step names something nothing carries. At runtime a
step whose element is genuinely absent -- focus mode, an opened panel -- is
skipped in whichever direction the reader was already going.

## 4a-5. Light by default, panels closed, and the reference rebuilt

**The app opens light.** `darkTheme` followed `prefers-color-scheme`, which is
the right default for a reading surface and the wrong one here: every colour
decision in this product was made against a light ground, and two machines
opening the same board and disagreeing about what it looks like is a weaker
introduction than either alone. The cost is named in the code rather than
hidden: somebody who set their system to dark has expressed a preference and
this ignores it for one session. The toggle persists for ever after.

**All three panels start closed.** Two 260px panels and a radar spent most of a
laptop window before anything was on the board, on a layer list with nothing in
it and an inspector with nothing selected. Only a browser that has never been
told gets the new default: the check is now for the stored value being
`expanded`, so anyone who already chose keeps their choice.

What that costs is discoverability, and it is paid back directly rather than
hoped away. Lessons gained a second kind of trigger: a **moment** rather than a
tool. `panel-properties` is offered the first time something is selected, and
`panel-layers` once there are five objects, which is where a layer list stops
being a list of things you can already see. Both are retired explicitly by
`Room` when the panel is opened, because opening a panel makes no object and the
coach's loose "something appeared" test can never fire for them. Three call
sites, exact; sixteen, one per tool, would not have been affordable.

`FirstRunGuide`'s second step went with it. "Collapse either panel" was
satisfied on the first frame once the panels started closed, so it completed
itself before it could teach anything. It is focus mode now, latched, because
the question is "have you found this" and that does not become false again.

**The collapsed rail is one button.** It was two stacked controls firing the
same action, with a note explaining that making one inert would be a trap. That
note was right about the problem and wrong about the fix: two controls for one
action are still two, and they spent the rail's best rows on a decision nobody
has to make. The whole 52px strip is the target now, the chevron appears on
hover to say which way things will move, and the right-hand rail shows a dot
rather than a number because on that side the number is the size of a selection
you can already see.

**The reference panel.** Search moved out of the header onto its own full-width
row, with a live match count; typing anywhere in the panel goes to it, and Down
enters the rail. Matches are highlighted, so a filter says *why* a row survived.
Rows were flipped to description-first with the keys right-aligned on a common
edge, which is how a sheet read by intent should be scanned. The rail's counts
appear only while searching, and selection is one mark that travels between
items rather than sixteen that light up. The header also finally says the two
things this panel knew and never told anyone: that `Cmd` is `Ctrl` off a Mac,
and that `?` is the way back in.

Two real faults came out of it. The lesson cards were being sliced by the
shortcut tables' two-column text flow, with a card's picture at the foot of one
column and its steps at the head of the next: they take `column-span: all` now
and lay out as full-width cards, stacking their picture above the text by
container query when the card is genuinely narrow. And the footer holds the
control `LessonCoach` had been promising: its "Stop showing tips" note said the
choice was reversible from the reference library, and nothing there could
reverse it, which is a capability nothing honoured written by the same change
that promised it.

## 4a-4. Onboarding, and one list of lessons

**There is one lesson store and two surfaces read it.** `engine/learn/lessons.ts`
holds seventeen lessons, each a title, a gist and a run of gesture-and-result
steps. The reference library renders the whole thing; the canvas coach renders
one, with two steps, when you arm the tool it is about. `HelpModal`'s old `TIPS`
array is gone: it taught the line tool, the connector, booleans and the physics
room in its own words, and in-canvas coaching with a second set of words would
have been two bodies of teaching text about one set of gestures. Teaching text
drifts worst of all, because nobody updates the tutorial when they change the
gesture.

Lessons name tools, never keys. `keyFor` asks `TOOL_SHORTCUTS`, so anything
advertised is bound by construction, and a test fails if a lesson names a tool
that does not exist or if two lessons claim one tool.

**Only unguessable gestures get one.** The eraser, the shape tool and the hand
have none, deliberately: a coach mark on a guessable tool is what teaches people
to dismiss coach marks unread. A test pins both halves of that.

**It retires by doing.** `LessonCoach` remembers the object count when it
appears and retires the lesson permanently when something is made while it is
up. Glancing at one and wandering off brings it back next time, which is right
for something you did not read. `learnState` keeps that in `localStorage` and
never in the CRDT: what *you* have been taught is not a property of the board.
One mute for all of them, reversible from the library.

**Three surfaces share the band above the dock and now resolve in order.** The
dock coach asks first and settles for good; the first-run guide and the lesson
coach both wait one answer for it; and the lesson coach wins over the guide when
both apply, because the guide is about the product and the lesson is about the
tool in your hand. That last one is `.guide:has(~ .coach)` plus a deliberate
render order in `Room`, rather than state plumbed through three components.

**The welcome sequence is deleted and its content moved to the auth screen.**
It was three beats in a card over the board, one screen after signing in. The
auth screen was a 400px form floating in an empty page, so the screen *before*
had a whole free half and the moment somebody types their name is the only
moment in the product where attention is spare. `AuthShowcase` takes that half
at full height. Saying it in both places would have been the duplication this
file keeps warning about; saying it over the board interrupted the one surface
whose promise is not being interrupted.

**The demos are six scenes, not seventeen.** Several lessons are the same
gesture underneath, and near-duplicate drawings are what drift. Two real bugs
came out of looking at them rather than trusting them: the connector demo moved
the box, the line and the arrowhead as one group, so the arrow did not follow
the box, it *was* the box (it swings about the source's edge now, which is
geometrically exact and something CSS can actually do); and the tap rings
animated the SVG `r` attribute, which is not reachable from CSS in every engine,
so they pulsed in Chrome and sat inert in Firefox.

## 4a-3. Reframing a picture inside its module

Double-click a picture in a grid module and it enters **reframe**: drag to move
the picture, wheel to zoom under the pointer, Escape to put back what you
started with, Enter or a click elsewhere to keep it. The whole photograph is
drawn faintly outside the module so you can see what you are cutting.

**Why it is not `cropMode`.** They answer the same question and cannot share an
implementation, because they move opposite things. Cropping a loose image drags
the *frame* and the picture holds still. A picture in a module has no frame of
its own to drag: `planGridReflow` writes the box back on every pass, so a resize
handle would be a control the document undoes a frame later, which is exactly
the dead capability invariant 6 exists to prevent. So the two modes are one
gesture over different subjects, entered from the same double-click, and
`ObjectRenderer` picks between them on `node.gridSlot`.

**The arithmetic is pure and tested.** `zoomAtPoint` holds the source pixel
under the pointer still while the window grows, which is what turns "enlarge,
pan it back, enlarge again" into one gesture; `sourceBoxForSlot` places the
whole bitmap in world space so the ghost registers exactly with the part on
show. Both are pinned by properties rather than by numbers, and the anchor test
was confirmed non-vacuous by breaking `zoomAtPoint` and watching it fail.

**One setter, not two.** `setSlotFit` writes focus and zoom together, because a
wheel zoom moves the focal point in the same breath. Two writes would put two
entries in the history for one turn of the wheel, and rebuild a window from a
focus and a zoom that were never true at the same moment. `setSlotZoom` is now
the slider's path on top of it.

The popover's Zoom slider, Recentre, and the arrow keys all still work and are
still the precise path, and the one that survives a multiple selection.

## 4a-2. The grid panel, and one field that was two

**`GridStyle.shapeMode` is gone; `shapes.length` is the answer.** A `'uniform' |
'mixed'` flag sat beside the list of shapes and encoded a fact the list already
carried — invariant 7, in the smallest possible form. It disagreed with itself
two ways: `uniform` over three shapes drew the first and silently ignored the
other two, and `randomiseRecipe` rolled the flag and the set from *separate*
draws against the same threshold, so about a quarter of its grids claimed a mix
they had one shape for. Deriving it is exact rather than approximate — a seeded
draw from a set of one has one outcome — so `styleCells` lost a branch and no
single-shape grid changed. `gridNode.ts` drops a `shapeMode` it finds in an old
document rather than honouring it.

**The panel followed.** The "One shape / Mixed" `SegmentedControl` is replaced by
a **Mix shapes** switch below the shape row, built from the same `grid-switch`
as the continuous-ring toggle. Three things were wrong with the old one: that
component sizes segments to their content and never stretches, so two words sat
at the left end of a full-width grey track; it named a mode the shape list
already implied; and it silently changed what a click on the row below *meant*
— replace in one mode, toggle in the other. Wanting to mix before there is a
mix to see is local state (`mixWanted`), the same arrangement `linkWanted` uses
two bands up and for the same reason.

**"Try another" shows all nine at once.** It was a horizontal scroller with a
measured fade per live edge and a nudge button on each fade — careful work in
service of showing 3.5 tiles in a 260px column. Comparing is the entire purpose
of the control. Three columns of three fit exactly; the overflow hook, both
nudges, both fades and ~60 lines of CSS went with it. Each tile now carries
`describeRecipe` as its tooltip and accessible name, because nine grids at 60px
are distinguishable but not identifiable — and "Use variation 3" was nine
buttons that differ by an ordinal. The refresh button said "Show five more"
while drawing eight; it says eight now.

**Nine strings existed twice.** `SketchSection`'s two segmented controls and
`ObjectContextToolbar`'s `SKETCH_LABELS`/`FILL_LABELS` held identical copies of
the hand-drawn setting names, kept in step by nobody. Both read
`shadingLabels.ts` now. The toolbar's own note said these strings appear twice
and must not disagree, and was solving that inside one file while the other held
the second copy.

**Every em-dash is out of the user-facing copy.** About 120 strings across
tooltips, accessible names, help text, notices, export dialogue and the template
library, rewritten rather than mechanically substituted: a colon where the tail
defines the head, a full stop where it is a separate thought, a comma for a
subordinate clause, and `·` for compact metadata rows, which is the separator
the app already used in grid captions. Comments and doc blocks were left alone;
the scan that found them (`strip_comments` over every non-test source file) is
the way to check the copy stays clean.

**The colour popover opens on Swatches.** Palettes opened by default and it was
the wrong first move: a ramp is a decision about the whole board, taken
occasionally, while nearly every visit is somebody wanting one particular
colour for one particular thing. The tab order follows, so the open tab is at
the left end on the first look.

## 4a. What this session added

All committed together. The reasoning lives in the code; this is the map.

**Diagrams as code.** `engine/diagram/` — a Mermaid flowchart parser, a layered
layout, and a builder that produces real shapes and connectors. No `mermaid`
dependency: it is over a megabyte and renders an SVG, which is the one thing
this must not produce on a canvas whose point is that everything is editable.
Reads back out too, from any selection, including one drawn by hand. 26 tests.

**The line and arrow rework.** Drawn click–move–click, edited at their
endpoints (`engine/model/lineEnds.ts`), Shift constraining to 15° through one
function shared by both gestures. Six end styles unified with connectors, an
`endScale` control, sketched caps, and midpoint labels that stay upright and
contrast-check their own ink.

**A real text layout engine.** `engine/text/layout.ts` replaced one
`Konva.Text` per node. It is what made paragraph spacing, the per-line
highlight ribbon, honest vertical alignment and caret-on-click possible — all
four were blocked on the same missing thing, which was *where each line is*.

**The right-click menu**, the **Help modal**, the **Text block** tool, foldable
and hideable groups in the Layers panel, and a properties panel reordered into
canonical blocks.

**Two performance fixes worth knowing.** The eraser called `toJSON()` on every
object for every *step* of its sweep — ten thousand deserializations per
pointer move on a 500-object board — and deleted each object in its own
transaction, so one swipe cost a dozen undos. It now reads the normalized store
and transacts the whole sweep. The pencil now thins its stored centreline with
Douglas–Peucker at commit; the drawn outline is untouched, and that is where
nearly all the points were.

## 4a-ii. The keyboard audit (`260bcab`)

Small in code, worth reading before you touch any key handling.

**Keys are bound in four places and they all reach the same window.**
`Room.tsx` owns the global map (tools via `TOOL_FOR_KEY`, undo, the palette,
`\`, `0`, and now `Cmd+A` and `?`). `Canvas.tsx` owns everything scoped to a
selection (delete, duplicate, restack, group, `Cmd+B/I/U`, Enter, and now the
arrow nudge). `LayersPanel`, `Minimap` and `TimeTravelBar` each bind their own,
as **React handlers on a focused element** — which still bubble to the window,
so a global listener sees them too. Two consequences, both now handled and both
easy to reintroduce:

- **Arrows are claimed by four components.** Nudging is what the *board* means
  by an arrow, so it applies only when focus is on the board itself — `null`,
  `body`, or inside the stage container. Without that check, arrowing through
  the Layers tree would also drag the selection across the canvas.
- **`Cmd+A` is bound twice on purpose.** The Layers tree scopes it to the rows
  it is showing; the board means everything. The board handler stands aside on
  `e.defaultPrevented`, so the narrower one wins where it applies.

**`nudgeDelta` is a pure module** (`engine/tools/nudge.ts`) for the usual
reason, and the step is in **world units, not screen pixels**: a nudge is an
alignment gesture, and scaling it with zoom would make the same press mean
different things at 40% and 400%. A multi-object nudge is one
`applyNodePatches` transaction, so it is one press to undo. Locked objects are
skipped rather than the press being refused.

**`TOOL_NAMES` moved out of the modal** to `engine/tools/toolNames.ts`, held
against `TOOL_SHORTCUTS` by a test. The modal renders `TOOL_NAMES[id] ?? id`,
which fails *quietly* — a new tool would appear on the help screen under its
internal id, which is worse than not appearing.

**Corrected, not just added:** the reset is bare `0`, never `Cmd+0`; and zoom
listens for `ctrl+wheel`, which is also how every browser reports a trackpad
pinch — so the old `Cmd + Scroll` row named a key nothing binds on a Mac.

**Newly documented, all previously bound and invisible:** `\` to hide the
chrome, `Cmd+Shift+[`/`]` to restack, `Cmd+B/I/U` on type, Enter to edit the
selection, the minimap's pan/zoom/fit keys, and the replay bar's step, play and
jump. The list roughly doubled, so it no longer fits without scrolling; three
columns at that width would wrap descriptions, which costs more than the scroll
does. The CSS comment that claimed it all fit was corrected with it.

## 4a-iii. The connector rework (`006d92e` and after)

The user reported one bug and asked for one feature; the bug turned out to be
the smaller half.

**Objects moved while you were connecting them.** `ObjectRenderer` decided
`draggable` from the node alone and never asked which tool was armed, so
pressing on a shape to draw an arrow from it started a Konva drag — *and* the
tool still received its events, so the gesture both moved the box and drew a
connector from wherever the box ended up. The fix is one word: `selectable`,
already computed from `canSelectWith` and already gating the hover outline, now
gates dragging too. **If a tool cannot select an object it has no business
moving it**, and that is one predicate, not two.

**A selected connector had the bounding-box transformer, and it was inert.**
Not merely the wrong affordance — a connector's `width`/`height` are *derived*
from what its ends resolve to, so a resize drag wrote a box the next render
recomputed and discarded. The only way to change what an arrow joined was to
delete it and draw another. `ConnectorEditor` gives it two endpoint handles;
the transformer stands down under the rule already written for a solo line.

**Three ways to bind an end, and the precedence lives in one function.**
`ConnectorEnd` now carries `anchor: {u, v}` alongside `port`:

| | Means | Resolves to |
| --- | --- | --- |
| `port: 'auto'` | *this object* | whichever side faces the other end |
| `port: 'left'` etc. | *this side* | the edge midpoint |
| `anchor: {u, v}` | *this spot* | a point on the perimeter, in the node's own proportions |

Normalized rather than absolute for exactly the reason a connector stores a
node id rather than a coordinate: **the binding has to survive a resize**, and
a fixed offset slides off a box that gets narrower. The anchor is an *aim* —
`anchorPoint` projects it to the perimeter, keeping the free coordinate and
snapping the bound one, so an endpoint slides along an edge and round a corner.
The edge is chosen in **normalized space**, the same reasoning `portFacing`
already used: on a 400x60 node a point 60px left of centre and 40px above is
barely a third of the way to the left edge but four fifths of the way to the
top. Pixel comparison gets that backwards on every wide node.

Precedence is resolved in `resolveEnd` alone and asserted there, so no caller
has to know the order.

**One rule, two callers.** `bindingAt` decides what a pointer means. It used to
be a private method on the tool, which was fine while the tool was the only
thing that asked — the moment endpoints became draggable there were two, and
two implementations of "what is the pointer over" is how a tool comes to
disagree with itself: draw onto a box's left edge and get one binding, drag an
existing arrow to the same pixel and get another.

**Both gestures, not one.** Drawing is click–move–click *and* drag. The line
tool had already made this decision, with its reasons written down, and the
connector was the odd one out — two things that draw a line from one point to
another, disagreeing about how you draw a line from one point to another. The
press decides which gesture it was by whether it moved, judged in **screen**
pixels: whether a hand moved is a question about the hand, and at 10% zoom a
world-unit threshold is most of a screen. A refused *click* leaves the pending
gesture standing rather than silently discarding a connector the user had
already started; a refused drag has nothing to stand and resets.

**Known gap, recorded in `connectorTargets.ts`: rotation is not handled**
anywhere in the connector system. A rotated node's ports sit on its unrotated
bounding box. Fixing it means every consumer working in the node's local frame
and rotating the resolved point back out — worth doing, not small.

## 4a-iv. Lines, profiles and the two bugs that cost the most

### The two bugs worth remembering

**A `useMemo` below an early return emptied the whole canvas.** Two hooks were
added under `if (!visible) return null` in `TextRenderer`. Entering the text
editor flips `visible`, the component returns early, two hooks vanish from the
render, React throws "Rendered fewer hooks than expected", and the *entire*
Konva subtree unmounts — so double-clicking one text object took every object
on the board with it. Invisible to the type checker and to 800-odd tests,
because it is a runtime rule about render order. **The console named it in one
line.** Opening the console first would have saved most of the time it took.

**A `React.memo` comparator that omitted a prop made objects unselectable.**
`ObjectRenderer` compared `objId`, `isSelected` and `stageScale` but not
`selectable`. That prop changes when the active tool does, so an object which
had not re-rendered for some other reason kept `draggable={false}` and a press
handler closed over a stale `false`. The selectivity was the tell: objects that
happened to re-render — moved, edited, or unmounted by culling and remounted —
behaved, and ones sitting untouched did not.

It had been wrong for a long time and was *invisible*, because `selectable`
only gated the hover outline. Widening it to gate the click promoted a cosmetic
bug into a functional one. **When you widen what an existing prop controls,
check the memo.**

### A line is no longer its bounding box

`width`/`height` used to *be* the two endpoints, corner to corner, with the
flip signs choosing the diagonal. Exact for a straight line; wrong the moment
the run has a profile, because the profile deviates *across* that diagonal.
Measured on a live board: a wavy arrow stored **380x0** and drew **380x49**.

Marquee, culling, the radar and export framing all read that box. So the box is
now the extent of what is drawn, markers included, and the endpoints moved into
`geometry`. Half the stroke is added on every side — a stroke is centred on its
path, and the old model gave a horizontal line a height of zero.

**Legacy lines are read, not rewritten.** `localRunEnds` answers both forms.
The normalizer deliberately does *not* invent endpoints: it would have to
invent a box too, since the old one is the diagonal rather than the drawn
extent, and normalization is not allowed to move objects on somebody's board.
A line converts the first time it is edited. `lineEnds.test.ts` covers both
legacy forms including the up-and-left one where the flip *is* the direction —
if that branch goes, every line drawn before this collapses to a point.

### Profiles, and what four failed attempts taught

Five profiles — straight, curved, wavy, zigzag, coil — as a property of the
existing line rather than five new kinds. `straight` returns its two endpoints
untouched, so nothing already drawn moved.

The **coil** took five attempts and the failures are the useful part. A shaped
sine, a phase-warped circle and a prolate cycloid were each derived from a
formula, and none had the right character: **a sine has one value per position,
so it cannot double back, and a curve that never doubles back cannot cross
itself.** Tuning numbers was never going to add a crossing to a construction
with none in it. The cycloid did produce real crossings — but a cycloid's loops
are tied in size to how many there are and run into each other with no baseline
between.

What it is now: one loop template of four cubics, plus a valley cubic between
consecutive crossings, translated by a fixed period. **Uniformity is
structural** — every loop is the same curve at the same size — and the loops
keep their size at any count, with the straight leads absorbing the difference.
The numbers are the reference's own, kept in its coordinates and scaled by one
factor so no proportion can drift.

The general lesson, and it is worth more than the coil: **when a shape is a
mark rather than a function, store the mark.** Four attempts to derive it cost
more than transcribing it once.

### Everything else on lines

- **Arrowhead alignment**, both of Illustrator's modes, in `terminateRun` —
  shared by the canvas, the exporter and the toolbar specimen, because a head
  placed by three separate pieces of arithmetic is three chances to disagree,
  and that had already happened: the exporter oriented heads along the box
  diagonal while the canvas used the true tangent.
- **The sketch branch had its own copy** of the cap placement and had never
  been updated — box corners, flat angle, its own size. Now hoisted so both
  branches render the same markers.
- **A line's label is a tag**, not a text block: fixed size, weight and case on
  a plate, riding the midpoint of the *run*. Interpolated rather than indexed —
  a straight line is two points, so `points[length / 2]` is its *end*, and the
  label sat past the arrowhead.
- **Label ink is lifted against the plate**, not the board. `readableOn`
  assumes a near-white or near-black surface; a plate is a mid-tone, and a
  colour clearing 3:1 on white can be invisible on it.
- **Sketchers are chosen by what the run *is*, not by counting points.** A
  point-count proxy got the one case wrong that mattered — a six-repeat zigzag
  is fourteen points, so it was reclassified as a curve and lost the corners
  that are its whole character. The profile is not the whole answer either: a
  multi-point line can bend one segment or smooth the whole run with no profile
  set at all, so `roughShape` routes anything bent, smoothed or sampled to the
  drift sampler and only a genuinely straight run to the polyline sketcher.
  `roughLoop` then finds real corners itself (a 40° turn on the input outline)
  and doubles the sample there, which makes a Catmull-Rom cusp — so one
  continuous stroke holds both a curve and a corner, and the mixed case has a
  correct answer for the first time.
- **The sketch is scaled to the stroke it will be drawn with.** Every
  displacement was in world units and blind to the pen, so the visible
  roughness was the wander over the stroke width and a thick stroke covered its
  own wander. `nibScale` in `rough.ts` is the one place that decides this, and
  `roughShape` reads the width off the node so the canvas and the SVG exporter
  cannot disagree — a sketch is seeded, so a disagreement is two drawings, not
  two styles. Two things it must *not* scale: the belly of an edge (that is the
  shape's fidelity, not the pen's character — see `penFor`), and the lean of a
  second pass by a constant amount (a constant normal offset is a parallel
  curve, and two strokes at a constant gap read as a ruled double line).

## 4a-vi. Identity, and the shortcuts that were never bound

**Presence colour is an allocation, not a preference.** It was a hash of the
user id into a ten-colour palette, so two people collided at exactly the rate
the birthday problem dictates — four people in a room made it likelier than
not. And colour is the *only* thing that says who somebody is on a cursor, a
selection ring, an avatar, the layer panel's editing pill or a radar ping, so a
collision merges two people into one on every surface at once. Nothing could
have caught it: a hash is a function of one person and uniqueness is a property
of a group, and no code could see the group. `resolvePresenceColor` takes the
roster and converges without a coordinator — only *lower* client ids block a
colour, which is a strict total order and therefore cannot cycle. The palette is
sixteen now; ten was inside the size of a real session.

**"Initials in a circle" had five implementations**, giving the same person
"M", "MA" and "ME" depending on the corner of the product. One `initialsFor`
now, and `components/ui/Avatar.tsx` is the single component the header roster
and the profile editor render a person through. (The three comment surfaces
still call `initialsFor` into spans of their own — same answer, different
frame. Worth folding in if you are there anyway.)

**The built face was removed.** `engine/presence/avatar.ts` encoded six choices
as eleven characters and drew them as ~300 lines of SVG, with a six-dimension
builder in the profile editor. The *encoding* was right and the reasoning is
worth keeping: an avatar travels on **awareness**, which is rebroadcast at
pointer frequency to every peer, so a data URL there is a photograph on the
wire many times a second — eleven characters is the only honest shape for that
channel. The premise was what failed. A cartoon assembled from six lists is not
who someone is; the presence colour already is, on five surfaces at once. And
nobody was ever *given* a face — `avatar` was absent until you opened the editor
and saved one — so the roster carried two appearances for one kind of person.
Initials in the room's colour say the same thing at every size. If a picture
returns it should be a real photograph, stored where a photograph belongs and
referenced from awareness by id; that is a different feature, and this one is
not in its way. See the note at the top of `ui/Avatar.tsx`.

**A help screen that hard-codes a shortcut will be wrong.** `toolNames.ts` opens
by saying so, and it happened anyway three sections below the generated list:
`L / R` for "Line tool / Arrow tool", where `R` is Shape and `L` was bound to
nothing. `L` arms the line seat now and pressing it again switches within it —
one key for two tools that already share one dock button, because there is no
second mnemonic letter free and reclaiming `R` would break a key people use.

**The camera is a module singleton and outlives a route change.** So board B
opened at board A's pose. `useOpeningFrame` frames the content once per room —
and the thing that made it hard is that `setPose` emits `CameraChanged`
*synchronously* into the listener that called it, so the first version recursed
until the stack blew and the camera ended up not moving at all. Stand down
before doing the work, not after.

## 4a-v. The transform rewrite, and what it uncovered

The single largest change in the recent work, and the root of a long run of
user-reported bugs about text stretching, glyph distortion, objects "flying off
the screen" and gestures that reverted on release.

**Konva's `Transformer` resizes by putting a `scaleX`/`scaleY` on the node it
holds.** That is exactly what a document object must not carry: a scale
stretches glyphs, thickens strokes and swells corner radii. Resetting it each
frame fights the widget, because it computes the next frame *from* the scale it
finds; leaving it alone is the distortion. There is no third option while the
widget holds the real node.

**So it holds an invisible `Rect` instead.** The proxy may scale as freely as
Konva likes, because nobody sees it — which is what lets the handles track the
pointer exactly, with none of the correction that made the gesture feel broken.
`engine/interaction/selectionTransform.ts` turns the proxy's box back into a
*size* for each object every frame, and objects render with `scaleX`/`scaleY`
permanently 1. It has 14 tests and no Konva in it.

Things that only became visible once nothing scaled:

- **Renderers read `node.width`** — the committed size — while the group was
  positioned and sized from the live store. The scale had been growing the
  drawing whether the renderer knew about the resize or not, so the omission was
  invisible *and* was the distortion. `ObjectRenderer` merges the live **size**
  into the node it hands to `NodeContent`, once, for every type. Size only:
  `x`, `y` and `rotation` are the group's to apply and a renderer that read them
  would apply them twice.
- **A path's size is not in its box**, it is in its outline, so the outline is
  refitted live through `fitPathToBox` — which measures rather than multiplying
  a ratio, so the preview and the commit make the same call and land in the same
  place whether it runs once or sixty times a second.
- **The selection box stopped following a drag**, because the proxy was fitted
  from the document and a drag does not write there. See invariant 11.

## 4a-vi. What the last session added

**Text becomes a path, with the real letterforms.** No web API returns a glyph
outline, so the font file is fetched a second time (the browser cache makes that
nearly free) and parsed with `fontkit`, which unpacks the Brotli inside a
`.woff2` and does real shaping. **The line breaks stay ours**: the app's own
layout already decided where the text wraps and where each baseline sits, and
that is what is on the canvas — only the advances within a line come from the
font. Taking the breaks from the font's shaper too would give outlines that were
correct and did not match the object they replaced. `engine/text/glyphOutline.ts`
holds the three conversions worth testing (quadratic → cubic by the two-thirds
rule, the y axis turning over, units-per-em from the file) and
`engine/text/fontBinary.ts` holds the fetch. `fontkit` is ~150 kB gzipped and is
imported dynamically into its own `vendor-fontkit` chunk.

**The pen can draw a cusp.** Its anchors were points with one forward handle and
the backward one taken as the exact mirror, so every anchor was smooth *by
construction* — a cusp was not refused, it was unrepresentable. It uses
`pathGeometry`'s own `Anchor` now, the same one the path editor has always used,
so Alt-while-dragging breaks the pair and clicking the last anchor retracts its
outgoing handle. `engine/tools/penSession.ts` (20 tests) also fixed the box,
which was the *control hull* rather than the ink — a handle lies outside the
curve it bends, so every curved path was stored bigger than its own shape.

**The four booleans work on turned shapes.** They refused any rotated or scaled
operand, which had nothing to do with the clipper: there was no way here to
express a node's transform. `mapPath` is that way, and it is exact — a cubic is
affine-invariant, so putting its four control points through the transform gives
the curve on the screen. Also: **subtract went the wrong way** (it kept the
front shape while its own label and every other tool say the opposite);
**every failure looked like nothing happening**, so `previewBoolean` now answers
without changing anything and the buttons are off with a reason; **hovering one
draws it** over the objects it would replace, from the geometry the click will
commit; and a union of three shapes was **four undo steps**.

**Alt-drag.** The origin twin was positioned from the *live* coordinates, i.e.
drawn on top of the object it was a twin of — invisible since it was written.
Holding Alt *before* pressing showed nothing, because the start handler set the
flag the move handler tested for being unset.

**The contextual rail** got a real placement module,
`engine/interaction/railPlacement.ts` (23 tests): the rotated hull rather than
the unrotated box, handles counted as part of the object, per-side clearance
that widens as the subject gets thin, no clamp that can push it back over the
artwork, sideways placement for a tall object, hysteresis so a slow pan does not
flick it between sides, and a quieter resting state when the selection leaves it
nowhere to stand. And the coordinate-space fix in invariant 10.

**Stickies.** The footer band is always reserved (see invariant 7 — three
derivations of the text box), the band is one row on one centreline, the pin is
a control that means something, `+3` shows the three, and the properties panel
offers the eight papers instead of a full RGB picker it then snapped to eight.

## 4a-vii. What this session added

**Export and copy** — the whole area, and it was three bugs of the same family.
`Copy as PNG` and `Copy as SVG` on one selection produced different pictures
(the raster path framed to the selection and captured everything inside that
frame); a whole-board PNG omitted whatever was off screen; and mounting the
missing objects then exposed images that had not loaded yet. All three are
invariant 13. Copy density now follows the subject instead of sitting at 2×,
both copies report their four ordinary failures instead of silently doing
nothing, SVG goes on the clipboard as vector as well as text, and a **selection
can be exported** — right-click, Ctrl+Shift+E, or the dialog's Region list.
`engine/export/exportScope.ts` decides what a copy covers *and* what to call it,
so the label, the toast, the filename and the file cannot disagree.

New modules, all pure and tested: `exportScope`, `isolate`, `renderScope`,
`imagesReady`, `clipboard`, and `clipboardScale` in `rasterLimits`.

**The rail stopped vanishing.** Two independent causes, one symptom, and the
user's own clue was that it took a full page reload to recover — which rules out
anything a re-render would fix. See invariant 12 for the stuck veil, and
`ObjectContextToolbar`'s write guard for the other: the rail unmounts while
veiled, and the replacement element has no transform, so hiding and showing it
at the *same* coordinates was skipped as "no change" and left it at the origin.
Editing a text object does exactly that.

**The shades ramp.** Invariant 14: the docstring described behaviour the code
never had, and the picker keyed swatches by colour so the duplicate steps at
white and black collapsed rather than merely repeating.

## 4a-viii. Multi-point lines, and the icons

**A line has a run of vertices now**, not two endpoints. Drag for the straight
line; click once per corner for a route. Double-click or Enter opens the point
editor. `engine/model/polyline.ts` is the geometry (51 tests),
`engine/tools/polylineSession.ts` the drawing gesture,
`engine/interaction/lineEdit.ts` the mode, `lineVertexActions.ts` the commands.

**Rounding the corners is not bending the segments**, and getting that wrong
cost a round trip. Bowing each segment gives a curvy line with every corner
intact — a bend bends the *middle* of a segment. Rounding needs the run to leave
and arrive at a point along one direction, which per-segment quadratics cannot
promise, so `geometry.smooth` draws a centripetal Catmull-Rom spline instead.
See invariant 15.

**Two things were only found by looking at it**, which is worth noting because
the Chrome extension had not connected for two sessions before this one:
the first smoothing pass measured how far off the chord each neighbour *sat*,
scaled by the chord — so a short segment with a distant neighbour threw a bulge
right off the drawing. And the properties panel still offered line profiles for
a multi-point line after the toolbar's copy of that gate had been added. Both
are pinned by tests now; neither would have shown up in one.

**Two icon collisions**, reported by the user and worth the rule: the rail's
Effects popover wore `Sparkles`, which is the Forces tool's glyph in the dock,
and the round-corners button wore `Spline`, which is the Connect tool's. Neither
was wrong alone; sharing is what made them wrong. Before adding a rail icon,
grep `ToolWorkspace.tsx` for the glyph.

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

## 4c. The library's landing, the save indicator, and one font bug

### The pieces of chrome

`Home.tsx` opens on **boards**, not templates. The gallery was the livelier
screen and so it got the default, which is a designer's reason rather than a
user's: somebody arriving has a board in mind far more often than a blank to
fill, and templates are one click away either side.

On the boards view, "Browse templates" is the last tile in the grid rather than
a band beneath it, and it is built as `__art` + `__body` with the same
`padding: var(--space-3) 2px 0` as `.tcard__body` and `.bcard__body`. It was
one block with its words inside the picture area, so its title sat at the
height of the other cards' *pictures* and the row read as two baselines.

The rail's templates glyph is `Compass` at `size={18}` against `Layers` at 19.
An earlier pass swapped it for `LayoutTemplate` on the theory that a compass's
ink sits off-centre; that was simply wrong, lucide draws it as a circle centred
in its viewbox. What is true is that a circle filling the whole viewbox carries
more ink than the flatter layers glyph beside it, so at a matched nominal size
it sits heavier. That is an optical-size problem with an optical-size fix.

### The save indicator

At rest this was a bare grey dot with no word beside it, on the reasoning that
a state true almost all of the time does not earn standing chrome. The
reasoning is right and the conclusion was wrong: a featureless grey dot does
not mean "saved" to anybody who has not been told, so it communicated nothing
at all for the same seven pixels.

Now the resting mark is a **tick**, which already means "done" to everybody;
offline is `CloudOff`; and only the in-flight state stays a dot, because a dot
that pulses is the one thing here that genuinely means "wait". The word "Saved"
folds in for 2600ms each time a save lands and then folds away -- that is the
moment the word is worth anything, and the moment somebody learns what the tick
means. The first paint counts as a landing, so the first thing seen in that
corner is the word rather than a glyph to guess at.

### One z-index scale

`--z-canvas: 0`, `--z-canvas-overlay: 10`, `--z-chrome: 100`, `--z-flyout: 200`,
`--z-panel-overlay: 300`, `--z-coach: 1080`, `--z-toast: 1100`,
`--z-context-menu: 4000`, `--z-tour: 8000`, `--z-dialog: 9000`,
`--z-tooltip: 9500`, `--z-skip-link: 10000`.

This replaced a set of magic numbers that had been chosen one at a time, each
one bidding higher than whatever it had lost to last. `.export-scrim` had
reached `9999999` and `.tip` was on `10000`, which is the reported bug that
tooltips rendered *behind* the export dialog. Add new layers to the scale, not
above it.

### The font epoch, and why measurements were wrong on a cold load

**This is the interesting one, and it will come back if the mechanism is
copied rather than reused.**

Canvas text measurement uses whatever face is resolvable at that moment. Our
display faces come from Google Fonts, so a board that measures before they
arrive wraps against fallback metrics, fits the wrong size into a sticky, and
then *keeps* that answer, because the result is memoised and nothing re-renders
when the real face turns up. The symptom was sticky text sitting visibly off,
corrected by a reload -- the worst way for a bug to present, because it does
not reproduce for the person looking at it.

There were two implementations of the fix. `measure.ts` had a working one:
explicitly `document.fonts.load(...)` the face, and bump an epoch when *that*
resolves. `stickyFit.ts` had a broken half of the same idea: it waited on
`document.fonts.ready` alone.

`document.fonts.ready` resolves when nothing is *currently* pending, which on a
cold start is true well before a face we care about has been asked for. Canvas
measurement does trigger a load in Blink, but asynchronously and only at the
first measurement, so whether `ready` waits for it is a race against how fast
the board's contents arrive over the network. Losing that race spent the one
bump on nothing and left the fallback measurement cached for the life of the
page. A reload finds the face in cache, where it resolves without a pending
load to lose the race to -- hence "reload fixes it".

Worse for stickies specifically: **nothing in the DOM uses Caveat** except the
tour, which most people never see. The canvas was the only thing that wanted
the font, and a canvas asks too late to be waited on.

There is now one `engine/text/fontEpoch.ts`. It owns the epoch, the invalidator
list, and `requestFont(spec)`, which is deduped -- both because `FontSelector`
calls it per hover, and because a bump re-renders subscribers, so a renderer
requesting a font while rendering would otherwise request it again on the
render its own request caused. `ready` and `loadingdone` stay as backstops for
faces the DOM pulled in. Invalidators run *before* subscribers, since a
subscriber re-measures and every cache it reads must already be gone.

Tested in `fontEpoch.test.ts`, including that ordering. If you need a face
measured on canvas, call `requestFont`; do not infer arrival from `ready`.

## 4d. Loading, and what was on the critical path that should not have been

### Six font families were downloaded twice

`index.css` self-hosts Inter, Roboto, Space Grotesk, Outfit, Caveat and
Architects Daughter through `@fontsource`. `index.html` also asked Google for
eleven families, six of them those same six. An earlier pass had caught this
for Inter and left a comment here saying "Caveat only"; the request underneath
the comment still named all eleven.

The CDN request now names the five nothing bundles: DM Sans, JetBrains Mono,
Lora, Playfair Display, Plus Jakarta Sans. Nothing in the *interface* renders
any of them -- they exist so board text can be set in them -- so it is loaded
with `media="print"` and flipped to `all` on load, which keeps it off the
critical path. Text measured before they land is re-measured when they do; see
`fontEpoch` in §4c.

Caveat needed 600 (notes, the walkthrough) and 700 (board text set bold), and
the base `@fontsource/caveat` import carries 400 only. Both are imported
explicitly now. **If you add a face the canvas draws, self-host the weight** --
a weight that only exists at the CDN is a weight the bundle synthesises badly.

### The boot shell

`#root` was empty until React mounted, so a slow connection showed a blank
page, and a dark-theme session showed a *white* blank page that snapped to
black. There is now a synchronous script in `<body>` that reads the same
`localStorage` key `useStore` does and sets the class before the first paint,
plus inline CSS for the two ground colours (`#FFFFFF` / `#18181B`, matching
`--gray-000` and `--zinc-900` -- keep them in step).

The boot mark is transparent with an `animation-delay`, so it fades in only if
boot is still going after 320ms. On a warm load nobody ever sees it. React
clears `#root` on mount, so it removes itself.

### Nothing loading appears immediately

`useDelayed(active, ms)` in `hooks/`, and `RouteLoader` / `ModalLoader` in
`components/ui/Loading.tsx`. A loader that flashes for eighty milliseconds
reads as jank, so the mark waits out a threshold and most waits never show one.
The modal scrim is *not* delayed -- the click needs acknowledging on the first
frame; only the mark waits.

### Three "lazy" modals were not lazy

`HelpModal`, `MermaidModal` and `FlattenShapeModal` were mounted
unconditionally and told whether they were open by a prop. Each returns `null`
when closed, so nothing drew -- but `lazy()` resolves when the element is
*rendered*, not when it decides to draw something, so all three chunks were
fetched on every board open. Split out of the bundle and then downloaded
anyway. They are gated on their open state now.

The cheap ones (Share, Help, Palette; ~10kB gzip together) are then warmed on
`requestIdleCallback` so they are in memory before anybody asks. **`ExportModal`
is deliberately not warmed** -- it drags 440kB behind it.

### The export chunk was lazy in name only

The worst of these, and the one with a test on it.

`vite.config.ts` routes `engine/export/` into its own chunk. But `chrome.ts`
lives there -- 47 lines holding the name Konva tags interface nodes with -- and
twelve canvas components import it. That was enough to make the whole exporter
a dependency of every board *and* of the dashboard. `Room.tsx` and
`useRoomContextMenuActions.ts` also named `ExportService` in static imports for
three menu items.

Both are fixed: the barrel is reached by `await import()` inside the handlers,
and seven genuinely shared leaf modules are excluded from the chunk.
`engine/export/exportChunking.test.ts` holds the invariant, because the bundle
output looks identical whether the split works or not -- it lists a separate
file either way. The test fails if anything outside `engine/export/` imports a
module not on the shared list, or names the barrel statically. It caught two
cases I had missed while I was writing it.

### Smaller

`lodash` → `lodash/throttle` in `usePhysics` (26kB → 1.3kB gzip; the barrel
import pulled the whole library for one function). `PerformanceOverlay` is a
Ctrl+Shift+P HUD mounted at the app root on every screen, and it statically
imported `CanvasEngine`, `CameraSystem`, `SpatialIndex` and rbush -- onto the
dashboard, which has no canvas. The keystroke stayed; the readout moved to
`PerformanceHud.tsx` behind a `lazy()`.

### Still open: the entry preloads the editor

Measured, not fixed. The entry's `<link rel="modulepreload">` set is ~877kB
raw, dominated by `app-export` (432kB), `vendor-konva` (302kB) and
`vendor-motion` (122kB). There is **no static path from `App.tsx` to any of
them** -- the entry's own graph is 18 modules reaching only react, zustand,
nanoid and rbush -- so this is rolldown/Vite preloading the dynamic route
chunks' dependencies, which makes opening a board instant and makes the
dashboard pay for it.

It may well be the right trade, since most sessions do open a board. What is
*not* defensible is `app-export` being in that set at all. Removing the manual
chunk rule was tried and measured worse (967kB eager: the code redistributes
into `vendor-konva`, which grows 302 → 480kB, and `app-physics`, 90 → 286kB),
so the grouping is doing real work and the fix is not a one-line config change.
This needs a pass with actual network profiling. Do not churn `manualChunks`
without measuring both ways -- `python /tmp/measure.py` style accounting off
`dist/index.html` is what the numbers above came from.

## 4e. Room codes, backups that know themselves, and the riskiest click

### A board id you can read out

`engine/room/roomCode.ts`. A board is shared by sending its link, which fails
the moment somebody cannot click one: reading it out on a call, typing it off a
screen. The id is a `nanoid(10)` whose alphabet contains `l`, `I` and `1`, `O`
and `0`, and both cases of everything.

**It is not a shortened alias.** There is nowhere to keep a mapping, and a short
alias would be a *weaker* way into a board than the link it stands for -- the id
is the capability, so the weakest way in sets the security of the whole thing.
The code is the id in Crockford's Base32. nanoid's alphabet is exactly 64
symbols, so an id is exactly 60 bits, and 60 divides by 5: twelve symbols, no
padding, no loss, and **every board that already exists has a code**.

The thirteenth symbol is a checksum (Crockford's mod-37 scheme, computed by
Horner so it needs no BigInt). It is the part that earns its place: without it a
mistyped code is still a valid room id, so the app opened a *different* board,
which did not exist, which meant an empty canvas and somebody certain their
colleague's work was gone. Tested: every single-symbol typo is refused.

### `roomFingerprint`, and why a backup must not contain the room id

A JSON export is a file people attach to tickets and commit to repositories.
The room id is not a name, it is the capability to edit the live board. Writing
it into the export would mean committing a backup to a public repo hands the
world edit access, and nothing about saving a backup suggests you are
publishing a key.

So the file carries a 32-bit FNV-1a fingerprint instead. It answers the only
question the file has to answer -- "is this a backup of the board I am in?" --
and identifies no board in particular: 32 bits over a 60-bit id means roughly
2^28 boards share any value. **Truncation is doing the work here; a longer
digest would be closer to the id it stands for.** Do not "improve" it to
SHA-256.

Exports also carry the board's `title` now, and `restoreDocument` puts it back
on a *replace* (not on a merge -- the board is still itself). And the parser's
`warnings`, which it has always produced and the dialog has always discarded,
are listed before the irreversible button.

### Removing a board from the library

**This is the most dangerous click in the app and it does not look like it.**
It is not a delete: the board is untouched, still on the server, and the link
still opens it. That is what makes it dangerous. There are no accounts, so the
recents list is for almost every board the only record of its address, and
losing the address is losing the work -- every object still there and nobody
able to reach it. It was one unconfirmed click on a small X sitting on a card
people are aiming a pointer at.

Two recoveries now. An Undo on the notice, which restores the entry *at its old
index* so undo looks like nothing happened; and `vega_removed_workspaces`
(capped at 24) behind a quiet shelf under the grid, because a toast is gone in
ten seconds and the realisation usually is not.

`NoticeLayer` moved from `Room` to `App` to make that possible -- it always
documented itself as belonging at the document root, and being mounted inside
`Room` meant the library had no way to say anything at all. It is
`position: fixed` now rather than `absolute`, since it no longer hangs off the
room's shell.

### Two help-modal bugs worth remembering

**A sentence is not a flex container.** `.help-modal__orient` was
`display: flex; gap: 4px`, which makes every text node and every `<kbd>` a
separate flex item. A sentence with three keys in it arrived as seven fragments
stacked down the panel, and the gap put a visible space in front of every full
stop that followed a key. Ordinary inline flow, `kbd` as `inline-block` with no
margin. If you see text mysteriously fragmenting, check for a flex parent.

The wording was also circular: the general form "`{MOD}` is `Cmd` on a Mac and
`Ctrl` everywhere else" renders on Windows as "**Ctrl** is **Cmd** on a Mac and
**Ctrl** everywhere else". It is written from the reader's machine now, in two
sentences.

**Opening was slow because it opens on "Everything"**, which builds every lesson
card, every animated demo and every shortcut section before it can paint.
`content-visibility: auto` with `contain-intrinsic-size` on `.help-lesson` and
`.help-section` lets the browser skip what is below the fold -- which also holds
the demos still, since those are CSS animations and one nobody can see is pure
cost per frame.

### And Cmd+P is Print

It was a second opener for the command palette, with a `preventDefault()` on it.
A shortcut that is wrong on every operating system is not a convenience. Held by
a test.

## 4f. The server: what was wrong, and what is still open

Full write-up in `docs/DEPLOYMENT.md`. The short version, because these are the
ones that would have bitten in production.

### The security work was bypassed

The media proxy had `nosniff`, a `default-src 'none'` policy and a refusal to
echo back a client-chosen content type. **Nothing used it.** The upload
response handed back a direct object-store URL and the client wrote that into
the document, so media was served by a world-readable bucket with whatever type
it was uploaded with. The bucket is private now and the proxy is the only way
in. Two bonuses fell out of it: media access follows room access, and images
now load with CORS so PNG export stops being silently tainted.

**Existing boards hold the old URLs.** `scripts/rewrite-media-urls.ts` fixes
them; it reports by default and needs `--apply`.

### One-character room ids

`onAuthenticate` validated with `/^[a-zA-Z0-9_-]{1,128}$/`. The entire access
model is "the room id is the capability", and it accepted an id of length one.
Now `checkRoomId` with a floor from `MIN_ROOM_ID_LENGTH`.

### Credentials that fell back to a published password

`process.env.X || "canva_password"`. A missing variable in production did not
fail, it succeeded, on a password committed to this repository. `config.ts`
reads everything once, and under `NODE_ENV=production` refuses to start on a
missing value or a known development default -- listing every problem at once
and exiting 78. Same for a wildcard `ALLOWED_ORIGINS`.

### The write rate

`onChange` fires per Yjs transaction -- during a drag, every few frames -- and
did two Postgres round trips each time, one of which was an upsert for a fact
that cannot change once true. `historyBuffer.ts` batches into one multi-row
insert per second and `KnownRooms` makes the upsert once per room per process.
A hard kill costs at most one flush of *scrubbable history*; the canonical
document is `room_snapshots` and a graceful stop drains first.

### Tests that tested a copy of the code

`server.test.ts` opened with its own transcriptions of the mime allow-list, the
extension table, the room-id regex and the token bucket, and asserted against
those. Deleting an entry from the server and forgetting the copy leaves a green
suite describing code that no longer exists -- worse than no test, because it
reads like coverage. Those now live in `media.ts`, `rooms.ts` and
`rateLimit.ts`, and the tests import them.

### Still open, in order

Full write-up, with the reasoning and the concrete fixes, in
`docs/GOING-LIVE.md`. That document is where to start a new session: it opens
with the three things that block a public launch, and closes with the decisions
that need a product call rather than code.

The single risk not listed in `DEPLOYMENT.md` and worth repeating here: **the
upload endpoint is an anonymous file host with no quota** beyond 50MB per file.
That is the one to fix before sharing a link with anybody.

1. **Backups.** `room_snapshots` is the canonical state of every board,
   overwritten in place, no versioning, no PITR configured anywhere. This is the
   largest single risk in the system.
2. **Nothing is ever deleted** -- no room TTL, no S3 lifecycle, no orphan
   reaping. `last_active_at` is written and never read.
3. **Rate limiting is per-process**, so it stops limiting the moment there is
   more than one instance. Must move to Redis in the same change as scaling out.
4. No load testing. The batching is reasoned, not benchmarked.

## 4g. Going live, and the diagram engine

The session that put this on the internet and then found out what that costs.

### The deployment, and one broken build

Live on Vercel → Render → Neon → R2 → Sentry. Two things were true on arrival
that nobody had noticed:

**Sentry was a `console.log`.** Both `observability.ts` files did
`if (dsn) logger.info('Sentry error tracking enabled')` next to a comment
saying the SDK would initialise there, and neither `@sentry/node` nor
`@sentry/react` was in any `package.json`. The DSNs were set on both hosts, so
the deployment had been printing a line claiming error tracking was on, and
reporting nothing, for as long as it had been live. **The log line was the one
piece of evidence anybody would have checked, and it was the thing that was
wrong.** `/readyz` now reports `errorTracking` from whether `init` actually
returned; trust that field, not a log line.

The client imports the SDK by dynamic `import()`. Statically it costs nothing
while the DSN is unset — the branch folds and the SDK is shaken out — so a
local build looks free and the cost appears only in the deployment that has it
configured. With the DSN set the entry chunk went 5.76 kB → 34.09 kB gzipped.
Listeners register synchronously and errors thrown before the SDK lands are
buffered and flushed.

**A temporal-dead-zone crash reached production.** `fitToView`'s dependency
array read `preview` before it was declared. `npx tsc --noEmit` passed; `tsc
-b` — what the build runs — failed with TS2448, and at runtime it threw during
render and React unmounted the tree. That is the "whole canvas goes blank"
report. See §1 for why those two checks differ.

### Backups exist now, and are the last unproven thing

Neon's Free plan history window is **6 hours, capped at 1 GB of change
history**. That does not cover a bad write found the next morning, and it is
the same account. `.github/workflows/backup.yml` runs a nightly `pg_dump` to
R2, keeping 30, refusing to upload a dump that is under 1 KB, unreadable by
`pg_restore --list`, or missing any of the five tables.

Verified against PostgreSQL 17.11 with the real migration SQL: dumped,
restored into a fresh database, compared by per-table MD5 of hex-encoded
contents. All five tables matched, including the three `bytea` columns a
text-mangling backup would corrupt silently, and the restored schema kept all
three `ON DELETE CASCADE` foreign keys.

**It has not yet run against Neon and R2.** All five repository secrets are
set. `R2_BACKUP_BUCKET` is `vega-canva-media` — the same bucket as uploads, a
deliberate choice to start backing up immediately, and the tradeoff is real:
anything that purges media takes the backups with it, and the server's own
credentials can delete them. `docs/SETUP-CHECKLIST.md` carries the migration
to a scoped bucket as the follow-up.

### The reaper's clock was broken

`rooms.last_active_at` was written only from the Database extension's `store`
callback, which fires on *change*. A board a team reads daily and never edits
had a frozen timestamp — and `reaper.ts` hard-deletes by that column, cascading
to snapshots, updates and media. The reference board everybody consults and
nobody edits was the row most likely to be collected. `roomActivity.ts`
refreshes on connection now, throttled, `UPDATE` not `UPSERT` so it cannot be
used to mint empty rows. Both pre-flight counts were zero when measured, so
nothing was lost.

### The diagram engine

`docs/DIAGRAM-ENGINE.md` is the full account. The three that matter here:

**Dagre's routing was computed and thrown away.** `LayoutResult` carried only
nodes and clusters, so every connector attached with `port: 'auto'` and the
canvas re-derived each path with a router that knew nothing about the channels
dagre reserved. The polyline is still not stored — `connector.ts` opens by
saying a connector knows *which objects it joins*, never where its ends are —
so what is kept is the route's **intent**: an `Anchor`, normalised to the
node's own box, which survives the node moving and resizing.

**Subgraph membership was recorded twice and could disagree.** A node
mentioned before the block it belongs to landed in `subgraph.nodeKeys` with no
`subgraphId`. `layout.ts` parents to dagre by `subgraphId`, so it was placed
*outside* the cluster; `build.ts` assigned `frameId` from `nodeKeys`, so it
got the frame anyway; and `ObjectRenderer` clips a framed node to its frame's
rectangle. The node was placed outside a box and then cut to fit it. Both ends
read `subgraphId` now.

**Boxes were sized by counting characters** — width capped at 320, height
counting explicit newlines only, so the cap created wrapping the height never
heard about. `measureSize` asks the project's own wrapper instead.

### Three silent failures, closed

- **Uploads.** `if (data.url)` had no `else`, so a 413 over the storage quota
  did nothing at all. The image draws from a local blob URL, so it looked like
  success and vanished on reload. A queued offline upload is `info`; a
  rejection is `warning` carrying the server's own words.
- **Shape labels drifted left.** Konva measures a string once and keeps the
  result. Measured against a fallback face, `align: 'center'` is computed from
  the wrong numbers, and nothing re-measures when the real font lands.
  `StickyRenderer` and `TextRenderer` both already subscribed to `fontEpoch`;
  `ShapeRenderer` was the third caller and had neither half of the pattern.
  **Both halves are required** — subscribing without calling `ensureFontLoaded`
  waits for an event nobody triggered. `shapeLabelFont.test.ts` holds all three
  to the pair.
- **Dark text on dark shapes.** `labelInk` derives from the node's *own fill*,
  which keeps `DEFAULT_INK`'s rule intact: content must not resolve per
  viewer, and the fill is in the same document, so every viewer computes the
  same answer. Only the untouched default is overridden — a colour somebody
  picked is an instruction, including a bad one.

### A control that passed its test and did not work

The mermaid zoom buttons lived *inside* the preview stage, whose `pointerdown`
calls `setPointerCapture` to start a pan. A press bubbled, the stage captured
the pointer, and the `pointerup` that completes the click went to the stage.
`element.click()` dispatches a click directly and never goes near pointer
capture — so the automated check passed against a control that was broken for
every human. **When a control works programmatically and not by hand, suspect
pointer capture first.** The cluster is a sibling of the stage now.

## 4h. Roles that mean something, and the half they still do not

### The bug was that it looked finished

The share dialog offered *Can edit*, *Can comment* and *Can view*, and the role
travelled to the server as a field in the connection claim. The server read it
and set `readOnly` from it. Every part of that is present in a screenshot of a
working feature, and none of it was a permission: **the client chose its own
role**, so "view only" was a checkbox the viewer ticked for themselves. The
dialog had at one point promised that "mutation packets are rejected
server-side", which was true in the narrow sense that they *were* rejected —
for anybody who asked to be rejected.

This is invariant 6 wearing a different hat. A capability was declared, the
renderer honoured it, and the thing on the other end had no way to.

### What signing buys, stated narrowly

`apps/server/src/shareToken.ts` mints `<base64url(payload)>.<base64url(hmac)>`
over `{r: room, o: role, e: expiry, i: issued, n: nonce}` with HMAC-SHA256.
`onAuthenticate` verifies it, and **a verified role outranks anything the
client says about itself**. The link shape is `/i/<token>`.

Three properties are worth knowing by name, because each one is a mistake that
was available here:

- **Signature before expiry.** An unverified `exp` is a number the attacker
  picked. Read nothing out of a payload you have not authenticated — not even
  to decide whether to bother authenticating it.
- **Bound to a room, not just to a role.** `payload.r` is compared against
  `documentName`, so a view link cannot be replayed sideways into a different
  board.
- **Attenuation needs no authority.** A token strictly *reduces* what its
  bearer can do, which is why `POST /rooms/:roomId/invite` can be open: minting
  a weaker capability from a capability you already hold gives nothing away.
  The day it can mint an *equal or greater* one, it needs a caller check.

### The half it does not solve, and why the dialog says so

The payload contains the room id in plain sight. A viewer can read it out of
their own link and connect on the bare room id at full access. **Signing stops
a view link being promoted; it does not make the board private.** Closing that
means refusing unsigned connections entirely, which is a product decision — it
would break every room link already in the wild.

The dialog states this rather than implying a privacy the model has not got.
That sentence is load-bearing: the previous version of this feature was wrong
mostly because its copy over-promised.

### `commenter` is still client-side, on purpose

`readOnly` is set for `viewer` only. A commenter has to write to the Y.Doc —
that is where comments live — so the wire cannot tell a comment from a move.
The restriction is the toolset in `permissions.ts` and nothing more. It is an
honest interface, not a gate, and it is the next thing to fix if comments ever
matter more than they do now; the fix is a document-level write filter, not a
connection flag.

### The room code is hidden for restricted roles

`roomCodeFor(roomId)` renders a board id you can read down a phone. It is
**full access by construction** — it is the room's own address — so showing it
next to a view link would hand back everything the view link withheld. The code
appears for *Edit* and for nothing else. A small piece of UI, and the one place
in the dialog where an obvious convenience is the whole vulnerability.

### `SHARE_SECRET` is not set in production

Without it the mint endpoint answers 501 and the dialog says the deployment
cannot issue restricted links; *Edit* still works, because an edit link is the
plain room URL and needs no token. So **two thirds of this feature is dark
live** until the key is set — `docs/SETUP-CHECKLIST.md` item 3. Rotating the
key is also the only revocation there is: no server-side list, no per-token
kill. That is a fair trade for a stateless token and a bad surprise if you did
not know it.

### The dialog itself

Rewritten alongside: one `.share__choice` group binding each mode to a plain
sentence about what it grants, an expiry select that only appears when a token
is actually being minted, and a `MintState` union so *working*, *ready*,
*unavailable* and *error* are four states rather than one boolean and a guess.
A new link is minted whenever the terms change, because a stale link sitting
under a role it no longer matches is the exact failure this whole section is
about.

## 4i. A board you could not leave

The only way out of a board was the browser's Back button, which is not a way
out: arrive from a shared link, a bookmark or a new tab and there is nothing
behind you. Every route into this app that is not the dashboard produced a
room with the lock on the inside.

The corner mark is the way home now. Three decisions in it are worth keeping:

- **The logo, not a button beside it.** The mark was inert, which spends the
  most recognisable spot in the application on decoration, and every tool of
  this shape already puts its way home there. A separate arrow would have put
  two controls in a corner the convention expects one in. The hover swap to an
  arrow is what turns the convention into an affordance — identity at rest, an
  action under the cursor.
- **An `<a href="/">`.** Cmd-click, middle-click, "open in new tab", "copy link
  address" and the status-bar preview all come free and all vanish the moment
  it becomes a `<button>` that assigns `location.href`. They look identical in
  a screenshot, which is why this is worth writing down.
- **No "are you sure".** It is a full page load, so the question was fair. The
  answer is that `doc.ts` attaches `IndexeddbPersistence` to every room, so
  offline edits are on the device and merge up on reconnect — which is exactly
  what the sync pip two elements along already promises in words. A confirm
  here would contradict it, and a gate that guards nothing teaches people to
  click through gates.

The crossfade is two faces stacked in one grid cell rather than a swapped
child: the mark and the arrow are different widths, so a swap would nudge the
board title for a frame. Verified in both themes and both states against the
built stylesheet — no shift, and the title sits at the same x either way.

## 5. Next up

### 5a-0. The four things to do first

Both of the first two are console switches, not code — nothing in the repo
changes and nothing can be verified from here.

1. **Run the backup workflow once by hand.** Actions → *Database backup* → Run
   workflow, `dry_run` checked, then again unchecked. Until an object lands in
   the bucket, recovery is Neon's six-hour window and nothing else. Everything
   else in this list can wait; this is the only one where the cost of waiting
   is unbounded.
2. **Set `SHARE_SECRET` on Render.** Until it is there, the share dialog can
   only issue full-access links: *View* and *Comment* both answer 501 and say
   so. The feature is built, tested and deployed, and two thirds of it is
   switched off. `docs/SETUP-CHECKLIST.md` item 3 has the command.
3. **Look at the mermaid modal.** The dialog was redesigned, the templates were
   rewritten and the zoom was rebuilt, and the browser tab wedged at a 0x0
   viewport before the last of it could be seen. Functionally verified — all
   seven templates parse, the preview renders, the zoom steps 51 → 63 → 79 and
   fits back — but not *looked at* in its final state.
4. **Confirm the zoom buttons respond to a real mouse.** They were broken by
   pointer capture and fixed structurally; the fix could not be verified here
   because synthetic pointer events do not reach this tab at all. A capture
   listener on the whole modal recorded nothing from a real click, which is how
   that limitation announces itself.

### 5a. Verify what was built fast

**This session traded verification for speed, on the user's instruction, and
the bill came due six times** — see the preamble. Nothing below is known
broken; all of it is unwatched.

- **The right-click menu targeting an object.** Only the empty-board variant
  has been seen. The object variant needs Konva's hit graph, which an
  automation tab does not populate.
- **The Mermaid apply path.** Parse, layout, build, silhouettes and the
  templates now carry 79 tests, and the frame-clipping bug that made applied
  diagrams look broken is fixed and covered. The `Room` wiring — transaction,
  replace-in-place, selection — still has never run.
- **Sketched caps, midpoint labels, the context menu, dock spacing** were
  confirmed by reading the scene graph rather than by looking. The label
  contrast fix *was* seen working (white ink on a white plate lifted to
  `#828282`).
- **Two real browsers with two real mice** — still the check automation cannot
  stand in for.
- **Everything the last two sessions built is unwatched.** The Chrome extension
  did not connect on a single attempt across either of them. In priority order,
  because these are the ones where a wrong answer is invisible from the code:
  a selection-scoped **PNG next to the SVG of the same selection** (they must
  contain the same objects — the whole point of `isolate.ts`); a **whole-board
  PNG on a board larger than the window**, which is the `renderScope` fix and
  the one most likely to still be wrong; an **export of a selection containing a
  photograph**, for `imagesReady`; the **rail after a handle drag is interrupted
  by a selection change**, and after **finishing a text edit without moving the
  object** — the two ways it used to disappear; and the **shades row with
  `#FFFFFF` and `#000000` picked**, which should now show nine distinct steps.

### 5a-ii. The walkthrough project (still what the user originally asked for)

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
4. **New surfaces** — the canvas empty state and the rooms page are done, and
   ~~**first-run onboarding**~~ is **done** as well: four surfaces, each one
   deliberately not a tour, and each carrying the reasoning for its own scope.
   `WelcomeSequence` answers *what is this for* in three beats, once ever;
   `CanvasEmptyState` gets the first object onto the board in place;
   `FirstRunGuide` says what the screen cannot — that other people can be here,
   that a link is the whole invitation; `DockCoach` asks the one question the
   dock cannot, which is whether this board is an endless surface or holds a
   frame. Note the position they all take, because item 2 has to live with it:
   **the furniture teaches itself, at the moment each piece becomes relevant.**
   A **marketing-grade first run** is still not done.
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

> This whole section was blank for two commits. A rewrite of §5a retitled it
> and left the `5a-ii` heading standing with nothing under it, so the single
> most important "what to do next" in the file read as an empty line. Restored
> from `5cebd12`. It is the same failure as the panel-navigation entry below,
> and the same lesson: **this file is a record with no test holding it.**

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

**A separate, long-running sticky complaint — "the text shifts and glitches" —
was reproduced and fixed.** It was not timing at all: three places derived the
note's text box from the same fields and disagreed. The renderer reserved the
footer band only when a note *had* reactions, so the first person to react made
the handwriting smaller; and the editor overlay had a third version with no
footer band and no tag strip, directly under a comment promising it asked
`stickyFit` the same question the renderer did. `stickyFooter.textBox` owns it
and all three read it.

### 5d. The two panels — a build phase

The user's brief for this is long and specific; the short version is that both
panels exist, both are functional, and both are thin against what the brief
asks for. What follows is an audit, not a wish list.

**`components/LayersPanel.tsx` (1609 lines) already does:** a virtualized
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
- ~~**Keyboard navigation of the panel itself.**~~ **Done** (`16b7858`).
  `handleTreeKeyDown`: ↑/↓ move the cursor (Shift extends), ←/→ fold and unfold
  a frame, Enter renames, Space toggles visibility, Cmd+↑/↓ restacks, Cmd+A
  selects every visible row, Delete removes the selection, Escape clears it.
  The container is `role="tree"`, `tabIndex={0}`, with `aria-activedescendant`
  pointing at the cursor row — the tree previously could be clicked but never
  driven, because focus skipped from the search box straight to the first row's
  eye toggle. **This entry stayed listed as missing for two commits after it
  shipped**, including one that edited this file; see the note under
  §"Suggested order" below.
- **Frame wrapping** — turn a selection into a frame. Still the one thing on
  this list that does not exist; nothing in `engine/` or `components/` names it.
- ~~**Reparenting by drag**, not just reordering.~~ **Done.**
  `engine/model/layerDrop.ts` gives every row three targets rather than one —
  top edge, bottom edge, and the middle of a container — so *position* and
  *parent* stopped being one answer and "put this at the top level, between two
  grouped rows" became reachable. `planLayerDrop` writes `parentId`, refuses a
  drop that would close a loop (`wouldCycle`), and reparents a folder record
  rather than its members. Wired through `applyGroupPlan` in the panel, and
  covered by `layerDrop.test.ts`.

  **Frames are deliberately not containers here**, and that is not an omission
  to be fixed: `frameId` is maintained *geometrically*, from what an object
  sits inside on the board, so writing it from a layer row would claim
  membership of a frame the object is nowhere near and the next geometry pass
  would disagree. A frame row takes `before` and `after` like any other node.
  You put something in a frame by dragging it into the frame.
- Section, Component, Instance and Mask node types. These are **blocked**:
  sections and masks are their own features, components are Phase 7.

**`components/PropertiesPanel.tsx` (683 lines, and ~4700 across `components/panel/**` once the sections are counted — it was one 2614-line file and the per-block sections have since moved out to `panel/sections/*`) already does:** Transform
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
- ~~**It shows nothing when nothing is selected.**~~ **Closed, and not by
  building it.** The brief's version — board properties in the empty panel:
  background colour, units, ruler and grid toggles, a count per node type —
  **was built, and then deliberately taken out again.** Every part of it
  already had an owner: the Layers panel lists and filters by type, and snap,
  theme and the ruler/grid toggles live in the View menu. A panel that repeats
  two other surfaces is not richer, it is a third place to keep in step, and
  the reader has to work out which one is authoritative. What is there now is a
  marquee mark and two lines of type saying there is nothing to inspect.

  **Do not rebuild it.** The full reasoning is in the comment above the
  `if (!node)` branch in `PropertiesPanel.tsx`, which is where it belongs — an
  entry on a to-do list cannot say *why not*, and this one read as an omission
  for as long as it sat here.
- **Independent corner radii and corner smoothing.** Still one uniform
  `cornerRadius?: number` on the appearance block, driven by one drag handle.
  The brief wants four independent corners and a smoothing parameter, and
  neither exists. **The squircle is not that** and does not close this: it
  shipped as its own `ShapeKind`, drawn from continuous-curvature anchors, so
  it is a *shape you choose*, not a parameter you turn up on a rectangle.
- Constraints/pinning grid and Auto Layout are **Phase 6**; component link,
  variants and exposed properties are **Phase 7**. Do not start those here.

**Suggested order from here**: frame wrapping → independent corner radii and
corner smoothing. That is the whole list now — drag-reparenting shipped, and
the empty panel was answered by deciding against it. Both were struck on
2026-08-27, by reading the code rather than by anyone remembering.

> This list used to lead with panel keyboard navigation, which had already
> shipped in `16b7858` — **the same commit that edited this file**. A whole
> session could have been spent rebuilding it. The failure is the one invariant
> 7 describes, in prose rather than in code: two records of the same fact, and
> the one that is easy to forget is the one written in English. When you finish
> something listed here, strike it in the commit that finishes it, not later.

**Blend and Blur are both hidden for connectors now.** Neither was a decision
anyone made: both arrived as a side effect of connectors being added to
`APPEARANCE_TYPES`, and neither survives contact with what a connector is. A
connector's job is to stay legible across whatever it crosses — multiply
darkens it into the shapes it runs over, screen washes it out — and layer blur
turns a 2px stroke into a smear, destroying the one property the object exists
to have, while backdrop blur is invisible under a stroke that thin. Both gate
on `hasConnector` in `PropertiesPanel.tsx`. **The general lesson: when you give
a type a capability it never had, walk every control that capability unlocks.**

### 5e. Still logged, from earlier phases

- ~~**Real nested groups + deep select.**~~ **Done, and it was the model change
  this entry said it would be.** A group is no longer only a synthetic id its
  members share: `groupsMap` is a Y.Map of `GroupRecord`s in the document, each
  with its own optional `parentId`, so a group can hold a group. Membership of
  a *node* is unchanged — still one `parentId` — which is why everything that
  already read it kept working. `engine/model/groupTree.ts` owns the graph
  questions (which unit a selection really names, where a new group belongs,
  what ungrouping puts back) and is pure and tested; double-click steps one
  level in (`groupToEnter` in `hooks/useCanvasSelection.ts`); `undoManager`
  tracks `groupsMap` alongside the objects.

  What this cost before it landed is worth keeping: grouping two groups
  **silently dissolved the inner one**, both member sets rewritten to one new
  id with no way back, while the layers panel drew a tree exactly one level
  deep and called it a hierarchy.
- **The scale tool** — distinct from the transformer, which resizes geometry;
  a scale tool multiplies strokes, radii, shadows and type along with the box.
  Only now well-defined, since all four of those became real.
- **Layout grid overlays**, which want a per-frame grid definition and belong
  with the frame work.
- ~~**A compound path cannot be edited anchor by anchor.**~~ **Done.** The
  selection was `anchor: number | null` — one index, on the assumption of one
  contour, and a bare index cannot name an anchor on a boolean result or a
  glyph with a hole. `PathSelection` names the subpath as well as the anchor,
  and `pathEditing.ts` rebuilds the one contour it belongs to and leaves the
  rest alone.
- ~~**Booleans decline on a rotated or scaled operand.**~~ **Done** (`f7780b0`).
  The transform is applied through `mapPath` — a cubic is affine-invariant, so
  putting its four control points through the node's own transform gives
  exactly the curve on the screen, with no flattening and nothing lost. The
  same commit turned **subtract** the right way round: it kept the front shape
  and cut the ones behind out of it, while its own button said the opposite and
  while every comparable tool removes the front from the back.
- **Kerning and OpenType are one decision, not two** — both want text off
  Konva's `Text` and off the `<textarea>` overlay, and neither exists.
  **Paragraph spacing was the third of these and has shipped**: `layoutText`
  produces positioned line boxes, so `paragraphSpacing` is a field on the
  typography block that the layout honours, and it needed none of the rewrite
  the other two do. That is the useful shape of this entry now — the item that
  fell out of the line-box work went, and what is left is the part that really
  does need Konva's text replaced.
- **The shell around the canvas.** No router — every navigation is a full page
  reload rebuilding the Y.Doc. No workspace deletion. The dashboard reads
  `localStorage` only. No landing page.
- ~~**Bundle splitting.**~~ **Done.** `vite.config.ts` names the vendor and
  subsystem chunks; the build is 32 of them. Trust the table at the top of this
  file rather than any figure written here — this line sat at a stale 1.33MB
  for several sessions, then at a stale "one chunk" after the splitting had
  landed, which is invariant 7 in prose twice over.
- **Two real browsers with two real mice** — still the one check automation
  cannot stand in for.

### 5f. Not started from the brief

**Wireframe-to-code** and the **laser pointer**. The laser pointer is small and
independent (it is ephemeral presence state — see invariant 5) and could be
slotted in any time.

Two entries left this list and were still sitting on it on 2026-08-27:

- **Mermaid diagrams shipped**, in both directions — `engine/diagram/` parses
  `flowchart`/`graph` into real shapes and connectors rather than handing the
  text to the `mermaid` package and dropping an SVG on a canvas whose whole
  point is that everything on it is editable, and any selection goes back out
  as source. Marked **Shipped** twice in `docs/CANVAS-SPEC.md` §14b, described
  in `README.md`, and carrying 26 tests, while this line still called it not
  started.
- **The Excalidraw-style hand-drawn rendering shipped** — `engine/model/rough.ts`
  with `SketchLevel`, `FillStyle` and `ShadingDensity` on the appearance block,
  a Sketch section in the properties panel, and the pen honouring it. The
  vaguer half of "Excalidraw-style ideas" is not a scoped item and never was;
  if something specific is still wanted from it, write down which thing.

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

The operational documents, now that this is deployed:

| Document | What it answers |
| --- | --- |
| `docs/SETUP-CHECKLIST.md` | **Start here.** What is switched off in somebody's browser, and what stays broken until it is on. |
| `docs/GOING-LIVE.md` | What blocks a public launch, ranked; the authentication plan; the $0 stack |
| `docs/DEPLOYMENT.md` | The access model, configuration, media, history, schema, health |
| `docs/BACKUP-AND-RESTORE.md` | The two layers, and the restore procedure — written before it is needed |
| `docs/DIAGRAM-ENGINE.md` | How mermaid becomes canvas objects, and why routing is carried as anchors rather than waypoints |

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
| `engine/model/connector.ts` | routing: ports, auto-side choice, orthogonal and curved routes, bounds. Pure, tested. |
| `engine/model/connectorAnchor.ts` | an exact attachment point in a node's own proportions. Pure, tested. |
| `engine/model/connectorBinding.ts` | what a pointer means, as an end. The one rule the tool and the editor share. Pure, tested. |
| `engine/model/connectorTargets.ts` | the only bridge from nodes to boxes — what is connectable, and where its box is |
| `engine/model/linePath.ts` | the five line profiles as point lists, including the stamped coil. Pure, tested. |
| `engine/model/lineEnds.ts` | endpoints ↔ node, both the current form and the legacy box. Pure, tested. |
| `engine/model/connectorEnds.ts` | end caps, the trim, and `terminateRun` — the one place a marker is placed |
| `components/canvas/ConnectorEditor.tsx` | the two ends as handles you can drag onto anything |
| `engine/export/svgDocument.ts` | assembling the SVG file: definitions, backdrop, artwork. Takes the paint collector and drains it, so the gradient `<defs>` cannot go unwritten again. Pure, tested. |
| `engine/export/pdfWriter.ts` | the PDF file format: a frame is a page, the xref offsets, the page-size limit. Pure, tested. |
| `engine/export/rasterLimits.ts` | the browser canvas caps, edge **and** area, and the scale that fits them. Pure, tested. |
| `engine/export/filenames.ts` | what an exported file is called, in any writing system. Pure, tested. |
| `engine/export/inlineImages.ts` | pulling media into an exported SVG so the file survives being sent to someone. Pure, tested. |
| `engine/tools/shortcuts.ts` | the single-key tool bindings, and the inverse map `Room` resolves through |
| `engine/tools/toolNames.ts` | what each tool is *called* on the help screen, tested against the bindings |
| `engine/tools/nudge.ts` | what an arrow keypress means, in world units. Pure, tested. |
| `components/HelpModal.tsx` | the shortcut reference. Its tool rows are derived; the rest is hand-written and has drifted before — see §4a-ii. |
| `Home.tsx` | the rooms page: rail, stage, boards and templates as separate views |
| `DESIGN.md` | the token layers and the named rules. Read before touching `index.css`. |
