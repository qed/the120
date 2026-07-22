/**
 * The Path — skin token resolver (T1 Unit 13, plan Decision 9).
 *
 * Pure module. No React, no Next, no Supabase — the ONLY unit-testable part of
 * the design foundation (there is no jsdom here, so the components are covered
 * by manual/visual verification instead).
 *
 * ## Why this exists
 *
 * The Path renders through two skins, HQ and Trail, from one token set. Decision
 * 9 settled the mechanism in code *before* any component was written: Tailwind
 * v4's `@theme` cannot be scoped (every block merges into one `:root`), and
 * `@theme inline` compiles utilities to LITERAL values — so a runtime CSS-variable
 * override under a `.trail` class does nothing. Both namespaces (`--color-hq-*`
 * AND `--color-trail-*`) therefore ship in the single global `@theme` block, and
 * the skin is chosen by swapping the CLASS NAME at a subtree root: `bg-hq-canvas`
 * vs `bg-trail-canvas`. This module resolves `(skin, prop, token)` to that class.
 *
 * ## The literal-table constraint (do not "simplify" this away)
 *
 * Every value in `CLASS_TABLE` is a COMPLETE class-string literal. Tailwind's
 * scanner reads this source file and emits exactly the utilities it finds spelled
 * out here — so building strings by concatenation (`` `${prop}-${skin}-${token}` ``)
 * would return classes at runtime that Tailwind never generated, and they would
 * render as no color at all. The table's verbosity is load-bearing.
 *
 * ## The per-skin type guard
 *
 * HQ and Trail publish deliberately different neutral roles (HQ has sunken /
 * border / border-strong / ink-muted; Trail has mist). `SkinToken<S>` binds the
 * legal token names to the skin, so `skinClass("trail", "bg", "ink-muted")` is a
 * COMPILE error, not a silent runtime miss (plan Unit 13 edge case). The guard
 * is strongest with a LITERAL skin; a caller holding a widened `Skin` (e.g. a
 * `skin?: Skin` prop) is restricted to the shared tokens both namespaces
 * publish, and must narrow to a literal to reach a skin-specific token. Either
 * way `skinClass` also throws if an untyped caller smuggles an illegal
 * combination past the types.
 *
 * ## Who consumes this
 *
 * The Unit 14 app shells choose the skin once at a subtree root and use this
 * resolver for their neutral background/text/border classes. The design-system
 * PRIMITIVES (Button, Seal, …) deliberately hardcode their own fuller per-skin
 * class lists — which include shadows, focus rings, and brightness beyond the
 * neutral tokens resolved here — so they are not routed through `skinClass`.
 * Until those shells land this resolver has no production caller; that is
 * expected, and the reason it is settled (and tested) now is Decision 9's rule
 * that the skin architecture must exist before any surface is written.
 */

export type Skin = "hq" | "trail";

export const SKINS = ["hq", "trail"] as const satisfies readonly Skin[];

/** A Tailwind color utility family. */
export type SkinProp = "bg" | "text" | "border";

/**
 * Neutral roles each skin publishes. The two lists differ on purpose — that
 * asymmetry is what the type guard enforces. Phase, verification, and ceremony
 * tokens are skin-independent (constant across both) and are used directly as
 * `phase-*` / `verified` / `not-yet` utilities, so they are not resolved here.
 */
export const HQ_TOKENS = [
  "canvas",
  "surface",
  "sunken",
  "border",
  "border-strong",
  "ink",
  "ink-soft",
  "ink-muted",
] as const;

export const TRAIL_TOKENS = [
  "canvas",
  "surface",
  "ink",
  "ink-soft",
  "mist",
] as const;

export type HqToken = (typeof HQ_TOKENS)[number];
export type TrailToken = (typeof TRAIL_TOKENS)[number];

/**
 * The legal token names for a given skin. Written NON-distributively
 * (`[S] extends [...]`) on purpose: a caller that passes a widened `Skin` — one
 * that has not narrowed to a literal — resolves to the INTERSECTION of both
 * namespaces (the shared canvas/surface/ink/ink-soft tokens), not their union.
 * A distributive `S extends "hq" ? HqToken : TrailToken` would let
 * `skinClass(skin, "bg", "mist")` compile when `skin: Skin`, because the union
 * distributes to `HqToken | TrailToken` and "mist" is a member of that — the
 * exact silent hole the guard exists to close.
 */
export type SkinToken<S extends Skin> = [S] extends ["hq"]
  ? HqToken
  : [S] extends ["trail"]
    ? TrailToken
    : HqToken & TrailToken;

// Complete class-string literals, one per (skin, prop, token). Written out in
// full so Tailwind's content scanner emits every one of these utilities.
const CLASS_TABLE = {
  hq: {
    bg: {
      canvas: "bg-hq-canvas",
      surface: "bg-hq-surface",
      sunken: "bg-hq-sunken",
      border: "bg-hq-border",
      "border-strong": "bg-hq-border-strong",
      ink: "bg-hq-ink",
      "ink-soft": "bg-hq-ink-soft",
      "ink-muted": "bg-hq-ink-muted",
    },
    text: {
      canvas: "text-hq-canvas",
      surface: "text-hq-surface",
      sunken: "text-hq-sunken",
      border: "text-hq-border",
      "border-strong": "text-hq-border-strong",
      ink: "text-hq-ink",
      "ink-soft": "text-hq-ink-soft",
      "ink-muted": "text-hq-ink-muted",
    },
    border: {
      canvas: "border-hq-canvas",
      surface: "border-hq-surface",
      sunken: "border-hq-sunken",
      border: "border-hq-border",
      "border-strong": "border-hq-border-strong",
      ink: "border-hq-ink",
      "ink-soft": "border-hq-ink-soft",
      "ink-muted": "border-hq-ink-muted",
    },
  },
  trail: {
    bg: {
      canvas: "bg-trail-canvas",
      surface: "bg-trail-surface",
      ink: "bg-trail-ink",
      "ink-soft": "bg-trail-ink-soft",
      mist: "bg-trail-mist",
    },
    text: {
      canvas: "text-trail-canvas",
      surface: "text-trail-surface",
      ink: "text-trail-ink",
      "ink-soft": "text-trail-ink-soft",
      mist: "text-trail-mist",
    },
    border: {
      canvas: "border-trail-canvas",
      surface: "border-trail-surface",
      ink: "border-trail-ink",
      "ink-soft": "border-trail-ink-soft",
      mist: "border-trail-mist",
    },
  },
} as const satisfies {
  [S in Skin]: { [P in SkinProp]: Record<SkinToken<S>, string> };
};

/**
 * Resolve a skin's neutral token to a complete Tailwind utility class.
 *
 *   skinClass("hq", "bg", "canvas")    // "bg-hq-canvas"
 *   skinClass("trail", "text", "ink")  // "text-trail-ink"
 *
 * `token` is constrained to the tokens the skin actually publishes, so a
 * cross-namespace request is a compile error. The runtime throw is a backstop
 * for callers who bypass the types.
 */
export function skinClass<S extends Skin>(
  skin: S,
  prop: SkinProp,
  token: SkinToken<S>,
): string {
  const forSkin = CLASS_TABLE[skin] as Record<SkinProp, Record<string, string>>;
  const cls = forSkin[prop]?.[token as string];
  if (!cls) {
    throw new Error(
      `skin-tokens: no '${token}' token for prop '${prop}' in the '${skin}' skin namespace`,
    );
  }
  return cls;
}
