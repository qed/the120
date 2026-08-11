import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // ── WHY 30s AND NOT VITEST'S 5s DEFAULT ──────────────────────────────────
    // These suites are routinely run CONCURRENTLY (several agents, or a run
    // alongside `next dev`), and the heaviest tests here are CPU-bound rather
    // than I/O-bound: the slowest invoke a real page/component tree and pay the
    // whole compile on their first render. Measured on an idle machine the top
    // few are ~0.5-1.1s (`v3-start-always-live`'s first render 787ms, the
    // gauntlet generator sweep 1073ms, the requireStaff entry-point sweep
    // 939ms). Under three concurrent full runs the SAME tests were measured at
    // 5008ms and 5014ms — a ~6x inflation that lands just past the 5s default,
    // so the suite reported a red that had nothing to do with the code.
    //
    // That matters more here than in a repo with CI: there is no CI, so
    // `npm run ship` IS the gate, and a gate that cries wolf teaches everyone
    // to re-run until green — which is exactly how a REAL failure gets waved
    // through. 30s still catches a genuinely hung test (the whole suite runs in
    // ~25s), it just stops timing out work that was only ever slow.
    //
    // If you find yourself raising this again, measure first: a test that needs
    // more than 30s of CPU is a test with a problem, not a timeout with one.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: [
      "app/2026-27/**/__tests__/**/*.test.{ts,tsx}",
      "app/crm/__tests__/**/*.test.{ts,tsx}",
      "app/dashboard/__tests__/**/*.test.{ts,tsx}",
      "app/lib/**/__tests__/**/*.test.{ts,tsx}",
      "app/gauntlet/**/__tests__/**/*.test.{ts,tsx}",
      "app/api/**/__tests__/**/*.test.{ts,tsx}",
      // NOT listed, deliberately: `app/fp/**` (v3 plan Unit 10). It carried the
      // First Profit tests from T1 Unit 2 until that unit relocated the shared
      // modules to `app/lib/fp/**` — which `app/lib/**` above already covers —
      // and deleted the First Profit UI. What is left under `app/fp` is the
      // Founders Weekend guide app and the retirement redirect stubs, and NO
      // test file lives under either: FW's source-pin tests sit beside the
      // modules they pin, in `app/lib/fp/__tests__`. A glob matching nothing is
      // worse than no glob — it reads as coverage. If a test is ever added
      // under `app/fp` the include-coverage tripwire
      // (app/lib/__tests__/vitest-include-coverage.test.ts) reddens and asks
      // for the glob back, which is the correct signal rather than a nuisance.
      // The staff hub (Staff Front Door Unit 2). Same rule, same commit as the
      // first test under it — and from this unit on, enforced rather than
      // remembered: app/lib/__tests__/vitest-include-coverage.test.ts fails if
      // any test file in the repo is left outside this list.
      "app/staff/**/__tests__/**/*.test.{ts,tsx}",
      // The v3 front door's own decision helpers (fpv03 U2 amendment: the
      // completed-parent redirect). Added in the same commit as the first test
      // under app/start, per the allowlist tripwire's rule.
      "app/start/**/__tests__/**/*.test.{ts,tsx}",
      // Machine-bound scripts (R28 erase-entrypoint Unit). Added in the same
      // commit as the first scripts/ test so the allowlist tripwire
      // (app/lib/__tests__/vitest-include-coverage.test.ts) stays green.
      "scripts/**/__tests__/**/*.test.{ts,tsx}",
      // NOT listed, deliberately: `archive/**` (the retired new-user v2 flow,
      // v3 plan Unit 9). It is excluded from tsconfig and eslint too. No test
      // file moved into it — the v2 pinning tests were dispositioned rather
      // than archived — so the include-coverage tripwire stays green WITHOUT
      // an ignore entry, and if someone ever does archive a test file the
      // tripwire reddening is the correct signal, not a nuisance.
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws outside an RSC bundle; stub it so tests can
      // import pure functions (buildTimeline) from server-adjacent modules.
      "server-only": path.resolve(
        __dirname,
        "app/crm/__tests__/stubs/server-only.ts"
      ),
    },
  },
});
