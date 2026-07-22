import { describe, expect, it } from "vitest";
import {
  HQ_TOKENS,
  SKINS,
  TRAIL_TOKENS,
  skinClass,
  type Skin,
  type SkinProp,
} from "../skin-tokens";

const PROPS: SkinProp[] = ["bg", "text", "border"];

describe("skin-tokens", () => {
  // Plan Unit 13, happy path: an HQ token name and a Trail token name resolve
  // to DISTINCT class strings. This is the whole point of Decision 9 — two token
  // namespaces, swapped by class name.
  it("resolves an HQ token and a Trail token to distinct class strings", () => {
    expect(skinClass("hq", "bg", "canvas")).toBe("bg-hq-canvas");
    expect(skinClass("trail", "bg", "canvas")).toBe("bg-trail-canvas");
    expect(skinClass("hq", "bg", "canvas")).not.toBe(skinClass("trail", "bg", "canvas"));
  });

  it("resolves a shared token to a different class per skin", () => {
    expect(skinClass("hq", "text", "ink")).toBe("text-hq-ink");
    expect(skinClass("trail", "text", "ink")).toBe("text-trail-ink");
    expect(skinClass("hq", "text", "ink")).not.toBe(skinClass("trail", "text", "ink"));
  });

  it("resolves each property prefix correctly", () => {
    expect(skinClass("hq", "bg", "surface")).toBe("bg-hq-surface");
    expect(skinClass("hq", "text", "ink-soft")).toBe("text-hq-ink-soft");
    expect(skinClass("hq", "border", "border-strong")).toBe("border-hq-border-strong");
    expect(skinClass("trail", "border", "mist")).toBe("border-trail-mist");
  });

  // Completeness: every declared token for every skin resolves, for every prop,
  // to a correctly-prefixed non-empty class. Guards against a missing table
  // entry silently returning undefined at runtime.
  it("resolves every declared token for every skin and property", () => {
    const cases: [Skin, readonly string[]][] = [
      ["hq", HQ_TOKENS],
      ["trail", TRAIL_TOKENS],
    ];
    for (const [skin, tokens] of cases) {
      for (const prop of PROPS) {
        for (const token of tokens) {
          const cls = skinClass(skin, prop, token as never);
          expect(cls).toBe(`${prop}-${skin}-${token}`);
        }
      }
    }
  });

  it("exposes both skins and their token namespaces", () => {
    expect([...SKINS]).toEqual(["hq", "trail"]);
    // HQ carries the neutral roles Trail does not (sunken/border/border-strong/
    // ink-muted); Trail carries mist. The asymmetry is the design, and it is
    // what makes the cross-namespace request below a type error.
    expect([...HQ_TOKENS]).toEqual([
      "canvas",
      "surface",
      "sunken",
      "border",
      "border-strong",
      "ink",
      "ink-soft",
      "ink-muted",
    ]);
    expect([...TRAIL_TOKENS]).toEqual(["canvas", "surface", "ink", "ink-soft", "mist"]);
  });

  // Plan Unit 13, edge case: a token present in one namespace and absent in the
  // other fails at BUILD/TYPE level, not silently at runtime. The @ts-expect-error
  // lines are enforced by `tsc --noEmit`; if the per-skin constraint is ever
  // loosened, the unused-directive becomes a type error and the build fails.
  it("rejects a cross-namespace token at the type level", () => {
    // These lambdas are never invoked — they exist only so `tsc --noEmit` proves
    // the cross-namespace calls are compile errors. If the per-skin constraint is
    // ever loosened, the calls stop erroring, the @ts-expect-error directives go
    // unused, and the type check fails. (Invoking them would throw at runtime,
    // which is a separate guarantee tested below.)
    const typeChecks = [
      // @ts-expect-error 'ink-muted' is an HQ-only token; Trail has no such token.
      () => skinClass("trail", "bg", "ink-muted"),
      // @ts-expect-error 'mist' is a Trail-only token; HQ has no such token.
      () => skinClass("hq", "bg", "mist"),
      // @ts-expect-error 'border-strong' is an HQ-only token.
      () => skinClass("trail", "border", "border-strong"),
    ];
    expect(typeChecks).toHaveLength(3);
  });

  // Defense-in-depth: if a caller bypasses the types (untyped service-role data,
  // a wrong `as` cast), the resolver throws rather than returning a broken class
  // string that would silently render as no color at all.
  it("throws on an untyped bad (skin, token) combination", () => {
    const bad = skinClass as (skin: string, prop: string, token: string) => string;
    expect(() => bad("trail", "bg", "ink-muted")).toThrow(/trail/);
    expect(() => bad("hq", "bg", "mist")).toThrow(/hq/);
  });
});
