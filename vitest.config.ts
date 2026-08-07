import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "app/2026-27/**/__tests__/**/*.test.{ts,tsx}",
      "app/crm/__tests__/**/*.test.{ts,tsx}",
      "app/dashboard/__tests__/**/*.test.{ts,tsx}",
      "app/lib/**/__tests__/**/*.test.{ts,tsx}",
      "app/gauntlet/**/__tests__/**/*.test.{ts,tsx}",
      "app/api/**/__tests__/**/*.test.{ts,tsx}",
      // First Profit (T1 Unit 2). Added with the first Path test, not after it —
      // a directory outside this allowlist silently never runs while
      // `npm run test` stays green (docs/solutions/test-failures/
      // vitest-include-allowlist-new-test-dirs-silently-never-run-2026-07-18.md).
      "app/fp/**/__tests__/**/*.test.{ts,tsx}",
      // The staff hub (Staff Front Door Unit 2). Same rule, same commit as the
      // first test under it — and from this unit on, enforced rather than
      // remembered: app/lib/__tests__/vitest-include-coverage.test.ts fails if
      // any test file in the repo is left outside this list.
      "app/staff/**/__tests__/**/*.test.{ts,tsx}",
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
