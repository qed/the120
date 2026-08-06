import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The Image Lab's client boundary, enforced by the LINTER rather than by a
 * regex over source text.
 *
 * All three `fp_image_lab_*` tables have RLS enabled with ZERO policies and
 * `revoke all … from anon, authenticated`. Server code holding the ANON key
 * therefore fails every touch with 42501 IN PRODUCTION while CI stays green,
 * because every test injects a fake and a fake has no RLS
 * (docs/solutions/security-issues/rls-enabled-zero-policies-but-the-server-
 * code-is-postgrest-anon-key-2026-07-28.md).
 *
 * ── WHY THIS IS A LINT RULE AND NOT A GREP ─────────────────────────────────
 * The previous guard was a keyword scan over `app/staff/image-lab/**` and
 * review defeated it SEVEN ways with the full suite green: a dynamic
 * `await import(...)`, a relative specifier the `@/`-anchored alternation never
 * matched, a re-export barrel one directory outside the scanned tree, a direct
 * `createClient` from the vendor package, a relative admin import, a `.js`
 * module the `{ts,tsx}` glob skipped, and a production module parked under
 * `lib/__tests__/` that the scan ignored and vitest never ran.
 *
 * Glob PATTERNS match relative and aliased spellings with one rule, and the
 * scope covers every extension it is pointed at — so the shape of the specifier
 * stops mattering. What this rule cannot do is inspect a dynamic `import()`
 * (verified against ESLint 9.39), or see a barrel that re-exports the client
 * from outside the Lab. `__tests__/service-role-only.test.ts` covers both by
 * walking the resolved import GRAPH, and asserts this rule is present so
 * deleting the block below reddens.
 *
 * ⚠ `@supabase/supabase-js` IS BANNED OUTRIGHT under the Lab. No Lab module
 * should CONSTRUCT a client at all: `createClient` plus a concatenated
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` was one of the seven bypasses, and it names
 * neither of the two forbidden app modules. The one accessor takes its handle
 * from `@/app/lib/supabase/admin`, and nothing else may.
 */
const ANON_CLIENT_PATTERN = {
  // Both the aliased and every relative spelling of the two anon-key clients.
  group: [
    "@/app/lib/supabase/client",
    "@/app/lib/supabase/server",
    "**/lib/supabase/client",
    "**/lib/supabase/server",
    "**/supabase/client",
    "**/supabase/server",
  ],
  message:
    "Image Lab modules must not import an anon-key Supabase client (browser or cookie-session). Every fp_image_lab_* touch goes through imageLabDb() — see app/staff/image-lab/lib/image-lab-db.ts.",
};

const VENDOR_CLIENT_PATTERN = {
  group: ["@supabase/supabase-js", "@supabase/ssr"],
  message:
    "Image Lab modules must not construct a Supabase client. Take the service-role handle from imageLabDb() (app/staff/image-lab/lib/image-lab-db.ts).",
};

const ADMIN_CLIENT_PATTERN = {
  group: ["@/app/lib/supabase/admin", "**/lib/supabase/admin", "**/supabase/admin"],
  message:
    "Only app/staff/image-lab/lib/image-lab-db.ts may import the service-role client. Other Lab modules take the handle it exports, so 'which client does the Image Lab use' has one answer in one place.",
};

export const IMAGE_LAB_IMPORT_RULES = {
  /** Every module under the Lab. */
  all: [ANON_CLIENT_PATTERN, VENDOR_CLIENT_PATTERN, ADMIN_CLIENT_PATTERN],
  /** THE one accessor — allowed the admin client, nothing else. */
  accessor: [ANON_CLIENT_PATTERN, VENDOR_CLIENT_PATTERN],
};

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
  {
    // EVERY extension, not just the two the old scan looked at.
    name: "image-lab/service-role-only",
    files: ["app/staff/image-lab/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: IMAGE_LAB_IMPORT_RULES.all }],
    },
  },
  {
    // THE one accessor. Named explicitly so the exception is a line in this
    // file rather than a hole in the rule above.
    name: "image-lab/the-one-accessor",
    files: ["app/staff/image-lab/lib/image-lab-db.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: IMAGE_LAB_IMPORT_RULES.accessor }],
    },
  },
]);

export default eslintConfig;
