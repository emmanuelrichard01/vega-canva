# Canvas specification, and where this codebase stands against it

The target is the unified anatomy of a modern canvas application — a vector
engine in the Figma/Illustrator sense, plus the layout and publishing system
Canva provides. This file is the specification and the audit together, so that
"what is left" and "what exists" can never drift apart into two documents.

**Every line below was checked in the source**, not inferred from the README.
Where a claim is uncertain it says so.

## How to read the status column

| Status | Meaning |
| --- | --- |
| **Shipped** | Built, reachable from the UI, and holds up under the repo's own standard. |
| **Partial** | Reachable, but materially short of the specification item. |
| **Dead** | Schema or code exists and nothing can reach it. |
| **Absent** | Not present. |

**Dead is the worst of the four, and worse than Absent.** A dead field reads as
finished to anyone scanning the schema, is carried by every migration, is
serialized into every export, and quietly invites a second implementation
beside it. This project has been here before: `tags` sat on the schema for its
whole life, written and read by nothing, and the fix was to ship the field
*and* the filter that gave it a purpose in one commit. The same judgment
applies to everything marked Dead here — wire it or remove it, but do not leave
it.

---

## 1. Spatial structure and global environment

| Item | Status | Notes |
| --- | --- | --- |
| Infinite canvas | **Shipped** | `CameraSystem` + `SpatialIndex` (rbush). Treated as a large finite bound (±1,000,000) to avoid float drift at extreme pan. |
| Artboard / Frame / Page | **Dead** | `FrameNode` is in `schema.ts`, `ObjectRenderer` renders it, `SVGExporter` serializes it, `normalize.ts` migrates legacy `artboard` → `frame` — and **no tool creates one**. The registered tool ids are select, hand, pen, bezier-pen, eraser, text, shape, sticky, comment, image, audio. There is no frame tool, so a frame cannot exist in a real document. |
| Sections | **Absent** | Nothing groups frames on the canvas. |
| Layout grids | **Partial** | `engine/interaction/gridSnap.ts` snaps drags to a grid, off by default, held on with a modifier. There is no column/row/square grid *overlay* and no per-frame grid definition. |
| Rulers and guides | **Absent** | No ruler, no draggable guide, no guide storage. |
| Smart guides | **Absent** | No alignment detection, no equal-spacing detection, no snap-to-object. This is the single most-felt omission in day-to-day use. |
| Safe zones / bleed | **Absent** | Meaningless until frames exist. |

## 2. Selection and navigation

| Item | Status | Notes |
| --- | --- | --- |
| Bounding box | **Shipped** | One shared `<Transformer>` (`SelectionTransformer`) re-pointed at the selection, not one per object. Minimum-size clamp via `boundBoxFunc`. |
| Move / pointer tool | **Shipped** | `SelectTool`. |
| Scale tool | **Absent** | The transformer resizes geometry; nothing scales strokes, corner radii, shadows or type with the object. This is a distinct tool in the spec and it does not exist. |
| Deep select / direct selection | **Absent** | Groups are flat — members share a synthetic `parentId`, there is no nesting and no enter-group editing, so there is nothing to select *into*. |
| Marquee selection | **Shipped** | `SelectTool` draws the rect; `Canvas` resolves it to ids. |
| Hand / pan tool | **Shipped** | `HandTool`, plus space-drag. |
| Zoom / canvas scale | **Shipped** | Wheel and pinch through one non-passive native listener; the percentage readout lives in the radar panel. Covered by `CameraSystem.test.ts`. |

## 3. Creation and vector drawing

| Item | Status | Notes |
| --- | --- | --- |
| Pen tool | **Shipped** | `BezierPenTool`. Anchors placed with a drag get a forward handle; the backward handle mirrors it. |
| Pencil tool | **Shipped** | `PenTool` with `perfect-freehand`, simplified through `utils/pathSimplifier.ts`. Stores both the filled outline and the centreline the eraser splits on. |
| Shape tools | **Partial** | Rect, ellipse, triangle, hexagon, star. **No general N-gon** (the spec asks for pentagon/heptagon/octagon and up), **no line**, **no arrow**. `ShapeGeometry` carries `points`/`innerRatio` for stars and `ShapeRenderer` honours them, but no control sets either — a star is always 5-pointed at 0.5. |
| Text tool | **Shipped** | `TextTool` + one shared `NodeEditor`. |
| Eyedropper | **Absent** | No colour, style or text-style sampling anywhere. |
| Place image / media | **Partial** | Raster images and audio upload to MinIO, referenced by URL. **SVG is not imported as vector** (it would land as a raster `<img>`), and video is not supported at all. |

## 4. Vector and path manipulation

| Item | Status | Notes |
| --- | --- | --- |
| Anchor point | **Partial** | Anchors exist in `BezierGeometry.segments` and are placed at draw time. They **cannot be selected, moved or deleted after the path is committed**. |
| Bezier handles | **Partial** | `cp1x/cp1y/cp2x/cp2y` are stored and `PathRenderer` draws from them, but there is no handle UI after creation. |
| Join / cap styles | **Absent** | `Stroke` has `color`, `width`, `dash` — no `lineCap`, no `lineJoin`, no miter limit. |
| Boolean operations | **Absent** | No union, subtract, intersect or exclude. Needs a real path-geometry library; this cannot be hand-rolled responsibly. |
| Vector network | **Absent** | Paths are linear segment lists. Branching nodes would be a model change, not a feature. |
| Flatten | **Absent** | |
| Outline stroke | **Absent** | |

## 5. Layout and structural logic

| Item | Status | Notes |
| --- | --- | --- |
| Layers panel | **Shipped** | Virtualized (`useVirtualRows`) — a DOM row per object is the most expensive consumer of document change at scale. Carries the tag filter. |
| Grouping | **Partial** | Flat only: a shared synthetic `parentId`, no nesting, no enter-group editing, no group bounds as a first-class object. |
| Lock / unlock | **Shipped** | |
| Visibility / hide | **Shipped** | `hidden` on the base node; renderer and Layers panel both gate on it, and there is deliberately no second `visible` field. |
| Auto layout / flexbox | **Dead** | `FrameNode.layout` declares `direction`, `padding` and `gap` in the schema. Nothing reads it, and no frame can be created in the first place. |
| Constraints / resizing rules | **Absent** | No pinning, stretching, hug or fill. Requires frames. |
| Absolute positioning | **Absent** | Only meaningful once auto-layout exists. |

## 6. Transform block

| Item | Status | Notes |
| --- | --- | --- |
| X / Y | **Shipped** | |
| W / H | **Shipped** | `width`/`height` on the base node are the only source of bounds — a load-bearing rule, see `schema.ts`. |
| Aspect ratio lock | **Shipped** | Lock toggle between the W and H steppers. |
| Rotation | **Shipped** | 15° steps in the panel; free from the transformer. Objects rotate about their centre. |
| Flip | **Shipped** | Horizontal and vertical, via `scaleX`/`scaleY` negation. |
| Corner radius | **Partial** | Rect and image only. No per-corner control, no squircle smoothing. |

## 7. Surface styling

| Item | Status | Notes |
| --- | --- | --- |
| Solid fill | **Shipped** | |
| Linear gradient | **Absent** | `Appearance.fill` is already `Paint[]` with a `type: 'solid'` discriminant, so the model was designed to take these. |
| Radial gradient | **Absent** | |
| Angular / conic gradient | **Absent** | Konva has no native conic fill; needs a generated pattern. |
| Diamond gradient | **Absent** | Same. |
| Image / video fill | **Absent** | An image is its own node type; it cannot fill a vector shape. |
| Stroke weight | **Shipped** | |
| Stroke alignment | **Absent** | Konva strokes are always centred. Inside/outside needs an offset path or a clip, which is real work, not a flag. |
| Dash pattern | **Dead** | `Stroke.dash?: number[]` is on the schema; **no renderer reads it and no control sets it.** (The dashes visible on a broken image are a hardcoded placeholder, unrelated.) |
| Layer opacity | **Shipped** | |
| Blend modes | **Absent** | Konva exposes `globalCompositeOperation`, which covers most of the list, so this is unusually cheap for its visual payoff. |

## 8. Lighting and blur effects

| Item | Status | Notes |
| --- | --- | --- |
| Drop shadow | **Partial** | `Shadow` has `color`, `blur`, `offsetX`, `offsetY`. **No spread.** |
| Inner shadow | **Absent** | |
| Layer blur | **Absent** | Konva filters need explicit caching to perform; wiring them naively will cost frames. |
| Background blur | **Absent** | Sampling what is underneath on a Canvas2D scene graph is the hardest single item in this section. |

## 9. Typographic engine

| Item | Status | Notes |
| --- | --- | --- |
| Font family and weight | **Shipped** | `FontSelector`. `fontWeight` and `italic`/`underline` are kept orthogonal and composed into Konva's `fontStyle` string in exactly one place. |
| Font size | **Shipped** | |
| Line height | **Shipped** | |
| Letter spacing | **Shipped** | |
| Kerning | **Absent** | Pair-level adjustment; needs font metrics access. |
| Paragraph spacing | **Absent** | |
| Text alignment | **Shipped** | Horizontal and vertical. |
| Text case | **Absent** | |
| Text decoration | **Partial** | Underline only. **No strikethrough.** |
| OpenType features | **Absent** | Ligatures, fractions, tabular numbers, stylistic alternates. Canvas2D exposes `fontVariantCaps` and little else — this likely needs a different text rendering path. |
| Text box resizing | **Partial** | `autoHeight` exists as a boolean. The spec's three-way Auto Width / Auto Height / Fixed is not exposed, and fixed-size overflow behaviour is undefined. |

## 10. Design systems and component architecture

| Item | Status |
| --- | --- |
| Global styles / design tokens | **Absent** |
| Component / master template | **Absent** |
| Instance | **Absent** |
| Overrides | **Absent** |
| Variants | **Absent** |
| Boolean properties | **Absent** |
| Instance swapping | **Absent** |

Nothing in this section exists. Note the distinction worth keeping straight:
`index.css` has a real, disciplined token system for the **application's own
chrome**. That is not what this section asks for, which is tokens and
components *inside the user's document*, synced through the CRDT and
overridable per instance. They share a word and nothing else.

## 11. Raster and media

| Item | Status | Notes |
| --- | --- | --- |
| Image cropping | **Dead** | `ImageNode.crop` is on the schema. `ImageRenderer` reads `src`, `width`, `height` and `cornerRadius` — **and nothing else**. A stored crop is silently ignored. |
| Masking / clipping path | **Absent** | |
| Non-destructive adjustments | **Dead** | `ImageNode.filters` declares `brightness`, `contrast` and `blur`. Same renderer, same story: never read. Exposure, saturation, temperature/tint and highlights/shadows are not even on the schema. |
| Background removal | **Absent** | Needs a model or a service. This is a product decision before it is an engineering one — flagging rather than assuming. |

## 12. Prototyping and interactive behaviours

| Item | Status |
| --- | --- |
| Interactions / triggers | **Absent** |
| Action types | **Absent** |
| Animation transitions | **Absent** |
| Easing curves | **Absent** |
| Scroll behaviour | **Absent** |
| Overflow scrolling | **Absent** |

Nothing in this section exists, and all of it depends on frames.

## 13. Collaboration and communication

| Item | Status | Notes |
| --- | --- | --- |
| Comments mode | **Shipped** | Threads on a point or an object, replies, author-only edit/delete, resolve, mentions with `@[Name](id)`, per-person unread state outside the CRDT, and an inbox. 31 tests. The strongest feature in the app. |
| Cursor chat | **Absent** | Would ride awareness like everything else ephemeral; `PresenceManager` is the only writer and already has the throttle. |
| Follow mode | **Dead** | `Room.tsx:181` is `const [followingClientId] = useState<number | null>(null)` — **no setter exists**, so the value is permanently `null` and the effect below it can never fire. The navigation code inside it is correct and unreachable. |
| Version history | **Shipped** | Time Travel over semantic moments — a 14-step drag is one "Dave moved Ship the beta", not 14 entries. Keyframes make seeking backwards cheap, and the server reports how many updates retention discarded rather than presenting a partial session as the whole one. |

## 14. Export and file pipelines

| Item | Status | Notes |
| --- | --- | --- |
| Export scale (1x/2x/3x) | **Absent** | No multiplier anywhere; PNG is clamped to a maximum canvas edge and that is the only sizing control. |
| PNG | **Shipped** | Reframes the stage onto the document bounds, captures, restores. Omits audio players, which are DOM overlays. |
| SVG | **Shipped** | Serializes CRDT state to real vector primitives rather than rasterizing, with user text escaped. |
| JSON | **Shipped** | Canonical node data plus comment threads. |
| PDF / EPS | **Absent** | |
| CSS / SVG code / Swift / Android XML | **Absent** | |
| Export selection vs. document | **Absent** | All three formats frame the whole document bounds. There is no "export this selection". |

---

## The tally

Roughly, across the ~100 discrete items above:

- **Shipped: ~30** — concentrated in the canvas core, collaboration, and the parts of the transform/typography blocks that a whiteboard needs.
- **Partial: ~13**
- **Dead: 7** — frames, auto-layout, stroke dash, image crop, image filters, star parameters, follow mode.
- **Absent: ~50** — almost the whole of vector manipulation, design systems, prototyping, effects, and the paint model beyond flat colour.

The shape of that is worth stating plainly: **this is an excellent real-time
collaborative whiteboard and it is not yet a vector design tool.** The gap is
not polish on what exists; it is five or six systems that do not exist at all.
Nothing in the audit above is a criticism of the code that is there — the
engine's invariants are exactly the ones that make adding these systems
possible rather than painful.

## Proposed sequence

Ordered by what unlocks the most and what the model already leans toward, not
by section number.

**Phase 0 — Settle the seven dead items.** Frames, auto-layout, dash, crop,
filters, star parameters, follow mode. Each is either wired to a control or
removed. Cheap, and it stops the schema lying about what the product does.
Phase 1 subsumes the frame and auto-layout half of it.

**Phase 1 — Frames and artboards.** The structural unlock. Sections,
constraints, auto-layout, safe zones, per-frame export and the whole of
prototyping all depend on frames existing. The node type and renderer are
already written; what is missing is the tool, clipping, child ownership, and
frames as export targets.

**Phase 2 — The paint model.** Gradients (linear, radial, then conic/diamond
via generated patterns), blend modes, stroke alignment, dash and cap/join,
shadow spread, inner shadow, layer blur. `fill` is already `Paint[]` with a
discriminant, so the schema was built for this. Highest visual payoff per unit
of work in the whole list; blend modes in particular are nearly free.

**Phase 3 — Precision and selection.** Smart guides and snap-to-object, rulers
and guides, layout grid overlays, deep select and real nested groups, the scale
tool, eyedropper, and the missing primitives (N-gon, line, arrow). This is what
makes the tool feel professional in the hand, and smart guides are the single
most-missed item on the list.

**Phase 4 — The vector engine.** Booleans, post-hoc anchor and handle editing,
outline stroke, flatten, join/cap. Needs a path-geometry dependency chosen
deliberately. The deepest track here and the least shareable with anything
else.

**Phase 5 — The typographic engine.** Text case, strikethrough, paragraph
spacing, the three-way box resizing, kerning, then OpenType — which probably
forces a decision about the text rendering path.

**Phase 6 — Auto-layout and constraints.** Requires Phase 1 and real nesting
from Phase 3.

**Phase 7 — Components, instances, variants and document tokens.** The largest
single system, and the one with the most CRDT design risk: overrides that
survive a master edit, arriving concurrently from two people, is genuinely
hard. Worth doing after the model has stopped moving.

**Phase 8 — Raster.** Crop, masking/clipping, the full adjustment set with
Konva filter caching. Background removal is a separate product call.

**Phase 9 — Prototyping.** Triggers, actions, transitions, easing, scroll
behaviour. Depends on frames.

**Phase 10 — The export pipeline.** Scale multipliers, export-selection, PDF,
and code export.

Cursor chat is small and independent — it can be slotted anywhere.

## Decisions the owner needs to make, not assumptions to be made

1. **Background removal** needs a model or a hosted service. That is a cost and
   a dependency decision before it is an implementation.
2. **Video** (place, and as a fill) is a substantial media pipeline on top of
   the existing MinIO path. In or out?
3. **OpenType features** likely require moving text off Konva's `Text` onto a
   different rendering path. That is a large, invasive change for a small
   feature set — worth confirming it is wanted before it drives an architecture
   decision.
4. **Boolean operations** need a third-party path library. Pick deliberately;
   this is the kind of dependency that becomes permanent.

## The rules any of this work must respect

These are not style preferences; each was learned from a bug in this codebase
and each is documented at its source.

- `engine/document/mutations.ts` is the **only** write path, and reads are
  normalized at the CRDT boundary so nothing downstream sees a legacy field.
- `width`/`height` on the base node are the **only** source of bounds.
  `geometry` is form, `appearance` is paint, and nothing lives in both.
- Any CRDT container **created on demand can be created twice** — concurrent
  `set` on one key is last-write-wins. Seed containers with the node.
- Ephemeral state rides awareness, never the document, so it never enters
  history. One writer (`PresenceManager`), one reader (`collaboratorStore`),
  one frame loop.
- **Never declare a capability the renderer ignores.**
  `engine/objects/definitions.ts` says this in its own header, and the seven
  dead items above are what happens when it is not followed.
- A feature ships with the thing that gives it a purpose. Tags shipped with
  their filter; frames ship with a way to make one.
