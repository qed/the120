import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/crm/__tests__/**/*.test.{ts,tsx}"],
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
