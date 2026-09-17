---
name: Vega Studio
description: A real-time collaborative infinite canvas — quiet neutral instrument, one warm brand voice.
colors:
  brand-orange: "#F3A024"
  brand-ink: "#161616"
  brand-paper: "#F7F7F7"
  burnt-amber: "#B45309"
  ink: "#111827"
  slate: "#4B5563"
  ash: "#6B7280"
  hairline: "#E5E7EB"
  paper: "#FFFFFF"
  canvas: "#F9FAFB"
  night: "#18181B"
  night-canvas: "#09090B"
  night-ink: "#FAFAFA"
  signal-online: "#10B981"
  signal-danger: "#EF4444"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  hand:
    fontFamily: "Caveat, cursive"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  xxl: "16px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "20px"
  s6: "24px"
  s8: "32px"
  s12: "48px"
components:
  button-primary:
    backgroundColor: "{colors.brand-orange}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "#D88F22"
    textColor: "{colors.brand-ink}"
  button-primary-disabled:
    backgroundColor: "#F3F4F6"
    textColor: "{colors.ash}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.slate}"
    rounded: "{rounded.lg}"
    padding: "9px 16px"
  chip:
    backgroundColor: "#F3F4F6"
    textColor: "{colors.ash}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "0 0 16px"
---

# Design System: Vega Studio

## Overview

**Creative North Star: "The Quiet Instrument"**

Vega Studio is a room you work *in*, not a page you look at. The board is the
product; everything else is instrumentation arranged around it, and the whole
system is built so that instrumentation can be ignored. Chrome is neutral,
hairline-bordered, and detached from the viewport edge, so the canvas reads as
a surface the tools rest on rather than a hole between panels. Panels are quiet
grey; the work is the only thing allowed to be colourful.

The brand appears rarely and always on purpose. One warm orange, sampled from
the logomark rather than chosen from a palette, marks exactly two kinds of
moment: the single primary action on a screen, and the state that is currently
armed. Focus is **not** one of them — see the focus rule below. It never decorates, never appears twice
on one control, and never takes a job a neutral could do. Its scarcity is what
makes it read as identity rather than as theming.

Density is high and deliberate. Sessions are long and mixed-mode — reading,
thinking and panel work interleave with direct manipulation — so type runs
small (13px body), controls come in exactly three heights, and hierarchy is
carried by weight and spacing rather than by size jumps. The system is
theme-native: every surface, border, text and shadow role has a dark-mode
value, and the theme follows the OS until the user overrides it.

**Key Characteristics:**

- Neutral chrome, coloured work — the canvas is the only saturated thing.
- One accent, three legible expressions, rationed hard.
- Hairline borders and low, wide shadows; elevation declared once per surface.
- Exactly three control heights (28 / 32 / 38px); padding derives from height.
- Motion decelerates and never rebounds — one exponential ease-out everywhere.
- WCAG AA is a committed floor in both themes, not a target.

## Colors

A neutral system carrying one warm identity: greys do the structural work, and
a single sampled orange does all the signalling.

### Primary

- **Vega Orange** (`#F3A024`): the identity ground. Sampled from the logomark
  artwork rather than approximated, so the accent in the interface and the
  accent in the mark are the same colour. Used as a *fill* — the primary
  button, the armed tint, the mark itself — and never as a foreground on an app
  surface, where it measures 2.13:1 on white and fails outright.
- **Brand Ink** (`#161616`): the only foreground permitted on Vega Orange
  (8.50:1). White on the orange is 2.13:1, and is the single most common way an
  orange button goes wrong.
- **Burnt Amber** (`#B45309`): the accent *as a foreground* on light surfaces —
  accent text, armed icons, indicator dots (5.02:1). On dark
  surfaces this role flips to Vega Orange itself (8.32:1), because legibility is
  a fact about the background, not about the brand.

### Neutral

- **Ink** (`#111827`) / **Night Ink** (`#FAFAFA`): primary text. 16.9:1 light,
  17:1 dark.
- **Slate** (`#4B5563`): secondary text, 7.6:1. The step that carries most of
  the interface's hierarchy.
- **Ash** (`#6B7280`): tertiary text and chip labels, 4.9:1 — the quietest text
  role that still clears AA.
- **Hairline** (`#E5E7EB`, `rgba(255,255,255,0.12)` on dark): every divider and
  card edge. Borders are always 1px; there is no heavier rule.
- **Paper** (`#FFFFFF`) / **Night** (`#18181B`): panels, cards, dialogs.
- **Canvas** (`#F9FAFB`) / **Night Canvas** (`#09090B`): the board itself and
  the page behind the chrome, always one step back from Paper.

### Tertiary

Six force hues (pull, push, drop, wind, shock, swirl) and three status colours
exist as their own semantic families. They are **not** accents and must never be
borrowed for emphasis: each answers exactly one question on the canvas, and
reusing one in the chrome breaks the only channel that answers it.

### Named Rules

**The Two-Halves Rule.** The accent is a pair, never a colour. Fill with
`--accent` and write on it with `--accent-on`. Put the accent *on* a surface
with `--text-accent`. There is no fourth way, and choosing your own foreground
for an accent fill is always a contrast bug.

**The One Front Door Rule.** A screen gets one accent-filled control. If two
things on a screen are orange, neither is primary and the accent has become
decoration.

**The Identity Does Not Flip Rule.** `--accent` and `--accent-on` are identical
in both themes — a mark that changed colour with the theme would not be a mark.
Only the foreground role and the tints move, because those are about legibility
rather than identity.

## Typography

**Display / Body Font:** Inter Variable, self-hosted (`system-ui` fallback)
**Accent Font:** Caveat, for handwritten annotation on the canvas only
**Mono:** `ui-monospace, SFMono-Regular, Menlo` — for coordinates and
measurements, never as a texture for "technical"

**Character:** One family doing everything, tuned by weight and tracking rather
than by mixing faces. Inter is chosen for the reason a drafting tool chooses a
grotesque: legible at 10px in a panel, neutral enough to sit beside arbitrary
user content without competing, and carrying a variable weight axis so
hierarchy costs no extra network request.

### Hierarchy

- **Display** (650, 30px, 1.1, -0.035em): page titles. One per screen.
- **Headline** (600, 24px, 1.15, -0.02em): section headings. "Your boards" and
  the templates heading are siblings and are set identically.
- **Title** (600, 16px, 1.3): card names, panel headers, dialog titles.
- **Body** (400, 13px, 1.55): the default. Prose is held to roughly 46–62ch; a
  one-sentence lede allowed to fill 1180px reads as a banner, not a subtitle.
- **Label** (500, 11px): chips, badges, meta rows, counts. Section headers in
  the inspector are this role at 600 — **sentence case, not uppercase**. See
  the rule below.
- **Data** (400, 12px, mono): values inside a control — the number in a
  stepper, a coordinate, a duration. Always `tabular-nums`.
- **Micro** (600, 10px): the axis letter on a stepper, a unit suffix, an id
  chip. The smallest role, and the only one allowed below Label. It exists for
  text that is *attached to* a control and never read on its own; anything a
  person has to read as a sentence is Label or larger.

Two of these — Data and Micro — went undocumented for a long time while
`--text-sm` and `--text-2xs` were used dozens of times in the code. That gap is
what made every literal `12px` and `10px` in a component look like drift when
it was the system working as intended. **The scale in `index.css` is the
authority; this list describes it.** If a step is used, it is documented here,
and a size that is on neither is the actual defect.

Tracking tightens as size grows and is **never applied below 16px**. That rule
is why inspector section headers are sentence case: an 11px uppercase run needs
tracking to be legible at all, so an uppercase micro-header cannot obey the
rule and be readable at the same time. Sentence case needs no tracking, reads
quieter in a dense panel, and is what both Figma and the Apple inspectors
settled on. Numerals that change in place — counts, coordinates, timers —
always take `font-variant-numeric: tabular-nums` so they do not jiggle.

### Named Rules

**The No Eyebrow Rule.** Nothing sits above a heading. An uppercase kicker
labels the heading instead of saying anything the heading does not, and one
shipped here as small brand-orange text at 2.04:1 on the product's first
screen. A heading that needs a label above it has not been written yet.

## Layout

A single 1180px centred column on the dashboard; the editor is full-bleed with
floating chrome. Floating chrome is **detached** from the viewport edge by one
shared inset (`--shell-inset: 28px`, set by the 22px ruler it must clear), so
every floating element aligns with every other without per-component magic
numbers.

Grids fill by `auto-fill` / `auto-fit` at a minimum column width rather than
snapping at breakpoints — four template cards across a desktop, two on a tablet,
one on a phone, with no media query making the decision. Media queries are
reserved for genuine changes of behaviour: 1024px turns side panels into
overlays, 768px sheds header labels and goes touch-first.

Spacing is a 4px scale. Groups are tight (4–8px), sections are generous
(24–32px), and a heading always carries more space above it than below.

## Elevation & Depth

Hybrid, and **declared once per surface**. A surface takes a hairline border or
a shadow — never both, which is how every dashboard card once carried a border
*and* a shadow and then animated all three properties at once on hover. Panels
and dialogs use shadow; cards, chips and inputs use the hairline.

Shadows are low and wide, always with an offset and a soft blur; a zero-offset
coloured halo is decoration, not depth. Dark mode deepens every step rather than
reusing the light values, which read as nothing against near-black.

### Shadow Vocabulary

- **sm** (`0 1px 2px rgba(0,0,0,0.05)`): resting buttons.
- **md** (`0 4px 12px -4px rgba(0,0,0,0.08)`): a card lifting on hover.
- **lg** (`0 12px 24px -8px rgba(0,0,0,0.12)`): menus and popovers.
- **float** (`0 12px 32px -12px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)`):
  panels and every piece of floating canvas chrome.
- **overlay** (`0 24px 64px -16px rgba(0,0,0,0.24)`): modal dialogs.

### Named Rules

**The Declare Elevation Once Rule.** Border or shadow, not both. If a surface
should feel raised on hover, change the shadow — do not add a border it did not
have at rest.

## Shapes

Radii are tight and scale with the element: 4px on the smallest chrome, 8px on
buttons and inputs, 12px on cards and floating panels, 16px on dialogs, and a
full pill on chips, tabs and badges. Nothing is a circle except avatars, status
dots and reaction bubbles.

**Pinned surfaces take 8px, not 12.** The 12px step is for small floating
lozenges over the board. The Layers panel, the Properties panel and the radar
are not that: they are anchored to the window's edges and stacked on shared
rails, and at 12 the curve reads as a rounded card that happens to be very
tall. They share `--panel-radius`, scoped rather than folded into
`--dock-radius`, because nine other surfaces use that token and none of them
wants this. A collapsed rail *is* a small lozenge and keeps the 12.

Borders are 1px, always. A coloured left border above 1px on a card or callout
is not part of this system. The dot grid on the canvas — and on the empty region
of every board thumbnail — is the one repeating texture, and it is what makes a
preview read as *a board* rather than as an illustration.

## Components

### Buttons

- **Shape:** gently rounded (8px, `--radius-lg`), one of three heights
  (28 / 32 / 38px), with padding derived from the height rather than authored.
- **Primary:** Vega Orange ground, Brand Ink label, `--shadow-sm`. One per
  screen. Hover darkens toward the ink (`--accent-hover`) rather than fading
  with `opacity` — fading a coloured button washes it toward the page behind it,
  so the brand gets weaker exactly as the control is being used.
- **Ghost / Secondary:** transparent with a hairline, Slate label. The quieter
  of two front doors; rarer actions live here.
- **Disabled:** a neutral fill, never a dimmed accent. A faded orange still
  reads as the brand asking to be pressed.
- **Icon buttons:** square, transparent at rest, `--surface-hover` on hover.

### Chips

- **Style:** pill, `--surface-secondary` ground, Ash label at 11px/500.
- **Counts:** inked ground with the surface colour reversed out, tabular
  numerals. Used where the number is the claim the card exists to make.
- Chips are **capped, not wrapped**. A fourth chip spilling onto a second line
  gives a row of cards ragged, uneven feet, and it was never the reason anyone
  chose the card.

### Cards / Containers

- **Corner:** 12px. **Border:** 1px hairline. **Shadow:** none at rest,
  `--shadow-md` on hover with a 2px lift on the shared exponential settle.
- **Artwork** runs to the card's own edge — no inset, no padding above it — on a
  fixed aspect ratio, so a row of cards shares one text baseline.
- Internal padding is 16px. Nested cards are not part of this system.

### Inputs / Fields

- **Style:** Paper ground, 1px hairline, 8px radius, 12–14px padding.
- **Hover:** border steps to `--border-strong`.
- **Focus:** the global ring, never a hand-rolled one. Inputs take a 2px inset
  outline; everything else takes the offset two-ring treatment. The ring is
  drawn at the field's **resting** radius — a control that changes shape when
  you click into it is describing a box that is not there.
- **Never** set `outline: none` inline. An inline declaration outranks every
  selector in the stylesheet, so it makes the app's focus ring unreachable —
  which is exactly what hid focus on the first field of the first screen.

### Number fields

Dense, repeated, and the most common control in the Properties panel, so they
get their own rules.

- **A bare number, no arrows.** A `−` and a `+` beside every field is two
  controls per row and a dozen rows; each pair only restates what the field
  already implies. The keyboard does the job better and always did:
  `↑`/`↓` step by one, `←`/`→` do the same on a horizontal field, and `Shift`
  takes ten — which is what lets the keys carry the whole job, since without it
  a hundred-unit change is a hundred presses. The affordance lives in a
  one-line `title`, because arrow-key stepping is a convention rather than a
  certainty.
- **Left-aligned, at `--radius-sm`.** Centring was right while a button sat on
  each side and the number was the middle of three things; with them gone the
  number *is* the field, and a column of left-aligned figures scans as a
  column. At 6px a 26px box reads as a pill — the arrows used to fill the ends
  and hide that.
- **A field takes its column.** This is the load-bearing rule. A field with no
  width of its own is sized by whatever contains it, which across one 260px
  panel produced 31px in a flex row and 95.5px in a grid cell for the same
  control — five widths and five left edges, and the narrow ones fit `2` but
  not `100`. Containers choose columns deliberately; fields agree with them
  (`flex: 1; min-width: 0`) and nothing carries a hand-picked width.
- **A unit sits inside the field's padding, not beside it.** `100 %` is one
  reading. Giving the number and the unit each their own right padding pushed
  the unit outward and made a field with a suffix measurably wider than its
  neighbours.

### Type controls

- **A weight list shows only the weights the face has.** Anything else is
  synthesised — the browser thickens or thins the outlines, and the result
  renders, looks like type, and is not the typeface. The same rule governs
  italic: a family without a drawn one gets a shear, and the control says so
  rather than implying otherwise.
- **Dense numeric rows drop the label column.** An 84px label is right where a
  control's job is not visible from its own shape. It is waste beside a field
  reading `16 px`, which is a label restating its own value — those fields
  carry a glyph and pair two to a row instead.
- **Two numbers you compare go on one line.** Leading is read against tracking,
  size against weight. Separate rows make related settings look unrelated.
- **A ratio is stored; a distance is shown.** Leading is a multiplier, because
  that survives a size change — and `1.2` means nothing without the size beside
  it, so the pixel value is shown next to the field.
- **Every numeric field carries its unit**, in a panel where the next row down
  may be a multiplier.

### Pickers

- **A control beats a longer catalogue.** Where half the entries would be
  another entry transformed — a size on its side, a colour at another weight —
  one toggle buys the same information and leaves the list readable.
- **A toggle must be its own inverse.** Pressing it twice returns exactly what
  you started with. An operation that is *nearly* right — a rotation where a
  transpose is meant — drifts a little on every press and is only visible after
  two.
- **Width buys columns, not room.** A wider single column of twenty rows is
  twenty rows. If a list is long because it has groups, the groups are the
  columns.
- **Show the shape where the shape is the choice.** A size, an aspect ratio, a
  weight, a dash pattern: all are scanned by proportion far faster than read by
  numbers. Fit the specimen to a fixed box — the ratio is the information, the
  absolute size is not.

### Tables and sheets

- **Content is light; chrome follows the theme.** A table's cells are content,
  so they stay light on a dark board, and so does anything that pictures them —
  gallery thumbnails sit on fixed light paper. The editing chrome around them
  (gutters, toolbar, menus) takes the theme's tokens.
- **Selection is ink.** A range is a quiet ink wash with a crisp ink border on
  the focused cell — never the accent, which would read as a state that is on.
- **Chrome holds its screen size.** Anything drawn *around* content that the
  camera scales — column letters, row numbers, resize handles — is sized in
  screen pixels, and toolbars are placed against the far side of it, not
  against the content's edge.
- **What overlays the board stays under the app.** An editor laid over an
  object is part of the board, so it takes `--z-canvas-overlay` and the
  panels, dock and radar cover it as they cover the canvas. Its own chrome
  keeps inside the free area between the panels rather than climbing over
  them; only menus and dialogs rise above.
- **One editing surface at a time.** While a table's cells are open, the
  object's own contextual rail stands down; two toolbars for one object is two
  answers to "where do I click".
- **Show the thing itself.** An example is drawn by the same painter as the
  board, so a card cannot promise a merge, a tint or a column the table does
  not have.
- **Affordances wait for the pointer.** The insert dots on every boundary are
  faint and appear only while the pointer is over the table; the one under it
  opens into a `+` and draws where the row or column will go. Twenty always-on
  buttons would be louder than the content they sit around.
- **A formula is code.** It is set in `--font-mono` while written, and the
  cells it reads are outlined in a fixed sequence of reference colours — the
  spreadsheet convention, kept so nothing has to be learned.

### The tool dock

The main toolbar, bottom-centre. It answers one question — what is in my hand
— and everything below serves that answer.

- **One marker, handed from seat to seat.** The armed tool is shown by a single
  ink marker that travels to its seat on the shared exponential settle
  (`PUCK_GLIDE`, 320ms). It is the dock's one authored motion, and it is there
  because a keyboard switch happens without anyone looking at the dock: a
  marker that moves shows where the tool went, where a fill that switches off
  in one place and on in another has to be found. Reduced motion places it.
- **The marker has three states, and each is a shape, not a colour.** Filled
  for armed. Hollow for *held* on its key, which ends when the key comes up.
  A padlock on the right shoulder for *kept*, which ends when anything else is
  armed. The left shoulder is edit mode's remove badge and the bottom-right is
  the menu dot, so the corners never overlap.
- **Arm here, adjust there — and "here" stays up.** A shelf rises above the
  dock, centred on it, while a tool that has next-gesture decisions is armed: a
  note's colour, the pencil's nib and size, the pen's weight, the eraser's
  size, a line's head, path and profile, a recent few shapes. Decisions about
  the *next* mark go on the shelf; behaviour set once (smoothing, keep
  selected) stays in the seat's flyout; the object's own properties stay on the
  panel and the rail. The shelf stands down while any flyout is open or the
  dock is being edited — two panels over one dock is two answers to "where do
  I click".
- **Anything above the dock is placed from `--dock-h`.** Coaches, notices and
  banners already were; the shelf raises the value while it is up, so they
  clear it without knowing it exists. A new surface in that band takes its
  `bottom` from the token, never from a number.
- **A tool stays in hand by choice, never by default.** Placing tools hand the
  board back to Select after one object. `Q`, or a double-click on the armed
  seat, keeps the tool. The lock belongs to the *seat* — changing from a
  rectangle to a diamond, or from A4 to a slide, keeps it — and ends when
  another seat is armed. Holding a tool key for 300ms makes it temporary:
  let go and the previous tool returns. A tap is exactly what it always was.
- **A seat with choices: click arms, resting opens small.** Shape, Frame, Grid,
  Chart and Table each wear the choice they will make — the last shape, size,
  system, chart or table — and a click arms exactly that. Resting on the seat
  opens a single row: a fixed few choices (never recents, which reshuffle under
  the pointer; the current choice takes the last slot if it is not among them),
  then More, then the padlock. More grows the full sheet *upward* from the row
  at the same width, so nothing under the pointer moves. The padlock on a seat
  that is not armed arms it and keeps it in one click. These seats put nothing
  on the shelf — that would be the same row twice. Touch opens the menu by
  tapping the armed seat; the keyboard, by Up on the seat.
- **One sheet for choosing a kind** (`DockSheet`). Sections on one scroll, never
  tabs; each choice once. Icon tiles where the picture is the identity
  (shapes), captioned cards where the name is needed too (grids, charts,
  tables). One line of words at the foot for whatever is under the pointer or
  the keyboard. A searchable sheet holds a fixed height so a search never
  resizes the panel under the pointer. Frame keeps its three columns, because
  its groups *are* its columns.
- **Drag off the dock only what needs no size.** A note can be pulled off its
  seat onto the board, because a note's size is not a decision. A shape would
  still need a size and a preset, which is the drag the tool already is.
- **The current choice on the shelf is neutral; kept armed is accent.** The ink
  marker below already says which tool is armed, so a raised tint marks a
  selected swatch or tile. The padlock pressed is a state that is on, which is
  what the accent is for.

### Navigation

Category filters are pill tabs carrying a count, filtering in place rather than
navigating — switching must not discard scroll position or anything typed. The
selected tab takes an inked ground, not the accent: it is a filter, not the
page's primary action, and two orange "on" states in one viewport cancel each
other out.

### Signature Component: the board thumbnail

Every board and every template is drawn from the same summary structure through
the same component, so a card's picture is always the board it opens. Objects
keep their real positions, silhouettes and colours; text is drawn as **ruled
lines** rather than as filled boxes, because a text node's fill is its ink and
painting it normally produces a solid black slab; connectors draw their route
rather than their bounding box. The remaining space carries the canvas dot grid.

Generated boards must keep **constant extent** when their node count is trimmed
for a thumbnail. Trimming the count alone shrinks the composition, and the card
then shows a picture that appears nowhere except on the card.

## Do's and Don'ts

### Do:

- **Do** fill with `--accent` and write on it with `--accent-on`; put the accent
  on a surface with `--text-accent`. Nothing else.
- **Do** give a screen exactly one accent-filled control.
- **Do** derive control padding from one of the three heights.
- **Do** declare elevation once — border or shadow, never both.
- **Do** let the global `:focus-visible` ring do the work, and keep it
  **neutral**. It was accent coloured and billed as the most repeated branded
  moment in the product; the owner overruled that on 2026-09-15 — an amber ring
  on every search box and field reads as a warning, not as "you are here". Use
  `--focus-ring-color` (graphite) for the keyboard ring and
  `--focus-field-color` (a quieter tone, 1.5px) for text fields, which take
  focus on every click. Never paint focus with `--accent`, `--text-accent` or
  `--accent-line`; the accent stays for armed and selected *states*.
- **Do** re-declare a theme-dependent token in `.dark-theme` rather than
  aliasing it on `:root`. Custom properties substitute against the element they
  are *declared* on, so an alias silently freezes the light-mode value.
- **Do** hold WCAG AA in both themes and treat a regression as a bug.

### Don't:

- **Don't** put white text on the brand orange (2.13:1), or the brand orange on
  a light surface as text or as an icon (2.13:1).
- **Don't** tint the brand orange to make a state indicator on light: no tint of
  it can reach 3:1, because the pure colour does not.
- **Don't** put an eyebrow, kicker or uppercase label above a heading.
- **Don't** fade a coloured button with `opacity` on hover — darken it.
- **Don't** reach for a primitive (`--gray-500`, `--amber-500`) from a
  component. Components reference semantic roles only.
- **Don't** borrow a force hue or a status colour for emphasis.
- **Don't** nest cards, or give a card both a border and a shadow.
- **Don't** write `outline: none` in an inline style.
