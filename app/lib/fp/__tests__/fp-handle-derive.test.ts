import { describe, expect, it } from "vitest";

/**
 * The shared first-name → handle derivation (auto-provisioned sites plan Unit
 * 3; consumed today by the /start website preview). These are the plan's own
 * scenarios, pinned: the /start preview and the future ensure allocator both
 * ride this module, so what greens here is what BOTH surfaces will answer.
 */

import {
  deriveSiteHandleStem,
  pickFirstFreeHandle,
  siteHandleCandidates,
} from "@/app/lib/fp/fp-handle-derive";
import { handleShapeVerdict, suggestHandleCandidates } from "@/app/api/fp/site/site-rules";

const stemOf = (name: string): string => {
  const v = deriveSiteHandleStem(name);
  if (!v.ok) throw new Error(`expected a stem for ${JSON.stringify(name)}, got ${v.reason}`);
  return v.stem;
};

describe("deriveSiteHandleStem — the cleaning pipeline (R6/R7)", () => {
  it("plain names lowercase to themselves", () => {
    expect(stemOf("Ethan")).toBe("ethan");
    expect(stemOf("Maya")).toBe("maya");
  });

  it("accents fold to ASCII via NFKD (José → jose, Zoë → zoe)", () => {
    expect(stemOf("José")).toBe("jose");
    expect(stemOf("Zoë")).toBe("zoe");
  });

  it("a real hyphen survives; its diacritics fold (Anh-Thư → anh-thu)", () => {
    expect(stemOf("Anh-Thư")).toBe("anh-thu");
  });

  it("apostrophes and spaces are DROPPED, not dashed (O'Brien → obrien, Mary Jane → maryjane)", () => {
    expect(stemOf("O'Brien")).toBe("obrien");
    // Pinned per the plan's "pin whichever the implementation chooses".
    expect(stemOf("Mary Jane")).toBe("maryjane");
  });

  it("repeated/edge hyphens collapse and trim", () => {
    expect(stemOf("--Anna--Lee--")).toBe("anna-lee");
  });

  it("over 20 chars clips to 20 and stays valid", () => {
    const stem = stemOf("Maximiliana-Wolfeschlegelstein");
    expect(stem.length).toBe(20);
    expect(handleShapeVerdict(stem)).toEqual({ ok: true, handle: stem });
  });

  it("a hyphen landing exactly on the 20-char clip boundary is retrimmed, never emitted", () => {
    // 19 letters + hyphen + more: the clip lands ON the hyphen; the retrim
    // must strip it so the stem stays shape-valid (review pin, U3 amendment).
    const stem = stemOf("Abcdefghijklmnopqrs-Continues");
    expect(stem).toBe("abcdefghijklmnopqrs");
    expect(handleShapeVerdict(stem)).toEqual({ ok: true, handle: stem });
  });

  it("under 3 chars pads with digits until legal (R8: Al → al2)", () => {
    expect(stemOf("Al")).toBe("al2");
    expect(stemOf("Bo")).toBe("bo2");
    expect(stemOf("J")).toBe("j22");
  });
});

describe("deriveSiteHandleStem — refusals (R10's fallback stays the caller's)", () => {
  it("empty / whitespace-only → `empty`, never a blank or padded ghost", () => {
    expect(deriveSiteHandleStem("")).toEqual({ ok: false, reason: "empty" });
    expect(deriveSiteHandleStem("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("a name with no foldable characters (emoji, non-Latin script) → `empty`", () => {
    expect(deriveSiteHandleStem("🦄")).toEqual({ ok: false, reason: "empty" });
    expect(deriveSiteHandleStem("小明")).toEqual({ ok: false, reason: "empty" });
  });

  it("a kid named after a RESERVED handle is refused (Admin, Login)", () => {
    expect(deriveSiteHandleStem("Admin")).toEqual({ ok: false, reason: "rejected" });
    expect(deriveSiteHandleStem("Login")).toEqual({ ok: false, reason: "rejected" });
  });

  it("a blocklisted term is refused, never returned", () => {
    expect(deriveSiteHandleStem("Sexy")).toEqual({ ok: false, reason: "rejected" });
  });

  it("every accepted output passes the FULL server pipeline", () => {
    const names = ["Ethan", "José", "Zoë", "Anh-Thư", "O'Brien", "Mary Jane", "Al", "J", "Rémi"];
    for (const name of names) {
      const v = deriveSiteHandleStem(name);
      expect(v.ok, name).toBe(true);
      if (v.ok) expect(handleShapeVerdict(v.stem), name).toEqual({ ok: true, handle: v.stem });
    }
  });
});

describe("siteHandleCandidates / pickFirstFreeHandle — the allocator's collision ladder (R9)", () => {
  it("the ladder is the stem then EXACTLY the claim surface's variants", () => {
    expect(siteHandleCandidates("ethan")).toEqual(["ethan", ...suggestHandleCandidates("ethan")]);
  });

  it("a free stem picks itself", () => {
    expect(pickFirstFreeHandle({ stem: "maya", isTaken: () => false })).toEqual({
      ok: true,
      handle: "maya",
    });
  });

  it("a taken stem advances to the claim surface's first variant (mary → mary2)", () => {
    const taken = new Set(["mary"]);
    expect(pickFirstFreeHandle({ stem: "mary", isTaken: (h) => taken.has(h) })).toEqual({
      ok: true,
      handle: "mary2",
    });
  });

  it("walks the deterministic digit set (no 6!) exactly as suggestions do", () => {
    const taken = new Set(["ethan", "ethan2", "ethan3", "ethan4", "ethan5"]);
    expect(pickFirstFreeHandle({ stem: "ethan", isTaken: (h) => taken.has(h) })).toEqual({
      ok: true,
      handle: "ethan7",
    });
  });

  it("falls through the digits to the friendly tail, then reports exhausted", () => {
    const taken = new Set(siteHandleCandidates("mary"));
    taken.delete("mary-co");
    expect(pickFirstFreeHandle({ stem: "mary", isTaken: (h) => taken.has(h) })).toEqual({
      ok: true,
      handle: "mary-co",
    });
    expect(
      pickFirstFreeHandle({ stem: "mary", isTaken: (h) => h === "mary-co" || taken.has(h) })
    ).toEqual({ ok: false, reason: "exhausted" });
  });
});
