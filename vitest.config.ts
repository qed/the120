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
      // The Path (T1 Unit 2). Added with the first Path test, not after it —
      // a directory outside this allowlist silently never runs while
      // `npm run test` stays green (docs/solutions/test-failures/
      // vitest-include-allowlist-new-test-dirs-silently-never-run-2026-07-18.md).
      "app/path/**/__tests__/**/*.test.{ts,tsx}",
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
