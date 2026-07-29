# Handoff

Written at the end of a large rebuild session so the next session can start cold
without re-deriving context. Read this, then `README.md`. Delete this file once
its "next up" list is exhausted.

---

## 1. Start here

```bash
docker compose up -d              # Postgres, Redis, MinIO, sync server (:3000)
npm install                       # only if node_modules looks stale — see §5
npm run dev -w apps/frontend      # :5173
```

Verify in ~30 seconds:

```bash
cd apps/frontend
npx tsc -b            # must be silent
npm test              # 33 tests, 3 files
npx vite build         # must succeed
```

Then open two browser windows on the same `/room/:id` and confirm the header says
**Saved** (not "Offline") and that an object created in one appears in the other.
That single check exercises the whole sync path.

## 2. What state the repo is in

Four tracks of work landed. Verified end-to-end in a browser, not just by
typecheck.

| | |
| --- | --- |
| Typecheck | clean (frontend and server) |
| Tests | 33 passing — `normalize`, `migrate`/CRDT convergence, `geometry` |
| Build | clean, ~1.16MB JS (no code splitting yet) |
| Lint | 10 warnings, all known — see §4 |
| `@ts-nocheck` | none remaining |

**The headline fix:** real-time collaboration was completely broken. Hocuspocus
v4 changed `handleConnection()` so it only *builds* a `ClientConnection` and no
longer subscribes to the socket. `apps/server/src/index.ts` discarded the return
value, so the server accepted every WebSocket and never read a byte. Every
session sat at "Offline" and nothing persisted. If sync ever appears broken
again, look there first.

**The structural fix:** `engine/model/schema.ts` described a model nothing
persisted, so sizes lived in up to three places read with different precedence in
six modules. There is now one canonical schema, normalization at the CRDT
boundary, and a one-time document migration. See `docs/DATA-MODEL.md`.

Both `README.md` and `docs/DATA-MODEL.md` were rewritten this session and now
match the code. `docs/ARCHITECTURE.md`, `PRD.md` and `BUILD-PLAN.md` are
**original pre-implementation design docs** — treat them as intent, not truth.

## 3. Rules the codebase now depends on

Breaking any of these silently reintroduces a whole class of bug that took a long
time to find.

1. **All node writes go through `engine/document/mutations.ts`.** It stamps
   `zIndex`, `createdAt`, `updatedAt`, `createdBy`. Do not write `objectsMap`
   directly from a component or tool.
2. **All node reads come from `useStore`**, which normalizes at the boundary. Do
   not read raw `Y.Map`s outside `engine/document/`. (Note: `objectsMap.get(id)`
   returns a `Y.Map` — its fields are only reachable via `.get()`. Reading
   `node.zIndex` as a plain property yields `undefined`, which is exactly the bug
   that made three separate "bring to front" paths compute `0`.)
3. **`width`/`height` are the only bounds.** `geometry` = form, `appearance` =
   paint. Nothing stored twice.
4. **`hidden`, not `visible`.** There is no `visible` field.
5. **One observer of `objectsMap`** (`engine/document/observe.ts`), one
   `<Transformer>` (`SelectionTransformer`), one text editor (`NodeEditor`), one
   Konva `fontStyle` composer (`renderers/shared.ts`).
6. **Components reference semantic CSS tokens only**, never primitives like
   `--gray-500`.
7. **A capability in `engine/objects/definitions.ts` may only be `true` if a
   control for it actually reaches the renderer.** Declaring one the renderer
   ignores produces a control that silently does nothing.

### One CSS trap worth knowing

The theme class lives on `<body>` while tokens live on `:root`. A custom property
that *composes* another (`--x: 0 0 0 2px var(--surface-primary)`) is substituted
where it is **declared**, so it resolves against the light-mode value even in dark
mode. Compose theme-dependent values in the rule that uses them, not in a token.
This already bit the focus ring once.

## 4. Next up, in the order I'd do it

1. **The 6 `react-hooks/exhaustive-deps` warnings** — 3 in `Canvas.tsx`, 2 in
   `ObjectContextToolbar.tsx`, 1 in `TimeTravelBar.tsx`. These are the same
   *class* of defect as everything fixed this session: a value captured in one
   place while the truth lives in another. Some are deliberate; at least a few are
   probably live staleness bugs. Each needs individual judgement — do not bulk-fix
   by adding deps, which can cause render loops.
2. **Component/interaction tests.** The 33 existing tests are pure logic and CRDT.
   Every interaction path changed this session and has only ever been exercised by
   hand through a browser. Needs jsdom plus a Konva mock.
3. **`usePhysics` rebuilds all Matter bodies O(n) per store change**
   (`useEffect(…, [objects])`). Guarded by identity checks so it is not hot, but a
   dirty-set is the right fix.
4. **Bundle splitting** — 1.16MB, no chunks. Konva, Matter and framer-motion are
   the obvious lazy candidates.
5. **The 4 `react/only-export-components` warnings** are cosmetic: `StickyRenderer`
   and `Canvas` export constants alongside components, which only costs Fast
   Refresh granularity.

### Known gaps (deliberate, documented in README)

- PNG export omits audio players (they are DOM overlays, not canvas).
- The dashboard lists workspaces from `localStorage` and never checks whether they
  still exist server-side, so a deleted room lingers as a card.
- Groups are flat — no nesting, no enter-group editing.
- No permissions: anyone with a room link can edit it.
- Auth is a display identity, not an account.

## 5. Environment notes

- **`@hocuspocus/server` version skew is the trap in this repo.** The root
  `node_modules` was at 2.15.3 while `package.json`/the container ran 4.4.0, so the
  IDE typechecked against a *different API* than production — which is why the
  sync bug was invisible for so long. If server types look wrong, run `npm install`
  at the root and confirm:
  `node -e "console.log(require('./node_modules/@hocuspocus/server/package.json').version)"` → `4.4.0`.
- Vite picks the first free port from 5173. **Each port is a separate origin**, so
  `localStorage` (workspace list, identity, theme) and IndexedDB do not carry
  across ports. If the dashboard looks empty or you appear as a different user,
  check which port you are on.
- Server changes need `docker compose up -d --build server` — the container builds
  its own `node_modules` and compiles TypeScript at image build time.
- `docker logs vega-canva-server-1` is the fastest way to confirm the server came
  up (`Server running on port 3000`, `Database initialized successfully`).

## 6. Cleanup already done

Nothing of mine is left behind, but for the record:

- Test rooms (`synctest01`, `track1verify`, `finalcheck7`, `perftest500`,
  `emptycheck1`, `smoketest9`) deleted from Postgres, plus their `localStorage`
  cards and IndexedDB copies on the affected origins. Remaining rooms
  (`sdfchAq5q7`, `uyYSnO0vXv`, `test-123`, `testroom123`, `VS89DuB4xA`) are
  pre-existing and untouched.
- Dev servers on 5173/5174/5175 stopped; no orphaned node processes.
- Deleted dead modules: `ContextInspector.tsx`, `interactionEngine.ts`,
  `interactionManager.ts`, `navigation.ts`, `roomSlug.ts`, `App.css` (unmodified
  Vite starter boilerplate), `scratch.ts`, and an `EraserTool.ts` that was a
  one-line re-export shim shadowing `EraserTool.tsx`.
- Removed a working-but-unreachable canvas text search from `Room.tsx` and
  reinstated it inside the Command Palette, where it now searches objects
  alongside commands.
- Lint warnings 59 → 10, almost entirely dead imports and vestigial state
  (including `Canvas` props `isPlayMode`/`overrideObjects` that nothing read).

## 7. Where things live

`README.md` has the full map. The five files to read first, in order:

1. `engine/model/schema.ts` — the data model everything else obeys
2. `engine/document/` — CRDT ownership, the single write path, normalization
3. `hooks/useStore.ts` — the one bridge from document to UI
4. `components/ObjectRenderer.tsx` — shared node behaviour, dispatch to renderers
5. `components/Canvas.tsx` — input, tools, camera, the shared transformer
