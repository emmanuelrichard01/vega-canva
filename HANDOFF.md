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

Last verified 2026-09-02, by running the four commands above. Every figure in
it is a second record of something the tools will tell you in 30 seconds — when
it disagrees with them, they are right and this is stale.

| | |
| --- | --- |
| Branch | `main`, level with `origin/main`. `grid-slots-and-notices`, `rebuild/time-travel-and-physics` and `session-2` are history, not workspaces |
| Deployed | **live**: Vercel (`vscanva.vercel.app`) → Render (`vega-canva.onrender.com`) → Neon → Cloudflare R2 → Sentry |
| Typecheck | clean via `npm run build` |
| Tests | **2494** across 145 files (frontend, 1 skipped — see `BENCH` below); **75** across 9 files (server) |
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
17. **The document may only hold a value that means the same thing to every
    reader.** Invariant 5 says ephemeral state stays out of the document; this
    is the sharper edge of the same rule, because the offender here *looks*
    like content. `URL.createObjectURL(file)` produces a syntactically perfect
    URL that resolves only in the tab that minted it — so a dropped image drew
    for its author and was a grey placeholder for everybody else, and came back
    dead after any reload. A `local:` reference goes in the document instead
    (`pendingMedia.ts`), deliberately not fetchable so nothing loads it and
    quietly fails. Before you write a string into the CRDT, ask what it means
    on somebody else's machine tomorrow.
18. **Enforce a permission on the write path, never on the controls.**
    `mutations.ts` is invariant 1, so it is the only place a rule can be stated
    once and be true everywhere. Gating controls had already failed: tools and
    dragging were gated, the contextual rail was not, and a viewer could
    recolour shapes — writes that landed locally and were dropped by a
    read-only server, forking their board from everyone else's while looking
    like they worked. **A divergence that resembles success is worse than a
    refusal.** Hiding controls is presentation; it follows the rule rather than
    being it. See `writeGate.test.ts`, and §4k for why "just use focus mode"
    is not an answer.
19. **"Fine on my end" means somebody has a private cache.** Three of them here:
    the Yjs doc in `y-indexeddb`, the offline media queue, and `localStorage`
    board covers. Each makes one participant's view survive something everybody
    else's does not, so a fault that would be obvious becomes a report about
    *other people's* screens. Every empty-board bug this project has had was
    this shape (§4j). When a report is one-sided, find the cache before you
    read any other code.
20. **A correlation offered with a bug report is evidence about what the
    reporter did, not about where the fault is.** "Boards that were backed up
    and restored show nothing to other people" sent a day's suspicion at the
    restore, which turned out to be correct on both counts that could be
    checked — production snapshots held real objects, and a two-document sync
    test agreed. The reporter had simply been sharing restored boards. Take the
    symptom seriously and the attribution as a hypothesis.

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
The restriction is `permissions.ts` plus the write-path gate added in §4k, so
a commenter is now refused object edits *by this client* rather than merely
not offered them. That is a real improvement and still not a gate: the wire
carries a commenter's updates, and a different client could send anything. The
fix, if comments ever matter more than they do now, is a document-level write
filter on the server, not a connection flag.

### The room code is hidden for restricted roles

`roomCodeFor(roomId)` renders a board id you can read down a phone. It is
**full access by construction** — it is the room's own address — so showing it
next to a view link would hand back everything the view link withheld. The code
appears for *Edit* and for nothing else. A small piece of UI, and the one place
in the dialog where an obvious convenience is the whole vulnerability.

### `SHARE_SECRET`, and the only revocation there is

Set on Render on 2026-09-02, in the same change that shipped the route it
feeds. Without it the mint endpoint answers 501 and the dialog says the
deployment cannot issue restricted links — *Edit* keeps working either way,
because an edit link is the plain room URL and needs no token. That
degradation is deliberate: the dialog reports the deployment's real
capability rather than offering a mode it cannot honour.

**Rotating the key is the only revocation that exists** — no server-side list,
no per-token kill, no way to withdraw one link without withdrawing all of
them. That is the price of a stateless token, and it is a fair one at this
size. It is also a bad surprise if you did not know it, which is why it is
written here, in `docs/SETUP-CHECKLIST.md`, and in `shareToken.ts` itself.

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

### Discoverability, and the argument that settled it

The obvious objection is that a logo which reveals an arrow on hover confirms
the action for somebody already reaching for it and teaches nobody else. It is
a fair hit on the arrow, and it lands only if you think the arrow is what makes
the control findable. It is not: **the mark is findable because it is a mark**,
and a logo has linked home on essentially every website for twenty-five years.
The arrow is confirmation at the moment of intent, which is a different job.

It is also worth being clear about who needs to find it at all. Anyone who
arrived from the dashboard has real browser history and Back already works.
The control exists for people who arrived by a shared link or a bookmark — and
for them, clicking the logo is the most guessable action on the page.

**"Go to Your boards" is in the command palette** as a second route, under
Session beside Share. It costs no chrome and it is what somebody who feels
stuck in a board would actually type. It navigates directly rather than
through `onSelectAction`, because leaving the room is not a canvas action and
does not belong in the same switch as "add sticky note".

A breadcrumb — `[mark] Your boards / Quarterly planning`, the Figma and Linear
shape — was considered and **rejected on cost**. It ends the discovery
question outright, and it spends about 100px of the left zone permanently, in
a header where the title already truncates to 180px below 1200px. It would
have to collapse back to the bare mark on small screens, which reinstates the
original problem precisely where finding things is hardest. Two routes and no
added chrome won. Revisit this if the dashboard ever becomes somewhere people
go often, rather than somewhere they leave once.

## 4j. Three ways a board looked empty when it was not

All three shipped in one session, all three produce the same report — "fine on
my end, nothing on theirs" — and they had nothing to do with each other. Worth
keeping together, because the *next* time somebody says that, this is the list
to walk.

### 4j-1. Every invite link opened an empty board

`doc.ts` answered one question twice. `roomId` resolved from the invite first
and the path second; the separate decision "is this the landing page"
re-derived it by asking whether the path began `/room/`:

```text
/i/<token>    roomId -> the room in the token    isHome -> true
```

`isHome` calls `provider.disconnect()` and skips `IndexeddbPersistence`, so an
invited person opened a board that could never receive a document and had no
cache to fall back on. **Every shared link, every role**, and nothing logged a
failure because the socket was closed deliberately.

It is `engine/room/route.ts` now — a pure function, `isHome` derived from
`roomId` so the two cannot contradict — and `route.test.ts` asserts the
invariant directly rather than sampling it: `isHome` is exactly "there is no
board here", across every path and both invite states.

**Why it had no test, which is the part worth carrying forward.** `doc.ts`
runs its side effects at import: a `Y.Doc`, a WebSocket provider, an IndexedDB
connection. Nothing in it could be exercised without opening a socket, so a
four-line decision went unwritten because there was nowhere cheap to write it.
Extracting the pure part fixed both problems at once, and the same move
unlocked `writeGate.test.ts` and `restoreSync.test.ts` later the same day —
**mock `doc.ts` alone and the whole document layer becomes testable.**

Two further callers were re-parsing the path for the same room id and returned
an empty string and `null` on an invite route: the import dialog reported every
file as coming from a different board, and a JSON export fingerprinted itself
as belonging to none.

### 4j-2. The server threw away everything since its last debounced write

`onStoreDocument` is debounced. The shutdown path drained the history buffer,
ended the Postgres pool and exited **without ever telling Hocuspocus to store
what it was holding** — so a deploy, a restart or a free-tier spin-down
discarded every edit since the last write. The comment sitting in that
function said "the canonical document lives in `room_snapshots`". It does.
Nothing was making sure it arrived.

Worse, and the reason it was total rather than occasional: the draining lived
inside `httpServer.close(async () => ...)`. That callback waits for every
existing connection to end, and **WebSocket connections do not end on their
own** — so on any instance with a client attached it fired after the 10-second
forced-exit timer, or never. None of the draining ran.

Shutdown now closes connections, calls `flushPendingStores()`, and waits for
open documents to reach zero before touching the pool — `pool.end()` first
would kill the connections mid-write and hand the loss straight back.

**The symptom is one-sided, and that is the diagnostic.** The person editing
keeps everything, because `y-indexeddb` holds their copy on their own machine;
their board looks complete and always will. Everyone else reads the server
snapshot. *"Fine on my end" is the shape of every bug where one side has a
private cache* — and this project now has three of them (the Yjs doc cache,
the offline media queue, and `localStorage` board covers). Suspect that class
first.

### 4j-3. Media that was on disk and looked deleted

A dropped file wrote `URL.createObjectURL(file)` straight into the node's
`src`, which is to say into the **shared** document. A `blob:` URL resolves
only in the tab that minted it, so every collaborator received a URL meaning
nothing — grey placeholder immediately, while the author saw a photograph —
and the persisted document restored a dead `blob:` string after any reload.
The bytes were in the upload queue on disk the whole time and nothing looked
for them.

The rule this establishes, and it generalises past media: **the document may
only hold a URL that means the same thing to every reader.** It is the content
invariant (a fact in the document must not resolve per viewer) in a costume
that gets past review, because a blob URL is a syntactically perfect URL.

`local:` plus an upload id is what goes in the document now — deliberately
*not* fetchable, so nothing loads it and quietly fails, and any code that has
not been taught about it cannot mistake it for an address. `pendingMedia.ts`
resolves it for the one device holding the bytes; `hydratePendingMedia()` reads
the queue on board open, unconditionally and before any network state, because
the case that hurts is the one where the connection is not coming back.

And the placeholder told two opposite states apart in no way at all. **Failed**
means this is not coming back; **waiting** means nothing is lost. Drawn
identically, the second reads as the first, and the reasonable conclusion is
that the work was thrown away — a success that looks like a loss, which is the
silent-upload-failure bug running the other way.

### What restore turned out not to be

Worth recording because it cost the most time. The report named restored
boards specifically, so the restore was the obvious suspect, and it was
innocent on both counts checked:

- **Production snapshots decode to real boards** — 33, 19, 80, 146, 360
  objects. The write path was working.
- **`restoreSync.test.ts`** drives a real restore into a real `Y.Doc` and
  replays it into a second document *both* ways a collaborator can arrive:
  live incremental updates, and the encoded snapshot the server stores. Both
  agree, including a replace that reuses the ids it is overwriting — the case
  most likely to encode into something a peer resolves differently.

The lesson is not "check before fixing", which everybody already agrees with.
It is that **a correlation offered with a bug report is evidence about what the
reporter did, not about where the fault is.** They had been sharing restored
boards; the boards being restored was incidental.

## 4k. A permission that was enforced in some places

Tools and dragging were gated. The contextual rail was not, and neither was
the properties panel — so a viewer could set a fill, embolden a label and
italicise text. Those writes landed in their local document and were then
dropped by a server that had marked the connection read-only. **Their copy of
the board forked from everyone else's and, to them, looked like it had
worked.** A divergence that resembles success is a worse failure than a
refusal.

### The gate belongs on the write path

`mutations.ts` is invariant 1 — the only write path into the document — which
makes it the one place a permission can be enforced once and be true
everywhere: the rail, the panel, the keyboard, the palette, and whatever gets
added next year by somebody who never read the file. Same argument
`ToolManager.setActiveTool` makes for tools, same reason. Reactions stay open
to a commenter, being nearer a comment than an edit.

`writeGate.test.ts` pins it by mocking **only** `doc.ts`, so the real CRDT and
the real gate are under test rather than a mock of them.

### "Enforce focus mode for viewers" — asked, and declined

Focus mode is a *viewing preference the person can switch straight back off*,
and hiding a button has never stopped the shortcut behind it. A permission
undoable from the View menu is decoration — which is exactly the mistake these
roles started out making, when the client picked its own role and the server
believed it. Right instinct (a viewer should not see edit chrome), wrong
mechanism: hiding is presentation, and it follows the rule rather than being
it.

### Enforced and never announced

Nothing on screen said any of this was deliberate. Missing tools, objects that
will not move and a dead keyboard are each indistinguishable from a broken
application, and that is the conclusion a person reasonably reaches. **This is
invariant 6 backwards** — the usual failure is a capability declared and never
honoured; this is one honoured and never declared, which is just as confusing
and rather more alarming, because the interface is taking things away without
saying so.

Three layers, answering the question at three different moments:

1. **A chip in the header** — the standing answer. Amber, because a restricted
   role is a state and not a fault. Opens a panel saying what is and is not
   allowed, and why. **Nothing at all for an editor**: a permanent "Can edit"
   badge is standing chrome for the state everybody already assumes.
2. **At the moment of the attempt.** `ToolManager` refused in silence.
   Reaching for a tool *is* the question "why can't I draw?" being asked, and
   it was the moment the interface said least. Throttled, because refusal
   arrives in bursts and three thwarted clicks are one question.
3. **No "Request access" button.** There are no accounts, so it would send a
   request to nobody. The panel says the honest thing instead: access travels
   as links, and whoever sent this one can send another.

Guarding `notices.ts` against a missing `window` came with layer 2 — only the
expiry clock needs a DOM, and reaching for one unguarded made every module
that notifies untestable outside a browser.

## 4l. The activity feed, removed

It announced every edit in the bottom-left corner, and its most common line
was "made an edit" — which names neither what changed nor where. The case that
fired most often carried no information, and on a canvas that corner is
workspace rather than chrome.

The same question is already answered better twice: presence answers "who is
doing something, and where" spatially, with cursors, selection outlines and
the avatar row; Time Travel answers "what changed" properly for the far rarer
moment somebody needs it. A feed sits between the two and beats neither. The
shared authoring log it read is still written and still feeds replay.

## 4m. Mentions showed an id, and never notified anybody

Two bugs behind one report ("typing @ and picking a name shows a random
number"), and the second was the expensive one.

### What you were looking at

`MentionInput` put the **stored** form straight into its `<textarea>`, so
accepting a suggestion replaced what you had typed with
`@[Dana Ito](1873456102)` and left it there while you finished the sentence.
Editing an existing message handed the same markup back into the box.

The reasoning on the original was that rendering the pretty form needs a
contenteditable rich-text layer, which is a far larger and buggier surface
than the feature justifies. That is true, and it skipped the third option:
**keep the textarea plain, show the display form in it, and carry the ids in a
map beside the text rather than inline in it.** `toDisplayForm` /
`toStoredForm` own the conversion, `value` and `onChange` are still the stored
form, and nothing outside the component moved.

Two details in the encode worth keeping: names are re-encoded **longest
first**, or "Dana" claims the opening of "Dana Ito" and strands the rest; and
an `@name` nobody picked from the list stays plain text, because nobody was
chosen and `dana@example.com` is not a mention.

### The one that actually mattered

The candidate list keyed live collaborators by `clientId.toString()` and past
authors by `authorId` — **two different id spaces in one map.** `clientId` is
a fresh random number per session. So mentioning somebody who was *online*
stored their session number, and `mentionsMe` compares against the durable
author id: **"mentioned you" never appeared for anyone mentioned while they
were in the room**, which is the overwhelmingly common case. The same person
also appeared twice in the picker whenever they had both written a comment and
were still connected.

Awareness was carrying the durable id all along (`Room.tsx` publishes
`{id, name, color}` and the comment there says exactly why). `readCollaborators`
dropped it, so callers reached for `clientId` because it was the only id on
offer. `Collaborator.id` exists now, falling back to `clientId` for a peer
whose awareness predates it.

**The shape to remember:** when a type exposes one identifier and the domain
has two, every caller silently gets the wrong one, and nothing type-checks its
way out because both are strings. Invariant 7 again — but the two derivations
were of an *identity*, which is harder to spot than two derivations of a
number.

## 4n. A sketched shape was clickable only round its edge

Reported as "I select a shape and it deselects and does not move, and cut,
paste and lock do nothing" — which reads like a permissions fault and is not
one. The user found the discriminator: it happened on **sketched shapes with a
hachure or cross-hatch fill**.

Konva takes a shape's hit area from what it *fills*. The crisp branch draws a
filled primitive, so its interior is a target for free. The sketch branch
draws every layer by hand and marks all of them `listening={false}` — the
silhouette fill, the hachure strokes, the caps — leaving the outline path and
its `hitStrokeWidth` band as the only live region. So a sketched shape was
live near its edge and dead through the middle.

Hachure and cross-hatch are the worst case because they paint the inside as
*strokes*: nothing is filled anywhere, so a shape that plainly looks solid has
no interior at all as far as the hit graph is concerned.

**Why it presented as three unrelated bugs.** A click that misses lands on the
stage, and a click on the stage clears the selection. So the object did not
read as *missed*, it read as *refusing to be selected* — and with nothing
selected, cut, paste and lock have nothing to act on and appear broken too.
One missed hit test looked like a permissions regression across four features.

The fix is a silhouette path with `fill="transparent"`: Konva paints the scene
with the declared fill (nothing) and the hit canvas with the shape's own colour
key, so the interior becomes a target without becoming a mark. Gated on
`hasFill`, because a hollow sketched shape should stay edge-only — that is what
a hollow crisp one does.

`sketchHitArea.test.ts` reads the source rather than rendering, in the manner
of `shapeLabelFont.test.ts` beside it and for the same reason: proving a hit
region needs a real canvas and real pointer events, and a synthetic click
passes against a control that is broken for every hand — which this session
already learned once, on the mermaid zoom buttons.

**The diagnostic worth keeping:** when several unrelated features stop working
at once, look for one shared precondition before believing in one shared
cause. Here it was "something is selected", and everything downstream of it
failed together.

### 4n-i. …and it did not work, for exactly one commit

The user reported the same bug again, in the same words, against the commit
above. It was reported correctly.

`roughShape` returned `silhouette: ''` unless the fill style was `solid`:

```ts
silhouette: wantsFill && style === 'solid' ? roughSilhouette(...) : '',
```

So the element added by that commit — `{!open && hasFill && sketch.silhouette
&& <Path fill="transparent" …/>}` — could not render for a hachured or
cross-hatched shape, which is the only kind the bug was ever about. The fix
was inert for its own bug report and correct for the case that already worked.

**The test is the part worth reading.** Four assertions, all passing, all
vacuous. They read the source and proved the JSX was there, and it was. The
repo's own instruction is to check a test is not vacuous by reverting the fix
and watching it fail — and reverting the *markup* did fail them, so the check
looked sound. What no source-reading test can see is that the value the markup
consumes is empty: it never called anything.

`sketchHitArea.test.ts` now has two halves. The structural half is unchanged.
The new half calls `roughShape` and asserts a non-empty closed silhouette for
**every** entry in `FILL_STYLES` — which fails on four of five without the fix,
and is the assertion that was missing.

**The underlying cause was a conflated question**, and that is the transferable
part. Three places asked `fillPaint.type === 'solid'` — a question about the
*paint*, colour or gradient — while meaning "does this style fill its
interior", a question about the *style*. They agreed only because the
silhouette happened to be empty for the pen-shaded styles, so the wrong
question and the right one returned the same answer. The moment the silhouette
had to exist for another reason — a hit region — they came apart. `fillsInterior`
in `rough.ts` is now the one place that question is asked, and the fourth copy
of it (`penShaded` in `EffectsSection`) reads it too.

## 4o. The shading styles, and a control that faded out as shapes grew

Asked for directly after the above. All four pen-shading styles had real
defects and three of them were the same defect.

**Scribble leaked outside any concave shape.** `zigzagPass` is the one style
drawn as a single continuous stroke, and it carried one `prevPoint` across
every span of every scanline. On a convex shape there is one span per row and
that is right. On a star, a C, a ring or anything notched, a row has two spans
with a gap between them — and joining the end of one to the start of the next
draws the pen straight across that gap, outside the shape. A star shaded this
way had its points webbed together. `forward` was one flag toggled per *span*
too, so a two-span row ran its halves in opposite directions and the next row
reversed both, which is where the crossing diagonals came from.

The pen is now tracked as one or more chains: a span continues the chain from
the row above whose span it *overlaps*, and starts a new one when there is
none. Where a shape splits, one side continues and the other begins, because
the pen cannot be in two places. `scribble.test.ts` samples along every stroke
and asserts nothing crosses the notch — 113 samples did, before.

**Stipple's density control faded out as the shape got bigger.** `step` was
`Math.max(gap * nib, Math.min(40, diag / 16))`, and a floor derived from the
shape grows with the shape while the gap does not:

```text
             light   medium   dense
  200x140    23.10    15.26   15.26     ← two settings identical
  300x200    23.10    22.53   22.53     ← all three within 3%
  600x400    40.00    40.00   40.00     ← the control does nothing
```

The docstring above it already recorded this field being fixed once, for
discarding `gap` outright. The second attempt put `gap` back underneath
something that dominated it. What the cap is actually protecting is the
*number of dots* — this is one path parsed every frame — so it says that now,
and engages only when the count would really be a problem.

**Note how it passed.** `shading.test.ts` asserts `dense !== light`, on a
100-unit square, which is one of the few sizes where it worked.
`shadingDensity.test.ts` runs the same question over four shape sizes, and that
is the only difference between it and the test that passed throughout.

**Hachure had a constant displacement beside a variable spacing** — the fourth
time this file has had to separate density from amplitude, and the tell is
always that shape. The wobble off the scanline was one unit and the pull-in at
each end was two, while the gap ranges 5.5 → 14. At `dense` a pair of
neighbours leaning together closed to 2.4 units, under the four the density
docstring itself names as where strokes merge into a flat tone; at `light` the
same unit was 7% of the spacing and read as nothing, which is why the loosest
setting looked ruled. Both are fractions of the gap now.

That exposed the same thing one level down: `edge()` displaces stroke ends by
an absolute `offset` (1.0/1.6/2.4 by level), which is right for an *outline* —
long, nothing beside it — and wrong for strokes packed 5.5 apart.
`shadingProfile` caps it as a fraction of the spacing and only caps it, so a
light density is untouched. A hand does the same thing without thinking: it
makes neater strokes shading a small area closely than drawing the outline
round it.

The end offsets also stopped being `Math.abs(...)`. Forcing every stroke short
did not avoid ending on a ruled edge, it moved the ruled edge inward; the mean
is still inward and the variation is symmetric about it.

## 4p. Per-tool walkthroughs — §5a-ii item 2, started

The piece the brief asked for and the file has listed as "not started" since it
was written. The engine and the first five sequences are in; see §5a-ii for
what is left.

**It holds no words of its own.** A walkthrough is a reference *into* a lesson:
the lesson id, and per step an index into that lesson's own `steps`. The copy
comes from `lessons.ts` at read time, because that file opens by arguing a
second body of teaching text about the same gestures will drift — and teaching
text especially, since nobody updates the tutorial when they change the
gesture. `walkthrough.test.ts` fails if an index points past the end of the
lesson it names, which is the failure mode this shape has and the compiler
cannot see.

**It advances only on evidence.** No Next button, and its absence is the
design: a Next button lets somebody finish a walkthrough having performed none
of it, which makes the completion mark a lie. Each step carries an
`Observation` — `created`, `vertices`, `connected`, `framed`, `selected` — and
these are **data, not predicates**, so the set of things the product claims to
be able to notice can be enumerated and tested. Nothing asks a tool to report
anything; `LessonCoach` rejected per-tool success reporting as "sixteen call
sites to keep in step" and was right. Every observation is a question about the
document, answered against a digest taken when the step began.

Two things about that digest, both tested, both silent if wrong: it is taken at
**start** so a board that already has connectors on it cannot complete step one
before it is read, and it is **re-taken on each step** so the note made for step
one of the sticky chain cannot also satisfy step two — which would flash the
whole walkthrough past and mark it done.

The ring is placed through `walkAnchor.ts`, pure and tested, because that is
the invariant-10 arithmetic that was wrong in `ObjectContextToolbar` for the
whole life of that component. It takes the stage origin as an argument rather
than reaching for it, and one of its tests asserts that omitting the origin is
wrong by exactly a ruler.

Launched from the reference library ("Walk me through it"), never raised
unasked — a walkthrough is a thing you choose to start, and raising one
uninvited is the wizard this product has twice decided against. The coach mark
stands down while one runs, in CSS, since two cards teaching one tool at once
is the surface existing twice.

## 4q. The cursor, reworked end to end

Asked for as "4/10 to 9.5/10". Four things were structurally wrong and one of
them had never worked at all.

### 4q-1. The double cursor was permanent, not a race

Six components took the pointer by writing `stage.container().style.cursor`.
`LocalCursor` stood down when it saw an inline cursor — and looked for it on
`.canvas-container`.

**Those are different elements.** react-konva creates its own `<div>` and hands
*that* to `new Konva.Stage({ container })`, so `stage.container()` is a child of
`.canvas-container`. Every part of the stand-down was therefore aimed at a node
nothing writes to: `checkInline()` read an always-empty string on every pointer
event, and the `MutationObserver` watched attributes without `subtree`, so it
never fired once. `data-custom-cursor` stayed on, `cursor: none` stayed in force,
and the inner div's inline cursor overrode it for its own subtree.

So both pointers showed over every resize handle, every path anchor, every crop
edge — permanently, since the first commit that introduced the watcher. No
amount of tuning the observer would have found it.

`cursorOverride.ts` replaces the string-through-the-DOM channel with explicit
claims. `LocalCursor` learns synchronously, in the same tick as the handle's own
`mouseenter`. It is falsifiable from outside per invariant 12 — `releaseAll` on
a press ending and on the pointer leaving the canvas — because Konva does not
fire `mouseleave` for a node destroyed under the pointer and every one of these
handles is conditionally rendered.

**A second, opposite fault fell out of fixing it.** `cursor: none` was on the
container, where `cursor` inherits, so it also suppressed the pointer over the
rulers, the rail, comment pins and every DOM overlay inside the canvas area.
That was survivable only because the drawn pointer was *also* wrongly drawn over
those, and the two faults cancelled. It is scoped to the Konva canvases now.

### 4q-2. The lag was React in the pointer path

`inside`, `isPressed`, `isAltHeld` and `hasInlineCursor` were `useState`, so a
press was a render that called `art.render()` and rebuilt the whole SVG tree
mid-click. The effect listed `isAltHeld` in its dependencies, so **every Alt tap
tore down and re-registered eleven listeners**, including the one carrying the
position. And `place()` — the raw pointer handler — called `setIsAltHeld`
itself, scheduling a render on the frame it was meant to be moving the pointer.

Nothing about the pointer goes through React after mount now. The art is a
string written once per tool or theme change; press, Alt and visibility are
attribute toggles; position is written inside the pointer event. This is the
presence layer's own rule — positions go straight to the DOM, never through
React state — applied where latency is most visible.

### 4q-3. The per-tool glyphs were dead on the surface you look at most

Twelve tool glyphs existed and **the local pointer showed none of them**: its
badge was built by a helper called with `undefined` for the tool, so it always
fell through to the *mode* glyph. A rectangle, an ellipse, a star and a hexagon
were one generic pencil — while a collaborator watching you use them saw the
right shape, because the remote path passed the tool through.

The README states the rule both were meant to share: "your own pointer wears a
small glyph for the tool in your hand; a collaborator's pointer wears the same
glyph in their colour, so nothing has to be learned twice." It was true of one
of them. There is one table now and both surfaces read it.

Five tools were also missing from the mode table — `shape-line`, `shape-arrow`,
`connector`, `frame`, `grid` — so five draw-by-drag tools showed the select
arrow. `cursorVisual.test.ts` now fails if any tool in `TOOL_SHORTCUTS` falls
through to the default.

### 4q-4. Theme awareness, and what it should and should not mean

The old note argued a cursor cannot be themed because it sits over *content*,
not background. Half right: the **pair** is what gives legibility over
arbitrary content, and the pair is kept. But which of the two is the *body* is a
free choice, and the theme is the best available prediction of the backdrop — a
white arrow on a dark board is the brightest thing on screen and glares. The
roles swap by theme; contrast is unchanged either way, and a test pins it above
15:1 in both.

The badge disc takes the edge colour rather than the accent, deliberately.
`DESIGN.md` calls this product "a quiet neutral instrument, one warm brand
voice", and a brand-coloured disc riding every pointer at all times spends that
voice on the one element that is always on screen and says nothing while it is.
The accent marks *state* instead: the aim point, and the Alt-duplicate badge.

### 4q-5. Smaller things that were wrong

- **The eraser wore a crosshair** — a shape that says "aim at a point" for the
  one tool whose whole point is that it has a width. The drawn cursor was
  *worse* than the CSS bitmap fallback it replaced, which has always been a real
  eraser. It has its own art now, hotspot at the nib.
- **`grab` was unreachable art.** The pan gesture lives in a `ref`, which cannot
  drive a render, so `cursorModeForTool`'s `panning` input had no caller and the
  hand never closed. Both hands are in the markup and `[data-pressed]` chooses —
  no render, which is the only way a press response can be on time.
- **The Alt badge promised a gesture some tools do not have.** Gated on the tool
  actually duplicating on Alt.

### 4q-6. …and then it still lagged, because the element was the problem

Reported again after all of the above: "feels laggy and not fast enough, also
it lags behind". Correct, and no amount of tuning the drawing could have fixed
it.

**A DOM element is composited with the page.** The position is written inside
the pointer event, the browser composites on the next frame, and the frame
reaches the screen a refresh later. The OS cursor skips all of it — the
compositor draws it on its own path, ahead of page paint, and updates it
between frames on most platforms. One frame behind is the *floor* for a drawn
pointer, by construction.

`toolCursor.ts` opens by saying exactly this — "always one frame behind the
real pointer" — about the implementation *it* replaced. A drawn pointer was
reintroduced anyway, and I then optimised it rather than questioning whether it
should exist. That is the second time this lesson has been paid for, and the
note is left where it is because being able to point at it is worth more than
having been right.

So the art stayed and the element went. `cursorVisual` still produces every
pointer — the five-fingered hand, the per-tool badges, the theme-aware palette,
the eraser with its hotspot at the nib — and `cursorCss` turns each into a
`url()` data-URI cursor the compositor draws at zero latency. `LocalCursor`
renders `null` and writes four custom properties a handful of times a session.

What that removed, rather than fixed:

- **No `cursor: none` anywhere.** The failure this area kept producing — the
  suppression outliving the thing meant to replace it, leaving a window with no
  pointer — is now impossible rather than handled.
- **No second pointer**, so nothing can double up.
- **No per-event work at all.** `cursorContextFor` was deleted with the element:
  CSS already resolves what is under the pointer, for free and correctly, and
  doing it in JavaScript is what put a target test in the pointer path.
- **It works over the whole app and any page it renders**, because `html` now
  carries the arrow and `input, textarea, [contenteditable]` carry the I-beam.

The one thing given up is the press *dip*, because a CSS cursor cannot animate.
It was a 90ms scale on the element nobody looks at directly and it was costing a
frame on every move. Everything with meaning is a **swap** rather than an
animation and survives: the hand closes on `:active`, the badge follows the
tool, Alt shows the duplicate badge.

Every rule names a fallback keyword inside its `var()`. A `cursor` the browser
cannot use is *dropped*, so without one the worst case would be an arrow over a
drawing tool rather than a plain crosshair.

## 4r. Escape returns to the select tool

Asked for against the pen. It covered the force tools and audio only; it is now
any tool.

The layering is free and is the one Figma and Illustrator have: the modes that
already own Escape — crop, path editor, slot reframe — listen in the **capture**
phase and call `stopPropagation`, so this bubble-phase handler never runs while
one is up. First Escape cancels what is in progress, the next hands you the
arrow. Registering this in capture too, or reaching for an "is anything in
progress" flag, would have broken that and been a second derivation of something
the event model already answers.

## 4s. The selection box: four corners, no stalk

Asked as a question — "what do you think or do you push back?" — and I agreed,
with one caveat that turned out to be the whole job.

Konva's `Transformer` draws a ninth control on a stalk above the top edge. It is
a library default rather than a design: not part of the object's geometry,
colliding with whatever sits above the selection, and larger than the object
itself on anything small. Figma and Illustrator both show corner handles only
and put rotation in the ring just outside each corner.

**The caveat: a stalk with a knob on it advertises itself and an invisible hot
zone does not.** What makes it work in those apps is that the pointer becomes a
curved arrow the instant you enter the zone — the cursor *is* the affordance —
so removing the handle without one would have been a regression dressed as
polish. `rotateVisual` angles that arrow to the corner's own diagonal plus the
object's rotation, so it lies tangential to the arc the corner will travel; a
fixed-angle curved arrow is right at one corner and visibly wrong at three.

Two things kept the risk down:

- **The gesture is ours; the commit is not.** Everything downstream of a
  transform — live preview, per-node placement, undo, text reflow — reads
  `proxy.rotation()` and is driven by three handlers that take no arguments. So
  `RotateZones` turns the proxy and calls them. Nothing about how a rotation is
  *applied* is reimplemented.
- **The angle is computed entirely in world space**, from
  `screenToWorld`. An angle between two world points is the same angle at any
  zoom or pan, so the gesture never touches stage or window space and cannot
  pick up the ruler-inset error that made the rail wrong for the life of that
  component. The only screen-space quantity is the zone's size, divided by the
  zoom per invariant 9.

`rotateHandle.ts` holds the arithmetic and is tested, including the rule worth
knowing: **Shift snaps the result, not the delta.** Rounding the delta makes the
snap relative to wherever the object already was, so a box at 7° snaps to 7°,
22°, 37° — a grid of its own that lines up with nothing.

### What is not done

Unwatched, like everything else this session — and for the cursor and the
selection box that matters more than usual, because the whole subject is how
something *feels* and where something *is*. The structural claims are tested;
"not laggy" now follows from the compositor drawing it rather than from
measurement, which is a stronger argument than the last one but still not a
look. See §5a.

## 4t. The claim was writing to the wrong element — again

Reported as "the cursor doesn't change at the object vertex when I want to
rotate, so I don't know when and where it's okay to rotate". The rotate zones
were fine. **Every claim-based cursor in the app was dead**, and it was my
regression, of exactly the shape §4q-1 is about.

The claim wrote an inline `cursor` on `.canvas-container`. When the pointer
became a CSS cursor I moved the board's decision onto the Konva `<canvas>` — a
*child*. An inline style on a parent only reaches a child with no cursor of its
own, and that child now has an explicit rule, so the claim lost every time. The
resize anchors, path anchors, line vertices, connector ends, corner radius,
crop, reframe and the rotate zones all went silent together. It surfaced on
rotation because that is the one with no other affordance to fall back on —
which is precisely the caveat I had raised when agreeing to remove the visible
handle, arriving as a bug instead of as a warning.

The fix is a custom property: they **inherit**, so `--cursor-claim` reaches the
canvas wherever the rule that reads it lives, and every board rule resolves it
first. The cascade arbitrates instead of a specificity coincidence.

Two other things were wrong with the zones and are fixed: they rendered *after*
the transformer, so they sat on top of the resize anchors and took their hover
(now underneath, so the anchor wins where they overlap and the ring outside it
rotates); and they read the proxy on a **120ms timer**, which is a `setState`
on a schedule for as long as anything is selected. They read on the parent's
own refit signal now — the same value the proxy's fit effect is keyed on — plus
the camera event. No timer.

## 4u. The rest of the pointer vocabulary

Added, each because the gesture it names actually exists:

- **Scale arrows, drawn and continuously angled.** The OS has eight resize
  cursors, 45° apart, so `cursorForAnchor` has to snap — on an object turned
  20° every handle's arrow was up to 22.5° off the drag it described.
  `anchorAngle` gives the exact angle and `resizeVisual` draws it; the snapped
  keyword is still the `url()` fallback.
- **Pen add / remove / convert.** Three gestures that happen in the *same
  place* — over a path — and are told apart only by what is under the pointer:
  a segment adds (`insertAnchor`), an anchor removes, a handle converts
  (`setAnchorsMode`). Without the sign the pointer says "you are near a path"
  three times and you find out which by clicking.
- **The type pointer is an I-beam in a dotted box**, not an arrow with a badge.
  Text is the one tool whose click lands *between two characters*, and an arrow
  occludes the gap it is aimed into with its own body. The box is what
  separates "a drag makes a text box" from the ordinary I-beam's "there is text
  here to select".
- **Caps Lock gives a precision crosshair.** Photoshop's convention, and it
  earns its place for a reason the others cannot meet: every cursor here is a
  *shape*, and a shape covers what you are aiming at. Read with
  `getModifierState`, never by tracking presses — Caps Lock is a lock, so the
  keydown that turns it on and the one that turns it off are the same event.
  Only for modes that place something at a point.
- **`not-allowed` on hover where a drag will be refused**, and only there.
  A viewer (§4k: a divergence that resembles success is worse than a refusal —
  this is the refusal arriving *before* the gesture) and a pinned note. Not
  `move` on every object: everything can be moved, so announcing it is the
  least surprising fact available, and "do not label what the screen already
  says" is the product's first principle.

**Four were declined, all for invariant 6** — never declare a capability the
renderer ignores:

| Asked for | Why not |
| --- | --- |
| Eyedropper cursor | Uses the browser's native `EyeDropper`, which owns the screen while open and brings its own magnifier and cursor. `eyedropper.ts` already records this. |
| Shear cursor | `BaseNode` has `rotation` and `scaleX`/`scaleY` and no skew. There is no shear to point at. |
| Type-on-a-path | Zero matches in the codebase. Text-to-path is the opposite feature. |
| Touch Type | No per-glyph editing exists. |

One bug the tests caught that looking would not have: the precision crosshair's
first draft reached 15 from a centre at 14. An SVG in a page can overflow its
viewBox and this file sets `overflow: visible` — but **a cursor image is
clipped to its declared size**, so the arms were cut off everywhere it is
actually used and correct everywhere it is not. `PRECISION_REACH` is now a
named constant with an assertion against the box.

## 4v. Bézier tangents: what was already there, and the three that were not

Asked for as Illustrator-tier tangent controls. Half of it existed and is worth
naming, because building it again would have been the second-implementation
mistake this codebase keeps documenting:

- **Angle-snapping already worked** — Shift constrains a handle drag through
  `constrainHandleToAngle` at 15°, with 45° and 90° falling out as multiples
  and the badge naming them "Diagonal" and "Cardinal".
- **Three handle modes already existed** — `HandleMode` is
  `corner | smooth | mirrored`, `handleMode` *derives* which one an anchor is
  from where its handles actually sit, and `moveHandle` honours all three:
  mirrored keeps both direction and length, smooth keeps direction only.
- **A drag HUD already existed**, showing the live angle and whether Alt has
  disconnected the pair.

### What was missing

**1. `mirrored` could not be asked for.** `setAnchorMode` took
`'corner' | 'smooth'`. So the third mode was declared by the type, derived by
the reader, honoured by the editor — and reachable only by *accident*, by
dragging until the two lengths happened to match within epsilon. Invariant 6
from the inside, and it hid because it fails by being unavailable rather than
by looking broken.

It now takes a `HandleMode`, and both rails offer Symmetric beside Corner and
Smooth. Two details: an anchor that already has a tangent keeps it and only its
**lengths** are equalised — re-deriving the direction from the neighbours would
turn "make this symmetric" into "reset this" — and the lengths are **averaged**
rather than taken from a side, because picking a side makes the result depend
on which handle happened to be longer, so the same gesture gives two different
curves depending on history nobody can see.

**2. No curvature reading.** `curvatureAt` returns the osculating circle — the
circle the curve locally *is*. A handle shows the tangent and says almost
nothing about how hard the curve bends; two handles of very different lengths
look similar on screen and produce curves that are nothing alike, and the
difference only surfaces once the path is stroked or laid beside another.
Drawn faint and dashed under the handles, for picked anchors only, with the
radius written when exactly one is picked.

Straight runs and undefined tangents return **null rather than `Infinity`** —
`Infinity` is arithmetically true, propagates into whatever tries to draw it,
and obliges every caller to remember a check.

**3. The test caught me, not the code.** The first curvature test asserted a
quarter circle built with the standard `4(√2−1)/3` constant measures radius
100. It measures 102.19, and the code is right: that constant matches a circle
to one part in 10⁴ *in position*, and its **endpoint curvature is 2.19% high**.
Worked through by hand, the tests were rebuilt on a curve whose radius is
exactly 4.5 by construction, and the 2.19% is now pinned as its own assertion
so a future "fix" that made it return 100 has to explain itself.

### One thing avoided

The curvature computation sits after this component's early returns, so a
`useMemo` there would be a **conditionally called hook** — the fault `a605dec`
already shipped from this exact file, emptying the canvas on double-click. It
is a plain function instead: the work is a few calculations over the picked
anchors, which is not worth a hook, let alone a hook in the wrong place.

## 4w. Rotation, wrong three times, and what each one was

Reported three times before it worked. Each report was correct and each cause
was different — worth writing out, because they are one mistake in three
costumes: **a gesture that lives across frames cannot be built out of values
that are replaced every frame.**

**1. The claim went to the wrong element** (§4t). Fixed by making it a custom
property, which inherits.

**2. The box was in the wrong space.** `RotateZones` read `proxy.x()` as a
top-left. `fitProxy` positions the proxy **by its centre** with an offset so
Konva turns it about its middle — so every zone landed half a box down and
right of its corner, off the shape entirely for anything bigger than a zone.
Nothing could be hovered, and the pure tests all passed because the arithmetic
was never wrong. The box is now a prop, computed in the parent from the store.

**3. It unmounted on the press that started it.** `onStart` sets the parent's
`transforming`, and `visible` was `!transforming` — so pressing a zone
unmounted it and the effect cleanup ended the gesture on the frame it began.
A gesture cannot be gated on a flag it sets itself. `busy` is checked before
that flag and set before `onStart` is called.

**3b. And the listeners re-registered every render.** `onMove`/`onEnd` are
plain functions in the parent's body, so the effect holding the `pointermove`
listener re-ran on every render — and its cleanup ends the gesture. Even
without (3) this alone would have killed every rotation. The effect now has no
dependencies and reads everything through a ref when it fires.

`rotateHandle.test.ts` pins (2) structurally, in the manner of
`sketchHitArea.test.ts`: the failure is in what a component *reads*, and no
assertion about the function it calls can reach it.

The band was also widened from 18 to 26px. The zones sit beneath the
transformer so the resize anchor wins where they overlap — the right
arbitration — but the anchor covers the first ~9px, so the usable rotate ring
was about nine pixels and had to be aimed for.

## 4x. Shear — and a decline that was simply wrong

I declined the shear cursor in §4u on the grounds that `BaseNode` has no skew.
**That was a misreading of the schema.** `skewX`/`skewY` are on `BaseNode`,
documented in degrees, handled by `normalize.ts`, rendered by `ObjectRenderer`
through the `tan()` that converts to Konva's coefficient, and exposed as two
steppers in the Transform panel. The check was one grep and I did not run it.

What shear actually lacked was a **gesture** — the panel is where you type an
exact number, not where you find the slant you want. It now has bars outside
the edge midpoints, mirroring rotation's zones on the corners: the corners
turn, the edges slant, and the ring outside the box is where transforms that
are not resizes live.

Three things worth keeping:

- **It is an angle, not a ratio.** `shearFor` uses `atan`, because the field
  stores degrees and the renderer takes their tangent — a proportional rule
  would make the same hand movement mean different slants on different box
  sizes and run away past 45°. Clamped to ±89, matching the steppers: at 90 the
  tangent is infinite and the object collapses to a line it cannot return from.
- **It writes through `updateNode`, not the transform commit.** That path is
  built around a box — a `from`, a `to` and a spin — and a slant is not
  expressible in it.
- **Offered for one node, withheld for many.** Shear is a field on a node;
  distributing one slant across several origins is a different operation, not
  the same one applied more times.

## 4y. The pencil drew in a colour nobody could change

`PenTool.currentColor` was `static currentColor = DEFAULT_INK` — `#1F2937` —
and **nothing anywhere assigned it**. There is no colour control for the
pencil, so that one constant was the colour of every freehand stroke this
product has ever drawn. On a dark board that is **1.5:1** against the surface:
not a faint line, an invisible one. The tool looked like it did nothing and the
stroke was there all along.

`BezierPenTool` one file over already asked `ThemeService` for its stroke, so
the pencil was the odd one out rather than the rule.

It takes the body-text pair now, not `getDefaultStrokeColor` — that one is blue
in light mode, which is right for a shape's edge and wrong for ink; a pencil
draws the same mark a sentence is made of. `penInkContrast.test.ts` asserts the
**ratio** rather than the wiring, because the wiring was never what was broken,
and it pins the old constant at under 2:1 so the number is checked rather than
described.

## 4z. The rotate cursor, rebuilt from its own geometry

The mark itself was the last thing still hand-authored, and it was hand-
authored badly: `M6.4 16.6 a8 8 0 1 1 3.2 4.4` with a two-stroke chevron near
it. Three faults, none visible in a path string and all obvious in a
construction:

1. **The arc was not centred on the hotspot.** An SVG `A` command places a
   circle from two endpoints and a radius, so its centre lands wherever the
   arithmetic puts it — and `rotateVisual` turns the whole mark about (14,14).
   So as the corner angle changed the arrow **orbited** the point being held
   instead of spinning in place. This is the one that mattered, and it is the
   reason the geometry is now built from an explicit centre and radius.
2. **The sweep was not what its own comment said.** `large-arc=1, sweep=1` on
   that chord is about 320°, which closes into a *refresh* glyph — a button,
   not a direction. The comment beside it claimed 200°. It is 235° now, with
   the gap treated as load-bearing.
3. **The head was at the wrong end and not tangential.** It sat near the arc's
   *start*, at whatever angle two hand-picked segments made. An arrowhead a few
   degrees off its tangent does not read as a mistake — it reads as a cheap
   asset, which is worse.

It is a single filled head, as Illustrator, Figma and Canva all show.
Photoshop's double-headed version says "either way", which is true, but two
heads on one small arc eat the gap that makes it read as an arrow at 28px, and
one head is already unambiguous — nothing else in this product is a circular
arrow. Filled rather than stroked for the same reason the main pointer is: at
this size a stroked chevron reads as two marks and a solid one reads as a
point.

**Four assertions now hold it**, and each names a way it was wrong: the arc's
endpoints are exactly one radius from the hotspot; the head is perpendicular
to the radius by construction; every point plus its halo fits inside the box;
and the sweep still leaves a gap. The extent one earned itself immediately —
the first pass reached 13.89 against a half-box of 14, so the 3.8px halo would
have been shaved off all the way round, everywhere the cursor is actually used
and nowhere it is previewed.

## 5a-0-b. Objects flew off the board when you selected them

Reported as "objects disappearing when I select them", and it was mine.

The rotate and shear zones sit **outside** the object — which is also exactly
where you click to deselect, or to select a neighbour. A plain click there
called `onStart` immediately, which snapshots the current selection's box; the
click then changed the selection, the proxy refitted to the *new* box, and
`pointerup` committed a transform from the old box to the new one. Everything
selected was scaled by the ratio between two unrelated rectangles and thrown
off screen.

The fix is the shape every other drag in this codebase already has: a gesture
is **armed** on press and **begins** on the first movement. A click that never
becomes a drag begins nothing, so there is nothing to commit and nothing to
reconcile against a selection that changed underneath it.

Worth noting what made it hard to see from the code: nothing here is *wrong* in
isolation. `onStart` snapshots correctly, the selection change is correct, and
the commit is correct. The fault is only in the ordering, and only when a press
lands on a zone belonging to a selection that is about to stop existing.

## 5a-0-c. New rectangles are square

`ShapeTool` created rects with `cornerRadius: 8`, so every square anyone drew
arrived rounded — a style decision baked into the *tool*, which is the one
place it cannot be undone by not choosing it. The drag preview drew radius 8
too and committed the same, so the preview was at least honest; both are 0 now.
Rounding is a control, and the default is the shape's own geometry.

## 5a-0-d. Every drawn cursor was falling back, silently

Reported as "I see an open hand when I want to rotate". `grab` is an open hand,
and `grab` is what the rotate cursor's `url()` falls back to.

`svgWrap` emitted `<svg width=… viewBox=…>` with **no `xmlns`**. Inline SVG in
an HTML document inherits the namespace from the parser, so the markup rendered
correctly in every test, every preview and every place it was embedded. A
`data:image/svg+xml` cursor is not embedded — it is decoded as a *standalone
XML document*, where a missing namespace is a parse failure and the image
simply does not exist. The browser then drops the whole `cursor` declaration
and uses the keyword after the comma.

So **every drawn pointer in the product had been showing its fallback**, the
whole time. Nothing errors and nothing warns, and the fallbacks were chosen to
be sensible — which is exactly what made it invisible. Proven in the browser
rather than argued: the same markup with the namespace decodes and without it
fails.

The lesson worth keeping: *rendering correctly when embedded proves nothing
about decoding standalone.* Anything that becomes a `data:` image needs
checking as an image.

## 5a-0-e. Rotation jumped back to square before turning

`handleTransformEnd` finished with `proxy.rotation(0)`, on the reasonable
assumption that `fitProxy` would re-fit it from the document. It does — but not
until after the write lands, and in that window the proxy claims an angle of
zero for an object that is plainly turned.

`RotateZones` was reading its starting angle off that proxy. So a rotation
begun in that window started from 0: the object snapped square, turned a
little, then jumped to the committed value. It starts from the **document**
now, which is the same number `fitProxy` fits the proxy *to*, one step earlier
and unable to be behind it. The `proxy.rotation(0)` reset is gone as well —
`fitProxy` always sets the angle explicitly, so it was redundant and cost a
frame of the selection box snapping square after every gesture.

## 5a-0-f. What the selection box is now

Four corner handles, four edge midpoints, no protruding rotate stalk. The edges
were briefly removed and that was a step too far — an edge changes one
dimension where a Shift-corner holds the *ratio*, and those are different
gestures. Rotation is the ring just outside each corner; the zones render
beneath the transformer so an anchor wins wherever the two overlap.

The rotate cursor is a **double-headed** bent arrow, per the reference: a
140° arc with a filled tangential head at each end pointing opposite ways, so
it says "turns either way" rather than "turns this way". Much past 180° the two
heads meet round the back and it becomes a circle with notches, which is what
the sweep assertion guards.

The size readout is persistent under a single selection rather than appearing
only during a gesture — the question "how big is this" is asked while looking
at something, not while dragging it. Withheld for a multi-selection, where the
combined box is not the size of anything the user picked.

## 5a-0-g. The rotation opened with a fixed jump, per corner

Reported precisely: "+15° at the bottom right and −15° at the bottom left".
Equal and opposite at mirrored corners is the signature of a **constant
offset**, not of noise, and it is what made this findable from the report
alone.

`cameraSystem.screenToWorld` takes a **stage-relative** coordinate — it
subtracts the camera offset, which lives inside the stage. The press handler
fed it `stage.getPointerPosition()`, which is stage-relative and right. The
move handler fed it `e.clientX/clientY`, which is **viewport-relative** and out
by wherever the stage starts: about 52px, the header and rulers above it.

So the angle at the press and the angle on the first move were measured from
points fifty pixels apart, and the gesture opened by applying that difference
in a single step. The same vertical offset subtends opposite angles on
opposite sides of the pivot, which is the ±15°.

Invariant 10 again, in code written to respect it — the module header even
says every angle here is world-space. It was; the *inputs* were not.

## 5a-0-h. The pointer takes the dark half in a light theme

`paletteFor(false)` gave the body to white and the outline to near-black. Every
native pointer on both platforms, and Figma's, is the other way round: a
near-black shape with a white outline. The outline is what carries it over dark
content either way, so legibility never depended on the order — but *weight*
does, and a white-bodied arrow is the brightest thing on screen whatever is
behind it.

The tell was that the rotate arc looked right while the arrow beside it did
not: the arc draws its stroke in `edge`, so it was already dark. Two marks in
one set reading at different weights means the roles are the wrong way round,
not that one of them is wrong.

## 5a-0-i. The rotation HUD

Four marks, drawn only while a rotation is running, and **no number** — the
angle already has a home in the selection's own badge, and a second degree
label four inches away is one fact in two places.

- The **pivot**, because "it turns about the centre, not the corner under your
  hand" is the most common wrong guess about this gesture.
- The **start ray**, dashed — the only record of where the gesture began once
  the object has moved.
- The **live ray**, solid, joining pivot to hand.
- The **wedge** between them, which turns "how far" from a number you read into
  a shape you see, and makes overshooting a snap obvious before you let go.

A sibling of the zones rather than a child, because the zone group carries the
object's rotation and this is measured in world terms — the ray you started on
does not turn with the thing you are turning. Sized in screen pixels over the
zoom, so it is the same weight at 10% and 500%, and it never listens: a readout
that can be clicked is a control.

## 5a-0-j. The amber border round the canvas

It was the **app-wide focus ring**. `#canvas-surface` carries `tabIndex={-1}`
and `role="application"` so it can be focused programmatically — for the
accessible label, and so keyboard routing has somewhere to land — and Chrome
focuses a `tabindex="-1"` element on press. So every gesture put the global
`:focus-visible` ring around the whole board.

In amber, specifically, because `--focus-ring-color` is `--text-accent` =
amber-700 — the colour this product uses for *history* and for states wanting
attention. A ring in it around the artwork says something is wrong at the exact
moment nothing is.

Suppressed rather than recoloured: a focus ring answers "which control will the
keyboard act on", and a surface that exists to *hold* focus rather than receive
input has no answer to give. Every real control keeps it; the rule names one
element and its canvases.

(The header fading at the same time is `railVeil` and is deliberate — the bar
stands back while you are manipulating something. Nothing is hidden or moved,
only contrast, so every control stays clickable.)

## 5a-0-k. The rail ignored a collapsed panel

`inset = sidebarsVisible ? SIDEBAR_WIDTH : EDGE_MARGIN` — 288px, hard-coded, and
`sidebarsVisible` only means "not in presentation mode". So a **collapsed**
panel still reserved its full expanded width and the rail refused to go near a
side that was by then empty board.

Measured now, per side, because they collapse independently — opening Layers
and closing Properties is an ordinary thing to do and used to move the rail on
neither. A collapsed panel measures narrow, a hidden one measures zero, one
dragged wider measures wider, and none of that needs a second signal.
`PresenceEdgeMarkers` already learned this and the README states it: the edge
to use is the edge of the *visible canvas*, measured from the DOM.

**Cached behind a `ResizeObserver`**, because `updatePosition` runs from a rAF
loop for as long as the rail is on screen — measuring inside it would be two
forced layouts every frame, which does not show up in a profile as one bad
function, only as a canvas that feels heavy while anything is selected.

## 5a-0-l. The number fields lost their arrows

A `−` and a `+` beside every number is two controls per field, and the
Properties panel holds a dozen fields — so the arrows were the single largest
source of visual noise in it, and each pair only restated what the field
already implies. Figma and Illustrator both show a bare number.

They were **removed rather than hidden**, because the keyboard already did the
job better and had done all along: `ArrowUp`/`ArrowDown` step by one and
`ArrowLeft`/`ArrowRight` now do the same for anyone who reaches for a
horizontal pair on a horizontal field, with `Shift` taking ten — which is what
lets the keys carry the whole job, since without it a hundred-unit change is a
hundred presses. The arrows were a *second* way to do it and the more
expensive one.

Two consequences worth naming, because they are the reason it looks different
rather than just emptier:

- **The number is left-aligned now.** Centring was right while a button sat on
  each side and the number was the middle of three things. With them gone the
  number *is* the field, and a column of left-aligned figures scans as a
  column.
- **The field's radius dropped to `--radius-sm`.** At 6px a 26px box reads as a
  pill; the arrows used to fill the ends and hide that. With a bare number the
  corner is the shape.

The discoverability the buttons were carrying moved to a `title` on the field —
a number input responding to the arrow keys is a convention rather than a
certainty, and worth one line rather than leaving it to be found.

The corner-radius grid's special case went with them: it existed only to hide
the arrows in a four-up layout, and there are no arrows anywhere now.

## 5a-0-m. The badge counts degrees while you turn

The readout under a selection shows `145 × 142` at rest and was supposed to
switch to `47°` for the length of a rotation. The branch was there and had
been all along; it simply never ran.

`handleTransform` asked `tr.getActiveAnchor()` which gesture was in progress.
Konva answers that only for a drag **Konva itself** started — and rotation
comes from `RotateZones`, which is ours, so the answer was `''` on every frame
of the one gesture that most needs an angle. The badge spent each turn
reporting width and height: the two numbers a rotation does not change.

`beginExternalGesture` already writes `'rotater'` into `activeAnchor` so the
rest of the component can tell what is happening. Reading *that* instead of
the live anchor is the whole fix, and `handleTransformEnd` already clears it,
so the badge returns to `W × H` the moment the turn ends with nothing extra to
unwind.

While there: the resting badge sat `26 / zoom` below the box and the live one
`22` world units. So the badge hopped a few pixels at the start of every
gesture and back at the end — a movement with no meaning, on the one element
whose job is to hold still while everything else moves. One `BADGE_DROP`
constant now, in screen pixels, divided by zoom at both sites.

## 5a-0-n. The number fields were five different widths

Reported as "some looks too small no padding, some look too long", and that is
exactly what it was. Measured across one 260px panel, the same control:

```text
  Weight             31px    ← 15px of room between its paddings
  Opacity          40.5px    ← wider only because it carries a "%"
  Radius (linked)    31px
  Radius corners   95.5px
  Transform X/Y      78px
```

Five widths and five different left edges. The 31px ones fit `2` and not
`100`, so the panel's most ordinary value was one it could not display.

**Cause.** `NumberStepper`'s outer wrapper was an unclassed `div` carrying its
layout inline, so it had no width rule of its own and took whatever its
container implied. In a `.prop-row__control` — flex, `justify-content:
flex-end` — it shrink-wrapped to the input's `min-width` floor and jammed
against the right margin. In a grid cell it stretched to `1fr`. Nobody chose
either number; they were both fallout.

**Fix.** The wrapper is `.field` now, with `flex: 1; min-width: 0`. Every
container in this panel already sizes its columns deliberately — `1fr 28px 1fr`
for a Transform pair, two-up for the corners, one control column for a plain
row — so a field agreeing with its column is the entire rule, and there is no
width left to maintain by hand. After:

```text
  Weight / Opacity   136px @ x=108   ← the control column exactly
  Radius (linked)    104px @ x=108   ← the column, less the link button
  Blur pair       64 + 8 + 64 = 136
  Radius corners    95.5px, two up
  Transform X/Y       78px, two up
  every one of them 28px tall
```

Four smaller things fell out of the same look:

- **`.prop-pair` was declared twice**, 7800 lines apart, as a two-column grid
  and as a flex row. The later one silently won, so the rule you would find by
  searching described a layout the panel had not used in a long time. The
  stale one is gone and the survivor takes `flex: 1`, which is what the two
  fields inside it needed in order to have anything to divide.
- **The focus ring was a size too big.** `.stepper:focus-within` set
  `--radius-md` while the field rests at `--radius-sm`, so a field changed
  shape when you clicked into it.
- **The `%` was pushing its own field wider.** Input and suffix each carried
  8px of right padding, so the unit drifted off to the right and Opacity
  measured 9.5px wider than Weight for no reason anyone chose. The 8px belongs
  on the outside of both; `100 %` is one reading.
- **The corner glyph kept the minus button's old clearance.** 20px of
  padding-left left the digits 11px clear of the glyph against an 8px inset on
  the other end, so the cell looked padded on one side only. At 16px the gap is
  8 and matches.

## 5a-0-o. The radar takes the panels' radius

`--panel-radius` (8px) exists because the Layers and Properties panels are
pinned columns rather than floating lozenges, and 12px reads as a rounded card
that happens to be very tall. The radar is the same kind of surface for the
same reason — anchored to the bottom-left corner, stacked directly under the
Layers panel and sharing its left edge — so 12px there beneath 8px above read
as two different kinds of surface on one rail.

The collapsed `.radar-toggle` keeps `--dock-radius`: it *is* a small lozenge,
which is what that token is for.

## 5a-0-p. The help modal's orientation line stopped wrapping

`.help-modal__orient` carried `max-width: 62ch`. That is the right cap for a
paragraph of prose and the wrong one for this: it is a single short sentence
carrying three `<kbd>` chips, sitting in a header up to 950px wide. Measured,
the sentence wants 461.6px on one line — so the cap was breaking a line that
had twice the room it needed.

No `white-space: nowrap` to replace it. Removing the measure lets it wrap only
if the window is genuinely too narrow to hold it, which is the wrap you want;
`nowrap` would push the close button off the end instead. Leading dropped from
1.9 to 1.7 with it — 1.9 was leading for a wrapped block, and on one line it
only padded the gap to the title.

## 5a-0-q. The four ways into a board became one control

Reported as the two rare actions being hidden in the profile menu, and asked as
a placement question. It was not a placement problem.

There are **four** ways to get a board on screen — blank, from a template, from
a backup file, from somebody's link — and they sat at three different levels of
prominence: the `+` at the top of the rail, Templates as a nav destination, and
the other two behind the avatar. The empty state has always offered three of
them together, in one list, in the order they are worth trying, which is the
app already saying they are one family.

Behind the avatar was the **wrong drawer**, not merely a quiet one. An avatar
means *things about me* — who I am, this session, signing out. A backup file is
about a **board**. Filing a board action under a heading that describes a
person is why no amount of use ever made it findable: there was nothing to
learn, because the label did not predict the contents. That is also why moving
them somewhere more visible would not have fixed it — four scattered entrances
is four things to remember, and muscle memory can only hold one.

**The `+` is a split control now.** A plain click still opens a blank board
with nothing in the way; a caret badge on its bottom-right corner opens **From
a backup file** and **Open a link**. Splitting rather than turning it into a
menu button is the whole point: a menu button would make the most common action
on the page cost two clicks in order to make the rare ones cost one, which is
the trade backwards. Right-clicking the `+` opens the same menu, because a 16px
badge is fine as a second way in and thin as the only one.

**The menu holds two items, not four**, and the first draft got this wrong in a
tidier costume. Templates is already a permanent destination on this rail, one
icon below — naming it again inside the menu re-scatters the thing the menu
exists to gather, and a menu carrying something you can reach without it
teaches people it is a grab-bag rather than a specific set. Blank board goes
for a sharper version of the same reason: the caret sits *on* the `+`, so the
menu reads as "and more ways", and naming the button's own action inside its
own menu tells somebody what they just clicked. What is left is what was
actually homeless — a file you have, and a link somebody sent.

The caret is a corner badge rather than a second button beside it because a
38px rail has no room for a second column, and stacking two controls would make
the front door read as two things of equal weight — exactly the flattening this
undoes.

**Two of the four need no menu at all**, and these are the parts that make it
feel native rather than filed away:

- **Drop a backup anywhere on the stage.** "I have a file and I want it open"
  is a gesture before it is a command. It routes through the same
  `handleRestoreFile` the picker uses, so the two cannot validate differently —
  the file is parsed and *refused here* before anything navigates, and a bad
  drop leaves you on this page with a message rather than in a new empty room.
  The cue counts `dragenter` against `dragleave`: `dragleave` fires when the
  pointer crosses into a *child*, so clearing on it flickers the overlay off
  and on over every card in the grid.
- **Paste a board link with nothing focused.** That is how people arrive from a
  link — it is already on the clipboard, and the old path was *find the
  control, click it, click the field, paste*. It stands down for any input,
  textarea or `contenteditable` (or it would eat the very field it opens), and
  only reacts to text containing `/room/` or shaped like a room code. It
  **fills** the field rather than navigating: a paste is not a decision, and
  the clipboard can hold something stale.

**And the empty state gained its fourth card.** Somebody restoring a backup is
*by definition* somebody with no boards — a new device, a cleared browser — so
that screen is the one they are standing on, and it was the one screen with
nothing for them to aim at. Three cards named the three ways in and left out
the one that brought them there.

Verified in the browser: the two menu items and their downward placement, the caret's
rotation, dismissal on an outside press, the avatar menu reduced to Sign out,
paste opening the field pre-filled and focused, prose ignored, a paste inside a
field left entirely alone, and the drop cue surviving a crossing into a child
but not a real leave.

## 5a-0-r. The removed-boards shelf had a hole in the middle of it

The reasoning behind the shelf was already right, and worth keeping: removing a
board here destroys *the only record of its address*, and with no accounts that
is losing the work while looking like the harmless of the two options. Undo
lives in two places because a toast is gone in ten seconds and the realisation
usually is not; `putBack` restores to the **old index**, so an undo looks like
nothing happened rather than reordering the list as a consequence of correcting
a mistake.

Three things were wrong underneath it.

**1. The cap discarded addresses silently.** `REMOVED_LIMIT = 24`, and
`writeRemoved` did `next.slice(0, 24)`. Removing a twenty-fifth board
permanently dropped the oldest removal — no notice, no confirmation, no way
back. The safety net had a hole in precisely the failure mode it existed to
cover. And ordered by removal recency, the entry that fell off was the one
removed *longest ago*: the one least likely to still be reachable from a link
in somebody's chat history. Measured against this machine's real library, the
whole index — 7 boards and 8 removals — serialises to **1983 bytes**. The cap
was saving about two kilobytes of a five-megabyte budget.

The ceiling is 500 now, and if it is ever reached it says so rather than
trimming quietly.

**2. There was no way to delete.** The shelf only grew, and the only thing that
ever shortened it was the silent cap — so the route to a tidy shelf ran
straight through the data loss the shelf exists to prevent. A missing exit does
not stop people leaving; it makes them leave the worst way. **Forget
permanently** is per-row, and it is the one action on this page that asks
first. That asymmetry is the point: removing a board is recoverable, so it can
be a click on a card; this is where recovery stops.

**3. The shelf could only put a board back.** The other thing somebody wants
from it is the link — to hand to a colleague, or to paste somewhere that
outlives this browser — and getting it meant restoring the board to the grid
first, through a state you did not want. **Copy link** is on the row now.

**And the structural one: the list is exportable.** Every safeguard above
protects the list *in place* and assumes the `localStorage` entry still exists.
None survives clearing site data or moving to another machine, and neither of
those is an accident anybody gets to undo. `engine/room/libraryIndex.ts` makes
the index a file — both halves, since the removed shelf is arguably the more
valuable one.

Loading **merges, never replaces**. A file saved before three boards were
opened must not take those three addresses away, and doing that as a side
effect of an action taken to be *safer* would be the worst version of the loss
this page is built around. Verified against the real library: a stale file
holding 2 of 7 boards still leaves all 7.

One picker and one drop target handle both kinds of file. `looksLikeLibrary`
is checked first so a malformed board list reports a board-list problem rather
than being handed to the document reader and coming back as "that file does not
contain a document" — an error about the wrong thing, which is worse than none.

**Where it went, and why that was not my first guess.** The module started in
`engine/export/` because it serialises JSON, and `exportChunking.test.ts`
refused it on the spot: that directory is a lazily-loaded chunk behind the
export dialog, and `Home.tsx` is the landing page, so the import would have
pulled the export pipeline into the first paint of a screen that never exports.
The guard was right about more than the bundle — a library index is a list of
**room addresses**, which is what `engine/room/` already holds.

16 tests on the module; verified live against this machine's real 15 addresses.

## 5a-0-s. Forty typefaces, and every weight of them real

Asked as "add more fonts". The catalogue was thirteen families held in
`FontSelector`, five of them fetched by a `<link>` in `index.html` — so every
visitor downloaded all five on every visit whether they opened the picker or
not. That arrangement makes "more fonts" a straight trade against load time,
and the wrong one: most people use two faces, and the fortieth on the list is
the one nobody is waiting for.

`engine/text/fontCatalogue.ts` is the manifest, and a face is fetched **the
first time it is needed** — a row scrolling into view, a font being applied, a
board arriving that uses it. Almost nothing else changed, because
`ensureFontLoaded` is where the loading hook went and every renderer already
calls it on every render.

Forty faces across nine categories, including a **condensed** group the
catalogue had nothing in at all — which for a diagramming tool, where text goes
inside boxes, is the single most useful thing that was missing.

Every Google `spec` was fetched and checked for a real `@font-face` before
shipping. This matters more than it sounds: a spec Google rejects 404s
silently, the family renders in its fallback, and it looks like a design
choice. Verified in the browser: **zero Google stylesheets at load**, and the
lazy path takes EB Garamond from two fallback buckets to five distinct real
widths.

### The weights were the bigger lie

`konvaFontStyle` collapsed nine weights to two:

```ts
if (typography.fontWeight >= 600) parts.push('bold');
```

Everything Thin to Medium drew at 400 and everything Semi Bold to Black at 700,
so **seven of nine weights did not exist on the canvas**. It was inconsistent
with itself, too: `domTextStyle` has always passed the real number through, so
text set in Light *changed weight the moment you double-clicked it* and changed
back when you clicked away — a visible symptom with nowhere to be reported,
because nothing in the panel could produce a Light in the first place.

Konva puts `fontStyle` into the CSS `font` shorthand, which takes style,
variant and weight in any order before the size, so a number is simply a legal
value of the slot "bold" already occupied. Measured after: **Inter renders nine
distinct widths for nine weights**, where it rendered two.

### Which weights a face has is read, not assumed

A weight a family does not have is **synthesised** — the browser thickens or
thins the outlines, it renders, it looks like type, and it is no longer the
typeface. So the weights come from each family's own stylesheet, fetched and
parsed rather than guessed. Consequences, all of them the same idea:

- The picker offers Bebas Neue **one** weight, not nine.
- **Bold** goes to 700 where it exists and the family's heaviest otherwise. It
  used to write a hard 700: on a face topping out at 600 that asked for a
  weight that does not exist, and on a single-weight display face it lit up and
  changed nothing.
- **Italic** says when it is a shear rather than a face. A family without a
  drawn italic gets one by slanting the upright, and a real italic's
  letterforms are *drawn* — different shapes for a, e and g.
- **Changing family snaps the weight** to the nearest the new face has. Inter
  Thin retyped in Libre Baskerville would otherwise keep `fontWeight: 100` and
  render synthesised.

`ensureFontLoaded` names the weight now, because a static family ships one file
per weight — asking for the family alone fetched its Regular in order to
measure text about to be drawn in Bold.

### A bug of my own, found by measuring rather than by reading

`ensureFamilyStylesheet` appended the `<link>` and `requestFont` ran on the
very next statement, before the stylesheet had been fetched or parsed. With no
`@font-face` rule yet, `document.fonts.load` matched nothing and resolved, and
`requestFont` correctly read an empty match as "the fallback is what is drawn,
nothing to redo" — so **the epoch never bumped**. The face still arrived, since
drawing it is itself a request; what never happened was the re-measure, so the
layout kept the widths of a font that was no longer on screen. That is the
exact failure the epoch exists to prevent, reintroduced underneath it.

And it could not recover: `requestFont` records a spec in `asked` *before*
acting on it, so the one wasted attempt blocked the real one permanently.
`ensureFamilyStylesheet` returns a promise now.

I would not have found this by reading the code — it looks right. It showed up
as a link in the head, an unchanged width, and a face that never applied.

## 5a-0-t. Character and Paragraph, rearranged

The two sections were already split on a sound rule — "what the letters are"
against "what the block does with them" — and the first cut came out on the
wrong side of it in one place, plus paid for its labels everywhere.

**Leading and tracking moved up into Typography.** Illustrator's Character
panel holds size, leading, kerning and tracking; its Paragraph panel holds
alignment, indents and space around. The section's own stated test agrees:
leading is the distance between two lines of *type* and changes when the size
changes, which is not true of anything else that was down there.

**The dense numeric rows lost their label column.** An 84px label in a 260px
panel is right where a control's job is not visible from its own shape — a
swatch, a segmented choice. It stops paying in the type block: "Size" beside a
field reading `16 px` is a label restating its own value, and eight such rows
is a third of the panel spent on words. `.prop-grid` is a label-less two-column
row, scoped to the rows that opt in so the rest of the panel keeps its column
and nothing looks imported from another app. The fields carry glyphs instead —
`UnfoldVertical` and `UnfoldHorizontal` for leading and tracking, which *are*
the distinction: one opens vertical space, the other horizontal.

The pairing is not only density. **Leading is read against tracking**, and size
against weight; two numbers you compare belong on one line.

**Both alignments share a row.** Horizontal and vertical are one question asked
twice — where in its box does this sit — and on separate labelled rows they
read as two unrelated settings. At `4fr 3fr` the seven buttons come out the
same width (measured: 31.5 and 31.3), so the two groups read as one control
with two axes.

**`verticalAlign` has a control at all for the first time.** It has been in the
schema since the beginning and every renderer forwards it; the only way a board
ever got anything but `top` was a shape whose renderer hard-codes `middle`. A
field that is stored, rendered and unreachable is a feature nobody knows was
built — and this one matters where the app is used most, since a label against
the top edge of a box it is centred in horizontally is the commonest thing to
want to fix.

Smaller things, in the same pass:

- **Leading shows what the multiplier comes to.** `1.2` is a ratio against
  something you have to remember; `1.2` beside `19px` is a distance.
  Illustrator shows points and Figma shows pixels; both answer this question.
- **"Paragraph" inside the Paragraph section** named the section rather than
  the setting. It is **Space after** now.
- **Every numeric field carries its unit.** Size, tracking and paragraph
  spacing were bare numbers in a panel where the next row down is a multiplier.
- **The weight control is a native `<select>`**, deliberately, where the font
  picker is a custom popover. Forty faces need search, grouping and a preview
  in their own face, which no native control can do; nine short words need
  keyboard behaviour, type-ahead and the platform's own overlay, which is
  exactly what a native control gives for free.

## 5a-0-u. The weight list, the case row, the alignment marks, and the effects

Four things, and the first is a correction to my own reasoning.

**The weight control is a popover now, not a `<select>`.** I argued for the
native control on the grounds that nine short words need keyboard behaviour and
the platform's overlay more than they need custom drawing. That was wrong about
what the list is *for*. "Semi Bold" is a name for something you are trying to
**see**, and the difference between 500 and 600 is genuinely hard to describe
and instant to look at — so each row is drawn at the weight it names, in the
family in hand, and the list becomes a specimen sheet. Only Firefox styles
`<option>` text, so the native control could show that to roughly nobody. It
borrows the font picker's own popover classes rather than inventing a second
look, since the two sit on adjacent lines and are the same gesture asked twice.
The trigger is a specimen too. A single-weight face disables it and drops the
chevron rather than dimming it: a disclosure that discloses nothing should not
be drawn.

**Case sits beside its label.** `stack` is for a control that cannot fit the
136px value column — six list styles, three resize modes with words in them.
Four case segments measure 109px against the Style toggles' 108px directly
above, and the two rows are the same kind of thing: a small group of marks
describing how the letters look. Stacking one and not the other made them read
as different orders of setting and cost a row of height for nothing.

**The vertical alignment marks are drawn rather than borrowed.** Lucide's
`AlignStartVertical` and its siblings show several objects distributed along an
axis — they are the marks for aligning *a selection of shapes to each other*,
which is a different operation this app also has. Using them here said the
wrong thing twice: it failed to depict vertical alignment, and it claimed a
meaning already spoken for. `VerticalAlignGlyph` is a box with two lines of
type sitting at the top, middle or bottom, which is what the setting is and
what both references draw. Two bars rather than one, because a single bar
centred in a box is a hamburger and a single bar at the top is a heading.

### The effects section

**The presets come first.** They sat below two rows of colour-cycle controls,
which put the section's fast path behind its most specialised setting. A preset
answers "give me a look"; the three groups below answer "now change one thing
about it". That is an order, and the section was in the other one. The colour
cycle moved to the end for the same reason — it led the section and is the
rarest thing in it.

**Everything shows itself.** Every control here was a name plus a switch, so
the only way to learn what a setting did was to turn it on, look at the board,
and turn it off — with the panel covering part of what you were looking at.

The three effects happen to be exactly the ones CSS draws natively:
`background` for the highlight plate, `-webkit-text-stroke` for the outline,
`text-shadow` for the glow. So `EffectSpecimen` is not an illustration of the
effect, it **is** the effect, from the same numbers the canvas uses — change a
colour and the specimen moves, with no second rendering to keep in step. The
preset chips render the look the chip would apply, so a row of words became a
row of answers.

The one judgement in it: the numbers are scaled to a third. A 20px glow around
a 13px specimen is a coloured square and an 8px stroke is a blob; a third keeps
the *ratio* recognisable, which is what a preview is for.

**Pipettes on all three effect colours.** An effect colour is chosen *against*
something — the board, the text, an image behind it — which is the exact case a
pipette exists for. It was offered on the one colour in this panel least likely
to be sampled from the screen and withheld from the three most likely.

**Corner and padding share a row.** They are the plate's two dimensions and are
read against each other: a large radius on tight padding is a lozenge, on loose
padding a rounded box. Same treatment leading and tracking got.

## 5a-0-x. A hand-drawn shape can be drawn again

The sketch is seeded from the node id, and that is load-bearing: regenerating
from fresh randomness makes an outline crawl on every re-render, which here is
every selection, drag and presence update. So the drawing is deterministic, and
it should be.

Deterministic is not the same as **chosen**, and that gap is the whole feature.
A hand-drawn effect sometimes lands badly on one particular shape — a wobble
that clips a corner, an overshoot that reads as a mistake rather than as a hand
— and the only remedy was to delete the object and draw it again, because the
id is the seed and a new id means a new object.

`Appearance.sketchSeed` is a variant number mixed into the seed. Stability is
untouched: for any given value the drawing is as fixed as it ever was. What
changes is that there is now more than one.

**Mixed with the id rather than replacing it**, and that is the detail worth
keeping. Replacing would make every shape redrawn `n` times draw *identically*,
so redrawing a selection of six rectangles would turn them into six copies of
one rectangle — the opposite of what a hand-drawn effect is for. Absent and
zero both mean the original, so nothing already on a board changes. Connectors
and paths seed through the same helper, so a redraw reaches them too.

Verified in the browser against the real generator: the original is unchanged,
each variant differs, each is stable across calls, and two shapes at the same
variant stay distinct.

## 5a-0-y. The sketch and stroke sections, rearranged

**The shading angle shows itself.** It is the one number in these sections you
cannot picture from the digits — 41° against 90° is a real difference in how a
hatched shape reads, and neither figure says which way the strokes run. The
glyph turns to match, which costs one `rotate` and means the field answers its
own question.

**Density and angle share a line**, being the two dimensions of one thing. They
are also more useful read together: a dense field at 41° and a light one at 90°
are the two decisions you make about a hatch, and you make them against each
other.

**Stroke weight and pattern share a line**, and there the pairing is structural
rather than aesthetic. The dash is *derived from the weight* — `dashFor` gives
three-on two-off at three times whatever the weight field says — so changing one
changes what the other draws. Reading them apart hid the only relationship in
the section.

**Cap and Join came out of their stacks.** Three segments divide the 136px
column at 45px each, well past a segment's natural 32, so stacking bought
nothing and cost a row of height each.

**Every segmented group in both sections fills its column**, so none of them can
wrap — the same fix the type sections got, for the same reason.

One thing deliberately *not* added: a free-form dash editor. `dashFor` derives
the pattern from the weight on purpose, so a hand-authored array would silently
stop scaling with the stroke and the panel's own hint ("the pattern scales with
the weight so it stays legible") would become false. `styleOf` already
recognises arbitrary arrays by shape, so the door is open — but it wants a
`dashScale` that survives `restyleForWidth`, not an array field, and that is a
piece of model design rather than a panel change.

## 5a-0-z. A dash you can shape, and it still scales

The note in 5a-0-y said a free-form dash editor wants a scale that survives
`restyleForWidth` rather than an array field. This is that, and it went one step
further than the note: **there is no scale field either.**

`dashFor` derives the pattern from the weight on purpose — a fixed `[6, 4]` is
a clear dashed line at 1px and a nearly solid one at 12px. So what is edited is
the **ratio** to the weight, and what is stored is still the plain `number[]`
that SVG and Canvas2D take. A 4:1 pattern authored at 2px is still 4:1 at 8px;
an absolute array would have become `[8, 2]` on a 12px stroke — a nearly solid
line, silently, on the one edit most likely to follow shaping a dash.

**The ratio is read back out of the array, not stored beside it.** A
`dashScale` field is two representations of one fact, and `DATA-MODEL.md` opens
with what that cost this project. The array is what the document holds; a ratio
is a *view* of it, and a view is safer computed than kept. `restyleForWidth`
reads it against the width the array was written for and re-derives at the new
one — exactly proportional, nothing remembered, and stable under repeated
restyling.

The panel shows **pixels**, because that is the length being set and what every
other field in the section is in. Change the weight and both numbers move with
it, which is the promise being visible rather than merely claimed.

## 5a-0-aa. Line detail is not hidden any more

Four rows behind a "Line detail" toggle is a reasonable instinct — most boards
never touch align, cap, join or the miter limit. It was the wrong call twice
over.

**Cap and Join are not obscure.** Rounding the dashes on a rectangle is one of
the commonest things anybody wants from this section, and it was two clicks and
a guessable label away.

**A disclosure whose contents are conditional can be empty.** On a shape with
no corners and no ends, opening it showed a greyed-out list — so the affordance
promised something it could not deliver. The controls that do not apply are
still disabled *with a reason*, and that is what makes them safe to show flat:
a greyed control that explains itself teaches the model, and a hidden one
teaches nothing.

## 5a-0-ab. The sliders got an instrument

Two things a track cannot do on its own, and both were sending people to other
controls.

**Shift gives a tenth of a step.** The whole range is the whole track, so on a
200-point brightness scale one pixel of movement is two points and there was no
way to ask for one. The native input already routes `step` through both the
drag and the arrow keys, so swapping it while Shift is held gives fine control
on both with no second code path. Watched on the window rather than the input,
because Shift is very often released elsewhere — a fine mode that sticks on is
worse than none, since the slider would silently stop reaching its own extremes.

**The readout is typable.** The one thing a track cannot express is *exactly
24*. It looks like the readout it replaced at rest and becomes a field on
approach.

**Ticks needed the track to become ours.** A native range paints its track as a
shadow part — under the thumb, over everything else in the element — so a mark
cannot be layered between the two, because there is nothing to layer into.
Painting the track in the document and leaving only the thumb native puts the
ordering back in our hands and keeps every behaviour the input provides.

They are **reference marks, not magnets**, and that was a real decision: these
are continuous quantities, and a slider you cannot set to 51 because 50 keeps
grabbing it is worse than one with no marks. Double-click already returns to
the origin exactly, which is the case a magnet is usually trying to serve.

The origin is always marked. On a bipolar control it is the value the fill is
measured from and the value a double-click returns to, and it was the one
position on the track you could not see.

## 5a-0-ac. Which controls are tracks, and which are not

**Opacity, shadow blur, shadow spread and shadow opacity became sliders. The
shadow offsets did not.**

The distinction is *what you know when you arrive*. An offset is a **position**
— "eight down and four across" is a thing you can mean exactly, and a number
field is right for it. Softness and strength are the other kind: nobody wants
37% opacity, they want "a little lighter", and finding that by pressing an
arrow while looking at the canvas is the worst version of the control. Every
design tool makes opacity a track for that reason, and this one had it as a
stepper.

Nothing is lost by the change, which is what made it safe: the readout is
typable, so 63% is still one click and three keystrokes away.

`RailBase`'s popover control and the export dialog's quality both came onto the
shared primitive. Quality shows a percentage and stores the fraction the
encoder takes, which is what `format` is for — the alternative is a second
control that converts, and that is how two numbers drift.

## 5a-0-ad. Transform, tidied

Three inline grids declared the same `1fr 28px 1fr`, which is three places to
change one column and three chances to change two of them. One class now, and
the empty span above the aspect lock is what keeps X and Y on the same rail as
W and H.

Rotation sat alone in a two-column grid with an **empty second half** — a row
deliberately half-blank, which reads as a control that failed to render rather
than as a layout. It shares a line with the two skews now: all three are angles
about the centre. The skew fields are labelled `SX`/`SY` rather than `X`/`Y`,
since `X` beside `R` is the position field's letter on a row about angles.

Every position and size field carries `px`, which they did not — in a panel
where the next row down may be a multiplier or a degree.

**Not verified visually.** The Chrome extension lost its connection partway
through, so the reworked Transform, Shadow and Adjust rows are confirmed by
build, lint and the suite, and by the `.prop-grid` measurements taken earlier
in the session — but nobody has looked at them.

## 5a-0-ae. The selection chrome stands down while an object moves

Dragging a shape dragged a blue box, eight handles, four rotate zones and a
size badge with it — chrome that is *about* a resting selection, describing an
object that is not resting. It is the busiest the canvas ever looks at the
moment there is most to look at, and none of it can be acted on: the pointer is
already committed to the drag.

**A move is not every gesture, and that is the whole implementation.** A resize
must keep its handles — one of them is what the pointer is holding, so hiding
it mid-drag would be hiding the control in use. The same goes for a rotate
zone, a corner-radius handle and a path anchor.

The tempting shape is a second boolean fed by the same six events. `railVeil`
exists *because* that shape failed once: six senders, one flag, and any missing
`end` leaves it stuck for the life of the page. A second flag is a second
chance at exactly that bug, with its own `settle` to remember to call. So the
kind rides along with the state that already has a floor under it — one
machine, one falsifier, and a `move` cannot outlive the gesture that set it,
because clearing `held` clears the kind with it.

The kind travels on the **event** rather than being written to `railVeil`
directly, so the listener that owns the state stays its only writer.

**Hiding is instant; the return is a fade.** The object is already moving under
the pointer, so a fade *out* would be a second animation competing with the one
that matters. Coming back is the other way round: the chrome arrives at a
position it has never occupied, and a pop there reads as a glitch where 140ms
on the settle curve reads as the box catching up. A rAF ramp rather than a
Konva tween, because three separate elements need the same number and three
tweens would need keeping in step.

`listening` follows the opacity, so an invisible box cannot take a click that
belongs to the board underneath it.

## 5a-0-af. Shadow lost a layer of chrome

Drop and Inner were **nested accordions, each containing a row labelled
"Enabled" with a switch in it**. So turning on a drop shadow meant opening a
section to find a control whose only job was to reveal the rest of that
section: three affordances for one fact, two of them redundant, and two states
— open but off, closed but on — that mean nothing and that the panel could get
into.

A `SubGroup` is the switch *as* the disclosure, which is what the text effects
section already uses for this exact shape. One control, one fact, no state that
can disagree with itself.

Both shadows also gained what the rest of the panel already had: a pipette on
the colour (a shadow's colour is the one most often sampled *from the scene* —
it is usually a darker relative of the surface it falls on, and it was the last
colour here offered without one), glyphs on the offsets, and the sliders from
5a-0-ac.

The offsets stay Cartesian rather than becoming angle-and-distance. Illustrator
offers the polar pair and Figma offers this one; the reason to follow Figma is
that everything else on this canvas is already X and Y — the Transform block,
nudging, the alignment guides — so an offset that reads "8 down" composes with
them. An angle would be the better control for matching several objects to one
light, which is a feature this does not have and which wants a document-level
setting rather than a second spelling of the same field.

## 5a-0-ag. The pencil, against Illustrator's own workflow

The reference workflow's first phase is *set Fidelity before drawing anything*.
This tool had it hard-coded, as two numbers chosen by input device — a stylus
got `streamline: 0.5`, a mouse `0.72`.

The reasoning behind that split is right and worth keeping: mouse samples
arrive in bursts shaped by the OS and the frame budget, and every burst became
a bulge in the line. But a constant is the wrong *shape* for it. How literal a
line should be is a property of **what is being drawn**, not of the hardware —
handwriting wants the hand's own wobble and a quick circle wants none of it, on
the same device.

So the setting is the value and the device is an offset. A stylus needs about a
fifth less help at every setting, which keeps "less smoothing on a pen than on
a mouse" true across the whole range rather than at one point on it.

Measured in the browser against a deliberately jittery sixty-sample run:

```text
   0   1034 points   528 rad of total turning   (follows every wobble)
  40    160 points   136
  72    130 points    55   ← the default, and what the tool already used
 100    102 points    26   (draws through everything)
```

Stored 0–100 rather than the library's 0–1, because it is a control with a
readout: `72` is a setting somebody can report and return to, and a slider
reading `0.72` looks like a number that escaped. It starts where the tool
already sat, so nobody's strokes change character the day it ships.

**Keep-selected** is a preference now, off by default. A stroke that stays
selected puts a handle under the next press and changes the panel between
strokes — what anybody drawing twenty lines turns off first. On is right for
the other job: drawing one line and immediately restyling it. The tool is not
swapped either way; `ShapeTool` hands back to Select because a rectangle is
placed once, and a pencil is held for a while.

### What I did not do, and what it would take

**The stroke/fill separation.** The reference is about a tool that draws a
*stroked path*; this one draws a **filled outline polygon** from
`perfect-freehand`, so `appearance.fill` is the ink. That is inconsistent with
this app's own bezier paths, where `fill` is the interior — and it is what
stops a closed pencil loop from ever having one.

The fix is real and identified: the pencil already writes its colour to
**both** `fill` and `stroke`, so flipping the freehand renderer to paint its
polygon from `stroke.color` is safe for every existing document (the two hold
the same value) and frees `fill` to mean the interior, consistent with every
other node type. Then a stroke whose end returns near its start stores
`closed: true` and the enclosed centreline gets painted.

It was not done because it spans `PathRenderer`, `SVGExporter`, `svgImport`,
the context toolbar's capability rule (`geometry.kind !== 'freehand'` withholds
stroke controls) and the Properties panel's — and because it changes what the
Fill control does to a pencil stroke somebody already has on a board. That
wants verifying on canvas, in an export and through a copy-paste round trip,
and the Chrome extension has been unreliable all session.

**Edit-selected-paths and Alt-to-smooth** are the other two from the reference,
and both are genuine tool work rather than settings: redrawing a segment of an
existing path means hit-testing against a stored centreline, splicing a new run
into it, and deciding what happens to the pressure profile across the join.

## 5a-0-ah. The eraser erases ink, not area

For every object it could not *cut* — everything except a pen path and a
freehand stroke — the eraser tested the raw axis-aligned bounding box and
deleted the whole object if the disc came near it. Three consequences, in
rising order of alarm:

1. **A rotated object has a box much larger than itself.** A square turned 45°
   has one 41% wider in each direction, and its four corners are empty. All
   four were live targets.
2. **An unfilled shape is a hole with an outline round it.** Erasing through
   the visibly empty middle of a rectangle deleted it.
3. **A frame is a container whose interior belongs to its children.** Its box
   is exactly the region somebody reaches into with an eraser, so *any* stroke
   inside a frame deleted the frame — and its children with it. That is the one
   that turns a small mistake into losing a board's work.

The test moved to `eraseHit.ts` with twenty assertions. "Which objects did that
gesture delete" is invisible to types and to every other test in the codebase,
and it is destructive; `capApplies` was pulled out of the stroke panel for the
same reason and found wrong in a shipped build with nothing failing.

What it does now: the pointer is rotated into each node's own frame, so one
rotation replaces four transformed corners and a polygon test. A frame and an
unfilled shape are tested against their **outline**. A line is tested against
its line rather than the two large empty triangles either side of a diagonal.
An ellipse keeps its normalised-radius test and gains a hollow one for the
unfilled case. A sticky, an image or a text block is still its box, because for
those the box *is* the ink.

**Erasing across a stroke also changed what was left.** The pieces were
re-stroked with `smoothing: 0.5, streamline: 0.5` — the filter the *pencil*
applies to raw pointer samples. The stored centreline is not raw: it has
already been streamlined at whatever the tool was set to, then simplified again
by Douglas–Peucker. Running the filter over it a second time rounds a line that
was already rounded, so both halves came back visibly softer than the stroke
they were cut from. `streamline: 0` now, with only enough smoothing to curve a
polyline, and no thinning — a centreline carries no pressure, and inventing a
taper would put one where the original had none.

Undo needed nothing: `captureTimeout: 500` on the UndoManager already merges a
continuous gesture into one step.

## 5a-0-ai. Slider marks moved under the track

Cutting a notch through the rail is what a physical detent looks like — and
also what a **broken bar** looks like. Three of them made four equal segments
that read as four separate things rather than as one continuous quantity, and
the fill had to jump the gaps.

Under the rail, the bar stays whole and the marks annotate it, which is the
relationship they actually have: the track is the value, a tick is a note about
where something sits on it.

The decorative ones went with the change. Opacity's quarter/half/three-quarters
and the shadow blur's 8-and-24 are gone — the latter sat crowded against the
left end of a track running to 200, annotating a tenth of it. What is left is
the origin (the value a bipolar control is measured from and returns to, and
the one position on the track you could not see) and two genuine thresholds:
export quality's 60 and 80, and the pencil's 40 and 72.

**A hint now hangs off the label rather than the row.** On the row it covered
the track, so a tooltip appeared over the thing you were dragging at the moment
you were dragging it, explaining a control you were already using. Opacity lost
its hint outright: "how much of what is behind this object shows through" is a
sentence explaining the word *opacity* to somebody who has just found the
opacity control.

## 5a-0-aj. Per-corner radii never reached a sketched shape

Reported as "individual corner radii don't work on sketch shapes", and it was
wider than that.

`shapeToPath` went through `shapeOutline`, which collapses the four radii to
`Math.max(a, b, c, d)` — the one number its vocabulary can hold. That collapse
is *right* for everything else downstream of it, which is clips and hit
regions, and its own docstring says why: one that is slightly too generous
rounds a corner that should have been square, which is better than one that
clips a corner that should have been round.

It is exactly wrong for `shapeToPath`, which is the function that produces the
**real** outline — and `shapeOutline`'s docstring already said so: four
different corners "are a path, which is what `shapeToPath` hands to anything
that needs the real outline." It just never got them.

So `[30, 0, 0, 0]` came through as a rectangle with four 30-unit corners. The
visible symptom was the sketch, which flattens this path to draw its hand-drawn
outline — but **flatten-to-path and the boolean operations were losing the same
information**, silently.

`rectPath` takes four radii now and reads them from the node. Two details worth
keeping:

- **A square corner is one anchor, not a pair.** Emitting the rounded corner's
  two coincident anchors with two zero-length handles gives a degenerate curve
  that renders as a corner, edits as a trap in the path editor, and doubles the
  anchor count of a plain rectangle for nothing.
- **The radii are fitted per shared edge**, not capped per corner, so a 200×40
  box keeps a 40-unit corner as long as its neighbour is small — the same rule
  `fitRadii` applies everywhere else.

## 5a-0-ak. The inner shadow's spread was a black band

The inverse-path fill above it can be any opaque colour, because it lies
entirely outside the clip and only its *shadow* shows. The spread stroke
inherited that reasoning and it does not hold: **a stroke straddles the edge it
is drawn on**, so the inner half of a `spread * 2` wide line landed inside the
clip and was painted solid `#000000`.

The symptom was a thick black band hugging the inside of the outline, with the
shadow's actual colour nowhere in it, the moment spread went above zero.

The geometry was right and only the colour was wrong. That inner half is
precisely where a spread inner shadow is at full strength — a spread of *n*
means the shadow is solid for *n* units before the blur starts softening it —
so painting the band in `shadow.color` at `shadow.opacity` makes the stroke
draw the very thing it was supposed to be casting.

Measured on a real 2D context, sampling one pixel inside the top edge with a
`rgb(56, 189, 248)` shadow:

```text
  black stroke (before)   [0, 0, 0]
  shadow colour (after)   [62, 190, 249]
```

## 5a-0-al. The pencil's ink moved off `fill`

Flagged in 5a-0-ag as the model change it is; here it is.

`perfect-freehand` emits a filled outline polygon rather than a stroked line,
and the renderer took that literally: the polygon was painted with
`appearance.fill`, so a pencil stroke's **fill was its ink** and its `stroke`
was ignored. That made the pencil the one node type in the app where `fill`
does not mean the interior — a bezier path's fill is its interior, a shape's
fill is its interior — and it is exactly why a closed pencil loop could never
be filled: the field that would have held the colour was already spoken for.

**Both renderers read `stroke.color` now.** The change is safe on every board
that already exists, and that is not luck: `PenTool` has always written the
same colour to *both* fields, because the smooth branch painted with the fill
and the sketched branch stroked the centreline. So every stroke ever drawn
already carries its ink where this now looks. Nothing changes appearance; what
changes is which control edits it.

The context toolbar was withholding stroke controls from freehand strokes, on
the reasoning that a pencil mark is a filled outline with no separate stroke
render path. True of the **weight** — the nib fixed that when the pen lifted —
and not of the colour, so the rule was hiding the one control that changes what
a pencil line looks like.

### A closed stroke has an inside

`FreehandGeometry.closed` says the **centreline** loops. The outline is always
closed, which is not the same question and is why this needed a field rather
than a check.

Deciding it is not "are the ends close". Two short back-and-forth scribbles end
near where they began and enclose nothing; a tap ends exactly where it began.
So the gap is measured against the **nib** — a gap the pen itself would cover
is one a person calls closed — and the distance travelled has to be many times
the gap, which is the condition that separates a loop from a line that wandered
back. `isClosedLoop` has eleven tests, including the there-and-back case a
plain endpoint test gets wrong every time.

It is decided when the pen lifts and **stored**, because both halves of that
test are facts about the moment it was drawn. Recomputed at render time, a
stroke could stop being closed because somebody resized it or erased a piece
out of the middle, and its fill would vanish for a reason nobody could see.

The interior is drawn from the **centreline**, not the outline: the outline is
the edge of the ink, so filling it would paint the stroke's own body. The two
differ by half the nib all the way round, and that overlap is what makes the
fill meet the ink with no seam. The shadow moves to the interior when there is
one — a closed stroke's silhouette is the filled region, and casting from the
ring alone would put a shadow inside the shape as well as outside it.

The SVG exporter emits the same two paths in the same order, so the file and
the screen stay the same picture.

Verified live: the normalizer keeps `closed` on a real loop, refuses it on a
two-point stroke, leaves every existing stroke open, and stores the key absent
rather than `false`.

## 5a-0-am. The draw flyout is two groups

Above the rule: what the **mark** looks like — how thick it is, and what kind of
line. Below it: how the **tool behaves** while you use it. They were one
undifferentiated stack of four, which is the shape that makes somebody read all
of them to find the one they want, and the two halves are reached at completely
different times — the mark when you decide what you are drawing, the behaviour
once and then never again.

The nib control is called **Nib** rather than "Stroke". A pencil mark now has a
stroke colour and a stroke weight of its own, so a segmented control of four
*textures* under that word named the wrong thing twice over.

## 5a-0-an. The frame tool: orientation instead of a longer list

The catalogue was nine presets, and the module's own docstring explains why it
is short: *a picker with forty entries is a search problem.* That is right, and
it is also why half the sizes anybody wants were missing — a landscape phone, a
portrait slide, an A4 turned for a certificate are all a listed size on its
side.

**Orientation is a control, not more catalogue.** One toggle turns nine entries
into eighteen sizes without a longer list to read, which is the trade a control
makes far better than a list. Seven more presets earned their place on their
own — Desktop HD, the 4:5 portrait post (the tallest a feed shows uncropped),
a video thumbnail, a link preview, A3, A5 and a business card — bringing it to
sixteen.

**The turn is a transpose, not a rotation, and a test caught that.** A quarter
turn was the first instinct: what was the left margin becomes the top one, as
it does when you turn a page. It is wrong for a *toggle*, because two quarter
turns in the same direction is a half turn — pressing the control twice would
leave a story's guides upside down rather than back where they started. A
toggle has to be its own inverse, and transposing (top swaps with left, bottom
with right) is both self-inverse and the operation that actually matches what
the control does: swapping width for height **is** a transpose of the
rectangle, so the insets get the same treatment as the box they sit in.

The involution test found it on the first run.

### Three new things a frame can do

- **Resize to a named size.** A frame is one of the few things on a board whose
  dimensions have a *name*, and that name existed only in the tool that made
  it: drag a frame and there was no way back to A4 short of typing four digits
  from memory. The preset's safe area comes with the size, which is the honest
  reading of "make this an A4" — keeping a story's 250/320 insets on a business
  card would leave a frame promising a guide that means nothing.
- **Turn it.** Works on a custom size too, since it swaps the frame's own
  numbers rather than looking a preset up — and most frames are custom once
  anybody has dragged one.
- **Fit to contents.** Reads the frame's own membership rather than testing
  overlap, so an object merely passing over a frame is not counted. It does not
  move the children (their positions are what the fit is measured *from*) and
  it does not grow — a frame smaller than its contents is clipping them on
  purpose as often as by accident, and quietly revealing what somebody cropped
  is the bigger surprise.

`presetMatching` is exact rather than approximate, so the panel names a size
only when it really is one: a frame one unit off a preset has been resized
deliberately, and calling it "Desktop" is worse than calling it nothing.

## 5a-0-ao. The frame picker is three columns

Asked as "make the flyout wider instead of a longer scroll", and the direction
is right for a reason worth stating: **width alone does not fix it.** A wider
single column is still twenty rows — sixteen sizes, three headings and Custom
— behind the same scrollbar, so comparing a Story with an A4 still means
scrolling between two things that belong on one short menu.

What the width *buys* is columns, and the groups already were the columns.
Screen, Social and Print sit side by side at five or six each, and the whole
catalogue is visible at once with nothing to scroll.

With the room, each size shows its **shape**. A picker of sizes is scanned by
proportion far faster than it is read by numbers — "the tall one" is how
anybody thinks about this — so every entry carries a rectangle drawn at its own
ratio. Fitted inside a fixed box, because the ratio is the information and the
absolute size is not: scaling by it would make a business card a speck beside a
Desktop.

## 5a-0-ap. The grid got the configurations people ask for by name

The eleven systems answer **arrangement**, and each arrives at `KIND_DEFAULTS`
— numbers chosen to show that kind at its best. That is the right default and
it is not a configuration. The module says so itself, in the comment beside
`columns: 4`:

> Four, not twelve. A twelve-column grid is a *measure* you place things
> against, and this tool draws the tracks as objects — so twelve of them is
> twelve tall slivers rather than the four broad columns anyone picturing a
> column layout has in mind.

**Proportion is the other half.** A twelve-column, 24-gutter web grid is four
separate edits away — switch kind, set columns, set the gap, set the margin —
and every one is a number somebody has to already know. None of it is
discoverable from the panel.

Seven named configurations, kept short on the same discipline `frames.ts`
states. Two are worth their reasoning:

- **Twelve** is twelve because of what it *factors into*: halves, thirds,
  quarters and sixths all land on a track boundary, which is why the web
  settled on it rather than on ten.
- **Rule of thirds** has no gutter and no margin on purpose. It is a measure
  laid over a whole picture, and a gap between the thirds would be a gap in the
  picture — the one preset whose cells are meant to touch.

**A preset is a patch, not a whole spec.** Picking "Twelve column" is a
statement about tracks, not about where the grid sits or how big it is, so
applying one never moves or resizes what you are looking at. That is what makes
trying three in a row a *comparison* rather than a series of accidents.

`gridPresetMatching` is blind to the fields a preset does not set — a grid that
has been moved, resized or reseeded is still the preset it was built from — and
exact on the ones it does, because a grid one column off has been adjusted
deliberately. A kind default matches nothing and reads as "Custom", which is
honest: arriving at a kind is not arriving at a configuration.

**Words rather than miniatures**, where the systems below get pictures. A
system is a shape whose name means nothing until you have seen one; a preset is
a *name for numbers*, and "Twelve column" says more than any thumbnail of
twelve slivers could. Two adjacent rows of tiles meaning different kinds of
thing would read as one row that had gone wrong.

Verified against the real layout engine: the twelve-column preset produces
twelve cells 70 units wide, the last ending at 1152 on a 1200-wide grid. 1200
less two 48 margins is 1104; less eleven 24 gutters is 840; over twelve is 70.

**Not added, and why.** A *shuffle* button was the obvious candidate and is
already better served: `GridVariations` shows five candidates and writes
nothing until one is chosen, where a shuffle commits a change you cannot see
until it has happened and loses the arrangement you liked on the second press.
The genuinely missing thing is a **layout guide** — a twelve-column measure
drawn as chrome on a frame and snapped to, rather than built as objects — which
is the other meaning of the word "grid" and a subsystem of its own.

## 5a-0-aq. The frame picker widened three other flyouts

A regression from the commit above, reported immediately and worth recording
because the shape of it recurs.

The three-column picker needed room, and it took it by widening
`.dock-flyout__panel--wide` from 200px to 430. But `wide` is **shared**: Type,
Grid system and the More menu all carry it, so three flyouts doubled in width
to make room for a grid only one of them has.

**A modifier named for a degree rather than for a purpose will always be worn
by more than the thing that needed it.** `--wide` says how much, not what for,
so there was nothing in its name to stop a fourth caller — or to warn the
person changing it that three others were listening.

The width lives on `.frame-picker` now. The panel is a flex column, so a child
that declares a width widens it, and that is the honest arrangement: the three
columns are the reason this flyout is wide, and nothing that does not contain
them should be. Measured after: a `wide` flyout without the picker is back to
200px, the frame one is 416.

## 5a-0-ar. The layout guide — the other meaning of "grid"

Named in 5a-0-ap as the genuinely missing thing, and built here.

**Two features share the word, and conflating them is what makes column layout
awkward in tools that ship only one.** `engine/grid/` builds a grid **as
objects** — real rectangles you select, colour and break apart — and its own
defaults say so: `columns` starts at four, because twelve tracks *drawn as
objects* is twelve tall slivers rather than the four broad columns anyone
picturing a column layout has in mind.

A **layout guide** is the opposite. It draws nothing that exists: chrome over a
frame, never exported, unselectable, and its only job is to give edges for
other things to line up against. Twelve columns is completely ordinary here,
because nothing is drawn — you are placing content *on* a measure, not filling
modules.

### It cost almost no new machinery, and that is the point

`objectSnap` already snaps to ruler guides by expressing each as a **zero-width
box on its own axis**, appended to the candidate list — its docstring says
"rather than as a special case threaded through the arithmetic". A column edge
is the same thing, so the measure joins the same list and nothing downstream
learns that layout guides exist.

Restricted to frames in view, for the reason the object candidates are:
snapping to something you cannot see produces a jump with its explanation drawn
off-screen. A frame being dragged is skipped — an object cannot align to a
measure moving with it — but the moving object's **own** frame is included,
which is the case that matters most: placing a block on the measure of the
frame it already sits in is what a column guide is *for*.

### Details worth keeping

- **It lives on the frame**, because a measure is a property of the page it
  measures. Anywhere else and moving or resizing a frame leaves its guide
  behind, and two frames could not carry different measures.
- **Bands, not lines.** A line marks a boundary and leaves you to work out
  which side is the column; a tinted band *is* the column, so a block spanning
  three of them is visibly spanning three.
- **Warm and faint against the safe area's cool dashed outline**, so the two
  never read as the same kind of mark — one warns about the edges, the other
  measures across the middle.
- **Things snap to it, and deliberately never to the safe area.** That is the
  one line separating them: a frame that promised a safe area and then quietly
  moved things into it would be worse than no guide at all, while a measure
  exists to be moved onto.
- **A measure that cannot be drawn is dropped, not clamped.** No columns, or
  margins that have eaten the frame, is a key nothing reads — and storing one
  leaves the panel showing a guide that draws nothing.
- **The margins are the first and last column edges by construction**, so they
  are not added separately. Adding them would put duplicate candidates in the
  snap set and make a margin twice as sticky as the columns beside it.

14 tests on the arithmetic — the kind that looks obviously right and is off by
one gutter. Verified live: twelve bands of 70 on a 1200 frame ending at 1152,
24 snap edges, the normalizer keeping a real measure, dropping a zero-column
one, clamping 999 to 24, and storing nothing when there is none.

**Rows are the obvious extension and are not built.** Figma has both; a
horizontal measure is the same arithmetic on the other axis and the same
zero-width-box trick, and it wants doing when somebody needs it rather than
speculatively.

## 5a-0-as. Rows, and why the guide changed shape to get them

The measure shipped flat — `{ columns, gutter, margin }` — which reads well
until rows arrive and there is nowhere symmetrical to put them. `rowGutter` and
`rowMargin` beside a bare `gutter` makes one axis the default and the other an
afterthought, and every reader then has to know which of the two spellings it
is looking at.

A guide is **two optional axes of identical shape** now. Columns divide the
width, rows divide the height, and `axisBands` takes one axis and one extent —
so the arithmetic is written once and the caller says which way it is pointing.
A separate row function would have been a second place for the off-by-one
gutter to live.

The normalizer still reads the flat form. It shipped one commit ago, the boards
written in between are real, and this is the module whose whole job is that
every stored form arrives as one shape. Verified: `{ columns: 12, gutter: 24,
margin: 48 }` comes back as `{ columns: { count: 12, gutter: 24, margin: 48 } }`.

Details:

- **Rows default to eight tracks and no margin.** A horizontal measure is
  almost always a baseline rhythm rather than a division into equal bands —
  you are spacing headings down a page, not filling eight stacked boxes — and
  a top and bottom inset is what the frame's safe area already says. Repeating
  it here would draw two guides along the same two edges.
- **Rows are drawn fainter than columns**, 0.05 against 0.08. Where the two
  cross they add, and two bands at 0.08 come to 0.15 — a chequerboard whose
  intersections read as a third kind of mark. At 0.05 the crossings stay close
  enough to a column alone that the eye still sees two overlaid measures rather
  than a plaid.
- **A row edge is a `y`.** Keeping the two candidate lists apart is what stops
  a block's left side snapping to a horizontal band — nonsense that would look
  like a bug in the snapper rather than in the guide.
- **Each axis has a switch, not a count of zero.** The normalizer drops an axis
  with no tracks, so a stepper that could reach zero would delete the field and
  then show a number that is not stored.
- **The panel renders both axes from one list.** Two hand-written blocks is
  where "columns has a margin field and rows does not" comes from.
- **It says when the numbers do not fit.** Twelve tracks at a 100-unit gutter
  needs 1100 units of gap before one exists; margins can eat a frame outright.
  Both are one edit to fix, once you know which of the three numbers is the
  problem — so the panel names it rather than drawing nothing.

## 5a-0-at. Grid modules are square by default

`defaultStyle().radius` was 12. A rounded module is a **decision** — it says
the grid is a set of cards rather than a division of a space — and making it
the default meant every grid arrived having made it. A modular grid, or a set
of thirds laid over a picture, is not a set of cards.

It is also the rule `ShapeTool` already follows: a new rectangle has square
corners, and a grid of rectangles that did not would have been the one place
the app rounded something nobody asked it to.

## 5. Next up

### 5a-0. The four things to do first

1. **Confirm sharing works end to end, on the deploy that carries the shutdown
   flush.** Three separate faults made a shared board look empty (§4j) and all
   three are fixed, but only the first was ever reproduced here — the other two
   were found by reading and by querying production. Open a board, add
   something, share a **View** link, and check a second browser sees it *and*
   is refused an edit. Then redeploy the server and check it again: that is the
   one that proves §4j-2, and it cannot be proven any other way.
2. **Run the backup workflow once by hand.** Actions → *Database backup* → Run
   workflow, `dry_run` checked, then again unchecked. Until an object lands in
   the bucket, recovery is Neon's six-hour window and nothing else. Everything
   else in this list can wait; this is the only one where the cost of waiting
   is unbounded.
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

- **The cursor, the selection box and Escape (§4q, §4r, §4s) are unwatched**,
  and they are the highest-value things to look at, because all three are about
  how something feels or where it is. In order: **move the pointer across the
  board and onto a panel** — one pointer, no seam, no second cursor anywhere;
  **hover a resize handle**, which is where two pointers used to show at once;
  **hover just outside a corner**, which should give a curved arrow angled to
  that corner and rotate on drag; **the pan tool pressed**, where the hand
  should close; and **the pen with Escape**, which should hand back the arrow.
  The one thing a test cannot speak for at all is whether the rotate zones are
  where the eye expects them.

- **The shading and walkthrough work (§4n-i, §4o, §4p) is unwatched too**, and
  it is the visual kind where a test cannot speak for the result. In priority
  order: a **sketched shape with a hachure fill, clicked through the middle** —
  the reported bug, and the one thing here with a user waiting on it; a
  **scribble-filled star or ring**, which is where the pen used to web the
  points together; **stipple at all three densities on a 300×200 shape**, where
  two of the three used to be identical and the change is meant to be plainly
  visible; **dense hachure**, which should read as strokes and not as a tone;
  and a **walkthrough run end to end**, where what a test cannot check is
  whether the ring lands on the object rather than a ruler's width off it.

### 5a-ii. The walkthrough project (still what the user originally asked for)

Agreed scope, in order. Two of five are done:

1. ~~**Demo rooms**~~ — done. **26 templates in 5 categories**, including
   deliberate scale showcases at 100/500/1000 objects.
2. **Per-tool guided walkthroughs.** *Started — the engine and five sequences
   are in; see §4p.* The agreed design held: a mark anchored to a real object
   that **advances by doing the thing**, not by a Next button.

   What is in: the walkthrough table (references into `lessons.ts`, no copy of
   its own), the five observations, the state machine with its two digest
   rules, the anchored ring through the tested `walkAnchor`, and the launch
   from the reference library. Five sequences — connectors, line routes, the
   sticky chain, frames, the pen.

   **What is left, in the order I would take it:**

   - **Launch against a matching template rather than an empty canvas.** This
     was in the agreed design and is not built. `engine/templates/templates.ts`
     has 26 of them and the walkthrough currently starts wherever you are, so
     the connector sequence on an empty board asks you to join two objects that
     do not exist. That is the largest remaining gap and it is the one people
     will hit first.
   - **A step that cannot be observed has no walkthrough.** Eleven lessons are
     deliberately excluded and `walkthrough.test.ts` names them. Some are right
     to exclude for good (`offline`); some are only excluded because their
     gesture leaves no trace in the document (`forces`, `image-reframe`). If
     those are wanted, the honest route is a new observation, not a Next button
     on the ones that cannot detect themselves.
   - **The ring points at the newest object the step produced**, which is right
     for most steps and arbitrary when a step creates several. A step could
     name what it points at.
   - Nothing here has been **watched running** — see §5a.

   The user chose "scripted real mutations" over a recorded video when asked.
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
