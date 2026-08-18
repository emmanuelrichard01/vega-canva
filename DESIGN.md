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
the logomark rather than chosen from a palette, marks exactly three kinds of
moment: the single primary action on a screen, the state that is currently
armed, and wherever keyboard focus is. It never decorates, never appears twice
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
  accent text, armed icons, indicator dots, the focus ring (5.02:1). On dark
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
- **Label** (500, 11px): chips, badges, meta rows, counts.

Tracking tightens as size grows and is never applied below 16px. Numerals that
change in place — counts, coordinates, timers — always take
`font-variant-numeric: tabular-nums` so they do not jiggle.

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
  outline; everything else takes the offset two-ring treatment.
- **Never** set `outline: none` inline. An inline declaration outranks every
  selector in the stylesheet, so it makes the app's focus ring unreachable —
  which is exactly what hid focus on the first field of the first screen.

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
- **Do** let the global `:focus-visible` ring do the work; it is accent coloured
  and it is the most repeated branded moment in the product.
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
