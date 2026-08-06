import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design/marketing assets and standalone prototypes — not app source, and
    // they carry their own dependencies that this project does not install.
    "artifacts/**",
    // The retired new-user v2 flow (v3 plan Unit 9). Preserved verbatim as
    // history, not maintained: it still imports live modules, so it is excluded
    // from tsconfig, eslint and vitest together — in the same commit as the
    // move, because a half-excluded archive breaks the build.
    "archive/**",
  ]),
]);

export default eslintConfig;
