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
| Artboard / Frame / Page | **Shipped** | Frame tool (`F`) with a preset picker and drag-to-size. Frames own what is inside them — membership derived from the object's centre, recomputed on every drop *and at creation*, so something drawn inside a frame is born owned by it — clip their children, move and delete with their contents, and claim whatever they are drawn around. Named at creation, because they are the one type people refer to by name. Nested frames work, smallest containing frame wins. Their contents nest under them in the Layers panel, foldable. Their background is editable, which matters because it is also the export's background. |
| Sections | **Absent** | Nothing groups frames on the canvas. |
| Layout grids | **Partial** | `engine/interaction/gridSnap.ts` snaps drags to a grid, off by default, held on with a modifier, and now runs *before* object snapping as the coarser rule. There is still no column/row/square grid **overlay** and no per-frame grid definition — the piece that makes a frame a layout rather than a rectangle. |
| Rulers and guides | **Shipped** | Rulers along the top and left, drawn in the DOM — the stage is a raster surface with its own transform, and ruler numbers are small, dense and read at a glance, which is the one case where the browser's text rendering is the reason to prefer it. Tick spacing is chosen from the zoom and from round numbers only (1/2/5/10 per decade); a ruler labelled 0, 137, 274 is arithmetically correct and useless. Guides drag out of the rulers and are **document state** — a person placed them and expects collaborators to see them — stored in a `Y.Array` on a root name, committed on release rather than per frame. They also act as snap targets. |
| Smart guides | **Shipped** | Alignment against every edge and centre of every visible object, every ruler guide, plus even spacing between the nearest neighbour on each side, with magenta guides spanning the matched objects. Tolerance is in *screen* pixels divided by the zoom, so the pull feels the same at 10% and 800%. Candidates are limited to the viewport — a correctness call before a performance one, since snapping to something off-screen draws its explanation off-screen too. Grid snap applies first as the coarser rule; the same modifier suppresses both. **Caveat: the guide lines have not been watched on screen** — the arithmetic and the adapter carry 32 tests, but the drawing has only been read. |
| Safe zones / bleed | **Partial** | Safe zones ship: four per-frame insets, seeded from the preset (a story's 250/64/320/64, a print margin's 18) and editable in the panel. Drawn as chrome, so they never export, and nothing clips or snaps to them. **Bleed is deliberately not built.** It only means anything if the export is larger than the trim and the frame stops clipping at its own edge — which changes what `width`/`height` mean for a frame and what `frameExportBounds` returns. Drawn as a guide without those two changes it would be a dashed rectangle promising something the exporter does not honour. |

## 2. Selection and navigation

| Item | Status | Notes |
| --- | --- | --- |
| Bounding box | **Shipped** | One shared `<Transformer>` (`SelectionTransformer`) re-pointed at the selection, not one per object. Minimum-size clamp via `boundBoxFunc`. |
| Move / pointer tool | **Shipped** | `SelectTool`. |
| Line and arrow editing | **Shipped** | Drawn **click–move–click**, not by dragging: a line is often long, and holding a button across a board is an imprecise gesture a trackpad makes worse. Edited at its **endpoints** rather than by a bounding box — a box offers eight handles, none of which means "move this end", and its ten-unit floor made the horizontal and vertical line the two the tool could not draw. Shift constrains to 15° in both the drawing and the editing gesture, through one shared function. Six end styles shared with connectors, sized by `endScale` (50–400%), sketched by the same generator as the shaft. Labels ride the midpoint of the *run* on a plate, counter-rotated so they never read upside down, with the ink contrast-checked against the plate.

**A line's box is the extent it draws, and its endpoints live in `geometry`.** The box used to *be* the endpoints — corner to corner, the flip choosing the diagonal — which is exact for a straight line and wrong the moment the run has a profile: a wave deviates across the diagonal, so a wavy arrow stored 380x0 while drawing 380x49. Marquee, culling, the radar and export framing all read that box, so a profiled line could be missed by a marquee drawn round it and culled with its crests on screen. Half the stroke is added on every side, because a stroke is centred on its path and the old model gave a horizontal line a height of zero. Legacy lines are **read, not rewritten**: `localRunEnds` answers both forms, so anything drawn before opens unchanged — including in a Time Travel snapshot, where nothing can be repaired — and converts the first time it is edited, when a correct box can be computed from a real gesture rather than guessed. |
| Scale tool | **Absent** | The transformer resizes geometry; nothing scales strokes, corner radii, shadows or type with the object. This is a distinct tool in the spec and it does not exist. |
| Deep select / direct selection | **Absent** | Groups are flat — members share a synthetic `parentId`, there is no nesting and no enter-group editing, so there is nothing to select *into*. |
| Marquee selection | **Shipped** | `SelectTool` draws the rect; `Canvas` resolves it to ids. |
| Connector binding | **Shipped** | Drawn **click–move–click** or by dragging, the same grammar the line tool uses. An end binds three ways, most specific first: a named edge midpoint, an **anchor** — an exact spot stored in the node's own proportions, so it survives the object being resized — or `auto`, which names the object and lets the route pick a side. **Both ends must land on an object**, in the tool and in the editor alike: an unbound connector is a worse version of `shape:arrow`, which already exists, and it is a node declaring a capability it does not have. The loose coordinate stays in the model because *detaching* is real — deleting a box leaves its arrows where they were — but it cannot be authored. Refusal is shown rather than silent: the route greys, the free end draws hollow, and the gesture stays pending until it can land or Escape. Existing connectors are edited at their ends (`ConnectorEditor`); the bounding-box transformer stands down, as it does for a line, because a connector's `width`/`height` are derived and its resize handles were **inert**. One drag covers connect, re-connect, re-place and detach, because both the tool and the editor ask `bindingAt`. Ends land on the object's **outline**, not on its bounding box: a ray from the centre through the box-derived point takes the outermost crossing of the flattened `shapeToPath` outline, so a triangle, hexagon, star, diagonal ellipse or freehand blob is touched where it is *drawn*. The box remains the storage — this is the same division `lineEnds.ts` makes, where the box stores and something else is the interface. The rings the tool shows sit on the outline too, since a target that is not where the arrow lands teaches the wrong place. The *hit test* measures the same silhouette the rings are drawn on — point-in-polygon for containment, distance-to-outline for the edge band — so pointing at the shape works and pointing at empty air inside its box does not. **Rotation is handled**: an outline is a silhouette in world space, so once it carries the rotation every consumer is correct without knowing rotation exists; a turned rectangle contributes its turned corners, and anchors are stored back in the node's own unrotated frame so turning an object later does not drag its connectors around the outside. The whole thing is **continuous**: an anchor resolves by a ray from the centre rather than by snapping one coordinate to the nearest edge (which was discontinuous at every corner, and oscillated near the diagonal), and the four midpoint snaps *ease* across the outer half of their zone rather than teleporting — so a lap of a shape's outline moves the endpoint in sampling-step increments instead of a dozen leaps. Cached per shape, and every failure path falls back to the box point. |
| Connector ends | **Shipped** | Six markers per end (`connectorEnds.ts`), sized from the stroke and a user multiplier, with the geometry computed once and read by the renderer, the stored bounds and the panel specimens alike. Three things were wrong until 2026-08-19, all exposed by raising End size: the run was trimmed against its **final segment** only, so a curved route — sampled into 24 steps — was never trimmed at any size and an orthogonal one stopped being trimmed once the marker outgrew its last leg; the marker had **no ceiling**, so 400% on two adjacent boxes drew a head longer than the connector; and the stored box was computed from the route alone while an arrowhead extends **sideways** out of it, so a horizontal connector with a large head was culled with the head still on screen and marquee selection missed it. |
| Line profiles | **Shipped** | Straight, curved, wavy, zigzag and coil, as a *profile* on the existing line rather than five new kinds — a line and an arrow are already the same shape with different ends, and adding kinds would have multiplied that through the dock, the normalizer, the exporter and the swapper. Any profile composes with any pair of ends, weight, dash and sketch level, because none of those know it exists. `straight` returns its two endpoints untouched, so an ordinary line is bit-for-bit what it was. Pickable on the dock (the default for the next line) and on the rail and inspector (the one in front of you). The **coil** is a stamped template — one loop of four cubics plus a valley, translated by a fixed period — so uniformity is structural rather than eyeballed; it was derived four different ways first (shaped sine, phase-warped circle, prolate cycloid) and every one had the wrong character, because the mark is a mark and not the output of an equation. |
| Arrowhead alignment | **Shipped** | Illustrator's two modes. **At the end** puts the tip on the path's last point, so the head sits inside the line's length — right for a straight line. **Past the end** keeps the path at full length and projects the marker along the terminal tangent — right for anything with a shape to preserve, since a wave or zigzag trimmed by a head loses a crest or a corner at exactly the end being looked at. Absent means extend for a profiled line and inside for a straight one. `terminateRun` owns both modes and the tangent they share, and the canvas, the SVG exporter and the toolbar specimen all call it — a head placed by three separate pieces of arithmetic is three chances to disagree, which had already happened once. |
| Line label | **Shipped** | A fixed tag — small, semibold, upper case, on a plate — riding the midpoint of the *run*, not the centre of the box. It used to take size, family, weight, alignment, line height, list style and colour ramp from full typography, which is the machinery a paragraph uses; a line's label is a word or two saying what the edge means. Typography is hidden for lines in both surfaces. Ink is lifted against the **plate** rather than the board: the plate solves the line crossing the words and does nothing about the words themselves. |
| Nudge | **Shipped** | Arrow keys move the selection by one unit, ten with Shift, as a **single transaction** so a multi-object nudge is one press to undo. The step is in **world units, not screen pixels** — a nudge is an alignment gesture, and scaling it with zoom would make the same press mean different things at 40% and 400%. Locked objects are skipped rather than the press being refused. Arrows are claimed by four components (the board, the Layers tree, the minimap, the replay bar), all reaching the same window listener, so nudging applies only when focus is on the board itself. `engine/tools/nudge.ts`, pure and tested. **It was advertised on the help screen and bound nowhere until 2026-08-19.** |
| Hand / pan tool | **Shipped** | `HandTool`, plus space-drag. |
| Zoom / canvas scale | **Shipped** | Wheel and pinch through one non-passive native listener; the percentage readout lives in the radar panel. Covered by `CameraSystem.test.ts`. |

## 3. Creation and vector drawing

| Item | Status | Notes |
| --- | --- | --- |
| Pen tool | **Shipped** | `BezierPenTool`. Anchors placed with a drag get a forward handle; the backward handle mirrors it. |
| Pencil tool | **Shipped** | `PenTool` with `perfect-freehand`, which does the thinning and smoothing itself from `[x, y, pressure]` — the tool feeds it real pen pressure where the device reports it, and drops `thinning` to a near-constant width where it does not, so a mouse does not draw a line that pretends to have been pressed. Stores both the filled outline and the centreline the eraser splits on. This entry used to claim the points were "simplified through `utils/pathSimplifier.ts`": that module had no importers at all — a Douglas–Peucker pass nothing ever called — and was deleted rather than wired in, because `perfect-freehand`'s own smoothing is what actually shapes the stroke. |
| Shape tools | **Shipped** | Rect, ellipse, polygon, star, line and arrow. `polygon` is one kind with a side count clamped 3..60, not a kind per count — triangle, pentagon, hexagon and octagon are dock *presets* over it, which is what makes the count editable afterwards instead of frozen into the shape's identity. Line and arrow are the first shapes with no interior: they run corner to corner of the node box, so `width`/`height` stay the only record of bounds, and an arrowhead is a flag rather than a second kind. |
| Text tool | **Shipped** | `TextTool` + one shared `NodeEditor`, over a real layout engine (`engine/text/layout.ts`) rather than a single `Konva.Text`. Clicking an already-selected text object opens the editor **with the caret where you clicked** — resolved by binary search over measured prefixes, since the textarea never receives the click that created it. A **Text block** seat drops placeholder prose at 20/30/40/50/100 words: readable English rather than lorem ipsum, because the questions a placeholder has to answer (is this type size right, is this measure comfortable, does the box hold what I meant) cannot be answered against text nobody can read. |
| Eyedropper | **Partial** | Colour sampling from anywhere on screen, via the browser's own `EyeDropper`, offered beside the fill, each gradient stop, the stroke and the text colour — not as a dock tool, because an eyedropper answers a question a control has already asked rather than being a mode you enter. The button hides where the API is missing (Firefox, Safari), since a pipette that does nothing is worse than none. **Style and text-style sampling are not built**: those copy a whole appearance block, which is a different gesture with a different target. |
| Place image / media | **Partial** | Raster images and audio upload to MinIO, referenced by URL. **SVG is not imported as vector** (it would land as a raster `<img>`), and video is not supported at all. |

## 4. Vector and path manipulation

| Item | Status | Notes |
| --- | --- | --- |
| Anchor point | **Shipped** | Double-click a path to open it. Anchors can be picked, dragged, inserted anywhere along the outline and deleted. Insertion splits the curve with de Casteljau, so it is exact — the outline is pixel-identical before and after, which is the entire point: an insert that nudged the shape would make adding a point a destructive act. Every edit ends in `reframePath`, because path geometry is stored relative to the node origin and an edit that changed the extent would otherwise leave the selection box standing off the shape. |
| Bezier handles | **Shipped** | Handles on the picked anchor, dragging with the opposite one following — Alt breaks the pair. Corner/smooth/mirrored is **derived from where the handles are** rather than stored: two handles collinear with their anchor *are* smooth, and a flag claiming otherwise is a second source of truth that an import, an undo or another client can contradict. The editor works in an anchor-centric view (`toAnchors`/`fromAnchors`); the stored form stays segment-centric, which is what an SVG `d` string wants. A closed path can now round its final join, because `segments[0]`'s controls — previously declared, ignored and always undefined — are the closing curve's. |
| Join / cap styles | **Shipped** | `cap` shipped with the dash pattern in Phase 0; `join` and `miterLimit` now join it. Both store the default as *absent* — `miter` and 10 are what every existing stroke already draws, and they are also SVG's and Canvas2D's defaults, so an untouched stroke costs no bytes in the document and emits no attributes in the file. The control appears only on an object with a corner: not on an ellipse, not on a fully rounded rectangle, not on a line. |
| Boolean operations | **Shipped** | Union, subtract, intersect, exclude, on any mix of shapes and paths. `polygon-clipping` (Martinez) does the clipping; operands are flattened to polygons first at a quarter-unit tolerance. **Curves do not survive** — uniting two circles gives a few hundred straight segments that look identical and are obviously not curved once you open them in the editor. That is the deliberate trade: a curve-preserving boolean needs cubic-cubic intersection, an offset-curve fitter and a tolerance story for each, and the libraries that solve it want a canvas and a global scope. What is lost is editability, not fidelity. The topmost object leads, so `subtract` means something stable — selection order is whatever sequence the clicks happened in. |
| Compound paths | **Shipped** | `CompoundGeometry`: several closed contours filled as one, with the even-odd rule. The thing that makes a boolean useful — subtracting a disc from the middle of a square gives a square *with a hole*, and a hole is a second contour that no single run of anchors describes; cutting a bar across a disc gives two disjoint pieces and needs the same thing for the opposite reason. Not yet editable anchor by anchor. |
| Vector network | **Absent** | Paths are linear segment lists. Branching nodes would be a model change, not a feature. |
| Flatten | **Shipped** | Any primitive to an editable path: rounded rectangles as four arcs between four straight edges, ellipses as the four-cubic kappa approximation, polygons and stars as straight runs, a line as an *open* path because closing it would invent an interior it never had. The point is not the conversion but what it unlocks — a rectangle has a width and a corner radius, and no amount of anchor editing applies to it. |
| Outline stroke | **Shipped** | The stroke becomes a filled region. Built not by offsetting the path — an offset curve is not a curve of the same family, has to be refitted, and self-intersects on any concavity tighter than the stroke is wide — but by unioning a quad per segment, a join per corner and a cap per end. Every self-intersection is then something a union is *for*, and each part is simple enough to be obviously right. Miter, round and bevel joins all honour the limit, so an outlined stroke matches the stroke it replaced. An object with a fill keeps it and loses only its stroke; one without is replaced outright. |

## 5. Layout and structural logic

| Item | Status | Notes |
| --- | --- | --- |
| Layers panel | **Shipped** | Virtualized (`useVirtualRows`) — a DOM row per object is the most expensive consumer of document change at scale. Carries the tag filter. |
| Grouping | **Partial** | Foldable in the Layers panel, and right-clicking one member targets the whole group — which is what makes "copy this as Mermaid" answerable, since grouping is the only signal a person can give that a set of objects is one diagram. Still flat otherwise: a shared synthetic `parentId`, no nesting, no enter-group editing, no group bounds as a first-class object. |
| Lock / unlock | **Shipped** | |
| Visibility / hide | **Shipped** | `hidden` on the base node; renderer and Layers panel both gate on it, and there is deliberately no second `visible` field. |
| Auto layout / flexbox | **Dead** | `FrameNode.layout` declares `direction`, `padding` and `gap` in the schema. Nothing reads it, and no frame can be created in the first place. |
| Constraints / resizing rules | **Absent** | No pinning, stretching, hug or fill. Requires frames. |
| Absolute positioning | **Absent** | Only meaningful once auto-layout exists. |

## 6. Transform block

| Item | Status | Notes |
| --- | --- | --- |
| X / Y | **Shipped** | |
| W / H | **Shipped** | `width`/`height` on the base node are the only source of bounds — a load-bearing rule, see `schema.ts`. **Resizing a path was broken until 2026-08-18** and is worth recording, because it is the failure mode that rule invites: every other type *derives* what it draws from the box, but a path's shape is its `geometry`, drawn verbatim in node-local coordinates. Writing a new box and stopping left the outline at its old size while the layers panel, the radar, marquee selection and snapping all reported the new one — user-reported as "it looks stretched on the minimap but the same on the canvas". `fitPathToBox` now scales the geometry at commit. It *measures* the geometry rather than applying the drag's scale factor, so it is idempotent and repairs paths an earlier resize already left behind. Baked into the stored form rather than applied as a Konva scale because `PathEditor` draws its anchors at raw geometry coordinates and reads no scale — a renderer-side stretch would put the outline in one place and its handles in another. |
| Aspect ratio lock | **Shipped** | Lock toggle between the W and H steppers. |
| Rotation | **Shipped** | 15° steps in the panel; free from the transformer. Objects rotate about their centre. |
| Flip | **Shipped** | Horizontal and vertical, via `scaleX`/`scaleY` negation. |
| Skew / shear | **Shipped** | `skewX`/`skewY` on the base node, in **degrees**, about the centre — Illustrator's Shear Tool as a precise pair of numbers rather than a drag, since the transformer already owns the free-form gestures. Degrees rather than Konva's matrix coefficient, so a renderer's private convention cannot silently re-interpret every stored document; the `tan()` happens in one place. Kept off `geometry`, which makes it non-destructive and is what lets it apply to text and images and not just to vectors. The load-bearing part is `SceneGraph.getNodeBounds`, which now transforms the four corners rather than using the rotation-only closed form — a sheared rectangle is a parallelogram with no such form, and these bounds are what culling, marquee selection and export framing all read. |
| Corner radius | **Partial** | Rect and image only. No per-corner control, no squircle smoothing. |

## 7. Surface styling

| Item | Status | Notes |
| --- | --- | --- |
| Solid fill | **Shipped** | |
| Linear gradient | **Shipped** | Geometry is stored in **unit space** — a fraction of the node's own box — so a gradient survives a resize instead of stranding its last stop where the old edge was. Editable as an angle, because nobody types a pair of unit coordinates to tilt a fill by fifteen degrees. |
| Radial gradient | **Shipped** | Circular even in a wide box: Konva's radial gradient takes radii, not an ellipse, and faking one by scaling the shape would scale its stroke and its text with it. |
| Angular / conic gradient | **Shipped** | No native conic fill, so it is painted into an offscreen bitmap and used as a Konva pattern — `createConicGradient` where the browser has it, a fan of one-degree wedges where it does not. The bitmap is capped at 512px and stretched: these gradients are smooth by definition, and a full-resolution canvas for a 4000px shape is 64MB allocated on a drag. |
| Diamond gradient | **Shipped** | Nested rhombi filled largest-first, so no seam shows at the corners where a stroked version would leave gaps. Same pattern pipeline as conic. |
| Image / video fill | **Absent** | An image is its own node type; it cannot fill a vector shape. |
| Stroke weight | **Shipped** | |
| Stroke alignment | **Shipped** | Inside, centre, outside. Drawn at twice the weight and clipped to the half that should survive, which is exact: a centred stroke of `2w` puts exactly `w` on each side. Offsetting the path instead is a hard geometry problem that goes wrong at concave corners, which is every star. Shapes only — `supportsEdgeEffects`, because it needs an outline to clip to. |
| Dash pattern | **Shipped** | Solid / Dashed / Dotted, with the pattern derived from the stroke weight so it stays legible at any thickness. `Stroke.cap` was added and used in the same change, because a dotted line is `[0, gap]` and draws nothing at all under the default butt cap. A full pattern editor belongs with cap and join in Phase 4. |
| Layer opacity | **Shipped** | |
| Blend modes | **Shipped** | All sixteen. The stored names are Canvas2D's own `globalCompositeOperation` values, so the renderer forwards the string with no lookup table between the two to fall out of step. Applied to the whole node group, so an object's text label blends with its fill rather than separately from it. |
| Hand-drawn / sketch | **Shipped** | `Appearance.sketch`, **per object** rather than a board mode — a diagram that is mostly neat with two things circled by hand is the case it is for, and a document switch cannot say that. Three named hands, `light`/`medium`/`heavy`, which differ in *how the pen behaves* rather than in one amplitude: one confident pass, two passes, or two passes crossing well past every corner. A single roughness number was tried first and removed — scaling displacement is the one axis that cannot give three usable looks, because turning it up makes a shape read as broken rather than drawn. **Corners and curves are different constructions.** A shape with real corners is drawn edge by edge, each a bowed cubic that overshoots its vertex; a curve is one continuous spline through scattered samples, closing past where it began so the ends cross. Drawing a circle the first way — sixteen short chords each overshooting a corner that is not there — is what made it come out a broken spiky ring, and is the bug this construction exists to avoid. The interior takes one of three shadings — `solid`, `hachure` or `crosshatch` — offered only where a sketch level is set, because pen strokes inside a machine-ruled outline is a mixed metaphor. A solid fill paints the true silhouette rather than the sketch, since the drawn strokes are disjoint by design and filling them leaves bites out of the shape. Cross-hatch is two passes, and the second is deliberately not the first rotated: a different seed and a wider gap keep the two grids off each other, which is what separates a hand shading twice from a regular lattice that reads as a texture fill. Hachure runs at 41°, not 45°, because a shading angle that matches a rectangle's own diagonal reads as part of the shape instead of as marks laid over it. The scanline sorts its crossings and takes them in pairs, which is what makes a star work and not only a convex shape. **Seeded from the node id**, so the sketch is stable across renders, reloads, collaborators and exports — regenerating from fresh randomness makes the outline crawl on every re-render, which here is every selection, drag and presence update. `geometry` is untouched, so turning it off returns the exact rectangle. |

## 8. Lighting and blur effects

| Item | Status | Notes |
| --- | --- | --- |
| Drop shadow | **Shipped** | Colour, X/Y offset, blur, opacity and **spread** — on shapes, paths, images and text. This was **Dead** until 2026-08-11: on the schema since the first commit, read and written by the normalizer, declared by five types, rendered by nothing and offered by no control. Konva has no spread property, so spread is the same shape drawn once more underneath with a `2 * spread` stroke, which grows a silhouette by exactly `spread` whatever the path is. One shadow, not a list — several needs an effects list in the panel and one draw pass each. |
| Inner shadow | **Shipped** | Clip to the shape, then fill everything *except* it with the shadow on: the fill lands outside the clip and paints nothing, and only its shadow — which falls inward across the edge — survives. Its own field rather than a flag on `shadow`, because an object can want both. |
| Layer blur | **Shipped** | `useLayerFilters` owns the cache lifecycle, which is where every failure mode of this feature lives: never cache an unblurred node, pad the cache by three sigma so the blur is not clipped flat against the node's edge, follow the device pixel ratio so a blurred object is not softer than its neighbours for the wrong reason, and clear both cache and filter list on the way back to zero. |
| Background blur | **Shipped** | This audit called it the hardest item in the section and was **wrong**, for a structural reason worth keeping: Konva draws one layer in z-order, so when a node's `sceneFunc` runs the layer canvas already holds everything below it and nothing above — which is the definition of a backdrop. Sampling it is one `drawImage`, not a second pass over the document. Two limits: a browser with no Canvas2D `filter` draws nothing rather than an unblurred copy, and pairing it with a layer blur on the same object samples that object's own cache. |

## 9. Typographic engine

| Item | Status | Notes |
| --- | --- | --- |
| Font family and weight | **Shipped** | `FontSelector`. `fontWeight` and `italic`/`underline` are kept orthogonal and composed into Konva's `fontStyle` string in exactly one place. |
| Font size | **Shipped** | |
| Line height | **Shipped** | |
| Letter spacing | **Shipped** | |
| Kerning | **Absent** | Pair-level adjustment; needs font metrics access. Blocked on the same thing as OpenType features and paragraph spacing — see the note below the table. |
| Paragraph spacing | **Shipped** | `Typography.paragraphSpacing`, in world units, added between paragraphs only. This is what the text engine was built for: leading is a multiplier applied *within* a block of prose, and raising it to separate two paragraphs opens up every line inside them as well, so the two genuinely are separate fields. **The caveat this entry used to carry is now the known limitation:** a `<textarea>` cannot show a per-paragraph gap, so the spacing appears on commit rather than while typing. That is a real seam, and it is a smaller one than the feature not existing — the words do not reflow, only the gaps between blocks open up. |
| Text alignment | **Shipped** | Horizontal and vertical. |
| Text case | **Shipped** | Upper, lower and title, applied at render and **never to the stored string** — a control that rewrote the text would be destructive, since switching to upper case and back returns `HELLO` rather than `Hello`, and the editor would stop showing what was written. The DOM overlay gets the same effect from `text-transform`, which works on a `<textarea>`, so the words do not change shape the instant you stop typing. Title case follows CSS's `capitalize` rule rather than English title case: the browser gives the editor the former, the canvas has to match it, and a rule with a word list is wrong in every language that is not English. The SVG exporter bakes the case in, because `text-transform` in SVG is applied inconsistently and dropped by several converters. |
| Text decoration | **Shipped** | Underline and strikethrough, as two flags rather than one enum — Canvas2D, CSS and SVG all take a space-separated list and draw a run with both at once, so a single-valued field would have made them exclusive for no reason but its own shape. |
| OpenType features | **Absent** | Ligatures, fractions, tabular numbers, stylistic alternates. Canvas2D exposes `fontVariantCaps` and little else — this likely needs a different text rendering path. |

**The three items left in this section are one decision, not three.** Kerning
needs font metrics, OpenType needs a shaping engine, and paragraph spacing
needs an editor that can show what the renderer draws. All three are asking to
move text off Konva's `Text` and off the `<textarea>` overlay onto a real text
layout path. That is a large, invasive change and it should be made once, on
purpose, rather than three times by accident — so all three stay Absent with
the same reason recorded against them.
| Text box resizing | **Shipped** | The three-way control, as `TextResize`. Auto width gets no `width` at all and `wrap: none`, so the box is as wide as its longest line; auto height wraps and grows downward; fixed imposes both and truncates with an ellipsis rather than spilling glyphs outside the selection rectangle, where nothing can click them and no export accounts for them. The editor honours the same setting — an auto-height box no longer widens itself out of the layout it was wrapped for. This replaced `autoHeight`, which was the **tenth dead field**: declared, written by the normalizer and the text tool, and read by nothing. It could only express two of the three states, which is part of why nothing ever consumed it. `SCHEMA_VERSION` went to 3 so the migration actually removes it rather than the normalizer merely ignoring it. |

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
| Export scale (1x/2x/3x) | **Shipped** | Raster formats only — SVG and JSON have no pixels to multiply, and the filename only carries `@2x` where the density is real. The dialog shows the pixels it will produce and **says up front when the browser cannot honour the density asked for**: `fitScale` clamps against both the 8192px edge cap and the 16-megapixel *area* cap, the second of which the code had never enforced despite its own comment claiming it did — so a 4096x4096 board at 2x passed both edge checks at 67 megapixels and came back **blank** on Safari and every browser on iOS. A blank file that downloads successfully is the worst failure available. |
| PNG | **Shipped** | Reframes the stage onto the document bounds, captures, restores. Interface is hidden for the capture — the selection transformer, hover outline, crop overlay, force ring, tool preview, frame name labels and safe-area guides all carry an `export-chrome` name that `hideExportChrome` switches off and back on. Before that, exporting with anything selected baked the blue handles into the image. Omits audio players, which are DOM overlays. |
| SVG | **Shipped** | Serializes CRDT state to real vector primitives rather than rasterizing, with user text escaped. **Connectors were missing from the switch entirely until 2026-08-19** — every other type had a case and `connector` fell through, so a flowchart exported as boxes with no arrows between them: the diagram's whole meaning removed, silently. PNG never showed it because that path captures the stage rather than walking the document, which is exactly how a gap like this survives. The route is recomputed through the same `connectorPoints` the renderer uses, because a connector's geometry is derived and there is nothing stored to serialize. **End caps now export too** (2026-08-20). They had been declined on the reasoning that reproducing the renderer's per-cap inset would put every arrowhead slightly wrong — sound reasoning, wrong conclusion: `terminateRun` already takes a world-space run and returns the trimmed run plus both caps, and `openShapeMarkup` had been calling it that way for lines and arrows the whole time. There was nothing to reproduce, only a second caller to add, and the cost of the omission was the same one this row already describes one level down — an exported flowchart whose edges had no direction. **Text now goes through the same `layoutText` the canvas uses**, which fixed a bug that predated every text effect: the exporter split the stored string on `
`, but a wrapped text node's line breaks are chosen by the *renderer* and the document holds none of them — so every wrapped text node exported as one long line. Highlight, outline and glow all export too (the outline via SVG's own `paint-order="stroke"`, the glow via `feDropShadow`), as does a sketched shape, which is only possible because `roughShape` is seeded and shared with the renderer: the strokes in the file are *the same strokes*, not another draw from the same distribution. **Four defects were found and fixed on 2026-08-20, all of the same shape — a thing the file was supposed to contain and did not.** The worst: `SvgPaintDefs` collected a `<linearGradient>` for every gradient fill and handed back `fill="url(#vg0)"`, and its `markup()` — the method that writes those definitions out — **had no caller anywhere in the codebase**, so every gradient-filled object referenced a paint server that was not in the file. A dangling paint reference is not an SVG error: the file opened, validated and rendered, with those shapes simply unpainted. The other three: node `opacity` was never emitted, so a shape faded to 20 per cent exported opaque; `scaleX`/`scaleY` were never emitted, so every **flipped** object exported unflipped; and the `background` and `padding` options were ignored, so choosing White changed four formats out of five. Images are now **inlined as data URIs**, because an SVG carrying object-storage URLs is a picture only while that server is reachable by whoever opens it. Assembly moved to a pure `svgDocument.ts` that takes the paint collector and is obliged to drain it, so the omission cannot recur. |
| JSON | **Shipped** | Canonical node data plus comment threads — restored as well as exported since 2026-08-20: the exporter reached into `commentsMap` to include them, the importer validated them onto `ImportedDocument.comments`, and **the restorer read that field nowhere**, so every round trip silently dropped every thread. *Dead* in this document's own worst sense — written by one side, parsed by the other, consumed by neither. The envelope now also records `schemaVersion` beside the file-format `version`, which had read `1` since the first commit while the nodes inside it moved through three schema revisions. The format has been readable back since it shipped; it called itself "best for backups" while nothing could restore one, which is the kind of claim this document exists to catch. There is a validating parser, a single-transaction restorer, and a "rebuild a board from a backup" path on the rooms page; that last one matters, because the in-room restore is unreachable for someone who cleared their browser, which is exactly who needs it. |
| WebP / JPEG | **Shipped** | Six formats total, with a live preview, a size estimate and per-format settings derived from one `FORMAT_SPECS` table, plus batch export of every frame and copy-to-clipboard. |
| PDF | **Shipped** | Hand-rolled in `engine/export/pdfWriter.ts` — no dependency, because jsPDF and pdf-lib each cost 300-400KB. **A frame is a page**, which is the only honest answer to "what is a page size on an infinite canvas": a frame already declares 1920x1080 or A4, so it maps onto a page exactly and at true printed size, and a board of frames exports as one document of pages in board order. A board with no frames is one page cut to its content, because the content box is then the only finite rectangle the document has. Before 2026-08-20 it was always one page cut to content, so a sprawling board became a single 60-inch-wide "page", and batch export produced N separate single-page files rather than a document. Two things were also simply wrong: the page could exceed the **14,400pt (200in) limit** every reader enforces, which happens at about 19,200 world units — roughly twenty screens, an afternoon on a shared board — and there was no `/Info` dictionary, so every viewer listed the file as untitled with no producer and no date. The writer is pure and carries 28 tests, including one that walks every xref entry and checks the object actually begins at the byte the table claims. |
| EPS | **Absent** | |
| CSS / SVG code / Swift / Android XML | **Absent** | |
| Export selection vs. document | **Partial** | A **frame** can be exported on its own, at its own declared size, resolved once in the service so all three formats agree on what is in it. Exporting an arbitrary *selection* is still not offered, though `ExportOptions.selectedOnly` supports it. |

---

## 14b. Diagrams as code

| Item | Status | Notes |
| --- | --- | --- |
| Mermaid → objects | **Shipped** | Flowcharts (`flowchart` / `graph`) parsed into real shapes and connectors, never an SVG — a diagram you cannot drag a box out of is a screenshot with extra steps, and that is also why the `mermaid` package is not a dependency: it is over a megabyte and renders the one thing this must not produce. All eight bracket shapes, both edge-label syntaxes, dotted/thick/headless links, and `style`/`classDef`/`class` directives (direct beats class). Layout is layered Sugiyama — longest-path ranking with cycles broken by DFS first, because a retry loop is an ordinary thing for a flowchart to contain and ranking on its back edge pushes the decision below its own branches. |
| Objects → Mermaid | **Shipped** | Any selection, not only generated diagrams — a flowchart drawn box by box is where getting code out is worth the most. Offered from the right-click menu on a **group**, since grouping is the only signal a person can give that a set of objects is one diagram. Keys are re-derived rather than trusted, so a duplicated box cannot share an identifier. Where the selection also holds notes or images, the menu **says how many objects will be left out** rather than dropping them silently: Mermaid describes boxes and arrows, and no amount of trying changes that. |
| Other diagram types | **Absent** | Sequence, class, state and Gantt each have their own layout model and their own primitives — a lifeline is not a shape with a connector. Declined **by name** in the parse result rather than approximated, so the failure says which kind it was. |

## 15. The product around the canvas

Outside the original brief, which is an audit of a *design tool*. These are
shipped surfaces that a reader of this document would otherwise assume absent.

| Item | Status | Notes |
| --- | --- | --- |
| Templates / demo rooms | **Shipped** | 26 editable boards in five categories (`art`, `design`, `diagrams`, `physics`, `thinking`), built from typed `NewNodeInput` so a schema rename fails the build rather than producing broken rooms. Deliberate scale showcases at 100, 500 and 1000 objects. `build(limit)` exists because generating 1600 nodes to draw four thumbnails froze the page. |
| Board thumbnails | **Shipped** | The actual board, summarised into `localStorage` as you work and drawn as SVG: real positions, sizes, silhouettes, colours, rotation, text as ruled lines, frames as paper. Templates draw through the *same* component from the same `build()`, so a card cannot drift from the board it produces. Cached, therefore **versioned** — see `PREVIEW_VERSION`. |
| Physics | **Shipped** | A mode, not a toggle. Matter.js under `engine/physics/`, six forces with three latch durations and three falloff curves, selection scoping by collision category, and pinned bodies (`SimNode.locked`, distinct from Matter's `isStatic`, which this codebase also uses to mean "asleep"). |
| Rulers / grid visibility | **Shipped** | Toggles in the View menu. The ruler one is structural rather than cosmetic: the stage is inset by `RULER_SIZE` so screen coordinates and ruler marks agree, so hiding rulers moves the stage, the grid offset, the panel clearance and both insets from one flag. |
| Dot field | **Shipped** | A real world-space grid on `.canvas-container`, stepped by `tickStep` — the same function the rulers use — so the pitch holds between 20 and 40px across a 160x zoom range on round numbers. It was previously screen-fixed wallpaper that objects slid over and snapping did not describe. |
| Focus / zen mode | **Shipped** | Hides every panel, announced once at the moment they disappear because a mode reachable only by pressing backslash is folklore. |
| Sharing | **Partial** | The sheet is real: the link is rebuilt from the room id rather than echoed from `location.href`, a failed copy says so, and it states plainly that a link is full access permanently. **There are no permissions** — no roles, no view-only, no revocation. The sheet says this rather than implying otherwise. Session *creation* — a board made, named and shared for the first time — has not been built. |
| Guided walkthroughs | **Absent** | Agreed design: an arrow anchored to a real object that advances by *doing the thing*, launched against a matching template rather than an empty canvas. The templates exist to give these somewhere to happen. |
| Onboarding / product page | **Absent** | The canvas empty state and the rooms page are done; first-run and marketing surfaces are not. |
| Keyboard shortcuts & help | **Shipped** | A searchable reference — tools, navigation, selection, editing, type, the Layers panel, the minimap, replay, sticky notes — plus tips for the things that are not a keystroke. The tool rows are **derived** from `TOOL_SHORTCUTS`, the same map `Room` resolves keypresses through and the dock renders its badges from, so a tool's key and its badge cannot disagree. Everything below that section is hand-written, and **on 2026-08-19 four of those rows advertised keys nothing listened for** while roughly as many real bindings went undocumented; three of the four were bound rather than deleted. Opens with `?`, which the command palette had also been advertising with nothing behind it. |
| Design system | **Shipped** | `DESIGN.md` — two token layers, PRIMITIVES and SEMANTIC, with components referencing roles only. It exists because the same contrast bug (a raw palette primitive where the accent role belongs, giving ~2.15:1) shipped in five separate places. |

---

## The tally

Counted from the status column of sections 1-14, which hold 109 rows. These
counts are a second record of what the tables already say, so they drift: they
read ~66/~10/1/~26 for several sessions after the tables had moved past them.
Recount before quoting them.

- **Shipped: 72** — the canvas core, collaboration, frames, the whole paint model, the precision tools, the vector engine, and the parts of the transform/typography blocks that a whiteboard needs.
- **Partial: 8**
- **Dead: 1** — `FrameNode.layout`, the auto-layout declaration, which Phase 6 owns. `Appearance.shadow` was the second entry here until 2026-08-11.
- **Absent: 28** — design systems and prototyping. Vector manipulation left this list on 2026-08-12; **the export pipeline left it on 2026-08-18** — six formats with a live preview, a hand-rolled PDF writer, batch export of every frame, and a JSON export that can now actually be read back.

Section 15 is counted separately: it audits the product *around* the canvas
(templates, physics, thumbnails, sharing, the help screen, the design system),
which the original brief does not cover and which is where the last two
sessions went.

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
harness.

The crop overlay was the last piece never watched running, and it has now been
(2026-08-11): eight handles on a real image, the thirds guides, the cut-away
region shown at low opacity rather than hidden, a handle drag taking the node's
width from 300 to 212, and Escape putting it back to 300 and clearing the crop
outright — which is the behaviour undo cannot provide, because one drag is many
writes.

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

**Phase 1 — Frames and artboards. Done** (2026-08-11), apart from bleed, which
is scoped out above with its reason. The tool, presets, ownership, clipping,
move-and-delete-with-contents, capture-on-draw, per-frame export at 1×/2×/3×,
Layers nesting, editable background and safe zones have all shipped.

**Now watched running.** The earlier caveat — that none of this had been seen
work, because the canvas culls through a `requestAnimationFrame` loop that does
not fire in an automation tab — has been discharged. Confirmed by looking:

- The clip path is exactly right. A 120×120 shape dragged over a frame's right
  edge has its fill cut dead at the boundary while the transformer still
  reports the full box. That was the piece most likely to be silently wrong.
- The preset picker arms the tool; a click places the preset size, a drag sizes
  by hand.
- The Layers panel nests and folds correctly, icons on one line.
- The safe-area guide draws as a hairline dashed inset at every zoom.
- `hideExportChrome` removes the transformer and the frame label from the stage
  and puts them back.

Two things the browser found that reading had not:

- **Nothing created inside a frame joined it.** Membership was recomputed when
  an object stopped moving, and creation is a move that never happens — so a
  shape drawn in a frame, a pasted copy or a dropped image sat visibly inside
  it owning nothing, unclipped, and was left behind when the frame moved. Now
  decided in `createNode`, from the box rather than from the input.
- **Export was capturing the interface.** See §14.

**Phase 2 — The paint model. Done** (2026-08-11). All five fill kinds, all
sixteen blend modes, layer blur, backdrop blur, inner shadow, stroke alignment,
and the drop shadow — which turned out to be **Dead**, not Partial: on the
schema since the first commit, declared by five object types, rendered by
nothing, and with no control anywhere. That is the second dead field this phase
surfaced by simply trying to use what the schema claimed was there.

Two things this phase got wrong on the way in, both worth keeping:

- **Background blur was called the hardest item in the section.** It is one
  `drawImage`. Konva draws a single layer in z-order, so when a node paints,
  the layer canvas already *is* its backdrop. The estimate assumed a second
  render pass that the architecture makes unnecessary.
- **Inner shadow was thought to need a `source-atop` composite** and therefore
  a per-node bitmap. It needs a clip and an inverse fill, which is cheaper and
  has been the standard canvas construction for a decade.

The three effects that survived the phase all needed the same missing thing —
an outline the renderer can hand to `ctx.clip()` — which is why they arrived
together, and why `model/shapeOutline` now describes each shape once for the
renderer and the SVG exporter both.

One scope cut worth recording: **a single shadow, not a list.** Several at once
is genuinely useful, but it needs an effects list in the panel and one draw
pass per shadow, and that is a bigger change than making the field work at all.
**Join and miter limit** move to Phase 4, with the cap control.

**Phase 3 — Precision and selection. Mostly done** (2026-08-11). Smart guides
and snap-to-object, rulers and draggable guides, the eyedropper, and the
missing primitives — N-gon with a real side count, line, arrow — have shipped.

**Three items remain**, and two of them are blocked on the same thing:

- **Deep select** and **real nested groups**. Groups are flat: members share a
  synthetic `parentId`, there is no nesting, so there is nothing to select
  *into*. This is a model change, not a feature, and it is the same model
  change auto-layout needs — so it belongs with Phase 6 rather than here.
- **The scale tool.** Distinct from the transformer, which resizes geometry:
  a scale tool multiplies strokes, corner radii, shadows and type along with
  the box. Now that all four of those exist and are real, this is finally
  well-defined — it was not when the phase was written.
- **Layout grid overlays**, which want a per-frame grid definition and belong
  with the frame work rather than with selection.

One caveat carried forward: **none of Phase 3 has been watched running.** The
Chrome extension became unresponsive partway through and repeated attempts made
it worse, so the snapping, the guides and the new primitives are covered by
tests and by reading only. The guide *lines* and the ruler *ticks* are the two
pieces a test cannot speak for.

**Phase 4 — The vector engine. Done** (2026-08-12). Booleans, post-hoc anchor
and handle editing, outline stroke, flatten, and join/miter have all shipped,
along with the compound-path model the booleans needed to have anywhere to put
their results.

Three things are worth carrying forward from it:

- **Curves do not survive a boolean or an outline.** Both flatten first. The
  result looks right and edits as straight segments. Reversing that decision
  means a curve-intersection library, and the flattening happens at one call
  site so it stays reversible.
- **A compound path cannot be edited anchor by anchor.** The editor walks one
  run of anchors, and a compound path is several. Offering handles that did
  nothing would be worse than offering none, so it offers none.
- **Booleans decline on a rotated or scaled operand.** The geometry would have
  to go through the node's full transform first, which is correct and not
  done — so the buttons disappear rather than quietly producing a result that
  ignores the rotation.

The same caveat as Phase 3 applies and is not discharged: **none of Phase 4
has been watched running.** The arithmetic is covered — anchor editing,
flattening, all four booleans, the stroke outline including the miter limit -
but the anchors, handles and cursors on screen are what a test cannot speak
for.

**Phase 5 — The typographic engine. Mostly done** (2026-08-12). Text case,
strikethrough and the three-way box resizing have shipped. Vertical alignment
became real for text nodes on the way: it needs an imposed height to align
within, which no text node had until `fixed` existed.

**The decision this phase kept deferring has been made** (2026-08-18). The three
remaining items were recorded as "one decision rather than three" because each
was asking for the same thing: text off a single `Konva.Text` that draws the
whole string in one call and reports one box.

`engine/text/layout.ts` is that decision. Text is laid out first — wrapping,
tracking, leading, alignment, ellipsis — and drawn one line at a time, so the
per-line boxes exist for anything that needs them. It takes an injected
measurer, which keeps every rule in it runnable without a canvas; the Konva
probe that supplies real advances lives in `engine/text/measure.ts` alongside
the font-epoch invalidation, because a layout measured before a webfont arrives
wrapped against a fallback face and is wrong.

What that unlocked, and what it did not:

- **Paragraph spacing — shipped.** See §9.
- **The block effects — shipped**, and they were the immediate payoff: the
  rounded per-line highlight, an outline and a glow are all consumers of the
  same line boxes. See §7's text rows and `engine/text/highlight.ts`.
- **SVG export got correct for wrapped text**, which it had never been. See §14.
- **Kerning and OpenType are still Absent, and are now genuinely two items
  rather than part of a bundle.** Neither is blocked on architecture any more —
  the layout path exists and is where they would go. They are blocked on font
  data: kerning needs pair metrics and OpenType needs a shaping engine, and
  Canvas2D exposes neither. That is a dependency decision, not a design one.

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
4. ~~**Boolean operations** need a third-party path library.~~ **Decided**
   (2026-08-12): `polygon-clipping`, ~30KB, no canvas and no global scope, so
   it runs in a test. It clips polygons rather than curves, which is the
   trade-off recorded in the table above. A curve-preserving boolean remains
   available later — the operands are flattened at one call site.

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
