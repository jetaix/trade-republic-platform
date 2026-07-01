---
name: Trade Republic API & MCP
description: Talk to your portfolio — the landing + connect experience for an unofficial, read-only Trade Republic integration.
colors:
  tr-red: "#ff4034"
  tr-red-ink: "#ff5a4f"
  tr-red-cta: "#d92d22"
  tr-red-cta-hover: "#c4261c"
  tr-red-deep: "#e5352a"
  bg: "#0b0b0d"
  bg-2: "#0e0f12"
  panel: "#141518"
  panel-2: "#191b1f"
  panel-3: "#1e2126"
  sunken: "#08090b"
  text: "#f4f5f7"
  muted: "#a6acb8"
  muted-2: "#7f8593"
  line: "#23262d"
  line-2: "#2c3038"
  positive: "#55e08a"
  negative: "#ff6b6b"
typography:
  display:
    fontFamily: "TR Sans Display, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(2.8rem, 7vw, 5.3rem)"
    fontWeight: 740
    lineHeight: 1.02
    letterSpacing: "-0.038em"
  headline:
    fontFamily: "TR Sans Display, sans-serif"
    fontSize: "clamp(2rem, 4.4vw, 3.3rem)"
    fontWeight: 740
    lineHeight: 1.02
    letterSpacing: "-0.038em"
  title:
    fontFamily: "TR Sans Display, sans-serif"
    fontSize: "1.32rem"
    fontWeight: 680
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  body:
    fontFamily: "TR Sans Display, sans-serif"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "-0.011em"
  label:
    fontFamily: "TR Sans Display, sans-serif"
    fontSize: "12.5px"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "0.02em"
  mono:
    fontFamily: "SFMono-Regular, ui-monospace, SF Mono, Menlo, Cascadia Code, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
rounded:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "22px"
  xl: "28px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "28px"
  section: "118px"
components:
  button-solid:
    backgroundColor: "{colors.text}"
    textColor: "{colors.bg}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "11px 19px"
  button-red:
    backgroundColor: "{colors.tr-red-cta}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "11px 19px"
  button-red-hover:
    backgroundColor: "{colors.tr-red-cta-hover}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "11px 19px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "11px 19px"
  instrument:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
    padding: "0"
  tile:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "26px"
  result-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "13px"
    padding: "12px 14px"
  result-row-selected:
    backgroundColor: "rgba(255,64,52,0.10)"
    textColor: "{colors.text}"
    rounded: "13px"
    padding: "12px 14px"
  prompt-chip:
    backgroundColor: "{colors.panel-3}"
    textColor: "{colors.text}"
    rounded: "{rounded.xs}"
    padding: "5px 11px"
---

# Design System: Trade Republic API & MCP

## 1. Overview

**Creative North Star: "The Conversational Ledger"**

This is the landing and connect experience for an unofficial, read-only tool that
lets an AI agent read a portfolio. The whole design exists to make one idea land:
*you talk, your account answers.* It is **dark-native** — an ink surface
(`#0b0b0d`) lit from above by a single Trade Republic red glow, with a fine film of
grain over everything. The centerpiece is a luminous **command instrument**: a
Raycast-style palette where you type or arrow through plain-English questions and
watch real balances, positions and deltas stream back. Warmth lives in the answer,
the motion and the light — never in decoration.

The system borrows Trade Republic's visual DNA (the red, the display type, the
near-black ink) and wears it with restraint, so it reads as *native to the
ecosystem* without ever impersonating the official product. It is one continuous
world across four surfaces — the marketing landing, the browser **connect/auth**
flow, the **Scalar API reference**, and the **markdown guide** — all sharing the
same ink, the same red, the same TR Sans, the same red-glow atmosphere. A visitor
should never feel a seam between "reading about it" and "connecting it."

It explicitly rejects three things. It is **not** a generic SaaS landing page:
no hero-metric block, no wall of identical icon cards, no gradient text, no
tracked-uppercase eyebrow on every section. It is **not** a corporate bank: no
navy-and-gold gravitas, no stock photography, no legalese. And it is **not** a
Trade Republic clone: the "unofficial / not affiliated" line stays legible and the
brand cues are quoted, never counterfeited.

**Key Characteristics:**
- Dark-native ink surface, lit by one Trade Republic red glow + fine grain.
- One variable display typeface (TR Sans Display) carrying the whole hierarchy through weight (500→740).
- An interactive, keyboard-driven command instrument as the signature moment.
- Motion that clarifies, never bounces — exponential ease-out, buttery Lenis scroll, honored `prefers-reduced-motion`.
- Financial numerics always tabular; green/red reserved strictly for gains/losses.

## 2. Colors

A near-monochrome ink system — a five-step dark ramp — punctuated by a single hot red and a functional gain/loss pair.

### Primary
- **Trade Republic Red** (`#ff4034`): The one luminous accent. Used sparingly for light-bearing roles — the hero glow, the "portfolio" swipe underline, the pulsing live dot, selected-state tints, positive deltas, icon accents. Red-on-dark text (e.g. the display underline) clears AA comfortably (~5.5:1). Its lighter sibling **Red Ink** (`#ff5a4f`) is for accent hover, links on dark, and focus rings.
- **Trade Republic Red (CTA)** (`#d92d22`, hover `#c4261c`): A one-notch-deeper red used **only for button fills that carry white text**, where the luminous `#ff4034` would fail contrast. Hits 4.83:1 with white; hover deepens (stays AA). The vivid `#ff4034` stays reserved for glow and accents so the identity is preserved in the atmosphere.

### Neutral — the ink ramp
- **BG** (`#0b0b0d`): The base surface. Everything sits on ink.
- **BG-2 / Panel / Panel-2 / Panel-3** (`#0e0f12` → `#141518` → `#191b1f` → `#1e2126`): Tonal layering. Depth on dark is expressed by stepping up this ramp, not by scattering shadows.
- **Sunken** (`#08090b`): Recessed wells — data cards, code blocks, the command results tray.
- **Text** (`#f4f5f7`): Primary copy (~18:1 on BG).
- **Muted** (`#a6acb8`) / **Muted Soft** (`#7f8593`): Secondary and tertiary text. **Muted** for body-length copy (≥8:1); **Muted Soft** for dim labels/metadata only (≥4.9:1 — still AA).
- **Line / Line-2** (`#23262d` / `#2c3038`): Hairline borders and dividers.

### Tertiary — Financial signal
- **Positive** (`#55e08a`): Gains only.
- **Negative** (`#ff6b6b`): Losses only.

### Named Rules
**The One Red Rule.** Trade Republic Red touches ≤10% of any screen. It is a signal and a light source, not a theme.

**The Two-Reds Rule.** The luminous `#ff4034` is for light (glow, underline, dots, accents, red-on-dark text). The deeper `#d92d22` is for button fills under white text. Never put white text on `#ff4034`; never use `#d92d22` for a glow.

**The Green-Means-Money Rule.** Green appears only on a positive financial delta — never as decorative "success."

**The Tonal-Depth Rule.** On dark, depth comes from stepping the ink ramp (BG → panel → panel-3), not from resting drop-shadows on ordinary surfaces.

## 3. Typography

**Display / Body / Label Font:** TR Sans Display (with `-apple-system, BlinkMacSystemFont, Segoe UI, Roboto` fallback)
**Mono Font:** SF Mono (with `ui-monospace, Menlo, Cascadia Code` fallback)

**Character:** One family does nearly everything. TR Sans Display is a tight,
confident grotesque used across four weights (500 / 580 / 680 / 740); hierarchy
comes from weight and size, not a second face. The only true pairing is
sans-against-mono: anything a developer would *type* (commands, config, the command
bar, inline identifiers) is set in mono, which doubles as a credibility signal.

### Hierarchy
- **Display** (740, `clamp(2.8rem, 7vw, 5.3rem)`, line-height 1.02, tracking −0.038em): Hero and final-CTA headlines only. `text-wrap: balance`.
- **Headline** (740, `clamp(2rem, 4.4vw, 3.3rem)`): Section `h2`s.
- **Title** (680, ~1.32rem, −0.03em): Tile and card headings.
- **Body** (500, 17px, line-height 1.6, tracking −0.011em): Default prose. On dark, line-height is bumped to ~1.6 because light type reads lighter and needs more air. Measures capped ~44–54ch.
- **Label** (680, 12.5px, tracking 0.02em): The section kicker (red, with a leading rule) and footer heads. Deliberate and sparse.
- **Mono** (400, 13.5px): Commands, code, config, the command input, inline identifiers.

### Named Rules
**The Weight-Not-Width Rule.** Hierarchy is carried by weight (500→740) inside one family. Never introduce a second sans; never fake a display face by stretching body text.

**The Kicker-Restraint Rule.** The red kicker (leading rule + label) names a section theme, not scaffolding. If every section has one, delete most of them.

**The Tabular-Numbers Rule.** Every financial figure uses `font-variant-numeric: tabular-nums`.

## 4. Elevation

Depth is layered but *earned*. On dark, the primary depth cue is **tonal** — stepping
the ink ramp (BG → panel → panel-3) — not shadow. Standing shadow is reserved for a
small set of signature surfaces that genuinely float: the command instrument (a deep
drop plus a faint red edge-glow), the fixed liquid-glass dock, the toast, and the
final-CTA glow. Ordinary content tiles sit flat on a hairline border and lift only on
hover. Above it all, an animated red radial glow and a soft-light grain film give the
whole page atmosphere.

### Shadow & light vocabulary
- **Instrument float** (`0 50px 120px -40px rgba(0,0,0,0.85), 0 0 80px -30px rgba(255,64,52,0.25)`): Floats the command panel and gives it a red halo.
- **Glass dock** (`inset 0 1px 0 rgba(255,255,255,0.08), 0 20px 48px rgba(0,0,0,0.5)` + `backdrop-filter: blur(16px) saturate(180%)`): The one glassmorphism moment — the fixed bottom nav.
- **Tile hover lift** (`0 30px 60px -40px rgba(0,0,0,0.8)` with `translateY(-4px)`): Content tiles' only elevation.
- **Hero glow** (animated red radial, `blur(30px)`, ~16–20s drift): Atmosphere behind the hero. **Grain** (SVG fractal noise, ~5% opacity, `mix-blend: soft-light`): fixed film over the page.

### Named Rules
**The Earned-Elevation Rule.** Standing shadows belong only to signature surfaces (instrument, dock, glow, toast). Content tiles are flat until hover.

**The Glass-Is-Rare Rule.** Glassmorphism exists in one place — the dock. Do not spread blur-and-glass to other panels.

**The Restrained-Glow Rule.** Red glow is atmosphere and emphasis (one hero glow, CTA halos, the instrument edge), not a coat of paint on every element. Dark-mode-with-glowing-accents is a known AI tell; here it's a deliberate, sparse, brand-native signature.

## 5. Components

### Buttons
- **Shape:** Full pill (`999px`).
- **Solid (primary):** Light fill (`--text` `#f4f5f7`), ink text (`#0b0b0d`) — the inverted, high-contrast default. Hover → pure white, `translateY(-1px)`, arrow nudges 3px.
- **Red (highest intent):** `#d92d22` fill, white text, red-glow shadow. Hover → `#c4261c` (deeper, stays AA).
- **Ghost:** Transparent, `--text` label, `--line-2` border. Hover → border brightens, faint white wash.

### The Command Instrument (signature component)
A dark, floating panel that behaves like a command palette. A header strip (traffic dots, "Trade Republic · Command", a "Live demo" badge). A **command bar**: a red glyph, a mono-adjacent text input with an animated typewriter placeholder and a keyboard hint (`↑ ↓ browse · ↵ run`). Below, a **results listbox** of suggested questions (icon + question + tag), navigable by ↑/↓, selectable by ↵ or click; the selected row gets a red tint + border. Running a question echoes it into the bar, hides the list, and streams an **answer**: a "running read-only query" beat, then a word-by-word reply with a blinking red caret, then a data card (tabular numerics, gain/loss color, a drawn sparkline) rising in. `role="combobox"`/`listbox`, `aria-live`, full keyboard control, reduced-motion shows answers instantly.

### Capabilities — Bento
A 6-column grid of **varied** tiles (3+3, then 2+4), never an identical card grid. Each tile: title + one line + a mini product preview (a bar chart with one hot red bar, a holdings list, a cash readout, a timeline). Flat at rest, hover-lift.

### Chips
- **Result rows** (command instrument): described above.
- **Prompt chips (copy-to-clipboard):** `--panel-3` fill, `--text`, `8px` radius, red-tinted hover, green "Copied ✓" done state.

### Copy affordances
The interactive surface is copy-to-clipboard, not forms. Per-line (`.cp`) and block copy buttons: translucent chips revealed on hover / `:focus-visible`, green done state, an ink toast slides up on copy. On touch they stay visible.

### Navigation — The Liquid-Glass Dock
A fixed, centered **bottom** dock (not a top bar). Dark translucent glass (`rgba(20,21,24,0.62)` + blur + saturate), brand mark (ink square, glowing red dot), pill links, a red CTA. Enters with a dock-in rise. On ≤720px it condenses to brand + CTA.

### Connect / Auth flow (shared surface)
A centered card on the same ink + red-glow background: TR Sans, a 3-dot progress rail, red-ringed inputs, the red CTA, a success state with a glowing check badge and confetti (reduced-motion-guarded). Same tokens as the landing — one continuous world.

### Docs surfaces
Both the Scalar API reference and the markdown guide run the ink system: dark bg, red accent, TR Sans, a shared glass topbar with the brand mark. Callouts are tinted rounded panels with full borders — never a side-stripe.

## 6. Do's and Don'ts

### Do:
- **Do** keep Trade Republic Red under ~10% of any screen — signal and light, not theme.
- **Do** use `#ff4034` for glow/accents/red-on-dark text, and `#d92d22` for button fills under white text (The Two-Reds Rule).
- **Do** carry all hierarchy through TR Sans Display weights (500→740); pair only with mono for typed content.
- **Do** set every financial figure in tabular numerics, and reserve green strictly for positive deltas.
- **Do** build depth on dark by stepping the ink ramp; let standing shadow be *earned* by signature surfaces only.
- **Do** keep content tiles flat at rest with a single hairline border; lift on hover.
- **Do** keep glow sparse and purposeful (one hero glow, CTA halos, instrument edge).
- **Do** provide a `prefers-reduced-motion` fallback for every entrance and the command stream so nothing depends on a transition to become visible.
- **Do** gate scroll-reveal behind an `html.js` class so content is visible without JS (never ship a blank section to a headless render).
- **Do** keep the "unofficial / not affiliated" disclaimer legible, and keep every surface (landing, auth, docs) on the same tokens.

### Don't:
- **Don't** ship generic SaaS-landing clichés: no hero-metric block, no wall of identical icon cards, no gradient text, no uppercase kicker above every section.
- **Don't** drift into corporate-bank gravitas: no navy-and-gold, no stock photography, no legalese.
- **Don't** counterfeit Trade Republic — quote the brand cues, never clone the official site or bury the unaffiliated notice.
- **Don't** put white text on `#ff4034` (fails AA); use `#d92d22`. And don't let muted grays fall below their AA floors on ink.
- **Don't** use a colored `border-left`/`border-right` stripe as an accent on cards, callouts, or list items — use full borders + tint.
- **Don't** spread glassmorphism beyond the dock, or paint red glow onto every element (dark-mode-glow is an AI tell unless it's this sparse and deliberate).
- **Don't** gate content visibility on a scroll transition, or leave the docs shells on their old off-brand blue/slate.
