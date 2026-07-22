---
title: "Tailwind v4 @theme cannot be scoped and @theme inline compiles to literals — build a multi-skin system with two token namespaces swapped by class name, not a CSS-variable override"
date: 2026-07-22
category: best-practices
module: the-path-design-system
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Building a multi-theme / multi-skin design system in Tailwind v4 (light/dark, brand A/B, or here HQ vs Trail)
  - You are tempted to define one token (e.g. --color-canvas) and override it under a `.dark` / `.trail` class to switch themes
  - A component or inline style needs to compose alpha on a design token at runtime (hsl(var(--x) / a))
  - Adding token namespaces to a shared/global `@theme inline` block that marketing and app surfaces both load
tags:
  - tailwind-v4
  - theme
  - inline
  - design-tokens
  - design-system
  - skins
  - css-variables
  - color-mix
  - the-path
related_components:
  - app/globals.css
  - app/path/lib/skin-tokens.ts
---

# Tailwind v4 `@theme` cannot be scoped, and `@theme inline` compiles utilities to literals

The Path ships two visual **skins** — HQ (founder dashboard) and Trail (illustrated
journey) — rendered from one token set. The obvious instinct is to define a neutral
token once and swap its value under a class:

```css
/* ❌ The intuition that does NOT work in Tailwind v4 */
@theme inline { --color-canvas: hsl(var(--hq-canvas)); }
.trail { --color-canvas: hsl(var(--trail-canvas)); } /* hoping bg-canvas flips */
```

This silently does nothing. Understanding *why* is what settles the whole
architecture (The Path plan Decision 9), and it must be settled **before any
component is written**, because it decides the shape of every skinned class.

## Two Tailwind v4 facts, both load-bearing

**1. `@theme` cannot be scoped.** Every `@theme` block — even one written under a
selector — merges into the single global `:root, :host` rule. There is no scoping
modifier; you cannot get a `.trail`-scoped `@theme`. Verified against the compiled
implementation (v4.3.2), which emits one merged theme rule regardless of where the
blocks are authored.

**2. `@theme inline` compiles utilities to LITERAL values.** With the `inline`
keyword, a theme token's value is *substituted into the utility* rather than
referenced through a `var(--color-*)`:

```css
@theme inline { --color-hq-canvas: hsl(var(--hq-canvas)); }
/* compiles to: */
.bg-hq-canvas { background-color: hsl(var(--hq-canvas)); }
/*                               ^ the literal value, NOT var(--color-hq-canvas) */
```

So there is **no `--color-hq-canvas` custom property in `:root`** for a `.trail`
override to target. The utility never reads `var(--color-canvas)`, so redefining
that variable under a class changes nothing the utility looks at. (Plain `@theme`
*does* emit the `:root` variable — but it still cannot be scoped, so it doesn't
rescue the override approach either.)

**Consequence:** a runtime CSS-variable override under a `.trail` class is a no-op
for `@theme inline` color tokens. Theme switching in Tailwind v4 is a **class-name
swap**, not a variable swap.

## The working pattern

Ship **both** namespaces in the single global `@theme` block, and pick which
*class* applies at the subtree root:

```css
/* app/globals.css — ONE @theme inline block, both namespaces */
@theme inline {
  --color-hq-canvas: hsl(var(--hq-canvas));
  --color-hq-ink: hsl(var(--hq-ink));
  /* … */
  --color-trail-canvas: hsl(var(--trail-canvas));
  --color-trail-ink: hsl(var(--trail-ink));
  /* … */
}

/* Numeric truth lives ONCE, as HSL channel triplets, in a plain :root block */
:root {
  --hq-canvas: 0 0% 100%;
  --hq-ink: 30 12% 12%;
  --trail-canvas: 38 46% 95%;
  --trail-ink: 25 34% 20%;
  /* … */
}
```

```tsx
// The skin selects the CLASS at the subtree root — bg-hq-ink vs bg-trail-ink.
const isTrail = skin === "trail";
<div className={isTrail ? "bg-trail-canvas text-trail-ink" : "bg-hq-canvas text-hq-ink"} />
```

Two things make this clean:

- **Distinct utilities, not a merged variable.** `bg-hq-canvas` and
  `bg-trail-canvas` are separate utilities with separate values — there is nothing
  to collide, because there is no shared `--color-canvas`.
- **HSL channel triplets in `:root` are the single source of numeric truth.**
  Authoring the raw values as space-separated channels (`30 12% 12%`) and
  referencing them as `hsl(var(--hq-ink))` lets **both** the generated utilities
  and component *inline styles* compose alpha at runtime — `hsl(var(--phase-sell) / 0.34)`
  in a `style={{}}` glow, and `bg-not-yet/10` as a utility (Tailwind wraps the
  `/opacity` modifier in `color-mix(in oklab, hsl(var(--not-yet)) 10%, transparent)`).
  A flattened hex token cannot do the inline-alpha half.

For a pure, testable resolver from `(skin, prop, token)` to the right class string
— with a per-skin type guard so a cross-namespace token is a compile error — see
`app/path/lib/skin-tokens.ts`. Note its returned strings must be **complete class
literals** in source, because Tailwind's scanner only emits utilities it finds
spelled out; a `` `${prop}-${skin}-${token}` `` built at runtime is invisible to it.

## Verify against compiled output, not intuition

The claims above are all checkable in seconds — compile a minimal case through the
actual installed pipeline and read the CSS:

```js
// node, using the repo's own @tailwindcss/postcss
const postcss = require("postcss");
const tw = require("@tailwindcss/postcss");
const input = `
@import "tailwindcss" source(none);
:root { --hq-canvas: 0 0% 100%; --trail-canvas: 38 46% 95%; --not-yet: 36 92% 48%; }
@theme inline {
  --color-hq-canvas: hsl(var(--hq-canvas));
  --color-trail-canvas: hsl(var(--trail-canvas));
  --color-not-yet: hsl(var(--not-yet));
}
@source inline("bg-hq-canvas bg-trail-canvas bg-not-yet/10");`;
postcss([tw()]).process(input, { from: "x.css" }).then(r => console.log(r.css));
```

Observed output (proves both facts and the alpha path):

```css
.bg-hq-canvas    { background-color: hsl(var(--hq-canvas)); }     /* distinct */
.bg-trail-canvas { background-color: hsl(var(--trail-canvas)); }  /* distinct — NOT merged */
.bg-not-yet\/10  { background-color: color-mix(in oklab, hsl(var(--not-yet)) 10%, transparent); }
```

The same holds in the real `next build` output — grep `.next/static/chunks/*.css`
for the two utilities and confirm they carry different token references.

## Why this matters

Discovering "@theme can't be scoped" *after* writing components is the expensive
path: every skinned class would have to be re-architected, and the plan's own risk
table flags it (low likelihood, high impact). Settling it up front turns the skin
system into a mechanical class-name swap that a scanner can see, a resolver can
type-check, and inline styles can alpha-compose — with marketing surfaces that
share the same `@theme inline` block staying completely inert (they simply never
use a `hq-*`/`trail-*` utility).

## When to apply

Any Tailwind v4 surface with more than one theme/skin rendered from one token set.
Reach for two namespaces + a class-name swap; do **not** reach for a
`.theme { --color-x: … }` variable override — in Tailwind v4 it compiles away to
nothing. Origin: The Path T1 Unit 13, `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md`
(Decision 9).
