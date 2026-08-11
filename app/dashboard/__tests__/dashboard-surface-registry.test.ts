import { describe, expect, it } from "vitest";
import { globSync } from "tinyglobby";

import {
  DASHBOARD_CLIENT_SURFACES,
  DASHBOARD_SWEEP_SURFACES,
  PER_KID_SWEEP_SURFACES,
  REPO_ROOT,
  SURFACE,
  SWEEP_EXEMPT,
  readRepoFile,
  readSurfaces,
} from "@/app/lib/__tests__/helpers/dashboard-surfaces";

/**
 * THE SURFACE-REGISTRY TRIPWIRE.
 *
 * Six test files sweep "every client surface of the dashboard" for invariants
 * (no em dash, no payment/deposit strings, no client-side funnel emit, no
 * register skins, no fabricated policy acceptance). Every one of those sweeps
 * is only as strong as the list of files it walks — and a file left off the
 * list fails SILENTLY: the sweep over the files that ARE listed still passes,
 * and the new surface reads as covered. That is not hypothetical.
 * `KidAccount.tsx` was carved out of `KidPortal.tsx` and sat outside the
 * invariants for a review cycle before anyone noticed.
 *
 * Consolidating the six hand-lists into ONE list
 * (app/lib/__tests__/helpers/dashboard-surfaces.ts) removes five of the six
 * chances to forget. This file removes the sixth, by asking the QUESTION the
 * lists could not ask themselves: what is actually on disk?
 *
 * Same shape, and the same reason, as
 * `app/lib/__tests__/vitest-include-coverage.test.ts` — a hand-maintained
 * allowlist that nothing compares against reality is an allowlist that drifts.
 *
 * ── WHEN THIS GOES RED ────────────────────────────────────────────────────
 * The failure names the file. You added a `"use client"` file under
 * app/dashboard, so decide which it is and say so in
 * app/lib/__tests__/helpers/dashboard-surfaces.ts:
 *
 *  - a rendering surface a parent or kid actually sees → add it to `SURFACE`.
 *    It joins `DASHBOARD_SWEEP_SURFACES` automatically, and if it violates one
 *    of the invariants you will hear about it immediately, which is the point.
 *  - not a swept surface (a data layer, the signed-out view, shared chrome) →
 *    add it to `SURFACE` AND to `SWEEP_EXEMPT`, with a sentence saying why.
 *
 * Do NOT fix a red by deleting the assertion. The list being wrong IS the bug
 * this file exists to report.
 */

/**
 * A dashboard client surface: a `.ts`/`.tsx` under `app/dashboard`, outside
 * `__tests__`, whose source OPENS with the `"use client"` directive.
 *
 * `.ts` is globbed as well as `.tsx` on purpose. Nothing stops a client module
 * from being a plain `.ts`, and a tripwire whose definition has a hole is a
 * tripwire you can step over. The directive is matched at the START of the file
 * because that is the only position where React/Next treats it as a directive
 * at all — a `"use client"` inside a string or a comment further down does not
 * make a client module, and must not make a phantom entry here.
 */
const CLIENT_DIRECTIVE = /^\s*(["'])use client\1\s*;?/;

const discoverClientSurfaces = (): string[] =>
  globSync(["app/dashboard/**/*.{ts,tsx}"], { cwd: REPO_ROOT, absolute: false })
    .map((f) => f.replaceAll("\\", "/"))
    .filter((f) => !f.includes("__tests__"))
    .filter((f) => CLIENT_DIRECTIVE.test(readRepoFile(f)))
    .sort();

describe("the dashboard client-surface registry matches the disk", () => {
  const found = discoverClientSurfaces();

  // Guard the SCAN before trusting it: a glob that matched nothing, or a
  // directive regex that matched nothing, would make every assertion below
  // vacuously true — the exact failure mode this file exists to prevent, one
  // level up.
  it("the scan actually found the dashboard (it is not silently matching nothing)", () => {
    expect(found.length).toBeGreaterThanOrEqual(5);
    expect(found).toContain(SURFACE.parentDashboard);
    expect(found).toContain(SURFACE.kidPortal);
  });

  it("names every client surface on disk — an unlisted one is an UNSWEPT one", () => {
    const listed = new Set(DASHBOARD_CLIENT_SURFACES);
    const unlisted = found.filter((f) => !listed.has(f));
    // Named in the failure so the fix is obvious: add the file to `SURFACE` in
    // app/lib/__tests__/helpers/dashboard-surfaces.ts (and to `SWEEP_EXEMPT`,
    // with a reason, only if it genuinely is not a swept surface).
    expect(unlisted).toEqual([]);
  });

  it("lists nothing that no longer exists — a stale path silences a sweep too", () => {
    // The other direction matters just as much. A renamed or deleted surface
    // left in the list keeps `readSurfaces` throwing (loud), but a path that
    // drifts to a file WITHOUT the directive would quietly sweep a
    // non-surface while the real one goes uncovered.
    const onDisk = new Set(found);
    const ghosts = DASHBOARD_CLIENT_SURFACES.filter((f) => !onDisk.has(f));
    expect(ghosts).toEqual([]);
  });

  it("keeps every exemption honest — an exempt path must still be a real surface", () => {
    // If an exempt file is deleted or promoted, the entry must go with it,
    // rather than the carve-out silently outliving the thing it excused.
    const listed = new Set(DASHBOARD_CLIENT_SURFACES);
    for (const f of SWEEP_EXEMPT) expect(listed.has(f), f).toBe(true);
  });
});

describe("the derived subsets stay derived", () => {
  it("the sweep set is the canonical list minus the exemptions, and nothing else", () => {
    expect([...DASHBOARD_SWEEP_SURFACES].sort()).toEqual(
      [
        SURFACE.firstProfitCard,
        SURFACE.kidAccount,
        SURFACE.kidPortal,
        SURFACE.kidRouteShell,
        SURFACE.parentDashboard,
        // Brought under the sweeps 2026-08-11, once its em dashes were fixed.
        // It was exempt for a reason that turned out to be hiding a real
        // violation of the standing no-em-dash copy rule.
        SURFACE.signIn,
      ].sort()
    );
    for (const f of SWEEP_EXEMPT) expect(DASHBOARD_SWEEP_SURFACES).not.toContain(f);
  });

  it("the per-kid subset drops ONLY the parent's kid list", () => {
    // Pinned so the one deliberately-narrower subset cannot quietly become a
    // second hand-list that drifts from the sweep set.
    expect(PER_KID_SWEEP_SURFACES).not.toContain(SURFACE.parentDashboard);
    expect([...PER_KID_SWEEP_SURFACES, SURFACE.parentDashboard].sort()).toEqual(
      [...DASHBOARD_SWEEP_SURFACES].sort()
    );
  });

  it("readSurfaces concatenates in list order, with no separator inserted", () => {
    // The consumers it replaced wrote `read(a) + read(b)`. Byte-identical
    // input, not merely equivalent input — a stray separator would be
    // invisible to `toContain` and visible to a regex that spans a file edge.
    const pair = [SURFACE.parentDashboard, SURFACE.firstProfitCard];
    expect(readSurfaces(pair)).toBe(
      readRepoFile(SURFACE.parentDashboard) + readRepoFile(SURFACE.firstProfitCard)
    );
  });
});
