import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DOOR_CLASSES,
  GROUP_CARD_CTA,
  GROUP_SLUGS,
  PHASE_TOKENS,
  groups,
} from "@/app/lib/site";

/**
 * R15–R17: the five door colours, checked NUMERICALLY at build time rather
 * than assumed (R16's actual words). The ratios below are recomputed from the
 * HSL values in `globals.css` on every run — nothing here trusts a comment,
 * and a token edit that breaks contrast reddens the suite.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(path.resolve(HERE, "../../globals.css"), "utf8");

/* ─────────────────── colour math (WCAG 2.x relative luminance) ─────────────────── */

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The marketing paper the card footers sit on. */
const PAPER: [number, number, number] = [0xf7 / 255, 0xf6 / 255, 0xf3 / 255];
const AA_SMALL_TEXT = 4.5;

/** Reads `--name: H S% L%;` out of globals.css — the shipped value, not a copy. */
function token(name: string): [number, number, number] {
  const m = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(CSS);
  if (!m) throw new Error(`token --${name} not found in globals.css`);
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
}

const PHASES = ["sell", "build", "validate", "grow", "scale"] as const;

/* ────────────────────────────────── tests ────────────────────────────────── */

describe("R16 — contrast is measured, not assumed", () => {
  it.each(PHASES)("--phase-%s-ink clears WCAG AA on paper", (phase) => {
    expect(contrast(token(`phase-${phase}-ink`), PAPER)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });

  it("records that ALL FIVE raw tokens fail as small text — which is why -ink exists", () => {
    // The brief predicted gold and coral would fail. Measurement found every
    // one of them does, gold worst at ~1.8:1. If a future token edit makes a
    // raw value pass, this reddens — and the right response is to delete that
    // hue's -ink variant, not to loosen the assertion.
    for (const phase of PHASES) {
      expect(contrast(token(`phase-${phase}`), PAPER), `--phase-${phase}`).toBeLessThan(
        AA_SMALL_TEXT
      );
    }
  });

  it("keeps each -ink variant on the same hue and saturation as its accent", () => {
    // A "text-safe variant of the same hue" (R16) — not a different colour
    // that merely passes. Only lightness may differ.
    for (const phase of PHASES) {
      const raw = new RegExp(`--phase-${phase}:\\s*([\\d.]+)\\s+([\\d.]+)%`).exec(CSS);
      const ink = new RegExp(`--phase-${phase}-ink:\\s*([\\d.]+)\\s+([\\d.]+)%`).exec(CSS);
      expect(raw, phase).not.toBeNull();
      expect(ink, phase).not.toBeNull();
      expect(ink?.[1], `${phase} hue`).toBe(raw?.[1]);
      expect(ink?.[2], `${phase} saturation`).toBe(raw?.[2]);
    }
  });
});

describe("R15 — door position to phase colour", () => {
  it("maps every group to the confirmed token (brief §3.3, D9)", () => {
    expect(Object.fromEntries(groups.map((g) => [g.slug, g.phaseToken]))).toEqual({
      athletes: "--color-phase-sell",
      founders: "--color-phase-build",
      givers: "--color-phase-validate",
      makers: "--color-phase-grow",
      scholars: "--color-phase-scale",
    });
  });

  it("gives all five groups a door class set, and no group is missing", () => {
    // Belt to the compiler's braces: DOOR_CLASSES is keyed on GroupSlug, so a
    // missing entry no longer type-checks. This catches the other direction —
    // an entry for a slug no group actually has.
    for (const g of groups) {
      expect(DOOR_CLASSES[g.slug], g.slug).toBeDefined();
    }
    expect(Object.keys(DOOR_CLASSES).sort()).toEqual([...GROUP_SLUGS].sort());
    expect([...GROUP_SLUGS].sort()).toEqual(groups.map((g) => g.slug).sort());
  });

  it("is consumed by GroupsBand without a fallback that could mask a gap", () => {
    // The `?? "text-red"` this replaced would have rendered a missing door
    // colour as the app's error/waitlist red — visually indistinguishable
    // from an intentional state.
    const band = readFileSync(path.resolve(HERE, "../../components/GroupsBand.tsx"), "utf8");
    expect(band).toContain("DOOR_CLASSES[g.slug].label");
    expect(band.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/DOOR_CLASSES\[[^\]]*\]\?\./);
  });

  it("keeps every class a COMPLETE literal that appears verbatim in source", () => {
    // Tailwind v4's scanner reads source text: an interpolated class compiles
    // to nothing and fails silently in production while looking right in the
    // editor. Every shipped class must be greppable exactly as written.
    const siteSrc = readFileSync(path.resolve(HERE, "../site.ts"), "utf8");
    for (const set of Object.values(DOOR_CLASSES)) {
      for (const cls of Object.values(set)) {
        expect(cls).not.toMatch(/\$\{|`/);
        expect(siteSrc, cls).toContain(`"${cls}"`);
      }
    }
  });

  it("points every class at a token that exists in globals.css", () => {
    for (const set of Object.values(DOOR_CLASSES)) {
      for (const cls of Object.values(set)) {
        const name = cls.replace(/^(text|bg)-/, "");
        expect(CSS, cls).toContain(`--color-${name}:`);
      }
    }
  });

  it("uses the -ink variant for labels and the raw token for accents", () => {
    for (const [slug, set] of Object.entries(DOOR_CLASSES)) {
      expect(set.label, slug).toMatch(/-ink$/);
      expect(set.accent, slug).not.toMatch(/-ink$/);
    }
  });
});

describe("R17 — the five tokens are the only Path-register colours on marketing", () => {
  it("declares exactly five phase tokens and five ink variants", () => {
    expect(PHASE_TOKENS).toHaveLength(5);
    const inks = [...CSS.matchAll(/--phase-(\w+)-ink:/g)].map((m) => m[1]);
    expect(inks.sort()).toEqual([...PHASES].sort());
  });

  it("does not resurrect the brief's --tp-phase-* spelling, which exists nowhere here", () => {
    expect(CSS).not.toContain("--tp-phase-");
  });
});

describe("R14 — the card footer line", () => {
  it("is one exported constant, not five copies", () => {
    expect(GROUP_CARD_CTA).toBe("EXPLORE YOUR GROUP →");
    // The retiring label must not survive alongside it on the cards.
    expect(GROUP_CARD_CTA).not.toContain("BOOK OR JOIN");
  });
});
