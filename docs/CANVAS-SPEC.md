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
| Artboard / Frame / Page | **Shipped** | Frame tool (`F`) with a preset picker and drag-to-size. Frames own what is inside them — membership derived from the object's centre, recomputed on every drop — clip their children, move and delete with their contents, and claim whatever they are drawn around. Named at creation, because they are the one type people refer to by name. Nested frames work, smallest containing frame wins. Not yet: safe zones, and a proper place in the Layers panel. |
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
| Shape tools | **Partial** | Rect, ellipse, triangle, hexagon, star. Stars are now parametric — point count and depth are controls, clamped at the CRDT boundary. Still **no general N-gon** (the spec asks for pentagon/heptagon/octagon and up), **no line**, **no arrow**. |
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
| Dash pattern | **Shipped** | Solid / Dashed / Dotted, with the pattern derived from the stroke weight so it stays legible at any thickness. `Stroke.cap` was added and used in the same change, because a dotted line is `[0, gap]` and draws nothing at all under the default butt cap. A full pattern editor belongs with cap and join in Phase 4. |
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
| Image cropping | **Shipped** | Double-click an image, or the Crop button on its toolbar. Eight handles trim the frame, dragging the picture slides it under the window, thirds guides, and what is being cut away is shown at low opacity rather than hidden — you cannot judge a crop without seeing what is just outside it. The arithmetic is pure and tested (`engine/model/imageCrop.ts`): it clamps in natural pixels and derives the node's box from the result, never the reverse. Escape restores the framing you started with, which undo cannot do because one drag is many writes. |
| Masking / clipping path | **Absent** | Cropping is a rectangular special case of this; masking to an arbitrary vector shape is still Phase 8. |
| Non-destructive adjustments | **Partial** | Brightness, contrast, saturation and blur are wired end to end, in document units of -100..100 rather than Konva's disagreeing native scales. Exposure, temperature/tint and highlights/shadows need custom filters and are deliberately **not** declared on the schema until they work. |
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
| Follow mode | **Shipped** | Click a collaborator's avatar. Fits their viewport into your window rather than copying their zoom, so you provably see everything they see whatever the window sizes. Ends when you take the wheel — detected by comparing the camera against what the driver last wrote, so no input path has to know follow mode exists — or on Escape, the Stop button, or their leaving. |
| Version history | **Shipped** | Time Travel over semantic moments — a 14-step drag is one "Dave moved Ship the beta", not 14 entries. Keyframes make seeking backwards cheap, and the server reports how many updates retention discarded rather than presenting a partial session as the whole one. |

## 14. Export and file pipelines

| Item | Status | Notes |
| --- | --- | --- |
| Export scale (1x/2x/3x) | **Shipped** | PNG only — SVG and JSON have no pixels to multiply. Each option shows the pixels it will produce when a frame is the target, and the filename carries the `@2x` suffix. |
| PNG | **Shipped** | Reframes the stage onto the document bounds, captures, restores. Omits audio players, which are DOM overlays. |
| SVG | **Shipped** | Serializes CRDT state to real vector primitives rather than rasterizing, with user text escaped. |
| JSON | **Shipped** | Canonical node data plus comment threads. |
| PDF / EPS | **Absent** | |
| CSS / SVG code / Swift / Android XML | **Absent** | |
| Export selection vs. document | **Partial** | A **frame** can be exported on its own, at its own declared size, resolved once in the service so all three formats agree on what is in it. Exporting an arbitrary *selection* is still not offered, though `ExportOptions.selectedOnly` supports it. |

---

## The tally

Roughly, across the ~100 discrete items above:

- **Shipped: ~37** — the canvas core, collaboration, frames, and the parts of the transform/typography blocks that a whiteboard needs.
- **Partial: ~15**
- **Dead: 1** — `FrameNode.layout`, the auto-layout declaration, which Phase 6 owns.
- **Absent: ~47** — almost the whole of vector manipulation, design systems, prototyping, effects, and the paint model beyond flat colour.

**Phase 0 is otherwise done** (2026-07-31). Stroke dash, star parameters,
follow mode, image adjustments and image cropping each shipped with the control
that gives them a purpose. A **ninth** dead field turned up during the work and
went with them: `ImageNode.naturalWidth`/`naturalHeight` were declared, read by
the normalizer, and written by nothing, so they were always `undefined` — and
cropping cannot clamp against a bitmap whose size nobody ever recorded. The
first client to load an image now writes it back, the same fix the voice note
that showed `0:00 / 0:00` needed.

The honest note on verification: the pure arithmetic behind all five is
covered by tests, follow mode was driven end to end in the running app, and the
image filters were measured pixel-by-pixel against real Konva in an isolated
harness. What has **not** been watched is the crop overlay in the running app,
because the canvas culls through a rAF loop that never fires in an automation
tab, so no Konva image is ever mounted there. It wants ten minutes with a real
mouse.

The shape of that is worth stating plainly: **this is an excellent real-time
collaborative whiteboard and it is not yet a vector design tool.** The gap is
not polish on what exists; it is five or six systems that do not exist at all.
Nothing in the audit above is a criticism of the code that is there — the
engine's invariants are exactly the ones that make adding these systems
possible rather than painful.

## Proposed sequence

Ordered by what unlocks the most and what the model already leans toward, not
by section number.

**Phase 0 — Settle the dead items. Done, apart from what Phase 1 covers.**
Dash, star parameters, follow mode, image adjustments, image crop and the
natural-size fields all now ship with the control that gives them a purpose.
Frames and auto-layout are the remaining two, and Phase 1 is where they belong.

**Phase 1 — Frames and artboards. Mostly done.** The tool, presets, ownership,
clipping, move-and-delete-with-contents, capture-on-draw, and per-frame export
at 1×/2×/3× have shipped. **Two pieces remain**, both deliberately left rather
than rushed:

- **Frames in the Layers panel.** They appear as ordinary rows today, so a
  frame's contents are not shown as belonging to it. The panel already renders
  `parentId` clusters for groups, and `frameId` is a *different* relationship —
  it needs its own nesting rather than being folded into the group cluster.
- **Safe zones and bleed.** Per-frame margin guides that never export.

One caveat recorded honestly: **none of Phase 1 has been watched running.** The
canvas culls through a `requestAnimationFrame` loop that does not fire in an
automation tab, so no Konva node is ever mounted there and the frame tool, the
clipping and the crop overlay have all been verified by types, by tests over
their geometry, and by reading — not by looking. The clip path in particular
(inverting a child's absolute transform to map a frame's world rectangle into
its local space) is the kind of thing that is either exactly right or visibly
wrong, and it wants ten minutes with a real mouse before anything is built on
top of it.

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
