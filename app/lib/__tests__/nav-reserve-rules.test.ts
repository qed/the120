import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { NAV_RESERVE_CTA, showReserveCta } from "@/app/lib/nav-reserve-rules";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");

const kid = (id: string) => ({ id });
const dep = (child_id: string, status: string) => ({ child_id, status });

describe("showReserveCta — the nav's coarse eligibility read (U4)", () => {
  it("ZERO children SHOW the CTA — the vacuous-truth trap, pinned", () => {
    // children.every(...) is true on the empty set; a naive predicate hides
    // the CTA from exactly the parent the shortcut exists for.
    expect(showReserveCta([], [])).toBe(true);
  });

  it("shows while any child lacks a paid/pending deposit", () => {
    expect(showReserveCta([kid("a")], [])).toBe(true);
    expect(showReserveCta([kid("a"), kid("b")], [dep("a", "paid")])).toBe(true);
    // refunded does not cover — that child can re-reserve.
    expect(showReserveCta([kid("a")], [dep("a", "refunded")])).toBe(true);
    // mixed paid + refunded rows for the same child: the paid row covers.
    expect(showReserveCta([kid("a")], [dep("a", "refunded"), dep("a", "paid")])).toBe(false);
  });

  it("hides when every child is covered (paid or pending)", () => {
    expect(showReserveCta([kid("a")], [dep("a", "paid")])).toBe(false);
    expect(showReserveCta([kid("a")], [dep("a", "pending")])).toBe(false);
    expect(
      showReserveCta([kid("a"), kid("b")], [dep("a", "paid"), dep("b", "pending")])
    ).toBe(false);
  });

  it("unresolved rows are HIDDEN (no-flash convention), and other statuses never cover", () => {
    expect(showReserveCta(null, null)).toBe(false);
    expect(showReserveCta([kid("a")], null)).toBe(false);
    expect(showReserveCta(null, [])).toBe(false);
    for (const s of ["refunded", "failed", "expired", "payment_failed", "garbage"]) {
      expect(showReserveCta([kid("a")], [dep("a", s)]), s).toBe(true);
    }
  });

  it("the CTA is one label, one internal destination — no funnel src marker", () => {
    expect(NAV_RESERVE_CTA).toEqual({ label: "Reserve a seat · $250", href: "/dashboard" });
    expect(NAV_RESERVE_CTA.href).not.toContain("src=");
  });
});

describe("Nav wiring (source scan — vitest cannot mount client components)", () => {
  const nav = read("app/components/Nav.tsx");

  it("renders the CTA at ALL THREE sites through the ONE shared constant", () => {
    // Presence alone is vacuous (the import keeps the substring alive):
    // count the actual render usages — href and label at desktop, mobile
    // header, and mobile panel. Deleting any one site reddens this.
    expect(nav.match(/NAV_RESERVE_CTA\.href/g) ?? []).toHaveLength(3);
    expect(nav.match(/NAV_RESERVE_CTA\.label/g) ?? []).toHaveLength(3);
    expect(nav.match(/showReserveCta\(/g) ?? []).toHaveLength(1); // one gate, shared
    // Never a hand-written label beside the constant.
    expect(nav.match(/Reserve a seat/g) ?? []).toHaveLength(0);
  });

  it("the read is RLS-scoped browser-client selects, never service role", () => {
    expect(nav).toContain("supabaseBrowser");
    expect(nav).not.toMatch(/service_role|supabaseAdmin/);
    // Fail-safe error path: a rejected fetch resets to hidden, never stale.
    expect(nav).toContain(".catch(");
  });

  it("visual hierarchy: when both render, My dashboard degrades to ghost", () => {
    // Two adjacent solid-red buttons read as broken hierarchy (design
    // review). The signed-out branch already used ghost twice (Log in);
    // the signed-in degrade adds two more (desktop + mobile panel) — a
    // count, not a vacuous toContain that pre-diff text satisfied.
    expect(nav.match(/variant="ghost"/g) ?? []).toHaveLength(4);
  });

  it("the signed-out nav is untouched: no reserve wiring inside signed-out branches", () => {
    // Every signed-out fragment renders Log in / StartCta exactly as before.
    expect(nav.match(/StartCta source=\{"home"\}/g) ?? []).toHaveLength(3);
  });
});
