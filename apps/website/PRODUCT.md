# Product

## Register

brand

## Users

Developers and AI tinkerers who already run Claude (or another MCP-capable agent)
locally and want to wire their **Trade Republic** portfolio into it. They're
comfortable with a terminal, `npm`/`pnpm`, and copy-pasting config into an MCP
client. Their context on arrival is evaluative: "Is this real, is it safe, and how
fast can I connect it?" They care about read-only guarantees, local execution, and
credibility before they'll run anything against their brokerage account.

## Product Purpose

The public landing page for an **unofficial, read-only** Trade Republic integration:
a documented API and a Model Context Protocol server that let an AI agent read a
user's holdings, cash, and transactions — running entirely on the visitor's own
machine. The page exists to make the concept ("talk to your portfolio") instantly
legible, establish trust (read-only, private, local, unaffiliated), and convert a
curious developer into a connected user via a five-step install. Success = a visitor
understands what it does, believes it's safe, and copies the setup commands.

## Brand Personality

Confident, precise, and quietly technical — Swiss-clean rather than loud. Three
words: **direct, trustworthy, sharp**. It borrows Trade Republic's visual language
(the signature red, the display typeface, the near-black ink) to feel native to the
ecosystem without impersonating the official brand. The voice is plain-spoken and
declarative ("Read-only by design. Private by default."), never salesy or hype-driven.
Emotional goal: the calm confidence of a well-built tool you can trust with your
financial data.

## Anti-references

- **Generic SaaS template.** No hero-metric block (big number + stat trio + gradient),
  no endless identical icon-card grids, no tracked-uppercase eyebrow above every
  section, no gradient text.
- **Corporate bank.** No stiff navy-and-gold institutional gravitas, stock photography
  of handshakes, or legalese tone. Trust is earned through clarity, not solemnity.
- **Official Trade Republic clone.** This is unofficial and must never read as if it
  *is* Trade Republic's own site. Reference the brand's language; don't counterfeit it.
  Keep the "unofficial / not affiliated" disclaimer legible.

## Design Principles

1. **Show the conversation, don't describe it.** The product is "talk to your
   portfolio" — the hero proves it with a live conversational demo, not adjectives.
2. **Trust is the feature.** Read-only, local, private, unaffiliated: surface these as
   first-class design elements, not fine print. A developer won't run it otherwise.
3. **Native, not counterfeit.** Wear Trade Republic's visual DNA (red, display type,
   ink) with restraint so it feels credible in the ecosystem without impersonating it.
4. **Precision over decoration.** Every animation, every surface earns its place. Swiss
   clarity — motion and glass are used sparingly and purposefully, never as filler.
5. **From curiosity to connected, fast.** The path from "what is this" to a working
   install is the spine of the page; reduce friction at every copy-paste step.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. Body text ≥4.5:1 against its background (watch the `--muted`
grays on `--paper` and the dark-surface muted tones in the conversational demo); large
text ≥3:1. Full keyboard navigation for the dock, chips, and copy buttons with visible
focus states. Honor `prefers-reduced-motion` for every entrance animation — the dock
dock-in, the hero rise, the highlight swipe, and the message reveals need a crossfade or
instant-state fallback so nothing depends on a transition to become visible.
